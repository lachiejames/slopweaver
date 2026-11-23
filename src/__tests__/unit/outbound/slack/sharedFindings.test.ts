/**
 * A finding is SHARED exactly when a parked `kind: "finding"` row was released, and each earns one follow-up card:
 * any row naming it spends that card, bar a row a later cut re-cut.
 */
import { describe, expect, it } from "vitest";

import {
  type ParkedSlackDraft,
  parkedDraftDigest,
  type SlackDraftEvent,
} from "../../../../outbound/slack/draftRegister.js";
import {
  followupOfRefusals,
  followupsSpending,
  rivalFollowupOf,
  sharedFindingsOf,
} from "../../../../outbound/slack/sharedFindings.js";

const CHANNEL = "C0SYN000001";
const FINDING_TS = "1792000000.000100";

/** One parked row, its digest computed as the recorder computes it. */
function draft({
  id,
  kind,
  followupOf,
  recuts,
}: {
  id: string;
  kind?: ParkedSlackDraft["kind"];
  followupOf?: string;
  recuts?: readonly string[];
}): ParkedSlackDraft {
  const content = {
    authorId: "U0SYN000001",
    channel: CHANNEL,
    mentions: [],
    payload: { form: "plain" as const, text: "the words", unfurl_links: false, unfurl_media: false },
  };
  return {
    ...content,
    advisory: [],
    channelName: "proj-launch-room",
    digest: parkedDraftDigest({ draft: content }),
    form: "{}",
    id,
    row: "the-board-row",
    shape: "top-level",
    tsIso: "2026-10-14T17:00:00.000Z",
    why: `the ${id} row`,
    ...(kind === undefined ? {} : { kind }),
    ...(followupOf === undefined ? {} : { followupOf }),
    ...(recuts === undefined ? {} : { recuts }),
  };
}

/** A park event for `row`. */
function parked({ row }: { row: ParkedSlackDraft }): SlackDraftEvent {
  return { draft: row, id: row.id, kind: "parked", tsIso: row.tsIso };
}

/** A release of `id` landing at `ts`, optionally in a thread or as a thanks in its place. */
function released({
  id,
  ts,
  threadTs,
  thanksInstead,
}: {
  id: string;
  ts: string;
  threadTs?: string;
  thanksInstead?: string;
}): SlackDraftEvent {
  return {
    channel: CHANNEL,
    id,
    kind: "released",
    permalink: `https://example.slack.com/archives/${CHANNEL}/p${ts.replace(".", "")}`,
    ts,
    tsIso: "2026-10-14T18:00:00.000Z",
    ...(threadTs === undefined ? {} : { threadTs }),
    ...(thanksInstead === undefined ? {} : { thanksInstead }),
  };
}

const FINDING = draft({ id: "sd-aa000001", kind: "finding" });
const SHARED: readonly SlackDraftEvent[] = [parked({ row: FINDING }), released({ id: FINDING.id, ts: FINDING_TS })];

