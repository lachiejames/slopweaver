/**
 * One call's tool lines as a page — what `slopweaver talk call-tools` prints. Every tool line
 * carries what the model was handed, secrets masked, up to 24 KiB each, so a call's answers can run to
 * megabytes: that is why they are read here, a bounded page at a time, and never through `talk calls`. The lines are
 * folded once exactly as the call record folds them (`./callToolLine.ts`'s `foldTool`), so an index here is the row's
 * place among the call's own deduped tool lines. Pure.
 */
import type { CallEntry } from "./callRecord.js";
import { type CallToolNote, foldTool, type ReopenReminderMeasurement } from "./callToolLine.js";

/** How many tool rows a page holds when no `--limit` is given. */
export const CALL_TOOLS_LIMIT_DEFAULT = 10;

/** The most tool rows one page may hold: with each answer capped at 24 KiB, one page stays near a megabyte at worst. */
export const CALL_TOOLS_LIMIT_MAX = 50;

/** One tool row of a call, where it stands among the call's tool lines. */
interface CallToolRow {
  /** Zero-based place among the call's deduped tool lines, oldest first. */
  readonly index: number;
  readonly atIso: string;
  readonly name: string;
  readonly detail: string;
  readonly refused: boolean;
  /** The link a read was called with; `null` when too long to carry; absent when it took none. */
  readonly opened: string | null | undefined;
  /**
   * What the model was handed, secrets masked; `null` when none was kept — no model was handed it, the line predates
   * it, or masking grew it past the cap.
   */
  readonly answer: string | null;
  /** A reopened call's opening-window step; absent on every other tool line. */
  readonly reopenReminder?: ReopenReminderMeasurement;
}

/** One page of a call's tool rows. */
export interface CallToolsPage {
  readonly callId: string;
  readonly from: number;
  /** Where the next page starts, or `null` when this page reached the last row. */
  readonly nextFrom: number | null;
  /** How many tool rows the call holds in all. */
  readonly total: number;
  readonly tools: readonly CallToolRow[];
}

/**
 * The row one folded tool line reads as.
 *
 * @returns the row
 */
function rowOf({ note, index }: { note: CallToolNote; index: number }): CallToolRow {
  let answer: string | null = null;
  if (note.answer !== undefined) {
    answer = note.answer;
  }
  const { atIso, detail, name, opened, refused, reopenReminder } = note;
  const reminder = reopenReminder === undefined ? {} : { reopenReminder };
  return { answer, atIso, detail, index, name, opened, refused, ...reminder };
}

/**
 * One page of a call's tool rows: its tool lines folded once each, oldest first, then `limit` of them from `from`.
 *
 * @param callId the call the lines are from
 * @param entries the call file's lines that parsed, in file order
 * @param from the first row's index; past the last row it is an empty page
 * @param limit how many rows at most, already bounded by the caller
 * @returns the page
 */
export function callToolsPage({
  callId,
  entries,
  from,
  limit,
}: {
  callId: string;
  entries: readonly CallEntry[];
  from: number;
  limit: number;
}): CallToolsPage {
  const notes: CallToolNote[] = [];
  for (const entry of entries) {
    if (entry.kind === "tool") {
      foldTool({ entry, notes });
    }
  }
  const tools = notes.slice(from, from + limit).map((note, offset) => rowOf({ index: from + offset, note }));
  let nextFrom: number | null = null;
  if (from + limit < notes.length) {
    nextFrom = from + limit;
  }
  return { callId, from, nextFrom, tools, total: notes.length };
}
