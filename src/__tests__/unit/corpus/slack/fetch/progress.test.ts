/*
 * The Slack crawl's progress lane — the pure title, count and preview helpers, and the heartbeats and previews
 * `fetchSlackActivity` streams per channel. It moved here when `fetch.test.ts` was split by behaviour.
 */
import { describe, expect, it } from "vitest";

import type { SourceProgressEvent } from "../../../../../corpus/progress.js";
import { fetchSlackActivity } from "../../../../../corpus/slack/fetch.js";
import { slackChannelCounts, slackChannelPreview, slackChannelTitle } from "../../../../../corpus/slack/progress.js";
import { fakeApi, window } from "./harness.js";

describe("slack CRAWL progress helpers (pure)", () => {
  it("titles a channel as #name, or the raw id when unnamed", () => {
    expect(slackChannelTitle({ channel: { id: "C1", name: "dev" } })).toBe("#dev");
    expect(slackChannelTitle({ channel: { id: "C1" } })).toBe("C1");
  });

  it("counts messages and DISTINCT threads", () => {
    const items = {
      channelId: "C1",
      messages: [
        { channelId: "C1", files: [], permalink: "p", reactions: [], ts: "1", tsIso: "" },
        { channelId: "C1", files: [], permalink: "p", reactions: [], ts: "2", tsIso: "" },
      ],
      replies: [
        { channelId: "C1", files: [], permalink: "p", reactions: [], threadTs: "1", ts: "1.1", tsIso: "" },
        { channelId: "C1", files: [], permalink: "p", reactions: [], threadTs: "1", ts: "1.2", tsIso: "" },
      ],
    };
    expect(slackChannelCounts({ items })).toEqual({ messages: 2, threads: 1 });
  });

  it("builds a preview from the first message with text (id as cite), or none when empty", () => {
    const withText = slackChannelPreview({
      channel: { id: "C1", name: "dev" },
      items: {
        channelId: "C1",
        messages: [{ channelId: "C1", files: [], permalink: "p", reactions: [], text: "ship it", ts: "1", tsIso: "" }],
        replies: [],
      },
    });
    expect(withText).toEqual({
      lane: "content_preview",
      phase: "channel",
      preview: { snippet: "ship it", sourceContentId: "C1", subject: "#dev" },
      source: "slack",
    });
    const empty = slackChannelPreview({
      channel: { id: "C1", name: "dev" },
      items: { channelId: "C1", messages: [], replies: [] },
    });
    expect(empty).toBeUndefined();
  });
});

describe("fetchSlackActivity streamed progress", () => {
  it("emits a per-channel heartbeat + a redacted preview, with running message/thread metrics", async () => {
    const events: SourceProgressEvent[] = [];
    await fetchSlackActivity({ api: fakeApi({ calls: [] }), onProgress: (e) => events.push(e), window });
    const titles = events
      .filter((e) => e.lane === "heartbeat" && e.currentItem !== undefined)
      .map((e) => e.currentItem!.title);
    expect(titles).toEqual(["#alpha", "#beta"]); // one "start" heartbeat per selected channel
    const previews = events.filter((e) => e.lane === "content_preview");
    expect(previews.map((e) => e.preview!.subject)).toEqual(["#alpha"]); // C_B has no messages → no preview
    expect(previews[0]!.preview!.sourceContentId).toBe("C_A");
    const done = events.filter((e) => e.lane === "heartbeat" && e.metrics !== undefined);
    expect(done.at(-1)!.metrics).toEqual({ messages: 1, skipped: 0, threads: 1 });
  });
});
