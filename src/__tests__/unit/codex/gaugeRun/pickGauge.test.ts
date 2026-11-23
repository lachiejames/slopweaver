/*
 * `pickGauge` — which of several rollout readings the gauge reports, so an empty or stale one never masks a cap.
 */
import { describe, expect, it } from "vitest";
import { parseGaugeLine } from "../../../../codex/gauge.js";
import { pickGauge } from "../../../../codex/gaugeScan.js";
import {
  REAL_HEALTHY_WEEKLY_LINE,
  REAL_POST_CAP_PREMIUM_EMPTY_LINE,
  REAL_USAGE_LIMIT_REACHED_LINE,
  REAL_WEEKLY_EXHAUSTED_LINE,
} from "../../../codexRolloutLines.js";
import { FIVE_HOUR_OPEN_RESET, FIVE_HOUR_PASSED_RESET, OPEN_WEEKLY_EXHAUSTED_LINE, twoWindowLine } from "./harness.js";

describe("pickGauge — a reading that says nothing never masks one that does", () => {
  it("reports the older weekly reading at 100% over a NEWER empty post-cap reading", () => {
    const weekly = {
      ...parseGaugeLine({ line: OPEN_WEEKLY_EXHAUSTED_LINE })!,
      observedAtIso: "2026-09-22T19:49:00.000Z",
    };
    const empty = parseGaugeLine({ line: REAL_POST_CAP_PREMIUM_EMPTY_LINE })!;

    expect(empty.windows).toEqual([]);
    expect(pickGauge({ gauges: [empty, weekly] })?.windows[0]?.usedPercent).toBe(100);
    expect(pickGauge({ gauges: [weekly, empty] })?.observedAtIso).toBe("2026-09-22T19:49:00.000Z");
  });

  it("reports a window at its high-water mark when a later concurrent reading of it dipped", () => {
    const capped = parseGaugeLine({ line: OPEN_WEEKLY_EXHAUSTED_LINE })!;
    const window = capped.windows[0]!;
    const dipped = {
      ...capped,
      observedAtIso: "2026-09-22T19:49:00.000Z",
      windows: [
        { ...window, resetAtIso: new Date(Date.parse(window.resetAtIso!) + 20_000).toISOString(), usedPercent: 97 },
      ],
    };
    const otherWindow = {
      ...capped,
      windows: [{ ...window, resetAtIso: "2030-01-01T00:00:00.000Z", usedPercent: 100 }],
    };

    expect(pickGauge({ gauges: [capped, dipped] })!.windows[0]!.usedPercent).toBe(100);
    expect(pickGauge({ gauges: [capped, dipped] })!.observedAtIso).toBe("2026-09-22T19:49:00.000Z");
    expect(pickGauge({ gauges: [otherWindow, dipped] })!.windows[0]!.usedPercent).toBe(97);
  });

  it("never raises a window to a mark read after that window had already reset", () => {
    const current = parseGaugeLine({ line: OPEN_WEEKLY_EXHAUSTED_LINE })!;
    const window = current.windows[0]!;
    const twenty = {
      ...current,
      observedAtIso: "2026-09-23T10:00:00.000Z",
      windows: [{ ...window, usedPercent: 20 }],
    };
    const afterReset = {
      ...current,
      observedAtIso: "2026-09-28T00:00:00.000Z",
      windows: [{ ...window, usedPercent: 100 }],
    };

    expect(pickGauge({ gauges: [twenty, afterReset] })!.windows[0]!.usedPercent).toBe(20);
  });

  it("reports no window at all when the only reading is of a window that had already reset", () => {
    const expired = {
      ...parseGaugeLine({ line: REAL_WEEKLY_EXHAUSTED_LINE })!,
      observedAtIso: "2026-09-23T12:00:00.000Z",
    };

    const picked = pickGauge({ gauges: [expired] })!;

    expect(expired.windows[0]!.usedPercent).toBe(100);
    expect(picked.observedAtIso).toBe("2026-09-23T12:00:00.000Z");
    expect(picked.windows).toEqual([]);
  });

  it("drops the reached type reported beside a window that had already reset, never a windowless refusal", () => {
    const expired = {
      ...parseGaugeLine({
        line: REAL_WEEKLY_EXHAUSTED_LINE.replace(
          '"rate_limit_reached_type":null',
          '"rate_limit_reached_type":"workspace_member_usage_limit_reached"',
        ),
      })!,
      observedAtIso: "2026-09-23T12:00:00.000Z",
    };

    const picked = pickGauge({ gauges: [expired] })!;

    expect(expired.reachedType).toBe("workspace_member_usage_limit_reached");
    expect(picked.windows).toEqual([]);
    expect(picked.reachedType).toBeUndefined();
    expect(picked.reached).toBeUndefined();
  });

  it("picks each window from the newest reading holding it OPEN, so a sibling's stale window hides no cap", () => {
    const older = parseGaugeLine({
      line: twoWindowLine({
        fiveHour: 100,
        fiveHourResetSeconds: FIVE_HOUR_OPEN_RESET,
        observedIso: "2026-09-23T10:30:00.000Z",
        weekly: 20,
      }),
    })!;
    const newer = parseGaugeLine({
      line: twoWindowLine({
        fiveHour: 5,
        fiveHourResetSeconds: FIVE_HOUR_PASSED_RESET,
        observedIso: "2026-09-23T11:00:00.000Z",
        weekly: 21,
      }),
    })!;

    const picked = pickGauge({ gauges: [newer, older] })!;

    expect(picked.observedAtIso).toBe("2026-09-23T11:00:00.000Z");
    expect(picked.windows.map((window) => [window.label, window.usedPercent])).toEqual([
      ["weekly", 21],
      ["five-hour", 100],
    ]);
  });

  it("still reports the empty reading when it is all there is, rather than nothing", () => {
    const empty = parseGaugeLine({ line: REAL_POST_CAP_PREMIUM_EMPTY_LINE })!;

    expect(pickGauge({ gauges: [empty] })?.observedAtIso).toBe("2026-09-22T21:31:50.600Z");
  });

  it("lets a newer reading carrying a REACHED type win over an older window — it is informative", () => {
    const weekly = parseGaugeLine({ line: REAL_HEALTHY_WEEKLY_LINE })!;
    const reached = {
      ...parseGaugeLine({ line: REAL_USAGE_LIMIT_REACHED_LINE })!,
      observedAtIso: "2026-09-14T00:00:00.000Z",
    };

    const picked = pickGauge({ gauges: [weekly, reached] })!;

    expect(picked.observedAtIso).toBe("2026-09-14T00:00:00.000Z");
    expect(picked.reachedType).toBe("workspace_member_usage_limit_reached");
    // The exhaustion event names no window, so the still-open weekly one is carried rather than shown unread.
    expect(picked.windows.map((window) => [window.label, window.usedPercent])).toEqual(
      weekly.windows.map((window) => [window.label, window.usedPercent]),
    );
    expect(picked.windows.length).toBeGreaterThan(0);
  });

  it("carries no window whose reset falls at or before the windowless reached reading", () => {
    const weekly = parseGaugeLine({ line: REAL_HEALTHY_WEEKLY_LINE })!;
    const reached = {
      ...parseGaugeLine({ line: REAL_USAGE_LIMIT_REACHED_LINE })!,
      observedAtIso: weekly.windows[0]!.resetAtIso!,
    };

    expect(pickGauge({ gauges: [weekly, reached] })!.windows).toEqual([]);
  });
});
