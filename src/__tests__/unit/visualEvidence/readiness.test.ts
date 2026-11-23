/**
 * The readiness judgement over measured observations — including the incident's own shape, which is
 * `6 service values found` above a chart that drew nothing.
 */
import { describe, expect, it } from "vitest";

import type { CssRect, TargetObservation } from "../../../visualEvidence/observation.js";
import {
  MIN_INK_SAMPLES,
  MIN_NETWORK_QUIET_MS,
  readinessIssues,
  stabilityIssues,
  targetStateOf,
} from "../../../visualEvidence/readiness.js";

const RECT: CssRect = { height: 442, width: 1504, x: 472, y: 441 };
const QUERY_RECT: CssRect = { height: 112, width: 1824, x: 176, y: 88 };
const TIME_RECT: CssRect = { height: 28, width: 376, x: 1462, y: 89 };
const SUMMARY_RECT: CssRect = { height: 18, width: 242, x: 510, y: 372 };

/** The observation a live capture fired on, with the numbers it reported. */
const READY: TargetObservation = {
  chart: { canvasCount: 3, inkError: null, inkSamples: 9403, rect: RECT, sampledPixels: 183120, visibility: "visible" },
  document: { height: 3256, width: 2016 },
  networkQuietMs: 2737,
  observedAtMs: 7515,
  progressIndicators: 0,
  query: { rect: QUERY_RECT, text: "env:staging @err.code:(P2024 OR P2028)", visibility: "visible" },
  scroll: { x: 0, y: 53 },
  smallestFontPx: 10,
  summary: {
    groups: 2,
    logs: 32,
    rect: SUMMARY_RECT,
    text: "2 service values found ( based on 32 logs )",
    visibility: "visible",
  },
  targetMatches: 1,
  targetRect: { height: 597, width: 1537, x: 455, y: 310 },
  timeRange: { rect: TIME_RECT, text: "Aug 29, 10:15 am – Sep 13, 10:15 am", visibility: "visible" },
  viewport: { height: 883, width: 2016 },
};

describe("targetStateOf", () => {
  it("is data when the summary counts groups and the chart drew", () => {
    expect(targetStateOf({ observation: READY })).toBe("data");
  });

  it("is empty-panel for the incident's shape: a positive count above a chart with no ink", () => {
    const incident = {
      ...READY,
      chart: { ...READY.chart, inkSamples: 0 },
      summary: { ...READY.summary!, groups: 6, logs: 100794 },
    };
    expect(targetStateOf({ observation: incident })).toBe("empty-panel");
  });

  it("is empty-panel when the summary has answered and no chart has rendered at all", () => {
    const noChart = {
      ...READY,
      chart: { ...READY.chart, canvasCount: 0, inkSamples: 0, rect: null, visibility: null },
    };
    expect(targetStateOf({ observation: noChart })).toBe("empty-panel");
  });

  it("is conflicting for a 0/0 summary whose chart drew 1..49 samples — below the positive floor is not zero", () => {
    for (const inkSamples of [1, MIN_INK_SAMPLES - 1]) {
      const partial = {
        ...READY,
        chart: { ...READY.chart, inkSamples },
        summary: { ...READY.summary!, groups: 0, logs: 0 },
      };
      expect(targetStateOf({ observation: partial })).toBe("conflicting");
    }
    const drew = {
      ...READY,
      chart: { ...READY.chart, inkSamples: MIN_INK_SAMPLES },
      summary: { ...READY.summary!, groups: 0, logs: 0 },
    };
    expect(targetStateOf({ observation: drew })).toBe("conflicting");
  });

  it("is zero-results for 0 groups over 0 logs with canvases that drew nothing", () => {
    const zero = {
      ...READY,
      chart: { ...READY.chart, inkSamples: 0 },
      summary: { ...READY.summary!, groups: 0, logs: 0, text: "0 service values found ( based on 0 logs )" },
    };
    expect(targetStateOf({ observation: zero })).toBe("zero-results");
    expect(readinessIssues({ observation: zero })).toEqual([]);
  });

  it("is unloaded with no summary, whatever the chart says", () => {
    expect(targetStateOf({ observation: { ...READY, summary: null } })).toBe("unloaded");
  });

  it("is unloaded for a zero summary with no chart yet, never zero-results", () => {
    const early = {
      ...READY,
      chart: { ...READY.chart, canvasCount: 0, inkSamples: 0, rect: null, visibility: null },
      summary: { ...READY.summary!, groups: 0, logs: 0 },
    };
    expect(targetStateOf({ observation: early })).toBe("unloaded");
  });

  it("is conflicting when the summary says nothing and the chart drew something", () => {
    const conflict = { ...READY, summary: { ...READY.summary!, groups: 0, logs: 0 } };
    expect(targetStateOf({ observation: conflict })).toBe("conflicting");
  });

  it("is conflicting when the summary says 0 groups over a positive log count", () => {
    const conflict = {
      ...READY,
      chart: { ...READY.chart, inkSamples: 0 },
      summary: { ...READY.summary!, groups: 0, logs: 12 },
    };
    expect(targetStateOf({ observation: conflict })).toBe("conflicting");
  });

  it("counts ink at exactly the floor as drawn, and one below as not", () => {
    const at = { ...READY, chart: { ...READY.chart, inkSamples: MIN_INK_SAMPLES } };
    const below = { ...READY, chart: { ...READY.chart, inkSamples: MIN_INK_SAMPLES - 1 } };
    expect(targetStateOf({ observation: at })).toBe("data");
    expect(targetStateOf({ observation: below })).toBe("empty-panel");
  });
});

