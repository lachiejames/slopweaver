import { describe, expect, it } from "vitest";

import { CARD_LINE_CAP } from "../../../../live/turn/answer.js";
import { justInTimeCardLines } from "../../../../live/turn/freshnessCard.js";
import type { JustInTimeVerdict, JustInTimeWait } from "../../../../retrieval/justInTime.js";

const NOW = "2026-09-05T12:00:00.000Z";

/** A wait verdict on slack, defaulted to eighteen hours behind and nothing already running. */
function waiting(over: Partial<JustInTimeWait> = {}): JustInTimeWait {
  return {
    alreadyRunning: [],
    because: 'the question carries a recency marker ("today"), and this question reads slack',
    decision: "wait",
    estimate: { seconds: 1054, unbounded: false, words: "about 18 min" },
    waitOn: [{ behindMinutes: 1080, cursorIso: "2026-09-04T18:00:00.000Z", source: "slack" }],
    ...over,
  };
}

describe("justInTimeCardLines", () => {
  it("says nothing at all when the gate answers now", () => {
    const verdict: JustInTimeVerdict = { because: "everything is current", decision: "answer-now" };
    expect(justInTimeCardLines({ nowIso: NOW, verdict })).toEqual([]);
  });

  it("names the source, how far behind it is, and the estimated wait", () => {
    const lines = justInTimeCardLines({ nowIso: NOW, verdict: waiting() });
    expect(lines[0]).toBe(
      "this question needs slack (18h behind) up to date — refreshing before I answer, about 18 min",
    );
  });

  it("always carries the gate's own hole as its second line", () => {
    const lines = justInTimeCardLines({ nowIso: NOW, verdict: waiting() });
    expect(lines[1]).toBe(
      "only sources this question reads were refreshed — one that is behind and contributed nothing is invisible here",
    );
  });

  it("says a refresh is already running rather than announcing a second one", () => {
    const lines = justInTimeCardLines({
      nowIso: NOW,
      verdict: waiting({
        alreadyRunning: [{ pid: 4242, source: "slack", startedAtIso: "2026-09-05T11:56:00.000Z" }],
      }),
    });
    expect(lines[0]).toBe(
      "this question needs slack (18h behind) up to date — slack already refreshing (started 4m ago), about 18 min",
    );
  });

  it("drops the started clause when the holder's start will not parse", () => {
    const lines = justInTimeCardLines({
      nowIso: NOW,
      verdict: waiting({ alreadyRunning: [{ pid: 7, source: "slack", startedAtIso: "not-a-time" }] }),
    });
    expect(lines[0]).toBe("this question needs slack (18h behind) up to date — slack already refreshing, about 18 min");
  });

  it("counts a sub-hour lag in minutes", () => {
    const lines = justInTimeCardLines({
      nowIso: NOW,
      verdict: waiting({
        estimate: { seconds: 57, unbounded: false, words: "under a minute" },
        waitOn: [{ behindMinutes: 41, cursorIso: "2026-09-05T11:19:00.000Z", source: "github" }],
      }),
    });
    expect(lines[0]).toBe(
      "this question needs github (41m behind) up to date — refreshing before I answer, under a minute",
    );
  });

  it("keeps every line inside the card's own width, however many sources are waited on", () => {
    const lines = justInTimeCardLines({
      nowIso: NOW,
      verdict: waiting({
        estimate: { seconds: 3820, unbounded: true, words: "at least 64 min" },
        waitOn: [
          { behindMinutes: 1080, cursorIso: "2026-09-04T18:00:00.000Z", source: "slack" },
          { behindMinutes: 2880, cursorIso: "2026-09-03T12:00:00.000Z", source: "notion" },
          { behindMinutes: 300, cursorIso: "2026-09-05T07:00:00.000Z", source: "linear" },
        ],
      }),
    });
    expect(lines).toHaveLength(2);
    expect(lines.every((line) => line.length <= CARD_LINE_CAP)).toBe(true);
  });
});
