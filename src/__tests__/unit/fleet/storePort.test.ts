/**
 * {@link storeFleetPort}'s orchestration over the in-memory rows (`../../fleetStoreFixture.ts`) and the REAL legacy
 * file reads: the row outranking the file, each one-time import, a damaged file refused and then superseded by a
 * write, a compare-and-set miss that is never retried, an outage that never falls back to a file, the journal
 * placeholders, the row tail, and the connection closed on every path.
 *
 * What only Postgres can decide — the CHECKs, the transactional import and the head counter under concurrency — is
 * the opt-in `integration/fleetStore.test.ts`.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { CmuxReviveEvent } from "../../../cmux/reviveJournal.js";
import { FleetErrors } from "../../../fleet/errors.js";
import type { FleetJournalEvent } from "../../../fleet/journal.js";
import { FLEET_JOURNAL_KEPT_ROWS, FLEET_JOURNAL_TAIL_ROWS } from "../../../fleet/journalTail.js";
import { type FleetRows, type FleetStoreSeams, storeFleetPort } from "../../../fleet/storePort.js";
import { err, ok, unwrap, unwrapErr } from "../../../lib/result.js";
import { type MemoryFleetStore, memoryFleetPort, memoryFleetSeams, memoryFleetStore } from "../../fleetStoreFixture.js";

const AT = "2026-10-31T09:00:00.000Z";
const ATTEMPT = "00000000-0000-4000-8000-000000000001";

/** The smallest recovery line: every field fixed-size or a stamp. */
const GONE: FleetJournalEvent = {
  atIso: AT,
  attemptId: ATTEMPT,
  kind: "seat-gone",
  schemaVersion: 1,
  workspaceRef: "workspace:1",
};

/** The smallest revive line. */
const HELD: CmuxReviveEvent = { atIso: AT, hungSinceIso: AT, kind: "restart-held", schemaVersion: 1 };

/** A dialog dismissal: never rate-limited, so the event a burst is made of. */
const DISMISSED: CmuxReviveEvent = { atIso: AT, button: "OK", kind: "dialog-dismissed", schemaVersion: 1, title: "" };

/** The window the legacy files were read through: `readTail({ maxBytes: 262_144 })` in the deleted file store. */
const LEGACY_TAIL_BYTES = 262_144;

const OUTAGE = FleetErrors.storeUnavailable({ doing: "be opened", reason: "connection refused (a fixture outage)" });

let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "fleet-store-port-"));
});

afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

/** Write one legacy file under `<home>/fleet/`. */
function seedLegacy({ name, text }: { name: string; text: string }): void {
  mkdirSync(join(home, "fleet"), { recursive: true });
  writeFileSync(join(home, "fleet", name), text);
}

/** Seams over the in-memory store with one row operation replaced, counting how often it was called. */
function seamsWith({
  store,
  override,
}: {
  store: MemoryFleetStore;
  override: (rows: FleetRows) => Partial<FleetRows>;
}): FleetStoreSeams {
  const base = memoryFleetSeams({ store });
  return {
    ...base,
    connect: async (request) => (await base.connect(request)).map((rows) => ({ ...rows, ...override(rows) })),
  };
}

