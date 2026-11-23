/**
 * The one door every reader and writer of a cmux event-stream reader's state goes through: `session watch`'s
 * cursor and the fold it is complete up to, and `cmux events`'s own cursor.
 *
 * ## Where it lives: the store
 *
 * Everything in `$SLOPWEAVER_HOME` moves into the local Supabase store, and the
 * home becomes deletable. {@link cmuxEventStatePort} answers the store-backed port (`./storePort.ts`): one
 * `cmux_event_state` row per consumer is the authority, `cmux-event-cursor.json` and
 * `cmux-session-activity.json` are imported from once, and nothing writes either file again. A store that
 * cannot be reached is `CMUX_EVENT_STORE_UNAVAILABLE`, never a file read.
 *
 * ## Injection
 *
 * Only a verb's composition root calls {@link cmuxEventStatePort}; everything below it takes the port as a
 * REQUIRED argument, because `SLOPWEAVER_STORE_URL` in the environment overrides the home's selection and a
 * test that forgot to pass one could reach a real store. A unit test passes the real orchestration over an
 * in-memory row (`src/__tests__/cmuxEventStateFixture.ts`) — a seam, not a mock.
 */
import type { Result } from "#lib/result.js";

import type { SessionActivities } from "./decode.js";
import type { CmuxEventStateError } from "./errors.js";
import { storeCmuxEventStatePort } from "./storePort.js";
import { productionCmuxEventStateSeams } from "./storeRows.js";

/** `session watch`'s state: the cursor its fold is complete up to, the fold, and the revision a write pins to. */
export interface SessionWatchState {
  /** The highest sequence folded; undefined when nothing has ever been, so the drain starts at cmux's buffer. */
  readonly cursorSeq: number | undefined;
  readonly activities: SessionActivities;
  /** The row's revision; null when no row exists yet, so the first write inserts one. */
  readonly revision: number | null;
}

/** `cmux events`'s state: its own cursor, and the revision a write pins to. */
export interface EventsCursorState {
  readonly cursorSeq: number | undefined;
  readonly revision: number | null;
}

/** The five operations, as one value a caller threads rather than five it could mix up. */
export interface CmuxEventStatePort {
  /** Read `session watch`'s row, importing the two home files once when none exists. */
  readonly readSessionWatch: (request: {
    readonly home: string;
  }) => Promise<Result<SessionWatchState, CmuxEventStateError>>;
  /** Commit a cursor and the fold complete up to it, together, by compare-and-set. */
  readonly writeSessionWatch: (request: {
    readonly home: string;
    readonly expectedRevision: number | null;
    readonly cursorSeq: number;
    readonly activities: SessionActivities;
    readonly nowIso: string;
  }) => Promise<Result<SessionWatchState, CmuxEventStateError>>;
  /** Replace `session watch`'s row with an empty fold at a chosen cursor, whatever the stored one holds. */
  readonly resetSessionWatch: (request: {
    readonly home: string;
    readonly cursorSeq: number;
    readonly nowIso: string;
  }) => Promise<Result<SessionWatchState, CmuxEventStateError>>;
  /** Read `cmux events`'s row; with `importFile`, adopt the home's cursor file once when none exists. */
  readonly readEventsCursor: (request: {
    readonly home: string;
    readonly importFile: boolean;
  }) => Promise<Result<EventsCursorState, CmuxEventStateError>>;
  /** Commit `cmux events`'s cursor by compare-and-set. */
  readonly writeEventsCursor: (request: {
    readonly home: string;
    readonly expectedRevision: number | null;
    readonly cursorSeq: number;
    readonly nowIso: string;
  }) => Promise<Result<EventsCursorState, CmuxEventStateError>>;
}

/**
 * The port this install's cmux event state is reached through: the store.
 *
 * @returns the port a verb's composition root threads down
 */
export function cmuxEventStatePort(): CmuxEventStatePort {
  return storeCmuxEventStatePort({ seams: productionCmuxEventStateSeams() });
}
