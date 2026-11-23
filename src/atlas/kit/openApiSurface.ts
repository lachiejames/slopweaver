/**
 * Reading an OpenAPI document into field-name paths — the half of a specification compile that is not any
 * platform's.
 *
 * ## Why this is kit-owned, and what a platform still writes for itself
 *
 * Two atlases compile a vendor's own published OpenAPI documents, and both had written this: follow a local
 * `$ref` with a cycle guard, branch through `allOf`/`oneOf`/`anyOf`, find the JSON success schema, and walk
 * the properties to a bounded depth. None of that is Twilio's or Hex's — it is what the OpenAPI 3
 * document format is.
 *
 * What a platform still owns is everything ABOUT the operation: which extensions it reads, whether an input
 * can live in a request body, what a refusal is, what a disposition is, and what its provider id looks like.
 * Those genuinely differ — Twilio has thirty-eight origins where a single-origin product has one — so they
 * stay in each atlas's own `specSurface.ts`.
 *
 * ## Field PATHS to a bounded depth, and why an array hop is free
 *
 * A list endpoint's records live one array down, so charging a depth step for the hop would spend the whole
 * budget arriving at them and record `results[]` with nothing underneath it. An array hop is therefore
 * TRANSPARENT: `messages[].status` is one nesting step, not two.
 *
 * The depth cap is not optional. Real vendor schemas are mutually recursive — a Knock workflow carries steps
 * which carry templates which carry a workflow — so an uncapped walk does not terminate on real input. Each
 * atlas declares its own cap and states the resulting truncation in its descriptor.
 */
import { compareStrings } from "#lib/compare.js";
import { isRecord } from "../../lib/parsers.js";
import { err, ok, type Result } from "../../lib/result.js";

import { AtlasCaptureErrors, atlasCaptureErrorLines } from "./captureErrors.js";

/** How many `$ref` hops one schema may be chased through before the walk gives up on it. */
const REF_HOP_CAP = 8;

/** The composition keywords a schema may branch through instead of declaring properties directly. */
const COMPOSITION_KEYWORDS = ["allOf", "oneOf", "anyOf"] as const;

/**
 * Follow a local `$ref` to the node it names, or give up.
 *
 * @param document the whole parsed document, which a `#/`-rooted reference is resolved against
 * @param node the node to resolve, which may or may not be a reference
 * @param seen references already followed on this path, so a cycle terminates
 * @param hops how many references have been followed, so a chain terminates
 * @returns the resolved object, or `null` when it cannot be reached
 */
// Not exported: every caller that used to reach for it now goes through `requestBodyPropertyNames` or
// `jsonSuccessSchema`, which is the seam a platform should be using — a raw `$ref` walk in an atlas is how
// two of them ended up with byte-identical body readers.
function dereference({
  document,
  node,
  seen,
  hops,
}: {
  document: Record<string, unknown>;
  node: unknown;
  seen: ReadonlySet<string>;
  hops: number;
}): Record<string, unknown> | null {
  if (!isRecord(node) || hops > REF_HOP_CAP) {
    return null;
  }
  const ref = node["$ref"];
  if (typeof ref !== "string") {
    return node;
  }
  if (!ref.startsWith("#/") || seen.has(ref)) {
    return null;
  }
  let cursor: unknown = document;
  for (const segment of ref.slice(2).split("/")) {
    if (!isRecord(cursor)) {
      return null;
    }
    cursor = cursor[segment];
  }
  return dereference({ document, hops: hops + 1, node: cursor, seen: new Set([...seen, ref]) });
}

/** Every branch a schema composes, across every composition keyword it carries — `[]` when it composes nothing. */
function compositionBranches({ schema }: { schema: Record<string, unknown> }): readonly unknown[] {
  return COMPOSITION_KEYWORDS.flatMap((keyword) => {
    const branches = schema[keyword];
    return Array.isArray(branches) ? branches : [];
  });
}

/**
 * The references a FREE hop carries on: those already followed, plus the one this node was reached through.
 *
 * A free hop spends no level, so the depth cap cannot end a cycle running through one — a schema that is an
 * array of itself, or the recursive JSON-value `oneOf`, recursed until the stack gave out. Carrying the
 * reference makes meeting it again end that branch instead.
 */
function seenThrough({ schema, seen }: { schema: unknown; seen: ReadonlySet<string> }): ReadonlySet<string> {
  const ref = isRecord(schema) ? schema["$ref"] : undefined;
  return typeof ref === "string" ? new Set([...seen, ref]) : seen;
}

