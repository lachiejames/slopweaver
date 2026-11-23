/**
 * A ruling manifest — the reviewed list of which recorded answers are rulings, and what each one says.
 *
 * The rulings `handover answer` recorded are backfilled as `ruling` events, and the gold proof is the audit
 * reading every backfilled row as decided. A proof
 * needs a denominator that is not the thing being measured, and this is it: a list written down BEFORE the
 * backfill runs, which `handover audit-rulings --manifest` reads every row against and which the backfill
 * itself will write from. Neither verb invents an entry.
 *
 * ```json
 * { "schemaVersion": 1,
 *   "entries": [{ "slug": "a-row", "sourceAtIso": "<canonical ISO instant>",
 *                 "words": "<the answer, byte for byte>", "anchor": "<where the owner said it>" }] }
 * ```
 *
 * **Strict, and whole.** An unknown key, a blank field, a slug that could escape the runs directory or an
 * instant in anything but canonical `toISOString()` spelling rejects the WHOLE manifest rather than dropping
 * the entry: a manifest that silently lost one entry would certify a subset as the set. The instant rule is
 * `./ruling.ts`'s own, because a non-canonical spelling is one the source check will never match. Words and
 * anchor are kept exactly as written — nothing is trimmed, because the words are compared byte for byte
 * against an answer.
 *
 * The file itself is per-install state and never lives in this repository: its entries quote the owner.
 *
 * Pure: text in, a manifest or every reason it is not one out.
 */

import { z } from "zod";
import { parseJson } from "#lib/jsonParse.js";
import { err, ok, type Result } from "#lib/result.js";

import { isCanonicalInstant } from "./ruling.js";
import { type RulingManifestError, RulingManifestErrors } from "./rulingManifestErrors.js";
import { isSafeSlug } from "./runStore.js";

/** One reviewed answer that is a ruling. */
export interface RulingManifestEntry {
  /** The row whose journal holds the answer. */
  readonly slug: string;
  /** The `atIso` of the `answered` event, in canonical spelling. */
  readonly sourceAtIso: string;
  /** The answer as recorded — what the backfilled ruling's `ruling` field must equal. */
  readonly words: string;
  /** Where the owner gave it: a transcript, a permalink, a file, or `journal:runs/<slug>.jsonl#<atIso>`. */
  readonly anchor: string;
}

/** The whole reviewed list. */
export interface RulingManifest {
  readonly schemaVersion: 1;
  readonly entries: readonly RulingManifestEntry[];
}

/** Present and not blank — tested on the trimmed form, stored untrimmed. */
const nonBlank = z.string().refine((value) => value.trim().length > 0, { message: "must not be blank" });

const entrySchema = z
  .object({
    anchor: nonBlank,
    slug: z.string().refine((slug) => isSafeSlug({ slug }), { message: "is not a safe row slug" }),
    sourceAtIso: z.string().refine((iso) => isCanonicalInstant({ iso }), {
      message: "is not a canonical toISOString() instant, so no source answer could ever match it",
    }),
    words: nonBlank,
  })
  .strict();

const manifestSchema = z.object({ entries: z.array(entrySchema), schemaVersion: z.literal(1) }).strict();

/**
 * Parse a ruling manifest, or say every reason it is not one.
 *
 * An empty `entries` array parses: it is a valid statement that nothing is expected, and the audit reports
 * zero manifest checks rather than pretending that proves a backfill.
 *
 * @param text the manifest file's contents
 * @returns the manifest, or one line per problem found
 */
export function parseRulingManifest({ text }: { text: string }): Result<RulingManifest, RulingManifestError> {
  const raw = parseJson({ text });
  if (raw.isErr()) {
    return err(RulingManifestErrors.notJson({ detail: raw.error.message }));
  }
  const repeated = repeatedKeys({ text });
  if (repeated.length > 0) {
    return err(RulingManifestErrors.keysRepeated({ keys: repeated }));
  }
  const parsed = manifestSchema.safeParse(raw.value);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => {
      const where = issue.path.join(".");
      if (where === "") {
        return `(root): ${issue.message}`;
      }
      return `${where}: ${issue.message}`;
    });
    return err(RulingManifestErrors.schemaInvalid({ issues }));
  }
  const duplicates = duplicateSources({ entries: parsed.data.entries });
  if (duplicates.length > 0) {
    return err(RulingManifestErrors.sourcesDuplicated({ issues: duplicates }));
  }
  return ok({ entries: parsed.data.entries, schemaVersion: 1 });
}

