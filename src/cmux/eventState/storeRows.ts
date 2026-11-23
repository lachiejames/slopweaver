/**
 * The Postgres half of the store-backed cmux event state: open the store, and the three statements over a
 * consumer's `cmux_event_state` row. `./storePort.ts` owns every decision; this module only speaks SQL.
 *
 * Every statement goes through Drizzle's parameterised builders, every connection comes from `connectStore` —
 * the checked entrance that refuses a missing selection, a remote host and a stale database — and every failure
 * becomes `CMUX_EVENT_STORE_UNAVAILABLE`, never an empty answer. A message here never carries the connection
 * string: `connectStore`'s own refusals are written to be printed, and a driver error is reduced to its message.
 *
 * The unit lane proves only the refusal half, over Drizzle's connectionless database (`storeRows.test.ts`). What
 * is worth proving about the statements themselves — the compare-and-set predicate, the CHECKs, the `jsonb` round
 * trip — only a real database can prove, and `src/__tests__/integration/cmuxEventStateStore.test.ts` does.
 */
import { and, eq, sql } from "drizzle-orm";

import { err, ok, type Result } from "#lib/result.js";

import { readFileIfPresent } from "../../atlas/atlasFile.js";
import { connectStore, type StoreClient } from "../../store/client.js";
import { cmuxEventStateTable } from "../../store/schema/cmuxEventState.js";

import {
  type CmuxEventImportUnreadableError,
  CmuxEventStateErrors,
  type CmuxEventStoreUnavailableError,
  describeCmuxEventCause,
} from "./errors.js";
import type { CmuxEventStateRows, CmuxEventStateSeams, StoredCmuxEventState } from "./storePort.js";

/** The three columns every statement returns, so a read and a write answer in one shape. */
const RETURNED = {
  activities: cmuxEventStateTable.activities,
  cursorSeq: cmuxEventStateTable.cursorSeq,
  revision: cmuxEventStateTable.revision,
};

/**
 * Run one statement, turning a throw into the typed store refusal.
 *
 * @param doing what the statement was for, finishing "the store could not …"
 * @param statement the statement to run
 * @returns the first returned row, undefined when none came back, or the refusal
 */
async function firstRow({
  doing,
  statement,
}: {
  doing: string;
  statement: () => Promise<readonly StoredCmuxEventState[]>;
}): Promise<Result<StoredCmuxEventState | undefined, CmuxEventStoreUnavailableError>> {
  try {
    const rows = await statement();
    return ok(rows[0]);
  } catch (cause) {
    return err(CmuxEventStateErrors.storeUnavailable({ doing, reason: describeCmuxEventCause({ cause }) }));
  }
}

/**
 * The three row operations over one open client.
 *
 * @param client the open store connection
 * @returns the operations, and the close the caller owns
 */
export function cmuxEventStateRowsOver({ client }: { client: StoreClient }): CmuxEventStateRows {
  return {
    close: () => client.close(),
    insert: ({ activities, consumer, cursorSeq, recordedAtIso }) =>
      firstRow({
        doing: `insert the ${consumer} state`,
        statement: () =>
          client.db
            .insert(cmuxEventStateTable)
            .values({ activities, consumer, cursorSeq, recordedAt: new Date(recordedAtIso), revision: 1 })
            .onConflictDoNothing({ target: cmuxEventStateTable.consumer })
            .returning(RETURNED),
      }),
    read: ({ consumer }) =>
      firstRow({
        doing: `read the ${consumer} state`,
        statement: () =>
          client.db
            .select(RETURNED)
            .from(cmuxEventStateTable)
            .where(eq(cmuxEventStateTable.consumer, consumer))
            .limit(1),
      }),
    update: ({ activities, consumer, cursorSeq, expectedRevision, recordedAtIso }) =>
      firstRow({
        doing: `write the ${consumer} state`,
        statement: () =>
          client.db
            .update(cmuxEventStateTable)
            .set({
              activities,
              cursorSeq,
              recordedAt: new Date(recordedAtIso),
              revision: sql`${cmuxEventStateTable.revision} + 1`,
              updatedAt: sql`now()`,
            })
            .where(and(eq(cmuxEventStateTable.consumer, consumer), eq(cmuxEventStateTable.revision, expectedRevision)))
            .returning(RETURNED),
      }),
  };
}

/**
 * Open the store a home selects, as the state's row operations.
 *
 * @param home the Slopweaver home whose store selection is read
 * @returns the row operations, or `CMUX_EVENT_STORE_UNAVAILABLE` carrying the store's own refusal
 */
async function connectCmuxEventStateRows({
  home,
}: {
  home: string;
}): Promise<Result<CmuxEventStateRows, CmuxEventStoreUnavailableError>> {
  const client = await connectStore({ home });
  if (client.isErr()) {
    return err(CmuxEventStateErrors.storeUnavailable({ doing: "be opened", reason: client.error.message }));
  }
  return ok(cmuxEventStateRowsOver({ client: client.value }));
}

/**
 * Read one import file's text, telling "not there" apart from "there and unreadable".
 *
 * @param path where the file is
 * @returns the text, undefined when absent, or the unreadable refusal
 */
export function readCmuxEventImportText({
  path,
}: {
  path: string;
}): Result<string | undefined, CmuxEventImportUnreadableError> {
  const text = readFileIfPresent({ path });
  if (text.isErr()) {
    return err(CmuxEventStateErrors.importUnreadable({ path, reason: text.error.join("; ") }));
  }
  if (text.value === null) {
    return ok(undefined);
  }
  return ok(text.value);
}

/**
 * The production seams: the real store and the real import files.
 *
 * @returns the seams `cmuxEventStatePort()` runs over
 */
export function productionCmuxEventStateSeams(): CmuxEventStateSeams {
  return { connect: connectCmuxEventStateRows, readImportText: readCmuxEventImportText };
}
