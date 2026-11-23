/**
 * `codex/resetResult.ts` — the exit each form of `codex reset` ends on. The property the tick leans on: a claim that
 * did not leave the store able to take work is a FAILURE of `--at-limit`, never a quiet success, while a store left
 * alone is never one.
 */
import { describe, expect, it } from "vitest";

import type { CodexResetReading } from "../../../codex/resetEvidence.js";
import {
  type CodexResetRunResult,
  fleetResetExit,
  resetResultLine,
  settledFailure,
  singleResetExit,
} from "../../../codex/resetResult.js";

/** A re-read straight after a claim, at the limit or not. */
function after({ atLimit }: { atLimit: boolean }): CodexResetReading {
  return {
    atLimit,
    pauseAtPercent: 99,
    readAtIso: "2026-11-05T10:00:00.000Z",
    resetCreditsAvailable: 2,
    windows: [],
  };
}

/** A settled claim on `plan-a`. */
function settled({
  outcome,
  reading,
}: {
  outcome: "reset" | "nothingToReset" | "noCredit" | "alreadyRedeemed";
  reading: CodexResetReading | undefined;
}): CodexResetRunResult & { kind: "settled" } {
  return { after: reading, alias: "plan-a", idempotencyKey: "k-1", kind: "settled", outcome };
}

const REFILLED = settled({ outcome: "reset", reading: after({ atLimit: false }) });
const DEFERRED: CodexResetRunResult = { alias: "plan-a", kind: "deferred", reason: "no answer" };

describe("settledFailure", () => {
  it("is nothing for a reset whose re-read finds the store below its limit", () => {
    expect(settledFailure({ result: REFILLED })).toBeUndefined();
  });

  it("names a provider-empty answer, a store still at its limit, and a store that could not be re-read", () => {
    expect(
      [
        settled({ outcome: "nothingToReset", reading: after({ atLimit: true }) }),
        settled({ outcome: "reset", reading: after({ atLimit: true }) }),
        settled({ outcome: "alreadyRedeemed", reading: undefined }),
      ].map((result) => settledFailure({ result })),
    ).toEqual([
      "the provider answered nothingToReset",
      "the provider answered reset, but the store still reads at its limit",
      "the provider answered alreadyRedeemed, but the store could not be re-read to confirm it",
    ]);
  });
});

describe("singleResetExit", () => {
  it("keeps --plan's documented codes: 0 refilled or closed, 3 nothing to redeem, 4 re-run, 1 the rest", () => {
    const results: readonly CodexResetRunResult[] = [
      REFILLED,
      { alias: "plan-a", idempotencyKey: "k-0", kind: "closed", reason: "over" },
      settled({ outcome: "noCredit", reading: after({ atLimit: true }) }),
      { alias: "plan-a", kind: "empty", reason: "holds no reset" },
      DEFERRED,
      settled({ outcome: "reset", reading: after({ atLimit: true }) }),
      { alias: "plan-a", claimStarted: false, kind: "failed", reason: "not at its limit" },
    ];
    expect(results.map((result) => singleResetExit({ result }))).toEqual([0, 0, 3, 3, 4, 1, 1]);
  });
});

describe("fleetResetExit", () => {
  it("is 0 when nothing was due or every claim refilled its store", () => {
    expect(fleetResetExit({ planFailures: 0, results: [] })).toBe(0);
    expect(fleetResetExit({ planFailures: 0, results: [REFILLED] })).toBe(0);
  });

  it("is 4 when a claim deferred and nothing failed", () => {
    expect(fleetResetExit({ planFailures: 0, results: [REFILLED, DEFERRED] })).toBe(4);
  });

  it("is 1 when a claim came back provider-empty, even beside a deferral, or the planner failed a store", () => {
    const empty = settled({ outcome: "nothingToReset", reading: after({ atLimit: true }) });
    expect(fleetResetExit({ planFailures: 0, results: [DEFERRED, empty] })).toBe(1);
    expect(fleetResetExit({ planFailures: 1, results: [REFILLED] })).toBe(1);
  });
});

describe("resetResultLine", () => {
  it("says a refilled store can take work, and a failed claim FAILED with why", () => {
    expect(resetResultLine({ result: REFILLED })).toBe(
      "codex reset: plan-a — reset (attempt k-1); the store can take work again",
    );
    expect(resetResultLine({ result: settled({ outcome: "reset", reading: after({ atLimit: true }) }) })).toBe(
      "codex reset: plan-a — reset (attempt k-1); FAILED: the provider answered reset, but the store still reads at its limit",
    );
  });
});
