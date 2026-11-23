/*
 * `parseRolloutLine` over the HAND-WRITTEN lines, the nested `info.rate_limits` layout `harness.ts`'s overview
 * explains: what reads as evidence, and every input that carries none.
 */
import { describe, expect, it } from "vitest";
import { parseRolloutLine } from "../../../../codex/quotaLog.js";
import { CREDITS_OUT_LINE, HEALTHY_LINE } from "./harness.js";

const WEEKLY_LIMIT_LINE = JSON.stringify({
  payload: {
    info: {
      rate_limits: {
        credits: { balance: null, has_credits: true, unlimited: false },
        plan_type: "team",
        primary: { resets_at: 1787012719, used_percent: 100.0, window_minutes: 10_080 },
        rate_limit_reached_type: null,
      },
    },
    type: "token_count",
  },
  timestamp: "2026-08-13T18:26:25.837Z",
  type: "event_msg",
});

const CREDITS_DEPLETED_TOKEN_COUNT_LINE = JSON.stringify({
  payload: {
    info: {
      rate_limits: {
        credits: { balance: null, has_credits: false, unlimited: false },
        rate_limit_reached_type: "workspace_member_credits_depleted",
      },
    },
    type: "token_count",
  },
  timestamp: "2026-08-14T04:00:00.000Z",
  type: "event_msg",
});

describe("parseRolloutLine", () => {
  it("reads credits-out off a task_complete event's codex_error_info", () => {
    expect(parseRolloutLine({ line: CREDITS_OUT_LINE })).toEqual({
      kind: "credits-out",
      observedAtIso: "2026-08-14T04:01:14.586Z",
    });
  });

  it("reads weekly-limit off a token_count event's rate_limits.primary, converting resets_at to ISO", () => {
    expect(parseRolloutLine({ line: WEEKLY_LIMIT_LINE })).toEqual({
      kind: "window-limit",
      observedAtIso: "2026-08-13T18:26:25.837Z",
      resetAtIso: "2026-08-18T00:25:19.000Z",
      windowMinutes: 10_080,
    });
  });

  it("reads credits-out off rate_limit_reached_type even when primary is absent", () => {
    expect(parseRolloutLine({ line: CREDITS_DEPLETED_TOKEN_COUNT_LINE })).toEqual({
      kind: "credits-out",
      observedAtIso: "2026-08-14T04:00:00.000Z",
    });
  });

  it("carries no evidence for a healthy token_count snapshot", () => {
    expect(parseRolloutLine({ line: HEALTHY_LINE })).toBeUndefined();
  });

  it("carries no evidence for an unrelated event type", () => {
    const line = JSON.stringify({ payload: { type: "agent_message" }, timestamp: "2026-08-14T00:00:00.000Z" });

    expect(parseRolloutLine({ line })).toBeUndefined();
  });

  it("carries no evidence for a line missing a timestamp", () => {
    const line = JSON.stringify({ payload: { type: "task_complete" } });

    expect(parseRolloutLine({ line })).toBeUndefined();
  });

  it("carries no evidence for invalid JSON rather than throwing", () => {
    expect(parseRolloutLine({ line: "not json at all" })).toBeUndefined();
  });

  it("carries no evidence for an empty line", () => {
    expect(parseRolloutLine({ line: "" })).toBeUndefined();
  });
});
