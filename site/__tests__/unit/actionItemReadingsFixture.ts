/*
 * The empty-but-arrived value of each reading the voice's Queue answer takes, so a test can swap one source out at a
 * time (`./talkActionItems.test.ts`, `./voiceRecordQueue.test.ts`).
 */
import type { Board } from "../../components/live/read";
import { NO_LINEAR_REFERENCES } from "../../components/live/readBoardDocument";
import type { Reading } from "../../components/live/reading";
import type { LandingReading } from "../../components/live/readLanding";
import { NO_RECORD_REFERENCES } from "../../components/live/readRecords";
import type { Reviewers } from "../../components/live/readReviewers";
import type { LiveState } from "../../components/live/useLive";
import type { CurrencyReading } from "../../lib/cardCurrency";

/**
 * A reading that arrived, carrying the instant it was true of the machine.
 *
 * @returns the ready state
 */
export function ready<T>({ value, at }: { value: T; at: string }): LiveState<T> {
  return { fixture: undefined, observedAtIso: at, phase: "ready", stampedByRoute: false, value };
}

/** The empty-but-arrived value of each of the readings, so a source can be swapped out one at a time. */
export const BOARD: Board = {
  detachedAsks: [],
  linear: NO_LINEAR_REFERENCES,
  records: NO_RECORD_REFERENCES,
  rows: [],
  scanStartedIso: undefined,
  unreadable: [],
  unresolved: 0,
};
export const LANDING: LandingReading = {
  by: "a tick",
  landing: {
    advisoryRedBypassed: undefined,
    byAction: [],
    census: undefined,
    people: new Map(),
    ready: 0,
    residue: [],
    rows: [],
    selection: undefined,
    total: 0,
  },
  observedAtIso: "2026-09-23T01:00:00.000Z",
  readingId: "r1",
  recordedAtIso: "2026-09-23T01:00:00.000Z",
};

/** A reviewer reading that arrived and suggests no one. */
export const NO_REVIEWERS: Reviewers = {
  observedAtIso: "2026-09-23T05:30:00.000Z",
  people: new Map(),
  readingId: "r1",
  registerAsks: 0,
  rows: [],
};

/** A currency reading that arrived and covers no card: it ranks nothing and moves nothing. */
export const NO_CURRENCY: Reading<CurrencyReading> = {
  by: "a tick",
  observedAtIso: "2026-09-23T08:00:00.000Z",
  readingId: "c0",
  recordedAtIso: "2026-09-23T08:00:00.000Z",
  value: {
    checkedIso: "2026-09-23T08:00:00.000Z",
    readFromIso: "2026-09-22T08:00:00.000Z",
    rows: [],
    sources: { chair: "0 turns read", relays: "0 undelivered", voice: "0 unread call words" },
  },
};
