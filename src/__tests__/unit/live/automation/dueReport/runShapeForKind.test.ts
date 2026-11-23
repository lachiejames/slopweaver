/**
 * How each automation kind runs: here in this process, or not at all in this build. Pure: a kind in, a shape out.
 */
import { describe, expect, it } from "vitest";

import { runShapeForKind } from "../../../../../live/automation/definitionShape.js";

describe("runShapeForKind", () => {
  it("runs the two kinds with in-process executors here, costing no session", () => {
    expect(runShapeForKind({ kind: "verb-run" })).toBe("run-here");
    expect(runShapeForKind({ kind: "alert-summary" })).toBe("run-here");
  });

  it("runs the briefing-only kind here too, because asking is a command and the ask lane owns the answer", () => {
    expect(runShapeForKind({ kind: "investigate" })).toBe("run-here");
  });

  it("runs metrics-push here too — a produce leg and a door-routed submit, minutes but no session", () => {
    expect(runShapeForKind({ kind: "metrics-push" })).toBe("run-here");
  });

  it("says a registered kind this build cannot run is neither, rather than guessing", () => {
    expect(runShapeForKind({ kind: "registered-but-unrunnable" })).toBe("no-executor");
  });
});
