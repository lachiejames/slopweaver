import { describe, expect, it } from "vitest";

import { rankAll } from "../../../sessionStart/rank.js";
import type { SlackMention, SlackThread } from "../../../sessionStart/slackLeg.js";
import {
  AGE_DAYS_CAP,
  addressesOwner,
  directnessOf,
  mentionDirectnessOf,
  mentionedPullRequests,
  mentionRoomOf,
  roomOf,
  slackBackground,
  slackDoneWhen,
  slackEvidence,
  slackItem,
  slackLeg,
  slackMentionBackground,
  slackMentionDoneWhen,
  slackMentionEvidence,
  slackMentionItem,
  slackMentionLeg,
  slackMentionReadings,
  slackMentionRuleZero,
  slackOwedThreads,
  slackReadings,
  slackRuleZero,
} from "../../../sessionStart/slackLeg.js";

const NOW = "2026-08-31T00:00:00.000Z";

// `channelName` is spelled with an explicit `undefined` so a case can CLEAR it, which
// `exactOptionalPropertyTypes` forbids through a plain `Partial`.
type ThreadOverride = Partial<Omit<SlackThread, "channelName">> & { channelName?: string | undefined };

const thread = (over: ThreadOverride = {}): SlackThread => {
  const { channelName, ...rest } = over;
  const room = "channelName" in over ? channelName : "#a-channel";
  return {
    channelId: "channel-one",
    lastAuthorIsHuman: true,
    lastAuthorIsSelf: false,
    lastAuthorName: "A Colleague",
    lastIso: "2026-08-30T00:00:00.000Z",
    lastNamesAnybody: false,
    lastText: "ticked",
    mentionsOwner: false,
    ownerLastIso: "2026-08-29T00:00:00.000Z",
    ownerLatestTagsLastAuthor: false,
    ownerStartedThread: false,
    permalink: "https://example.slack.com/archives/channel-one/p1787708973446169",
    threadTs: "1787705115.489199",
    ...rest,
    ...(room === undefined ? {} : { channelName: room }),
  };
};

describe("addressesOwner", () => {
  it("reads a mention as addressing the owner", () => {
    expect(addressesOwner({ thread: thread({ mentionsOwner: true }) })).toBe(true);
  });

  it("reads a direct message as addressing the owner with no mention token", () => {
    expect(addressesOwner({ thread: thread({ channelId: "Dm-one", channelName: undefined }) })).toBe(true);
  });

  it("reads a channel message with no mention as addressing nobody in particular", () => {
    expect(addressesOwner({ thread: thread() })).toBe(false);
  });
});

describe("directnessOf", () => {
  it("reads a direct message that asks something as asked", () => {
    const dm = thread({ channelId: "Dm-one", channelName: undefined, lastText: "can you take a look?" });
    expect(directnessOf({ thread: dm })).toBe("asked");
  });

  it("reads a mention that asks something as asked", () => {
    expect(directnessOf({ thread: thread({ lastText: "any chance you can look?", mentionsOwner: true }) })).toBe(
      "asked",
    );
  });

  it("reads a direct message that closes a conversation as addressed, never as asked", () => {
    const dm = thread({ channelId: "Dm-one", channelName: undefined, lastText: "Thanks!" });
    expect(directnessOf({ thread: dm })).toBe("addressed");
  });

  it("reads a question in a channel that never named the owner as ambient, because it was somebody else's ask", () => {
    expect(directnessOf({ thread: thread({ lastText: "@A Colleague are you able to tick this one?" }) })).toBe(
      "ambient",
    );
  });

  it("reads a question naming nobody under the owner's own post as asked — the thread that sat 38 hours", () => {
    const underOwnerPost = thread({
      lastText: "As in, what are you trying to achieve there?",
      ownerStartedThread: true,
    });
    expect(directnessOf({ thread: underOwnerPost })).toBe("asked");
  });

  it("reads a question under the owner's own post that tags a colleague as ambient, because it is that colleague's ask", () => {
    const tagged = thread({
      lastNamesAnybody: true,
      lastText: "@A Colleague are you able to tick this one?",
      ownerStartedThread: true,
    });
    expect(directnessOf({ thread: tagged })).toBe("ambient");
  });

  it("reads a question naming nobody from the person the owner's latest word tagged as asked — the sign-off case", () => {
    const answersOwnerTag = thread({
      lastText: "Is it fixed cost or variable cost? $300/month sounds like a good win I'm happy to approve that",
      ownerLatestTagsLastAuthor: true,
    });
    expect(directnessOf({ thread: answersOwnerTag })).toBe("asked");
  });

  it("reads a question from the person the owner tagged that tags somebody else as ambient, because it is theirs", () => {
    const passedOn = thread({
      lastNamesAnybody: true,
      lastText: "@Another Colleague can you confirm the cost?",
      ownerLatestTagsLastAuthor: true,
    });
    expect(directnessOf({ thread: passedOn })).toBe("ambient");
  });

  it("reads a reply from the person the owner tagged that asks nothing as ambient, never addressed", () => {
    expect(directnessOf({ thread: thread({ lastText: "approved", ownerLatestTagsLastAuthor: true }) })).toBe("ambient");
  });

  it("reads a question naming nobody in somebody else's thread as ambient", () => {
    expect(directnessOf({ thread: thread({ lastText: "what are you trying to achieve there?" }) })).toBe("ambient");
  });

  it("reads a reply under the owner's own post that asks nothing as ambient, never addressed", () => {
    expect(directnessOf({ thread: thread({ lastText: ":approved:", ownerStartedThread: true }) })).toBe("ambient");
  });

  it("reads a bare acknowledgement as ambient", () => {
    expect(directnessOf({ thread: thread({ lastText: "cheers!" }) })).toBe("ambient");
  });

  it("reads an empty last message as ambient", () => {
    expect(directnessOf({ thread: thread({ lastText: "" }) })).toBe("ambient");
  });
});

