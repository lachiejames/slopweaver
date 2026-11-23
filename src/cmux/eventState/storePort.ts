/**
 * The store-backed cmux event state: one `cmux_event_state` row per consumer is the authority, imported ONCE
 * from the home's two files, and changed only by compare-and-set.
 *
 * This module is the ORCHESTRATION and nothing else. Every effect arrives through {@link CmuxEventStateSeams} —
 * the connection and its row operations, the import-file read — so a unit test drives every branch below over a
 * plain in-memory fake (a seam, not a mock: `.claude/rules/testing.md`). The Postgres half is `./storeRows.ts`;
 * what only a real database can prove (the CAS predicate, the CHECKs, the `jsonb` round trip) is the opt-in
 * `src/__tests__/integration/cmuxEventStateStore.test.ts`.
 *
 * ## Together, in one revision
 *
 * `session watch`'s cursor and its fold are ONE row, written by ONE statement. The files they replace were two
 * writes, fold then cursor, and a crash between them left a fold ahead of its cursor: the restart replayed events
 * the fold had already counted, and the fold is not replay-safe (a replayed `PreToolUse` counts its tool call
 * twice). A row cannot be half-written.
 *
 * ## A store outage is a refusal, never a file
 *
 * No selection, a stale database, an unreachable one, a failed query: every one is `CMUX_EVENT_STORE_UNAVAILABLE`,
 * and NONE of them falls back to the home's files. A file that stopped being the authority is how a cursor
 * becomes confidently wrong.
 *
 * ## The one-time import, and what it refuses
 *
 * A read finding no row consults the files, and only then. `session watch` imports the PAIR or nothing: both
 * absent is a fresh install (no row is inserted, so loading new code adopts nothing); exactly one present is
 * refused, because a cursor without its fold skips every event before it and a fold without its cursor replays
 * them all; both present must decode strictly, with no fold entry past the cursor. `cmux events` imports the
 * cursor file alone — the cursor it resumed from until now — unless the caller passed its own start. An import
 * inserts at revision 1 with `ON CONFLICT DO NOTHING` and reads the row back (the file half, deciding what a
 * pair imports as, is `./importFiles.ts`), so a concurrent importer's row
 * wins and a file never overwrites a row. Neither file is written or removed: they are simply never read again.
 *
 * The old `cmux events` advanced the SHARED cursor file without folding, so a valid pair can carry a cursor
 * ahead of its fold. The import therefore resumes from the fold's own high-water mark — the greatest `lastSeq`
 * it holds — and keeps the cursor file only as the bound no fold entry may pass. One limit it cannot see past,
 * stated rather than discovered: events the old shared cursor already skipped BEFORE the last fold write are
 * below that mark, and neither file records them.
 *
 * ## Compare-and-set, never a retry
 *
 * A write pins `WHERE revision = N` (an insert pins "no row", reported as revision 0). No row back is
 * `CMUX_EVENT_REVISION_CONFLICT`, and nothing replays the write: the events the loser read are still after the
 * winner's cursor, so the next run sees them.
 *
 * Every operation opens the store the home selects AT THAT MOMENT, the plan register's shape. A revision is
 * therefore only comparable within one store: re-pointing a home's selection while a watch runs, at a second
 * store whose row happens to stand at the same revision, is outside what the compare-and-set can see.
 */
import { err, ok, type Result } from "#lib/result.js";

import { stateHomePaths } from "../../stateHome.js";

import { decodeCursorFile, decodeSessionActivities, type SessionActivities } from "./decode.js";
import {
  type CmuxEventConsumer,
  type CmuxEventStateError,
  CmuxEventStateErrors,
  type CmuxEventStoreUnavailableError,
  describeCmuxEventCause,
} from "./errors.js";
import { type ReadImportText, sessionImport } from "./importFiles.js";
import type { CmuxEventStatePort, EventsCursorState, SessionWatchState } from "./port.js";

/** One stored row as the store returned it: the cursor, the raw fold, and its revision. */
export interface StoredCmuxEventState {
  readonly cursorSeq: number;
  /** `unknown` on purpose — `jsonb` is not validation, so every reader decodes it. Null on a cursor-only row. */
  readonly activities: unknown;
  readonly revision: number;
}

