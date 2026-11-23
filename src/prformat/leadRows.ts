/**
 * The two rows every WRITTEN pull-request description leads with: `Risk`, then `Blast radius`.
 *
 * The owner's rule: like the dependency-bump pull requests, every description in both repositories carries risk and blast radius,
 * retroactively and going forward, in one shape. This module is the predicate that makes them REQUIRED in the
 * RETIRED table shape, which `./checkCore.ts` still judges for the bodies `./prBodyGate.ts` allows it on. The
 * reading-order description carries both as its own Risk section, so nothing written today reaches this file.
 *
 * **What it refuses.** An OMITTED pair and a BLANK cell, judged on what a reader SEES: a whole body is rendered
 * (`./renderedTables.ts`) and every drawn table with a Problem row is read, so a cell of whitespace, a character
 * reference, bare markup, an inert `<template>`, an image alone or an autolink swallowed as a tag is empty, and a
 * row GitHub draws counts however it was spelled. It read the source once, and Codex review r3 and eleven Claude
 * fallback rounds after it each found a construct that source reading got wrong; the last structured fuzz of 30,000
 * bodies still found ten.
 *
 * Pure, and deliberately imports nothing from `../outbound/github/`: the form rules there already import this
 * directory, so the reverse edge would be a cycle.
 */

import { renderedTables, saysAnything } from "./renderedTables.js";
import type { ProblemSigns } from "./spelling.js";

/** The labels a written description's main table must open with, in this order. */
export const REQUIRED_LEAD_LABELS: readonly string[] = ["Risk", "Blast radius"];

/** One lead row reduced to what the rule judges: its exact label and its visible text. */
export interface LeadRowText {
  readonly label: string;
  readonly text: string;
}

/**
 * Why a lead list does not open with non-empty `Risk` and `Blast radius` rows, or undefined when it does.
 *
 * Further rows after the pair are allowed; the rule is about the prefix, not the whole list. A row's text is
 * judged by what a reader sees, so a cell of bare markup or `&nbsp;` is empty.
 *
 * @param rows the lead rows in rendered order (text may be rendered HTML), or undefined when the description has none at all
 * @returns the refusal text, or undefined
 */
export function requiredLeadRowsError({ rows }: { rows: readonly LeadRowText[] | undefined }): string | undefined {
  const { length } = REQUIRED_LEAD_LABELS;
  if (rows === undefined) {
    return requiredLeadRowsError({ rows: [] });
  }
  const present = rows.slice(0, length);
  const labelsMatch =
    present.length === length && REQUIRED_LEAD_LABELS.every((label, index) => present[index]!.label === label);
  if (!labelsMatch) {
    const found = present.length === 0 ? "none" : present.map((row) => `"${row.label}"`).join(", ");
    return (
      "**Risk** and **Blast radius** must be the first two rows of the main table, in that order, above " +
      `Problem; the rows above Problem here are ${found}. Risk says how likely this breaks ` +
      "something and what; Blast radius says where it reaches, and where on the app to test it."
    );
  }
  const blank = present.filter((row) => !saysAnything({ fragment: row.text })).map((row) => row.label);
  if (blank.length > 0) {
    return `the ${blank.map((label) => `**${label}**`).join(" and ")} row is empty. Say what it asks, plainly.`;
  }
  return undefined;
}

/**
 * Drawn text as markup-free source, since {@link requiredLeadRowsError} renders a cell's source: a `[` is escaped
 * too, so a drawn `[a]: b` is not re-read as a link definition that draws nothing.
 */
function asSource({ text }: { text: string }): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\[/g, "&#91;");
}

/**
 * Whether a drawn row could name Problem, read off its cells' spelled signs (`./renderedTables.ts`): a cell before its
 * last carrying the word, as the Problem checks read one; ANY cell carrying it in a row alone in its cell or one that
 * may be drawn right to left, whose label a reader can take from its last cell (fallback review r21); or any cell that
 * names it in a word, since a reader takes a lone `Problem` cell, a bold one stacked over its text or one behind a
 * ticket key as the label it is (fallback reviews r3, r22–r25, round 11 fuzz). It is GENEROUS on purpose, because the
 * two errors are not alike: reading one too many as Problem only judges one more table, while missing one skips a
 * table a reader sees, as a `<time>`- or `<bdo>`-wrapped Problem label did (fallback review r19). The cost is paid in
 * refusals: any cell that merely mentions a problem, or an identifier such as `probe-1` whose mark stands in for a
 * letter, makes its
 * table one that must lead with Risk and Blast radius (fallback review r20).
 */
function isProblemRow({ signs, turned }: { signs: readonly ProblemSigns[]; turned: boolean }): boolean {
  const searched = turned || signs.length === 1 ? signs : signs.slice(0, -1);
  return searched.some((cell) => cell.carries) || signs.some((cell) => cell.names);
}

/**
 * Whether a row reads as Problem ONLY off its value: drawn left to right, a label and a value with nothing else drawn
 * after them, and no sign in the label. A `title` on the label, a third cell that draws anything (`Risk | Low. |
 * <th>Problem</th>`) or a turned row is read anywhere, so none of them is this; a blank spare column
 * is not a cell a reader reads.
 */
