import { describe, expect, it } from "vitest";

import { slackTaggedDocument } from "../../../../live/slack/taggedDocument.js";
import { renderSlackTaggedText } from "../../../../live/slack/taggedRender.js";
import {
  type OwnerTrail,
  type TaggedCandidate,
  type TaggedCorpusLeg,
  type TaggedLiveLeg,
  UNREAD_NOT_EXPOSED,
} from "../../../../live/slack/taggedTypes.js";

const NOW = "2026-09-30T00:00:00.000Z";
const SINCE = "2026-09-23T00:00:00.000Z";
const EMPTY_TRAIL: OwnerTrail = { byDm: new Map(), byThread: new Map() };

/**
 * One tag, overridable field by field.
 *
 * @param over the fields to change
 * @returns the candidate
 */
const tag = (over: Partial<TaggedCandidate> = {}): TaggedCandidate => ({
  authorId: "U0SYNHUMAN123",
  authorIsHuman: true,
  authorKnown: true,
  authorName: "A Colleague",
  channelId: "C0CHAN1",
  channelName: "dev",
  messageKey: "C0CHAN1:1790001050.000100",
  ownTs: 1790001050.0001,
  permalink: "https://example.slack.com/archives/C0CHAN1/p1790001050000100",
  text: "@Owner can you look",
  threadKey: "C0CHAN1:1790001000.000100",
  tsIso: "2026-09-29T00:00:00.000Z",
  ...over,
});

/**
 * A corpus leg that read.
 *
 * @param candidates its tags
 * @param trail the owner's words
 * @returns the leg
 */
const corpus = ({
  candidates,
  trail = EMPTY_TRAIL,
}: {
  candidates: readonly TaggedCandidate[];
  trail?: OwnerTrail;
}): Extract<TaggedCorpusLeg, { kind: "read" }> => ({
  candidates,
  channelReach: new Map([["C0CHAN1", "2026-09-29T12:00:00.000Z"]]),
  kind: "read",
  newestIso: "2026-09-29T12:00:00.000Z",
  trail,
  unparsed: 0,
});

/**
 * A live leg that read.
 *
 * @param candidates its tags
 * @param trail the owner's words
 * @returns the leg
 */
const live = ({
  candidates,
  trail = EMPTY_TRAIL,
}: {
  candidates: readonly TaggedCandidate[];
  trail?: OwnerTrail;
}): Extract<TaggedLiveLeg, { kind: "read" }> => ({ authorless: 0, candidates, incomplete: [], kind: "read", trail });

/**
 * Build the document over two legs.
 *
 * @param corpusLeg the corpus leg
 * @param liveLeg the live leg
 * @returns the document
 */
const documentOf = ({ corpusLeg, liveLeg }: { corpusLeg: TaggedCorpusLeg; liveLeg: TaggedLiveLeg }) =>
  slackTaggedDocument({
    corpus: corpusLeg,
    live: liveLeg,
    membersProblem: null,
    nowIso: NOW,
    sinceIso: SINCE,
    windowDays: 7,
  });

