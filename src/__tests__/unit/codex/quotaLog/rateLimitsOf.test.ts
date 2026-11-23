/*
 * `rateLimitsOf` — where a `token_count` event's `rate_limits` is found: beside `info`, nested inside it, or nowhere.
 */
import { describe, expect, it } from "vitest";
import { rateLimitsOf } from "../../../../codex/gauge.js";
import { REAL_HEALTHY_WEEKLY_LINE } from "../../../codexRolloutLines.js";
import { parseOwnJson } from "../../../parseOwnJson.js";

describe("rateLimitsOf", () => {
  it("finds rate_limits beside info, where every line on this machine puts it", () => {
    const line = parseOwnJson<{ readonly payload: Record<string, unknown> }>({ text: REAL_HEALTHY_WEEKLY_LINE });

    expect(rateLimitsOf({ payload: line.payload })?.["limit_id"]).toBe("codex");
  });

  it("still finds rate_limits nested inside info, the layout the module was first written against", () => {
    const payload = { info: { rate_limits: { limit_id: "codex" } }, type: "token_count" };

    expect(rateLimitsOf({ payload })).toEqual({ limit_id: "codex" });
  });

  it("returns undefined for a token_count event carrying no rate_limits in either position", () => {
    expect(rateLimitsOf({ payload: { info: { model_context_window: 258_400 }, type: "token_count" } })).toBeUndefined();
  });

  it("returns undefined for an event that is not a token_count, even when it carries rate_limits", () => {
    expect(rateLimitsOf({ payload: { rate_limits: { limit_id: "codex" }, type: "task_complete" } })).toBeUndefined();
  });
});
