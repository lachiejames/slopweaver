import { describe, expect, it } from "vitest";

import { conversationToolLinesOnOpen } from "../../lib/conversationToolLines";
import { type FrontAppBandSample, messengerBand, messengerReadsOf } from "../../lib/messengerBand";

const NOW_ISO = "2026-11-09T04:00:00.000Z";
const EARLIER_ISO = "2026-11-09T03:40:00.000Z";
const SLACK_KEY = "com.tinyspeck.slackmacgap";

const slackInFront: FrontAppBandSample = {
  app: "Slack",
  appKey: SLACK_KEY,
  bundleId: SLACK_KEY,
  place: "front",
  sampledAtIso: NOW_ISO,
  title: null,
};

/** A settled `slack_open` from the conversation before, as the provider's tool lines hold it. */
const earlierThreadRead = {
  detail: "read the thread",
  knowledge: { kind: "slack-thread" as const },
  name: "slack_open",
  settledAtIso: EARLIER_ISO,
};

/** The band's second line with Slack in front, read off whatever tool lines are on screen. */
const slackSightOf = ({ lines }: { lines: readonly (typeof earlierThreadRead)[] }): string =>
  messengerBand({
    canLook: true,
    front: slackInFront,
    nowMs: Date.parse(NOW_ISO),
    openCard: undefined,
    page: { path: "/queue", title: "Queue" },
    reads: messengerReadsOf({ lines }),
  }).sight.words;

describe("conversationToolLinesOnOpen", () => {
  it("a fresh conversation keeps none of the last one's tool lines", () => {
    expect(conversationToolLinesOnOpen({ carrying: false, lines: [earlierThreadRead] })).toEqual([]);
  });

  it("a carrying open — reconnect, rollover, a typed gone re-open — keeps every line, the same array", () => {
    const lines = [earlierThreadRead];
    expect(conversationToolLinesOnOpen({ carrying: true, lines })).toBe(lines);
  });

  it("an empty conversation opens empty either way", () => {
    expect(conversationToolLinesOnOpen({ carrying: false, lines: [] })).toEqual([]);
    expect(conversationToolLinesOnOpen({ carrying: true, lines: [] })).toEqual([]);
  });

  it("the band no longer credits the last conversation's thread read in a fresh one", () => {
    // The defect, held down: without the reset the band claims the earlier conversation's read.
    expect(slackSightOf({ lines: [earlierThreadRead] })).toBe("Read the thread · not the rest of Slack");
    const opened = conversationToolLinesOnOpen({ carrying: false, lines: [earlierThreadRead] });
    expect(slackSightOf({ lines: opened })).toBe("Can look when you ask · hasn't looked");
  });

  it("a read the new conversation makes after it opens is the only one credited", () => {
    const opened = conversationToolLinesOnOpen({ carrying: false, lines: [earlierThreadRead] });
    const ownRead = { ...earlierThreadRead, settledAtIso: NOW_ISO };
    expect(messengerReadsOf({ lines: [...opened, ownRead] })).toEqual([{ atIso: NOW_ISO, kind: "slack-thread" }]);
  });
});
