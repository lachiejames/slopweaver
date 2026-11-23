/**
 * The shared silent-row join over a real, explicit temp home: definitions on disk, a run-stamps file and the
 * slot ledger. What it must get right is the difference between the answers — a clean install, an unreadable
 * one, a rejected definition — and that a disabled or held row never reads as one that stopped on its own.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../../lib/result.js";
import { judgeRecipeDue } from "../../../../live/automation/definitionDue.js";
import { RESYNC_KIND } from "../../../../live/automation/kinds.js";
import { currentSlotReadingOf, readSilentRecipeRows } from "../../../../live/automation/silentRowReader.js";
import type { RecipeSlotAttempt } from "../../../../live/automation/slotAttempt.js";
import { beginSlotAttempt } from "../../../../live/automation/slotLedger.js";
import { settleSlotAttempt } from "../../../../live/automation/slotSettlement.js";
import { stateHomePaths } from "../../../../stateHome.js";

import { dailyRow, stampRecipeRuns, writeRecipeDefinitions } from "./recipeHome.js";

const NOW = "2026-09-18T12:00:00.000Z";

/** Three daily slots ago — two whole slots have gone by unrun, past the daily threshold of one. */
const STALE = "2026-09-15T09:30:00.000Z";

let home = "";

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "silentread-"));
});

afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

