/*
 * `fleet-unhealthy`'s `attemptFate`: how each settled outcome, a run inside or past its lease, a claimed firing
 * that never started, a gone in-process pid and a dead-letter's reason are read for the tally.
 */
import { describe, expect, it } from "vitest";

import type { RecipeSlotOutcome } from "../../../../live/automation/slotAttempt.js";
import { attemptFate } from "../../../../monitor/fleetHealthAttempts.js";

import { DIED_BY_LEASE, FAILED, NOW, probed, SETTLED, SUCCEEDED } from "../fleetHealthFixtures.js";
import { NEVER_STARTED } from "./harness.js";

const DEFERRED: RecipeSlotOutcome = { detail: "waiting on a token", kind: "deferred", settledAtIso: SETTLED };

describe("attemptFate", () => {
  it("reads each settled outcome as the tally counts it", () => {
    expect(
      [SUCCEEDED, FAILED, DEFERRED].map((outcome) => attemptFate({ nowIso: NOW, probed: probed({ outcome }) })),
    ).toEqual(["succeeded", "failing", "uncounted"]);
  });

  it("reads a run still inside its lease as uncounted, and one past it as died", () => {
    expect(attemptFate({ nowIso: NOW, probed: probed({ outcome: null }) })).toBe("uncounted");
    expect(attemptFate({ nowIso: NOW, probed: probed(DIED_BY_LEASE) })).toBe("died");
  });

  it("reads a claimed firing that never started as failing past its lease, never as a death", () => {
    expect(attemptFate({ nowIso: NOW, probed: probed(NEVER_STARTED) })).toBe("failing");
  });

  it("reads an in-process run whose pid is gone as died before its lease runs out", () => {
    expect(attemptFate({ nowIso: NOW, probed: probed({ holderAlive: false, holderPid: 4242, outcome: null }) })).toBe(
      "died",
    );
    expect(attemptFate({ nowIso: NOW, probed: probed({ holderAlive: true, holderPid: 4242, outcome: null }) })).toBe(
      "uncounted",
    );
  });

  it("keeps a dead-lettered death a death, and an exhausted retry a failure", () => {
    const dead = ({ reason }: { reason: "ATTEMPTS_EXHAUSTED" | "OUTCOME_UNKNOWN" | "KILLED_BY_SIGNAL" }): string =>
      attemptFate({
        nowIso: NOW,
        probed: probed({ outcome: { detail: "x", kind: "dead", reason, settledAtIso: SETTLED } }),
      });
    expect([
      dead({ reason: "ATTEMPTS_EXHAUSTED" }),
      dead({ reason: "OUTCOME_UNKNOWN" }),
      dead({ reason: "KILLED_BY_SIGNAL" }),
    ]).toEqual(["failing", "died", "died"]);
  });
});
