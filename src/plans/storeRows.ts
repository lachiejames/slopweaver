/**
 * The Postgres half of the store-backed plan register: open the store, and the three statements over its
 * singleton `plan_register` row. `./storePort.ts` owns every decision; this module only speaks SQL.
 *
 * Every statement goes through Drizzle's parameterised builders, every connection comes from `connectStore`
 * — the checked entrance that refuses a missing selection, a remote host and a stale database — and every
 * failure becomes `REGISTER_STORE_UNAVAILABLE`, never an empty answer. A message here never carries the
 * connection string: `connectStore`'s own refusals are written to be printed, and a driver error is reduced
 * to its own message.
 *
 * The unit lane proves only the refusal half, over Drizzle's connectionless database (`storeRows.test.ts`):
 * what is worth proving about the statements themselves — the compare-and-set predicate, the singleton CHECK,
 * the `jsonb` round trip — only a real database can prove. `src/__tests__/integration/planRegisterStore.test.ts`
 * does, against a throwaway one.
 */
import { and, eq, sql } from "drizzle-orm";

import { err, ok, type Result } from "#lib/result.js";

import { connectStore, type StoreClient } from "../store/client.js";
import { PLAN_REGISTER_ID, planRegisterTable } from "../store/schema/planRegister.js";

import { describeCause, PlanRegisterErrors, type RegisterStoreUnavailableError } from "./errors.js";
import {
  clearSeatPassesBeforeCommit,
  readPlanRegisterFile,
  storedRegisterDiagnostics,
  writePlanRegisterProjections,
} from "./store.js";
import type { PlanRegisterRows, PlanRegisterStoreSeams, StoredPlanRegister } from "./storePort.js";
import type { PlanRegisterDocument } from "./types.js";

/** The two columns every statement returns, so a read and a write answer in one shape. */
const RETURNED = { document: planRegisterTable.document, revision: planRegisterTable.revision };

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
  statement: () => Promise<readonly StoredPlanRegister[]>;
}): Promise<Result<StoredPlanRegister | undefined, RegisterStoreUnavailableError>> {
  try {
    const rows = await statement();
    return ok(rows[0]);
  } catch (cause) {
    return err(PlanRegisterErrors.registerStoreUnavailable({ doing, reason: describeCause({ cause }) }));
  }
}

/**
 * The three row operations over one open client.
 *
 * @param client the open store connection
 * @returns the operations, and the close the caller owns
 */
export function planRegisterRowsOver({ client }: { client: StoreClient }): PlanRegisterRows {
  const isTheRow = eq(planRegisterTable.id, PLAN_REGISTER_ID);
  return {
    close: () => client.close(),
    insert: ({ document }: { document: PlanRegisterDocument }) =>
      firstRow({
        doing: "import the plan register",
        statement: () =>
          client.db
            .insert(planRegisterTable)
            .values({ document, id: PLAN_REGISTER_ID, revision: 1 })
            .onConflictDoNothing({ target: planRegisterTable.id })
            .returning(RETURNED),
      }),
    read: () =>
      firstRow({
        doing: "read the plan register",
        statement: () => client.db.select(RETURNED).from(planRegisterTable).where(isTheRow).limit(1),
      }),
    update: ({ document, expectedRevision }: { document: PlanRegisterDocument; expectedRevision: number }) =>
      firstRow({
        doing: "write the plan register",
        statement: () =>
          client.db
            .update(planRegisterTable)
            .set({ document, revision: sql`${planRegisterTable.revision} + 1`, updatedAt: sql`now()` })
            .where(and(isTheRow, eq(planRegisterTable.revision, expectedRevision)))
            .returning(RETURNED),
      }),
  };
}

/**
 * Open the store a home selects, as the register's row operations.
 *
 * @param home the Slopweaver home whose store selection is read
 * @returns the row operations, or `REGISTER_STORE_UNAVAILABLE` carrying the store's own refusal
 */
async function connectPlanRegisterRows({
  home,
}: {
  home: string;
}): Promise<Result<PlanRegisterRows, RegisterStoreUnavailableError>> {
  const client = await connectStore({ home });
  if (client.isErr()) {
    return err(
      PlanRegisterErrors.registerStoreUnavailable({
        doing: "be opened",
        reason: client.error.message,
        staleStore: client.error.code === "STORE_STALE",
      }),
    );
  }
  return ok(planRegisterRowsOver({ client: client.value }));
}

/**
 * The production seams: the real store, the real register files, the real projections.
 *
 * @returns the seams `planRegisterPort()` runs over
 */
export function productionPlanRegisterSeams(): PlanRegisterStoreSeams {
  return {
    clearSeatPasses: clearSeatPassesBeforeCommit,
    connect: connectPlanRegisterRows,
    diagnose: storedRegisterDiagnostics,
    readImportFile: readPlanRegisterFile,
    writeProjections: writePlanRegisterProjections,
  };
}
