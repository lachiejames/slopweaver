import { describe, expect, it } from "vitest";

import {
  inheritedPairs,
  isReplySourceId,
  liveThreadKey,
  rootPrKeysByThread,
  sameConversation,
  threadKeyOfSourceId,
} from "../../../review/reviewConversation.js";

describe("threadKeyOfSourceId and isReplySourceId", () => {
  it("roots a top-level message at itself and a reply at its thread's root", () => {
    expect([
      threadKeyOfSourceId({ sourceId: "C1:1.0" }),
      threadKeyOfSourceId({ sourceId: "C1:1.0:reply:2.0" }),
    ]).toEqual(["C1:1.0", "C1:1.0"]);
    expect([isReplySourceId({ sourceId: "C1:1.0" }), isReplySourceId({ sourceId: "C1:1.0:reply:2.0" })]).toEqual([
      false,
      true,
    ]);
  });

  it("threads a pin or a file with nothing, answering its whole id", () => {
    expect([threadKeyOfSourceId({ sourceId: "C1:pin:1.0" }), threadKeyOfSourceId({ sourceId: "C1:file:F1" })]).toEqual([
      "C1:pin:1.0",
      "C1:file:F1",
    ]);
    expect(isReplySourceId({ sourceId: "C1:pin:1.0" })).toBe(false);
  });
});

describe("liveThreadKey", () => {
  it("reads a reply's root off the permalink's thread_ts, and a root off its own ts", () => {
    const reply = liveThreadKey({
      channelId: "C1",
      permalink: "https://x.slack.com/archives/C1/p2?thread_ts=1.0&cid=C1",
      ts: "2.0",
    });
    const root = liveThreadKey({ channelId: "C1", permalink: "https://x.slack.com/archives/C1/p1", ts: "1.0" });
    expect([reply, root]).toEqual(["C1:1.0", "C1:1.0"]);
  });
});

describe("rootPrKeysByThread", () => {
  it("takes a thread's subject from its root alone, unioning copies, and ignores replies and pins", () => {
    const keys = rootPrKeysByThread({
      members: [
        { byOwner: true, linkedPrKeys: ["o/r#1"], messageKey: "C1:1.0", sourceId: "C1:1.0", threadKey: "C1:1.0" },
        { byOwner: true, linkedPrKeys: ["o/r#2"], messageKey: "C1:1.0", sourceId: "C1:1.0", threadKey: "C1:1.0" },
        {
          byOwner: true,
          linkedPrKeys: ["o/r#3"],
          messageKey: "C1:2.0",
          sourceId: "C1:1.0:reply:2.0",
          threadKey: "C1:1.0",
        },
        {
          byOwner: true,
          linkedPrKeys: ["o/r#4"],
          messageKey: "C1:5.0",
          sourceId: "C1:pin:5.0",
          threadKey: "C1:pin:5.0",
        },
      ],
    });
    expect([...keys]).toEqual([["C1:1.0", ["o/r#1", "o/r#2"]]]);
  });
});

describe("inheritedPairs", () => {
  const linkedThreads = new Map([["o/r#1", new Set(["C1:1.0"])]]);

  it("joins a linkless reply to the pull request its thread links", () => {
    const reply = {
      byOwner: true,
      linkedPrKeys: [],
      messageKey: "C1:2.0",
      sourceId: "C1:1.0:reply:2.0",
      threadKey: "C1:1.0",
    };
    expect(inheritedPairs({ copies: [reply], linkedThreads, members: [reply] })).toEqual([
      { member: reply, prKey: "o/r#1" },
    ]);
  });

  it("never joins a root, a reply linking another pull request, or a reply in another thread", () => {
    const members = [
      { byOwner: true, linkedPrKeys: [], messageKey: "C1:1.0", sourceId: "C1:1.0", threadKey: "C1:1.0" },
      {
        byOwner: true,
        linkedPrKeys: ["o/r#2"],
        messageKey: "C1:2.0",
        sourceId: "C1:1.0:reply:2.0",
        threadKey: "C1:1.0",
      },
      { byOwner: true, linkedPrKeys: [], messageKey: "C1:9.5", sourceId: "C1:9.0:reply:9.5", threadKey: "C1:9.0" },
    ];
    expect(inheritedPairs({ copies: members, linkedThreads, members })).toEqual([]);
  });
});

