/**
 * The two edits a supervisor makes to its state doc every seat — the pure core behind
 * `slopweaver supervisor state-amend` and `slopweaver supervisor state-archive`. The third, the mid-shift
 * `state-fold`, lives in `./stateDocFold.ts`; all three share the locator, judge and refusals in
 * `./stateDocBlock.ts`. Where an archive's note goes in the preamble is `./stateDocArchiveNote.ts`.
 *
 * ## Why these are verbs
 *
 * Anything done with Python is done in TypeScript inside Slopweaver, typed, tested, linted and exposed through
 * the CLI. Until this module every supervisor seat carried two scratch
 * scripts — one appending rows to its own boot block, one moving its predecessor's block into the archive —
 * copied forward and renamed by hand each seat. Reproduce the count of copies:
 * `find ~/.slopweaver/supervisor-scratch -name 'amend*.py' -o -name 'archive*.py' | wc -l`.
 *
 * ## The heading these edits locate, and why it is not the one `stateDoc.ts` parses
 *
 * A boot block is headed `## handoff-<n> boot`, which is what the live doc has used since its early chairs
 * (reproduce: `grep -lE '^## handoff-[0-9]+ boot' ~/.slopweaver/handovers/archive/*`). `parseStateDoc`
 * still looks for `## SUCCESSOR BOOT BLOCK`, so it finds no block in the live doc and `state-check` judges only
 * the whole-doc cap. These edits address the heading that is really there and enforce both caps themselves —
 * with the same semantics `state-check` uses, so a successful edit never produces a doc it would call over a
 * cap. Why the parser is not changed alongside: `skills/supervisor/reference/state-doc.md`.
 *
 * Pure: no I/O and no clock. The CLI edge reads the doc, calls one function here, and writes what it returns.
 */
import { err, ok, type Result } from "#lib/result.js";

import { chainArchiveNote } from "./stateDocArchiveNote.js";
import {
  bootHeadingPrefix,
  judgeFinished,
  locateTailBlock,
  opensBlock,
  PRIOR_BOOT_HEADING,
  popTrailingBlank,
  RULINGS_LINE_PREFIX,
  type StateDocEditError,
  StateDocEditErrors,
  singleLine,
  wcLines,
} from "./stateDocBlock.js";

/**
 * Validate the rows an amend was given and give each the `- ` a row opens with.
 *
 * @param rows the rows as typed
 * @returns the shaped rows, or the refusal naming the first bad one
 */
function shapeRows({ rows }: { rows: readonly string[] }): Result<readonly string[], StateDocEditError> {
  if (rows.length === 0) {
    return err(StateDocEditErrors.inputRejected({ reason: "no rows were given — pass at least one --row" }));
  }
  const shaped: string[] = [];
  for (const row of rows) {
    if (/[\r\n]/.test(row)) {
      return err(StateDocEditErrors.inputRejected({ reason: `a row carries a line break: "${row.slice(0, 80)}"` }));
    }
    const body = row.startsWith("- ") ? row.slice(2) : row;
    if (body.trim().length === 0) {
      return err(StateDocEditErrors.inputRejected({ reason: "a row is empty" }));
    }
    shaped.push(`- ${body}`);
  }
  return ok(shaped);
}

/** What an amend produced. */
export interface AmendedStateDoc {
  /** The whole doc, ready to write. */
  readonly text: string;
  readonly docLines: number;
  readonly blockLines: number;
  /** How many rows went in. */
  readonly rows: number;
}

/**
 * Append rows to a seat's own boot block: before its `### RULINGS` line, or — with `afterRulings` — at the end
 * of the block, under its rulings.
 *
 * @param text the state doc's whole text
 * @param handoff the seat whose block is amended
 * @param rows the rows, in order; one line each, `- ` added when absent
 * @param afterRulings append at the end of the block instead of before its rulings
 * @returns the amended doc and its measurements, or the refusal
 */
