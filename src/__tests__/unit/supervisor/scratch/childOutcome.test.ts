/** A bounded child's ending, named: each of the four outcomes says which it was, and only an exit carries a code. */
import { describe, expect, it } from "vitest";

import { type ChildOutcome, describeChildOutcome, exitCodeOf } from "../../../../supervisor/scratch/childOutcome.js";

const OUTCOMES: readonly ChildOutcome[] = [
  { durationMs: 5, exitCode: 3, kind: "exited" },
  { durationMs: 5, kind: "signalled", signal: "SIGTERM" },
  { durationMs: 180_004, kind: "timed-out", signal: "SIGKILL", timeoutMs: 180_000 },
  { durationMs: 1, kind: "launch-failed", message: "spawn ENOENT" },
];

describe("describeChildOutcome", () => {
  it("names each ending in its own words", () => {
    expect(OUTCOMES.map((outcome) => describeChildOutcome({ outcome }))).toEqual([
      "exit 3",
      "killed by SIGTERM",
      "timed out after 180s (killed)",
      "did not start: spawn ENOENT",
    ]);
  });
});

describe("exitCodeOf", () => {
  it("carries a code only for a child that exited", () => {
    expect(OUTCOMES.map((outcome) => exitCodeOf({ outcome }))).toEqual([3, null, null, null]);
  });
});
