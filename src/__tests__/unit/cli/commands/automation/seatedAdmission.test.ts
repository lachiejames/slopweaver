import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  admitSeatedRow,
  carriedForwardOutcome,
  giveBackSeatNotDue,
} from "../../../../../cli/commands/automation/seatedAdmission.js";
import type { SlotRunDeps } from "../../../../../cli/commands/automation/slotRun.js";
import { ok, unwrap } from "../../../../../lib/result.js";
import { RECIPE_DEFINITION_SCHEMA_VERSION, type RecipeDefinition } from "../../../../../live/automation/definition.js";
import { RECIPE_DEFINITION_HOLDS_LOCK_KEY } from "../../../../../live/automation/failureHoldStore.js";
import { writeAutomationRetirements } from "../../../../../live/automation/retirementStore.js";
import { beginSlotAttempt, readSlotAttempt } from "../../../../../live/automation/slotLedger.js";
import { acquireWaitingLock } from "../../../../../live/automation/waitingLock.js";

const RECIPE = "resync-corpus-fathom";
const SLOT = "2026-09-17T00:00:00.000Z";
const LEASE = "2026-09-17T02:00:00.000Z";
const NOW = "2026-09-17T01:00:00.000Z";

const DEFINITION: RecipeDefinition = {
  cadence: "0 */2 * * *",
  destination: { kind: "local-atlas" },
  effect: "read-write",
  enabled: true,
  kind: "verb-run",
  onMissed: "skip",
  params: { argv: ["store", "backup"] },
  recipeId: RECIPE,
  schemaVersion: RECIPE_DEFINITION_SCHEMA_VERSION,
};

let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "seated-admission-"));
});

afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

/** Seat an unstarted attempt on {@link SLOT} under `holderToken`. */
function seatAttempt({ holderToken }: { holderToken: string }): void {
  unwrap(
    beginSlotAttempt({
      holder: "automation seat",
      holderPid: null,
      holderToken,
      home,
      leaseExpiresIso: LEASE,
      nowIso: "2026-09-17T00:00:05.000Z",
      processAlive: () => true,
      recipeId: RECIPE,
      slotIso: SLOT,
    }),
  );
}

describe("carriedForwardOutcome", () => {
  it("reports a not-failed row with no exit code that ran nothing itself, naming the overtaken firing and the due one", () => {
    expect(
      carriedForwardOutcome({ carriedFrom: "2026-09-16T22:00:00.000Z", definition: DEFINITION, slotIso: SLOT }),
    ).toEqual({
      detail: [],
      exitCode: null,
      failed: false,
      line:
        "recipe resync-corpus-fathom · seat carried forward · the seat's firing 2026-09-16T22:00:00.000Z never " +
        "started under this token before the row's next firing, so its due firing 2026-09-17T00:00:00.000Z runs instead",
      ran: false,
      recipeId: RECIPE,
    });
  });
});

describe("giveBackSeatNotDue", () => {
  it("answers null over a ledger holding no attempt at all", () => {
    expect(giveBackSeatNotDue({ claimId: "tok-seat", definition: DEFINITION, home, nowIso: NOW })).toBeNull();
  });

  it("removes this token's unstarted attempt and says the seat was given back", () => {
    seatAttempt({ holderToken: "tok-seat" });

    const outcome = giveBackSeatNotDue({ claimId: "tok-seat", definition: DEFINITION, home, nowIso: NOW });

    expect(outcome).toEqual({
      detail: [],
      exitCode: null,
      failed: false,
      line:
        "recipe resync-corpus-fathom · seat given back · its firing 2026-09-17T00:00:00.000Z never started under " +
        "this token and the row is not due now, so the attempt is removed rather than left open to its lease; the " +
        "row's next due firing takes it",
      ran: false,
      recipeId: RECIPE,
    });
    expect(readSlotAttempt({ home, recipeId: RECIPE, slotIso: SLOT })).toEqual(ok(null));
  });

  it("answers null and keeps the attempt, still held by the other token on its slot and unstarted, when it is held under a different token", () => {
    seatAttempt({ holderToken: "tok-other" });

    const outcome = giveBackSeatNotDue({ claimId: "tok-seat", definition: DEFINITION, home, nowIso: NOW });

    expect(outcome).toBeNull();
    const kept = unwrap(readSlotAttempt({ home, recipeId: RECIPE, slotIso: SLOT }))!;
    expect(kept.holderToken).toBe("tok-other");
    expect(kept.slotIso).toBe(SLOT);
    expect(kept.runStartedAtIso).toBeNull();
  });
});

describe("admitSeatedRow — the start is asked and made under the definition hold lock", () => {
  const slotDeps = (): SlotRunDeps => ({
    checkoutFor: () => ok("/checkouts/slopweaver"),
    mintId: () => "tok-minted",
    now: () => NOW,
    processAlive: () => true,
    register: async () => 0,
    writeDiagnostic: () => undefined,
  });
  const admit = (): ReturnType<typeof admitSeatedRow> =>
    admitSeatedRow({ claimId: "tok-seat", definition: DEFINITION, home, slotDeps: slotDeps(), slotIso: SLOT });

  it("leaves the seated attempt unstarted while a retirement holds the lock, and starts it once released", async () => {
    seatAttempt({ holderToken: "tok-seat" });
    const lock = unwrap(acquireWaitingLock({ home, key: RECIPE_DEFINITION_HOLDS_LOCK_KEY, nowIso: NOW }));

    const whileHeld = await admit();
    const ledgerWhileHeld = unwrap(readSlotAttempt({ home, recipeId: RECIPE, slotIso: SLOT }))!;
    lock.release();
    const afterRelease = await admit();

    expect(whileHeld).toMatchObject({
      kind: "refused",
      outcome: {
        failed: false,
        line: expect.stringContaining("not started · the definition hold lock is busy") as unknown,
      },
    });
    expect(ledgerWhileHeld.runStartedAtIso).toBeNull();
    expect(afterRelease.kind).toBe("admitted");
  });

  it("starts nothing for a row retired after the session was seated", async () => {
    seatAttempt({ holderToken: "tok-seat" });
    unwrap(
      writeAutomationRetirements({
        home,
        retirements: [{ anchor: "talk:acme#1", recipeId: RECIPE, retiredAtIso: NOW, why: "acme only", words: "off" }],
      }),
    );

    const admission = await admit();

    expect(admission).toMatchObject({
      kind: "refused",
      outcome: {
        failed: false,
        line: expect.stringContaining(`HELD since this session was seated — ${RECIPE} is retired`) as unknown,
      },
    });
    expect(unwrap(readSlotAttempt({ home, recipeId: RECIPE, slotIso: SLOT }))!.runStartedAtIso).toBeNull();
  });
});
