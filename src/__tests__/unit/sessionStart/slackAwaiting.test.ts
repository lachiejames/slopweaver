import { describe, expect, it } from "vitest";

import {
  awaitingVerdictOf,
  expectsReply,
  replyAskOf,
  type SlackAwaitingCandidate,
  type SlackOwnerWord,
  type SlackThreadPerson,
  slackAwaitingThreads,
} from "../../../sessionStart/slackAwaiting.js";

const OWNER = "U0SYNOWNER1234";
const SELF = "U0SYNSELFBOT12";
const ALICE = "U0SYNALICE1234";
const BOB = "U0SYNBOB123456";
const NO_SELF: ReadonlySet<string> = new Set([SELF]);

/** A Monday, 10:00 Melbourne time. */
const MONDAY_MORNING = "2026-09-28T00:00:00.000Z";
/** The Wednesday after, 11:00 Melbourne time — 49 business hours after {@link MONDAY_MORNING}. */
const WEDNESDAY_LATE_MORNING = "2026-09-30T01:00:00.000Z";

/**
 * One word of the owner's, its signals read from the text exactly as the real read reads them.
 *
 * @param authoredText what the owner typed, mention runs intact
 * @param tsIso when the owner typed it
 * @returns the word
 */
function ownerWord({
  authoredText,
  tsIso,
  reactedBy = [],
}: {
  authoredText: string;
  tsIso: string;
  reactedBy?: readonly string[];
}): SlackOwnerWord {
  return {
    ask: replyAskOf({ authoredText, ownerId: OWNER, selfIds: NO_SELF }),
    ownTs: Date.parse(tsIso) / 1000,
    permalink: `https://example.slack.com/archives/C0SYNCHANNEL1/p${String(Date.parse(tsIso))}`,
    pullRequests: [],
    quote: authoredText,
    reactedBy,
    tsIso,
  };
}

/**
 * Somebody else who spoke in the thread.
 *
 * @param lastIso when they last spoke
 * @param isHuman false for a bot or app, whose word answers nothing
 * @returns the person
 */
function speaker({ id, lastIso, isHuman }: { id: string; lastIso: string; isHuman: boolean }): SlackThreadPerson {
  return { id, isHuman, lastIso, lastOwnTs: Date.parse(lastIso) / 1000, name: id, taggable: isHuman };
}

/**
 * A channel thread with the owner's words and the people in it.
 *
 * @param channelId a `D…` id makes it a direct message
 * @returns the candidate
 */
function thread({
  channelId = "C0SYNCHANNEL1",
  ownerWords,
  people = [],
}: {
  channelId?: string;
  ownerWords: readonly SlackOwnerWord[];
  people?: readonly SlackThreadPerson[];
}): SlackAwaitingCandidate {
  return {
    channelId,
    hasReplies: people.length > 0,
    ownerWords,
    people,
    threadTs: "1790300000.000100",
  };
}

describe("replyAskOf", () => {
  it("reads a question mark in the owner's own prose", () => {
    expect(replyAskOf({ authoredText: "can we ship this today?", ownerId: OWNER, selfIds: NO_SELF })).toEqual({
      asksQuestion: true,
      taggedIds: [],
      tagsGroup: false,
    });
  });

  it("ignores a question mark inside a link, a code span or a fenced block", () => {
    const authoredText = "see <https://example.com/x?y=1|the doc> and `a?b` and ```\nwhy?\n``` — done.";
    expect(replyAskOf({ authoredText, ownerId: OWNER, selfIds: NO_SELF }).asksQuestion).toBe(false);
  });

  it("lists each tagged person once, in order written, never the owner or Slopweaver", () => {
    const authoredText = `<@${BOB}> <@${OWNER}> <@${SELF}> <@${ALICE}> and <@${BOB}> again`;
    expect(replyAskOf({ authoredText, ownerId: OWNER, selfIds: NO_SELF }).taggedIds).toEqual([BOB, ALICE]);
  });

  it("reads a user group tag and a room broadcast as a group ask", () => {
    const group = replyAskOf({ authoredText: "<!subteam^S0TEAM1234> please look", ownerId: OWNER, selfIds: NO_SELF });
    const here = replyAskOf({ authoredText: "<!here> heads up", ownerId: OWNER, selfIds: NO_SELF });
    expect([group.tagsGroup, group.taggedIds, here.tagsGroup]).toEqual([true, [], true]);
  });
});

