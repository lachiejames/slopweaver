/**
 * PATH-TO-`data:`-URI resolution for a briefing form's image blocks, run BEFORE the typed schema ever sees
 * the JSON — so `./schema.ts`'s `image` block never has to know a `path` field exists at all. It only ever
 * validates the resolved `data` string, exactly the way `./schema.ts`'s own doc comment says every cap here
 * is counted over the text a reader meets rather than over what a composer typed to get there.
 *
 * ## Why this is two passes rather than one recursive rewrite
 *
 * Reading a file is I/O, and this repository confines I/O to a thin edge (`../../cli/commands/briefing/*`)
 * so `./schema.ts` and `./render.ts` stay pure and testable without touching disk. {@link collectImagePaths}
 * is the pure half — find every `path` in the parsed JSON, wherever it sits — and {@link applyResolvedImages}
 * is the other pure half — rewrite them once the caller has actually read the files. The CLI edge supplies
 * the one impure step between them: turning each path into bytes.
 *
 * ## Why this walks `unknown` JSON instead of a typed `BriefingForm`
 *
 * `path` is deliberately NOT a field {@link BriefingBlock} (or the zod schema) ever declares — the resolved
 * shape only carries `data`. So there is no typed structure to walk here; the walk is generic over any parsed
 * JSON value, matching on `{ kind: "image", path: "…" }` wherever it appears. That is also what makes this
 * module indifferent to which field of the form an image sits under — a card's `detail`, a note's, a
 * section's — the same way `../artifact/bareRefRuns.ts` never special-cases which block kind a run sequence
 * came from.
 */

/**
 * One `image` block's `path`, found somewhere in a parsed briefing form, with the JSON path to name it by.
 *
 * @internal — the row shape {@link collectImagePaths} returns; a caller destructures it rather than naming
 * the type.
 */
export interface ImagePathRef {
  readonly path: string;
  readonly jsonPath: readonly (string | number)[];
}

/** Whether a JSON value is a plain object a walk can recurse into by key — not an array, not `null`. */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Every `{ kind: "image", path }` node's `path`, found anywhere in a parsed briefing form.
 *
 * A node already carrying `data` (the composer embedded it directly) is left alone here — resolving it is
 * `./schema.ts`'s job, not this file's, since no file read is needed.
 *
 * @param json the parsed form, before it has been validated
 * @param jsonPath the path accumulated so far; callers omit this and let the recursion build it
 * @returns every image path found, each with the JSON path a refusal can name
 */
export function collectImagePaths({
  json,
  jsonPath = [],
}: {
  json: unknown;
  jsonPath?: readonly (string | number)[];
}): readonly ImagePathRef[] {
  if (Array.isArray(json)) {
    return json.flatMap((item, index) => collectImagePaths({ json: item, jsonPath: [...jsonPath, index] }));
  }
  if (!isPlainObject(json)) {
    return [];
  }
  const path = json["path"];
  if (json["kind"] === "image" && typeof path === "string" && json["data"] === undefined) {
    return [{ jsonPath: [...jsonPath, "path"], path }];
  }
  return Object.entries(json).flatMap(([key, value]) =>
    collectImagePaths({ json: value, jsonPath: [...jsonPath, key] }),
  );
}

/**
 * Rewrite every `{ kind: "image", path }` node into `{ kind: "image", data }`, using an already-resolved map
 * from path text to its `data:` URI. Every other node is returned byte-identical.
 *
 * @param json the parsed form, before it has been validated
 * @param resolved every path {@link collectImagePaths} found, mapped to the `data:` URI it read to
 * @returns the form with every image `path` replaced by `data`
 */
export function applyResolvedImages({
  json,
  resolved,
}: {
  json: unknown;
  resolved: ReadonlyMap<string, string>;
}): unknown {
  if (Array.isArray(json)) {
    return json.map((item) => applyResolvedImages({ json: item, resolved }));
  }
  if (!isPlainObject(json)) {
    return json;
  }
  const path = json["path"];
  if (json["kind"] === "image" && typeof path === "string" && json["data"] === undefined) {
    const data = resolved.get(path);
    const { path: _path, ...rest } = json;
    return data === undefined ? json : { ...rest, data };
  }
  return Object.fromEntries(
    Object.entries(json).map(([key, value]) => [key, applyResolvedImages({ json: value, resolved })]),
  );
}

/** One extension this file knows how to embed, mapped to the MIME type its `data:` URI carries. */
const IMAGE_MIME_BY_EXTENSION: Readonly<Record<string, string>> = {
  ".gif": "image/gif",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
};

/**
 * The MIME type a file path's extension implies, or `undefined` for an extension this file will not embed —
 * the same four types {@link DATA_URI_IMAGE} in `./schema.ts` accepts, so a path this resolves always
 * produces a `data` string the schema then admits.
 *
 * @param path the image path a composer wrote into the form
 * @returns the MIME type to embed it as, or `undefined` when the extension is not one of the four supported
 */
export function mimeOfPath({ path }: { path: string }): string | undefined {
  const dot = path.lastIndexOf(".");
  return dot === -1 ? undefined : IMAGE_MIME_BY_EXTENSION[path.slice(dot).toLowerCase()];
}
