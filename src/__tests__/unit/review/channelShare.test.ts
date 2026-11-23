/*
 * The third review state: posted to a channel, nobody named. One case per colour of its business-day clock, and
 * one per reason it does not apply.
 */
import { describe, expect, it } from "vitest";

import { channelShareOf, type ShareEvidence } from "../../../review/channelShare.js";
import { shareThreadOf } from "../../../review/channelShareEvidence.js";
import { findPrLinkSpans, firstLinkStart, mentionRunsIn } from "../../../review/prLink.js";
import type { SlackMention } from "../../../review/slackEvidenceTypes.js";

/** An #dev-team post made on a Sunday night in Melbourne. */
const HEADS_UP =
  "hey all, heads up that the local E2Es are about to run on every PR (customer, session and billing lanes, in parallel, about 5 min each)\n\n" +
  "not a required check yet. I want a day or two of flake and speed data from real PRs first, then I'll probably ask platform about making it required\n\n" +
  "if a lane goes red on your PR and it looks unrelated to your change, pls ping me with the link. I'd much rather hear about flakes now than once it's blocking merges\n\n" +
  "<https://github.com/acme/acme-admin/pull/17941|ci(QQQQ-178): run the advisory local E2E suite on every PR #17941>";

const POSTED = "2026-09-27T11:30:21.000Z";
const POST_KEY = "C0SYN000002:1790508621.312739";
const PERMALINK = "https://acme.slack.com/archives/C0SYN000002/p1790508621312739";

/**
 * Both absences carried through one instant: the corpus watermark there, no live hit past it, and each named thread
 * read whole there — returning, as a real read would, every one of `mentions` under it but its root.
 */
function proven({
  iso,
  threads = [POST_KEY],
  mentions = [],
}: {
  iso: string;
  threads?: readonly string[];
  mentions?: readonly SlackMention[];
}): ShareEvidence {
  const replies = mentions.map(({ atIso, authorRole, messageKey, threadKey }) => ({
    reply: { atIso, authorRole, messageKey },
    threadKey,
  }));
  return {
    corpusBehind: false,
    corpusThroughIso: iso,
    threads: Object.fromEntries(
      threads.map((key) => [
        key,
        {
          readAtIso: iso,
          replies: replies
            .filter((one) => one.threadKey === key && one.reply.messageKey !== key)
            .map((one) => one.reply),
        },
      ]),
    ),
  };
}

/** One message as the Slack legs hand it over, measured off its own text. */
function mention({
  text = HEADS_UP,
  atIso = POSTED,
  messageKey = POST_KEY,
  threadKey = POST_KEY,
  association = "linked",
  authorRole = "owner",
  conversation = "channel",
  leg = "corpus",
}: {
  text?: string;
  atIso?: string;
  messageKey?: string;
  threadKey?: string;
  association?: SlackMention["association"];
  authorRole?: SlackMention["authorRole"];
  conversation?: SlackMention["conversation"];
  leg?: SlackMention["leg"];
}): SlackMention {
  const spans = findPrLinkSpans({ text });
  return {
    association,
    atIso,
    authorId: authorRole === "other-human" ? "U0SYN000004" : "U0SYN000001",
    authorRole,
    authoredPrCount: new Set(spans.map((entry) => entry.ref.number)).size,
    authoredText: text,
    channel: conversation === "direct-message" ? "Rosa Lindqvist" : "#dev-team",
    conversation,
    counterpartId: conversation === "direct-message" ? "U0SYN000004" : "",
    excerpt: text.slice(0, 40),
    firstLinkAt: firstLinkStart({ spans }),
    isDirectMessage: conversation === "direct-message",
    leg,
    linkSpans: spans.filter((entry) => entry.ref.number === 17941).map((entry) => entry.span),
    mentions: mentionRunsIn({ text }),
    messageKey,
    permalink: `${PERMALINK}${messageKey === POST_KEY ? "" : `?reply=${messageKey}`}`,
    prKey: "acme/acme-admin#17941",
    quotedPrKeys: [],
    tagged: mentionRunsIn({ text }).map((run) => run.id),
    threadKey,
    threadPrKeys: association === "thread" ? ["acme/acme-admin#17941"] : [],
    versionsDisagree: false,
  };
}