describe("expectsReply", () => {
  const nobodySpoke: ReadonlySet<string> = new Set();

  it("is false only when no signal fired", () => {
    expect(expectsReply({ ask: { asksQuestion: false, taggedIds: [], tagsGroup: false }, spokeIds: nobodySpoke })).toBe(
      false,
    );
    expect(
      expectsReply({ ask: { asksQuestion: false, taggedIds: [ALICE], tagsGroup: false }, spokeIds: nobodySpoke }),
    ).toBe(true);
  });

  it("reads a tag of somebody who already spoke there as no ask, unless a question sits beside it", () => {
    const aliceSpoke: ReadonlySet<string> = new Set([ALICE]);
    const thanks = expectsReply({
      ask: { asksQuestion: false, taggedIds: [ALICE], tagsGroup: false },
      spokeIds: aliceSpoke,
    });
    const asked = expectsReply({
      ask: { asksQuestion: true, taggedIds: [ALICE], tagsGroup: false },
      spokeIds: aliceSpoke,
    });
    const newcomer = expectsReply({
      ask: { asksQuestion: false, taggedIds: [ALICE, BOB], tagsGroup: false },
      spokeIds: aliceSpoke,
    });
    expect([thanks, asked, newcomer]).toEqual([false, true, true]);
  });
});