/** What one write stores: a cursor, the fold beside it (null for `cmux events`), and the instant. */
interface CmuxEventStateWrite {
  readonly consumer: CmuxEventConsumer;
  readonly cursorSeq: number;
  readonly activities: SessionActivities | null;
  readonly recordedAtIso: string;
}

/**
 * The row operations one open connection offers, and the handle that closes it. A store step's only failure is
 * `CMUX_EVENT_STORE_UNAVAILABLE`, typed so: no seam can make a failed statement read as anything else.
 */
export interface CmuxEventStateRows {
  /** One consumer's row, or undefined when the store holds none. */
  readonly read: (request: {
    readonly consumer: CmuxEventConsumer;
  }) => Promise<Result<StoredCmuxEventState | undefined, CmuxEventStoreUnavailableError>>;
  /** Insert at revision 1 unless the consumer's row exists; undefined when one already did. */
  readonly insert: (
    request: CmuxEventStateWrite,
  ) => Promise<Result<StoredCmuxEventState | undefined, CmuxEventStoreUnavailableError>>;
  /** Update iff the row is still at `expectedRevision`, bumping it; undefined when it was not. */
  readonly update: (
    request: CmuxEventStateWrite & { readonly expectedRevision: number },
  ) => Promise<Result<StoredCmuxEventState | undefined, CmuxEventStoreUnavailableError>>;
  readonly close: () => Promise<void>;
}

/** Every effect the store-backed state performs, injected so the orchestration is testable without a store. */
export interface CmuxEventStateSeams {
  /** Open the store for one home, refusing with `CMUX_EVENT_STORE_UNAVAILABLE` when it cannot be. */
  readonly connect: (request: {
    readonly home: string;
  }) => Promise<Result<CmuxEventStateRows, CmuxEventStoreUnavailableError>>;
  /** One import file's text; undefined when it is not there, a refusal when it is and cannot be read. */
  readonly readImportText: ReadImportText;
}

/** What `session watch` holds before anything has been folded. */
const NOTHING_FOLDED: SessionWatchState = { activities: {}, cursorSeq: undefined, revision: null };

/**
 * Decode `session watch`'s stored row into its state.
 *
 * @param row the row as stored
 * @returns the state, or why the stored fold cannot be trusted
 */
function sessionStateOfRow({ row }: { row: StoredCmuxEventState }): Result<SessionWatchState, CmuxEventStateError> {
  const activities = decodeSessionActivities({ activities: row.activities, cursorSeq: row.cursorSeq });
  if (activities.isErr()) {
    return err(CmuxEventStateErrors.storedInvalid({ consumer: "session-watch", problems: activities.error }));
  }
  return ok({ activities: activities.value, cursorSeq: row.cursorSeq, revision: row.revision });
}

/**
 * Insert an imported row, and read back whichever row won.
 *
 * @param rows the open connection's row operations
 * @param write the imported state
 * @returns the row now stored, or the refusal
 */
async function insertImported({
  rows,
  write,
}: {
  rows: CmuxEventStateRows;
  write: CmuxEventStateWrite;
}): Promise<Result<StoredCmuxEventState, CmuxEventStateError>> {
  const inserted = await rows.insert(write);
  if (inserted.isErr()) {
    return err(inserted.error);
  }
  // A lost insert means another importer got there first: ITS row is the state, so read that back.
  const winner = inserted.value === undefined ? await rows.read({ consumer: write.consumer }) : ok(inserted.value);
  if (winner.isErr()) {
    return err(winner.error);
  }
  if (winner.value === undefined) {
    return err(
      CmuxEventStateErrors.storeUnavailable({
        doing: `import the ${write.consumer} state`,
        reason: "the import's insert was refused and no row is there to read back",
      }),
    );
  }
  return ok(winner.value);
}

/**
 * `session watch`'s state for one home: the stored row, else the one-time import, else nothing folded.
 *
 * @param home the home whose import files are consulted
 * @param nowIso the instant an import is stamped with
 * @param rows the open connection's row operations
 * @param seams the remaining effects
 * @returns the state, or the refusal
 */