/** A colleague's reply in the post's own thread. */
function reply({ atIso }: { atIso: string }): SlackMention {
  return mention({
    association: "thread",
    atIso,
    authorRole: "other-human",
    messageKey: `C0SYN000002:${String(Date.parse(atIso) / 1000)}.000100`,
    text: "nice, I'll keep an eye out for flakes on mine",
  });
}

/** The state for 17941 as read at one instant, with nobody reviewing and the Slack corpus caught up to it. */
function readAt({ nowIso, mentions = [mention({})] }: { nowIso: string; mentions?: readonly SlackMention[] }) {
  return channelShareOf({
    asks: [],
    evidence: proven({ iso: nowIso, mentions }),
    mentions,
    nowIso,
    reviewedOnGithub: false,
  });
}

describe("channelShareOf — the clock", () => {
  it("reads GREEN, waiting for engagement, on the Sunday night the owner posted it — the weekend never counts", () => {
    const share = readAt({ nowIso: "2026-09-27T13:42:00.000Z" })!;
    expect(share.tone).toBe("green");
    expect(share.badge).toBe("waiting for engagement");
    expect(share.why).toBe("no reply yet, 0 business days into the first business day");
    expect(share.permalink).toBe(PERMALINK);
    expect(share.channel).toBe("#dev-team");
    expect(share.replies).toBe(0);
  });

  it("stays GREEN through Monday — the first business day", () => {
    expect(readAt({ nowIso: "2026-09-28T13:00:00.000Z" })!.tone).toBe("green");
  });

  it("turns YELLOW once a business day passes with no engagement", () => {
    const share = readAt({ nowIso: "2026-09-28T16:00:00.000Z" })!;
    expect(share.tone).toBe("yellow");
    expect(share.badge).toBe("no engagement");
    expect(share.why).toBe("no reply in 1.1 business days since the post");
  });

  it("reads GREEN, in conversation, while a colleague's reply is fresh", () => {
    const share = readAt({
      mentions: [mention({}), reply({ atIso: "2026-09-28T02:00:00.000Z" })],
      nowIso: "2026-09-28T16:00:00.000Z",
    })!;
    expect(share.tone).toBe("green");
    expect(share.badge).toBe("in conversation");
    expect(share.replies).toBe(1);
    expect(share.lastReplyAtIso).toBe("2026-09-28T02:00:00.000Z");
  });

  it("turns YELLOW when the conversation stalls for a business day with nobody reviewing", () => {
    const share = readAt({
      mentions: [mention({}), reply({ atIso: "2026-09-28T02:00:00.000Z" })],
      nowIso: "2026-09-29T04:00:00.000Z",
    })!;
    expect(share.tone).toBe("yellow");
    expect(share.badge).toBe("conversation stalled");
    expect(share.why).toBe("the thread went quiet 1.1 business days ago and nobody is reviewing");
  });

  it("turns RED after three business days with no reviewer, and says to name one", () => {
    // Monday, Tuesday and Wednesday have all passed by early Thursday morning in Melbourne.
    const share = readAt({ nowIso: "2026-09-30T14:30:00.000Z" })!;
    expect(share.tone).toBe("red");
    expect(share.badge).toBe("no reviewer — name one");
    expect(share.why).toBe("3 business days since the post and nobody reviewing — name a reviewer");
  });
});

