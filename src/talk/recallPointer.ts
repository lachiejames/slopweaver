/**
 * The pointer grammar of `slopweaver talk recall`: what a search hit prints so the voice can open it, and the only
 * spellings `--open` accepts back. Every scheme names a record by an id, a slug or an archive file's own name —
 * never a path — so a pointer the voice passes cannot reach outside the home.
 *
 * - `talk-call:<call id>#<turn id>` — one spoken turn of a call transcript
 * - `talk:<turn id>` — one steer the voice relayed, the existing `talk` anchor
 * - `ruling-run:<run>#L<line>` — a ruling journalled on a run
 * - `ruling-archive:<file>.md#L<line>` — a ruling row of an archived state-doc block
 * - `knowledge:<claim id>` — one knowledge row
 *
 * Pure: no filesystem.
 */
import { err, ok, type Result } from "../lib/result.js";
import { type RecallError, RecallErrors } from "./recallErrors.js";

/** A parsed pointer: which record, in which source. */
export type RecallPointer =
  | { readonly kind: "call"; readonly callId: string; readonly segmentId: string }
  | { readonly kind: "steer"; readonly turnId: string }
  | { readonly kind: "run-ruling"; readonly slug: string; readonly line: number }
  | { readonly kind: "archived-ruling"; readonly file: string; readonly line: number }
  | { readonly kind: "knowledge"; readonly memoryId: string };

/** A lowercase v4 UUID — a call id and a relay turn id alike. */
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

/** A run slug a journal file is named after; no separator, no leading dot. */
const SAFE_SLUG = /^[a-z0-9][a-z0-9._-]*$/u;

/** An archived state-doc file's own name; no separator, no leading dot. */
const SAFE_ARCHIVE_FILE = /^[A-Za-z0-9][A-Za-z0-9._-]*\.md$/u;

/** A 1-based line number, as `L<n>`. */
const LINE_REF = /^L([1-9][0-9]{0,8})$/u;

/**
 * The canonical spelling of a pointer — the only one {@link parseRecallPointer} accepts back.
 *
 * @param pointer the record to point at
 * @returns its text
 */
export function recallPointerOf({ pointer }: { pointer: RecallPointer }): string {
  switch (pointer.kind) {
    case "call":
      return `talk-call:${pointer.callId}#${encodeURIComponent(pointer.segmentId)}`;
    case "steer":
      return `talk:${pointer.turnId}`;
    case "run-ruling":
      return `ruling-run:${pointer.slug}#L${String(pointer.line)}`;
    case "archived-ruling":
      return `ruling-archive:${encodeURIComponent(pointer.file)}#L${String(pointer.line)}`;
    case "knowledge":
      return `knowledge:${encodeURIComponent(pointer.memoryId)}`;
    default: {
      const unreachable: never = pointer;
      return unreachable;
    }
  }
}

/**
 * Parse a pointer a search hit printed. Only the canonical spelling is accepted: a pointer that re-spells to
 * something else, names a path, or carries a malformed escape is refused.
 *
 * @param text the pointer as the voice passed it
 * @returns the parsed pointer, or why it is not one
 */
export function parseRecallPointer({ text }: { text: string }): Result<RecallPointer, RecallError> {
  const parsed = parsePointerParts({ text });
  if (parsed.isErr()) {
    return parsed;
  }
  if (recallPointerOf({ pointer: parsed.value }) !== text) {
    return err(RecallErrors.pointerMalformed({ pointer: text, why: "not its canonical spelling" }));
  }
  return parsed;
}

/** A pointer's text after its scheme: the body, and the fragment after `#` when there is one. */
interface PointerParts {
  readonly body: string;
  readonly fragment: string | undefined;
}

/** One scheme's parser: the pointer, or `undefined` when the parts do not have the scheme's shape. */
type SchemeParser = (parts: PointerParts) => RecallPointer | undefined;

/** The 1-based line a `L<n>` fragment names, or `undefined` when it names none. */
function lineOf({ fragment }: { fragment: string | undefined }): number | undefined {
  if (fragment === undefined) {
    return undefined;
  }
  const line = LINE_REF.exec(fragment);
  if (line === null) {
    return undefined;
  }
  return Number(line[1]);
}

/** Each scheme's parser, and the shape a refusal names when it does not parse. */
const SCHEMES: ReadonlyMap<string, { readonly parse: SchemeParser; readonly shape: string }> = new Map([
  [
    "talk-call",
    {
      parse: ({ body, fragment }) => {
        const segmentId = decodeComponent({ text: fragment });
        if (!UUID_V4.test(body) || segmentId === undefined || segmentId === "") {
          return undefined;
        }
        return { callId: body, kind: "call", segmentId };
      },
      shape: "a call pointer is talk-call:<call id>#<turn id>",
    },
  ],
  [
    "talk",
    {
      parse: ({ body, fragment }) => {
        if (!UUID_V4.test(body) || fragment !== undefined) {
          return undefined;
        }
        return { kind: "steer", turnId: body };
      },
      shape: "a steer pointer is talk:<turn id>",
    },
  ],
  [
    "ruling-run",
    {
      parse: ({ body, fragment }) => {
        const line = lineOf({ fragment });
        if (!SAFE_SLUG.test(body) || line === undefined) {
          return undefined;
        }
        return { kind: "run-ruling", line, slug: body };
      },
      shape: "a ruling pointer is ruling-run:<run>#L<line>",
    },
  ],
  [
    "ruling-archive",
    {
      parse: ({ body, fragment }) => {
        const file = decodeComponent({ text: body });
        const line = lineOf({ fragment });
        if (file === undefined || !SAFE_ARCHIVE_FILE.test(file) || line === undefined) {
          return undefined;
        }
        return { file, kind: "archived-ruling", line };
      },
      shape: "an archived ruling pointer is ruling-archive:<file>.md#L<line>",
    },
  ],
  [
    "knowledge",
    {
      parse: ({ body, fragment }) => {
        const memoryId = decodeComponent({ text: body });
        if (memoryId === undefined || memoryId === "" || fragment !== undefined) {
          return undefined;
        }
        return { kind: "knowledge", memoryId };
      },
      shape: "a knowledge pointer is knowledge:<claim id>",
    },
  ],
]);

/** Split a pointer into its scheme, body and fragment, and validate them against the scheme's shape. */
function parsePointerParts({ text }: { text: string }): Result<RecallPointer, RecallError> {
  const colon = text.indexOf(":");
  if (colon <= 0) {
    return err(RecallErrors.pointerMalformed({ pointer: text, why: "no scheme" }));
  }
  const scheme = text.slice(0, colon);
  const known = SCHEMES.get(scheme);
  if (known === undefined) {
    return err(RecallErrors.pointerMalformed({ pointer: text, why: `unknown scheme ${scheme}` }));
  }
  const rest = text.slice(colon + 1);
  const hash = rest.indexOf("#");
  let parts: PointerParts = { body: rest, fragment: undefined };
  if (hash !== -1) {
    parts = { body: rest.slice(0, hash), fragment: rest.slice(hash + 1) };
  }
  const pointer = known.parse(parts);
  if (pointer === undefined) {
    return err(RecallErrors.pointerMalformed({ pointer: text, why: known.shape }));
  }
  return ok(pointer);
}

/** `decodeURIComponent`, answering `undefined` for an absent or malformed escape rather than throwing. */
function decodeComponent({ text }: { text: string | undefined }): string | undefined {
  if (text === undefined) {
    return undefined;
  }
  try {
    return decodeURIComponent(text);
  } catch {
    return undefined;
  }
}
