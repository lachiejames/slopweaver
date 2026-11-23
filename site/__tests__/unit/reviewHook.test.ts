/*
 * The ask line: who a pull request waits on, where, how long ago, and whether to ask again — worded from the
 * facts `github landing` printed, and never a confident "nobody" the verb did not say.
 */
import { describe, expect, it } from "vitest";

import type { LandingAsk, LandingRow, LandingShare } from "../../components/live/readLanding";
import {
  type AgoWords,
  askLineOf,
  type DrawnWait,
  drawnWaitOf,
  suggestionHeld,
  trailLinesOf,
} from "../../lib/reviewHook";
import { seatOf } from "../../lib/seat";
import type { SlackPeople } from "../../lib/slackPeople";

const PEOPLE: SlackPeople = new Map([["U0SYN000006", { handle: undefined, name: "Pranav" }]]);

/** The seam: an age is the instant itself, so every sentence below is exact. */
const ago: AgoWords = (iso) => `<${iso}>`;

const NEWEST: LandingAsk = {
  atIso: "2026-09-23T04:46:00.000Z",
  channel: "#dev-alerts",
  isDirectMessage: false,
  leg: "corpus",
  messageKey: "C1:2",
  permalink: "https://acme.slack.com/archives/C1/p2",
  recipients: ["U0SYN000006", "S0GROUP"],
};

const OLDER: LandingAsk = {
  ...NEWEST,
  atIso: "2026-09-21T01:00:00.000Z",
  channel: "Rosa Lindqvist",
  isDirectMessage: true,
  messageKey: "D1:1",
  permalink: "https://acme.slack.com/archives/D1/p1",
  recipients: ["U0SYN000002"],
};

/** A row carrying only what the ask line reads, with `over` laid on top. */
function row({ over = {} }: { over?: Partial<LandingRow> } = {}): LandingRow {
  return {
    action: "blocked-on",
    actionDetail: "",
    askTrail: [NEWEST, OLDER],
    channelShare: undefined,
    authorLogin: "octocat",
    baseRefName: "main",
    blockedOn: [],
    boardRowKind: "declared",
    boardRowSlug: undefined,
    boardRowWhy: undefined,
    bump: undefined,
    ci: "green",
    ciFailure: { kind: "not-red" },
    codeRabbit: { awaitingUs: 0, open: 0 },
    createdAtIso: "2026-09-20T00:00:00.000Z",
    dispatchKind: undefined,
    dispatchWhy: undefined,
    draft: false,
    failingChecks: [],
    headOid: "abc",
    headRefName: "b",
    humans: { awaitingUs: 0, open: 0 },
    humanWait: undefined,
    labels: [],
    number: 17012,
    repoSlug: "acme/acme-admin",
    slackAsked: "yes",
    slackBounded: true,
    slackWhy: undefined,
    stackPosition: undefined,
    stackSize: undefined,
    stacked: false,
    tests: [],
    title: "t",
    updatedAtIso: "2026-09-23T05:00:00.000Z",
    url: "https://github.com/acme/acme-admin/pull/17012",
    verdict: undefined,
    waitingOn: [],
    ...over,
  };
}