describe("readinessIssues", () => {
  it("is empty for the observation the live capture fired on", () => {
    expect(readinessIssues({ observation: READY })).toEqual([]);
  });

  it("names the incident: EMPTY_PANEL carrying the group count, and nothing else wrong", () => {
    const incident = {
      ...READY,
      chart: { ...READY.chart, inkSamples: 0 },
      summary: { ...READY.summary!, groups: 6, logs: 100794 },
    };
    const issues = readinessIssues({ observation: incident });
    expect(issues.map((issue) => issue.code)).toEqual(["EMPTY_PANEL"]);
    expect(issues[0]!.message).toBe(
      "the summary counts 6 group(s) and the chart drew nothing — an empty panel its own summary contradicts",
    );
  });

  it("stops at TARGET_ABSENT, which makes every other check meaningless", () => {
    const issues = readinessIssues({ observation: { ...READY, targetMatches: 0, targetRect: null } });
    expect(issues.map((issue) => issue.code)).toEqual(["TARGET_ABSENT"]);
  });

  it("refuses two matching targets", () => {
    const issues = readinessIssues({ observation: { ...READY, targetMatches: 2 } });
    expect(issues.map((issue) => issue.code)).toEqual(["TARGET_AMBIGUOUS"]);
  });

  it("refuses a loading indicator inside the target", () => {
    const issues = readinessIssues({ observation: { ...READY, progressIndicators: 2 } });
    expect(issues.map((issue) => issue.code)).toEqual(["STILL_LOADING"]);
    expect(issues[0]!.message).toBe("2 loading indicator(s) inside the target");
  });

  it("refuses a network that moved inside the quiet floor, and accepts the floor itself", () => {
    expect(
      readinessIssues({ observation: { ...READY, networkQuietMs: MIN_NETWORK_QUIET_MS - 1 } }).map(
        (issue) => issue.code,
      ),
    ).toEqual(["NETWORK_ACTIVE"]);
    expect(readinessIssues({ observation: { ...READY, networkQuietMs: MIN_NETWORK_QUIET_MS } })).toEqual([]);
  });

  it("names an absent summary and an absent chart as two separate facts", () => {
    const early = {
      ...READY,
      chart: { ...READY.chart, canvasCount: 0, inkSamples: 0, rect: null, visibility: null },
      summary: null,
    };
    expect(readinessIssues({ observation: early }).map((issue) => issue.code)).toEqual([
      "SUMMARY_ABSENT",
      "CHART_ABSENT",
    ]);
  });

  it("names a canvas that could not be read rather than calling it empty", () => {
    const tainted = { ...READY, chart: { ...READY.chart, inkError: "SecurityError: tainted", inkSamples: 0 } };
    expect(readinessIssues({ observation: tainted }).map((issue) => issue.code)).toEqual(["CHART_UNREADABLE"]);
  });

  it("names disagreeing witnesses", () => {
    const conflict = { ...READY, summary: { ...READY.summary!, groups: 0, logs: 0 } };
    expect(readinessIssues({ observation: conflict }).map((issue) => issue.code)).toEqual(["CONFLICTING_WITNESSES"]);
  });

  it("names the missing context controls by name", () => {
    const issues = readinessIssues({ observation: { ...READY, query: null, timeRange: null } });
    expect(issues.map((issue) => issue.code)).toEqual(["CONTEXT_ABSENT"]);
    expect(issues[0]!.message).toBe("not on the page: query, time range");
  });

  it("refuses a region under a sticky bar or off the viewport's edge, naming which and how", () => {
    const hidden = {
      ...READY,
      chart: { ...READY.chart, visibility: "clipped" as const },
      query: { ...READY.query!, visibility: "occluded" as const },
    };
    const issues = readinessIssues({ observation: hidden });
    expect(issues.map((issue) => issue.code)).toEqual(["REGION_NOT_VISIBLE"]);
    expect(issues[0]!.message).toBe(
      "not wholly visible in the viewport as scrolled: chart (clipped), query (occluded)",
    );
  });

  it("accepts a zero-results view as ready", () => {
    const zero = {
      ...READY,
      chart: { ...READY.chart, inkSamples: 0 },
      summary: { ...READY.summary!, groups: 0, logs: 0 },
    };
    expect(readinessIssues({ observation: zero })).toEqual([]);
  });
});

