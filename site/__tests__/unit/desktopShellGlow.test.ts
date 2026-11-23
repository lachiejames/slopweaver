/**
 * The page's edge-glow report to the desktop shell: no flash as the wire's `null`, and the level only while the voice
 * speaks, to the precision the glow draws it.
 */
import { describe, expect, it } from "vitest";

import { overlayGlowReport } from "../../lib/desktopShellGlow";

describe("overlayGlowReport", () => {
  it("carries the speaking level to three decimals, and a frame's flash by its key", () => {
    expect(overlayGlowReport({ flash: "call_9", level: 0.123456, state: "speaking" })).toEqual({
      level: 0.123,
      pulse: "call_9",
      state: "speaking",
    });
  });

  it("sends no flash as null", () => {
    expect(overlayGlowReport({ flash: undefined, level: 0.5, state: "shared-speaking" })).toEqual({
      level: 0.5,
      pulse: null,
      state: "shared-speaking",
    });
  });

  it("reports a level of zero whenever the voice is not speaking, whatever the output meter reads", () => {
    expect(
      (["off", "shared"] as const).map((state) => overlayGlowReport({ flash: undefined, level: 0.31, state }).level),
    ).toEqual([0, 0]);
  });
});