export function amendBootBlock({
  text,
  handoff,
  rows,
  afterRulings,
}: {
  text: string;
  handoff: string;
  rows: readonly string[];
  afterRulings: boolean;
}): Result<AmendedStateDoc, StateDocEditError> {
  const shaped = shapeRows({ rows });
  if (shaped.isErr()) {
    return err(shaped.error);
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
  if (afterRulings && lines.slice(rulings + 1).some((line) => line.startsWith("#"))) {
    return err(
      StateDocEditErrors.inputRejected({
        reason: `a heading follows "${RULINGS_LINE_PREFIX}", so the end of the block is not under the rulings`,
      }),
    );
  }
  if (afterRulings) {
    popTrailingBlank({ lines });
    lines.push(...shaped.value);
  } else {
    lines.splice(rulings, 0, ...shaped.value);
  }
  const amended = `${lines.join("\n").replace(/\n+$/, "")}\n`;
  const judged = judgeFinished({ blockStart: start, text: amended });
  if (judged.isErr()) {
    return err(judged.error);
  }
  return ok({ ...judged.value, rows: shaped.value.length, text: amended });
}

/**
 * Require a successor block to open with its own heading, carry a rulings line, and hold no blank line and no
 * second top-level heading.
 *
 * @param successor the successor's handoff number
 * @param successorBlock the block as read from its file
 * @returns the block with exactly one trailing newline, or the refusal
 */
function checkSuccessorBlock({
  successor,
  successorBlock,
}: {
  successor: string;
  successorBlock: string;
}): Result<string, StateDocEditError> {
  const body = successorBlock.replace(/\r\n/g, "\n").replace(/\n+$/, "");
  const lines = body.split("\n");
  const prefix = bootHeadingPrefix({ handoff: successor });
  const problems: readonly (readonly [boolean, string])[] = [
    [!opensBlock({ line: lines[0]!, prefix }), `the block file must open with "${prefix}"`],
    [lines.some((line) => line.trim().length === 0), "the block file carries a blank line"],
    [lines.slice(1).some((line) => line.startsWith("## ")), "the block file carries a second top-level heading"],
    [
      !lines.some((line) => line.startsWith(RULINGS_LINE_PREFIX)),
      `the block file has no "${RULINGS_LINE_PREFIX}" line`,
    ],
  ];
  const first = problems.find(([failed]) => failed);
  if (first !== undefined) {
    return err(StateDocEditErrors.inputRejected({ reason: first[1] }));
  }
  return ok(`${body}\n`);
}

/** What an archive pass produced: two files to write, the archive first. */
export interface ArchivedStateDoc {
  /** The new archive file's whole text. */
  readonly archiveText: string;
  /** The state doc's whole text after the move. */
  readonly docText: string;
  /** The 1-based first and last line the moved block occupied, trailing blank lines excluded. */
  readonly movedFrom: { readonly first: number; readonly last: number };
  readonly docLines: number;
  readonly blockLines: number;
}

/**
 * Move a predecessor's boot block out of the state doc into an archive text, note where it went, and put the
 * successor's own block at the tail.
 *
 * The note goes straight after the predecessor's own archive note — the one sentence reading
 * `(archived by handoff-<predecessor>). Nothing was deleted.` — which is how every note in the preamble is
 * chained, so everything after it (the restore history) is preserved. On a doc no seat has archived yet, the
 * note seeds the chain as the preamble's last paragraph instead. The moved block goes to the archive
 * verbatim, minus trailing blank lines. Nothing is deleted.
 *
 * @param text the state doc's whole text
 * @param predecessor the handoff number whose block is archived
 * @param successor the handoff number of the seat archiving it, whose block goes in
 * @param successorBlock the successor's boot block, heading first
 * @param description the one-line account of the archived shift, written into the archive title and the note
 * @param archiveDisplayPath how the note names the archive file (`~/…/archive/<name>`)
 * @param docName the state doc's file name, for the archive title
 * @param when a free-text instant for the archive title (`<day> <month> 05:4x local`), or `undefined` to omit it
 * @returns the two texts and their measurements, or the refusal
 */
export function archiveBootBlock({
  text,
  predecessor,
  successor,
  successorBlock,
  description,
  archiveDisplayPath,
  docName,
  when,
}: {
  text: string;
  predecessor: string;
  successor: string;
  successorBlock: string;
  description: string;
  archiveDisplayPath: string;
  docName: string;
  when: string | undefined;
}): Result<ArchivedStateDoc, StateDocEditError> {
  const inputs = checkArchiveInputs({
    archiveDisplayPath,
    description,
    docName,
    predecessor,
    successor,
    successorBlock,
    when,
  });
  if (inputs.isErr()) {
    return err(inputs.error);
  }
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const located = locateTailBlock({ handoff: predecessor, lines });
  if (located.isErr()) {
    return err(located.error);
  }
  const { moved, movedFrom, preamble } = splitAtBlock({ lines, start: located.value });
  const chained = chainArchiveNote({
    archiveDisplayPath,
    description,
    movedFrom,
    preamble,
    predecessor,
    successor,
  });
  if (chained.isErr()) {
    return err(chained.error);
  }
  const docText = `${chained.value}${inputs.value}`;
  const judged = judgeArchivedDoc({ docText, head: chained.value, predecessor, successor });
  if (judged.isErr()) {
    return err(judged.error);
  }
  const archiveText = renderArchiveText({ description, docName, moved, successor, when });
  return ok({ ...judged.value, archiveText, docText, movedFrom });
}

/**
 * Split a doc at a block's heading: the block's own lines, where they sat, and the preamble above them, each
 * with trailing blank lines dropped.
 *
 * @param lines the doc's lines
 * @param start the 0-based line the block's heading sits on
 * @returns the moved block, its 1-based line range, and the preamble
 */
function splitAtBlock({ lines, start }: { lines: readonly string[]; start: number }): {
  readonly moved: readonly string[];
  readonly movedFrom: { readonly first: number; readonly last: number };
  readonly preamble: string;
} {
  const moved = lines.slice(start);
  popTrailingBlank({ lines: moved });
  const kept = lines.slice(0, start);
  popTrailingBlank({ lines: kept });
  return { moved, movedFrom: { first: start + 1, last: start + moved.length }, preamble: kept.join("\n") };
}

/**
 * Render the archive file: a title naming where the block came from and what the shift was, then the block.
 *
 * @param docName the state doc's file name
 * @param successor the archiving seat's handoff number
 * @param when the free-text instant, or `undefined` to omit it
 * @param description the one-line account of the archived shift
 * @param moved the block's own lines, verbatim
 * @returns the archive file's whole text
 */
function renderArchiveText({
  docName,
  successor,
  when,
  description,
  moved,
}: {
  docName: string;
  successor: string;
  when: string | undefined;
  description: string;
  moved: readonly string[];
}): string {
  const whenClause = when === undefined ? "" : ` (${when})`;
  return (
    `# Archived from ${docName} by handoff-${successor} at boot${whenClause}: ${description}. Nothing was deleted.\n\n` +
    `${moved.join("\n")}\n`
  );
}

/**
 * Validate everything an archive pass was handed before it reads the doc.
 *
 * @param predecessor the archived seat's handoff number
 * @param successor the archiving seat's handoff number
 * @param successorBlock the successor's block text
 * @param description the one-line account
 * @param archiveDisplayPath the path the note will name inside backticks
 * @param docName the file name the archive title will carry
 * @param when the optional instant
 * @returns the successor block, normalised, or the refusal
 */
function checkArchiveInputs({
  predecessor,
  successor,
  successorBlock,
  description,
  archiveDisplayPath,
  docName,
  when,
}: {
  predecessor: string;
  successor: string;
  successorBlock: string;
  description: string;
  archiveDisplayPath: string;
  docName: string;
  when: string | undefined;
}): Result<string, StateDocEditError> {
  if (predecessor === successor) {
    return err(StateDocEditErrors.inputRejected({ reason: "--predecessor and --successor name the same seat" }));
  }
  const descriptionOk = singleLine({ flag: "--description", value: description });
  if (descriptionOk.isErr()) {
    return err(descriptionOk.error);
  }
  const pathOk = singleLine({ flag: "the archive path", value: archiveDisplayPath });
  if (pathOk.isErr()) {
    return err(pathOk.error);
  }
  const nameOk = singleLine({ flag: "the doc's file name", value: docName });
  if (nameOk.isErr()) {
    return err(nameOk.error);
  }
  if (when !== undefined) {
    const whenOk = singleLine({ flag: "--when", value: when });
    if (whenOk.isErr()) {
      return err(whenOk.error);
    }
  }
  return checkSuccessorBlock({ successor, successorBlock });
}

/**
 * Judge the finished doc: exactly one successor heading, no predecessor heading, no prior-format heading,
 * and both caps met — the whole verdict an archive pass needs before anything is written.
 *
 * @param docText the doc as it would be written
 * @param head the preamble plus its blank line, which is what puts the successor's block on its own line
 * @param predecessor the archived seat's handoff number
 * @param successor the archiving seat's handoff number
 * @returns the finished doc's measurements, or the refusal
 */
function judgeArchivedDoc({
  docText,
  head,
  predecessor,
  successor,
}: {
  docText: string;
  head: string;
  predecessor: string;
  successor: string;
}): Result<{ readonly docLines: number; readonly blockLines: number }, StateDocEditError> {
  const lines = docText.split("\n");
  const count = ({ handoff }: { handoff: string }): number =>
    lines.filter((line) => opensBlock({ line, prefix: bootHeadingPrefix({ handoff }) })).length;
  if (count({ handoff: successor }) !== 1 || count({ handoff: predecessor }) !== 0) {
    return err(
      StateDocEditErrors.inputRejected({
        reason: `the finished doc would carry ${String(count({ handoff: successor }))} handoff-${successor} and ${String(count({ handoff: predecessor }))} handoff-${predecessor} boot headings — exactly one and none are required`,
      }),
    );
  }
  if (lines.some((line) => line.startsWith(PRIOR_BOOT_HEADING))) {
    return err(StateDocEditErrors.inputRejected({ reason: `the finished doc would carry a "${PRIOR_BOOT_HEADING}"` }));
  }
  return judgeFinished({ blockStart: wcLines({ text: head }), text: docText });
}