describe("stabilityIssues", () => {
  it("is empty when nothing moved", () => {
    expect(stabilityIssues({ after: READY, before: READY })).toEqual([]);
  });

  it("tolerates a one-pixel drift and refuses two", () => {
    const drift1 = { ...READY, chart: { ...READY.chart, rect: { ...RECT, y: RECT.y + 1 } } };
    const drift2 = { ...READY, chart: { ...READY.chart, rect: { ...RECT, y: RECT.y + 2 } } };
    expect(stabilityIssues({ after: drift1, before: READY })).toEqual([]);
    expect(stabilityIssues({ after: drift2, before: READY })).toEqual([
      "the chart moved, resized or disappeared during the capture",
    ]);
  });

  it("names a document that grew, a state that changed, and the after-observation's own readiness issues", () => {
    const after = {
      ...READY,
      chart: { ...READY.chart, inkSamples: 0 },
      document: { height: 6722, width: 2016 },
      progressIndicators: 1,
    };
    expect(stabilityIssues({ after, before: READY })).toEqual([
      "the document changed size during the capture: 2016x3256 then 2016x6722",
      "the target's state changed during the capture",
      "the target stopped being ready during the capture: 1 loading indicator(s) inside the target; the summary counts 2 " +
        "group(s) and the chart drew nothing — an empty panel its own summary contradicts",
    ]);
  });

  it("refuses a context region that moved, was clipped or changed text between the two observations", () => {
    const movedQuery = { ...READY, query: { ...READY.query!, rect: { ...QUERY_RECT, y: 900 } } };
    // The fixture keeps `visibility: "visible"` here, which the real page would not report for a rectangle
    // below the viewport's fold — so this pins the RECTANGLE comparison on its own, without the
    // visibility flag helping it along.
    expect(stabilityIssues({ after: movedQuery, before: READY })).toEqual([
      "the query moved, resized or disappeared during the capture",
    ]);
    const clippedQuery = { ...READY, query: { ...READY.query!, visibility: "clipped" as const } };
    expect(stabilityIssues({ after: clippedQuery, before: READY })).toEqual([
      "the target stopped being ready during the capture: not wholly visible in the viewport as scrolled: query (clipped)",
    ]);
    const retyped = { ...READY, query: { ...READY.query!, text: "env:prod" } };
    expect(stabilityIssues({ after: retyped, before: READY })).toEqual(["the query text changed during the capture"]);
    const rescrolled = { ...READY, scroll: { x: 0, y: 400 } };
    expect(stabilityIssues({ after: rescrolled, before: READY })).toEqual(["the page scrolled during the capture"]);
  });
});
