import { describe, expect, it } from "vitest";

import { mergeMentions } from "../../../../review/slackEvidence.js";
import type { SlackMention } from "../../../../review/slackEvidenceTypes.js";

/** A mention, with the fields a test cares about overridden. */
const mention = (over: Partial<SlackMention> = {}): SlackMention => ({
  atIso: "2026-08-28T00:00:00.000Z",
  authoredPrCount: 1,
  authoredText: "",
  firstLinkAt: -1,
  versionsDisagree: false,
  quotedPrKeys: [],
  authorId: "U1",
  authorRole: "owner",
  channel: "#c",
  conversation: "channel",
  counterpartId: "",
  excerpt: "",
  isDirectMessage: false,
  leg: "corpus",
  linkSpans: [],
  mentions: [],
  messageKey: "C1:1",
  threadKey: "C1:1",
  association: "linked",
  threadPrKeys: [],
  permalink: "p1",
  prKey: "owner/repo#16349",
  tagged: [],
  ...over,
});

describe("mergeMentions", () => {
  it("keeps one row per message, taking the corpus record and the live counterpart it alone names", () => {
    const merged = mergeMentions({
      corpus: [mention({ authorRole: "app", conversation: "direct-message", isDirectMessage: true })],
      live: [mention({ counterpartId: "U9", isDirectMessage: true, leg: "live" })],
    });
    expect(merged.length).toBe(1);
    expect(merged[0]!.counterpartId).toBe("U9");
    expect(merged[0]!.leg).toBe("corpus");
    expect(merged[0]!.authorRole).toBe("app");
  });

  it("merges on `channel:ts`, so a live permalink's `?thread_ts=` query string never splits one message", () => {
    const merged = mergeMentions({
      corpus: [mention({ permalink: "https://x.slack.com/archives/C1/p1788832836453699" })],
      live: [
        mention({
          leg: "live",
          permalink: "https://x.slack.com/archives/C1/p1788832836453699?thread_ts=1788832836.453699",
        }),
      ],
    });
    expect(merged.length).toBe(1);
    expect(merged[0]!.leg).toBe("corpus");
  });

  it("never lets an authorless pin copy replace the message copy of the same message, in either order", () => {
    const message = mention({ authorId: "U1", authorRole: "owner" });
    const pin = mention({ authorId: "", authorRole: "other-human" });
    expect(mergeMentions({ corpus: [message, pin], live: [] }).map((m) => m.authorRole)).toEqual(["owner"]);
    expect(mergeMentions({ corpus: [pin, message], live: [] }).map((m) => m.authorRole)).toEqual(["owner"]);
  });

  it("keeps the live copy's author when the only corpus copy is an authorless pin", () => {
    const merged = mergeMentions({
      corpus: [mention({ authorId: "", authorRole: "other-human" })],
      live: [mention({ authorId: "U1", authorRole: "owner", leg: "live" })],
    });
    expect(merged.map((m) => [m.authorRole, m.leg])).toEqual([["owner", "live"]]);
  });

  it("keeps the corpus copy's owner-only conversation when an authorless pin yields its author to the live copy", () => {
    const merged = mergeMentions({
      corpus: [mention({ authorId: "", authorRole: "other-human", conversation: "owner-only" })],
      live: [mention({ authorId: "U1", authorRole: "owner", conversation: "direct-message", leg: "live" })],
    });
    expect(merged.map((m) => [m.authorRole, m.conversation])).toEqual([["owner", "owner-only"]]);
  });

  it("keeps a corpus-only message the live leg never saw", () => {
    const merged = mergeMentions({
      corpus: [mention({ messageKey: "C1:old", permalink: "old" })],
      live: [mention({ messageKey: "C1:new", permalink: "new" })],
    });
    expect(merged.length).toBe(2);
  });

  it("sorts newest first", () => {
    const merged = mergeMentions({
      corpus: [mention({ atIso: "2026-08-01T00:00:00Z", messageKey: "C1:a", permalink: "a" })],
      live: [mention({ atIso: "2026-08-30T00:00:00Z", messageKey: "C1:b", permalink: "b" })],
    });
    expect(merged.map((m) => m.permalink)).toEqual(["b", "a"]);
  });
});

describe("mergeMentions — a thread copy against a linked copy of one message", () => {
  it("keeps the linked live copy, takes the corpus author and conversation, and marks the copies as disagreeing", () => {
    const live = mention({ authorRole: "other-human", authoredText: "<@U9> never mind, merged", leg: "live" });
    const corpus = mention({
      association: "thread",
      authorRole: "owner",
      authoredText: "<@U9> please review this",
      conversation: "direct-message",
      threadPrKeys: ["owner/repo#16349"],
    });
    const merged = mergeMentions({ corpus: [corpus], live: [live] });
    expect(merged.map((m) => [m.association, m.leg, m.authorRole, m.conversation, m.versionsDisagree])).toEqual([
      ["linked", "live", "owner", "direct-message", true],
    ]);
  });
});