/** Collect the field paths one schema yields, walking through arrays and composition keywords. */
function collectInto({
  document,
  schema,
  prefix,
  level,
  depth,
  seen,
  into,
}: {
  document: Record<string, unknown>;
  schema: unknown;
  prefix: string;
  level: number;
  depth: number;
  seen: ReadonlySet<string>;
  into: Set<string>;
}): void {
  const resolved = dereference({ document, hops: 0, node: schema, seen });
  if (resolved === null) {
    return;
  }
  const through = seenThrough({ schema, seen });
  const items = resolved["items"];
  const isArray = resolved["type"] === "array" && items !== undefined;
  // An array hop is TRANSPARENT and spends no level — see this file's header on why.
  if (isArray) {
    collectInto({ depth, document, into, level, prefix: `${prefix}[]`, schema: items, seen: through });
  }
  // A composition branch is free too, and describes this same value, so it is read beside an array's items
  // and beside a node's own properties — Twilio's memory `meta` sits under an `allOf` and lists `properties`.
  for (const branch of compositionBranches({ schema: resolved })) {
    collectInto({ depth, document, into, level, prefix, schema: branch, seen: through });
  }
  // An array's own `properties` describe no value an array can hold, so only a non-array node's are read.
  if (!isArray) {
    collectProperties({ depth, document, into, level, prefix, properties: resolved["properties"] });
  }
}

/** Record each declared property as a path and walk beneath it, one level down. */
function collectProperties({
  document,
  properties,
  prefix,
  level,
  depth,
  into,
}: {
  document: Record<string, unknown>;
  properties: unknown;
  prefix: string;
  level: number;
  depth: number;
  into: Set<string>;
}): void {
  if (!isRecord(properties)) {
    return;
  }
  for (const [name, sub] of Object.entries(properties)) {
    const next = prefix === "" ? name : `${prefix}.${name}`;
    into.add(next);
    // A property step spends a level, so the depth cap bounds it — and a named schema met again one level
    // down is real output (a workflow's steps carry a template that carries a workflow), never a cycle to cut.
    if (level < depth) {
      collectInto({ depth, document, into, level: level + 1, prefix: next, schema: sub, seen: new Set() });
    }
  }
}

/**
 * Every field-name path one schema declares, to a bounded depth.
 *
 * @param document the whole parsed document, so a `$ref` can be followed
 * @param schema the schema to walk, or `null` when the operation declares none
 * @param depth how many nesting steps past the top level to record; an array hop is free
 * @returns the paths, sorted, `[]` marking an array
 */
export function schemaFieldPaths({
  document,
  schema,
  depth,
}: {
  document: Record<string, unknown>;
  schema: unknown;
  depth: number;
}): readonly string[] {
  if (schema === null || schema === undefined) {
    return [];
  }
  const found = new Set<string>();
  collectInto({ depth, document, into: found, level: 0, prefix: "", schema, seen: new Set() });
  return [...found].toSorted();
}

/**
 * The JSON schema one operation declares for a successful response, or `null` when it declares none.
 *
 * @param document the whole parsed document, so a `$ref` can be followed
 * @param operation the operation object
 * @param codes the status codes to look under, in the order this vendor uses them
 * @returns the schema node, or `null`
 */
export function jsonSuccessSchema({
  document,
  operation,
  codes,
}: {
  document: Record<string, unknown>;
  operation: Record<string, unknown>;
  codes: readonly string[];
}): unknown {
  const responses = operation["responses"];
  if (!isRecord(responses)) {
    return null;
  }
  for (const code of codes) {
    const response = dereference({ document, hops: 0, node: responses[code], seen: new Set() });
    if (response === null) {
      continue;
    }
    const content = response["content"];
    if (!isRecord(content)) {
      continue;
    }
    const json = content["application/json"];
    if (isRecord(json) && json["schema"] !== undefined) {
      return json["schema"];
    }
  }
  return null;
}

/**
 * Every declared parameter NAME on one operation's `parameters` list.
 *
 * @internal — `tools/generateKnockSurfaces.ts` is its one caller outside this file, and knip does not trace
 * the generators.
 * @param operation the operation object
 * @returns the names, sorted and deduplicated
 */