describe("sharedFindingsOf", () => {
  it("reads a released finding at the coordinates its release landed on, its thread the message itself", () => {
    expect(sharedFindingsOf({ events: SHARED })).toStrictEqual({
      findings: [
        {
          channelId: CHANNEL,
          channelName: "proj-launch-room",
          draftId: "sd-aa000001",
          messageTs: FINDING_TS,
          permalink: `https://example.slack.com/archives/${CHANNEL}/p1792000000000100`,
          postedAtIso: "2026-10-14T17:46:40.000Z",
          row: "the-board-row",
          threadTs: FINDING_TS,
          why: "the sd-aa000001 row",
        },
      ],
      undated: [],
    });
  });

  it("keeps a finding released into a thread under that thread", () => {
    const events = [
      parked({ row: FINDING }),
      released({ id: FINDING.id, threadTs: "1791990000.000100", ts: FINDING_TS }),
    ];
    expect(sharedFindingsOf({ events }).findings.map((one) => [one.messageTs, one.threadTs])).toStrictEqual([
      [FINDING_TS, "1791990000.000100"],
    ]);
  });

  it("shares nothing for a message row, a held finding, or a release that sent thanks in its place", () => {
    const message = draft({ id: "sd-aa000002", kind: "message" });
    const held = draft({ id: "sd-aa000003", kind: "finding" });
    const thanked = draft({ id: "sd-aa000004", kind: "finding" });
    const undeclared = draft({ id: "sd-aa000005" });
    const events = [
      parked({ row: message }),
      released({ id: message.id, ts: "1792000001.000100" }),
      parked({ row: held }),
      parked({ row: thanked }),
      released({ id: thanked.id, thanksInstead: "thanks all, sorted", ts: "1792000002.000100" }),
      parked({ row: undeclared }),
      released({ id: undeclared.id, ts: "1792000003.000100" }),
    ];
    expect(sharedFindingsOf({ events })).toStrictEqual({ findings: [], undated: [] });
  });

  it("is not owed once released then deleted at the same coordinate; a repost of it stays shared", () => {
    // A finding deleted from its channel and reposted as its own row is still owed.
    const repost = draft({ id: "sd-aa000009", kind: "finding" });
    const events: SlackDraftEvent[] = [
      ...SHARED,
      parked({ row: repost }),
      released({ id: repost.id, ts: "1792000100.000100" }),
      { channel: CHANNEL, id: FINDING.id, kind: "deleted", ts: FINDING_TS, tsIso: "2026-10-14T19:00:00.000Z" },
    ];
    expect(sharedFindingsOf({ events }).findings.map((one) => one.draftId)).toStrictEqual(["sd-aa000009"]);
    expect(
      followupOfRefusals({
        draft: { act: "bump", channel: CHANNEL, followupOf: FINDING.id, threadTs: FINDING_TS },
        events,
        skipped: [],
        supersedes: [],
      }),
    ).toStrictEqual([
      "slack draft record --followup-of sd-aa000001: no released finding carries that id — only a shared finding earns a follow-up card",
    ]);
  });

  it("stays owed when a deletion names the same row at another ts or channel", () => {
    const events: SlackDraftEvent[] = [
      ...SHARED,
      { channel: CHANNEL, id: FINDING.id, kind: "deleted", ts: "1792000000.000999", tsIso: "2026-10-14T19:00:00.000Z" },
      { channel: "C0OTHER", id: FINDING.id, kind: "deleted", ts: FINDING_TS, tsIso: "2026-10-14T19:00:00.000Z" },
    ];
    expect(sharedFindingsOf({ events }).findings.map((one) => one.draftId)).toStrictEqual(["sd-aa000001"]);
  });

  it("names a released finding whose landed ts reads as no instant, rather than dropping it silently", () => {
    const events = [parked({ row: FINDING }), released({ id: FINDING.id, ts: "not-a-ts" })];
    expect(sharedFindingsOf({ events })).toStrictEqual({ findings: [], undated: ["sd-aa000001"] });
  });

  it("orders findings by when they landed, not by register order", () => {
    const later = draft({ id: "sd-aa000006", kind: "finding" });
    const events = [
      parked({ row: later }),
      released({ id: later.id, ts: "1792100000.000100" }),
      parked({ row: FINDING }),
      released({ id: FINDING.id, ts: FINDING_TS }),
    ];
    expect(sharedFindingsOf({ events }).findings.map((one) => one.draftId)).toStrictEqual([
      "sd-aa000001",
      "sd-aa000006",
    ]);
  });
});

describe("followupsSpending", () => {
  it("counts every row parked naming the finding, released or held, and no other row", () => {
    const events = [
      parked({ row: draft({ followupOf: FINDING.id, id: "sd-bb000001" }) }),
      parked({ row: draft({ followupOf: FINDING.id, id: "sd-bb000002" }) }),
      released({ id: "sd-bb000002", threadTs: FINDING_TS, ts: "1792000005.000100" }),
      parked({ row: draft({ followupOf: "sd-ffffffff", id: "sd-bb000004" }) }),
      parked({ row: draft({ id: "sd-bb000005" }) }),
    ];
    expect(followupsSpending({ events, findingId: FINDING.id, supersedes: [] })).toStrictEqual([
      "sd-bb000001",
      "sd-bb000002",
    ]);
  });

  it("hands the card on through a re-cut: a superseded row spends nothing, recorded or in progress", () => {
    const events: SlackDraftEvent[] = [
      parked({ row: draft({ followupOf: FINDING.id, id: "sd-bb000001" }) }),
      parked({ row: draft({ followupOf: FINDING.id, id: "sd-bb000002", recuts: ["sd-bb000001"] }) }),
      { id: "sd-bb000001", kind: "dropped", note: "re-cut by sd-bb000002", tsIso: "2026-10-15T00:00:00.000Z" },
    ];
    expect(followupsSpending({ events, findingId: FINDING.id, supersedes: [] })).toStrictEqual(["sd-bb000002"]);
    expect(followupsSpending({ events, findingId: FINDING.id, supersedes: ["sd-bb000002"] })).toStrictEqual([]);
  });

  it("keeps both cards spent when a re-cut parked but its drop never landed", () => {
    const events = [
      parked({ row: draft({ followupOf: FINDING.id, id: "sd-bb000001" }) }),
      parked({ row: draft({ followupOf: FINDING.id, id: "sd-bb000002", recuts: ["sd-bb000001"] }) }),
    ];
    expect(followupsSpending({ events, findingId: FINDING.id, supersedes: [] })).toStrictEqual([
      "sd-bb000001",
      "sd-bb000002",
    ]);
  });

  it("keeps the card spent through a re-cut that dropped --followup-of", () => {
    const events = [
      parked({ row: draft({ followupOf: FINDING.id, id: "sd-bb000001" }) }),
      parked({ row: draft({ id: "sd-bb000002", recuts: ["sd-bb000001"] }) }),
    ];
    expect(followupsSpending({ events, findingId: FINDING.id, supersedes: [] })).toStrictEqual(["sd-bb000001"]);
  });
});

