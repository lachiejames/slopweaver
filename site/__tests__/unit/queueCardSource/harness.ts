/*
 * The board rows, quotes and readers the queue-card source test files share. Each builds a row the way the real
 * readers would hold it from `handover list --json`, so no case hand-builds a card. They moved here when
 * `queueCardSource.test.ts` was split by the card kind under test.
 */
import { expect } from "vitest";

import { type Board, readBoard } from "../../../components/live/read";
import type { LiveState } from "../../../components/live/useLive";
import { boardRowSource, type CardSource } from "../../../lib/queueCardSource";
import { type QueueRow, rowsOf } from "../../../lib/queueRows";
import { ACME_PLACER } from "../../organisationFixture";

/** A live read still in flight, for every source a case does not set. */
export const LOADING = { phase: "loading" } as const;
/** A console-voice anchor naming the owner's words. */
export const TALK = "talk:a0000015-0000-4000-8000-000000000016";
/** The owner's words as the board stores them on a row, anchored at {@link TALK}. */
export const QUOTE = {
  anchor: TALK,
  cut: "none",
  atIso: "2026-09-28T06:03:54.584Z",
  where: "console-voice",
  words: "put the line I actually said near the top of the opened card, so I can tell where the card came from",
} as const;
/** A console-call anchor, one turn of a recorded call. */
export const CALL = "talk-call:the-call#the-turn";
/** Why a row the live board no longer holds is not read — the same sentence whichever slug a card names. */
export const ARCHIVED =
  "the live board no longer holds the row this card names, most likely settled and archived, so the words behind it are not read here";
/** What {@link ask}'s row is about, as its source carries it for the quote's folded lead: its question, then its slug. */
export const SUBJECT = "Which lands first? the ask";
/** A session id, as the chair posts a hand step `--by-session`. */
export const CHAIR = "fb317379-62a6-415b-89c8-a382205294f9";
/** The refusal a card born of the owner's words carries when its board row stores no quote. */
export const MISSING =
  "This card came from your words to the console voice, but they are not on it: no quote is stored on its board row " +
  "yet. `slopweaver handover quote --apply` writes them.";

/**
 * A live read that has landed.
 *
 * @returns the value, stamped as read at one fixed instant
 */
export function ready<T>({ value }: { value: T }): LiveState<T> {
  return {
    fixture: undefined,
    observedAtIso: "2026-09-28T07:00:00.000Z",
    phase: "ready",
    stampedByRoute: false,
    value,
  };
}

/**
 * One ask as the board publishes it, waiting on the owner, slugged `the-ask` unless a test sets another.
 *
 * @param fields each board field a test sets, over the waiting ask's own
 * @returns the raw board row
 */
export function ask({ fields }: { fields: Record<string, unknown> }): Record<string, unknown> {
  return {
    kind: "ask",
    ownerWait: "owner",
    question: "Which lands first?",
    questionAskedIso: "2026-09-28T06:10:00.000Z",
    reason: "waiting on the owner",
    section: "runnable",
    slug: "the-ask",
    status: "waiting-on-owner",
    ...fields,
  };
}

/**
 * Raw rows through the real board reader.
 *
 * @returns the board the page would hold
 */
export function boardOf({ rows }: { rows: readonly unknown[] }): Board {
  return readBoard({ rows, unresolved: 0 })!;
}

/**
 * The source of one ask row carrying the given fields.
 *
 * @returns the row's card source
 */
export function sourceOf({ fields }: { fields: Record<string, unknown> }): CardSource {
  const [row] = boardOf({ rows: [ask({ fields })] }).rows;
  return boardRowSource({ row: row });
}

/**
 * The one queue row an ask carrying the given fields becomes, every other register still loading.
 *
 * @returns the queue row
 */
export function askRowOf({ fields }: { fields: Record<string, unknown> }): QueueRow {
  const rows = rowsOf({
    reviewers: LOADING,
    standing: LOADING,
    acts: LOADING,
    board: ready({ value: boardOf({ rows: [ask({ fields })] }) }),
    drafts: LOADING,
    hands: LOADING,
    landing: LOADING,
    placer: ACME_PLACER,
    posts: LOADING,
    reviews: LOADING,
    imports: LOADING,
  });
  expect(rows.length).toBe(1);
  return rows[0];
}
