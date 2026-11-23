/**
 * The Claude directory's typed failures print exactly what the `readonly string[]` they replaced printed: every
 * re-enrollment refusal on its own line, and the message otherwise.
 */
import { describe, expect, it } from "vitest";
import { ClaudeErrors, claudeErrorLines } from "../../../claude/claudeErrors.js";

describe("claudeErrorLines", () => {
  it("gives every reason a re-enrollment was refused its own line", () => {
    const reasons = ["NOT RE-ENROLLED — plan-two has no standing row", "NOT RE-ENROLLED — plan-three collides"];
    const error = ClaudeErrors.reenrollRefused({ reasons });
    expect(claudeErrorLines({ error })).toEqual(reasons);
    expect(error.message).toBe("NOT RE-ENROLLED — plan-two has no standing row; NOT RE-ENROLLED — plan-three collides");
  });

  it("gives a single-message variant its message", () => {
    expect(claudeErrorLines({ error: ClaudeErrors.reenrollRepeated({ aliases: ["plan-two", "plan-four"] }) })).toEqual([
      "NOT RE-ENROLLED — plan-two, plan-four named more than once",
    ]);
  });
});

describe("ClaudeErrors", () => {
  it("names an investigation line's own incidentId as its own", () => {
    const error = ClaudeErrors.drawdownFieldMissing({ field: "incidentId", lineKind: "investigation-failed" });
    expect(error.code).toBe("DRAWDOWN_FIELD_INVALID");
    expect(error.message).toBe("an investigation-failed line is missing its incidentId");
  });

  it("names a timestamp field bare", () => {
    expect(
      ClaudeErrors.drawdownFieldMissing({ field: "recordedAtIso", lineKind: "investigation-opened" }).message,
    ).toBe("an investigation-opened line is missing recordedAtIso");
  });

  it("carries the dead workspace into a failed investigation, so a reader knows what to close", () => {
    const error = ClaudeErrors.drawdownInvestigationFailed({ reason: "boot timed out", workspaceRef: "workspace:7" });
    expect(error.workspaceRef).toBe("workspace:7");
    expect(error.message).toBe("boot timed out (workspace workspace:7)");
  });

  it("says which keep-alive field is wrong", () => {
    const error = ClaudeErrors.watchSessionInvalid({ field: "pid" });
    expect(error.code).toBe("WATCH_SESSION_INVALID");
    expect(error.message).toBe("`pid` is not a positive integer, so no process can be looked up");
  });
});