describe("slackTaggedDocument", () => {
  it("merges one message both legs found into one row marked both, on the message identity", () => {
    const document = documentOf({
      corpusLeg: corpus({ candidates: [tag()] }),
      liveLeg: live({ candidates: [tag({ permalink: "https://live/?thread_ts=1790001000.000100" })] }),
    });
    expect(document.rows.map((row) => [row.source, row.permalink])).toStrictEqual([
      ["both", "https://example.slack.com/archives/C0CHAN1/p1790001050000100"],
    ]);
    expect(document.status).toBe("complete");
  });

  it("reads a tag as answered only when a word of the owner's in its thread is LATER than it", () => {
    const later = documentOf({
      corpusLeg: corpus({
        candidates: [tag()],
        trail: { byDm: new Map(), byThread: new Map([["C0CHAN1:1790001000.000100", 1790001100.0001]]) },
      }),
      liveLeg: { kind: "skipped" },
    });
    const earlier = documentOf({
      corpusLeg: corpus({
        candidates: [tag()],
        trail: { byDm: new Map(), byThread: new Map([["C0CHAN1:1790001000.000100", 1790001010.0001]]) },
      }),
      liveLeg: { kind: "skipped" },
    });
    expect(later.rows[0]!.answered).toBe(true);
    expect(earlier.rows[0]!.answered).toBe(false);
    expect(earlier.counts.unanswered).toBe(1);
  });

  it("reads a DM tag as answered by any later word of the owner's in that conversation", () => {
    const document = documentOf({
      corpusLeg: corpus({
        candidates: [tag({ channelId: "D0SYNDIRECT1", messageKey: "D0SYNDIRECT1:1790001050.000100" })],
        trail: { byDm: new Map([["D0SYNDIRECT1", 1790001200.0001]]), byThread: new Map() },
      }),
      liveLeg: { kind: "skipped" },
    });
    expect([document.rows[0]!.answered, document.rows[0]!.room]).toStrictEqual([true, "a direct message"]);
  });

  it("leaves a live-only tag unknown when no reply was found, and answered when the live trail found one", () => {
    const liveOnly = tag({ messageKey: "C0CHAN2:1790002000.000100", threadKey: "C0CHAN2:1790002000.000100" });
    const unknown = documentOf({ corpusLeg: corpus({ candidates: [] }), liveLeg: live({ candidates: [liveOnly] }) });
    const answered = documentOf({
      corpusLeg: corpus({ candidates: [] }),
      liveLeg: live({
        candidates: [liveOnly],
        trail: { byDm: new Map(), byThread: new Map([["C0CHAN2:1790002000.000100", 1790003000.0001]]) },
      }),
    });
    expect([unknown.rows[0]!.answered, unknown.rows[0]!.source]).toStrictEqual([null, "live"]);
    expect(answered.rows[0]!.answered).toBe(true);
  });

  it("excludes a non-person's tag with its count, and counts a listed author the index does not know", () => {
    const document = documentOf({
      corpusLeg: corpus({
        candidates: [
          tag({ authorIsHuman: false, messageKey: "C0CHAN1:1" }),
          tag({ authorKnown: false, messageKey: "C0CHAN1:2" }),
        ],
      }),
      liveLeg: { kind: "skipped" },
    });
    expect(document.counts).toStrictEqual({ excludedNonHuman: 1, listed: 1, unanswered: 1, unknownAuthors: 1 });
  });

  it("orders rows newest tag first", () => {
    const document = documentOf({
      corpusLeg: corpus({
        candidates: [
          tag({ messageKey: "C0CHAN1:1", permalink: "https://old", tsIso: "2026-09-24T00:00:00.000Z" }),
          tag({ messageKey: "C0CHAN1:2", permalink: "https://new", tsIso: "2026-09-29T00:00:00.000Z" }),
        ],
      }),
      liveLeg: { kind: "skipped" },
    });
    expect(document.rows.map((row) => row.permalink)).toStrictEqual(["https://new", "https://old"]);
  });

  it("opens the residue on unread state not being exposed, on a zero-row document too", () => {
    const document = documentOf({ corpusLeg: corpus({ candidates: [] }), liveLeg: live({ candidates: [] }) });
    expect(document.coverage.residue[0]).toBe(UNREAD_NOT_EXPOSED);
    expect(document.status).toBe("complete");
  });

  it("is incomplete, rows still listed, when the live leg could not run or stopped short", () => {
    const noToken = documentOf({
      corpusLeg: corpus({ candidates: [tag()] }),
      liveLeg: { kind: "unavailable", reason: "no Slack user token in the store" },
    });
    const shortRead = documentOf({
      corpusLeg: corpus({ candidates: [tag()] }),
      liveLeg: { ...live({ candidates: [] }), incomplete: ["<@U0> after:x: read 10 of 12 pages, the bound"] },
    });
    expect([noToken.status, noToken.rows.length, noToken.coverage.live]).toStrictEqual([
      "incomplete",
      1,
      "unavailable",
    ]);
    expect(noToken.coverage.residue).toContain("the live search did not run: no Slack user token in the store");
    expect([shortRead.status, shortRead.coverage.live]).toStrictEqual(["incomplete", "incomplete"]);
  });

  it("is incomplete when the corpus names no newest message, even with the live leg skipped", () => {
    const document = documentOf({
      corpusLeg: { ...corpus({ candidates: [tag()] }), newestIso: undefined },
      liveLeg: { kind: "skipped" },
    });
    expect([document.status, document.coverage.corpusNewestIso]).toStrictEqual(["incomplete", null]);
    expect(document.coverage.residue).toContain(
      "the Slack corpus names no newest message, so how far behind it runs is unknown",
    );
  });

  it("holds a false only up to the run's own instant when --now is earlier than the corpus's newest message", () => {
    const document = slackTaggedDocument({
      corpus: corpus({ candidates: [tag({ tsIso: "2026-09-19T00:00:00.000Z" })] }),
      live: { kind: "skipped" },
      membersProblem: null,
      nowIso: "2026-09-20T00:00:00.000Z",
      sinceIso: "2026-09-13T00:00:00.000Z",
      windowDays: 7,
    });
    expect([document.coverage.answeredThroughIso, document.coverage.corpusNewestIso]).toStrictEqual([
      "2026-09-20T00:00:00.000Z",
      "2026-09-29T12:00:00.000Z",
    ]);
    expect(renderSlackTaggedText({ document })[1]).toContain(
      "no later word from you in the thread up to 2026-09-20T00:00:00.000Z",
    );
  });

  it("is incomplete when any tail of the window went unread with the live search off, complete when it ran", () => {
    const oneMinuteIn: TaggedCorpusLeg = { ...corpus({ candidates: [] }), newestIso: "2026-09-23T00:01:00.000Z" };
    const skipped = documentOf({ corpusLeg: oneMinuteIn, liveLeg: { kind: "skipped" } });
    const searched = documentOf({ corpusLeg: oneMinuteIn, liveLeg: live({ candidates: [] }) });
    expect([skipped.status, searched.status]).toStrictEqual(["incomplete", "complete"]);
    expect(skipped.coverage.residue[1]).toBe(
      "nothing after 2026-09-23T00:01:00.000Z was read — the corpus stops there and the live search did not run — so a tag after it is not listed",
    );
  });

  it("is complete with the live search off only when the corpus reaches the run's own instant", () => {
    const current: TaggedCorpusLeg = { ...corpus({ candidates: [] }), newestIso: NOW };
    expect(documentOf({ corpusLeg: current, liveLeg: { kind: "skipped" } }).status).toBe("complete");
  });

  it("holds a row's false only as far as its own channel was crawled, when that lags the corpus's newest", () => {
    const lagging: TaggedCorpusLeg = {
      ...corpus({ candidates: [tag()] }),
      channelReach: new Map([["C0CHAN1", "2026-09-29T03:00:00.000Z"]]),
    };
    const document = documentOf({ corpusLeg: lagging, liveLeg: live({ candidates: [] }) });
    expect([document.rows[0]!.answeredThroughIso, document.coverage.answeredThroughIso]).toStrictEqual([
      "2026-09-29T03:00:00.000Z",
      "2026-09-29T12:00:00.000Z",
    ]);
    expect(renderSlackTaggedText({ document })[1]).toContain(
      "no later word from you in the thread up to 2026-09-29T03:00:00.000Z",
    );
  });

  it("is incomplete, saying how far a row's false holds is unknown, when its channel records no reach", () => {
    const unreached = corpus({
      candidates: [tag({ channelId: "C0CHAN2", messageKey: "C0CHAN2:1790001050.000100" })],
    });
    const document = documentOf({ corpusLeg: unreached, liveLeg: live({ candidates: [] }) });
    expect([document.status, document.rows[0]!.answered, document.rows[0]!.answeredThroughIso]).toStrictEqual([
      "incomplete",
      false,
      null,
    ]);
    expect(renderSlackTaggedText({ document })[1]).toContain(
      "no later word from you in the thread, though how far this channel was read is unknown",
    );
    expect(document.coverage.residue).toContain(
      '1 listed tag(s) sit in a channel that records no reach of its own, so how far their "no later word" holds is unknown',
    );
  });

  it("is incomplete with zero rows when the corpus records no channel's own crawl cursor at all", () => {
    const document = documentOf({
      corpusLeg: { ...corpus({ candidates: [] }), channelReach: new Map() },
      liveLeg: live({ candidates: [] }),
    });
    expect(document.status).toBe("incomplete");
    expect(document.coverage.residue).toContain(
      "the Slack corpus records no channel's own crawl cursor, so how far any channel was read is unknown",
    );
  });

  it("is incomplete, naming why, when the members index could not tell a person from a bot", () => {
    const document = slackTaggedDocument({
      corpus: corpus({ candidates: [tag()] }),
      live: live({ candidates: [] }),
      membersProblem: "this home holds no Slack members index",
      nowIso: NOW,
      sinceIso: SINCE,
      windowDays: 7,
    });
    expect([document.status, document.rows.length]).toStrictEqual(["incomplete", 1]);
    expect(document.coverage.residue[1]).toBe(
      "this home holds no Slack members index, so a bot's or an app's tag may be listed as a person's",
    );
  });

  it("is unavailable with zero rows when the corpus could not be read, whatever the live leg found", () => {
    const document = documentOf({
      corpusLeg: { kind: "unavailable", reason: "the Slack corpus could not be listed: EACCES" },
      liveLeg: live({ candidates: [tag()] }),
    });
    expect([document.status, document.rows.length, document.coverage.corpusNewestIso]).toStrictEqual([
      "unavailable",
      0,
      null,
    ]);
    expect(document.coverage.residue[1]).toBe("the Slack corpus could not be listed: EACCES");
  });
});

describe("renderSlackTaggedText", () => {
  it("prints one block per row and ends on the residue", () => {
    const document = documentOf({ corpusLeg: corpus({ candidates: [tag()] }), liveLeg: live({ candidates: [] }) });
    const lines = renderSlackTaggedText({ document });
    expect(lines.slice(0, 4)).toStrictEqual([
      "slack tagged: 1 tag(s) of you by a person in the last 7 day(s), newest first (1 with no later word from you, each up to the instant its row names)",
      "2026-09-29T00:00:00.000Z · A Colleague in #dev · no later word from you in the thread up to 2026-09-29T12:00:00.000Z",
      "  @Owner can you look",
      "  https://example.slack.com/archives/C0CHAN1/p1790001050000100",
    ]);
    expect(lines[4]).toBe("residue:");
    expect(lines[5]).toBe(`  - ${UNREAD_NOT_EXPOSED}`);
  });

  it("opens on INCOMPLETE when a leg lost something", () => {
    const document = documentOf({
      corpusLeg: corpus({ candidates: [] }),
      liveLeg: { kind: "unavailable", reason: "no token" },
    });
    expect(renderSlackTaggedText({ document })[0]).toContain("slack tagged: INCOMPLETE");
  });
});
