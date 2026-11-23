/**
 * The Postgres half of the Codex fleet-cap record: open the store, and the three statements over its singleton
 * `codex_fleet_cap` row. `./fleetCapPort.ts` owns every decision; this module only speaks SQL.
 *
 * Every statement goes through Drizzle's parameterised builders, every connection comes from `connectStore` — the
 * checked entrance that refuses a missing selection, a remote host and a stale database — and every failure becomes
 * `CODEX_FLEET_CAP_STORE_UNAVAILABLE`, never an empty answer. A message here never carries the connection string.
 *
 * What is worth proving about the statements — the ordering predicate, the singleton CHECK, the `jsonb` round trip —
 * only a real database can prove: `src/__tests__/integration/codexFleetCapStore.test.ts` does, against a throwaway one.
 */
import { and, eq, isNull, lte, or, sql } from "drizzle-orm";

import { errorMessage } from "#lib/errorMessage.js";
import { err, ok, type Result } from "#lib/result.js";

import { connectStore, type StoreClient } from "../store/client.js";
import { CODEX_FLEET_CAP_ID, codexFleetCapTable } from "../store/schema/codexFleetCap.js";

import { CodexFleetCapErrors, type CodexFleetCapStoreUnavailableError } from "./fleetCapErrors.js";
import type { CodexFleetCapRows } from "./fleetCapPort.js";
import type { CodexFleetCapRecord } from "./fleetCapRecord.js";
import type { CodexFleetCapUnfiled } from "./fleetCapUnfiled.js";

/**
 * Run one statement, turning a throw into the typed store refusal.
 *
 * @param doing what the statement was for, finishing "the store could not … the Codex fleet-cap record"
 * @param statement the statement to run
 * @returns the statement's rows, or the refusal
 */
async function attempt<T>({
  doing,
  statement,
}: {
  doing: string;
  statement: () => Promise<readonly T[]>;
}): Promise<Result<readonly T[], CodexFleetCapStoreUnavailableError>> {
  try {
    return ok(await statement());
  } catch (cause) {
    return err(CodexFleetCapErrors.storeUnavailable({ doing, reason: errorMessage({ error: cause }) }));
  }
}

/**
 * Mark the row with one filing attempt, unless a later attempt already marked it.
 *
 * An UPDATE, never an insert: with no record filed the monitor already reads "absent". Equal instants replace, so a
 * failed filing's own refusal overwrites the "had not finished" its attempt wrote first. Two reads judged in the same
 * millisecond are one moment to every reader: either's marker reads `unfiled` at that instant until a record at or
 * after it lands, so which one's `why` survives changes the text, never the verdict.
 *
 * @param client the open store connection
 * @param unfiled the attempt's marker
 * @returns true when this marker landed, or the refusal
 */
async function markUnfiled({
  client,
  unfiled,
}: {
  client: StoreClient;
  unfiled: CodexFleetCapUnfiled;
}): Promise<Result<boolean, CodexFleetCapStoreUnavailableError>> {
  const attemptedAt = new Date(unfiled.attemptedAtIso);
  const marked = await attempt({
    doing: "mark an attempt on",
    statement: () =>
      client.db
        .update(codexFleetCapTable)
        .set({ attemptedAt, unfiled })
        .where(
          and(
            eq(codexFleetCapTable.id, CODEX_FLEET_CAP_ID),
            or(isNull(codexFleetCapTable.attemptedAt), lte(codexFleetCapTable.attemptedAt, attemptedAt)),
          ),
        )
        .returning({ id: codexFleetCapTable.id }),
  });
  return marked.map((rows) => rows.length > 0);
}

/**
 * The three statements over one open client.
 *
 * @param client the open store connection
 * @returns the statements, and the close the caller owns
 */
export function codexFleetCapRowsOver({ client }: { client: StoreClient }): CodexFleetCapRows {
  return {
    close: () => client.close(),
    fileIfNotOlder: async ({ record }: { record: CodexFleetCapRecord }) => {
      // One statement, so Postgres orders concurrent fleet reads: a row judged later than this record is left alone.
      // Several passes read the fleet at once and a slow read can finish after a quicker, later one; letting the
      // older answer land would put back on the monitor's screen a cap a later read had already seen lift.
      const landed = await attempt({
        doing: "file",
        statement: () =>
          client.db
            .insert(codexFleetCapTable)
            .values({ document: record, id: CODEX_FLEET_CAP_ID, readAt: new Date(record.readAtIso), revision: 1 })
            .onConflictDoUpdate({
              set: {
                document: sql`excluded.document`,
                readAt: sql`excluded.read_at`,
                revision: sql`${codexFleetCapTable.revision} + 1`,
                updatedAt: sql`now()`,
              },
              setWhere: sql`${codexFleetCapTable.readAt} <= excluded.read_at`,
              target: codexFleetCapTable.id,
            })
            .returning({ id: codexFleetCapTable.id }),
      });
      return landed.map((rows) => rows.length > 0);
    },
    markUnfiledIfNotOlder: ({ unfiled }: { unfiled: CodexFleetCapUnfiled }) => markUnfiled({ client, unfiled }),
    read: async () => {
      // One statement, so the record and the marker beside it come from the same row version.
      const found = await attempt({
        doing: "read",
        statement: () =>
          client.db
            .select({ document: codexFleetCapTable.document, unfiled: codexFleetCapTable.unfiled })
            .from(codexFleetCapTable)
            .where(eq(codexFleetCapTable.id, CODEX_FLEET_CAP_ID))
            .limit(1),
      });
      return found.map((rows) => rows[0]);
    },
  };
}

/**
 * Open the store a home selects, as the record's statements.
 *
 * @param home the Slopweaver home whose store selection is read
 * @returns the statements, or `CODEX_FLEET_CAP_STORE_UNAVAILABLE` carrying the store's own refusal
 */
export async function connectCodexFleetCapRows({
  home,
}: {
  home: string;
}): Promise<Result<CodexFleetCapRows, CodexFleetCapStoreUnavailableError>> {
  const client = await connectStore({ home });
  if (client.isErr()) {
    return err(CodexFleetCapErrors.storeUnavailable({ doing: "open", reason: client.error.message }));
  }
  return ok(codexFleetCapRowsOver({ client: client.value }));
}