async function currentSessionWatch({
  home,
  nowIso,
  rows,
  seams,
}: {
  home: string;
  nowIso: string;
  rows: CmuxEventStateRows;
  seams: CmuxEventStateSeams;
}): Promise<Result<SessionWatchState, CmuxEventStateError>> {
  const stored = await rows.read({ consumer: "session-watch" });
  if (stored.isErr()) {
    return err(stored.error);
  }
  if (stored.value !== undefined) {
    return sessionStateOfRow({ row: stored.value });
  }
  const imported = sessionImport({ home, readImportText: seams.readImportText });
  if (imported.isErr()) {
    return err(imported.error);
  }
  if (imported.value === undefined) {
    return ok(NOTHING_FOLDED);
  }
  const row = await insertImported({
    rows,
    write: { consumer: "session-watch", recordedAtIso: nowIso, ...imported.value },
  });
  if (row.isErr()) {
    return err(row.error);
  }
  return sessionStateOfRow({ row: row.value });
}

/**
 * `cmux events`'s state for one home: the stored row, else the cursor file once, else no cursor.
 *
 * @param home the home whose cursor file is consulted
 * @param importFile whether a missing row may adopt the cursor file
 * @param nowIso the instant an import is stamped with
 * @param rows the open connection's row operations
 * @param seams the remaining effects
 * @returns the state, or the refusal
 */
async function currentEventsCursor({
  home,
  importFile,
  nowIso,
  rows,
  seams,
}: {
  home: string;
  importFile: boolean;
  nowIso: string;
  rows: CmuxEventStateRows;
  seams: CmuxEventStateSeams;
}): Promise<Result<EventsCursorState, CmuxEventStateError>> {
  const stored = await rows.read({ consumer: "cmux-events" });
  if (stored.isErr()) {
    return err(stored.error);
  }
  if (stored.value !== undefined) {
    return ok({ cursorSeq: stored.value.cursorSeq, revision: stored.value.revision });
  }
  if (!importFile) {
    return ok({ cursorSeq: undefined, revision: null });
  }
  const text = seams.readImportText({ path: stateHomePaths({ home }).cmuxEventCursorJson });
  if (text.isErr()) {
    return err(text.error);
  }
  if (text.value === undefined) {
    return ok({ cursorSeq: undefined, revision: null });
  }
  const cursorSeq = decodeCursorFile({ text: text.value });
  if (cursorSeq.isErr()) {
    return err(CmuxEventStateErrors.importInvalid({ consumer: "cmux-events", problems: cursorSeq.error }));
  }
  const row = await insertImported({
    rows,
    write: { activities: null, consumer: "cmux-events", cursorSeq: cursorSeq.value, recordedAtIso: nowIso },
  });
  if (row.isErr()) {
    return err(row.error);
  }
  return ok({ cursorSeq: row.value.cursorSeq, revision: row.value.revision });
}

/**
 * Commit one write: insert it when no row backs it, compare-and-set it otherwise.
 *
 * @param rows the open connection's row operations
 * @param write what to store
 * @param expectedRevision the revision the write was judged against, or null when no row backed it
 * @returns the committed row, or the conflict that stopped it
 */
async function commit({
  expectedRevision,
  rows,
  write,
}: {
  expectedRevision: number | null;
  rows: CmuxEventStateRows;
  write: CmuxEventStateWrite;
}): Promise<Result<StoredCmuxEventState, CmuxEventStateError>> {
  const committed =
    expectedRevision === null ? await rows.insert(write) : await rows.update({ ...write, expectedRevision });
  if (committed.isErr()) {
    return err(committed.error);
  }
  if (committed.value !== undefined) {
    return ok(committed.value);
  }
  if (expectedRevision === null) {
    // `0` names "expected no row at all" — the revision an insert pins to, since a real one starts at 1.
    return err(CmuxEventStateErrors.revisionConflict({ consumer: write.consumer, expectedRevision: 0 }));
  }
  return err(CmuxEventStateErrors.revisionConflict({ consumer: write.consumer, expectedRevision }));
}

/**
 * Replace `session watch`'s row with an empty fold, pinned to whatever revision is stored — without decoding it,
 * since a fold that cannot be decoded is exactly what a reset is for.
 *
 * @param cursorSeq the sequence the fresh fold starts after
 * @param nowIso the instant to stamp
 * @param rows the open connection's row operations
 * @returns the fresh state, or the refusal
 */