describe("roomOf", () => {
  it("names the channel when the record carried one", () => {
    expect(roomOf({ thread: thread() })).toBe("#a-channel");
  });

  it("says what a direct message is rather than printing its id", () => {
    expect(roomOf({ thread: thread({ channelId: "Dm-one", channelName: undefined }) })).toBe("a direct message");
  });

  it("falls back to the channel id when no name was captured", () => {
    expect(roomOf({ thread: thread({ channelName: undefined }) })).toBe("channel-one");
  });
});

describe("slackReadings", () => {
  it("gives a thread that asked the owner something the stoppedOnOwner cap", () => {
    const asked = thread({ lastText: "can you take a look?", mentionsOwner: true });
    expect(slackReadings({ nowIso: NOW, thread: asked })).toStrictEqual({
      age: 1,
      directness: 3,
      distanceToDone: 3,
      drift: 0,
      explicitPriority: 0,
      stoppedOnOwner: 5,
    });
  });

  it("never claims somebody is stopped on the owner over a direct message that only says thanks", () => {
    const closer = thread({ channelId: "Dm-one", channelName: undefined, lastText: "Thanks!" });
    const readings = slackReadings({ nowIso: NOW, thread: closer });
    expect(readings.directness).toBe(3);
    expect(readings.stoppedOnOwner).toBe(0);
  });

  it("gives an ambient thread nothing but age and distance to done", () => {
    expect(slackReadings({ nowIso: NOW, thread: thread() })).toStrictEqual({
      age: 1,
      directness: 0,
      distanceToDone: 3,
      drift: 0,
      explicitPriority: 0,
      stoppedOnOwner: 0,
    });
  });

  it("reads a question that never named the owner as ambient rather than as an ask on the owner", () => {
    const overheard = slackReadings({ nowIso: NOW, thread: thread({ lastText: "who owns this?" }) });
    expect(overheard.stoppedOnOwner).toBe(0);
    expect(overheard.directness).toBe(0);
  });

  it("caps age however long the thread has been sitting", () => {
    const old = slackReadings({ nowIso: NOW, thread: thread({ lastIso: "2026-01-01T00:00:00.000Z" }) });
    expect(old.age).toBe(AGE_DAYS_CAP);
  });

  it("reads age as zero when the timestamp is unparseable", () => {
    expect(slackReadings({ nowIso: NOW, thread: thread({ lastIso: "not a date" }) }).age).toBe(0);
  });

  it("never reads a future message as negative age", () => {
    expect(slackReadings({ nowIso: NOW, thread: thread({ lastIso: "2026-09-05T00:00:00.000Z" }) }).age).toBe(0);
  });
});