function readInValueOnly({
  cells,
  signs,
  turned,
}: {
  cells: readonly string[];
  signs: readonly ProblemSigns[];
  turned: boolean;
}): boolean {
  const labelSilent = signs.length > 1 && !signs[0]!.carries && !signs[0]!.names;
  const restBlank = signs.slice(2).every((cell, index) => cells[index + 2] === "" && !cell.carries && !cell.names);
  return !turned && labelSilent && restBlank;
}

/**
 * Where a table's lead rows end, one entry per DISTINCT prefix, from its rows read as Problem. A row of the exact
 * {@link REQUIRED_LEAD_LABELS} pair read as Problem ONLY off its value is dropped when the same table has a Problem row
 * below that pair: a Risk cell saying "draws no problem row" made the Risk row itself a Problem row and refused the pair
 * above none. The table is still judged on the Problem row below the pair. A lead row
 * read as Problem anywhere else, or with no Problem row under the pair, keeps it, so a lone `Risk | **Problem**<br>text`,
 * a `title` on the label or a `<th>Problem</th>` beside it still makes its table one that must carry the pair. The residue, stated: in a table that already draws Risk, Blast radius, then Problem, a
 * Problem label written INSIDE a lead value reads as that value, since no spelling tells it from the word.
 */
function leadPrefixEnds({
  labels,
  problemAt,
  valueOnlyAt,
}: {
  labels: readonly string[];
  problemAt: readonly number[];
  valueOnlyAt: ReadonlySet<number>;
}): ReadonlySet<number> {
  const { length } = REQUIRED_LEAD_LABELS;
  const pairDrawn = REQUIRED_LEAD_LABELS.every((label, index) => labels[index] === label);
  const dropping = pairDrawn && problemAt.some((index) => index >= length);
  const kept = problemAt.filter((index) => !(dropping && index < length && valueOnlyAt.has(index)));
  return new Set(kept.map((index) => Math.min(index, length)));
}

/**
 * The lead rows above every drawn Problem row, each read in its own table: the rows above it that show anything,
 * as label and text. A row every cell of which is blank, like the empty header a label/value markdown table opens
 * with, is not a lead row. The rule reads only a prefix as long as {@link REQUIRED_LEAD_LABELS}, so a table yields
 * one set per DISTINCT prefix, never one per Problem row: a table of thousands of Problem rows was quadratic
 * (fallback review r12, 4 s at 65,536 characters; repro: time this on `| **Problem** | a |` repeated to that length).
 */
function drawnLeadRowSets({ body }: { body: string }): readonly (readonly LeadRowText[])[] {
  return renderedTables({ body }).flatMap((table) => {
    const kept = table.rows.flatMap((cells, index) =>
      cells.some((cell) => cell !== "") ? [{ cells, signs: table.signs[index]!, turned: table.turned[index]! }] : [],
    );
    const shown = kept.map((row) => row.cells);
    const problemAt = kept.flatMap((row, index) => (isProblemRow(row) ? [index] : []));
    const valueOnlyAt = new Set(kept.flatMap((row, index) => (readInValueOnly(row) ? [index] : [])));
    const prefixes = leadPrefixEnds({ labels: shown.map(([label = ""]) => label), problemAt, valueOnlyAt });
    // A label is its drawn text EXACTLY, nothing stripped: a star still in it is one a reader sees (emphasis is already
    // parsed), and an image or an unlisted tag stays a `DRAWN_OBJECT`, so `<time>No </time>Risk` is not Risk
    // (fallback reviews r12, r13, r17 — each stripping rule accepted a label a reader reads otherwise).
    return [...prefixes].map((end) =>
      shown.slice(0, end).map(([label = "", text = ""]) => ({ label, text: asSource({ text }) })),
    );
  });
}

/**
 * The lead-row refusal for a whole body: the rows ABOVE Problem, in each table the body DRAWS with a Problem row.
 *
 * Judged on a rendering, never on the source, so a `Risk` in prose, in the Next table, in code or in a comment never
 * counts. EVERY drawn table holding a Problem row is judged, so an example table must carry the pair too, and so must
 * any second table labelling a row Problem (a `Problem (before)` screenshot table is refused: label it `Before`). One
 * tripwire stands beside it, because `./checkCore.ts` reads its Problem cell off the SOURCE: a body whose Problem cell
 * that reader finds, but which draws no Problem row at all — the row in code, in a comment, or on a piped line no
 * table draws — is refused, so no lead can be skipped by hiding the one Problem the other checks judge. A body with no
 * Problem row either way returns undefined: that is already its own error, and naming a missing lead on top would be
 * two errors for one defect.
 *
 * @param body the pull-request description, any line endings
 * @param sourceProblem whether `./checkCore.ts`'s source reader found a Problem cell, which it judges already
 * @returns the refusal text, or undefined
 */
export function prBodyLeadRowsError({
  body: raw,
  sourceProblem,
}: {
  body: string;
  sourceProblem: boolean;
}): string | undefined {
  const body = raw.replace(/\r\n?/g, "\n");
  const sets = drawnLeadRowSets({ body });
  if (sourceProblem && sets.length === 0) {
    return requiredLeadRowsError({ rows: [] });
  }
  return sets.map((rows) => requiredLeadRowsError({ rows })).find((error) => error !== undefined);
}
