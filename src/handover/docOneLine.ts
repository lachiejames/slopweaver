/**
 * Holding what `parseHandoverDoc` returns to one line — the reader half of the flat codec's round trip.
 *
 * The flat reader decodes a quoted value's `\n` (`./flatScalarCodec.ts`), and before it did no flat field could hold
 * a line break, so readers too many to collapse one by one print a field as one line of a row, a refusal or a recap
 * (five in a row, a `repo:` among them). Each field is therefore held to one line HERE, once.
 * `summary` alone keeps its breaks: `--keep-lines` stores lines code reads back off it, and its one-line printers
 * collapse it themselves — so a Unicode break in it is spelled as LF, which every `\s` collapse folds, where
 * JavaScript's `\s` omits NEXT LINE (three printers relied on it).
 *
 * Pure: strings in, strings out.
 */

import { collapseWhitespace } from "#lib/oneLineSummary.js";
import { asList, flatValue } from "./docFlat.js";

/** NEXT LINE, LINE SEPARATOR and PARAGRAPH SEPARATOR, built from code points so this file carries none of them. */
const UNICODE_LINE_BREAKS = new RegExp(
  `[${[0x85, 0x20_28, 0x20_29].map((code) => String.fromCharCode(code)).join("")}]`,
  "gu",
);

/**
 * One flat field's decoded value with every whitespace run, a line break included, collapsed to one space.
 *
 * @param fields the flat map `flatFields` returned
 * @param key the front-matter key
 * @returns the one-line value, or nothing when the key is absent or empty
 */
export function oneLineValue({
  fields,
  key,
}: {
  fields: ReadonlyMap<string, string>;
  key: string;
}): string | undefined {
  const value = flatValue({ fields, key });
  return value === undefined ? undefined : collapseWhitespace({ text: value });
}

/**
 * A flat flow list with each item decoded, then held to one line — decoded first, so an item's escaped break is
 * a real one by the time it is collapsed.
 *
 * @param fields the flat map `flatFields` returned
 * @param key the front-matter key holding the list
 * @returns the one-line items, empty when the key is absent
 */
export function oneLineList({ fields, key }: { fields: ReadonlyMap<string, string>; key: string }): readonly string[] {
  return asList({ value: flatValue({ fields, key }) }).map((item) => collapseWhitespace({ text: item }));
}

/**
 * Each doc problem held to one line: a problem prints as one `  - ` line of a refusal, and the nested YAML reader
 * decodes an escaped `\n` in a value a problem quotes (`doneWhen.path`).
 *
 * @param problems the problems as `docProblems` composed them
 * @returns the same problems, each on one line
 */
export function oneLineProblems({ problems }: { problems: readonly string[] }): readonly string[] {
  return problems.map((problem) => collapseWhitespace({ text: problem }));
}

/**
 * The `summary:` value exactly as written, its line breaks kept, with each Unicode break spelled as LF.
 *
 * @param fields the flat map `flatFields` returned
 * @returns the summary, or nothing when the doc names none
 */
export function summaryValue({ fields }: { fields: ReadonlyMap<string, string> }): string | undefined {
  return flatValue({ fields, key: "summary" })?.replaceAll(UNICODE_LINE_BREAKS, "\n");
}
