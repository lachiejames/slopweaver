/**
 * {@link parseGaugeLine}, {@link gaugeFromRateLimits} and {@link codexWindowByLabel} — Codex's own budget as
 * a full reading rather than an exhaustion flag.
 *
 * Every positive case runs over a line copied verbatim out of `$CODEX_HOME/sessions`
 * (`src/__tests__/codexRolloutLines.ts`). That is deliberate and it is the lesson of the defect this module
 * was built alongside: the parser this replaces was tested exclusively against fixtures typed from its own
 * doc comment, agreed with them perfectly, and matched nothing Codex has ever written.
 */
import { describe, expect, it } from "vitest";
import { codexWindowByLabel, gaugeFromRateLimits, parseGaugeLine, rateLimitsOf } from "../../../codex/gauge.js";
import {
  REAL_CREDITS_DEPLETED_LINE,
  REAL_FIVE_HOUR_PRIMARY_LINE,
  REAL_HEALTHY_WEEKLY_LINE,
  REAL_USAGE_LIMIT_REACHED_LINE,
  REAL_WEEKLY_EXHAUSTED_LINE,
} from "../../codexRolloutLines.js";

describe("parseGaugeLine over real rollout lines", () => {
  it("reads the whole healthy weekly reading, windows labelled by width rather than by slot", () => {
    expect(parseGaugeLine({ line: REAL_HEALTHY_WEEKLY_LINE })).toEqual({
      credits: { balance: null, hasCredits: true, unlimited: false },
      limitId: "codex",
      observedAtIso: "2026-09-13T05:51:14.803Z",
      planType: "self_serve_business_prolite",
      reached: undefined,
      reachedType: undefined,
      windows: [
        {
          label: "weekly",
          resetAtIso: "2026-09-20T04:07:01.000Z",
          slot: "primary",
          usedPercent: 18,
          windowMinutes: 10_080,
        },
      ],
    });
  });

  it("labels a five-hour PRIMARY and a weekly SECONDARY by their own widths, not their slots", () => {
    const gauge = parseGaugeLine({ line: REAL_FIVE_HOUR_PRIMARY_LINE })!;

    expect(gauge.windows.map((window) => [window.slot, window.label, window.windowMinutes])).toEqual([
      ["primary", "five-hour", 300],
      ["secondary", "weekly", 10_080],
    ]);
    expect(codexWindowByLabel({ gauge, label: "weekly" })?.usedPercent).toBe(13);
    expect(codexWindowByLabel({ gauge, label: "five-hour" })?.usedPercent).toBe(1);
  });

  it("reads credits as absent rather than as false when the event carries credits: null", () => {
    expect(parseGaugeLine({ line: REAL_FIVE_HOUR_PRIMARY_LINE })?.credits).toBeUndefined();
  });

  it("keeps the reached type verbatim beside its classification", () => {
    const gauge = parseGaugeLine({ line: REAL_USAGE_LIMIT_REACHED_LINE })!;

    expect(gauge.reachedType).toBe("workspace_member_usage_limit_reached");
    expect(gauge.reached).toBe("usage-limit");
    expect(gauge.limitId).toBe("premium");
    expect(gauge.windows).toEqual([]);
  });

  it("classifies a credits depletion, whose own credits object reports no credits", () => {
    const gauge = parseGaugeLine({ line: REAL_CREDITS_DEPLETED_LINE })!;

    expect(gauge.reached).toBe("credits-out");
    expect(gauge.credits).toEqual({ balance: null, hasCredits: false, unlimited: false });
  });

  it("reads a 100% weekly window whose reached type is null", () => {
    const gauge = parseGaugeLine({ line: REAL_WEEKLY_EXHAUSTED_LINE })!;

    expect(gauge.reachedType).toBeUndefined();
    expect(codexWindowByLabel({ gauge, label: "weekly" })?.usedPercent).toBe(100);
  });
});

describe("parseGaugeLine on lines that carry no reading", () => {
  it("returns undefined for an event that is not a token_count", () => {
    const line = JSON.stringify({ payload: { type: "agent_message" }, timestamp: "2026-09-13T00:00:00.000Z" });

    expect(parseGaugeLine({ line })).toBeUndefined();
  });

  it("returns undefined for a truncated line, which every tail read starts with", () => {
    expect(parseGaugeLine({ line: REAL_HEALTHY_WEEKLY_LINE.slice(120) })).toBeUndefined();
  });

  it("returns undefined for an empty line", () => {
    expect(parseGaugeLine({ line: "" })).toBeUndefined();
  });
});

