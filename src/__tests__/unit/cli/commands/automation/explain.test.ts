/**
 * `automation explain`: the visible session's one sentence for ONE failed firing, filed under its slot and attempt,
 * and refused for a firing that did not fail, a slot with no firing, or words that read like the raw record.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { FiringView } from "../../../../../automations/card.js";
import { firingToExplain, runRecipeExplain } from "../../../../../cli/commands/automation/explain.js";
import { RecipeCommandExplainErrors } from "../../../../../cli/commands/automation/explainErrors.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../../../../cli/exitCodes.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";
import { readFailureExplanations } from "../../../../../live/automation/failureExplanation.js";
import type { RecipeSlotOutcome } from "../../../../../live/automation/slotAttempt.js";
import { beginSlotAttempt } from "../../../../../live/automation/slotLedger.js";
import { settleSlotAttempt } from "../../../../../live/automation/slotSettlement.js";

const RECIPE = "acme-digest";
const NOW = "2026-11-03T09:00:00.000Z";
const FAILED_SLOT = "2026-11-03T02:00:00.000Z";
const WORKED_SLOT = "2026-11-02T02:00:00.000Z";
const WHY = "The sign-in expired, so reconnecting it in Setup fixes it.";

let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "explain-"));
});

afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

/** Take and settle one firing of the row at `slotIso` with `outcome`. */
function seedFiring({ slotIso, outcome }: { slotIso: string; outcome: RecipeSlotOutcome }): void {
  const slot = { home, nowIso: NOW, recipeId: RECIPE, slotIso };
  unwrap(
    beginSlotAttempt({
      ...slot,
      holder: "recipe run-due",
      holderPid: null,
      holderToken: `token-${slotIso}`,
      leaseExpiresIso: "2026-11-04T02:00:00.000Z",
      processAlive: () => true,
    }),
  );
  unwrap(settleSlotAttempt({ ...slot, holderToken: `token-${slotIso}`, outcome }));
}

/** One failure and one success, a day apart. */
function seedLedger(): void {
  seedFiring({
    outcome: {
      detail: "linear read: HTTP 401 Unauthorized",
      exitCode: 1,
      kind: "failed",
      retryNotBeforeIso: "2026-11-03T03:00:00.000Z",
      settledAtIso: "2026-11-03T02:05:00.000Z",
    },
    slotIso: FAILED_SLOT,
  });
  seedFiring({
    outcome: { exitCode: 0, kind: "succeeded", settledAtIso: "2026-11-02T02:05:00.000Z" },
    slotIso: WORKED_SLOT,
  });
}

/** Run the verb against the temp home, collecting what it printed. */
function explain({ tail }: { tail: readonly string[] }): { code: number; out: string[]; diagnostic: string[] } {
  const out: string[] = [];
  const diagnostic: string[] = [];
  const code = runRecipeExplain({
    argv: ["node", "slopweaver", "automation", "explain", ...tail, "--home", home],
    deps: {
      now: () => NOW,
      writeDiagnostic: (line) => {
        diagnostic.push(line);
      },
      writeOut: (line) => {
        out.push(line);
      },
    },
  });
  return { code, diagnostic, out };
}