/**
 * Every key written twice in one object of the raw text.
 *
 * `JSON.parse` keeps the LAST value of a repeated key and says nothing, so a manifest carrying `"entries"`
 * twice parses cleanly as whichever list came second. Found by a review pass whose second list was empty:
 * the reviewed entry vanished, and the audit reported a complete, clean, zero-entry run over it. Every
 * reader of this file believes the parsed value is the file, so the text is scanned for the one thing the
 * parsed value cannot show. Depth-general, because an entry object can repeat a key the same way.
 */
function repeatedKeys({ text }: { text: string }): readonly string[] {
  const repeated: string[] = [];
  const scopes: Set<string>[] = [];
  let state: ScanState = { escaped: false, inString: false, text: "" };
  for (const character of text) {
    state = state.inString ? insideString({ character, state }) : outsideString({ character, repeated, scopes, state });
  }
  return repeated;
}

/** Where the scan is: inside a string or not, whether the last byte escaped the next, and the string so far. */
interface ScanState {
  readonly inString: boolean;
  readonly escaped: boolean;
  readonly text: string;
}

/**
 * One character inside a JSON string, kept RAW — escapes and all.
 *
 * The raw form is decoded by {@link decodedKey} rather than here, because `"entries"` and `"entries"`
 * are the same key to `JSON.parse` and were two different keys to a scanner that skipped escapes. Found by a
 * review pass whose manifest used exactly that to hide a second `entries`. Escape state is still tracked, to
 * know which `"` closes the string.
 */
function insideString({ character, state }: { character: string; state: ScanState }): ScanState {
  if (state.escaped) {
    return { ...state, escaped: false, text: state.text + character };
  }
  if (character === "\\") {
    return { ...state, escaped: true, text: state.text + character };
  }
  if (character === '"') {
    return { ...state, inString: false };
  }
  return { ...state, text: state.text + character };
}

/**
 * A key as JSON means it, decoded by the real decoder rather than by a second implementation of the escapes.
 *
 * A raw form that will not decode is compared as it stands: that text is not valid JSON, so `parseJson`
 * above has already refused the manifest, and this scan only has to avoid inventing a key of its own.
 */
function decodedKey({ raw }: { raw: string }): string {
  const decoded = parseJson({ text: `"${raw}"` });
  return decoded.isOk() && typeof decoded.value === "string" ? decoded.value : raw;
}

/** One character of structure: a string opening, an object opening or closing, or a key being confirmed. */
function outsideString({
  character,
  repeated,
  scopes,
  state,
}: {
  character: string;
  repeated: string[];
  scopes: Set<string>[];
  state: ScanState;
}): ScanState {
  if (character === '"') {
    return { ...state, inString: true, text: "" };
  }
  if (character === "{") {
    scopes.push(new Set());
    return state;
  }
  if (character === "}") {
    scopes.pop();
    return state;
  }
  if (character === ":") {
    noteKey({ key: decodedKey({ raw: state.text }), repeated, scopes });
  }
  return state;
}

/** Record a key against the object it belongs to, and report it when that object already had one. */
function noteKey({ key, repeated, scopes }: { key: string; repeated: string[]; scopes: Set<string>[] }): void {
  const scope = scopes.at(-1);
  if (scope === undefined) {
    return;
  }
  if (scope.has(key)) {
    repeated.push(key);
  }
  scope.add(key);
}

/**
 * Every entry naming a source an earlier entry already named.
 *
 * Refused even when the two agree: one answer is one ruling, and a manifest listing it twice would count it
 * twice toward a proof.
 */
function duplicateSources({ entries }: { entries: readonly RulingManifestEntry[] }): readonly string[] {
  const seen = new Map<string, number>();
  const problems: string[] = [];
  entries.forEach((entry, index) => {
    const identity = `${entry.slug}#${entry.sourceAtIso}`;
    const first = seen.get(identity);
    if (first === undefined) {
      seen.set(identity, index);
      return;
    }
    problems.push(`entries.${String(index)}: names the same source as entries.${String(first)} (${identity})`);
  });
  return problems;
}