describe("slackItem", () => {
  it("keys on the channel and the thread's parent timestamp", () => {
    expect(slackItem({ thread: thread() })!.nativeId).toBe("channel-one:1787705115.489199");
  });

  it("carries the permalink as where, never a channel reference", () => {
    expect(slackItem({ thread: thread() })!.where).toBe(
      "https://example.slack.com/archives/channel-one/p1787708973446169",
    );
  });

  it("names the person who spoke last as who", () => {
    expect(slackItem({ thread: thread() })!.who).toBe("A Colleague");
  });

  it("refuses a thread with no permalink rather than rendering a blank cell", () => {
    expect(slackItem({ thread: thread({ permalink: "" }) })).toBeUndefined();
  });

  it("quotes the last message in what would count as done", () => {
    expect(slackDoneWhen({ thread: thread() })).toBe(
      'Reply to A Colleague in #a-channel, whose last message reads "ticked"',
    );
  });
});

describe("slackEvidence", () => {
  it("grades the thread order as a provider fact that does not show the work resolved", () => {
    const evidence = slackEvidence({ thread: thread() })[0]!;
    expect(evidence.grade).toBe("provider-fact");
    expect(evidence.showsResolved).toBe(false);
    expect(evidence.source).toBe("https://example.slack.com/archives/channel-one/p1787708973446169");
  });
});

describe("slackRuleZero", () => {
  it("shows every thread, because the detector only ever produces the owner's move", () => {
    expect(slackRuleZero({ nowIso: NOW, thread: thread() }).verdict).toBe("show");
  });
});

describe("slackLeg", () => {
  it("drops a thread the bot answered last", () => {
    const inputs = slackLeg({
      nowIso: NOW,
      threads: [thread({ lastAuthorIsHuman: false, lastAuthorIsSelf: true, lastAuthorName: "the bot" })],
    });
    expect(inputs).toStrictEqual([]);
  });

  it("drops a thread an app answered last", () => {
    expect(slackLeg({ nowIso: NOW, threads: [thread({ lastAuthorIsHuman: false })] })).toStrictEqual([]);
  });

  it("keeps a thread a person answered last", () => {
    expect(slackLeg({ nowIso: NOW, threads: [thread()] })).toHaveLength(1);
  });

  it("marks every row unverified, because nothing here was read live", () => {
    expect(slackLeg({ nowIso: NOW, threads: [thread()] })[0]!.unverified).toBe(true);
  });

  it("marks every row as finishing in-flight work, which is the tiebreak", () => {
    expect(slackLeg({ nowIso: NOW, threads: [thread()] })[0]!.finishesInFlight).toBe(true);
  });

  it("ranks a thread that asked the owner something above an ambient one", () => {
    const inputs = slackLeg({
      nowIso: NOW,
      threads: [thread(), thread({ channelId: "channel-two", lastText: "can you look?", mentionsOwner: true })],
    });
    const ambient = inputs[0]!.readings;
    const named = inputs[1]!.readings;
    expect(named.stoppedOnOwner).toBeGreaterThan(ambient.stoppedOnOwner);
    expect(named.directness).toBeGreaterThan(ambient.directness);
  });

  it("preserves the order it was given", () => {
    const inputs = slackLeg({
      nowIso: NOW,
      threads: [thread({ channelId: "channel-two" }), thread({ channelId: "channel-three" })],
    });
    expect(inputs.map((one) => one.item.nativeId)).toStrictEqual([
      "channel-two:1787705115.489199",
      "channel-three:1787705115.489199",
    ]);
  });
});