describe("sameConversation", () => {
  const ask = { isDirectMessage: false, messageKey: "C1:1.0", threadKey: "C1:1.0" };

  it("admits the ask's own thread and refuses another thread of the same channel", () => {
    expect([
      sameConversation({ ask, message: { isDirectMessage: false, messageKey: "C1:2.0", threadKey: "C1:1.0" } }),
      sameConversation({ ask, message: { isDirectMessage: false, messageKey: "C1:3.0", threadKey: "C1:3.0" } }),
    ]).toEqual([true, false]);
  });

  it("admits any message in the same direct message, threaded or not, and nothing from another", () => {
    const dmAsk = { isDirectMessage: true, messageKey: "D1:1.0", threadKey: "D1:1.0" };
    expect([
      sameConversation({ ask: dmAsk, message: { isDirectMessage: true, messageKey: "D1:4.0", threadKey: "D1:4.0" } }),
      sameConversation({ ask: dmAsk, message: { isDirectMessage: true, messageKey: "D2:4.0", threadKey: "D2:4.0" } }),
    ]).toEqual([true, false]);
  });
});

describe("inheritedPairs — copies of one reply", () => {
  it("never inherits onto a reply any copy of which reaches a pull request", () => {
    const linkedThreads = new Map([["o/r#1", new Set(["C1:1.0"])]]);
    const members = [
      {
        byOwner: true,
        linkedPrKeys: ["o/r#2"],
        messageKey: "C1:2.0",
        sourceId: "C1:1.0:reply:2.0",
        threadKey: "C1:1.0",
      },
      { byOwner: true, linkedPrKeys: [], messageKey: "C1:2.0", sourceId: "C1:1.0:reply:2.0", threadKey: "C1:1.0" },
    ];
    expect(inheritedPairs({ copies: members, linkedThreads, members })).toEqual([]);
  });
});

describe("inheritedPairs — a reply also sent to the channel", () => {
  it("matches its two stored copies by message key, so a linking top-level copy withholds inheritance", () => {
    const linkedThreads = new Map([["o/r#1", new Set(["C1:1.0"])]]);
    const members = [
      { byOwner: true, linkedPrKeys: ["o/r#2"], messageKey: "C1:2.0", sourceId: "C1:2.0", threadKey: "C1:2.0" },
      { byOwner: true, linkedPrKeys: [], messageKey: "C1:2.0", sourceId: "C1:1.0:reply:2.0", threadKey: "C1:1.0" },
    ];
    expect(inheritedPairs({ copies: members, linkedThreads, members })).toEqual([]);
  });
});

describe("inheritedPairs — a copy an edit superseded", () => {
  it("still withholds inheritance, because what a message reaches is not a property of its newest copy", () => {
    const linkedThreads = new Map([["o/r#1", new Set(["C1:1.0"])]]);
    const current = {
      byOwner: true,
      linkedPrKeys: [],
      messageKey: "C1:2.0",
      sourceId: "C1:1.0:reply:2.0",
      threadKey: "C1:1.0",
    };
    const superseded = {
      byOwner: true,
      linkedPrKeys: ["o/r#2"],
      messageKey: "C1:2.0",
      sourceId: "C1:1.0:reply:2.0",
      threadKey: "C1:1.0",
    };
    expect(inheritedPairs({ copies: [current, superseded], linkedThreads, members: [current] })).toEqual([]);
  });
});

describe("rootPrKeysByThread — somebody else's root", () => {
  it("lends nothing to a reply, because under their announcement the owner is a participant rather than an asker", () => {
    const keys = rootPrKeysByThread({
      members: [
        { byOwner: false, linkedPrKeys: ["o/r#1"], messageKey: "C1:1.0", sourceId: "C1:1.0", threadKey: "C1:1.0" },
      ],
    });
    expect([...keys]).toEqual([]);
  });
});
