/*
 * The registers `queueVoice.test.ts` builds its rows from, split out so the test file sits under the
 * test-file size cap: a register that has not arrived, one that has, and the single ask row a published
 * two-option board yields.
 */

import { type Board, readBoard } from "../../components/live/read";
import type { LiveState } from "../../components/live/useLive";
import { type QueueRow, rowsOf } from "../../lib/queueRows";
import { ACME_PLACER } from "../organisationFixture";

/** A register that has not arrived. */
export const LOADING = { phase: "loading" } as const;

/**
 * One ready register.
 *
 * @returns the register, observed at a fixed instant and not stamped by a route
 */
export function ready<T>({ value }: { value: T }): LiveState<T> {
  return {
    fixture: undefined,
    observedAtIso: "2026-09-23T10:00:00.000Z",
    phase: "ready",
    stampedByRoute: false,
    value,
  };
}

/**
 * The one ask row a published board with a single two-option ask yields.
 *
 * @returns the queue row `rowsOf` draws for that board, every other register still loading
 */
export function askRow(): QueueRow {
  const board: Board | undefined = readBoard({
    rows: [
      {
        anchor: "transcript:a0000036#116b8349",
        ownerWords: {
          anchor: "transcript:a0000036#116b8349",
          cut: "none",
          atIso: "2026-09-06T08:58:00.000Z",
          where: "session",
          words: "schema or card first, you pick",
        },
        kind: "ask",
        options: [
          { letter: "A", option: "Ship the schema", tradeoff: "the card still reads as a paragraph" },
          { letter: "B", option: "Ship the card", tradeoff: "one more day" },
        ],
        ownerWait: "owner",
        priority: "p1",
        question: "Which lands first, the schema or the card?",
        questionAskedIso: "2026-09-06T09:00:00.000Z",
        reason: "waiting on the owner",
        section: "runnable",
        slug: "acme-ask-6-sep-turn-95-1-give",
        status: "waiting-on-owner",
      },
    ],
    unresolved: 0,
  });
  if (board === undefined) {
    throw new Error("the fixture board did not read");
  }
  const rows = rowsOf({
    reviewers: LOADING,
    standing: LOADING,
    acts: LOADING,
    board: ready({ value: board }),
    drafts: LOADING,
    hands: LOADING,
    landing: LOADING,
    placer: ACME_PLACER,
    posts: LOADING,
    reviews: LOADING,
    imports: LOADING,
  });
  const row = rows.at(0);
  if (row === undefined || rows.length !== 1) {
    throw new Error(`expected one row, got ${String(rows.length)}`);
  }
  return row;
}
