/*
 * A `task_complete` error is classified by its message: a spend cap, an out-of-credits workspace, a wording nobody
 * has captured, and a failure that is not about quota at all.
 */
import { describe, expect, it } from "vitest";
import { parseRolloutLine } from "../../../../codex/quotaLog.js";
import { REAL_CREDITS_TASK_COMPLETE_LINE, REAL_SPEND_CAP_TASK_COMPLETE_LINE } from "../../../codexRolloutLines.js";

describe("a task_complete error is classified by its MESSAGE, not by the code both exhaustions share", () => {
  // A Codex review found `usage_limit_exceeded` mapped unconditionally to credits-out, which made this
  // reader disagree with the `token_count` describing the same failure. All 93 events on this machine carry
  // that one code and split 85 / 8 by wording — the same split as the two reached types.
  it("reads a real SPEND-CAP task_complete as a usage limit, matching its own token_count event", () => {
    expect(parseRolloutLine({ line: REAL_SPEND_CAP_TASK_COMPLETE_LINE })).toEqual({
      kind: "usage-limit",
      observedAtIso: "2026-09-11T07:31:24.321Z",
    });
  });

  it("reads a real OUT-OF-CREDITS task_complete as credits-out", () => {
    expect(parseRolloutLine({ line: REAL_CREDITS_TASK_COMPLETE_LINE })).toEqual({
      kind: "credits-out",
      observedAtIso: "2026-08-14T04:41:50.289Z",
    });
  });

  it("falls back to usage-limit for a wording nobody has captured, never to a credit claim", () => {
    const line = JSON.stringify({
      payload: {
        error: { codex_error_info: "usage_limit_exceeded", message: "some phrasing this machine has not seen" },
        type: "task_complete",
      },
      timestamp: "2026-09-13T00:00:00.000Z",
    });

    expect(parseRolloutLine({ line })).toEqual({ kind: "usage-limit", observedAtIso: "2026-09-13T00:00:00.000Z" });
  });

  it("carries no evidence for a task_complete that failed for some other reason", () => {
    const line = JSON.stringify({
      payload: { error: { codex_error_info: "server_overloaded", message: "try again" }, type: "task_complete" },
      timestamp: "2026-09-13T00:00:00.000Z",
    });

    expect(parseRolloutLine({ line })).toBeUndefined();
  });
});
