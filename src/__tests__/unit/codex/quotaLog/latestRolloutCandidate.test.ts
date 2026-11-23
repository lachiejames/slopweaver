/*
 * `latestRolloutCandidate` — which of several rollout files is the newest, by mtime alone.
 */
import { describe, expect, it } from "vitest";
import { latestRolloutCandidate, type RolloutCandidate } from "../../../../codex/rolloutWalk.js";

describe("latestRolloutCandidate", () => {
  it("returns undefined for an empty candidate list", () => {
    expect(latestRolloutCandidate({ candidates: [] })).toBeUndefined();
  });

  it("picks the candidate with the highest mtime, regardless of order", () => {
    const older: RolloutCandidate = { mtimeMs: 100, path: "/a" };
    const newer: RolloutCandidate = { mtimeMs: 200, path: "/b" };

    expect(latestRolloutCandidate({ candidates: [older, newer] })).toEqual(newer);
    expect(latestRolloutCandidate({ candidates: [newer, older] })).toEqual(newer);
  });
});
