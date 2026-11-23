import { describe, expect, it } from "vitest";
import { askBumpVerdict } from "../../../../review/reviewState.js";
import type { SlackMention } from "../../../../review/slackEvidenceTypes.js";
import { CHASE_NOW, mention } from "./fixtures.js";

describe("askBumpVerdict", () => {
  const asked = mention({ atIso: "2026-08-28T00:00:00.000Z", tagged: ["U9"] });

  it("says there is nothing to bump when nobody was asked", () => {
    const verdict = askBumpVerdict({
      asks: [],
      authorLogin: "a",
      bounded: true,
      mentions: [],
      nowIso: CHASE_NOW,
      reviews: [],
      slackIdForLogin: new Map(),
    });
    expect(verdict).toEqual({ kind: "unknown", why: "nobody has been asked, so there is nothing to bump" });
  });

  it("is due after a day of silence over a bounded window", () => {
    const verdict = askBumpVerdict({
      asks: [asked],
      authorLogin: "a",
      bounded: true,
      mentions: [asked],
      nowIso: CHASE_NOW,
      reviews: [],
      slackIdForLogin: new Map(),
    });
    expect(verdict.kind).toBe("due");
  });

  it("is not due when the tagged person answered in Slack", () => {
    const reply = mention({ atIso: "2026-08-28T01:00:00.000Z", authorId: "U9", permalink: "p2" });
    const verdict = askBumpVerdict({
      asks: [asked],
      authorLogin: "a",
      bounded: true,
      mentions: [asked, reply],
      nowIso: CHASE_NOW,
      reviews: [],
      slackIdForLogin: new Map(),
    });
    expect(verdict.kind).toBe("replied");
  });

  it("is not due when the tagged person's GitHub login reviewed after the ask", () => {
    const verdict = askBumpVerdict({
      asks: [asked],
      authorLogin: "a",
      bounded: true,
      mentions: [asked],
      nowIso: CHASE_NOW,
      reviews: [{ commitOid: "x", login: "Jonah", state: "APPROVED", submittedAtIso: "2026-08-29T00:00:00Z" }],
      slackIdForLogin: new Map([["jonah", "U9"]]),
    });
    expect(verdict.kind).toBe("replied");
  });

  it("answers unknown rather than silence when the window cannot carry an absence", () => {
    const verdict = askBumpVerdict({
      asks: [asked],
      authorLogin: "a",
      bounded: false,
      mentions: [asked],
      nowIso: CHASE_NOW,
      reviews: [],
      slackIdForLogin: new Map(),
    });
    expect(verdict).toEqual({
      kind: "unknown",
      why: "could not tell whether they replied: the Slack window cannot carry an absence",
    });
  });

  it("ignores the AUTHOR's own review, which never ends a reviewer's silence", () => {
    const verdict = askBumpVerdict({
      asks: [asked],
      authorLogin: "a",
      bounded: true,
      mentions: [asked],
      nowIso: CHASE_NOW,
      reviews: [{ commitOid: "x", login: "a", state: "COMMENTED", submittedAtIso: "2026-08-29T00:00:00Z" }],
      slackIdForLogin: new Map([["a", "U9"]]),
    });
    expect(verdict.kind).toBe("due");
  });
});

describe("askBumpVerdict and bot reviews", () => {
  it("ignores a CodeRabbit review after the ask, which is not the reviewer answering", () => {
    const asked = mention({ atIso: "2026-08-28T00:00:00.000Z", tagged: ["U9"] });
    const verdict = askBumpVerdict({
      asks: [asked],
      authorLogin: "a",
      bounded: true,
      mentions: [asked],
      nowIso: CHASE_NOW,
      reviews: [{ commitOid: "x", login: "coderabbitai", state: "COMMENTED", submittedAtIso: "2026-08-29T00:00:00Z" }],
      slackIdForLogin: new Map(),
    });
    expect(verdict.kind).toBe("due");
  });
});

describe("askBumpVerdict and a third party's review", () => {
  it("closes the ask on any human review after it, whoever it came from", () => {
    const asked = mention({ atIso: "2026-08-28T00:00:00.000Z", tagged: ["U9"] });
    const verdict = askBumpVerdict({
      asks: [asked],
      authorLogin: "a",
      bounded: true,
      mentions: [asked],
      nowIso: CHASE_NOW,
      reviews: [{ commitOid: "x", login: "reviewer-one", state: "COMMENTED", submittedAtIso: "2026-08-29T00:00:00Z" }],
      slackIdForLogin: new Map([["reviewer-one", "U7"]]),
    });
    expect(verdict.kind).toBe("replied");
  });
});