describe("the capacity setting", () => {
  it("imports the default when no row and no legacy file exist, so a file appearing later is never read", async () => {
    const store = memoryFleetStore();
    const fleet = memoryFleetPort({ store });
    const first = unwrap(await fleet.readConfig({ home }));
    seedLegacy({ name: "config.json", text: `${JSON.stringify({ capacity: 7, schemaVersion: 1 })}\n` });
    const second = unwrap(await fleet.readConfig({ home }));
    expect([first, second, store.homes.get(home)!.config]).toEqual([
      { capacity: 15, schemaVersion: 1 },
      { capacity: 15, schemaVersion: 1 },
      { capacity: 15, revision: 1, schemaVersion: 1 },
    ]);
  });

  it("imports a legacy file once at revision 1, and the row outranks the file after", async () => {
    seedLegacy({ name: "config.json", text: `${JSON.stringify({ capacity: 7, schemaVersion: 1 })}\n` });
    const store = memoryFleetStore();
    const fleet = memoryFleetPort({ store });
    const first = unwrap(await fleet.readConfig({ home }));
    seedLegacy({ name: "config.json", text: `${JSON.stringify({ capacity: 3, schemaVersion: 1 })}\n` });
    const second = unwrap(await fleet.readConfig({ home }));
    expect([first, second, store.homes.get(home)!.config]).toEqual([
      { capacity: 7, schemaVersion: 1 },
      { capacity: 7, schemaVersion: 1 },
      { capacity: 7, revision: 1, schemaVersion: 1 },
    ]);
  });

  it("reads back the winner when a concurrent importer's insert landed first", async () => {
    seedLegacy({ name: "config.json", text: `${JSON.stringify({ capacity: 7, schemaVersion: 1 })}\n` });
    const store = memoryFleetStore();
    let reads = 0;
    const fleet = storeFleetPort({
      seams: seamsWith({
        override: (rows) => ({
          // The first read finds no row; by the insert, another importer's row is there, so the insert loses.
          insertConfig: () => {
            store.homes.get(home)!.config = { capacity: 9, revision: 1, schemaVersion: 1 };
            return Promise.resolve(ok(undefined));
          },
          readConfig: () => {
            reads += 1;
            return rows.readConfig();
          },
        }),
        store,
      }),
    });
    expect([unwrap(await fleet.readConfig({ home })), reads]).toEqual([{ capacity: 9, schemaVersion: 1 }, 2]);
  });

  it("refuses a damaged legacy file, and a write supersedes it without reading it", async () => {
    seedLegacy({ name: "config.json", text: "{not json" });
    const fleet = memoryFleetPort();
    const refused = unwrapErr(await fleet.readConfig({ home }));
    const written = unwrap(await fleet.writeConfig({ config: { capacity: 12, schemaVersion: 1 }, home }));
    expect([refused.code, written, unwrap(await fleet.readConfig({ home }))]).toEqual([
      "CONFIG_INVALID",
      { capacity: 12, schemaVersion: 1 },
      { capacity: 12, schemaVersion: 1 },
    ]);
  });

  it("bumps the revision on every write", async () => {
    const store = memoryFleetStore();
    const fleet = memoryFleetPort({ store });
    unwrap(await fleet.writeConfig({ config: { capacity: 4, schemaVersion: 1 }, home }));
    unwrap(await fleet.writeConfig({ config: { capacity: 5, schemaVersion: 1 }, home }));
    expect(store.homes.get(home)!.config).toEqual({ capacity: 5, revision: 2, schemaVersion: 1 });
  });

  it("refuses a compare-and-set miss as CONFIG_CONFLICT, naming the revision it pinned, and never retries", async () => {
    const store = memoryFleetStore();
    unwrap(await memoryFleetPort({ store }).writeConfig({ config: { capacity: 4, schemaVersion: 1 }, home }));
    let updates = 0;
    const fleet = storeFleetPort({
      seams: seamsWith({
        override: () => ({
          updateConfig: () => {
            updates += 1;
            return Promise.resolve(ok(undefined));
          },
        }),
        store,
      }),
    });
    const refused = unwrapErr(await fleet.writeConfig({ config: { capacity: 6, schemaVersion: 1 }, home }));
    expect([refused, updates, store.homes.get(home)!.config]).toEqual([
      FleetErrors.configConflict({ expectedRevision: 1 }),
      1,
      { capacity: 4, revision: 1, schemaVersion: 1 },
    ]);
  });

  it("refuses a stored row that does not decode as STORED_INVALID", async () => {
    const store = memoryFleetStore();
    unwrap(await memoryFleetPort({ store }).writeConfig({ config: { capacity: 4, schemaVersion: 1 }, home }));
    store.homes.get(home)!.config = { capacity: 0, revision: 1, schemaVersion: 1 };
    expect(unwrapErr(await memoryFleetPort({ store }).readConfig({ home })).code).toBe("STORED_INVALID");
  });
});

