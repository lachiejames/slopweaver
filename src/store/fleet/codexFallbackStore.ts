/**
 * The one-time import's batched writes and its read-back — the effectful half of `./codexFallback.ts` that
 * `store import-fleet --only codex-fallback` runs. The verbs' own reads and writes go through the port
 * (`src/codex/fallbackPort.ts`), which is the authority.
 *
 * Every write is `DO NOTHING` on the key, so this module cannot overwrite a request or a receipt the port
 * already wrote; the leg reads the rows back and reports a legacy document that differs
 * (`../../cli/commands/store/importFallbackLeg.ts`). The counts come from `.returning()`, so a re-import over
 * an unchanged home says `0` — the convergence proof.
 */
import { eq } from "drizzle-orm";

import { err, ok, type Result } from "#lib/result.js";

import type { StoreClient, StoreWriter } from "../client.js";
import { type StoreError, StoreErrors } from "../errors.js";
import { codexFallbackReceiptTable, codexFallbackRequestTable } from "../schema/codexFallback.js";

import type { ProjectedFallbackRequest } from "./codexFallback.js";

/**
 * Rows per statement. A request row is nine columns, so 500 rows is 4,500 bind parameters — far inside
 * Postgres's 65,535 — and the same chunk `./ownerTurnStore.ts` uses.
 */
const INSERT_BATCH = 500;

/** How many rows an import actually wrote to each table. */
export interface FallbackImportCounts {
  readonly requests: number;
  readonly receipts: number;
}

/** One stored request with its receipt's text, when one was recorded. */
export interface StoredFallbackRequest {
  readonly requestId: string;
  readonly requestText: string;
  readonly receiptText: string | null;
}

/** The rows of one list, in batches this store can actually send. */
function* batched<T>({ rows }: { rows: readonly T[] }): Generator<readonly T[]> {
  for (let start = 0; start < rows.length; start += INSERT_BATCH) {
    yield rows.slice(start, start + INSERT_BATCH);
  }
}

/**
 * Write requests and their receipts in one transaction, requests first so every receipt's key resolves.
 *
 * @param client an open store connection
 * @param projected each directory's rows
 * @returns how many rows of each were NEW, or the typed database failure
 */
export async function importFallbackRequests({
  client,
  projected,
}: {
  client: StoreClient;
  projected: readonly ProjectedFallbackRequest[];
}): Promise<Result<FallbackImportCounts, StoreError>> {
  if (projected.length === 0) {
    return ok({ receipts: 0, requests: 0 });
  }
  const requests = projected.map((one) => one.request);
  const receipts = projected.flatMap((one) => (one.receipt === undefined ? [] : [one.receipt]));
  try {
    const counts = await client.db.transaction(async (writer: StoreWriter): Promise<FallbackImportCounts> => {
      let writtenRequests = 0;
      for (const batch of batched({ rows: requests })) {
        const inserted = await writer
          .insert(codexFallbackRequestTable)
          .values([...batch])
          .onConflictDoNothing({ target: codexFallbackRequestTable.requestId })
          .returning({ id: codexFallbackRequestTable.requestId });
        writtenRequests += inserted.length;
      }
      let writtenReceipts = 0;
      for (const batch of batched({ rows: receipts })) {
        const inserted = await writer
          .insert(codexFallbackReceiptTable)
          .values([...batch])
          .onConflictDoNothing({ target: codexFallbackReceiptTable.requestId })
          .returning({ id: codexFallbackReceiptTable.requestId });
        writtenReceipts += inserted.length;
      }
      return { receipts: writtenReceipts, requests: writtenRequests };
    });
    return ok(counts);
  } catch (cause) {
    return err(
      StoreErrors.queryFailed({
        cause,
        what: `import ${String(requests.length)} fallback request(s) and ${String(receipts.length)} receipt(s)`,
      }),
    );
  }
}

/**
 * Every stored request, each with its receipt's text when one was recorded.
 *
 * @param client an open store connection
 * @returns the rows in request-id order, or the typed database failure
 */
export async function readStoredFallbackRequests({
  client,
}: {
  client: StoreClient;
}): Promise<Result<readonly StoredFallbackRequest[], StoreError>> {
  try {
    const rows = await client.db
      .select({
        receiptText: codexFallbackReceiptTable.receiptText,
        requestId: codexFallbackRequestTable.requestId,
        requestText: codexFallbackRequestTable.requestText,
      })
      .from(codexFallbackRequestTable)
      .leftJoin(codexFallbackReceiptTable, eq(codexFallbackReceiptTable.requestId, codexFallbackRequestTable.requestId))
      .orderBy(codexFallbackRequestTable.requestId);
    return ok(rows);
  } catch (cause) {
    return err(StoreErrors.queryFailed({ cause, what: "read the Claude fallback requests" }));
  }
}
