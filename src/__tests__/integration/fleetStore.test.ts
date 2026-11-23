/**
 * The fleet's state against a REAL store: the facts the in-memory port cannot prove — the CHECKs, the one-time
 * imports deciding a real race, the compare-and-set predicate, and the head counter handing every concurrent append
 * its own sequence.
 *
 * OPT-IN, and never in CI: it needs a real, migrated local store, and there is none in any lane. Point it at a
 * THROWAWAY database in the running stack — never `postgres`, which is the live fleet's, and whose `fleet_*` rows
 * ARE this install's fleet. This file deletes every row of those three tables before and after every case:
 *
 *   createdb -h 127.0.0.1 -p 55322 -U postgres fleet_store_proof
 *   SLOPWEAVER_STORE_URL=postgresql://postgres:postgres@127.0.0.1:55322/fleet_store_proof slopweaver store push
 *   FLEET_STORE_PROOF_URL=postgresql://postgres:postgres@127.0.0.1:55322/fleet_store_proof \
 *     yarn vitest run --config config/vitest/integration.ts src/__tests__/integration/fleetStore.test.ts
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { asc, eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { CmuxReviveEvent } from "../../cmux/reviveJournal.js";
import type { FleetJournalEvent } from "../../fleet/journal.js";
import { FLEET_JOURNAL_KEPT_ROWS, FLEET_JOURNAL_TAIL_ROWS } from "../../fleet/journalTail.js";
import { storeFleetPort } from "../../fleet/storePort.js";
import { fleetRowsOver, productionFleetStoreSeams } from "../../fleet/storeRows.js";
import { unwrap } from "../../lib/result.js";
import { openStore, STORE_URL_ENV, type StoreClient } from "../../store/client.js";
import { fleetConfigTable, fleetJournalEventTable, fleetJournalTable } from "../../store/schema/fleet.js";

const PROOF_URL = process.env["FLEET_STORE_PROOF_URL"];
const AT = "2026-10-31T09:00:00.000Z";

/** A recovery event, distinguished by the workspace it names. */
const gone = ({ workspace }: { workspace: number }): FleetJournalEvent => ({
  atIso: AT,
  attemptId: "00000000-0000-4000-8000-000000000001",
  kind: "seat-gone",
  schemaVersion: 1,
  workspaceRef: `workspace:${String(workspace)}`,
});

const HELD: CmuxReviveEvent = { atIso: AT, hungSinceIso: AT, kind: "restart-held", schemaVersion: 1 };

