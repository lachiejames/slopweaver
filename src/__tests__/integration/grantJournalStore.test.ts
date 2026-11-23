/**
 * The grant journal's witness: entries written through the REAL store-backed port, read back in written order, one
 * grant and one performance per id held by the partial unique indexes — a legacy line-hash row included — and a
 * one-time import that refuses rather than overwrites a stored row the legacy journal disagrees with.
 *
 * OPT-IN, and never in CI: it needs a real, migrated local store, and there is none in any lane. Point it at a
 * THROWAWAY database in the running stack — never `postgres`, which is the live fleet's:
 *
 *   createdb -h 127.0.0.1 -p 55322 -U postgres grant_journal_proof
 *   SLOPWEAVER_STORE_URL=postgresql://postgres:postgres@127.0.0.1:55322/grant_journal_proof slopweaver store push
 *   GRANT_STORE_PROOF_URL=postgresql://postgres:postgres@127.0.0.1:55322/grant_journal_proof \
 *     yarn vitest run --config config/vitest/integration.ts src/__tests__/integration/grantJournalStore.test.ts
 *
 * Every row it writes carries a per-run grant id and is deleted afterwards.
 */
import { randomUUID } from "node:crypto";

import { like } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { GrantEntry, GrantRow } from "../../grants/grant.js";
import type { GrantJournalPort } from "../../grants/port.js";
import { storeGrantJournalPort } from "../../grants/storePort.js";
import { grantRowsOver } from "../../grants/storeRows.js";
import { ok, unwrap, unwrapErr } from "../../lib/result.js";
import { openStore, type StoreClient } from "../../store/client.js";
import { FleetImportErrors } from "../../store/fleet/errors.js";
import { grantEntryRow, grantImportDivergences, projectGrantLine } from "../../store/fleet/grantRow.js";
import { importGrantRows, readStoredGrantRows } from "../../store/fleet/store.js";
import { grantRowTable } from "../../store/schema/ledgers.js";

const PROOF_URL = process.env["GRANT_STORE_PROOF_URL"];

