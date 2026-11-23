/**
 * The Codex fleet-cap record against a REAL store: the facts an in-memory port cannot prove — the singleton CHECK,
 * the upsert's ordering predicate deciding which of two reads stands, the attempt marker's own guarded UPDATE and
 * its pairing CHECK, and the `jsonb` round trip.
 *
 * OPT-IN, and never in CI: it needs a real, migrated local store, and there is none in any lane. Point it at a
 * THROWAWAY database in the running stack — never `postgres`, which is the live fleet's, and whose
 * `codex_fleet_cap` row IS this install's record. This file deletes that table's singleton row before and after
 * every case:
 *
 *   createdb -h 127.0.0.1 -p 55322 -U postgres codex_fleet_cap_proof
 *   SLOPWEAVER_STORE_URL=postgresql://postgres:postgres@127.0.0.1:55322/codex_fleet_cap_proof slopweaver store push
 *   CODEX_FLEET_CAP_PROOF_URL=postgresql://postgres:postgres@127.0.0.1:55322/codex_fleet_cap_proof \
 *     yarn vitest run --config config/vitest/integration.ts src/__tests__/integration/codexFleetCapStore.test.ts
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { codexFleetCapPort, readCodexFleetCapRecord } from "../../codex/fleetCapPort.js";
import type { CodexFleetCapRecord } from "../../codex/fleetCapRecord.js";
import { codexFleetCapRowsOver } from "../../codex/fleetCapStoreRows.js";
import { unwrap } from "../../lib/result.js";
import { openStore, STORE_URL_ENV, type StoreClient } from "../../store/client.js";
import { CODEX_FLEET_CAP_ID, codexFleetCapTable } from "../../store/schema/codexFleetCap.js";

const PROOF_URL = process.env["CODEX_FLEET_CAP_PROOF_URL"];

const EARLIER: CodexFleetCapRecord = {
  readAtIso: "2026-10-31T09:00:00.000Z",
  rows: [{ alias: "codex-one", resetAtIso: "2026-11-03T17:09:58.000Z", state: "near-cap" }],
};
const LATER: CodexFleetCapRecord = {
  readAtIso: "2026-10-31T09:00:05.000Z",
  rows: [{ alias: "codex-one", state: "eligible", week: { resetAtIso: "2026-11-03T17:09:58.000Z", usedPercent: 40 } }],
};

describe.skipIf(PROOF_URL === undefined)("the Codex fleet-cap record in a real store", () => {
  let client: StoreClient;
  let home = "";
  const port = codexFleetCapPort();

  const deleteTheRow = async (): Promise<void> => {
    await client.db.delete(codexFleetCapTable).where(eq(codexFleetCapTable.id, CODEX_FLEET_CAP_ID));
  };

  beforeAll(() => {
    client = openStore({ url: PROOF_URL! });
  });

  afterAll(async () => {
    await deleteTheRow();
    await client.close();
  });

  beforeEach(async () => {
    // Per case: `setup-ambient-home.ts` clears the selector after EVERY test.
    process.env[STORE_URL_ENV] = PROOF_URL!;
    await deleteTheRow();
    home = mkdtempSync(join(tmpdir(), "codex-fleet-cap-proof-"));
  });

  afterEach(() => {
    rmSync(home, { force: true, recursive: true });
  });

  it("refuses a second row: the table is a singleton by CHECK, not by convention", async () => {
    await expect(
      client.db.insert(codexFleetCapTable).values({
        document: EARLIER,
        id: "another",
        readAt: new Date(EARLIER.readAtIso),
        revision: 1,
      }),
    ).rejects.toThrow();
  });

  it("reads absent on an empty table, then the record filed, round-tripped through jsonb", async () => {
    expect(await readCodexFleetCapRecord({ home, port })).toEqual({ kind: "absent" });
    expect(unwrap(await port.file({ home, record: LATER }))).toBe("filed");
    expect(await readCodexFleetCapRecord({ home, port })).toEqual({ kind: "record", record: LATER });
  });

  it("keeps the later read when an earlier one files after it, and bumps the revision only on a landing", async () => {
    expect(unwrap(await port.file({ home, record: LATER }))).toBe("filed");
    expect(unwrap(await port.file({ home, record: EARLIER }))).toBe("kept-later");
    expect(unwrap(await port.file({ home, record: LATER }))).toBe("filed");
    const [row] = await client.db.select().from(codexFleetCapTable);
    expect([row!.revision, row!.readAt.toISOString(), await readCodexFleetCapRecord({ home, port })]).toEqual([
      2,
      LATER.readAtIso,
      { kind: "record", record: LATER },
    ]);
  });

  it("lets two concurrent filings settle on the later one, whichever lands first", async () => {
    const filings = await Promise.all([port.file({ home, record: EARLIER }), port.file({ home, record: LATER })]);
    expect(filings.map((filing) => filing.isOk())).toEqual([true, true]);
    expect(await readCodexFleetCapRecord({ home, port })).toEqual({ kind: "record", record: LATER });
  });

  it("runs the record's statements over an open client: none, then the filed document, then a refused older one", async () => {
    const rows = codexFleetCapRowsOver({ client });
    expect(unwrap(await rows.read())).toBeUndefined();
    expect(unwrap(await rows.fileIfNotOlder({ record: LATER }))).toBe(true);
    expect(unwrap(await rows.fileIfNotOlder({ record: EARLIER }))).toBe(false);
    expect(unwrap(await rows.read())).toEqual({ document: LATER, unfiled: null });
  });

  it("marks an attempt only on a filed row, and never over a later attempt", async () => {
    const rows = codexFleetCapRowsOver({ client });
    const later = { attemptedAtIso: LATER.readAtIso, why: "a refusal" };
    const earlier = { attemptedAtIso: EARLIER.readAtIso, why: "a refusal" };
    expect(unwrap(await rows.markUnfiledIfNotOlder({ unfiled: later }))).toBe(false);
    expect(unwrap(await rows.read())).toBeUndefined();
    expect(unwrap(await rows.fileIfNotOlder({ record: EARLIER }))).toBe(true);
    expect(unwrap(await rows.markUnfiledIfNotOlder({ unfiled: later }))).toBe(true);
    expect(unwrap(await rows.markUnfiledIfNotOlder({ unfiled: earlier }))).toBe(false);
    expect(unwrap(await rows.markUnfiledIfNotOlder({ unfiled: { ...later, why: "again" } }))).toBe(true);
    expect(unwrap(await rows.read())).toEqual({
      document: EARLIER,
      unfiled: { attemptedAtIso: LATER.readAtIso, why: "again" },
    });
    expect(await readCodexFleetCapRecord({ home, port })).toEqual({
      attemptedAtIso: LATER.readAtIso,
      kind: "unfiled",
      why: "again",
    });
  });

  it("leaves the marker alone on a record filing, so a record at or after it settles the read", async () => {
    expect(unwrap(await port.file({ home, record: EARLIER }))).toBe("filed");
    const rows = codexFleetCapRowsOver({ client });
    unwrap(await rows.markUnfiledIfNotOlder({ unfiled: { attemptedAtIso: LATER.readAtIso, why: "a refusal" } }));
    expect(unwrap(await port.file({ home, record: LATER }))).toBe("filed");
    const [row] = await client.db.select().from(codexFleetCapTable);
    expect([row!.attemptedAt!.toISOString(), await readCodexFleetCapRecord({ home, port })]).toEqual([
      LATER.readAtIso,
      { kind: "record", record: LATER },
    ]);
  });

  it("refuses a marker without its instant: the pair is held together by CHECK", async () => {
    expect(unwrap(await port.file({ home, record: EARLIER }))).toBe("filed");
    await expect(
      client.db
        .update(codexFleetCapTable)
        .set({ unfiled: { attemptedAtIso: LATER.readAtIso, why: "x" } })
        .where(eq(codexFleetCapTable.id, CODEX_FLEET_CAP_ID)),
    ).rejects.toThrow();
  });

  it("reads a row that does not decode as malformed, never as absent", async () => {
    await client.db.insert(codexFleetCapTable).values({
      document: { ...EARLIER, readAtIso: "yesterday" },
      id: CODEX_FLEET_CAP_ID,
      readAt: new Date(EARLIER.readAtIso),
      revision: 1,
    });
    expect(await readCodexFleetCapRecord({ home, port })).toEqual({
      kind: "malformed",
      why: 'carries readAtIso "yesterday", which is not an instant',
    });
  });
});