describe("slackOwedThreads", () => {
  it("keeps a thread a person answered last, exactly as given", () => {
    const kept = thread();
    expect(slackOwedThreads({ threads: [kept] })).toStrictEqual([kept]);
  });

  it("drops a thread Slopweaver's own bot answered last", () => {
    const bot = thread({ lastAuthorIsHuman: false, lastAuthorIsSelf: true, lastAuthorName: "the bot" });
    expect(slackOwedThreads({ threads: [bot] })).toStrictEqual([]);
  });

  it("drops a thread Slackbot or an app answered last", () => {
    expect(
      slackOwedThreads({ threads: [thread({ lastAuthorIsHuman: false, lastAuthorName: "Slackbot" })] }),
    ).toStrictEqual([]);
  });

  it("drops a thread with no permalink, because it cannot become a row", () => {
    expect(slackOwedThreads({ threads: [thread({ permalink: "" })] })).toStrictEqual([]);
  });

  it("selects exactly the threads slackLeg turns into rows, so the two consumers cannot disagree", () => {
    const threads = [
      thread({ channelId: "channel-two" }),
      thread({ channelId: "channel-three", lastAuthorIsHuman: false }),
      thread({ channelId: "channel-four", permalink: "" }),
      thread({ channelId: "channel-five", lastText: "can you look?", mentionsOwner: true }),
    ];
    expect(slackOwedThreads({ threads }).map((one) => `${one.channelId}:${one.threadTs}`)).toStrictEqual(
      slackLeg({ nowIso: NOW, threads }).map((one) => one.item.nativeId),
    );
    expect(slackOwedThreads({ threads }).map((one) => one.channelId)).toStrictEqual(["channel-two", "channel-five"]);
  });
});

describe("slackBackground", () => {
  it("names the room and quotes what was actually said", () => {
    expect(slackBackground({ thread: thread() })).toBe(
      'A conversation in #a-channel that you took part in, and A Colleague has spoken in it since your last message. They said: "ticked"',
    );
  });

  it("calls a direct message what it is rather than printing a channel id nobody recognises", () => {
    const dm = thread({ channelId: "D0AAAAA", channelName: undefined });
    expect(slackBackground({ thread: dm })).toContain("A conversation in a direct message that you took part in");
  });

  it("leaves the quote off when the last message carried no text", () => {
    expect(slackBackground({ thread: thread({ lastText: "  " }) })).toBe(
      "A conversation in #a-channel that you took part in, and A Colleague has spoken in it since your last message.",
    );
  });
});

// `channelName` is spelled with an explicit `undefined` for the same `exactOptionalPropertyTypes` reason
// the thread builder above gives.
type MentionOverride = Partial<Omit<SlackMention, "channelName">> & { channelName?: string | undefined };

const mention = (over: MentionOverride = {}): SlackMention => {
  const { channelName, ...rest } = over;
  const room = "channelName" in over ? channelName : "#a-channel";
  return {
    authorIsHuman: true,
    authorName: "A Colleague",
    channelId: "channel-one",
    mentionedIso: "2026-08-30T00:00:00.000Z",
    permalink: "https://example.slack.com/archives/channel-one/p1787708973446169",
    pullRequests: [],
    text: "bump this",
    threadTs: "1787705115.489199",
    ...rest,
    ...(room === undefined ? {} : { channelName: room }),
  };
};

describe("mentionDirectnessOf", () => {
  it("reads a mention that asks something as asked", () => {
    expect(mentionDirectnessOf({ mention: mention({ text: "can you take a look?" }) })).toBe("asked");
  });

  it("reads a mention that asks nothing as addressed, never ambient", () => {
    expect(mentionDirectnessOf({ mention: mention({ text: "cheers!" }) })).toBe("addressed");
  });
});

describe("mentionRoomOf", () => {
  it("names the channel when the record carried one", () => {
    expect(mentionRoomOf({ mention: mention() })).toBe("#a-channel");
  });

  it("says what a direct message is rather than printing its id", () => {
    expect(mentionRoomOf({ mention: mention({ channelId: "Dm-one", channelName: undefined }) })).toBe(
      "a direct message",
    );
  });

  it("falls back to the channel id when no name was captured", () => {
    expect(mentionRoomOf({ mention: mention({ channelName: undefined }) })).toBe("channel-one");
  });
});

describe("slackMentionEvidence", () => {
  it("grades the tag as a provider fact that does not show the work resolved", () => {
    const evidence = slackMentionEvidence({ mention: mention() })[0]!;
    expect(evidence.grade).toBe("provider-fact");
    expect(evidence.showsResolved).toBe(false);
    expect(evidence.source).toBe("https://example.slack.com/archives/channel-one/p1787708973446169");
  });

  it("says both halves of the claim — who tagged the owner, and that the owner has not spoken there since", () => {
    expect(slackMentionEvidence({ mention: mention() })[0]!.what).toBe(
      "A Colleague tagged you in #a-channel at 2026-08-30T00:00:00.000Z and you have not spoken in that thread since",
    );
  });
});