describe.skipIf(PROOF_URL === undefined)("the grant journal in the store (live store)", () => {
  const run = randomUUID().slice(0, 8);
  /** The port names a home; this proof's store is chosen by its own connection, so any path stands in. */
  const home = "/proof/home";
  let client: StoreClient;
  let port: GrantJournalPort;
  let nonce = 0;

  const grant = ({ id, change }: { id: string; change: string }): GrantRow => ({
    anchor: "transcript:aaaa#bbbb",
    change,
    changeKind: "literal",
    id,
    pinnedAtRecord: false,
    recordedAtIso: "2026-10-01T00:00:00.000Z",
    recordedBySessionId: "session-proof",
    target: { kind: "system", name: "linear" },
  });
  const performance = ({ grantId }: { grantId: string }): GrantEntry => ({
    kind: "performance",
    performance: {
      grantId,
      performedAtIso: "2026-10-01T00:05:00.000Z",
      performedBySessionId: "session-proof",
      wrote: "x",
    },
  });
  const ofRun = async ({ grantId }: { grantId: string }): Promise<readonly GrantEntry[]> =>
    unwrap(await port.readEntries({ home })).filter(
      (entry) =>
        (entry.kind === "grant" && entry.grant.id === grantId) ||
        (entry.kind === "performance" && entry.performance.grantId === grantId) ||
        (entry.kind === "refusal" && entry.refusal.grantId === grantId),
    );

  beforeAll(() => {
    client = openStore({ url: PROOF_URL! });
    // Each operation opens and closes its own connection, exactly as the production seams do.
    port = storeGrantJournalPort({
      seams: {
        connect: () => Promise.resolve(ok(grantRowsOver({ client: openStore({ url: PROOF_URL! }) }))),
        refusalNonce: () => {
          nonce += 1;
          return `${run}-${String(nonce)}`;
        },
      },
    });
  });

  afterAll(async () => {
    await client.db.delete(grantRowTable).where(like(grantRowTable.grantId, `proof-${run}-%`));
    await client.close();
  });

  it("writes a grant, one performance and many refusals, refuses a second grant or performance, and reads back in written order", async () => {
    const grantId = `proof-${run}-journal`;
    const recorded: GrantEntry = { grant: grant({ change: "x", id: grantId }), kind: "grant" };
    const refusal = ({ why }: { why: string }): GrantEntry => ({
      kind: "refusal",
      refusal: {
        code: "RAIL_CROSSED",
        grantId,
        refusedAtIso: "2026-10-01T00:04:00.000Z",
        refusedBySessionId: "s",
        why,
      },
    });
    unwrap(await port.appendEntry({ entry: refusal({ why: "first" }), home }));
    unwrap(await port.appendEntry({ entry: recorded, home }));
    unwrap(await port.appendEntry({ entry: refusal({ why: "second" }), home }));
    unwrap(await port.appendEntry({ entry: performance({ grantId }), home }));

    expect(unwrapErr(await port.appendEntry({ entry: recorded, home })).code).toBe("GRANT_ID_TAKEN");
    expect(unwrapErr(await port.appendEntry({ entry: performance({ grantId }), home })).code).toBe(
      "GRANT_ALREADY_PERFORMED",
    );
    expect(await ofRun({ grantId })).toEqual([
      refusal({ why: "first" }),
      recorded,
      refusal({ why: "second" }),
      performance({ grantId }),
    ]);
  });

  it("refuses a performance against a LEGACY row's, whose import key is a line hash rather than a derived one", async () => {
    const grantId = `proof-${run}-legacy`;
    const legacy = performance({ grantId });
    const row = unwrap(grantEntryRow({ entry: legacy, importKey: `line-hash-${run}`, verbatim: legacy }));
    expect(unwrap(await importGrantRows({ client, rows: [row] }))).toBe(1);
    expect(unwrapErr(await port.appendEntry({ entry: legacy, home })).code).toBe("GRANT_ALREADY_PERFORMED");
  });

  it("commits no batch of an import whose later batch fails, so no skipped line is left unchecked", async () => {
    const grantIdOf = ({ n }: { n: number }): string => `proof-${run}-batch-${String(n)}`;
    const rows = Array.from({ length: 501 }, (_, n) => {
      const entry: GrantEntry = { grant: grant({ change: "x", id: grantIdOf({ n }) }), kind: "grant" };
      return unwrap(grantEntryRow({ entry, importKey: `batch-${run}-${String(n)}`, verbatim: entry }));
    });
    // A valid JavaScript instant Postgres cannot hold, in the 501st row, so it lands in the second batch.
    const last = rows[500]!;
    rows[500] = { ...last, recordedAt: new Date("-271821-04-20T00:00:00.000Z") };

    expect(unwrapErr(await importGrantRows({ client, rows })).code).toBe("STORE_QUERY_FAILED");
    expect(await ofRun({ grantId: grantIdOf({ n: 0 }) })).toEqual([]);
  });

  it("imports once, writes nothing the second time, and names a legacy line the stored row disagrees with", async () => {
    const grantId = `proof-${run}-import`;
    const lineOf = ({ change }: { change: string }): string =>
      JSON.stringify({ grant: grant({ change, id: grantId }), kind: "grant" });
    const project = ({ change, lineNumber }: { change: string; lineNumber: number }) => ({
      lineNumber,
      row: unwrap(projectGrantLine({ line: lineOf({ change }), lineNumber, path: "/proof" })),
    });
    const first = [project({ change: "x", lineNumber: 1 })];
    const edited = [project({ change: "y", lineNumber: 2 })];

    expect(unwrap(await importGrantRows({ client, rows: first.map(({ row }) => row) }))).toBe(1);
    expect(unwrap(await importGrantRows({ client, rows: first.map(({ row }) => row) }))).toBe(0);
    expect(unwrap(await importGrantRows({ client, rows: edited.map(({ row }) => row) }))).toBe(0);
    const stored = unwrap(await readStoredGrantRows({ client }));
    expect(grantImportDivergences({ path: "/proof", projected: first, stored })).toEqual([]);
    expect(grantImportDivergences({ path: "/proof", projected: edited, stored })).toEqual([
      FleetImportErrors.grantImportDiverged({ entryKind: "grant", grantId, lineNumber: 2, path: "/proof" }),
    ]);
    expect(await ofRun({ grantId })).toEqual([{ grant: grant({ change: "x", id: grantId }), kind: "grant" }]);
  });
});
