/**
 * The Claude fallback tables' witness: a request and its receipt written through the REAL store-backed port,
 * read back by it, never overwritten by a second writer, and a one-time import that refuses rather than
 * overwrites a stored row the legacy directory disagrees with.
 *
 * OPT-IN, and never in CI: it needs a real, migrated local store, and there is none in any lane. Point it at a
 * THROWAWAY database in the running stack — never `postgres`, which is the live fleet's:
 *
 *   createdb -h 127.0.0.1 -p 55322 -U postgres codex_fallback_proof
 *   SLOPWEAVER_STORE_URL=postgresql://postgres:postgres@127.0.0.1:55322/codex_fallback_proof slopweaver store push
 *   CODEX_FALLBACK_PROOF_URL=postgresql://postgres:postgres@127.0.0.1:55322/codex_fallback_proof \
 *     yarn vitest run --config config/vitest/integration.ts src/__tests__/integration/codexFallbackStore.test.ts
 *
 * Every row it writes carries a per-run request id and is deleted afterwards.
 */
import { randomUUID } from "node:crypto";

import { like } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { FallbackRegisterPort } from "../../codex/fallbackPort.js";
import { storeFallbackRegisterPort } from "../../codex/fallbackStorePort.js";
import { fallbackRowsOver } from "../../codex/fallbackStoreRows.js";
import { ok, unwrap, unwrapErr } from "../../lib/result.js";
import { openStore, type StoreClient } from "../../store/client.js";
import { fallbackImportDivergences, projectFallbackRequest } from "../../store/fleet/codexFallback.js";
import { importFallbackRequests, readStoredFallbackRequests } from "../../store/fleet/codexFallbackStore.js";
import { codexFallbackRequestTable } from "../../store/schema/codexFallback.js";

const PROOF_URL = process.env["CODEX_FALLBACK_PROOF_URL"];

describe.skipIf(PROOF_URL === undefined)("Claude fallback documents in the store (live store)", () => {
  const run = randomUUID().slice(0, 8);
  /** The port names a home; this proof's store is chosen by its own connection, so any path stands in. */
  const home = "/proof/home";
  let client: StoreClient;
  let port: FallbackRegisterPort;

  beforeAll(() => {
    client = openStore({ url: PROOF_URL! });
    // Each operation opens and closes its own connection, exactly as the production seams do.
    port = storeFallbackRegisterPort({
      seams: { connect: () => Promise.resolve(ok(fallbackRowsOver({ client: openStore({ url: PROOF_URL! }) }))) },
    });
  });

  afterAll(async () => {
    // The receipt rows go with their request: the key cascades.
    await client.db
      .delete(codexFallbackRequestTable)
      .where(like(codexFallbackRequestTable.requestId, `proof-${run}-%`));
    await client.close();
  });

  it("writes a request and its receipt once, and refuses a second writer of either", async () => {
    const requestId = `proof-${run}-once`;
    const requestText = `{"requestId":"${requestId}","mode":"plan"}\n`;
    expect(unwrap(await port.writeRequest({ home, requestId, requestText }))).toBe(undefined);
    expect(unwrapErr(await port.writeRequest({ home, requestId, requestText: "{}" })).code).toBe(
      "FALLBACK_REQUEST_ID_TAKEN",
    );
    expect(unwrap(await port.readRequest({ home, requestId }))).toEqual({
      receiptRecorded: false,
      requestId,
      requestText,
    });
    expect(unwrap(await port.writeReceipt({ home, receiptText: "first", requestId }))).toBe(undefined);
    expect(unwrapErr(await port.writeReceipt({ home, receiptText: "second", requestId })).code).toBe(
      "FALLBACK_RECEIPT_ALREADY_RECORDED",
    );
    const stored = unwrap(await readStoredFallbackRequests({ client }));
    expect(stored.find((row) => row.requestId === requestId)).toEqual({ receiptText: "first", requestId, requestText });
  });

  // `record` reads the request before it writes, so only a request deleted in between reaches this: the
  // foreign key refuses the statement, and the port reports it as the statement's failure.
  it("refuses a receipt for a request the store never took — the foreign key, never a dangling row", async () => {
    const requestId = `proof-${run}-orphan`;
    expect(unwrapErr(await port.writeReceipt({ home, receiptText: "{}", requestId })).code).toBe(
      "FALLBACK_STORE_UNAVAILABLE",
    );
    expect(unwrapErr(await port.readRequest({ home, requestId })).code).toBe("FALLBACK_REQUEST_NOT_FOUND");
  });

  it("imports once, writes nothing the second time, and names a legacy text the stored row disagrees with", async () => {
    const requestId = `proof-${run}-import`;
    const project = ({ receiptText }: { receiptText: string }) =>
      unwrap(projectFallbackRequest({ path: "/proof", receiptText, requestId, requestText: "{}" }));
    const first = unwrap(await importFallbackRequests({ client, projected: [project({ receiptText: "first" })] }));
    const again = [project({ receiptText: "first" })];
    const second = unwrap(await importFallbackRequests({ client, projected: again }));
    const edited = [project({ receiptText: "second" })];
    expect(unwrap(await importFallbackRequests({ client, projected: edited }))).toEqual({ receipts: 0, requests: 0 });
    const stored = new Map(
      unwrap(await readStoredFallbackRequests({ client })).map((row) => [row.requestId, row] as const),
    );
    const pathOf = (): string => "/proof";

    expect(first).toEqual({ receipts: 1, requests: 1 });
    expect(second).toEqual({ receipts: 0, requests: 0 });
    expect(fallbackImportDivergences({ pathOf, projected: again, stored })).toEqual([]);
    expect(fallbackImportDivergences({ pathOf, projected: edited, stored }).map((one) => one.message)).toEqual([
      `/proof's receipt differs from the stored receipt for ${requestId}; the stored row stands and was not overwritten`,
    ]);
    expect(stored.get(requestId)!.receiptText).toBe("first");
  });
});