describe("slackMentionRuleZero", () => {
  it("shows every mention, because the detector only ever produces the owner's move", () => {
    expect(slackMentionRuleZero({ mention: mention(), nowIso: NOW }).verdict).toBe("show");
  });
});

describe("slackMentionReadings", () => {
  it("gives a question aimed at the owner the stoppedOnOwner reading", () => {
    const readings = slackMentionReadings({ mention: mention({ text: "any idea?" }), nowIso: NOW });
    expect(readings.stoppedOnOwner).toBe(5);
    expect(readings.directness).toBe(3);
  });

  it("gives a closer the audience reading and nothing more", () => {
    const readings = slackMentionReadings({ mention: mention({ text: "cheers!" }), nowIso: NOW });
    expect(readings.stoppedOnOwner).toBe(0);
    expect(readings.directness).toBe(3);
  });

  it("caps age at the same bound the movement detector uses", () => {
    const old = mention({ mentionedIso: "2026-08-01T00:00:00.000Z" });
    expect(slackMentionReadings({ mention: old, nowIso: NOW }).age).toBe(AGE_DAYS_CAP);
  });

  it("reads an unparseable instant as no age rather than as a negative one", () => {
    expect(slackMentionReadings({ mention: mention({ mentionedIso: "not a date" }), nowIso: NOW }).age).toBe(0);
  });

  it("measures no drift and no explicit priority, because Slack carries neither", () => {
    const readings = slackMentionReadings({ mention: mention(), nowIso: NOW });
    expect(readings.drift).toBe(0);
    expect(readings.explicitPriority).toBe(0);
  });
});

describe("mentionedPullRequests", () => {
  it("answers undefined when the message links no pull request", () => {
    expect(mentionedPullRequests({ mention: mention() })).toBeUndefined();
  });

  it("takes the first link's repository and every number it links there", () => {
    const linked = mentionedPullRequests({
      mention: mention({
        pullRequests: [
          { number: 17_316, owner: "acme", repo: "acme-admin" },
          { number: 17_281, owner: "acme", repo: "acme-admin" },
        ],
      }),
    })!;
    expect(linked.repo).toBe("acme/acme-admin");
    expect(linked.numbers).toStrictEqual([17_316, 17_281]);
  });

  it("drops a number in a second repository rather than checking it against the first", () => {
    const linked = mentionedPullRequests({
      mention: mention({
        pullRequests: [
          { number: 17_316, owner: "acme", repo: "acme-admin" },
          { number: 9, owner: "octo-self", repo: "slopweaver" },
        ],
      }),
    })!;
    expect(linked.repo).toBe("acme/acme-admin");
    expect(linked.numbers).toStrictEqual([17_316]);
  });
});

describe("slackMentionDoneWhen", () => {
  it("names the person and the room when the message links nothing", () => {
    expect(slackMentionDoneWhen({ mention: mention() })).toBe(
      "Reply to A Colleague in #a-channel, who tagged you and has had no word from you since",
    );
  });

  it("names the pull requests it resolved, so the live re-read has something to check", () => {
    const linked = mention({ pullRequests: [{ number: 17_316, owner: "acme", repo: "acme-admin" }] });
    expect(slackMentionDoneWhen({ mention: linked })).toBe(
      "Reply to A Colleague in #a-channel, who tagged you about #17316 in acme/acme-admin",
    );
  });

  it("says a direct message is one rather than printing its id", () => {
    const dm = mention({ channelId: "Dm-one", channelName: undefined });
    expect(slackMentionDoneWhen({ mention: dm })).toContain("in a direct message");
  });
});

describe("slackMentionBackground", () => {
  it("says what the thread is and quotes what was said", () => {
    expect(slackMentionBackground({ mention: mention() })).toBe(
      'A conversation in #a-channel that you have not spoken in since, where A Colleague tagged you by name. They said: "bump this"',
    );
  });

  it("adds the leading hash only when the stored name lacks one", () => {
    expect(slackMentionBackground({ mention: mention({ channelName: "a-channel" }) })).toContain(" in #a-channel ");
  });

  it("drops the quote for a message with no text rather than printing an empty one", () => {
    expect(slackMentionBackground({ mention: mention({ text: "" }) })).not.toContain("They said");
  });
});

