/**
 * The third state-doc edit, and the only one a seat runs MID-SHIFT: the pure core behind
 * `slopweaver supervisor state-fold`.
 *
 * ## Why it exists
 *
 * `state-amend` refuses every row once the current boot block reaches its line cap, and `state-archive` only
 * moves a block at hand-off, when a successor's block replaces it. So a long chair hit the cap and could not
 * record anything for the rest of its shift — a gap a keep export restores as a board row. A fold
 * moves the block's OLDEST shift rows, verbatim, into an archive file and leaves one note row in their place,
 * so the block shrinks without the seat handing off and nothing is deleted.
 *
 * ## What a shift row is
 *
 * A line opening `- ` between the block's heading and its `### RULINGS` line — exactly where `state-amend`
 * puts a row by default — plus any indented line directly under it, which is that row's continuation. Every
 * other line stays where it is: a `###` sub-heading, prose, and the rulings with everything under them, which
 * a successor boots from and `state-check` refuses a block without. An earlier fold's own note row is a shift
 * row like any other, so a second fold carries it into the new archive and the chain of archives stays
 * walkable from the block.
 *
 * Like `state-amend`, the finished doc is canonicalised: CRLF becomes LF and the file ends in exactly one
 * newline, since `judgeFinished` counts lines on that shape. That is the only change to a kept line's bytes, and
 * it carries no content.
 *
 * Pure: no I/O and no clock. The CLI edge reads the doc, calls {@link foldBootBlock}, and publishes what it
 * returns through the same protocol `state-archive` uses.
 */
import { err, ok, type Result } from "#lib/result.js";

import {
  judgeFinished,
  locateTailBlock,
  RULINGS_LINE_PREFIX,
  type StateDocEditError,
  StateDocEditErrors,
  singleLine,
} from "./stateDocBlock.js";

/** One shift row: the 0-based lines it occupies, heading line first, continuation lines after. */
interface ShiftRow {
  readonly lines: readonly number[];
  /** The `###` sub-heading the row sits under, when one precedes it inside the block. */
  readonly section: string | undefined;
}

/** What a fold produced: two files to write, the archive first. */
export interface FoldedStateDoc {
  /** The new archive file's whole text. */
  readonly archiveText: string;
  /** The state doc's whole text after the fold. */
  readonly docText: string;
  /** How many shift rows went to the archive. */
  readonly folded: number;
  /** How many shift rows stayed in the block, the note row not counted. */
  readonly kept: number;
  readonly docLines: number;
  readonly blockLines: number;
}

/**
 * Collect the block's shift rows, in document order.
 *
 * @param lines the doc's lines
 * @param start the 0-based line the block's heading sits on
 * @param rulings the 0-based line its `### RULINGS` sits on
 * @returns every shift row between the two
 */
function shiftRows({
  lines,
  start,
  rulings,
}: {
  lines: readonly string[];
  start: number;
  rulings: number;
}): readonly ShiftRow[] {
  const rows: { lines: number[]; section: string | undefined }[] = [];
  let section: string | undefined;
  let open: { lines: number[]; section: string | undefined } | undefined;
  for (let index = start + 1; index < rulings; index += 1) {
    const line = lines[index]!;
    if (line.startsWith("- ")) {
      open = { lines: [index], section };
      rows.push(open);
    } else if (open !== undefined && /^\s+\S/.test(line)) {
      open.lines.push(index);
    } else {
      open = undefined;
      if (line.startsWith("### ")) {
        section = line;
      }
    }
  }
  return rows;
}

/**
 * Render the archive file: a title naming where the rows came from and what they covered, the block's heading
 * for context, then the rows verbatim — each under the sub-heading it sat beneath, written once per run.
 *
 * @param docName the state doc's file name
 * @param handoff the folding seat's handoff number
 * @param when the free-text instant, or `undefined` to omit it
 * @param description the one-line account of what the folded rows covered
 * @param heading the block's own heading line
 * @param rows the folded rows
 * @param lines the doc's lines, which the rows index
 * @returns the archive file's whole text
 */
function renderFoldArchive({
  docName,
  handoff,
  when,
  description,
  heading,
  rows,
  lines,
}: {
  docName: string;
  handoff: string;
  when: string | undefined;
  description: string;
  heading: string;
  rows: readonly ShiftRow[];
  lines: readonly string[];
}): string {
  const whenClause = when === undefined ? "" : ` (${when})`;
  const body: string[] = [heading];
  let section: string | undefined;
  for (const row of rows) {
    if (row.section !== undefined && row.section !== section) {
      body.push(row.section);
    }
    section = row.section;
    body.push(...row.lines.map((index) => lines[index]!));
  }
  return (
    `# Folded from ${docName}'s handoff-${handoff} block mid-shift${whenClause}: ${description}. Nothing was deleted.\n\n` +
    `${body.join("\n")}\n`
  );
}

/**
 * Validate every free-text field and the keep count before the doc is read.
 *
 * @param description the one-line account
 * @param archiveDisplayPath the path the note row names inside backticks
 * @param docName the file name the archive title carries
 * @param when the optional instant
 * @param keep how many of the newest rows stay
 * @returns nothing on success, or the refusal
 */