describe("rivalFollowupOf", () => {
  const card = ({ id }: { id: string }): ParkedSlackDraft => draft({ followupOf: FINDING.id, id });
  const held = { draft: card({ id: "sd-bb000002" }), id: "sd-bb000002", state: "held" as const };
  const other = {
    draft: draft({ followupOf: "sd-ffffffff", id: "sd-bb000003" }),
    id: "sd-bb000003",
    state: "released" as const,
  };

  it("names the card already sent for the same finding", () => {
    const sent = { draft: card({ id: "sd-bb000001" }), id: "sd-bb000001", state: "released" as const };
    expect(rivalFollowupOf({ items: [sent, held, other], row: held })?.id).toBe("sd-bb000001");
  });

  // Two held cards for one finding each refuse the other, so two releases racing past each other's read
  // both stop.
  it("names a second card held for the same finding, from either side", () => {
    const twin = { draft: card({ id: "sd-bb000004" }), id: "sd-bb000004", state: "held" as const };
    expect(rivalFollowupOf({ items: [held, twin], row: held })?.id).toBe("sd-bb000004");
    expect(rivalFollowupOf({ items: [held, twin], row: twin })?.id).toBe("sd-bb000002");
  });

  it("names nothing for a dropped card, another finding's card, or a row that follows up nothing", () => {
    const dropped = { draft: card({ id: "sd-bb000005" }), id: "sd-bb000005", state: "dropped" as const };
    expect(rivalFollowupOf({ items: [dropped, held, other], row: held })).toBeUndefined();
    expect(rivalFollowupOf({ items: [held], row: { draft: FINDING, id: FINDING.id, state: "held" } })).toBeUndefined();
  });
});

describe("followupOfRefusals", () => {
  const bump = {
    act: "bump" as const,
    channel: CHANNEL,
    followupOf: FINDING.id,
    threadTs: FINDING_TS,
  };

  it("lets a bump into the finding's own thread park when its card is unspent", () => {
    expect(followupOfRefusals({ draft: bump, events: SHARED, skipped: [], supersedes: [] })).toStrictEqual([]);
  });

  it("asks nothing of a row that names no finding, whatever the register could not read", () => {
    expect(
      followupOfRefusals({
        draft: { act: "reply", channel: "C0OTHER", threadTs: undefined },
        events: [],
        skipped: [{ id: undefined, kind: undefined, line: 1 }],
        supersedes: [],
      }),
    ).toStrictEqual([]);
  });

  it("refuses a finding that was never shared", () => {
    expect(
      followupOfRefusals({ draft: bump, events: [parked({ row: FINDING })], skipped: [], supersedes: [] }),
    ).toStrictEqual([
      "slack draft record --followup-of sd-aa000001: no released finding carries that id — only a shared finding earns a follow-up card",
    ]);
  });

  it("refuses a reply, and a bump aimed anywhere but the finding's own thread, naming where it goes", () => {
    const refusals = followupOfRefusals({
      draft: { ...bump, act: "reply", threadTs: "1792000009.000100" },
      events: SHARED,
      skipped: [],
      supersedes: [],
    });
    expect(refusals).toStrictEqual([
      "slack draft record --followup-of sd-aa000001: a follow-up card is a bump, so it needs --act bump",
      `slack draft record --followup-of sd-aa000001: the follow-up lands in the finding's own thread — --channel ${CHANNEL} --thread-ts ${FINDING_TS}`,
    ]);
  });

  it("refuses a second card once one was cut, and allows the re-cut of the held one", () => {
    const events = [...SHARED, parked({ row: draft({ followupOf: FINDING.id, id: "sd-bb000001" }) })];
    expect(followupOfRefusals({ draft: bump, events, skipped: [], supersedes: [] })).toStrictEqual([
      "slack draft record --followup-of sd-aa000001: that finding's one follow-up card is already spent by sd-bb000001 — held, sent or dropped, it was the owner's to decide once; re-cut it with --supersedes while it is held",
    ]);
    expect(followupOfRefusals({ draft: bump, events, skipped: [], supersedes: ["sd-bb000001"] })).toStrictEqual([]);
  });

  // A line this version cannot read hides its `followupOf`, so it may be this finding's spent
  // card — a later version's park declaring a kind this one has never heard of included.
  it("refuses while any register line did not read, whatever kind it declares", () => {
    const skipped = [
      { id: "sd-bb000001", kind: "parked", line: 3 },
      { id: undefined, kind: undefined, line: 5 },
      { id: "sd-cc000001", kind: "parked-v2", line: 6 },
    ];
    expect(followupOfRefusals({ draft: bump, events: SHARED, skipped, supersedes: [] })).toStrictEqual([
      "slack draft record --followup-of sd-aa000001: 3 draft register line(s) (line 3, line 5, line 6) did not read and may be this finding's follow-up card — nothing parks until they read",
    ]);
  });
});