async function resetWith({
  cursorSeq,
  nowIso,
  rows,
}: {
  cursorSeq: number;
  nowIso: string;
  rows: CmuxEventStateRows;
}): Promise<Result<SessionWatchState, CmuxEventStateError>> {
  const stored = await rows.read({ consumer: "session-watch" });
  if (stored.isErr()) {
    return err(stored.error);
  }
  const committed = await commit({
    expectedRevision: stored.value === undefined ? null : stored.value.revision,
    rows,
    write: { activities: {}, consumer: "session-watch", cursorSeq, recordedAtIso: nowIso },
  });
  if (committed.isErr()) {
    return err(committed.error);
  }
  return ok({ activities: {}, cursorSeq, revision: committed.value.revision });
}

/**
 * The store refusal for a seam that rejected rather than answering a Result.
 *
 * @param cause what the seam rejected with
 * @param doing what the step was for, finishing "the store could not …"
 * @returns the typed refusal
 */
function unavailable({ cause, doing }: { cause: unknown; doing: string }): CmuxEventStoreUnavailableError {
  return CmuxEventStateErrors.storeUnavailable({ doing, reason: describeCmuxEventCause({ cause }) });
}

/**
 * Run one operation over a connection this function opens and always closes.
 *
 * @param home the Slopweaver home whose store is opened
 * @param seams where the connection comes from
 * @param body what to do with it
 * @returns whatever the body answered, or the connection refusal
 */
async function withRows<T>({
  body,
  home,
  seams,
}: {
  body: (rows: CmuxEventStateRows) => Promise<Result<T, CmuxEventStateError>>;
  home: string;
  seams: CmuxEventStateSeams;
}): Promise<Result<T, CmuxEventStateError>> {
  // Production's seams answer a Result (`storeRows.ts` catches every driver throw). One that rejects anyway is
  // still a step that did not finish, so it is the same refusal: never a raw rejection standing in for "where
  // the drain got to is unknown". A close failing after a write committed refuses too — the retry meets a
  // revision conflict, which is visible, never a lost write.
  let rows: Awaited<ReturnType<CmuxEventStateSeams["connect"]>>;
  try {
    rows = await seams.connect({ home });
  } catch (cause) {
    return err(unavailable({ cause, doing: "be opened" }));
  }
  if (rows.isErr()) {
    return err(rows.error);
  }
  let answer: Result<T, CmuxEventStateError>;
  try {
    answer = await body(rows.value);
  } catch (cause) {
    answer = err(unavailable({ cause, doing: "finish the operation" }));
  }
  try {
    await rows.value.close();
  } catch (cause) {
    return err(unavailable({ cause, doing: "close its connection" }));
  }
  return answer;
}

/**
 * A cmux event state port whose authority is the store rows, over whichever seams it is handed.
 *
 * @param seams the effects — production's are `./storeRows.ts`'s `productionCmuxEventStateSeams`
 * @returns the port
 */
export function storeCmuxEventStatePort({ seams }: { seams: CmuxEventStateSeams }): CmuxEventStatePort {
  const nowIso = (): string => new Date().toISOString();
  return {
    readEventsCursor: ({ home, importFile }) =>
      withRows({
        body: (rows) => currentEventsCursor({ home, importFile, nowIso: nowIso(), rows, seams }),
        home,
        seams,
      }),
    readSessionWatch: ({ home }) =>
      withRows({ body: (rows) => currentSessionWatch({ home, nowIso: nowIso(), rows, seams }), home, seams }),
    resetSessionWatch: ({ cursorSeq, home, nowIso: at }) =>
      withRows({ body: (rows) => resetWith({ cursorSeq, nowIso: at, rows }), home, seams }),
    writeEventsCursor: ({ cursorSeq, expectedRevision, home, nowIso: at }) =>
      withRows({
        body: async (rows) =>
          (
            await commit({
              expectedRevision,
              rows,
              write: { activities: null, consumer: "cmux-events", cursorSeq, recordedAtIso: at },
            })
          ).map((row) => ({ cursorSeq: row.cursorSeq, revision: row.revision })),
        home,
        seams,
      }),
    writeSessionWatch: ({ activities, cursorSeq, expectedRevision, home, nowIso: at }) =>
      withRows({
        body: async (rows) =>
          (
            await commit({
              expectedRevision,
              rows,
              write: { activities, consumer: "session-watch", cursorSeq, recordedAtIso: at },
            })
          ).map((row) => ({ activities, cursorSeq: row.cursorSeq, revision: row.revision })),
        home,
        seams,
      }),
  };
}
