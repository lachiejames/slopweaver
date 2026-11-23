/*
 * `fleet-unhealthy`'s `tallyAttempts`: what one day's window counts, and a note's two claimed firings
 * that never started, which trip nothing.
 */
import { describe, expect, it } from "vitest";

import { tallyAttempts, trippedSignals } from "../../../../monitor/fleetHealth.js";

import { DIED_BY_LEASE, FAILED, many, NOW, probed } from "../fleetHealthFixtures.js";
import { NEVER_STARTED } from "./harness.js";

describe("tallyAttempts", () => {
  it("counts every attempt started inside the day and nothing older", () => {
    const tally = tallyAttempts({
      attempts: [
        probed({ recipeId: "a" }),
        probed({ outcome: FAILED, recipeId: "b" }),
        probed({ outcome: FAILED, recipeId: "old", startedAtIso: "2026-09-28T15:36:00.000Z" }),
        probed({ ...DIED_BY_LEASE, recipeId: "c" }),
      ],
      nowIso: NOW,
    });
    expect(tally).toEqual({ died: ["c"], failing: ["b"], succeeded: 1 });
  });

  it("never trips deaths on two claimed firings that never started", () => {
    const tally = tallyAttempts({
      attempts: [
        probed({ ...NEVER_STARTED, recipeId: "resync-corpus-github" }),
        probed({ ...NEVER_STARTED, recipeId: "resync-corpus-linear" }),
        ...many({ count: 20, shape: {} }),
      ],
      nowIso: NOW,
    });
    expect(tally).toEqual({ died: [], failing: ["resync-corpus-github", "resync-corpus-linear"], succeeded: 20 });
    expect(trippedSignals({ botDown: false, tally })).toEqual([]);
  });
});
