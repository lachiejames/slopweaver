/**
 * Which recorded asks are really waiting on the owner's word, in what order, and what the rest are waiting on.
 *
 * ## Why this is a module and not four lines in the page
 *
 * Measured with `slopweaver handover list --json` over 2,690 board rows: 42 carried an open
 * recorded question and the queue rendered every one of them as parked on the owner. Seven carried a register
 * ruling decided at or after the question, four carried a settlement, ten read `paused`. The owner owed 21
 * answers and four separate console surfaces each said 42, because each had spelled the same
 * predicate for itself as `row.question !== undefined`.
 *
 * The VERDICT is not computed here. `src/handover/ownerWait.ts` derives it once and `handover list --json`
 * publishes it per row as `ownerWait`, so this module reads a field rather than re-deriving a rule the
 * board already knows. What is here is what the PAGE decides: which rows it lists, in what order, what age
 * it is allowed to print, and how the excluded ones are described.
 *
 * ## Its one import is the owner's verdict test
 *
 * Whether a row's `ownerWait` is the owner's is read through `waitsOnOwner`, beside the console's closed list of
 * verdicts, so the page and the board agree on which rows wait on the owner. No `src/` test
 * imports this module, so the root program never resolves it. The input types stay STRUCTURAL: the caller passes a
 * `BoardRow` from `site/components/live/read.ts` straight in.
 */

import { waitsOnOwner } from "../components/live/readBoardWaits";

/** What this module needs off a board row — structurally satisfied by `read.ts`'s `BoardRow`. */
export interface AskRow {
  readonly slug: string;
  readonly reason: string;
  /** A read's own reason a detached ask carries beside its sentence (`./detachedAskRow.ts`), searched like it. */
  readonly reasonWhy?: string;
  readonly status: string;
  readonly question: string | undefined;
  readonly ownerWait: string;
  readonly questionAskedIso: string | undefined;
  readonly ruledSinceQuestionIso: string | undefined;
}

/**
 * A field the record may not carry, with the absence said out loud rather than coalesced away.
 *
 * @param absent the word shown in the value's place
 * @returns the value, or that word
 */
function said({ value, absent }: { value: string | undefined; absent: string }): string {
  if (value === undefined) {
    return absent;
  }
  return value;
}

/**
 * The text one ask row carries — what `./cardReferences.ts` searches for a bare number. It never places the row:
 * a board row's workspace is its fields', `./registerPlacement.ts`'s `boardRowPlacement`.
 *
 * @param row the board row
 * @returns the hint text
 */
export function askHint({ row }: { row: AskRow }): string {
  const hint = `${row.slug} ${said({ absent: "", value: row.question })} ${row.reason}`;
  if (row.reasonWhy === undefined) {
    return hint;
  }
  return `${hint} ${row.reasonWhy}`;
}

/**
 * The instant an ask row shows an age from — only ever on a row that is really the owner's.
 *
 * A paused row gets NONE, deliberately. `src/handover/paused.ts` carries the rule in full, no time limit and no
 * deadline, and a day-count beside a row paused on another person reads as a countdown, which the rule rules
 * out. Nor is there an age worth printing on a settled row or one the owner has already answered: the row's own
 * line already says what it is.
 *
 * @param row the board row
 * @returns the asked instant, or `undefined`
 */
export function askWhenIso({ row }: { row: AskRow }): string | undefined {
  if (!waitsOnOwner({ ownerWait: row.ownerWait })) {
    return undefined;
  }
  return row.questionAskedIso;
}

/**
 * One row's place in asked order: earlier is smaller, and an unreadable or absent instant sorts LAST.
 *
 * Last rather than first, because `Date.parse` answers `NaN` for a hand-edited journal line and a `NaN`
 * comparison is false against everything — a row with no readable instant claiming the top of the list is
 * the one outcome this ordering must not produce.
 *
 * @param row the board row
 * @returns milliseconds since the epoch, or `Infinity`
 */
export function askedOrder({ row }: { row: AskRow }): number {
  if (row.questionAskedIso === undefined) {
    return Number.POSITIVE_INFINITY;
  }
  const parsed = Date.parse(row.questionAskedIso);
  if (Number.isNaN(parsed)) {
    return Number.POSITIVE_INFINITY;
  }
  return parsed;
}

/**
 * The board rows that are really the owner's, longest-waiting first.
 *
 * Both halves matter. The FILTER is the whole ask: a settled, already-ruled or paused row must not read as
 * waiting on the owner's word. The ORDER is what makes the filter useful — the queue shows only the first rows of
 * a register, so board order alone would fill those slots alphabetically while a 22-day-old question sat
 * below the fold. Ties and rows with no readable instant keep the board's own order, which is stable.
 *
 * Generic in the row type so a caller keeps its own: `rowsOf` reads `summary` off what comes back, and a
 * helper that quietly widened every row to {@link AskRow} would cost the page fields it still needs.
 *
 * @param rows the board's rows, in board order
 * @returns the owner's rows alone, oldest question first
 */
export function ownerAsksOf<T extends AskRow>({ rows }: { rows: readonly T[] }): readonly T[] {
  const owners = rows.filter((row) => waitsOnOwner({ ownerWait: row.ownerWait }) && row.question !== undefined);
  return owners.toSorted((left, right) => askedOrder({ row: left }) - askedOrder({ row: right }));
}

/**
 * One sentence saying what an ask row is really waiting on, for the panel that prints the board row.
 *
 * The card has one word and this has the rest of it: which register decided a row was settled, and when the
 * owner ruled on one already ruled on, so "why is this not on my list" is answerable without opening the
 * doc. Every value here is derived by `src/handover/ownerWait.ts` and published on the board row — this
 * function chooses only the wording.
 *
 * @param row the board row
 * @returns the sentence
 */
export function waitWord({ row }: { row: AskRow }): string {
  if (row.ownerWait === "already-ruled") {
    return `nobody: you ruled at ${said({ absent: "an unrecorded instant", value: row.ruledSinceQuestionIso })}; it waits on a session to execute that`;
  }
  if (row.ownerWait === "settled") {
    return `nobody: the row reads ${row.status}, and the question was never cleared off its journal`;
  }
  if (row.ownerWait === "not-runnable") {
    return "nobody right now: the row is paused, so it is not runnable either";
  }
  if (row.ownerWait === "not-waiting") {
    return "nobody: no question is open on this row";
  }
  return "you";
}
