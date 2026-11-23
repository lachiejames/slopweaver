/*
 * Which exhausted window a reading names: the five-hour one as readily as the weekly one, one with no reported width,
 * and, with two exhausted at once, the one that reopens last.
 */
import { describe, expect, it } from "vitest";
import { parseRolloutLine, parseRolloutObservation } from "../../../../codex/quotaLog.js";
import { REAL_FIVE_HOUR_EXHAUSTED_LINE } from "../../../codexRolloutLines.js";

describe("an exhausted window is an exhausted window, whichever one it is", () => {
  it("classifies a real 100% FIVE-HOUR window as exhausted, naming that window rather than the weekly one", () => {
    expect(parseRolloutLine({ line: REAL_FIVE_HOUR_EXHAUSTED_LINE })).toEqual({
      kind: "window-limit",
      limitId: "codex",
      observedAtIso: "2026-06-29T08:01:29.724Z",
      resetAtIso: "2026-06-25T15:01:03.000Z",
      windowMinutes: 300,
    });
  });

  it("carries no evidence for the same line's healthy weekly window — 46% is not an exhaustion", () => {
    const observation = parseRolloutObservation({ line: REAL_FIVE_HOUR_EXHAUSTED_LINE })!;

    expect(observation.evidence?.windowMinutes).toBe(300);
  });
});

describe("an exhausted window is never dropped for want of a width", () => {
  // A Codex review's counterexample: a window at 100% whose `window_minutes` Codex omitted was dropped
  // entirely, so the reading parsed as carrying no exhausted window — which reads HEALTHY, and a healthy
  // reading CLEARS a standing cap in its own scope. A live cap lifted two minutes after being recorded.
  const noWidthLine = JSON.stringify({
    payload: {
      rate_limits: {
        credits: null,
        limit_id: "codex",
        primary: { resets_at: 1_789_275_600, used_percent: 100 },
        rate_limit_reached_type: null,
        secondary: null,
      },
      type: "token_count",
    },
    timestamp: "2026-09-13T00:01:00.000Z",
    type: "event_msg",
  });

  it("reports the exhaustion, with no windowMinutes rather than no evidence", () => {
    expect(parseRolloutLine({ line: noWidthLine })).toEqual({
      kind: "window-limit",
      limitId: "codex",
      observedAtIso: "2026-09-13T00:01:00.000Z",
      resetAtIso: "2026-09-13T05:00:00.000Z",
    });
  });

  it("is NOT a healthy observation, so it cannot clear a cap of its own scope", () => {
    expect(parseRolloutObservation({ line: noWidthLine })?.evidence).toBeDefined();
  });
});

describe("the window named in a refusal is the one that reopens LAST", () => {
  // A Codex review disproved the width proxy with two windows exhausted at once: the five-hour one reset
  // three hours after the weekly one, and ranking by width named the weekly one and told the caller to wait
  // three hours less than they actually had to.
  const bothExhausted = JSON.stringify({
    payload: {
      rate_limits: {
        credits: null,
        limit_id: "codex",
        // Resets three hours apart: 16:00 and 13:00 on the same day.
        primary: { resets_at: 1_789_315_200, used_percent: 100, window_minutes: 300 },
        rate_limit_reached_type: null,
        secondary: { resets_at: 1_789_304_400, used_percent: 100, window_minutes: 10_080 },
      },
      type: "token_count",
    },
    timestamp: "2026-09-13T12:00:00.000Z",
    type: "event_msg",
  });

  it("names the five-hour window, because its reset is the later instant", () => {
    expect(parseRolloutLine({ line: bothExhausted })).toEqual({
      kind: "window-limit",
      limitId: "codex",
      observedAtIso: "2026-09-13T12:00:00.000Z",
      resetAtIso: "2026-09-13T16:00:00.000Z",
      windowMinutes: 300,
    });
  });

  it("prefers a window that HAS a reset over one that does not", () => {
    const oneUnreported = JSON.stringify({
      payload: {
        rate_limits: {
          credits: null,
          limit_id: "codex",
          primary: { used_percent: 100, window_minutes: 10_080 },
          rate_limit_reached_type: null,
          secondary: { resets_at: 1_789_304_400, used_percent: 100, window_minutes: 300 },
        },
        type: "token_count",
      },
      timestamp: "2026-09-13T12:00:00.000Z",
      type: "event_msg",
    });

    expect(parseRolloutLine({ line: oneUnreported })).toEqual({
      kind: "window-limit",
      limitId: "codex",
      observedAtIso: "2026-09-13T12:00:00.000Z",
      resetAtIso: "2026-09-13T13:00:00.000Z",
      windowMinutes: 300,
    });
  });
});
