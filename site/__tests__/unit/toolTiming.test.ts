/*
 * The timing words a transcript row carries: the pause the owner heard, and what the answer after it cost.
 */
import { describe, expect, it } from "vitest";

import { toolTimingWords } from "../../lib/toolTiming";

describe("toolTimingWords", () => {
  it("says nothing when nothing was measured", () => {
    expect(toolTimingWords({ ms: undefined, usage: undefined })).toBe("");
  });

  it("gives a sub-second pause in milliseconds and a longer one in seconds", () => {
    expect(toolTimingWords({ ms: 420, usage: undefined })).toBe("420ms");
    expect(toolTimingWords({ ms: 15_340, usage: undefined })).toBe("15.3s");
  });

  it("adds the tokens, and the thinking share only when there was one", () => {
    expect(toolTimingWords({ ms: 1800, usage: { inputTokens: 4210, outputTokens: 96, reasoningTokens: 64 } })).toBe(
      "1.8s · 4,210 in / 96 out (64 thinking)",
    );
    expect(toolTimingWords({ ms: undefined, usage: { inputTokens: 900, outputTokens: 40, reasoningTokens: 0 } })).toBe(
      "900 in / 40 out",
    );
  });
});