describe("channelShareOf — when it does not apply", () => {
  const NOW = "2026-09-28T13:00:00.000Z";

  it("does not apply once an ask names somebody", () => {
    const ask = mention({ text: `<@U0SYN000004> could you review this one? ${HEADS_UP}` });
    expect(
      channelShareOf({
        asks: [ask],
        mentions: [ask],
        nowIso: NOW,
        reviewedOnGithub: false,
        evidence: proven({ iso: NOW }),
      }),
    ).toBe(undefined);
  });

  it("does not apply while a human is reviewing on GitHub", () => {
    expect(
      channelShareOf({
        asks: [],
        mentions: [mention({})],
        nowIso: NOW,
        reviewedOnGithub: true,
        evidence: proven({ iso: NOW }),
      }),
    ).toBe(undefined);
  });

  it("does not apply to a direct message — a DM names its audience", () => {
    expect(readAt({ mentions: [mention({ conversation: "direct-message" })], nowIso: NOW })).toBe(undefined);
  });

  it("does not apply to the owner's link dropped as a reply into somebody else's thread", () => {
    const inTheirThread = mention({
      messageKey: "C0SYN000002:1790560800.000100",
      threadKey: "C0SYN000002:1790500000.000100",
    });
    expect(readAt({ mentions: [inTheirThread], nowIso: NOW })).toBe(undefined);
  });

  it("does not apply to a file of the owner's linking the pull request — only a message roots a thread", () => {
    const file = "C0SYN000002:1790508621.312739:file:F0FILE01";
    expect(readAt({ mentions: [mention({ messageKey: file, threadKey: file })], nowIso: NOW })).toBe(undefined);
  });

  it("does not apply to a colleague's own post of the link", () => {
    expect(readAt({ mentions: [mention({ authorRole: "other-human" })], nowIso: NOW })).toBe(undefined);
  });

  it("does not apply when no message links the pull request at all", () => {
    expect(readAt({ mentions: [], nowIso: NOW })).toBe(undefined);
  });

  it("does not apply to an app speaking as itself — any app, not only the owner's bot", () => {
    expect(readAt({ mentions: [mention({ authorRole: "app" })], nowIso: NOW })).toBe(undefined);
  });

  it("does not apply while any message is undecided, even beside an older certified non-ask", () => {
    const undecided = mention({
      atIso: "2026-09-28T01:00:00.000Z",
      messageKey: "C0SYN000002:1790557200.000100",
      text: `<@U0SYN000004> one more if you have the patience ${HEADS_UP}`,
      threadKey: "C0SYN000002:1790557200.000100",
    });
    expect(readAt({ mentions: [undecided, mention({})], nowIso: NOW })).toBe(undefined);
  });
});