describe("a store outage", () => {
  it("refuses every operation as STORE_UNAVAILABLE and never reads the legacy files instead", async () => {
    seedLegacy({ name: "config.json", text: `${JSON.stringify({ capacity: 7, schemaVersion: 1 })}\n` });
    seedLegacy({ name: "resume.jsonl", text: `${JSON.stringify(GONE)}\n` });
    const fleet = storeFleetPort({
      seams: { ...memoryFleetSeams({ store: memoryFleetStore() }), connect: () => Promise.resolve(err(OUTAGE)) },
    });
    const codes = [
      unwrapErr(await fleet.readConfig({ home })).code,
      unwrapErr(await fleet.writeConfig({ config: { capacity: 3, schemaVersion: 1 }, home })).code,
      unwrapErr(await fleet.readResumeJournal({ home })).code,
      unwrapErr(await fleet.appendResumeEvent({ event: GONE, home })).code,
      unwrapErr(await fleet.readCmuxReviveJournal({ home })).code,
      unwrapErr(await fleet.appendCmuxReviveEvent({ event: HELD, home })).code,
      unwrapErr(await fleet.newestCmuxReviveSequence({ home })).code,
    ];
    expect(codes).toEqual(Array.from({ length: 7 }, () => "STORE_UNAVAILABLE"));
  });

  it("turns a connect that throws, and a statement that throws, into the same refusal — and still closes", async () => {
    const store = memoryFleetStore();
    const thrownConnect = storeFleetPort({
      seams: { ...memoryFleetSeams({ store }), connect: () => Promise.reject(new Error("socket hang up")) },
    });
    const thrownStatement = storeFleetPort({
      seams: seamsWith({ override: () => ({ readConfig: () => Promise.reject(new Error("terminated")) }), store }),
    });
    const connectError = unwrapErr(await thrownConnect.readConfig({ home }));
    const statementError = unwrapErr(await thrownStatement.readConfig({ home }));
    expect([connectError.code, statementError.code, store.opened, store.closed]).toEqual([
      "STORE_UNAVAILABLE",
      "STORE_UNAVAILABLE",
      1,
      1,
    ]);
    expect(statementError.message).toContain("terminated");
  });
});