describe("readSilentRecipeRows", () => {
  it("reads a home with no recipe store as clean and EMPTY, which the caller can tell from a live roster", () => {
    const reading = unwrap(readSilentRecipeRows({ home, nowIso: NOW }));
    expect(reading).toEqual({ definitions: 0, eligibleRows: 0, rejected: [], silent: [] });
  });

  it("reports a live row whose slots went by unrun, and nothing about the disabled and held rows beside it", () => {
    writeRecipeDefinitions({
      home,
      rows: [
        dailyRow(),
        dailyRow({ enabled: false, recipeId: "retired-by-disabling" }),
        dailyRow({
          hold: { askedIso: "2026-09-10T00:00:00.000Z", clearedBy: null, reason: "owner: stays off" },
          recipeId: "retired-by-holding",
        }),
      ],
    });
    stampRecipeRuns({
      home,
      stamps: { "vulnfix-digest-acme-admin": STALE, "retired-by-disabling": STALE, "retired-by-holding": STALE },
    });

    const reading = unwrap(readSilentRecipeRows({ home, nowIso: NOW }));

    expect(reading.definitions).toBe(3);
    expect(reading.eligibleRows).toBe(1);
    expect(reading.silent.map((silent) => [silent.recipeId, silent.reason, silent.missedSlots])).toEqual([
      ["vulnfix-digest-acme-admin", "MISSED", 2],
    ]);
  });

  it("still reports a row the STORE held on a failure — a broken row is what this measure exists to see", () => {
    writeRecipeDefinitions({
      home,
      rows: [
        dailyRow({
          hold: {
            askedIso: "2026-09-15T09:31:00.000Z",
            clearedBy: null,
            finding: "recipe-failing-vulnfix-digest-acme-admin-a1",
            reason: "held by the store",
          },
        }),
      ],
    });
    stampRecipeRuns({ home, stamps: { "vulnfix-digest-acme-admin": STALE } });

    const reading = unwrap(readSilentRecipeRows({ home, nowIso: NOW }));

    expect(reading.eligibleRows).toBe(1);
    expect(reading.silent.map((silent) => [silent.recipeId, silent.reason])).toEqual([
      ["vulnfix-digest-acme-admin", "MISSED"],
    ]);
  });

  it("counts a row whose hold was CLEARED as live again", () => {
    writeRecipeDefinitions({
      home,
      rows: [
        dailyRow({
          hold: {
            askedIso: "2026-09-10T00:00:00.000Z",
            clearedBy: { atIso: "2026-09-12T00:00:00.000Z", dmChannel: "D0SYN000002", ts: "1789800000.000100" },
            reason: "was off",
          },
        }),
      ],
    });
    stampRecipeRuns({ home, stamps: { "vulnfix-digest-acme-admin": STALE } });

    expect(unwrap(readSilentRecipeRows({ home, nowIso: NOW })).eligibleRows).toBe(1);
  });

  it("carries a current slot's DEFERRED outcome, with what the verb said it was waiting for", () => {
    writeRecipeDefinitions({ home, rows: [dailyRow()] });
    stampRecipeRuns({ home, stamps: { "vulnfix-digest-acme-admin": STALE } });
    const slotIso = judgeRecipeDue({
      definition: dailyRow(),
      nowIso: NOW,
      run: { exitCode: 0, lastRunAtIso: STALE, watermarkIso: STALE },
    }).slotIso!;
    const slot = { home, nowIso: NOW, recipeId: "vulnfix-digest-acme-admin", slotIso };
    unwrap(
      beginSlotAttempt({
        ...slot,
        holder: "recipe run-due",
        holderPid: null,
        holderToken: "token-1",
        leaseExpiresIso: "2026-09-19T09:30:00.000Z",
        processAlive: () => true,
      }),
    );
    unwrap(
      settleSlotAttempt({
        ...slot,
        holderToken: "token-1",
        outcome: { detail: "a top-up generation is still opening", kind: "deferred", settledAtIso: NOW },
      }),
    );

    const [silent] = unwrap(readSilentRecipeRows({ home, nowIso: NOW })).silent;

    expect(silent!.reason).toBe("DEFERRED");
    expect(silent!.detail).toContain("a top-up generation is still opening");
  });

  describe("a current firing a seat holds", () => {
    const TAKEN = "2026-09-18T11:13:20.286Z";

    /** The stale digest row, its due firing opened by a seat at TAKEN under `leaseExpiresIso`. */
    function seatHolds({ leaseExpiresIso }: { leaseExpiresIso: string }): void {
      writeRecipeDefinitions({ home, rows: [dailyRow()] });
      stampRecipeRuns({ home, stamps: { "vulnfix-digest-acme-admin": STALE } });
      const slotIso = judgeRecipeDue({
        definition: dailyRow(),
        nowIso: NOW,
        run: { exitCode: 0, lastRunAtIso: STALE, watermarkIso: STALE },
      }).slotIso!;
      unwrap(
        beginSlotAttempt({
          holder: "automations-seat-40cae177",
          holderPid: 4242,
          holderToken: "token-1",
          home,
          leaseExpiresIso,
          nowIso: TAKEN,
          processAlive: () => true,
          recipeId: "vulnfix-digest-acme-admin",
          slotIso,
        }),
      );
    }

    /** What the reader carries for the row, read with `alive` as the holder probe. */
    function heldReading({ alive }: { alive: boolean }): unknown[] {
      const reading = unwrap(readSilentRecipeRows({ home, nowIso: NOW, processAlive: () => alive }));
      return reading.silent.map((silent) => [silent.reason, silent.missedSlots, silent.currentSlotHold]);
    }

    it("stays silent — the slots still went by — and names the seat and when it took the firing", () => {
      seatHolds({ leaseExpiresIso: "2026-09-19T09:30:00.000Z" });

      expect(heldReading({ alive: true })).toEqual([
        ["MISSED", 2, { holder: "automations-seat-40cae177", startedAtIso: TAKEN }],
      ]);
    });

    it("names nobody once the holder's process is proved gone", () => {
      seatHolds({ leaseExpiresIso: "2026-09-19T09:30:00.000Z" });

      expect(heldReading({ alive: false })).toEqual([["MISSED", 2, null]]);
    });

    it("names nobody once the lease has run out, however alive the holder reads", () => {
      seatHolds({ leaseExpiresIso: "2026-09-18T11:30:00.000Z" });

      expect(heldReading({ alive: true })).toEqual([["MISSED", 2, null]]);
    });

    it("names nobody on a recipe id two definitions share — the ledger cannot say whose firing it holds", () => {
      seatHolds({ leaseExpiresIso: "2026-09-19T09:30:00.000Z" });
      const directory = stateHomePaths({ home }).live.recipe.definitionsDir;
      writeFileSync(join(directory, "a-second-copy.json"), JSON.stringify(dailyRow({ cadence: "30 9 * * *" })));

      expect(heldReading({ alive: true })).toEqual([
        ["MISSED", 2, null],
        ["MISSED", 2, null],
      ]);
    });
  });

  it("refuses rather than reading clean when the run stamps will not parse", () => {
    writeRecipeDefinitions({ home, rows: [dailyRow()] });
    const path = stateHomePaths({ home }).live.recipe.definitionRunsJson;
    writeFileSync(path, "{ not json", "utf8");

    const failure = unwrapErr(readSilentRecipeRows({ home, nowIso: NOW }));

    expect(failure.length).toBeGreaterThan(0);
    expect(failure.join(" ")).toContain(path);
  });

  it("reports a definition file that will not parse, rather than dropping it silently", () => {
    const directory = writeRecipeDefinitions({ home, rows: [dailyRow()] });
    stampRecipeRuns({ home, stamps: { "vulnfix-digest-acme-admin": STALE } });
    writeFileSync(join(directory, "broken.json"), "{", "utf8");

    const reading = unwrap(readSilentRecipeRows({ home, nowIso: NOW }));

    expect(reading.rejected.length).toBe(1);
    expect(reading.rejected[0]).toContain("broken.json: ");
    expect(reading.definitions).toBe(1);
  });

  it("marks a stopped resync row with its steer id, and leaves an ordinary one beside it unmarked", () => {
    writeRecipeDefinitions({
      home,
      rows: [
        dailyRow(),
        dailyRow({
          destination: { kind: "local-atlas" },
          kind: RESYNC_KIND,
          params: { argv: ["recipe", "resync", "--atlas", "aether"] },
          recipeId: "resync-atlas-aether",
        }),
      ],
    });
    stampRecipeRuns({ home, stamps: { "resync-atlas-aether": STALE, "vulnfix-digest-acme-admin": STALE } });

    const reading = unwrap(readSilentRecipeRows({ home, nowIso: NOW }));

    expect(reading.rejected).toEqual([]);
    expect(reading.silent.map((silent) => [silent.recipeId, silent.steerId])).toEqual([
      ["resync-atlas-aether", "resync-restart"],
      ["vulnfix-digest-acme-admin", undefined],
    ]);
  });
});

