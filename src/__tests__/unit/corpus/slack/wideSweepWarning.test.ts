/**
 * The line a channel raises when its fallback sweep is large enough to be mistaken for a hang.
 *
 * The defect it answers was silence, not wrongness: a 194-thread sweep took 3m54s against a 2m18s floor and
 * printed nothing but the progress display's own `(stalled)`, which is what made a working crawl
 * indistinguishable from the frozen one `channelDeadline.ts` exists to catch.
 */
import { describe, expect, it } from "vitest";
import {
  cursorlessRootFloor,
  SLACK_WIDE_SWEEP_THREADS,
  wideSweepWarning,
} from "../../../../corpus/slack/channelPages.js";
import type { ChannelReadPlan } from "../../../../corpus/slack/reach.js";

describe("wideSweepWarning", () => {
  it("says nothing about a sweep of no threads at all", () => {
    expect(wideSweepWarning({ channelId: "C_A", threads: 0 })).toBeUndefined();
  });

  it("says nothing at the threshold itself", () => {
    expect(wideSweepWarning({ channelId: "C_A", threads: SLACK_WIDE_SWEEP_THREADS })).toBeUndefined();
  });

  it("names the channel and the exact call count one thread past it", () => {
    const line = wideSweepWarning({ channelId: "C_A", threads: SLACK_WIDE_SWEEP_THREADS + 1 });
    expect(line).toBe(
      "slack channel C_A: fallback sweep will poll 201 known thread(s) the history walk did not cover — " +
        "one conversations.replies call each, so this channel is expected to report no progress for a " +
        "while. It is working, not hung.",
    );
  });

  it("carries the real measured count rather than a rounded one", () => {
    expect(wideSweepWarning({ channelId: "C0SYN000002", threads: 3310 })).toContain("3310 known thread(s)");
  });
});

describe("cursorlessRootFloor", () => {
  const plan = ({ ingestOldest, pinnedWindow }: { ingestOldest: string; pinnedWindow: boolean }): ChannelReadPlan => ({
    ingestOldest,
    lane: "history-oracle",
    pinnedWindow,
    walkOldest: "0",
  });

  it("reads a never-seen root WHOLE when no floor is pinned", () => {
    expect(
      cursorlessRootFloor({
        plan: plan({ ingestOldest: "1700006400", pinnedWindow: false }),
        threadTs: "1600000000.000100",
      }),
    ).toBe("0");
  });

  it("reads a root at or above a pinned floor from that floor — a reply cannot predate its parent", () => {
    expect(
      cursorlessRootFloor({
        plan: plan({ ingestOldest: "1700006400", pinnedWindow: true }),
        threadTs: "1700006400.000100",
      }),
    ).toBe("1700006400");
  });

  it("defers a root BELOW a pinned floor, the one case that would widen bronze or lie in the cursor", () => {
    expect(
      cursorlessRootFloor({
        plan: plan({ ingestOldest: "1700006400", pinnedWindow: true }),
        threadTs: "1600000000.000100",
      }),
    ).toBeUndefined();
  });
});
