import { describe, expect, it } from "vitest";

import { type SpanMessage, spanMs, splitAlertSpan } from "../../../../live/slack/alertTrend.js";
import { ALERT_TREND_PRIOR_WINDOWS, ALERT_TREND_PRIOR_WINDOWS_MAX } from "../../../../outbound/artifact/trend.js";

/** An arbitrary instant the whole file cuts against — a round number, so every offset below is readable. */
const NOW_MS = 1_700_000_000_000;

/** One day, the window these cards are actually taken over. */
const DAY_MS = 86_400_000;

/** A message at a given offset BEFORE `NOW_MS`, carrying the Slack `ts` shape. */
function at({ msAgo, id }: { msAgo: number; id: string }): SpanMessage & { id: string } {
  return { id, ts: String((NOW_MS - msAgo) / 1000) };
}

describe("spanMs — how far back the one crawl has to reach", () => {
  it("is the card's own window plus one more per baseline window", () => {
    expect(spanMs({ priorWindows: 3, windowMs: DAY_MS })).toBe(4 * DAY_MS);
  });

  it("is the card's own window alone when no baseline is asked for", () => {
    expect(spanMs({ priorWindows: 0, windowMs: DAY_MS })).toBe(DAY_MS);
  });
});

describe("ALERT_TREND_PRIOR_WINDOWS — the default baseline", () => {
  it("stays inside the bound the card's own width promise puts on it", () => {
    expect(ALERT_TREND_PRIOR_WINDOWS).toBeLessThanOrEqual(ALERT_TREND_PRIOR_WINDOWS_MAX);
    expect(ALERT_TREND_PRIOR_WINDOWS).toBe(3);
  });
});

describe("splitAlertSpan — the cut that keeps the card's own numbers unchanged", () => {
  it("puts a message inside the newest window in `current` and everything older in `prior`", () => {
    const span = splitAlertSpan({
      messages: [
        at({ id: "now", msAgo: 60_000 }),
        at({ id: "yesterday", msAgo: 30 * 3_600_000 }),
        at({ id: "three-days", msAgo: 80 * 3_600_000 }),
      ],
      nowMs: NOW_MS,
      priorWindows: 3,
      windowMs: DAY_MS,
    });

    expect(span.current.map((message) => message.id)).toEqual(["now"]);
    expect(span.prior.map((message) => message.id)).toEqual(["yesterday", "three-days"]);
  });

  it("drops a message older than the whole span, so a wide crawl never inflates the baseline", () => {
    const span = splitAlertSpan({
      messages: [at({ id: "ancient", msAgo: 30 * DAY_MS })],
      nowMs: NOW_MS,
      priorWindows: 3,
      windowMs: DAY_MS,
    });

    expect(span.current).toEqual([]);
    expect(span.prior).toEqual([]);
  });

  it("puts an UNTIMESTAMPED message in `current`, which is the half a reader checks against the channel", () => {
    const span = splitAlertSpan({ messages: [{}], nowMs: NOW_MS, priorWindows: 3, windowMs: DAY_MS });

    expect(span.current.length).toBe(1);
    expect(span.prior).toEqual([]);
  });

  it("puts a message whose `ts` is not a Slack timestamp in `current` rather than guessing at an instant", () => {
    const span = splitAlertSpan({ messages: [{ ts: "not-a-ts" }], nowMs: NOW_MS, priorWindows: 3, windowMs: DAY_MS });

    expect(span.current.length).toBe(1);
    expect(span.prior).toEqual([]);
  });

  it("keeps a message exactly on the window boundary in `current`, so no firing falls between the halves", () => {
    const span = splitAlertSpan({
      messages: [at({ id: "boundary", msAgo: DAY_MS })],
      nowMs: NOW_MS,
      priorWindows: 3,
      windowMs: DAY_MS,
    });

    expect(span.current.map((message) => message.id)).toEqual(["boundary"]);
  });

  it("carries the baseline width through, so the card can say how many windows it averaged", () => {
    expect(splitAlertSpan({ messages: [], nowMs: NOW_MS, priorWindows: 3, windowMs: DAY_MS }).priorWindows).toBe(3);
  });

  it("collects NO baseline when none was asked for", () => {
    const span = splitAlertSpan({
      messages: [at({ id: "yesterday", msAgo: 30 * 3_600_000 })],
      nowMs: NOW_MS,
      priorWindows: 0,
      windowMs: DAY_MS,
    });

    expect(span.current).toEqual([]);
    expect(span.prior).toEqual([]);
  });
});