describe("currentSlotReadingOf", () => {
  const OPEN: RecipeSlotAttempt = {
    attempt: 1,
    holder: "automations-seat-b41b8c85",
    holderPid: 89636,
    holderToken: "token",
    leaseExpiresIso: "2026-09-19T09:30:00.000Z",
    outcome: null,
    recipeId: "slack-owed-daily",
    runStartedAtIso: "2026-09-18T11:41:36.614Z",
    schemaVersion: 1,
    slotIso: "2026-09-18T10:55:00.000Z",
    startedAtIso: "2026-09-18T11:37:06.978Z",
  };

  it("keeps a settled firing's outcome and names no holder — that firing is over", () => {
    const outcome = { exitCode: 0, kind: "succeeded", settledAtIso: "2026-09-18T11:42:10.862Z" } as const;

    expect(currentSlotReadingOf({ nowIso: NOW, processAlive: () => true, stored: { ...OPEN, outcome } })).toEqual({
      currentSlotHold: null,
      currentSlotOutcome: outcome,
    });
  });

  it("reads nothing at all off a firing nobody has attempted", () => {
    expect(currentSlotReadingOf({ nowIso: NOW, processAlive: () => true, stored: null })).toEqual({
      currentSlotHold: null,
      currentSlotOutcome: null,
    });
  });

  it("names the holder of an open firing under a live lease", () => {
    expect(currentSlotReadingOf({ nowIso: NOW, processAlive: () => true, stored: OPEN })).toEqual({
      currentSlotHold: { holder: "automations-seat-b41b8c85", startedAtIso: "2026-09-18T11:37:06.978Z" },
      currentSlotOutcome: null,
    });
  });
});