describe("askLineOf", () => {
  it("names the newest ask's people, where and how long ago, and counts the rest", () => {
    const line = askLineOf({ ago, people: PEOPLE, row: row() });
    expect(line).toEqual({
      again: undefined,
      kind: "asked",
      permalink: NEWEST.permalink,
      text: "in #dev-alerts <2026-09-23T04:46:00.000Z> · 2 asks in all",
      unsettled: [],
      who: [
        { text: "Pranav", title: "U0SYN000006" },
        { text: "S0GROUP", title: "S0GROUP" },
      ],
    });
  });

  it("says a direct message was one, rather than naming the DM as a channel", () => {
    const line = askLineOf({ ago, people: PEOPLE, row: row({ over: { askTrail: [OLDER] } }) });
    expect(line.text).toBe("by direct message <2026-09-21T01:00:00.000Z>");
  });

  it("puts a due chase loud, with how long they have been silent", () => {
    const bump = { eligibleSinceIso: "2026-09-24T04:46:00.000Z", kind: "due", silentSinceIso: NEWEST.atIso } as const;
    expect(askLineOf({ ago, people: PEOPLE, row: row({ over: { bump } }) }).again).toEqual({
      text: "ask again: silent since <2026-09-23T04:46:00.000Z>",
      title: "no reply since the ask, and past the bar since 2026-09-24T04:46:00.000Z",
      tone: "danger",
    });
  });

  it("words the other three bump arms with the verb's own sentence on hover", () => {
    const arms = [
      { eligibleAtIso: "2026-09-24T04:46:00.000Z", kind: "too-soon", why: "w1" },
      { kind: "replied", why: "w2" },
      { kind: "unknown", why: "w3" },
    ] as const;
    const chips = arms.map((bump) => askLineOf({ ago, people: PEOPLE, row: row({ over: { bump } }) }).again);
    expect(chips).toEqual([
      { text: "too soon to ask again", title: "w1", tone: "neutral" },
      { text: "they replied", title: "w2", tone: "success" },
      { text: "ask again: not known", title: "w3", tone: "warning" },
    ]);
  });

  it("reads a draft and a stacked row as not due, whatever their trail", () => {
    const kinds = [row({ over: { draft: true } }), row({ over: { stacked: true } })].map((one) =>
      askLineOf({ ago, people: PEOPLE, row: one }),
    );
    expect(kinds.map((line) => [line.kind, line.text, line.who])).toEqual([
      ["not-due", "a draft: nobody is asked until it is ready", []],
      ["not-due", "stacked: nobody is asked until its base lands", []],
    ]);
  });

  it("says nobody was asked only when the verb answered no", () => {
    const line = askLineOf({ ago, people: PEOPLE, row: row({ over: { askTrail: [], slackAsked: "no" } }) });
    expect([line.kind, line.text]).toEqual(["nobody-asked", "nobody asked in Slack yet"]);
  });

  it("reads an older reading and an unsettled answer as not known, with the verb's reason", () => {
    const older = askLineOf({ ago, people: PEOPLE, row: row({ over: { askTrail: undefined, slackAsked: "no" } }) });
    const unsettled = askLineOf({
      ago,
      people: PEOPLE,
      row: row({ over: { askTrail: [], slackAsked: "unknown", slackWhy: "the corpus is 3 days stale" } }),
    });
    expect([older.kind, older.text, unsettled.kind, unsettled.text]).toEqual([
      "unknown",
      "who was asked is not in this reading; it predates the ask trail",
      "unknown",
      "not known who was asked: the corpus is 3 days stale",
    ]);
  });

  it("lifts the verb's unsettled message links out of its sentence", () => {
    const slackWhy =
      "2 message(s) this read cannot settle as an ask or not, for a visible session to read: https://x.slack.com/archives/C1/p1 https://x.slack.com/archives/C1/p2";
    const line = askLineOf({
      ago,
      people: PEOPLE,
      row: row({ over: { askTrail: [], slackAsked: "unknown", slackWhy } }),
    });
    expect([line.text, line.unsettled]).toEqual([
      "not known who was asked: 2 message(s) this read cannot settle as an ask or not, for a visible session to read",
      ["https://x.slack.com/archives/C1/p1", "https://x.slack.com/archives/C1/p2"],
    ]);
  });
});

describe("trailLinesOf", () => {
  it("lists every ask newest first, each with its message and minute", () => {
    expect(trailLinesOf({ ago, people: PEOPLE, row: row() })).toEqual([
      {
        key: "C1:2",
        permalink: NEWEST.permalink,
        text: "in #dev-alerts <2026-09-23T04:46:00.000Z> · 2026-09-23 04:46Z",
        who: [
          { text: "Pranav", title: "U0SYN000006" },
          { text: "S0GROUP", title: "S0GROUP" },
        ],
      },
      {
        key: "D1:1",
        permalink: OLDER.permalink,
        text: "by direct message <2026-09-21T01:00:00.000Z> · 2026-09-21 01:00Z",
        who: [{ text: "U0SYN000002", title: "U0SYN000002" }],
      },
    ]);
  });

  it("is empty for a reading older than the trail", () => {
    expect(trailLinesOf({ ago, people: PEOPLE, row: row({ over: { askTrail: undefined } }) })).toEqual([]);
  });
});

describe("drawnWaitOf", () => {
  const WAIT = {
    lastAskAtIso: undefined,
    lastAskPermalink: undefined,
    next: "name-the-reviewer",
    requestedAtIso: "2026-09-22T00:00:00.000Z",
    sentence: "waiting on @acme/security for 2.9d · next: name a person to ask — only your word is missing",
    slackThroughIso: undefined,
    stale: "no",
    who: ["@acme/security"],
  };

  it("draws the verb's own wait while no pick stands", () => {
    expect(drawnWaitOf({ people: PEOPLE, picked: undefined, row: row({ over: { humanWait: WAIT } }) })).toEqual({
      next: "name-the-reviewer",
      sentence: WAIT.sentence,
    });
  });

  it("lets a pick the owner approved since the newest ask supersede 'only your word is missing'", () => {
    const drawn = drawnWaitOf({
      people: PEOPLE,
      picked: { reviewer: "U0SYN000006" },
      row: row({ over: { humanWait: WAIT } }),
    });
    expect(drawn).toEqual({
      next: "ask",
      pickedReviewer: "Pranav",
      sentence:
        "you picked Pranav; no ask to them is seen since the pick; your queue holds any ask waiting on your yes",
    });
  });

  it("carries a Slack sync's watermark, and drops it once a pick supersedes the sync, so the seat moves with the tag", () => {
    const sync = { ...WAIT, next: "sync-slack", slackThroughIso: "2026-09-25T11:40:22.000Z" };
    const seatUnder = (wait: DrawnWait | undefined): string =>
      seatOf({
        blockedOn: ["@acme/security"],
        depth: [],
        headRefName: "h",
        sessions: [],
        sharedIn: undefined,
        wait,
        watchers: [],
      }).kind;
    const raw = drawnWaitOf({ people: PEOPLE, picked: undefined, row: row({ over: { humanWait: sync } }) });
    const picked = drawnWaitOf({
      people: PEOPLE,
      picked: { reviewer: "U0SYN000006" },
      row: row({ over: { humanWait: sync } }),
    });
    expect([
      raw?.slackThroughIso,
      seatUnder(raw),
      picked?.next,
      picked?.slackThroughIso,
      seatUnder(picked),
    ]).toStrictEqual(["2026-09-25T11:40:22.000Z", "stale-history", "ask", undefined, "paused"]);
  });

  it("draws no wait on a row the verb did not say is waiting on a human, pick or not", () => {
    expect([
      drawnWaitOf({ people: PEOPLE, picked: undefined, row: row() }),
      drawnWaitOf({ people: PEOPLE, picked: { reviewer: "U0SYN000006" }, row: row() }),
    ]).toEqual([undefined, undefined]);
  });
});

