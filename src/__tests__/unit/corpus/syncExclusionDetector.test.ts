/**
 * The detector — which `(app, channel)` pairs read as pure alert traffic.
 *
 * The case that matters most is the pair of channels with the SAME app in both: 99.8% of one and 14.1% of
 * the other, on this store. If a change ever made the threshold stop separating those two, the rule would
 * be back to the bare author ban it replaced, and every test here would still pass except that one.
 */
import { describe, expect, it } from "vitest";

import {
  type AppChannelCount,
  DETECTOR_MIN_APP_ROWS,
  DETECTOR_MIN_SHARE_PERCENT,
  proposeSyncExclusions,
} from "../../../corpus/syncExclusionDetector.js";

/** One pair's footprint, with only the numbers a case cares about spelled out. */
function pair(over: Partial<AppChannelCount> = {}): AppChannelCount {
  return {
    appId: "AAPP",
    appRows: 1000,
    channelId: "C1",
    channelName: "#alerts",
    channelRows: 1000,
    ...over,
  };
}

describe("the two thresholds", () => {
  it("proposes a pair exactly on the share threshold, so the boundary is inclusive", () => {
    const proposals = proposeSyncExclusions({ counts: [pair({ appRows: 950, channelRows: 1000 })] });
    expect(proposals.length).toBe(1);
    expect(proposals[0]!.share).toBe(95);
  });

  it("declines a pair one row below the share threshold", () => {
    const proposals = proposeSyncExclusions({ counts: [pair({ appRows: 949, channelRows: 1000 })] });
    expect(proposals).toStrictEqual([]);
  });

  it("proposes a pair exactly on the row floor", () => {
    const proposals = proposeSyncExclusions({
      counts: [pair({ appRows: DETECTOR_MIN_APP_ROWS, channelRows: DETECTOR_MIN_APP_ROWS })],
    });
    expect(proposals.length).toBe(1);
  });

  it("declines a pair one row below the floor even at 100% of its channel", () => {
    const rows = DETECTOR_MIN_APP_ROWS - 1;
    expect(proposeSyncExclusions({ counts: [pair({ appRows: rows, channelRows: rows })] })).toStrictEqual([]);
  });

  it("pins the thresholds themselves, because the whole rule is these two numbers", () => {
    expect(DETECTOR_MIN_APP_ROWS).toBe(500);
    expect(DETECTOR_MIN_SHARE_PERCENT).toBe(95);
  });
});

describe("the same app in two channels is separated by the share alone", () => {
  it("proposes the channel it dominates and declines the one where humans talk", () => {
    const proposals = proposeSyncExclusions({
      counts: [
        pair({ appRows: 1000020, channelId: "C_DD", channelName: "#monitor-feed", channelRows: 1001672 }),
        pair({ appRows: 2288, channelId: "C_AT", channelName: "#sync-alerts", channelRows: 16253 }),
      ],
    });
    expect(proposals.length).toBe(1);
    expect(proposals[0]!.channelName).toBe("#monitor-feed");
    expect(proposals[0]!.share).toBe(99.8);
  });
});

describe("what a proposal carries", () => {
  it("renders the denylist line an operator pastes, preferring the readable channel name", () => {
    expect(proposeSyncExclusions({ counts: [pair()] })[0]!.denylistLine).toBe("AAPP @ #alerts");
  });

  it("falls back to the channel id when the store has no name for the channel — a DM", () => {
    expect(proposeSyncExclusions({ counts: [pair({ channelName: null })] })[0]!.denylistLine).toBe("AAPP @ C1");
  });
});

describe("ordering and degenerate input", () => {
  it("returns the largest pair first, so the one worth reading is at the top", () => {
    const proposals = proposeSyncExclusions({
      counts: [
        pair({ appRows: 600, channelId: "C_SMALL", channelRows: 600 }),
        pair({ appRows: 9000, channelRows: 9000 }),
      ],
    });
    expect(proposals.map((one) => one.appRows)).toStrictEqual([9000, 600]);
  });

  it("breaks a tie on the ids, so two runs over the same store print the same order", () => {
    const proposals = proposeSyncExclusions({
      counts: [pair({ appId: "BBBB", channelId: "C2" }), pair({ appId: "AAAA", channelId: "C1" })],
    });
    expect(proposals.map((one) => one.appId)).toStrictEqual(["AAAA", "BBBB"]);
  });

  it("proposes nothing from no counts", () => {
    expect(proposeSyncExclusions({ counts: [] })).toStrictEqual([]);
  });

  it("skips a channel with no rows rather than dividing by zero", () => {
    expect(proposeSyncExclusions({ counts: [pair({ appRows: 0, channelRows: 0 })] })).toStrictEqual([]);
  });

  it("counts the humans in the denominator, so a busy channel cannot flatter itself into a proposal", () => {
    // The denominator is EVERY row in the channel. Counting only bot rows would make every alert channel
    // 100% alerts by construction, which is the question nobody asked.
    expect(proposeSyncExclusions({ counts: [pair({ appRows: 900, channelRows: 1000 })] })).toStrictEqual([]);
  });
});
