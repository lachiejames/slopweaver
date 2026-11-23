/**
 * THE TURN JOURNAL — the durable record of one decision a turn makes about itself that nothing else keeps:
 * why its answer changed after a reviewer had already read it.
 *
 * The row exists because of one measured loss. A worker rewrote its answer after EVERY verdict —
 * five rounds, outcomes broken, broken, clean, clean, broken — so every round judged different bytes and the
 * two SENDABLE verdicts (rounds three and four) were each superseded by the next rewrite before anything
 * could be posted with one. The fifth round found the answer broken on the core deliverable and
 * the dispatch lease expired four minutes later, so a fully investigated answer was never posted at all.
 *
 * A line in whichever terminal validated the rewrite is not a record of that decision: the terminal is gone
 * by the time anyone asks why a turn's text moved. The row is appended here instead, keyed exactly like
 * `dispatchStore.ts` keys a dispatch record, so one ask's whole text history is one file to read.
 *
 * Deliberately NOT `progressLog.ts`, which is next door and keyed identically. That file answers "what did
 * the people in the thread see, and when" — every stage the worker declared and every card write that
 * reached Slack. This row never reaches Slack; it is the turn's decision about its own text, and folding it
 * into the reader-facing log would invite a reader to treat an edit reason as something the thread was told.
 *
 * Pure: rows in, text out. Reading and writing is `./turnJournalStore.ts`.
 */
import { z } from "zod";

import { isRecord } from "../../lib/parsers.js";

/** One edit to an answer a reviewer had already been given, and the reason its author stated for it. */
export interface AnswerEditedRow {
  readonly kind: "answer-edited";
  /** When the edit was validated. */
  readonly atIso: string;
  /** The digest the standing review record was bound to. */
  readonly fromDigest: string;
  /** The digest of the bytes that replaced them. */
  readonly toDigest: string;
  /** The author's own stated reason — `turn resume --edit-reason`. */
  readonly reason: string;
  /** Whether the edit discarded a verdict that could have been posted as it stood. */
  readonly discardedSendableVerdict: boolean;
}

/** Every row kind the journal carries — one today, a discriminated union so a second is a new member, not a rewrite. */
export type TurnJournalRow = AnswerEditedRow;

/** The strict parse-edge schema for one journal row. */
const turnJournalRowSchema = z.discriminatedUnion("kind", [
  z
    .object({
      atIso: z.string().min(1),
      discardedSendableVerdict: z.boolean(),
      fromDigest: z.string().min(1),
      kind: z.literal("answer-edited"),
      reason: z.string().min(1),
      toDigest: z.string().min(1),
    })
    .strict(),
]) satisfies z.ZodType<TurnJournalRow>;

/**
 * Parse ONE journal line, or `undefined` for anything that will not read.
 *
 * A malformed line in an append-only log written by more than one process is an ordinary thing to step over,
 * never a reason to refuse the whole history: the alternative is a turn losing its entire edit record
 * because one row was half-written. Blank lines answer `undefined` for the same reason.
 *
 * @param line one line of the file, newline already stripped
 * @returns the row, or `undefined` when the line is blank, unparseable, or of an unknown shape
 */
export function parseTurnJournalLine({ line }: { line: string }): TurnJournalRow | undefined {
  if (line.trim().length === 0) {
    return undefined;
  }
  let raw: unknown;
  try {
    raw = JSON.parse(line);
  } catch {
    return undefined;
  }
  if (!isRecord(raw)) {
    return undefined;
  }
  const parsed = turnJournalRowSchema.safeParse(raw);
  return parsed.success ? parsed.data : undefined;
}

/**
 * Parse a whole journal's text, skipping anything that will not read.
 *
 * The STORE does not use this — it streams the file line by line (`./turnJournalStore.ts`), because a
 * journal's size is a property of how long a turn ran rather than of anything in the code. This is the
 * whole-text form the pure tests drive, over text they wrote themselves.
 *
 * @param text the file's whole contents, or `""` for a journal that does not exist yet
 * @returns every row that parsed, in file order
 */
export function parseTurnJournal({ text }: { text: string }): readonly TurnJournalRow[] {
  const rows: TurnJournalRow[] = [];
  for (const line of text.split("\n")) {
    const row = parseTurnJournalLine({ line });
    if (row !== undefined) {
      rows.push(row);
    }
  }
  return rows;
}

/**
 * Render one row as the single JSONL line the journal appends.
 *
 * @param row the row to serialise
 * @returns the line, newline-terminated
 */
export function turnJournalLine({ row }: { row: TurnJournalRow }): string {
  return `${JSON.stringify(row)}\n`;
}

/**
 * Whether the bytes a review record binds to are still the bytes in hand, as far as the journal knows.
 *
 * A verdict binds to the record's digest, so "the verdict names the record's digest" is only half of usable:
 * the other half is that nobody has replaced those bytes since. Every edit that COULD make a sendable verdict
 * stale is journalled — `./answerFreeze.ts` demands a reason exactly when a sendable verdict or an open round
 * stands over the bytes, and `turn resume --edit-reason` writes the row — so the LAST row is the whole
 * answer: the bytes in hand are the ones it moved to. No row means nothing moved. An edit that moved the
 * answer back to the reviewed bytes counts as still in hand, because the door would accept it.
 *
 * It reads the last row rather than the last `answer-edited` row because every row this journal carries IS
 * one. A second row kind must revisit this, and {@link TurnJournalRow} being a union is where that shows up.
 *
 * Measured, replaying that incident over `leaseJudgement.ts` without this check: the sweep
 * held the clock open on "a clean verdict for this exact answer is already written — the answer is postable"
 * after the rewrite that made that verdict `ANSWER_VERDICT_STALE` at the door.
 *
 * @param rows a whole journal, in file order
 * @param reviewedDigest the digest the review record binds to
 * @returns whether a verdict bound to `reviewedDigest` is about the bytes now in hand
 */
export function reviewedBytesStillInHand({
  rows,
  reviewedDigest,
}: {
  rows: readonly TurnJournalRow[];
  reviewedDigest: string;
}): boolean {
  const last = rows.at(-1);
  return last === undefined || last.toDigest === reviewedDigest;
}
