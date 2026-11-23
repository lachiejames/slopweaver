/**
 * How the tick digest reads one captured document: defensive accessors that never throw, the line a reading
 * that did not complete prints instead of its facts, and the cap every list of rows in the digest shares.
 *
 * Split from `tickDigest.ts` along the seam between READING a document and deciding which lines it becomes.
 * Pure.
 */
import { absentAs } from "#lib/absent.js";
import { isRecord } from "#lib/parsers.js";

import { type ChildOutcome, describeChildOutcome } from "./scratch/childOutcome.js";

/** One reading as the digest sees it. */
export type DigestReading =
  | { readonly kind: "json"; readonly value: unknown }
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "unavailable"; readonly child: ChildOutcome };

/**
 * What the seat's previous pass held on purpose: the board rows its `hold-rationale` judgements named, by exact
 * id, each with the claim that held it. `none` when this is the seat's first tick or the previous one was never
 * filled; `unreadable` when its `tick.json` is there and would not parse — said, never read as "nothing held".
 */
export type PriorHolds =
  | { readonly kind: "none" }
  | { readonly kind: "read"; readonly tick: number; readonly held: ReadonlyMap<string, string> }
  | { readonly kind: "unreadable"; readonly tick: number; readonly why: string };

/**
 * The main checkout a broken recipe's fix row is pointed at — what `handover set-repo --repo slopweaver` resolves
 * to on this machine, resolved the way that verb resolves it — or that verb's own refusal. The digest prints the
 * path, so the command it prints is one `set-repo` accepts here, or says why there is none.
 */
export type RecipeFixCheckout =
  { readonly kind: "resolved"; readonly path: string } | { readonly kind: "unresolved"; readonly why: string };

/** Everything the digest reads, by reading name, plus what only the edge can stat or resolve. */
export interface DigestInputs {
  readonly readings: ReadonlyMap<string, DigestReading>;
  /** What the previous pass held — {@link PriorHolds}. */
  readonly priorHolds: PriorHolds;
  /** Where a broken recipe's fix is seated — {@link RecipeFixCheckout}. */
  readonly recipeFixCheckout: RecipeFixCheckout;
  /** Minutes since `open-pages.json` was written, or undefined when the seat has none. */
  readonly openPagesAgeMinutes: number | undefined;
  /** Minutes since `run.json`'s own `nowIso`, or undefined when the seat has none. */
  readonly runAgeMinutes: number | undefined;
}

/**
 * A field of a record, or undefined when the value is not a record.
 *
 * @param value the parsed document
 * @param key the field
 * @returns the field's value
 */
export function field({ value, key }: { value: unknown; key: string }): unknown {
  return isRecord(value) ? value[key] : undefined;
}

/**
 * A string field, or undefined when it is absent or not a string.
 *
 * @returns the string
 */
export function stringField({ value, key }: { value: unknown; key: string }): string | undefined {
  const found = field({ key, value });
  return typeof found === "string" ? found : undefined;
}

/**
 * A number field, or undefined when it is absent or not a number.
 *
 * @returns the number
 */
export function numberField({ value, key }: { value: unknown; key: string }): number | undefined {
  const found = field({ key, value });
  return typeof found === "number" ? found : undefined;
}

/**
 * An array field, or the empty list when it is absent or not an array.
 *
 * @returns the array's elements
 */
export function arrayField({ value, key }: { value: unknown; key: string }): readonly unknown[] {
  const found = field({ key, value });
  return Array.isArray(found) ? found : [];
}

/**
 * A list the reading must carry, or undefined when it carries none — never read as empty, unlike
 * {@link arrayField}, so a line resting on it can say UNKNOWN instead of "none".
 *
 * @returns the list, or undefined
 */
export function listOf({ key, value }: { key: string; value: unknown }): readonly unknown[] | undefined {
  const list = field({ key, value });
  if (!Array.isArray(list)) {
    return undefined;
  }
  return list;
}

/**
 * The line a reading that did not complete prints instead of its facts.
 *
 * @param name the reading's name
 * @param reading what the capture left
 * @returns the line, or undefined when the reading did complete
 */
export function unavailableLine({
  name,
  reading,
}: {
  name: string;
  reading: DigestReading | undefined;
}): string | undefined {
  if (reading === undefined) {
    return `${name}: not captured this tick`;
  }
  if (reading.kind === "unavailable") {
    return `${name}: unavailable — ${describeChildOutcome({ outcome: reading.child })}`;
  }
  return undefined;
}