/** A pull request's post to #dev-team, as the verb printed its channel share. */
const SHARE: LandingShare = {
  badge: "waiting for engagement",
  asOfIso: "2026-09-27T15:19:32.000Z",
  channel: "#dev-team",
  permalink: "https://acme.slack.com/archives/C0SYN000002/p1790508621312739",
  postedAtIso: "2026-09-27T11:30:21.000Z",
  replies: 0,
  seen: "asks seen through 2026-09-27 15:19Z (the Slack corpus), replies seen through 2026-09-27 15:19Z (the whole thread)",
  tone: "green",
  why: "no reply yet, 0 business days into the first business day",
};

describe("askLineOf — shared with a channel, nobody named", () => {
  it("draws the third state with the clock as its badge, the reason under it and the post as its citation", () => {
    const line = askLineOf({
      ago,
      people: PEOPLE,
      row: row({ over: { askTrail: [], channelShare: SHARE, slackAsked: "unknown", slackWhy: "the corpus is stale" } }),
    });
    expect(line.kind).toBe("shared");
    expect(line.text).toBe("shared in #dev-team <2026-09-27T11:30:21.000Z>, no reviewer named");
    expect(line.permalink).toBe(SHARE.permalink);
    expect(line.again!.text).toBe("waiting for engagement");
    expect(line.again!.tone).toBe("success");
    expect(line.note).toBe("no reply yet, 0 business days into the first business day");
    expect(line.again!.title).toBe(
      "the business-day clock on the post in #dev-team, read as of 2026-09-27 15:19Z: asks seen through 2026-09-27 15:19Z (the Slack corpus), replies seen through 2026-09-27 15:19Z (the whole thread)",
    );
  });

  it("never calls a reply the thread read found past the clock's instant unseen — each horizon is named apart", () => {
    const share: LandingShare = {
      ...SHARE,
      asOfIso: "2026-09-29T02:00:00.000Z",
      badge: "in conversation",
      replies: 1,
      seen: "asks seen through 2026-09-29 02:00Z (the Slack corpus), replies seen through 2026-09-29 04:00Z (the whole thread)",
      why: "the newest reply was 0 business days ago, asks seen through 2026-09-29 02:00Z",
    };
    const line = askLineOf({
      ago,
      people: PEOPLE,
      row: row({ over: { askTrail: [], channelShare: share, slackAsked: "unknown", slackWhy: "the corpus is stale" } }),
    });
    expect(line.text).toBe("shared in #dev-team <2026-09-27T11:30:21.000Z>, no reviewer named · 1 reply");
    expect(line.note).toBe("the newest reply was 0 business days ago, asks seen through 2026-09-29 02:00Z");
    expect(line.again!.title).toBe(
      "the business-day clock on the post in #dev-team, read as of 2026-09-29 02:00Z: asks seen through 2026-09-29 02:00Z (the Slack corpus), replies seen through 2026-09-29 04:00Z (the whole thread)",
    );
  });

  it("maps yellow, red and an unknown clock to warning, danger and neutral, and counts replies", () => {
    const tones = (["yellow", "red", "unknown"] as const).map((tone) =>
      askLineOf({
        ago,
        people: PEOPLE,
        row: row({ over: { askTrail: [], channelShare: { ...SHARE, replies: 2, tone } } }),
      }),
    );
    expect(tones.map((line) => line.again!.tone)).toEqual(["warning", "danger", "neutral"]);
    expect(tones[0].text).toBe("shared in #dev-team <2026-09-27T11:30:21.000Z>, no reviewer named · 2 replies");
  });

  it("never draws the shared state over a draft", () => {
    const line = askLineOf({
      ago,
      people: PEOPLE,
      row: row({ over: { askTrail: [], channelShare: SHARE, draft: true } }),
    });
    expect(line.kind).toBe("not-due");
  });
});

describe("suggestionHeld", () => {
  it("holds the reviewer suggestion until the channel's clock reads red, an unknown clock included", () => {
    const held = (["green", "yellow", "red", "unknown"] as const).map((tone) =>
      suggestionHeld({ row: row({ over: { channelShare: { ...SHARE, tone } } }) }),
    );
    expect(held).toEqual([true, true, false, true]);
    expect(suggestionHeld({ row: row() })).toBe(false);
  });
});