export function declaredParameterNames({ operation }: { operation: Record<string, unknown> }): readonly string[] {
  const declared = operation["parameters"];
  if (!Array.isArray(declared)) {
    return [];
  }
  const names = new Set<string>();
  for (const entry of declared) {
    if (isRecord(entry) && typeof entry["name"] === "string" && entry["name"].length > 0) {
      names.add(entry["name"]);
    }
  }
  return [...names].toSorted();
}

/**
 * The property names one operation's REQUEST BODY declares, whichever content type carries it.
 *
 * Kit-owned because it was written twice, byte-for-byte apart from its content-type list, and the clone
 * ratchet caught the second copy: the Twilio and Hex atlases both compile OpenAPI 3 documents whose real
 * inputs live in `requestBody` rather than in `parameters`. Same family as `kit/projection.ts` and
 * `kit/withheld.ts`, same argument: a shape that regenerates because the next atlas's author opens whichever
 * sibling they find first.
 *
 * What does NOT generalise is which content types a vendor uses, so that stays the caller's: Twilio's writes
 * are `application/x-www-form-urlencoded` and Hex's are `application/json`, and a list that guessed would
 * report one of them as taking no inputs at all.
 *
 * @internal — {@link operationInputNames} is how every atlas reaches it today.
 * @param document the whole parsed description, so a `$ref` can be followed
 * @param operation the operation object
 * @param contentTypes the media types this vendor declares a body under, in the order to try them
 * @returns the property names, in declaration order, or `[]` when the operation declares no body
 */
export function requestBodyPropertyNames({
  document,
  operation,
  contentTypes,
}: {
  document: Record<string, unknown>;
  operation: Record<string, unknown>;
  contentTypes: readonly string[];
}): readonly string[] {
  const body = dereference({ document, hops: 0, node: operation["requestBody"], seen: new Set() });
  if (body === null) {
    return [];
  }
  const content = body["content"];
  if (!isRecord(content)) {
    return [];
  }
  for (const type of contentTypes) {
    const entry = content[type];
    if (!isRecord(entry)) {
      continue;
    }
    const schema = dereference({ document, hops: 0, node: entry["schema"], seen: new Set() });
    const properties = schema === null ? null : schema["properties"];
    if (isRecord(properties)) {
      return Object.keys(properties);
    }
  }
  return [];
}

/**
 * The security scheme NAMES one `security` requirement list names.
 *
 * Kit-owned for the same reason as {@link requestBodyPropertyNames}: an OpenAPI security requirement is a
 * list of objects whose KEYS are the scheme names, and reading that is the document format rather than any
 * platform. What each atlas still owns is what it does with them — Twilio treats them as which credential
 * reaches a subdomain.
 *
 * @param requirements the `security` node, from an operation or from the document
 * @returns the scheme names, sorted and deduplicated, or `[]` when there are none
 */
export function securitySchemeNames({ requirements }: { requirements: unknown }): readonly string[] {
  if (!Array.isArray(requirements)) {
    return [];
  }
  const names = new Set<string>();
  for (const requirement of requirements) {
    if (isRecord(requirement)) {
      for (const name of Object.keys(requirement)) {
        names.add(name);
      }
    }
  }
  return [...names].toSorted();
}

/**
 * Every input one operation accepts, from `parameters` and the request body alike.
 *
 * The pair to {@link requestBodyPropertyNames}, kit-owned for the same reason and by the same measurement:
 * two readers had folded those two sources together identically, and the union is what a caller actually
 * wants — "what can I pass to this operation", wherever the document happens to declare it.
 *
 * @param document the whole parsed document, so a `$ref` can be followed
 * @param operation the operation object
 * @param contentTypes the media types a request body is looked for under, in this platform's own order
 * @returns the names, sorted and deduplicated
 */
export function operationInputNames({
  document,
  operation,
  contentTypes,
}: {
  document: Record<string, unknown>;
  operation: Record<string, unknown>;
  contentTypes: readonly string[];
}): readonly string[] {
  return [
    ...new Set<string>([
      ...requestBodyPropertyNames({ contentTypes, document, operation }),
      ...declaredParameterNames({ operation }),
    ]),
  ].toSorted();
}

/**
 * The first usable server url a `servers` list declares.
 *
 * Nullable rather than an empty string: "this document publishes no origin" is a fact worth a reader
 * knowing, and an empty string is that fact written so it reads like a value. Kit-owned because both
 * OpenAPI readers here resolve a host per operation, since a path item may override the document's own.
 *
 * @param servers the `servers` array, from the document root or from one path item
 * @returns the url, or `null` when the list declares none this reader can use
 */