function checkFoldInputs({
  description,
  archiveDisplayPath,
  docName,
  when,
  keep,
}: {
  description: string;
  archiveDisplayPath: string;
  docName: string;
  when: string | undefined;
  keep: number;
}): Result<void, StateDocEditError> {
  if (!Number.isSafeInteger(keep) || keep < 0) {
    return err(
      StateDocEditErrors.inputRejected({ reason: `--keep must be a whole number of rows, not ${String(keep)}` }),
    );
  }
  const fields: readonly (readonly [string, string])[] = [
    ["--description", description],
    ["the archive path", archiveDisplayPath],
    ["the doc's file name", docName],
    ...(when === undefined ? [] : ([["--when", when]] as const)),
  ];
  for (const [flag, value] of fields) {
    const checked = singleLine({ flag, value });
    if (checked.isErr()) {
      return err(checked.error);
    }
  }
  return ok(undefined);
}

/**
 * Pick every shift row but the newest `keep`, and rewrite the doc with one note row where the first of them
 * sat and the rest gone.
 *
 * @param lines the doc's lines, LF-split
 * @param rows the block's shift rows, in document order
 * @param keep how many of the newest rows stay
 * @param description the one-line account the note carries
 * @param archiveDisplayPath how the note names the archive file
 * @param handoff the folding seat, named in the note
 * @returns the rows folded and the doc's new text, or the refusal when the fold would free no line
 */
function replaceOldestRows({
  lines,
  rows,
  keep,
  description,
  archiveDisplayPath,
  handoff,
}: {
  lines: readonly string[];
  rows: readonly ShiftRow[];
  keep: number;
  description: string;
  archiveDisplayPath: string;
  handoff: string;
}): Result<{ folding: readonly ShiftRow[]; docText: string }, StateDocEditError> {
  const folding = rows.slice(0, Math.max(0, rows.length - keep));
  const removed = folding.reduce((sum, row) => sum + row.lines.length, 0);
  // The note row takes one line back, so a fold removing fewer than two frees nothing and is refused rather
  // than published as an archive that bought no room.
  if (removed < 2) {
    return err(
      StateDocEditErrors.inputRejected({
        reason: `the block holds ${String(rows.length)} shift row(s) above ${RULINGS_LINE_PREFIX}; keeping ${String(keep)} folds ${String(removed)} line(s), which frees none — lower --keep`,
      }),
    );
  }
  const dropped = new Set(folding.flatMap((row) => row.lines));
  const noteAt = folding[0]!.lines[0]!;
  const note =
    `- FOLDED ${String(folding.length)} row(s) (${description}) to \`${archiveDisplayPath}\`` +
    ` (folded by handoff-${handoff}). Nothing was deleted.`;
  const kept = lines.flatMap((line, index) => {
    if (index === noteAt) {
      return [note];
    }
    return dropped.has(index) ? [] : [line];
  });
  return ok({ docText: `${kept.join("\n").replace(/\n+$/, "")}\n`, folding });
}

/**
 * Fold a seat's oldest shift rows out of its own boot block into an archive text, leaving one note row where
 * the first of them sat and the newest `keep` rows in place.
 *
 * @param text the state doc's whole text
 * @param handoff the seat whose block is folded — always the seat running the fold
 * @param keep how many of the newest shift rows stay in the block
 * @param description the one-line account of what the folded rows covered, written into the title and the note
 * @param archiveDisplayPath how the note names the archive file (`~/…/archive/<name>`)
 * @param docName the state doc's file name, for the archive title
 * @param when a free-text instant for the archive title, or `undefined` to omit it
 * @returns the two texts and their measurements, or the refusal
 */
export function foldBootBlock({
  text,
  handoff,
  keep,
  description,
  archiveDisplayPath,
  docName,
  when,
}: {
  text: string;
  handoff: string;
  keep: number;
  description: string;
  archiveDisplayPath: string;
  docName: string;
  when: string | undefined;
}): Result<FoldedStateDoc, StateDocEditError> {
  const inputs = checkFoldInputs({ archiveDisplayPath, description, docName, keep, when });
  if (inputs.isErr()) {
    return err(inputs.error);
  }
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const located = locateTailBlock({ handoff, lines });
  if (located.isErr()) {
    return err(located.error);
  }
  const start = located.value;
  const rulings = lines.findIndex((line, index) => index > start && line.startsWith(RULINGS_LINE_PREFIX));
  if (rulings === -1) {
    return err(StateDocEditErrors.rulingsNotFound({ heading: lines[start]! }));
  }
  const rows = shiftRows({ lines, rulings, start });
  const replaced = replaceOldestRows({ archiveDisplayPath, description, handoff, keep, lines, rows });
  if (replaced.isErr()) {
    return err(replaced.error);
  }
  const { docText, folding } = replaced.value;
  const judged = judgeFinished({ blockStart: start, text: docText });
  if (judged.isErr()) {
    return err(judged.error);
  }
  const archiveText = renderFoldArchive({
    description,
    docName,
    handoff,
    heading: lines[start]!,
    lines,
    rows: folding,
    when,
  });
  return ok({ ...judged.value, archiveText, docText, folded: folding.length, kept: rows.length - folding.length });
}