/**
 * The parsed JSON of one reading, or the line saying why there is none.
 *
 * @returns either the value or the unavailable line
 */
export function jsonOf({
  name,
  inputs,
}: {
  name: string;
  inputs: DigestInputs;
}): { readonly value: unknown } | { readonly line: string } {
  const reading = inputs.readings.get(name);
  const missing = unavailableLine({ name, reading });
  if (missing !== undefined) {
    return { line: missing };
  }
  if (reading?.kind !== "json") {
    return { line: `${name}: captured as text, not JSON` };
  }
  return { value: reading.value };
}

/**
 * How many rows a detail list names before counting the rest. The chair read eight by hand (`.ready[0:8]`),
 * and a longer list starts to bury the headline lines above it.
 */
const LIST_NAMED = 8;

/** How many characters of a row's free text a detail line carries. */
const DETAIL_CHARS = 100;

/** An alert's text is the whole of what it says, so it keeps more of it than a label does. */
export const ALERT_CHARS = 160;

/**
 * Up to {@link LIST_NAMED} lines, then one saying how many more there were — never a silent cut.
 *
 * @param lines every line the list would print
 * @param prefix what the overflow line reads, so it sorts beside the lines it counts
 * @returns the named lines, plus the overflow line when some were cut
 */
export function capped({ lines, prefix }: { lines: readonly string[]; prefix: string }): readonly string[] {
  if (lines.length <= LIST_NAMED) {
    return lines;
  }
  return [...lines.slice(0, LIST_NAMED), `${prefix}: and ${String(lines.length - LIST_NAMED)} more`];
}

/**
 * Free text cut to `limit` characters, with an ellipsis when it was cut so a cut never reads as the whole.
 *
 * @returns the text, whole or cut
 */
export function shortened({ text, limit = DETAIL_CHARS }: { text: string; limit?: number }): string {
  return text.length > limit ? `${text.slice(0, limit)}…` : text;
}

/**
 * A free-text field, {@link shortened}.
 *
 * @returns the text, or the caller's word when the field is absent
 */
export function detail({ value, key, whenAbsent }: { value: unknown; key: string; whenAbsent: string }): string {
  return shortened({ text: absentAs({ value: stringField({ key, value }), whenAbsent }) });
}

/**
 * A string field for interpolation into a line, never the literal `undefined`.
 *
 * @returns the string, or `(no <key>)` when the field is absent or not a string
 */
export function named({ value, key }: { value: unknown; key: string }): string {
  return absentAs({ value: stringField({ key, value }), whenAbsent: `(no ${key})` });
}

/**
 * A number field for interpolation into a line, never the literal `undefined`.
 *
 * @returns the number as text, or `?` when the field is absent or not a number
 */
export function countText({ value, key }: { value: unknown; key: string }): string {
  const found = numberField({ key, value });
  if (found === undefined) {
    return "?";
  }
  return String(found);
}

/**
 * One element of a list the digest names, as text: a string verbatim, anything else as its JSON, either one
 * {@link shortened} so a single element can never carry an unbounded list into a line.
 *
 * @returns the text
 */
export function asText({ value }: { value: unknown }): string {
  if (typeof value === "string") {
    return shortened({ text: value });
  }
  if (value === undefined) {
    return "(nothing)";
  }
  try {
    // Typed `unknown` on purpose: `JSON.stringify` answers undefined, not the string its signature claims, for a
    // symbol, a function, or anything whose `toJSON` does.
    const text: unknown = JSON.stringify(value);
    return typeof text === "string" ? shortened({ text }) : "(unprintable)";
  } catch {
    // A value nested past the stack (or a cycle) is not something a digest line can name; say so.
    return "(unprintable)";
  }
}

/**
 * A list named inside one line, cut at the same {@link LIST_NAMED} as a list of lines and counted the same way.
 *
 * @returns the first items joined with commas, then `and N more` when some were cut
 */
export function cappedInline({ items }: { items: readonly string[] }): string {
  const head = items.slice(0, LIST_NAMED).join(", ");
  if (items.length <= LIST_NAMED) {
    return head;
  }
  return `${head} and ${String(items.length - LIST_NAMED)} more`;
}