describe("runRecipeExplain", () => {
  it("files the sentence under the named slot and attempt, and says it was recorded, never that the page changed", () => {
    seedLedger();

    const { code, out } = explain({ tail: [RECIPE, "--slot", FAILED_SLOT, "--attempt", "1", "--why", WHY] });

    expect([code, out]).toEqual([
      EXIT_OK,
      [
        `automation explain · ${RECIPE} · firing ${FAILED_SLOT} attempt 1 · recorded: ${WHY} — the Automations page ` +
          "leads that row with it only while this firing is the run that finished last and its history reads whole",
      ],
    ]);
    expect(unwrap(readFailureExplanations({ home })).explanations).toEqual([
      { attempt: 1, recipeId: RECIPE, recordedIso: NOW, slotIso: FAILED_SLOT, why: WHY },
    ]);
  });

  it("refuses a named firing that succeeded, and a slot with no firing, writing nothing", () => {
    seedLedger();

    const worked = explain({ tail: [RECIPE, "--why", WHY, "--slot", WORKED_SLOT, "--attempt", "1"] });
    const absent = explain({ tail: [RECIPE, "--why", WHY, "--slot", "2026-10-01T02:00:00.000Z", "--attempt", "1"] });

    expect([worked.code, worked.diagnostic, absent.code, absent.diagnostic]).toEqual([
      EXIT_ERROR,
      [
        `automation explain · ${RECIPE} was not explained: its firing at ${WORKED_SLOT} is succeeded, not a failure, so there is nothing to explain`,
      ],
      EXIT_ERROR,
      [`automation explain · ${RECIPE} was not explained: no firing is recorded at 2026-10-01T02:00:00.000Z`],
    ]);
    expect(unwrap(readFailureExplanations({ home })).explanations).toEqual([]);
  });

  it("refuses a missing --why and one that is the raw record, as usage, before reading the ledger", () => {
    const missing = explain({ tail: [RECIPE] });
    const pasted = explain({ tail: [RECIPE, "--why", "exit 1: linear read: HTTP 401 Unauthorized"] });
    const worded = explain({ tail: [RECIPE, "--why", "Linear returned 401, so the read stopped."] });

    expect([missing.code, pasted.code, worded.code]).toEqual([EXIT_USAGE, EXIT_USAGE, EXIT_USAGE]);
    expect(pasted.diagnostic[0]).toContain('--why refused: the explanation carries ":"');
    expect(worded.diagnostic[0]).toContain("--why refused: the explanation reads like the raw record");
  });

  it("never guesses the firing: a missing --slot or --attempt, or one not whole, is usage, and nothing is written", () => {
    seedLedger();

    const noSlot = explain({ tail: [RECIPE, "--attempt", "1", "--why", WHY] });
    const noAttempt = explain({ tail: [RECIPE, "--slot", FAILED_SLOT, "--why", WHY] });
    const notWhole = explain({ tail: [RECIPE, "--slot", FAILED_SLOT, "--attempt", "0", "--why", WHY] });

    expect([noSlot, noAttempt, notWhole].map((run) => [run.code, run.diagnostic[0]])).toEqual([
      [EXIT_USAGE, "automation explain needs --slot: the slot your own `run-due` printed for the firing that failed"],
      [
        EXIT_USAGE,
        "automation explain needs --attempt: the attempt number your own `run-due` printed for the firing that failed",
      ],
      [EXIT_USAGE, "--attempt takes a whole number, at least 1 — `0` is not one"],
    ]);
    expect(unwrap(readFailureExplanations({ home })).explanations).toEqual([]);
  });
});

const view = (over: Partial<FiringView>): FiringView => ({
  attempt: 1,
  detail: null,
  exitCode: 1,
  outcome: "failed",
  reason: null,
  runStartedAtIso: null,
  settledAtIso: "2026-11-03T02:05:00.000Z",
  slotIso: FAILED_SLOT,
  startedAtIso: FAILED_SLOT,
  ...over,
});

describe("firingToExplain", () => {
  it("takes exactly the named slot and attempt, a dead one included, never another failure that settled later", () => {
    const named = view({ outcome: "dead", settledAtIso: "2026-11-03T03:00:00.000Z" });
    const settledLater = view({ attempt: 2, settledAtIso: "2026-11-03T08:00:00.000Z", slotIso: WORKED_SLOT });

    expect(
      unwrap(firingToExplain({ attempt: 1, firings: [settledLater, named], recipeId: RECIPE, slotIso: FAILED_SLOT })),
    ).toBe(named);
  });

  it("refuses a slot retried onto another attempt since the session saw its own fail", () => {
    const retried = view({ attempt: 2, outcome: "failed" });
    const refused = unwrapErr(
      firingToExplain({ attempt: 1, firings: [retried], recipeId: RECIPE, slotIso: FAILED_SLOT }),
    );

    expect(refused).toEqual(
      RecipeCommandExplainErrors.explainAttemptMoved({
        attempt: 1,
        recipeId: RECIPE,
        recorded: 2,
        slotIso: FAILED_SLOT,
      }),
    );
    expect([refused.reason, refused.message]).toEqual([
      "ATTEMPT_MOVED",
      `automation explain · ${RECIPE} was not explained: its firing at ${FAILED_SLOT} is now on attempt 2, not attempt 1, so the words would describe another run`,
    ]);
  });

  it("names a slot that holds no firing apart from one that did not fail", () => {
    const succeeded = view({ outcome: "succeeded" });
    const refusals = [
      firingToExplain({ attempt: 1, firings: [succeeded], recipeId: RECIPE, slotIso: "2026-11-01T00:00:00.000Z" }),
      firingToExplain({ attempt: 1, firings: [succeeded], recipeId: RECIPE, slotIso: succeeded.slotIso }),
    ].map((refusal) => unwrapErr(refusal));

    expect(refusals.map((refusal) => [refusal.reason, refusal.message])).toEqual([
      [
        "SLOT_UNRECORDED",
        "automation explain · acme-digest was not explained: no firing is recorded at 2026-11-01T00:00:00.000Z",
      ],
      [
        "SLOT_NOT_FAILED",
        `automation explain · acme-digest was not explained: its firing at ${succeeded.slotIso} is succeeded, not a failure, so there is nothing to explain`,
      ],
    ]);
  });
});
