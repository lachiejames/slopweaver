/*
 * `parseRolloutLine` over the REAL rollout lines in `src/__tests__/codexRolloutLines.ts`, the shape Codex actually
 * writes with `rate_limits` beside `info` rather than inside it.
 */
import { describe, expect, it } from "vitest";
import { parseRolloutLine } from "../../../../codex/quotaLog.js";
import {
  REAL_CREDITS_DEPLETED_LINE,
  REAL_FIVE_HOUR_PRIMARY_LINE,
  REAL_HEALTHY_NO_CREDITS_LINE,
  REAL_HEALTHY_WEEKLY_LINE,
  REAL_USAGE_LIMIT_REACHED_LINE,
  REAL_WEEKLY_EXHAUSTED_LINE,
} from "../../../codexRolloutLines.js";

describe("parseRolloutLine over REAL rollout lines", () => {
  it("reads a usage limit off the shape Codex actually writes — rate_limits beside info, not inside it", () => {
    expect(parseRolloutLine({ line: REAL_USAGE_LIMIT_REACHED_LINE })).toEqual({
      kind: "usage-limit",
      limitId: "premium",
      observedAtIso: "2026-09-11T07:31:24.319Z",
    });
  });

  it("reads credits-out off the real depletion line", () => {
    expect(parseRolloutLine({ line: REAL_CREDITS_DEPLETED_LINE })).toEqual({
      kind: "credits-out",
      limitId: "premium",
      observedAtIso: "2026-08-14T04:28:21.285Z",
    });
  });

  it("reads weekly-limit off a real 100% primary weekly window whose reached type is null", () => {
    expect(parseRolloutLine({ line: REAL_WEEKLY_EXHAUSTED_LINE })).toEqual({
      kind: "window-limit",
      limitId: "codex",
      observedAtIso: "2026-07-19T16:28:08.923Z",
      resetAtIso: "2026-07-25T16:58:16.000Z",
      windowMinutes: 10_080,
    });
  });

  it("carries no evidence for a real healthy weekly reading at 18%", () => {
    expect(parseRolloutLine({ line: REAL_HEALTHY_WEEKLY_LINE })).toBeUndefined();
  });

  it("carries no evidence for a real five-hour primary reading, whose weekly window sits in secondary", () => {
    expect(parseRolloutLine({ line: REAL_FIVE_HOUR_PRIMARY_LINE })).toBeUndefined();
  });

  it("carries no evidence for a real HEALTHY line whose credits object says has_credits: false", () => {
    // Found by a Codex review: reading the flag as exhaustion classified this — both windows at 0%, null
    // reached type, 510 output tokens produced — as credits-out, along with 1,010 others on this machine.
    expect(parseRolloutLine({ line: REAL_HEALTHY_NO_CREDITS_LINE })).toBeUndefined();
  });

  it("still reads the real credits-depleted line as credits-out, off its reached type", () => {
    expect(parseRolloutLine({ line: REAL_CREDITS_DEPLETED_LINE })).toEqual({
      kind: "credits-out",
      limitId: "premium",
      observedAtIso: "2026-08-14T04:28:21.285Z",
    });
  });
});
