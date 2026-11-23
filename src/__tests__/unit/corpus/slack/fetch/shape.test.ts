/*
 * The page shapers — a `conversations.history` page into items, the thread polls it plans, and a
 * `conversations.replies` page with its parent echo dropped. It moved here when `fetch.test.ts` was split by
 * behaviour.
 */
import { describe, expect, it } from "vitest";

import { planThreadPolls, shapeHistoryPage, shapeRepliesPage } from "../../../../../corpus/slack/shape.js";

const ctx = { channelId: "C_A", channelName: "alpha", workspaceUrl: "https://acme.slack.com" };

describe("shapeHistoryPage", () => {
  it("shapes a raw message into an item with reactions, files, and a stable permalink", () => {
    const items = shapeHistoryPage({
      ctx,
      messages: [{ files: [{ id: "F1" }], reactions: [{ count: 2, name: "+1" }], ts: "1700000000.000100", user: "U1" }],
    });
    expect(items).toHaveLength(1);
    expect(items[0]!.reactions).toEqual([":+1: x2"]);
    expect(items[0]!.files.map((f) => f.id)).toEqual(["F1"]);
    expect(items[0]!.permalink).toBe("https://acme.slack.com/archives/C_A/p1700000000000100");
    expect(items[0]!.channelName).toBe("alpha");
  });

  it("drops a non-object row and a ts-less row without failing", () => {
    expect(shapeHistoryPage({ ctx, messages: [42, { text: "no ts" }] })).toEqual([]);
  });
});

describe("planThreadPolls", () => {
  it("selects only messages with a positive reply_count", () => {
    const polls = planThreadPolls({
      messages: [
        { reply_count: 3, ts: "1.1" },
        { reply_count: 0, ts: "2.2" },
        { ts: "3.3" },
        { reply_count: 1, ts: "4.4" },
      ],
    });
    expect(polls.map((p) => p.threadTs)).toEqual(["1.1", "4.4"]);
  });
});

describe("shapeRepliesPage", () => {
  it("shapes replies but skips the parent echo (same ts as the thread root)", () => {
    const replies = shapeRepliesPage({
      ctx,
      messages: [
        { text: "parent", ts: "1700000000.000100", user: "U1" },
        { text: "a reply", ts: "1700000100.000200", user: "U2" },
      ],
      threadTs: "1700000000.000100",
    });
    expect(replies).toHaveLength(1);
    expect(replies[0]!.ts).toBe("1700000100.000200");
    expect(replies[0]!.threadTs).toBe("1700000000.000100");
  });
});