describe("askBumpVerdict and the one-review-closes-an-ask rule", () => {
  const asked = mention({ atIso: "2026-08-28T00:00:00.000Z", tagged: ["U9", "U7"] });

  it("closes a two-person ask on a review from EITHER of them", () => {
    const verdict = askBumpVerdict({
      asks: [asked],
      authorLogin: "a",
      bounded: true,
      mentions: [asked],
      nowIso: CHASE_NOW,
      reviews: [{ commitOid: "x", login: "reviewer-one", state: "APPROVED", submittedAtIso: "2026-08-29T00:00:00Z" }],
      slackIdForLogin: new Map([["reviewer-one", "U7"]]),
    });
    expect(verdict).toEqual({
      kind: "replied",
      why: "reviewer-one reviewed after the ask, and one landed review closes it",
    });
  });

  it("closes it even when the reviewer is nobody the ask tagged", () => {
    const verdict = askBumpVerdict({
      asks: [asked],
      authorLogin: "a",
      bounded: true,
      mentions: [asked],
      nowIso: CHASE_NOW,
      reviews: [{ commitOid: "x", login: "somebody-else", state: "COMMENTED", submittedAtIso: "2026-08-29T00:00:00Z" }],
      slackIdForLogin: new Map(),
    });
    expect(verdict.kind).toBe("replied");
  });

  it("still reports a bump due when NO human has reviewed since the ask", () => {
    const verdict = askBumpVerdict({
      asks: [asked],
      authorLogin: "a",
      bounded: true,
      mentions: [asked],
      nowIso: CHASE_NOW,
      reviews: [{ commitOid: "x", login: "coderabbitai", state: "APPROVED", submittedAtIso: "2026-08-29T00:00:00Z" }],
      slackIdForLogin: new Map(),
    });
    expect(verdict.kind).toBe("due");
  });
});

describe("askBumpVerdict — only the ask's own conversation can end its silence", () => {
  const asked = mention({
    atIso: "2026-08-28T00:00:00.000Z",
    messageKey: "C1:1.0",
    tagged: ["U9"],
    threadKey: "C1:1.0",
  });
  const verdictWith = ({ later }: { later: SlackMention }): ReturnType<typeof askBumpVerdict> =>
    askBumpVerdict({
      asks: [asked],
      authorLogin: "a",
      bounded: true,
      mentions: [later, asked],
      nowIso: CHASE_NOW,
      reviews: [],
      slackIdForLogin: new Map(),
    });

  it("reads the tagged person's linkless reply in the ask's thread as a reply", () => {
    const banter = mention({
      association: "thread",
      atIso: "2026-08-28T00:14:36.000Z",
      authorId: "U9",
      authorRole: "other-human",
      authoredText: "Good thing Abel Roman is not on this channel. :smile:",
      messageKey: "C1:2.0",
      permalink: "p-banter",
      threadKey: "C1:1.0",
      threadPrKeys: ["o/r#1"],
    });
    expect(verdictWith({ later: banter }).kind).toBe("replied");
  });

  it("ignores the tagged person linking the pull request in another conversation, and stays due", () => {
    const elsewhere = mention({
      atIso: "2026-08-28T01:00:00.000Z",
      authorId: "U9",
      authorRole: "other-human",
      authoredText: "<https://github.com/o/r/pull/1> triggered this unrelated deployment issue",
      messageKey: "C7:5.0",
      permalink: "p-elsewhere",
      threadKey: "C7:5.0",
    });
    expect(verdictWith({ later: elsewhere }).kind).toBe("due");
  });

  it("is unknown, naming the reply, when neither the ask nor its root names this pull request alone", () => {
    const quotedAsk = mention({
      atIso: "2026-08-28T00:00:00.000Z",
      authoredText: "<@U9> pls review this one <https://x.slack.com/archives/C1/p9>",
      messageKey: "C1:1.0",
      quotedPrKeys: ["o/r#1"],
      tagged: ["U9"],
      threadKey: "C1:1.0",
    });
    const reply = mention({
      association: "thread",
      atIso: "2026-08-28T01:00:00.000Z",
      authorId: "U9",
      authorRole: "other-human",
      authoredText: "done",
      messageKey: "C1:3.0",
      permalink: "p-ambiguous",
      threadKey: "C1:1.0",
      threadPrKeys: ["o/r#1", "o/r#2"],
    });
    const verdict = askBumpVerdict({
      asks: [quotedAsk],
      authorLogin: "a",
      bounded: true,
      mentions: [reply, quotedAsk],
      nowIso: CHASE_NOW,
      reviews: [],
      slackIdForLogin: new Map(),
    });
    expect(verdict).toEqual({
      kind: "unknown",
      why: "could not tell whether they replied: they replied in the ask's thread (p-ambiguous), whose root does not name this pull request alone",
    });
  });

  it("is replied when the ask itself links the pull request, whatever else its thread root names", () => {
    const reply = mention({
      association: "thread",
      atIso: "2026-08-28T01:00:00.000Z",
      authorId: "U9",
      authorRole: "other-human",
      authoredText: "on it",
      messageKey: "C1:4.0",
      permalink: "p-answered",
      threadKey: "C1:1.0",
      threadPrKeys: ["o/r#1", "o/r#2"],
    });
    expect(verdictWith({ later: reply }).kind).toBe("replied");
  });
});

describe("askBumpVerdict — a thread reply whose copies disagree", () => {
  it("is unknown rather than replied, because a copy may be about another pull request", () => {
    const asked = mention({ atIso: "2026-08-28T00:00:00.000Z", tagged: ["U9"] });
    const reply = mention({
      association: "thread",
      atIso: "2026-08-28T01:00:00.000Z",
      authorId: "U9",
      authorRole: "other-human",
      authoredText: "on it",
      messageKey: "C1:2.0",
      permalink: "p-copies",
      threadPrKeys: ["o/r#1"],
      versionsDisagree: true,
    });
    const verdict = askBumpVerdict({
      asks: [asked],
      authorLogin: "a",
      bounded: true,
      mentions: [reply, asked],
      nowIso: CHASE_NOW,
      reviews: [],
      slackIdForLogin: new Map(),
    });
    expect(verdict.kind).toBe("unknown");
  });
});
