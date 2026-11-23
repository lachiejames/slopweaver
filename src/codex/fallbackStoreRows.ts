/**
 * The Postgres half of the store-backed fallback record: open the store, and the four statements over
 * `codex_fallback_request` and `codex_fallback_receipt`. `./fallbackStorePort.ts` owns every decision; this
 * module only speaks SQL.
 *
 * Every connection comes from `connectStore` — the checked entrance that refuses a missing selection, a remote
 * host and a database whose migrations this checkout does not carry — and every failure becomes
 * `FALLBACK_STORE_UNAVAILABLE`, never an empty answer. Both inserts are `ON CONFLICT DO NOTHING ... RETURNING`,
 * so a lost race answers `false` rather than overwriting the winner.
 */
import { eq } from "drizzle-orm";

import { err, ok, type Result } from "#lib/result.js";

import { connectStore, type StoreClient } from "../store/client.js";
import {
  codexFallbackReceiptTable,
  codexFallbackRequestTable,
  type NewCodexFallbackReceiptRecord,
  type NewCodexFallbackRequestRecord,
} from "../store/schema/codexFallback.js";
import { FallbackStoreErrors, type FallbackStoreUnavailableError } from "./fallbackStoreErrors.js";
import type { FallbackRegisterStoreSeams, FallbackRows, StoredFallbackRow } from "./fallbackStorePort.js";

/** The three columns every read returns. */
const RETURNED = {
  receiptText: codexFallbackReceiptTable.receiptText,
  requestId: codexFallbackRequestTable.requestId,
  requestText: codexFallbackRequestTable.requestText,
};

/**
 * Run one statement, turning a throw into the typed store refusal.
 *
 * @param doing what the statement was for, finishing "the store could not …"
 * @param statement the statement to run
 * @returns what it answered, or the refusal
 */
async function attempt<T>({
  doing,
  statement,
}: {
  doing: string;
  statement: () => Promise<T>;
}): Promise<Result<T, FallbackStoreUnavailableError>> {
  try {
    return ok(await statement());
  } catch (cause) {
    const reason = cause instanceof Error ? cause.message : "unknown failure";
    return err(FallbackStoreErrors.storeUnavailable({ doing, reason }));
  }
}

/**
 * The row operations over one open client.
 *
 * @param client the open store connection
 * @returns the operations, and the close the caller owns
 */
export function fallbackRowsOver({ client }: { client: StoreClient }): FallbackRows {
  const joined = () =>
    client.db
      .select(RETURNED)
      .from(codexFallbackRequestTable)
      .leftJoin(
        codexFallbackReceiptTable,
        eq(codexFallbackReceiptTable.requestId, codexFallbackRequestTable.requestId),
      );
  return {
    close: () => client.close(),
    insertReceipt: ({ row }: { row: NewCodexFallbackReceiptRecord }) =>
      attempt({
        doing: "record the fallback receipt",
        statement: async () => {
          const inserted = await client.db
            .insert(codexFallbackReceiptTable)
            .values(row)
            .onConflictDoNothing({ target: codexFallbackReceiptTable.requestId })
            .returning({ id: codexFallbackReceiptTable.requestId });
          return inserted.length > 0;
        },
      }),
    insertRequest: ({ row }: { row: NewCodexFallbackRequestRecord }) =>
      attempt({
        doing: "record the fallback request",
        statement: async () => {
          const inserted = await client.db
            .insert(codexFallbackRequestTable)
            .values(row)
            .onConflictDoNothing({ target: codexFallbackRequestTable.requestId })
            .returning({ id: codexFallbackRequestTable.requestId });
          return inserted.length > 0;
        },
      }),
    readAll: () =>
      attempt({
        doing: "read the Claude fallback requests",
        statement: async (): Promise<readonly StoredFallbackRow[]> =>
          joined().orderBy(codexFallbackRequestTable.requestId),
      }),
    readOne: ({ requestId }: { requestId: string }) =>
      attempt({
        doing: `read fallback request ${requestId}`,
        statement: async (): Promise<StoredFallbackRow | undefined> => {
          const rows = await joined().where(eq(codexFallbackRequestTable.requestId, requestId)).limit(1);
          return rows[0];
        },
      }),
  };
}

/**
 * Open the store a home selects, as the fallback record's row operations.
 *
 * @param home the Slopweaver home whose store selection is read
 * @returns the row operations, or `FALLBACK_STORE_UNAVAILABLE` carrying the store's own refusal
 */
async function connectFallbackRows({
  home,
}: {
  home: string;
}): Promise<Result<FallbackRows, FallbackStoreUnavailableError>> {
  const client = await connectStore({ home });
  if (client.isErr()) {
    return err(FallbackStoreErrors.storeUnavailable({ doing: "be opened", reason: client.error.message }));
  }
  return ok(fallbackRowsOver({ client: client.value }));
}

/**
 * The production seams: the real store.
 *
 * @returns the seams `fallbackRegisterPort()` runs over
 */
export function productionFallbackRegisterSeams(): FallbackRegisterStoreSeams {
  return { connect: connectFallbackRows };
}