describe("gaugeFromRateLimits on shapes a future Codex could write", () => {
  it("keeps an unrecognised reached type visible and refuses to classify it", () => {
    const gauge = gaugeFromRateLimits({
      observedAtIso: "2026-09-13T00:00:00.000Z",
      rateLimits: { rate_limit_reached_type: "some_new_wording_nobody_has_seen" },
    });

    expect(gauge.reachedType).toBe("some_new_wording_nobody_has_seen");
    expect(gauge.reached).toBeUndefined();
  });

  it("labels a window width it has never seen as `other` rather than guessing weekly", () => {
    const gauge = gaugeFromRateLimits({
      observedAtIso: "2026-09-13T00:00:00.000Z",
      rateLimits: { primary: { resets_at: 1_789_877_221, used_percent: 5, window_minutes: 1440 } },
    });

    expect(gauge.windows[0]?.label).toBe("other");
    expect(codexWindowByLabel({ gauge, label: "weekly" })).toBeUndefined();
  });

  it("drops a window whose percentage is not a number rather than reading it as zero", () => {
    const gauge = gaugeFromRateLimits({
      observedAtIso: "2026-09-13T00:00:00.000Z",
      rateLimits: { primary: { used_percent: "18.0", window_minutes: 10_080 } },
    });

    expect(gauge.windows).toEqual([]);
  });

  it("reads a window with no resets_at, leaving the reset absent rather than inventing one", () => {
    const gauge = gaugeFromRateLimits({
      observedAtIso: "2026-09-13T00:00:00.000Z",
      rateLimits: { primary: { used_percent: 42, window_minutes: 10_080 } },
    });

    expect(gauge.windows[0]?.resetAtIso).toBeUndefined();
    expect(gauge.windows[0]?.usedPercent).toBe(42);
  });

  it("preserves a percentage above 100 rather than clamping it", () => {
    const gauge = gaugeFromRateLimits({
      observedAtIso: "2026-09-13T00:00:00.000Z",
      rateLimits: { primary: { used_percent: 104.5, window_minutes: 300 } },
    });

    expect(gauge.windows[0]?.usedPercent).toBe(104.5);
  });
});

describe("a rate_limits position only answers when it CARRIES a reading", () => {
  // A Codex review's counterexample: an empty sibling `{"limit_id":"codex"}` masked a nested window at 100%,
  // so the line parsed as a HEALTHY observation — and a healthy observation of that scope clears a cap.
  it("falls through an empty sibling to the nested object that holds the window", () => {
    const payload = {
      info: { rate_limits: { limit_id: "codex", primary: { used_percent: 100 } } },
      rate_limits: { limit_id: "codex" },
      type: "token_count",
    };

    expect(rateLimitsOf({ payload })?.["primary"]).toEqual({ used_percent: 100 });
  });

  it("still prefers the sibling when the sibling is the one carrying the window", () => {
    const payload = {
      info: { rate_limits: { limit_id: "old", primary: { used_percent: 3 } } },
      rate_limits: { limit_id: "codex", primary: { used_percent: 71 } },
      type: "token_count",
    };

    expect(rateLimitsOf({ payload })?.["limit_id"]).toBe("codex");
  });

  it("answers with a reached type alone, which an exhaustion event carries with both windows null", () => {
    const payload = {
      info: { rate_limits: { limit_id: "old", primary: { used_percent: 3 } } },
      rate_limits: { limit_id: "premium", rate_limit_reached_type: "workspace_member_usage_limit_reached" },
      type: "token_count",
    };

    expect(rateLimitsOf({ payload })?.["limit_id"]).toBe("premium");
  });

  it("returns the present object when NEITHER carries a reading, so an empty one stays distinguishable from none", () => {
    const payload = { rate_limits: { limit_id: "codex" }, type: "token_count" };

    expect(rateLimitsOf({ payload })).toEqual({ limit_id: "codex" });
  });
});

describe("a slot only carries a reading when it carries a PERCENTAGE", () => {
  // The second round of the same finding: `primary: {}` is an object, so it counted as a reading, won the
  // position contest, and was then dropped by `windowOf` for having no percentage — masking a nested window
  // at 100% and turning an exhausted line into a healthy one.
  it("falls through a sibling whose primary slot is empty", () => {
    const payload = {
      info: { rate_limits: { limit_id: "codex", primary: { used_percent: 100 } } },
      rate_limits: { limit_id: "codex", primary: {} },
      type: "token_count",
    };

    expect(rateLimitsOf({ payload })?.["primary"]).toEqual({ used_percent: 100 });
  });

  it("falls through a sibling whose slots carry everything BUT a percentage", () => {
    const payload = {
      info: { rate_limits: { limit_id: "codex", secondary: { used_percent: 100, window_minutes: 300 } } },
      rate_limits: { limit_id: "codex", primary: { resets_at: 1, window_minutes: 300 } },
      type: "token_count",
    };

    expect(rateLimitsOf({ payload })?.["secondary"]).toEqual({ used_percent: 100, window_minutes: 300 });
  });
});