describe("slackMentionItem", () => {
  it("keys on the channel and thread, which is what reconciliation compares between runs", () => {
    expect(slackMentionItem({ mention: mention() })!.nativeId).toBe("channel-one:1787705115.489199");
  });

  it("carries the linked repository so the live re-read can resolve its numbers", () => {
    const linked = mention({ pullRequests: [{ number: 17_316, owner: "acme", repo: "acme-admin" }] });
    expect(slackMentionItem({ mention: linked })!.repo).toBe("acme/acme-admin");
  });

  it("carries every link the message names, across repositories, so a slice is never earned by one of several", () => {
    const linked = mention({
      pullRequests: [
        { number: 17_316, owner: "acme", repo: "acme-admin" },
        { number: 9, owner: "octo-self", repo: "slopweaver" },
      ],
    });
    expect(slackMentionItem({ mention: linked })!.linkedPullRequests).toStrictEqual([
      "acme/acme-admin#17316",
      "octo-self/slopweaver#9",
    ]);
  });

  it("carries no links when the message linked none", () => {
    expect(slackMentionItem({ mention: mention() })!.linkedPullRequests).toBeUndefined();
  });

  it("names no repository when the message linked none", () => {
    expect(slackMentionItem({ mention: mention() })!.repo).toBeUndefined();
  });

  it("refuses a mention with no permalink rather than rendering a blank cell", () => {
    expect(slackMentionItem({ mention: mention({ permalink: "" }) })).toBeUndefined();
  });
});

describe("slackMentionLeg", () => {
  it("turns a mention written by a person into one rank input", () => {
    expect(slackMentionLeg({ mentions: [mention()], nowIso: NOW })).toHaveLength(1);
  });

  it("drops a mention whose author is not a person", () => {
    expect(slackMentionLeg({ mentions: [mention({ authorIsHuman: false })], nowIso: NOW })).toStrictEqual([]);
  });

  it("never claims a mention finishes something in flight, because the owner has not spoken in it since", () => {
    expect(slackMentionLeg({ mentions: [mention()], nowIso: NOW })[0]!.finishesInFlight).toBe(false);
  });

  it("marks every row unverified, because nothing here was read live", () => {
    expect(slackMentionLeg({ mentions: [mention()], nowIso: NOW })[0]!.unverified).toBe(true);
  });

  it("carries the permalink of the mention itself as the row's evidence", () => {
    const trace = slackMentionLeg({ mentions: [mention()], nowIso: NOW })[0]!.trace;
    expect(trace.carried[0]!.source).toBe("https://example.slack.com/archives/channel-one/p1787708973446169");
  });
});

describe("a mention ranks below a thread movement at equal signal", () => {
  it("puts the thread the owner is already in first when both rows score the same", () => {
    const [ranked] = [
      rankAll({
        inputs: [
          ...slackMentionLeg({ mentions: [mention({ text: "any idea?" })], nowIso: NOW }),
          ...slackLeg({
            nowIso: NOW,
            threads: [thread({ channelId: "channel-two", lastText: "any idea?", mentionsOwner: true })],
          }),
        ],
      }),
    ];
    expect(ranked.ranked).toHaveLength(2);
    expect(ranked.ranked[0]!.score).toBe(ranked.ranked[1]!.score);
    expect(ranked.ranked[0]!.item.provenance).toBe(
      "slack leg — a thread you spoke in whose last word is somebody else's",
    );
    expect(ranked.ranked[1]!.item.provenance).toBe(
      "slack leg — somebody tagged you and you have not spoken in the thread since",
    );
  });

  it("does NOT demote a question aimed at the owner below an ambient thread the owner happens to be in", () => {
    const ranked = rankAll({
      inputs: [
        ...slackLeg({ nowIso: NOW, threads: [thread({ channelId: "channel-two", lastText: "cheers!" })] }),
        ...slackMentionLeg({ mentions: [mention({ text: "any idea?" })], nowIso: NOW }),
      ],
    }).ranked;
    expect(ranked[0]!.item.provenance).toBe(
      "slack leg — somebody tagged you and you have not spoken in the thread since",
    );
    expect(ranked[0]!.score).toBeGreaterThan(ranked[1]!.score);
  });
});
