/**
 * The Postgres half of the store-backed Codex sign-in observations: open the store, and the three statements over
 * `codex_sign_in_observation`. `./signInRecordStore.ts` owns every decision; this module only speaks SQL.
 *
 * Every statement goes through Drizzle's parameterised builders, every connection comes from `connectStore` — the
 * checked entrance that refuses a missing selection, a remote host and a stale database — and every failure becomes
 * `CODEX_SIGN_IN_STORE_UNAVAILABLE`, never an empty answer. A message here never carries the connection string.
 *
 * What is worth proving about the statements themselves — the alias key, the compare-and-set predicate, the `jsonb`
 * round trip — only a real database can prove: `src/__tests__/integration/codexSignInObservationStore.test.ts`.
 */
import { and, eq, inArray, sql } from "drizzle-orm";

import { errorMessage } from "#lib/errorMessage.js";
import { err, ok, type Result } from "#lib/result.js";

import { connectStore, type StoreClient } from "../store/client.js";
import { codexSignInObservationTable } from "../store/schema/codexSignInObservation.js";

import { CodexSignInErrors, type CodexSignInStoreUnavailableError } from "./signInErrors.js";
import {
  type CodexSignInRows,
  type CodexSignInStoreSeams,
  readCodexSignInImportFile,
  type StoredCodexSignIn,
} from "./signInObservationCurrent.js";
import type { CodexSignInRecord } from "./signInRecord.js";

/** The three columns every statement returns, so a read and a write answer in one shape. */
const RETURNED = {
  alias: codexSignInObservationTable.alias,
  record: codexSignInObservationTable.record,
  revision: codexSignInObservationTable.revision,
};

/**
 * Run one statement, turning a throw into the typed store refusal.
 *
 * @param doing what the statement was for, finishing "the store could not …"
 * @param statement the statement to run
 * @returns every returned row, or the refusal
 */
async function rowsOf({
  doing,
  statement,
}: {
  doing: string;
  statement: () => Promise<readonly StoredCodexSignIn[]>;
}): Promise<Result<readonly StoredCodexSignIn[], CodexSignInStoreUnavailableError>> {
  try {
    return ok(await statement());
  } catch (cause) {
    return err(CodexSignInErrors.storeUnavailable({ doing, reason: errorMessage({ error: cause }) }));
  }
}

/**
 * The first row a statement returned, undefined when none came back.
 *
 * @returns the row, or the refusal
 */
async function firstRow({
  doing,
  statement,
}: {
  doing: string;
  statement: () => Promise<readonly StoredCodexSignIn[]>;
}): Promise<Result<StoredCodexSignIn | undefined, CodexSignInStoreUnavailableError>> {
  const rows = await rowsOf({ doing, statement });
  return rows.map((returned) => returned[0]);
}

/**
 * The three row operations over one open client.
 *
 * @param client the open store connection
 * @returns the operations, and the close the caller owns
 */
export function codexSignInRowsOver({ client }: { client: StoreClient }): CodexSignInRows {
  return {
    close: () => client.close(),
    insert: ({ alias, record }: { alias: string; record: CodexSignInRecord }) =>
      firstRow({
        doing: `file ${alias}'s sign-in observation`,
        statement: () =>
          client.db
            .insert(codexSignInObservationTable)
            .values({ alias, record, revision: 1 })
            .onConflictDoNothing({ target: codexSignInObservationTable.alias })
            .returning(RETURNED),
      }),
    read: ({ aliases }: { aliases: readonly string[] }) => {
      if (aliases.length === 0) {
        return Promise.resolve(ok([]));
      }
      return rowsOf({
        doing: "read the sign-in observations",
        statement: () =>
          client.db
            .select(RETURNED)
            .from(codexSignInObservationTable)
            .where(inArray(codexSignInObservationTable.alias, [...aliases])),
      });
    },
    update: ({
      alias,
      expectedRevision,
      record,
    }: {
      alias: string;
      expectedRevision: number;
      record: CodexSignInRecord;
    }) =>
      firstRow({
        doing: `file ${alias}'s sign-in observation`,
        statement: () =>
          client.db
            .update(codexSignInObservationTable)
            .set({ record, revision: sql`${codexSignInObservationTable.revision} + 1`, updatedAt: sql`now()` })
            .where(
              and(
                eq(codexSignInObservationTable.alias, alias),
                eq(codexSignInObservationTable.revision, expectedRevision),
              ),
            )
            .returning(RETURNED),
      }),
  };
}

/**
 * Open the store a home selects, as the observations' row operations.
 *
 * @param home the Slopweaver home whose store selection is read
 * @returns the row operations, or `CODEX_SIGN_IN_STORE_UNAVAILABLE` carrying the store's own refusal
 */
async function connectCodexSignInRows({
  home,
}: {
  home: string;
}): Promise<Result<CodexSignInRows, CodexSignInStoreUnavailableError>> {
  const client = await connectStore({ home });
  if (client.isErr()) {
    return err(CodexSignInErrors.storeUnavailable({ doing: "be opened", reason: client.error.message }));
  }
  return ok(codexSignInRowsOver({ client: client.value }));
}

/**
 * The production seams: the real store, and the real import files.
 *
 * @returns the seams `codexSignInPort()` runs over
 */
export function productionCodexSignInSeams(): CodexSignInStoreSeams {
  return { connect: connectCodexSignInRows, readImportFile: readCodexSignInImportFile };
}