export function firstServerUrl({ servers }: { servers: unknown }): string | null {
  if (!Array.isArray(servers)) {
    return null;
  }
  for (const server of servers) {
    if (isRecord(server) && typeof server["url"] === "string" && server["url"].length > 0) {
      return server["url"];
    }
  }
  return null;
}

/**
 * What reading one whole OpenAPI document yields, over whatever operation row a platform declares.
 *
 * @internal
 */
export interface OpenApiDocumentSurface<TOperation> {
  /** Every origin its operations answer on, sorted. */
  readonly hosts: readonly string[];
  readonly operations: readonly TOperation[];
  readonly pathCount: number;
  /** Every security scheme its operations require, sorted. */
  readonly securitySchemes: readonly string[];
  /** The id this document is pinned under. */
  readonly specId: string;
  /** `info.title` as the vendor writes it, or the id when it declares none. */
  readonly title: string;
}

/**
 * Read one already-parsed OpenAPI document into the operations it declares.
 *
 * ## Kit-owned because it was copied, and the copy was not the interesting half
 *
 * Two atlases had this preamble byte-identical — is it an object, does it declare `paths`, what host and
 * security requirement does the document itself carry, fold every path item, what is its title — and the
 * clone ratchet said so. What is genuinely per-platform is {@link operationsOnPath}: how one path item's
 * methods become that atlas's own operation rows, which is where every platform-specific extension, field
 * depth and disposition decision lives. So the shell is here and the interesting half is passed in.
 *
 * It REFUSES a document declaring no `paths` rather than reporting an empty surface, which is the same
 * distinction the coverage vocabulary draws everywhere else: "this document declares nothing" and "this
 * reader could not read it" must not produce the same answer.
 *
 * @param document the parsed definition, as JSON
 * @param specId the id this document is pinned under
 * @param operationsOnPath how one path item becomes this platform's operation rows
 * @param hostOf the origin one operation row answers on, or `null` when it declares none
 * @param securitySchemesOf the scheme names one operation row requires
 * @param sortKeyOf the key operations are sorted by, in locale-independent code-unit order
 * @returns the compiled surface, or why the document could not be read
 */
export function readOpenApiDocument<TOperation>({
  document,
  specId,
  operationsOnPath,
  hostOf,
  securitySchemesOf,
  sortKeyOf,
}: {
  document: unknown;
  specId: string;
  operationsOnPath: (input: {
    document: Record<string, unknown>;
    documentHost: string | null;
    documentSecurity: readonly string[];
    item: unknown;
    path: string;
  }) => readonly TOperation[];
  hostOf: (input: { operation: TOperation }) => string | null;
  securitySchemesOf: (input: { operation: TOperation }) => readonly string[];
  sortKeyOf: (input: { operation: TOperation }) => string;
}): Result<OpenApiDocumentSurface<TOperation>> {
  if (!isRecord(document)) {
    return err(atlasCaptureErrorLines({ error: AtlasCaptureErrors.openApiNotObject({ specId }) }));
  }
  const paths = document["paths"];
  if (!isRecord(paths)) {
    return err(atlasCaptureErrorLines({ error: AtlasCaptureErrors.openApiNoPaths({ specId }) }));
  }
  const documentHost = firstServerUrl({ servers: document["servers"] });
  const documentSecurity = securitySchemeNames({ requirements: document["security"] });
  const operations = Object.entries(paths).flatMap(([path, item]) =>
    operationsOnPath({ document, documentHost, documentSecurity, item, path }),
  );
  const info = document["info"];
  return ok({
    hosts: [
      ...new Set(operations.map((operation) => hostOf({ operation })).filter((host): host is string => host !== null)),
    ].toSorted(),
    // `compareStrings`, never `localeCompare`: the provider ids are mixed-case, and a collation puts
    // `GET /accounts` before `GET /Accounts` where code-unit order does the opposite — and varies by machine.
    // Code-unit order is UTF-16's, not UTF-8 byte order: the two differ only past U+FFFF, and no pinned Twilio or Hex path leaves ASCII.
    operations: operations.toSorted((left, right) =>
      compareStrings({ a: sortKeyOf({ operation: left }), b: sortKeyOf({ operation: right }) }),
    ),
    pathCount: Object.keys(paths).length,
    securitySchemes: [...new Set(operations.flatMap((operation) => securitySchemesOf({ operation })))].toSorted(),
    specId,
    title: isRecord(info) && typeof info["title"] === "string" ? info["title"] : specId,
  });
}
