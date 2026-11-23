/**
 * A crawled conversation folded to the summary that outlives its items: identity and privacy flags kept
 * verbatim, messages plus replies counted, the newest instant kept as the watermark (`""` for an empty
 * conversation), and — for a flushed conversation — the banked prefix added in, whichever side is newer.
 */
import { describe, expect, it } from "vitest";

import { summariseSlackChannel, wholeChannelSummary } from "../../../../corpus/slack/channelSummary.js";
import type { SlackChannelItems, SlackMessageItem, SlackReplyItem } from "../../../../corpus/slack/project.js";

/** A top-level message at one instant. */
function message({ tsIso }: { tsIso: string }): SlackMessageItem {
  return { channelId: "C1", files: [], permalink: "https://x.slack.com/p1", reactions: [], ts: "1.0", tsIso };
}

/** A thread reply at one instant. */
function reply({ tsIso }: { tsIso: string }): SlackReplyItem {
  return { channelId: "C1", files: [], permalink: "https://x.slack.com/p2", threadTs: "1.0", ts: "2.0", tsIso };
}

/** A private, archived channel the token is a member of, holding the given items. */
function channel({
  messages,
  replies,
}: {
  messages: readonly SlackMessageItem[];
  replies: readonly SlackReplyItem[];
}): SlackChannelItems {
  return {
    channelId: "C1",
    channelName: "ops",
    isArchived: true,
    isIm: false,
    isMember: true,
    isMpim: false,
    isPrivate: true,
    messages,
    replies,
  };
}

const IDENTITY = {
  channelId: "C1",
  channelName: "ops",
  isArchived: true,
  isIm: false,
  isMember: true,
  isMpim: false,
  isPrivate: true,
};

describe("summariseSlackChannel", () => {
  it("summarises an empty conversation as zero items and a '' watermark, flags verbatim", () => {
    expect(summariseSlackChannel({ items: channel({ messages: [], replies: [] }) })).toEqual({
      ...IDENTITY,
      itemCount: 0,
      maxTsIso: "",
    });
  });

  it("counts messages and replies together and keeps the newest instant across both, whatever their order", () => {
    const items = channel({
      messages: [message({ tsIso: "2026-10-02T00:00:00.000Z" }), message({ tsIso: "2026-10-01T00:00:00.000Z" })],
      replies: [reply({ tsIso: "2026-10-03T00:00:00.000Z" }), reply({ tsIso: "2026-09-30T00:00:00.000Z" })],
    });

    expect(summariseSlackChannel({ items })).toEqual({
      ...IDENTITY,
      itemCount: 4,
      maxTsIso: "2026-10-03T00:00:00.000Z",
    });
  });
});

describe("wholeChannelSummary", () => {
  const tail = channel({
    messages: [message({ tsIso: "2026-10-01T00:00:00.000Z" })],
    replies: [reply({ tsIso: "2026-10-02T00:00:00.000Z" })],
  });

  it("adds the flushed items and keeps the flush's watermark when the flush is newer than the tail", () => {
    expect(
      wholeChannelSummary({
        flushed: { items: 7, maxTsIso: "2026-10-05T00:00:00.000Z", messages: 5 },
        items: tail,
      }),
    ).toEqual({ ...IDENTITY, itemCount: 9, maxTsIso: "2026-10-05T00:00:00.000Z" });
  });

  it("keeps the tail's watermark when the tail is newer than the flush", () => {
    expect(
      wholeChannelSummary({
        flushed: { items: 7, maxTsIso: "2026-09-01T00:00:00.000Z", messages: 5 },
        items: tail,
      }),
    ).toEqual({ ...IDENTITY, itemCount: 9, maxTsIso: "2026-10-02T00:00:00.000Z" });
  });
});