describe("channelShareOf — replies and the window", () => {
  /** The share at `nowIso` over `evidence`, 17941's post the only message unless `mentions` says otherwise. */
  const over = ({
    evidence,
    nowIso,
    mentions = [mention({})],
  }: {
    evidence: ShareEvidence;
    nowIso: string;
    mentions?: readonly SlackMention[];
  }) => channelShareOf({ asks: [], evidence, mentions, nowIso, reviewedOnGithub: false })!;

  it("reads GREEN inside the first business day when the corpus was never ingested, and says only an ask may be unseen", () => {
    // The thread was read through now, so the reply set is known: only the ask absence is uncarried.
    const share = over({
      evidence: { ...proven({ iso: "2026-09-28T04:00:00.000Z" }), corpusThroughIso: undefined },
      nowIso: "2026-09-28T04:00:00.000Z",
    });
    expect([share.tone, share.asOfIso]).toEqual(["green", POSTED]);
    expect(share.why).toBe(
      "0.6 business days into the first business day; the Slack corpus was never ingested, so an ask may not be seen yet",
    );
    expect([share.asksThroughIso, share.repliesThroughIso]).toEqual([undefined, "2026-09-28T04:00:00.000Z"]);
    expect(share.seen).toBe(
      "asks unproven — the Slack corpus was never ingested, replies seen through 2026-09-28 04:00Z (the whole thread)",
    );
  });

  it("names both carriers when neither reaches past the post", () => {
    const share = over({
      evidence: { ...proven({ iso: POSTED }), corpusThroughIso: undefined },
      nowIso: "2026-09-28T04:00:00.000Z",
    });
    expect(share.why).toBe(
      "0.6 business days into the first business day; the Slack corpus was never ingested and replies are read only through 2026-09-27 11:30Z, so an ask or a reply may not be seen yet",
    );
  });

  it("reads UNKNOWN past the first business day when the corpus was never ingested — only the corpus proves no ask", () => {
    const share = over({
      evidence: { ...proven({ iso: "2026-09-30T14:30:00.000Z" }), corpusThroughIso: undefined },
      nowIso: "2026-09-30T14:30:00.000Z",
    });
    expect([share.tone, share.badge, share.permalink]).toEqual(["unknown", "clock not known", PERMALINK]);
    expect(share.why).toBe(
      "3 business days since the post, and the Slack corpus was never ingested, so an ask since may not be seen — sync Slack",
    );
  });

  it("reads UNKNOWN when a live hit proves the corpus behind, however fresh its watermark reads", () => {
    const share = over({
      evidence: { ...proven({ iso: "2026-09-30T14:30:00.000Z" }), corpusBehind: true },
      nowIso: "2026-09-30T14:30:00.000Z",
    });
    expect(share.why).toBe(
      "3 business days since the post, and live Slack holds a message newer than the corpus, so an ask since may not be seen — sync Slack",
    );
  });

  it("reads the clock AS OF the corpus watermark when it stops short of the thread reads", () => {
    const share = over({
      evidence: { ...proven({ iso: "2026-09-29T02:00:00.000Z" }), corpusThroughIso: "2026-09-28T16:00:00.000Z" },
      nowIso: "2026-09-29T02:00:00.000Z",
    });
    expect([share.tone, share.asOfIso]).toEqual(["yellow", "2026-09-28T16:00:00.000Z"]);
    expect(share.why).toBe("no reply in 1.1 business days since the post, asks seen through 2026-09-28 16:00Z");
  });

  it("names the corpus alone when only it falls a business day behind — the thread read still vouches for replies", () => {
    const share = over({
      evidence: { ...proven({ iso: "2026-09-30T14:30:00.000Z" }), corpusThroughIso: "2026-09-28T02:00:00.000Z" },
      nowIso: "2026-09-30T14:30:00.000Z",
    });
    expect(share.why).toBe(
      "3 business days since the post, and asks are read only through 2026-09-28 02:00Z, so an ask since may not be seen — sync Slack",
    );
  });

  it("carries no ask absence past a reply of the owner's the thread read saw and no leg classified — it may name somebody", () => {
    // "@Alice can you review this?" under the owner's own post, linking nothing, after a corpus half an hour behind.
    const evidence = ({ replies }: { replies: ShareEvidence["threads"][string]["replies"] }): ShareEvidence => ({
      corpusBehind: false,
      corpusThroughIso: "2026-09-30T14:00:00.000Z",
      threads: { [POST_KEY]: { readAtIso: "2026-09-30T14:30:00.000Z", replies } },
    });
    const own = { atIso: "2026-09-30T14:10:00.000Z", authorRole: "owner" as const, messageKey: "C0SYN000002:2.000100" };
    const unclassified = over({ evidence: evidence({ replies: [own] }), nowIso: "2026-09-30T14:30:00.000Z" });
    expect([unclassified.tone, unclassified.asksThroughIso]).toEqual(["unknown", undefined]);
    expect(unclassified.why).toBe(
      "3 business days since the post, and the owner's reply at 2026-09-30 14:10Z under the post in #dev-team is not classified yet, so an ask since may not be seen — sync Slack",
    );
    const classified = over({
      evidence: evidence({ replies: [own] }),
      mentions: [
        mention({}),
        mention({ association: "thread", atIso: own.atIso, messageKey: own.messageKey, text: "fyi" }),
      ],
      nowIso: "2026-09-30T14:30:00.000Z",
    });
    expect(classified.tone).toBe("red");
  });

  describe("an edit keeps the key, so a version edited past the watermark is unclassified", () => {
    const own = { atIso: "2026-09-29T12:00:00.000Z", authorRole: "owner" as const, messageKey: "C0SYN000002:2.000100" };
    const classified = [
      mention({}),
      mention({ association: "thread", atIso: own.atIso, messageKey: own.messageKey, text: "fyi" }),
    ];
    const at = ({ thread }: { thread: Partial<ShareEvidence["threads"][string]> }) =>
      over({
        evidence: {
          corpusBehind: false,
          corpusThroughIso: "2026-09-30T14:00:00.000Z",
          threads: { [POST_KEY]: { readAtIso: "2026-09-30T14:30:00.000Z", replies: [own], ...thread } },
        },
        mentions: classified,
        nowIso: "2026-09-30T14:30:00.000Z",
      });

    it("withdraws the ask absence over the owner's reply edited after the watermark, and keeps it over one edited before", () => {
      const after = at({ thread: { replies: [{ ...own, editedAtIso: "2026-09-30T14:10:00.000Z" }] } });
      const before = at({ thread: { replies: [{ ...own, editedAtIso: "2026-09-30T13:00:00.000Z" }] } });
      expect([after.tone, before.tone]).toEqual(["unknown", "red"]);
      expect(after.why).toBe(
        "3 business days since the post, and the owner's reply at 2026-09-29 12:00Z under the post in #dev-team was edited past the corpus watermark, so an ask since may not be seen — sync Slack",
      );
    });

    it("withdraws it over the owner's post itself edited after the watermark — it may now name somebody", () => {
      const share = at({ thread: { rootEditedAtIso: "2026-09-30T14:10:00.000Z" } });
      expect([share.tone, share.asksThroughIso]).toEqual(["unknown", undefined]);
      expect(share.seen).toBe(
        "asks unproven — the owner's post in #dev-team was edited past the corpus watermark, replies seen through 2026-09-30 14:30Z (the whole thread)",
      );
    });
  });

  it("withdraws the ask absence over the owner's as-me bot's reply a live hit classified as a colleague's", () => {
    // Live search cannot see the owner's bot, so its reply arrives as `other-human` and the veto reads it a non-ask;
    // the whole-thread read resolves the same key to the owner.
    const own = { atIso: "2026-09-30T14:10:00.000Z", authorRole: "owner" as const, messageKey: "C0SYN000002:2.000100" };
    const asColleague = {
      ...mention({
        association: "thread",
        atIso: own.atIso,
        authorRole: "other-human",
        leg: "live",
        messageKey: own.messageKey,
      }),
      authoredText: "<@U0SYN000004> can you review? https://github.com/acme/acme-admin/pull/17941",
    };
    const share = over({
      evidence: {
        corpusBehind: false,
        corpusThroughIso: "2026-09-30T14:00:00.000Z",
        threads: { [POST_KEY]: { readAtIso: "2026-09-30T14:30:00.000Z", replies: [own] } },
      },
      mentions: [mention({}), asColleague],
      nowIso: "2026-09-30T14:30:00.000Z",
    });
    expect([share.tone, share.asksThroughIso]).toEqual(["unknown", undefined]);
  });

  it("holds red over a URL-less ask the owner sent through their as-me bot, read raw off the thread", () => {
    // The owner's bot's reply carries a `bot_id`: projected through the declared identity it is the owner's, and unclassified.
    const identity = {
      ownerBot: { appIds: [], botIds: ["B0ASME"], botUserIds: [], ownerSlackUserId: "U0SYN000001" },
      ownerSlackUserId: "U0SYN000001",
      selfUserIds: [],
    };
    const thread = shareThreadOf({
      identity,
      rawMessages: [
        { ts: "1790508621.312739", user: "U0SYN000001" },
        { bot_id: "B0ASME", text: "<@U0SYN000004> can you review this?", ts: "1790777400.000100" },
      ],
      readAtIso: "2026-09-30T14:30:00.000Z",
      root: { channelId: "C0SYN000002", rootTs: "1790508621.312739", threadKey: POST_KEY },
    })!;
    const evidence: ShareEvidence = {
      corpusBehind: false,
      corpusThroughIso: "2026-09-30T14:00:00.000Z",
      threads: { [POST_KEY]: thread },
    };
    const share = over({ evidence, nowIso: "2026-09-30T14:30:00.000Z" });
    expect([share.tone, share.asksThroughIso]).toEqual(["unknown", undefined]);
  });

  it("reads a date-only watermark as the instant it names, never as a string shorter than every read", () => {
    const share = over({
      evidence: { ...proven({ iso: "2026-09-29T02:00:00.000Z" }), corpusThroughIso: "2026-09-29" },
      nowIso: "2026-09-29T02:00:00.000Z",
    });
    expect(share.asOfIso).toBe("2026-09-29T00:00:00.000Z");
  });

  it("reads UNKNOWN when the watermark is not an instant", () => {
    const share = over({
      evidence: { ...proven({ iso: "2026-09-30T14:30:00.000Z" }), corpusThroughIso: "yesterday" },
      nowIso: "2026-09-30T14:30:00.000Z",
    });
    expect(share.tone).toBe("unknown");
  });

  it("reads UNKNOWN when the thread under the post was not read — a reply need not link anything", () => {
    const share = over({
      evidence: proven({ iso: "2026-09-30T14:30:00.000Z", threads: [] }),
      nowIso: "2026-09-30T14:30:00.000Z",
    });
    expect(share.why).toBe(
      "3 business days since the post, and the thread under the post in #dev-team was not read, so a reply since may not be seen — sync Slack",
    );
  });

  it("reads the clock AS OF the reads when they were taken short of now, and says where they stop", () => {
    const share = over({ evidence: proven({ iso: "2026-09-28T16:00:00.000Z" }), nowIso: "2026-09-29T02:00:00.000Z" });
    expect([share.tone, share.asOfIso]).toEqual(["yellow", "2026-09-28T16:00:00.000Z"]);
    expect(share.why).toBe(
      "no reply in 1.1 business days since the post, asks and replies seen through 2026-09-28 16:00Z",
    );
  });

  it("reads UNKNOWN past the first business day on reads a business day behind", () => {
    const share = over({ evidence: proven({ iso: "2026-09-28T02:00:00.000Z" }), nowIso: "2026-09-30T14:30:00.000Z" });
    expect(share.why).toBe(
      "3 business days since the post, and asks and replies are read only through 2026-09-28 02:00Z, so an ask or a reply since may not be seen — sync Slack",
    );
  });

  it("counts a colleague's reply that links nothing, seen only by the thread read, as engagement", () => {
    const evidence: ShareEvidence = {
      ...proven({ iso: "2026-09-28T04:00:00.000Z" }),
      threads: {
        [POST_KEY]: {
          readAtIso: "2026-09-28T04:00:00.000Z",
          replies: [
            {
              atIso: "2026-09-28T02:00:00.000Z",
              authorRole: "other-human",
              messageKey: "C0SYN000002:1790560800.000100",
            },
            { atIso: "2026-09-28T03:00:00.000Z", authorRole: "app", messageKey: "C0SYN000002:1790564400.000100" },
          ],
        },
      },
    };
    const share = over({ evidence, nowIso: "2026-09-28T04:00:00.000Z" });
    expect([share.badge, share.replies, share.lastReplyAtIso]).toEqual([
      "in conversation",
      1,
      "2026-09-28T02:00:00.000Z",
    ]);
  });

  it("counts a colleague answering an older cross-post as engagement, and runs the clock from the newest post", () => {
    const repost = mention({
      atIso: "2026-09-28T00:00:00.000Z",
      messageKey: "C0SYN000002:1790553600.000000",
      threadKey: "C0SYN000002:1790553600.000000",
    });
    const mentions = [repost, mention({}), reply({ atIso: "2026-09-28T02:00:00.000Z" })];
    const share = channelShareOf({
      asks: [],
      evidence: proven({
        iso: "2026-09-28T04:00:00.000Z",
        mentions,
        threads: [POST_KEY, "C0SYN000002:1790553600.000000"],
      }),
      mentions,
      nowIso: "2026-09-28T04:00:00.000Z",
      reviewedOnGithub: false,
    })!;
    expect([share.badge, share.replies, share.postedAtIso]).toEqual(["in conversation", 1, "2026-09-28T00:00:00.000Z"]);
  });

  it("counts a reply both legs returned once, under a thread that was not read", () => {
    const one = reply({ atIso: "2026-09-28T02:00:00.000Z" });
    const share = over({
      evidence: proven({ iso: "2026-09-28T02:30:00.000Z", threads: [] }),
      mentions: [mention({}), one, { ...one, leg: "live" }],
      nowIso: "2026-09-28T02:30:00.000Z",
    });
    expect([share.replies, share.lastReplyAtIso]).toEqual([1, "2026-09-28T02:00:00.000Z"]);
  });

  /** The corpus at an early hour, the thread read at `nowIso` holding one colleague's reply an hour later — past the corpus. */
  const replyPastCorpus = ({ day }: { day: string }): ShareEvidence => ({
    corpusBehind: false,
    corpusThroughIso: `${day}T02:00:00.000Z`,
    threads: {
      [POST_KEY]: {
        readAtIso: `${day}T04:00:00.000Z`,
        replies: [{ atIso: `${day}T03:00:00.000Z`, authorRole: "other-human", messageKey: "C0SYN000002:1.000100" }],
      },
    },
  });

  it("counts a reply the thread read found past the corpus horizon — engagement is positive evidence", () => {
    const share = over({ evidence: replyPastCorpus({ day: "2026-09-29" }), nowIso: "2026-09-29T04:00:00.000Z" });
    expect([share.tone, share.badge, share.asOfIso, share.lastReplyAtIso]).toEqual([
      "green",
      "in conversation",
      "2026-09-29T02:00:00.000Z",
      "2026-09-29T03:00:00.000Z",
    ]);
    // The reply's quiet is measured to the thread read, and the line names the corpus as the horizon that stops short.
    expect(share.why).toBe("the newest reply was 0 business days ago, asks seen through 2026-09-29 02:00Z");
    expect(share.seen).toBe(
      "asks seen through 2026-09-29 02:00Z (the Slack corpus), replies seen through 2026-09-29 04:00Z (the whole thread)",
    );
  });

  it("still reads RED past the threshold beside a fresh reply — a thread conversation is not a reviewer", () => {
    const share = over({ evidence: replyPastCorpus({ day: "2026-10-01" }), nowIso: "2026-10-01T04:00:00.000Z" });
    expect([share.tone, share.replies]).toEqual(["red", 1]);
  });

  it("takes a read thread's own word on who wrote a reply — a live hit cannot see an app's bot profile", () => {
    // An app replying with the link: live search places it as a colleague, the whole-thread read sees its bot_id.
    const app = { ...reply({ atIso: "2026-09-28T02:00:00.000Z" }), leg: "live" as const };
    const evidence = proven({ iso: "2026-09-28T04:00:00.000Z", mentions: [{ ...app, authorRole: "app" }] });
    const share = over({ evidence, mentions: [mention({}), app], nowIso: "2026-09-28T04:00:00.000Z" });
    expect([share.badge, share.replies, share.lastReplyAtIso]).toEqual(["waiting for engagement", 0, undefined]);
  });

  it("ignores a reply in another thread", () => {
    const elsewhere = { ...reply({ atIso: "2026-09-28T02:00:00.000Z" }), threadKey: "C0SYN000002:1790000000.000100" };
    const share = readAt({ mentions: [mention({}), elsewhere], nowIso: "2026-09-28T16:00:00.000Z" })!;
    expect(share.replies).toBe(0);
    expect(share.tone).toBe("yellow");
  });

  it("carries the red threshold it was read against", () => {
    expect(readAt({ nowIso: NOW_MONDAY })!.redAfterBusinessDays).toBe(3);
  });
});

const NOW_MONDAY = "2026-09-28T13:00:00.000Z";
