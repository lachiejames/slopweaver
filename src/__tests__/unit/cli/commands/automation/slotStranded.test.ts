/**
 * `writeUnlessHeld` over a throwaway home: the ledger write a take begins a firing with is made only under the
 * definition hold lock, so while a retirement holds that lock the write is never made and the take refuses
 * without failing — asserted on the guard itself and on `takeSlot`, so a take that stopped routing its write
 * through the guard fails here too. `write` and the take's edges are plain functions, never mocks. The other
 * take-level arms are `slotRun.test.ts`.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { takeSlot } from "../../../../../cli/commands/automation/slotRun.js";
import { writeUnlessHeld } from "../../../../../cli/commands/automation/slotStranded.js";
import { ok, unwrap } from "../../../../../lib/result.js";
import { RECIPE_DEFINITION_SCHEMA_VERSION, type RecipeDefinition } from "../../../../../live/automation/definition.js";
import { RECIPE_DEFINITION_HOLDS_LOCK_KEY } from "../../../../../live/automation/failureHoldStore.js";
import { readSlotAttempt } from "../../../../../live/automation/slotLedger.js";
import { acquireWaitingLock } from "../../../../../live/automation/waitingLock.js";
import { stateHomePaths } from "../../../../../stateHome.js";

const NOW = "2026-09-26T18:00:00.000Z";
const SLOT = "2026-09-26T17:00:00.000Z";

/** A daily read-write row; nothing here depends on its cadence. */
const BACKUP_ROW: RecipeDefinition = {
  cadence: "0 17 * * *",
  destination: { kind: "local-atlas" },
  effect: "read-write",
  enabled: true,
  kind: "verb-run",
  onMissed: "skip",
  params: { argv: ["store", "backup"] },
  recipeId: "store-backup-daily",
  schemaVersion: RECIPE_DEFINITION_SCHEMA_VERSION,
};

let home = "";

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "slot-stranded-"));
});

afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

describe("writeUnlessHeld", () => {
  it("makes the write and answers what it returned when the row is neither held nor locked", () => {
    let writes = 0;

    const outcome = writeUnlessHeld({
      definition: BACKUP_ROW,
      home,
      nowIso: NOW,
      slotIso: SLOT,
      write: () => {
        writes += 1;
        return "attempt-1";
      },
    });

    expect(outcome).toEqual({ kind: "written", written: "attempt-1" });
    expect(writes).toBe(1);
  });

  it("refuses without writing or failing while a retirement holds the definition hold lock, and writes once it is released", () => {
    const lock = unwrap(acquireWaitingLock({ home, key: RECIPE_DEFINITION_HOLDS_LOCK_KEY, nowIso: NOW }));
    let writes = 0;
    const attempt = (): ReturnType<typeof writeUnlessHeld<string>> =>
      writeUnlessHeld({
        definition: BACKUP_ROW,
        home,
        nowIso: NOW,
        slotIso: SLOT,
        write: () => {
          writes += 1;
          return "attempt-1";
        },
      });

    const whileLocked = attempt();
    const writesWhileLocked = writes;
    lock.release();
    const afterRelease = attempt();

    expect(whileLocked).toMatchObject({
      kind: "refused",
      take: {
        died: false,
        failed: false,
        kind: "refused",
        line: expect.stringContaining("the definition hold lock is busy") as unknown,
      },
    });
    expect(writesWhileLocked).toBe(0);
    expect(afterRelease).toEqual({ kind: "written", written: "attempt-1" });
  });
});

describe("takeSlot — while a retirement holds the definition hold lock", () => {
  it("refuses without failing and writes nothing to the ledger, then takes the firing once the lock is released", async () => {
    const definitions = stateHomePaths({ home }).live.recipe.definitionsDir;
    mkdirSync(definitions, { recursive: true });
    writeFileSync(join(definitions, `${BACKUP_ROW.recipeId}.json`), JSON.stringify(BACKUP_ROW), "utf8");
    const lock = unwrap(acquireWaitingLock({ home, key: RECIPE_DEFINITION_HOLDS_LOCK_KEY, nowIso: NOW }));
    const takeNow = (): ReturnType<typeof takeSlot> =>
      takeSlot({
        definition: BACKUP_ROW,
        deps: {
          checkoutFor: () => ok("/checkouts/slopweaver"),
          mintId: () => "tok-minted",
          now: () => NOW,
          processAlive: () => true,
          register: async () => 0,
          writeDiagnostic: () => undefined,
        },
        holder: "recipe run-due",
        holderPid: 4242,
        home,
        slotIso: SLOT,
      });

    const whileLocked = await takeNow();
    const ledgerWhileLocked = unwrap(readSlotAttempt({ home, recipeId: BACKUP_ROW.recipeId, slotIso: SLOT }));
    lock.release();
    const afterRelease = await takeNow();

    expect(whileLocked).toMatchObject({
      died: false,
      failed: false,
      kind: "refused",
      line: expect.stringContaining("the definition hold lock is busy") as unknown,
    });
    expect(ledgerWhileLocked).toBe(null);
    expect(afterRelease.kind).toBe("taken");
  });
});