describe("awaitingVerdictOf", () => {
  it("keeps a thread whose last human word is the owner's question, two business days on", () => {
    const question = ownerWord({ authoredText: "which env did that run against?", tsIso: MONDAY_MORNING });
    const verdict = awaitingVerdictOf({
      candidate: thread({
        ownerWords: [question],
        people: [speaker({ id: ALICE, isHuman: true, lastIso: "2026-09-27T23:00:00.000Z" })],
      }),
      nowIso: WEDNESDAY_LATE_MORNING,
    });
    expect(verdict).toEqual({ businessMs: 49 * 3600 * 1000, kind: "awaiting", run: [question] });
  });

  it("does not let a bot reply after the owner's question end the owner's wait", () => {
    const question = ownerWord({ authoredText: "who owns this alert?", tsIso: MONDAY_MORNING });
    const verdict = awaitingVerdictOf({
      candidate: thread({
        ownerWords: [question],
        people: [speaker({ id: "U0SYNDDBOT1234", isHuman: false, lastIso: "2026-09-28T02:00:00.000Z" })],
      }),
      nowIso: WEDNESDAY_LATE_MORNING,
    });
    expect(verdict.kind).toBe("awaiting");
  });

  it("reads a person's reply after the owner's last word as answered", () => {
    const verdict = awaitingVerdictOf({
      candidate: thread({
        ownerWords: [ownerWord({ authoredText: "which env?", tsIso: MONDAY_MORNING })],
        people: [speaker({ id: ALICE, isHuman: true, lastIso: "2026-09-28T01:00:00.000Z" })],
      }),
      nowIso: WEDNESDAY_LATE_MORNING,
    });
    expect(verdict).toEqual({ kind: "answered" });
  });

  it("judges the owner's whole trailing run, so a question followed by a plain note still waits", () => {
    const question = ownerWord({ authoredText: "can you confirm the rollout?", tsIso: "2026-09-27T23:50:00.000Z" });
    const note = ownerWord({ authoredText: "also dropping the old flag", tsIso: MONDAY_MORNING });
    const verdict = awaitingVerdictOf({
      candidate: thread({ ownerWords: [question, note] }),
      nowIso: WEDNESDAY_LATE_MORNING,
    });
    expect(verdict).toEqual({ businessMs: 49 * 3600 * 1000, kind: "awaiting", run: [question, note] });
  });

  it("leaves out a trailing run that asks nothing and tags nobody", () => {
    const verdict = awaitingVerdictOf({
      candidate: thread({ ownerWords: [ownerWord({ authoredText: "shipped, thanks all", tsIso: MONDAY_MORNING })] }),
      nowIso: WEDNESDAY_LATE_MORNING,
    });
    expect(verdict).toEqual({ kind: "no-ask" });
  });

  it("holds a chase the owner dropped: the owner's ask 25.5 business hours before the draft is not due", () => {
    const verdict = awaitingVerdictOf({
      candidate: thread({
        ownerWords: [
          ownerWord({
            authoredText:
              "Coming back to this point, the Acme team could move some nightly jobs off the build box and onto a runner.  Any preference on how that should run?",
            tsIso: "2026-09-28T11:13:05.000Z",
          }),
        ],
        people: [speaker({ id: ALICE, isHuman: true, lastIso: "2026-09-28T11:09:30.000Z" })],
      }),
      nowIso: "2026-09-29T12:45:15.000Z",
    });
    expect(verdict).toEqual({ businessMs: (25 * 3600 + 32 * 60 + 10) * 1000, kind: "inside-chase-wait" });
  });

  it("holds an ask one millisecond short of two business days, and keeps it at exactly two", () => {
    const candidate = thread({ ownerWords: [ownerWord({ authoredText: "thoughts?", tsIso: MONDAY_MORNING })] });
    const twoDays = 48 * 3600 * 1000;
    const short = awaitingVerdictOf({ candidate, nowIso: "2026-09-29T23:59:59.999Z" });
    const due = awaitingVerdictOf({ candidate, nowIso: "2026-09-30T00:00:00.000Z" });
    expect([short.kind, due.kind]).toEqual(["inside-chase-wait", "awaiting"]);
    expect(short).toEqual({ businessMs: twoDays - 1, kind: "inside-chase-wait" });
  });

  it("counts business time only, so a Friday-afternoon question is still held on Monday evening", () => {
    const verdict = awaitingVerdictOf({
      candidate: thread({ ownerWords: [ownerWord({ authoredText: "thoughts?", tsIso: "2026-09-25T06:00:00.000Z" })] }),
      nowIso: "2026-09-28T10:00:00.000Z",
    });
    expect(verdict).toEqual({ businessMs: 28 * 3600 * 1000, kind: "inside-chase-wait" });
  });

  it("reads a Friday-afternoon question as due on Tuesday afternoon, the weekend never counted", () => {
    const question = ownerWord({ authoredText: "thoughts?", tsIso: "2026-09-25T06:00:00.000Z" });
    const verdict = awaitingVerdictOf({
      candidate: thread({ ownerWords: [question] }),
      nowIso: "2026-09-29T06:00:00.000Z",
    });
    expect(verdict).toEqual({ businessMs: 48 * 3600 * 1000, kind: "awaiting", run: [question] });
  });

  it("never judges a direct message", () => {
    const verdict = awaitingVerdictOf({
      candidate: thread({
        channelId: "D0SYNDIRECT123",
        ownerWords: [ownerWord({ authoredText: "free now?", tsIso: MONDAY_MORNING })],
      }),
      nowIso: WEDNESDAY_LATE_MORNING,
    });
    expect(verdict).toEqual({ kind: "direct-message" });
  });

  it("never judges a group DM, which Slack names mpdm- under a C id", () => {
    const verdict = awaitingVerdictOf({
      candidate: {
        ...thread({ ownerWords: [ownerWord({ authoredText: "free now?", tsIso: MONDAY_MORNING })] }),
        channelName: "#mpdm-alice--bob--owner-1",
      },
      nowIso: WEDNESDAY_LATE_MORNING,
    });
    expect(verdict).toEqual({ kind: "direct-message" });
  });

  it("leaves out the owner's thanks tagging the person who just answered", () => {
    const verdict = awaitingVerdictOf({
      candidate: thread({
        ownerWords: [ownerWord({ authoredText: `great, thanks <@${ALICE}>`, tsIso: MONDAY_MORNING })],
        people: [speaker({ id: ALICE, isHuman: true, lastIso: "2026-09-27T23:00:00.000Z" })],
      }),
      nowIso: WEDNESDAY_LATE_MORNING,
    });
    expect(verdict).toEqual({ kind: "no-ask" });
  });

  it("still reads a tag of somebody who spoke only before the owner's last reply as an ask", () => {
    const verdict = awaitingVerdictOf({
      candidate: thread({
        ownerWords: [
          ownerWord({ authoredText: "looking now", tsIso: "2026-09-27T22:00:00.000Z" }),
          ownerWord({ authoredText: `<@${ALICE}> please verify on prod`, tsIso: MONDAY_MORNING }),
        ],
        people: [
          speaker({ id: ALICE, isHuman: true, lastIso: "2026-09-27T21:00:00.000Z" }),
          speaker({ id: BOB, isHuman: true, lastIso: "2026-09-27T23:00:00.000Z" }),
        ],
      }),
      nowIso: WEDNESDAY_LATE_MORNING,
    });
    expect(verdict.kind).toBe("awaiting");
  });

  it("reads a thanks tagging both who answered the owner's earlier question as no ask, after a long run", () => {
    const verdict = awaitingVerdictOf({
      candidate: thread({
        ownerWords: [
          ownerWord({ authoredText: "who can take this?", tsIso: "2026-09-27T21:00:00.000Z" }),
          ownerWord({ authoredText: "great", tsIso: "2026-09-27T23:40:00.000Z" }),
          ownerWord({ authoredText: "closing the ticket", tsIso: "2026-09-27T23:50:00.000Z" }),
          ownerWord({ authoredText: `thanks <@${BOB}> and <@${ALICE}>`, tsIso: MONDAY_MORNING }),
        ],
        people: [
          speaker({ id: BOB, isHuman: true, lastIso: "2026-09-27T22:00:00.000Z" }),
          speaker({ id: ALICE, isHuman: true, lastIso: "2026-09-27T23:00:00.000Z" }),
        ],
      }),
      nowIso: WEDNESDAY_LATE_MORNING,
    });
    expect(verdict).toEqual({ kind: "no-ask" });
  });

  it("keeps a run of four whose only ask is its first message", () => {
    const run = [
      ownerWord({
        authoredText: `<@${BOB}> can you confirm the migration ran on prod?`,
        tsIso: "2026-09-27T23:00:00.000Z",
      }),
      ownerWord({ authoredText: "for context it's ENG-12", tsIso: "2026-09-27T23:10:00.000Z" }),
      ownerWord({ authoredText: "logs attached", tsIso: "2026-09-27T23:20:00.000Z" }),
      ownerWord({ authoredText: "it passed on staging", tsIso: MONDAY_MORNING }),
    ];
    const verdict = awaitingVerdictOf({
      candidate: thread({
        ownerWords: run,
        people: [speaker({ id: ALICE, isHuman: true, lastIso: "2026-09-27T22:00:00.000Z" })],
      }),
      nowIso: WEDNESDAY_LATE_MORNING,
    });
    expect(verdict).toEqual({ businessMs: 49 * 3600 * 1000, kind: "awaiting", run });
  });

  it("reads a tick on the first message of a run of four as an answer", () => {
    const verdict = awaitingVerdictOf({
      candidate: thread({
        ownerWords: [
          ownerWord({
            authoredText: `<@${BOB}> can you approve?`,
            reactedBy: [BOB],
            tsIso: "2026-09-27T23:00:00.000Z",
          }),
          ownerWord({ authoredText: "great, running now", tsIso: "2026-09-27T23:10:00.000Z" }),
          ownerWord({ authoredText: "done", tsIso: "2026-09-27T23:20:00.000Z" }),
          ownerWord({ authoredText: `fyi <@${ALICE}>`, tsIso: MONDAY_MORNING }),
        ],
      }),
      nowIso: WEDNESDAY_LATE_MORNING,
    });
    expect(verdict).toEqual({ kind: "answered" });
  });

  it("reads a person's reaction on the owner's ask as an answer", () => {
    const verdict = awaitingVerdictOf({
      candidate: thread({
        ownerWords: [
          ownerWord({ authoredText: `<@${ALICE}> is staging on 1.4?`, reactedBy: [ALICE], tsIso: MONDAY_MORNING }),
        ],
      }),
      nowIso: WEDNESDAY_LATE_MORNING,
    });
    expect(verdict).toEqual({ kind: "answered" });
  });

  it("reads an instant it cannot parse as undated, never as zero", () => {
    const verdict = awaitingVerdictOf({
      candidate: thread({ ownerWords: [ownerWord({ authoredText: "ok?", tsIso: MONDAY_MORNING })] }),
      nowIso: "not an instant",
    });
    expect(verdict).toEqual({ kind: "undated" });
  });
});

describe("slackAwaitingThreads", () => {
  it("keeps only the awaiting threads, in the order given, and counts every verdict", () => {
    const waiting = thread({ ownerWords: [ownerWord({ authoredText: "status?", tsIso: MONDAY_MORNING })] });
    const direct = thread({
      channelId: "D0SYNDIRECT123",
      ownerWords: [ownerWord({ authoredText: "status?", tsIso: MONDAY_MORNING })],
    });
    const quiet = thread({ ownerWords: [ownerWord({ authoredText: "noted", tsIso: MONDAY_MORNING })] });
    const selection = slackAwaitingThreads({ candidates: [direct, waiting, quiet], nowIso: WEDNESDAY_LATE_MORNING });
    expect(selection.awaiting.map((kept) => kept.candidate)).toEqual([waiting]);
    expect(selection.tally).toEqual({
      answered: 0,
      awaiting: 1,
      "direct-message": 1,
      "inside-chase-wait": 0,
      "no-ask": 1,
      undated: 0,
    });
  });

  it("answers an empty selection for no threads", () => {
    expect(slackAwaitingThreads({ candidates: [], nowIso: WEDNESDAY_LATE_MORNING }).awaiting).toEqual([]);
  });
});