describe("the journals", () => {
  it("imports a legacy journal once, an undecodable line stored as a placeholder and never its text", async () => {
    const secret = "not json carrying xoxb-FIXTURE-text";
    seedLegacy({ name: "resume.jsonl", text: `${JSON.stringify(GONE)}\n${secret}\n${JSON.stringify(GONE)}\n` });
    const store = memoryFleetStore();
    const fleet = memoryFleetPort({ store });
    const read = unwrap(await fleet.readResumeJournal({ home }));
    seedLegacy({ name: "resume.jsonl", text: "" });
    const sequence = unwrap(await fleet.appendResumeEvent({ event: GONE, home }));
    const stored = store.homes.get(home)!.journals.get("resume")!;
    expect([read.events.length, read.unreadable, read.unreadableAt, sequence, stored.events]).toEqual([
      2,
      1,
      [1],
      4,
      [GONE, null, GONE, GONE],
    ]);
    expect(JSON.stringify(stored)).not.toContain("xoxb-FIXTURE");
  });

  it("leaves a head at zero for an absent journal, and every append moves it by exactly one", async () => {
    const store = memoryFleetStore();
    const fleet = memoryFleetPort({ store });
    const before = unwrap(await fleet.newestCmuxReviveSequence({ home }));
    const first = unwrap(await fleet.appendCmuxReviveEvent({ event: HELD, home }));
    const second = unwrap(await fleet.appendCmuxReviveEvent({ event: HELD, home }));
    expect([before, first, second, unwrap(await fleet.newestCmuxReviveSequence({ home }))]).toEqual([0, 1, 2, 2]);
  });

  it("keeps the two journals apart", async () => {
    const fleet = memoryFleetPort();
    unwrap(await fleet.appendResumeEvent({ event: GONE, home }));
    unwrap(await fleet.appendCmuxReviveEvent({ event: HELD, home }));
    const resume = unwrap(await fleet.readResumeJournal({ home }));
    const revive = unwrap(await fleet.readCmuxReviveJournal({ home }));
    expect([resume.events, revive.events]).toEqual([[GONE], [HELD]]);
  });

  it("reads the newest tail's worth of rows, oldest first", async () => {
    const store = memoryFleetStore();
    const fleet = memoryFleetPort({ store });
    unwrap(await fleet.newestCmuxReviveSequence({ home }));
    const journal = store.homes.get(home)!.journals.get("cmux-revive")!;
    for (let index = 0; index <= FLEET_JOURNAL_TAIL_ROWS; index += 1) {
      journal.events.push({ ...DISMISSED, title: `dialog ${String(index)}` });
    }
    journal.head = journal.events.length;
    const read = unwrap(await fleet.readCmuxReviveJournal({ home }));
    expect([read.events.length, read.events[0], read.events.at(-1)]).toEqual([
      FLEET_JOURNAL_TAIL_ROWS,
      journal.events[1],
      journal.events.at(-1),
    ]);
  });

  it("keeps a restart a burst pushed out of the tail, ahead of the tail and in order", async () => {
    const store = memoryFleetStore();
    const fleet = memoryFleetPort({ store });
    unwrap(await fleet.newestCmuxReviveSequence({ home }));
    const journal = store.homes.get(home)!.journals.get("cmux-revive")!;
    const restart: CmuxReviveEvent = {
      appPid: 41,
      atIso: AT,
      hungSinceIso: AT,
      kind: "restart-started",
      schemaVersion: 1,
    };
    journal.events.push({ ...DISMISSED, title: "before the restart" }, restart);
    for (let index = 0; index < FLEET_JOURNAL_TAIL_ROWS; index += 1) {
      journal.events.push({ ...DISMISSED, title: `dialog ${String(index)}` });
    }
    journal.head = journal.events.length;
    const read = unwrap(await fleet.readCmuxReviveJournal({ home }));
    expect([read.events.length, read.events[0], read.events[1], read.events.at(-1)]).toEqual([
      FLEET_JOURNAL_TAIL_ROWS + 1,
      restart,
      journal.events[2],
      journal.events.at(-1),
    ]);
  });

  it("keeps an older restart however many holds came after it, each kind capped on its own", async () => {
    const store = memoryFleetStore();
    const fleet = memoryFleetPort({ store });
    unwrap(await fleet.newestCmuxReviveSequence({ home }));
    const journal = store.homes.get(home)!.journals.get("cmux-revive")!;
    const restart: CmuxReviveEvent = {
      appPid: 41,
      atIso: AT,
      hungSinceIso: AT,
      kind: "restart-started",
      schemaVersion: 1,
    };
    journal.events.push(restart);
    for (let index = 0; index < FLEET_JOURNAL_KEPT_ROWS + 1; index += 1) {
      journal.events.push({ ...HELD, hungSinceIso: `2026-10-30T09:00:${String(index % 60).padStart(2, "0")}.000Z` });
    }
    for (let index = 0; index < FLEET_JOURNAL_TAIL_ROWS; index += 1) {
      journal.events.push({ ...DISMISSED, title: `dialog ${String(index)}` });
    }
    journal.head = journal.events.length;
    const read = unwrap(await fleet.readCmuxReviveJournal({ home }));
    expect([read.events.length, read.events[0], read.events[1]]).toEqual([
      FLEET_JOURNAL_TAIL_ROWS + FLEET_JOURNAL_KEPT_ROWS + 1,
      restart,
      journal.events[2],
    ]);
  });

  it("keeps only the newest kept rows of one kind from before the tail", async () => {
    const store = memoryFleetStore();
    const fleet = memoryFleetPort({ store });
    unwrap(await fleet.newestCmuxReviveSequence({ home }));
    const journal = store.homes.get(home)!.journals.get("cmux-revive")!;
    for (let index = 0; index < FLEET_JOURNAL_KEPT_ROWS + 1; index += 1) {
      journal.events.push({ ...HELD, hungSinceIso: `2026-10-30T09:00:${String(index % 60).padStart(2, "0")}.000Z` });
    }
    for (let index = 0; index < FLEET_JOURNAL_TAIL_ROWS; index += 1) {
      journal.events.push({ ...DISMISSED, title: `dialog ${String(index)}` });
    }
    journal.head = journal.events.length;
    const read = unwrap(await fleet.readCmuxReviveJournal({ home }));
    expect([read.events.length, read.events[0]]).toEqual([
      FLEET_JOURNAL_TAIL_ROWS + FLEET_JOURNAL_KEPT_ROWS,
      journal.events[1],
    ]);
  });

  it("opens and closes exactly one connection per operation", async () => {
    const store = memoryFleetStore();
    const fleet = memoryFleetPort({ store });
    unwrap(await fleet.readResumeJournal({ home }));
    unwrap(await fleet.appendResumeEvent({ event: GONE, home }));
    unwrap(await fleet.readConfig({ home }));
    expect([store.opened, store.closed]).toEqual([3, 3]);
  });
});

describe("the row tail's reach", () => {
  it("covers at least the 256 KiB the legacy files were read through, at the smallest event either journal holds", () => {
    // MEASURED here, not asserted elsewhere: a row bound reaches as far back as the byte window only if this many of
    // the SMALLEST line fill it. Repro: `yarn vitest run --config config/vitest/unit.ts src/__tests__/unit/fleet/storePort.test.ts`.
    // A dismissal with an empty title and button is the smallest shape either schema admits around an ISO stamp.
    const dismissed: CmuxReviveEvent = { atIso: AT, button: "", kind: "dialog-dismissed", schemaVersion: 1, title: "" };
    const smallest = Math.min(
      ...[GONE, HELD, dismissed].map((event) => Buffer.byteLength(`${JSON.stringify(event)}\n`)),
    );
    expect(smallest * FLEET_JOURNAL_TAIL_ROWS).toBeGreaterThan(LEGACY_TAIL_BYTES);
  });
});
