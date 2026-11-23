/**
 * The three landing registers against a REAL store: the facts an in-memory port cannot prove — the CHECK
 * constraints, the one-time import committing its marker and rows together under two racing first readers,
 * `ON CONFLICT DO NOTHING` deciding idempotency, and the compare-and-set predicate deciding a real race.
 *
 * OPT-IN, and never in CI: it needs a real, migrated local store, and there is none in any lane. Point it at a
 * THROWAWAY database in the running stack — never `postgres`, which is the live fleet's. This file deletes every
 * row of `landing_press`, `landing_read_cursor` and `codex_supersession`, and those three registers' import
 * markers, before and after every case:
 *
 *   createdb -h 127.0.0.1 -p 55322 -U postgres landing_registers_proof
 *   SLOPWEAVER_STORE_URL=postgresql://postgres:postgres@127.0.0.1:55322/landing_registers_proof slopweaver store push
 *   LANDING_REGISTERS_PROOF_URL=postgresql://postgres:postgres@127.0.0.1:55322/landing_registers_proof \
 *     yarn vitest run --config config/vitest/integration.ts src/__tests__/integration/landingRegistersStore.test.ts
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { inArray } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { storeSupersessionPort } from "../../codex/supersessionPort.js";
import { productionSupersessionSeams } from "../../codex/supersessionStore.js";
import { unwrap, unwrapErr } from "../../lib/result.js";
import { type PressRecord, pressKey } from "../../review/pressJournal.js";
import { storePressJournalPort } from "../../review/pressJournalPort.js";
import { productionPressJournalSeams } from "../../review/pressJournalStoreRows.js";
import type { ReadRecord } from "../../review/readJournal.js";
import { storeReadJournalPort } from "../../review/readJournalPort.js";
import { productionReadJournalSeams, readJournalRowsOver } from "../../review/readJournalStoreRows.js";
import { stateHomePaths } from "../../stateHome.js";
import { openStore, STORE_URL_ENV, type StoreClient } from "../../store/client.js";
import { codexSupersessionTable } from "../../store/schema/codexSupersession.js";
import { HOME_FILE_IMPORT_REGISTERS, homeFileImportTable } from "../../store/schema/homeFileImport.js";
import { landingPressTable } from "../../store/schema/landingPress.js";
import { landingReadCursorTable } from "../../store/schema/landingReadCursor.js";

const PROOF_URL = process.env["LANDING_REGISTERS_PROOF_URL"];
const SELECTION = "acme/widgets@ada";

const PRESS: PressRecord = {
  atIso: "2026-10-31T09:00:00.000Z",
  entryState: "QUEUED",
  headOid: "a".repeat(40),
  number: 7,
  repoSlug: "acme/widgets",
};

const READ: ReadRecord = { atIso: "2026-10-31T09:00:00.000Z", dispatchable: 1, rows: 3, selection: SELECTION };

describe.skipIf(PROOF_URL === undefined)("the landing registers in a real store", () => {
  let client: StoreClient;
  let home = "";

  const presses = storePressJournalPort({ seams: productionPressJournalSeams() });
  const reads = storeReadJournalPort({ seams: productionReadJournalSeams() });
  const supersessions = storeSupersessionPort({ seams: productionSupersessionSeams() });

  const clearTheRegisters = async (): Promise<void> => {
    await client.db.delete(landingPressTable);
    await client.db.delete(landingReadCursorTable);
    await client.db.delete(codexSupersessionTable);
    await client.db
      .delete(homeFileImportTable)
      .where(inArray(homeFileImportTable.register, HOME_FILE_IMPORT_REGISTERS));
  };

  beforeAll(() => {
    client = openStore({ url: PROOF_URL! });
  });

  afterAll(async () => {
    await clearTheRegisters();
    await client.close();
  });

  beforeEach(async () => {
    // Per case, not once: `setup-ambient-home.ts` clears the selector after EVERY test.
    process.env[STORE_URL_ENV] = PROOF_URL!;
    await clearTheRegisters();
    home = mkdtempSync(join(tmpdir(), "landing-registers-proof-"));
  });

  afterEach(() => {
    rmSync(home, { force: true, recursive: true });
  });

  it("refuses a malformed row at the table: the CHECKs, not the decoder, are the last word", async () => {
    await expect(client.db.insert(landingPressTable).values({ ...PRESS, pressKey: "not-a-sha" })).rejects.toThrow();
    await expect(
      client.db.insert(landingReadCursorTable).values({ ...READ, dispatchable: 4, revision: 1 }),
    ).rejects.toThrow();
    await expect(
      client.db.insert(codexSupersessionTable).values({
        artifactId: "art-1",
        atIso: PRESS.atIso,
        branch: "feature",
        kind: "wording",
        propertyId: "prop-1",
        reason: "reworded",
        replacedBy: "prop-2",
      }),
    ).rejects.toThrow();
  });

  it("imports the press file ONCE under two racing first readers, and ignores the file after", async () => {
    const second: PressRecord = { ...PRESS, atIso: "2026-10-31T10:00:00.000Z", headOid: "b".repeat(40) };
    writeFileSync(
      stateHomePaths({ home }).landingPressesJsonl,
      `${JSON.stringify(PRESS)}\n${JSON.stringify(second)}\n`,
      "utf8",
    );

    const [left, right] = await Promise.all([presses.readLatest({ home }), presses.readLatest({ home })]);
    writeFileSync(stateHomePaths({ home }).landingPressesJsonl, "{ not json\n", "utf8");
    const after = unwrap(await presses.readLatest({ home }));
    const stored = await client.db.select().from(landingPressTable);
    const markers = await client.db.select().from(homeFileImportTable);

    expect(unwrap(left).get("acme/widgets#7")).toStrictEqual({ atIso: second.atIso, headOid: second.headOid });
    expect(unwrap(right).get("acme/widgets#7")).toStrictEqual({ atIso: second.atIso, headOid: second.headOid });
    expect(after.get("acme/widgets#7")).toStrictEqual({ atIso: second.atIso, headOid: second.headOid });
    expect(stored.map((row) => row.pressKey).toSorted()).toStrictEqual(
      [pressKey({ record: PRESS }), pressKey({ record: second })].toSorted(),
    );
    expect(markers.map((row) => [row.register, row.sourceState, row.records])).toStrictEqual([
      ["landing-presses", "present", 2],
    ]);
  });

  it("marks an absent press file imported, so a file appearing later is never merged in", async () => {
    unwrap(await presses.readLatest({ home }));
    writeFileSync(stateHomePaths({ home }).landingPressesJsonl, `${JSON.stringify(PRESS)}\n`, "utf8");

    const after = unwrap(await presses.readLatest({ home }));
    const markers = await client.db.select().from(homeFileImportTable);

    expect(after.size).toBe(0);
    expect(markers.map((row) => [row.register, row.sourceState, row.records])).toStrictEqual([
      ["landing-presses", "absent", 0],
    ]);
  });

  it("refuses a marker that imported records over a table since emptied, never an empty register", async () => {
    writeFileSync(stateHomePaths({ home }).landingPressesJsonl, `${JSON.stringify(PRESS)}\n`, "utf8");
    unwrap(await presses.readLatest({ home }));
    await client.db.delete(landingPressTable);

    const refused = unwrapErr(await presses.readLatest({ home }));

    expect(refused.message).toContain("the marker says 1 record(s) were imported from the old file");
  });

  it("appends a press idempotently, and refuses a different press under the same key", async () => {
    unwrap(await presses.append({ home, record: PRESS }));
    unwrap(await presses.append({ home, record: PRESS }));
    const conflict = unwrapErr(await presses.append({ home, record: { ...PRESS, entryState: "" } }));
    const stored = await client.db.select().from(landingPressTable);

    expect(stored.map((row) => row.entryState)).toStrictEqual(["QUEUED"]);
    expect(conflict.code).toBe("PRESS_KEY_CONFLICT");
  });

  it("records a read at revision 1, then 2, importing the old file first", async () => {
    const earlier: ReadRecord = { ...READ, atIso: "2026-10-31T08:00:00.000Z" };
    writeFileSync(
      stateHomePaths({ home }).landingReadsJson,
      JSON.stringify({ [SELECTION]: { atIso: earlier.atIso, dispatchable: 1, rows: 3 } }),
      "utf8",
    );

    unwrap(await reads.record({ home, record: READ }));
    const [row] = await client.db.select().from(landingReadCursorTable);
    const latest = unwrap(await reads.readLatest({ home }));

    expect(row!.revision).toBe(2);
    expect(latest.get(SELECTION)).toStrictEqual(READ);
  });

  it("lets exactly ONE of two writers holding the same cursor revision commit", async () => {
    unwrap(await reads.record({ home, record: READ }));
    const first = readJournalRowsOver({ client: openStore({ url: PROOF_URL! }) });
    const second = readJournalRowsOver({ client: openStore({ url: PROOF_URL! }) });
    try {
      const [won, lost] = await Promise.all([
        first.updateAt({ expected: { ...READ, revision: 1 }, record: { ...READ, atIso: "2026-10-31T09:30:00.000Z" } }),
        second.updateAt({ expected: { ...READ, revision: 1 }, record: { ...READ, atIso: "2026-10-31T09:45:00.000Z" } }),
      ]);
      const committed = [unwrap(won), unwrap(lost)].filter((stored) => stored !== undefined);

      expect(committed.map((stored) => stored.revision)).toStrictEqual([2]);
    } finally {
      await first.close();
      await second.close();
    }
  });

  it("refuses to write over a row changed after it was checked, even at the same revision", async () => {
    unwrap(await reads.record({ home, record: READ }));
    await client.db.update(landingReadCursorTable).set({ atIso: "nope" });
    const rows = readJournalRowsOver({ client: openStore({ url: PROOF_URL! }) });
    try {
      const written = unwrap(
        await rows.updateAt({
          expected: { ...READ, revision: 1 },
          record: { ...READ, atIso: "2026-10-31T09:30:00.000Z" },
        }),
      );
      const [row] = await client.db.select().from(landingReadCursorTable);

      expect(written).toBeUndefined();
      expect(row!.atIso).toBe("nope");
      expect(row!.revision).toBe(1);
    } finally {
      await rows.close();
    }
  });

  it("imports the supersession file last-wins, and refuses a different retirement after", async () => {
    const wording = {
      artifactId: "art-1",
      atIso: "2026-10-31T08:00:00.000Z",
      propertyId: "prop-1",
      reason: "reworded",
      replacedBy: "prop-2",
    };
    const later = { ...wording, atIso: "2026-10-31T08:30:00.000Z", replacedBy: "prop-3" };
    writeFileSync(
      stateHomePaths({ home }).codexSupersessionsJsonl,
      `${JSON.stringify(wording)}\n${JSON.stringify(later)}\n`,
      "utf8",
    );

    const read = unwrap(await supersessions.read({ home }));
    const again = unwrap(await supersessions.append({ home, row: later }));
    const refused = unwrapErr(await supersessions.append({ home, row: { ...later, replacedBy: "prop-4" } }));
    const stored = await client.db.select().from(codexSupersessionTable);

    expect(read.get("art-1")).toStrictEqual(later);
    expect(again).toStrictEqual(later);
    expect(refused.code).toBe("ALREADY_SUPERSEDED");
    expect(stored.map((row) => [row.artifactId, row.kind, row.replacedBy])).toStrictEqual([
      ["art-1", "wording", "prop-3"],
    ]);
  });
});