describe.skipIf(PROOF_URL === undefined)("the fleet's state in a real store", () => {
  let client: StoreClient;
  let home = "";

  const port = storeFleetPort({ seams: productionFleetStoreSeams() });

  const deleteEveryRow = async (): Promise<void> => {
    await client.db.delete(fleetJournalEventTable);
    await client.db.delete(fleetJournalTable);
    await client.db.delete(fleetConfigTable);
  };

  /** Write one legacy file under `<home>/fleet/`. */
  const seedLegacy = ({ name, text }: { name: string; text: string }): void => {
    mkdirSync(join(home, "fleet"), { recursive: true });
    writeFileSync(join(home, "fleet", name), text);
  };

  beforeAll(() => {
    client = openStore({ url: PROOF_URL! });
  });

  afterAll(async () => {
    await deleteEveryRow();
    await client.close();
  });

  beforeEach(async () => {
    // Per case, not once: `setup-ambient-home.ts` clears the selector after EVERY test.
    process.env[STORE_URL_ENV] = PROOF_URL!;
    await deleteEveryRow();
    home = mkdtempSync(join(tmpdir(), "fleet-store-proof-"));
  });

  afterEach(() => {
    rmSync(home, { force: true, recursive: true });
  });

  it("refuses a second config row, an out-of-range capacity, and a live event that is not a decoded object", async () => {
    await expect(client.db.insert(fleetConfigTable).values({ capacity: 3, id: "another" })).rejects.toThrow();
    await expect(client.db.insert(fleetConfigTable).values({ capacity: 101, id: "fleet" })).rejects.toThrow();
    await client.db.insert(fleetJournalTable).values({ journal: "resume", importSource: "absent" });
    await expect(
      client.db.insert(fleetJournalEventTable).values({ event: null, journal: "resume", sequence: 1 }),
    ).rejects.toThrow();
    await expect(
      client.db
        .insert(fleetJournalEventTable)
        .values({ event: ["not", "an", "object"], journal: "resume", sequence: 1 }),
    ).rejects.toThrow();
    await expect(
      client.db.insert(fleetJournalTable).values({ journal: "other", importSource: "absent" }),
    ).rejects.toThrow();
  });

  it("imports config.json once at revision 1, and the row outranks the file from then on", async () => {
    seedLegacy({ name: "config.json", text: JSON.stringify({ capacity: 7, schemaVersion: 1 }) });
    const imported = unwrap(await port.readConfig({ home }));
    seedLegacy({ name: "config.json", text: "{ not json" });
    const reread = unwrap(await port.readConfig({ home }));
    const rows = await client.db.select().from(fleetConfigTable);

    expect([imported, reread, rows.map((row) => [row.capacity, row.revision])]).toEqual([
      { capacity: 7, schemaVersion: 1 },
      { capacity: 7, schemaVersion: 1 },
      [[7, 1]],
    ]);
  });

  it("lets exactly ONE of two writers holding the same revision commit", async () => {
    unwrap(await port.writeConfig({ config: { capacity: 4, schemaVersion: 1 }, home }));
    const [before] = await client.db.select().from(fleetConfigTable);
    const first = fleetRowsOver({ client: openStore({ url: PROOF_URL! }) });
    const second = fleetRowsOver({ client: openStore({ url: PROOF_URL! }) });
    try {
      const [won, lost] = await Promise.all([
        first.updateConfig({ config: { capacity: 5, schemaVersion: 1 }, expectedRevision: before!.revision }),
        second.updateConfig({ config: { capacity: 6, schemaVersion: 1 }, expectedRevision: before!.revision }),
      ]);
      const committed = [unwrap(won), unwrap(lost)].filter((row) => row !== undefined);

      expect(committed.map((row) => row.revision)).toStrictEqual([before!.revision + 1]);
    } finally {
      await first.close();
      await second.close();
    }
  });

  it("imports a legacy journal with a placeholder where a line would not decode, and appends after it", async () => {
    seedLegacy({
      name: "resume.jsonl",
      text: [JSON.stringify(gone({ workspace: 1 })), '{"token":"xoxb-FIXTURE"', JSON.stringify(gone({ workspace: 3 }))]
        .join("\n")
        .concat("\n"),
    });
    const read = unwrap(await port.readResumeJournal({ home }));
    const appended = unwrap(await port.appendResumeEvent({ event: gone({ workspace: 4 }), home }));
    const rows = await client.db
      .select({ event: fleetJournalEventTable.event, line: fleetJournalEventTable.importLine })
      .from(fleetJournalEventTable)
      .where(eq(fleetJournalEventTable.journal, "resume"))
      .orderBy(asc(fleetJournalEventTable.sequence));
    const [head] = await client.db.select().from(fleetJournalTable).where(eq(fleetJournalTable.journal, "resume"));

    expect([read.events.length, read.unreadableAt, appended]).toEqual([2, [1], 4]);
    expect(rows.map((row) => [row.event === null, row.line])).toEqual([
      [false, 1],
      [true, 2],
      [false, 3],
      [false, null],
    ]);
    expect(JSON.stringify(rows)).not.toContain("xoxb-FIXTURE");
    expect([head!.latestSequence, head!.importSource, head!.importUnreadable]).toEqual([4, "present", 1]);
  });

  it("imports a journal exactly once when two importers race", async () => {
    seedLegacy({ name: "cmux-revive.jsonl", text: `${JSON.stringify(HELD)}\n${JSON.stringify(HELD)}\n` });
    const reads = await Promise.all([port.readCmuxReviveJournal({ home }), port.readCmuxReviveJournal({ home })]);
    const rows = await client.db
      .select()
      .from(fleetJournalEventTable)
      .where(eq(fleetJournalEventTable.journal, "cmux-revive"));

    expect([reads.map((read) => unwrap(read).events.length), rows.length]).toEqual([[2, 2], 2]);
  });

  it("gives each of many concurrent appends its own sequence, and the head moves by exactly that many", async () => {
    const before = unwrap(await port.newestCmuxReviveSequence({ home }));
    const sequences = await Promise.all(
      Array.from({ length: 12 }, () => port.appendCmuxReviveEvent({ event: HELD, home })),
    );
    const after = unwrap(await port.newestCmuxReviveSequence({ home }));

    expect([before, sequences.map((sequence) => unwrap(sequence)).toSorted((a, b) => a - b), after]).toEqual([
      0,
      Array.from({ length: 12 }, (_, index) => index + 1),
      12,
    ]);
  });

  it("keeps a restart a burst pushed out of the tail, by the kind its JSON names, past a flood of holds", async () => {
    const dismissed = ({ title }: { title: string }): CmuxReviveEvent => ({
      atIso: AT,
      button: "OK",
      kind: "dialog-dismissed",
      schemaVersion: 1,
      title,
    });
    const restart: CmuxReviveEvent = {
      appPid: 41,
      atIso: AT,
      hungSinceIso: AT,
      kind: "restart-started",
      schemaVersion: 1,
    };
    const held = ({ index }: { index: number }): CmuxReviveEvent => ({
      atIso: AT,
      hungSinceIso: `2026-10-30T09:${String(Math.floor(index / 60)).padStart(2, "0")}:${String(index % 60).padStart(2, "0")}.000Z`,
      kind: "restart-held",
      schemaVersion: 1,
    });
    const events = [
      dismissed({ title: "before the restart" }),
      restart,
      ...Array.from({ length: FLEET_JOURNAL_KEPT_ROWS + 1 }, (_, index) => held({ index })),
      ...Array.from({ length: FLEET_JOURNAL_TAIL_ROWS }, (_, index) => dismissed({ title: `dialog ${String(index)}` })),
    ];
    await client.db
      .insert(fleetJournalTable)
      .values({ importSource: "absent", journal: "cmux-revive", latestSequence: events.length });
    await client.db
      .insert(fleetJournalEventTable)
      .values(events.map((event, index) => ({ event, journal: "cmux-revive", sequence: index + 1 })));
    const read = unwrap(await port.readCmuxReviveJournal({ home }));

    expect([read.events.length, read.events[0], read.events[1], read.events.at(-1)]).toEqual([
      FLEET_JOURNAL_TAIL_ROWS + FLEET_JOURNAL_KEPT_ROWS + 1,
      restart,
      events[3],
      events.at(-1),
    ]);
  });
});
