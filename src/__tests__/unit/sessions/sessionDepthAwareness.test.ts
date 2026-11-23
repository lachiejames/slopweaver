/**
 * The fleet-wide depth advisory's pure half.
 *
 * The behaviour worth pinning is not the arithmetic — it is that this module can no longer refuse anything,
 * and that its text does not hand a lifecycle decision to the session being warned. Both are owner rulings
 * and both are the kind of property that a later "helpful" edit re-introduces.
 */
import { describe, expect, it } from "vitest";
import {
  evaluateSessionDepthAwareness,
  renderDepth,
  SESSION_DEPTH_WARN_TOKENS,
  sessionDepthWarning,
} from "../../../sessions/sessionDepthAwareness.js";

describe("renderDepth", () => {
  it("renders a depth in thousands", () => {
    expect(renderDepth({ depthTokens: 612_400 })).toBe("612k");
  });

  it("rounds to the nearest thousand rather than truncating", () => {
    expect(renderDepth({ depthTokens: 611_600 })).toBe("612k");
  });

  it("renders zero", () => {
    expect(renderDepth({ depthTokens: 0 })).toBe("0k");
  });
});

describe("evaluateSessionDepthAwareness", () => {
  it("stays silent below the line", () => {
    expect(evaluateSessionDepthAwareness({ depthTokens: 499_999 })).toEqual({ kind: "allow" });
  });

  it("warns exactly ON the line", () => {
    expect(evaluateSessionDepthAwareness({ depthTokens: SESSION_DEPTH_WARN_TOKENS }).kind).toBe("warn");
  });

  it("stays silent when the depth could not be measured", () => {
    expect(evaluateSessionDepthAwareness({ depthTokens: undefined })).toEqual({ kind: "allow" });
  });

  it("still only warns at a depth the retired gate would have blocked", () => {
    expect(evaluateSessionDepthAwareness({ depthTokens: 988_396 }).kind).toBe("warn");
  });

  it("honours a caller-supplied line, so the policy is not welded into the decision", () => {
    expect(evaluateSessionDepthAwareness({ depthTokens: 120_000, warnTokens: 100_000 }).kind).toBe("warn");
  });

  it("carries the rendered depth in the warning it returns", () => {
    const decision = evaluateSessionDepthAwareness({ depthTokens: 750_000 });
    expect(decision).toEqual({ context: sessionDepthWarning({ depthTokens: 750_000 }), kind: "warn" });
  });
});

describe("the advisory never refuses and never delegates the decision downward", () => {
  const text = sessionDepthWarning({ depthTokens: 750_000 });

  it("names this session's own depth and the line it crossed", () => {
    expect(text).toContain("750k");
    expect(text).toContain("500k");
  });

  it("says outright that nothing is blocked", () => {
    expect(text).toContain("Nothing is blocked.");
  });

  it("tells the warned session to carry on with what it is doing", () => {
    expect(text).toContain("Continue the current task");
  });

  it("puts the respawn decision on the supervisor, naming the verb that carries it", () => {
    expect(text).toContain("The supervisor owns any respawn or handover decision");
    expect(text).toContain("slopweaver session depth");
  });

  it("asks only for durable state, which is the one thing the warned session can act on", () => {
    expect(text).toContain("Keep durable state current");
  });

  it("advertises no override, because nothing is refused", () => {
    expect(text).not.toContain("break-glass");
    expect(text).not.toContain("SLOPWEAVER_ALLOW");
    expect(text).not.toContain("blocks this");
  });
});
