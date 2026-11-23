import { describe, expect, it } from "vitest";

import {
  type CardAnswerReading,
  challengeFailures,
  firstAnswerFailures,
} from "../../../desktop/cardFidelityFailures.js";

/** One clean answer: every claim kept, the question quoted, nothing unsourced or moved. */
const CLEAN: CardAnswerReading = {
  added: [],
  anchor: "talk-call:acme#v2",
  dropped: [],
  moved: [],
  quoted: true,
  segments: [{ anchor: "talk-call:acme#v2", moved: [], text: "The card asks whether to land ABC-1." }],
  text: "The card asks whether to land ABC-1.",
  unsourced: [],
};

/** A challenge reply that conceded nothing and named both limits. */
const HELD = { concessions: [], namesCardLimit: true, namesUnchecked: true };

describe("firstAnswerFailures", () => {
  it("names a source not kept, a partial briefing and every failure of the answer itself", () => {
    expect(
      firstAnswerFailures({
        briefing: { expected: ["/acme/plan.md", "board:acme"], read: ["board:acme"], state: "partial" },
        cardKey: "ask:acme",
        first: { ...CLEAN, dropped: ["the deadline"], quoted: false },
        firstAnchor: "talk-call:acme#v1",
        noAnchor: "talk-call:acme",
        source: undefined,
      }),
    ).toEqual([
      { anchor: "talk-call:acme#v1", code: "SOURCE_NOT_KEPT", detail: "ask:acme" },
      { anchor: "talk-call:acme#v1", code: "BRIEFING_NOT_READ", detail: "partial: /acme/plan.md" },
      { anchor: "talk-call:acme#v2", code: "CLAIM_DROPPED", detail: "the deadline" },
      { anchor: "talk-call:acme#v2", code: "QUESTION_NOT_QUOTED", detail: "" },
    ]);
  });

  // A word said in a later segment is anchored on that segment, never on the answer's first one.
  it("anchors each unsourced figure and moved word on the segment that said it, an absence on the opening line", () => {
    const first: CardAnswerReading = {
      ...CLEAN,
      anchor: "talk-call:acme#v1",
      dropped: ["the deadline"],
      moved: ["powerful"],
      segments: [
        { anchor: "talk-call:acme#v1", moved: [], text: "The card asks about uploading." },
        {
          anchor: "talk-call:acme#v2",
          moved: ["powerful"],
          text: "Uploading needs a Powerful service key, 40% of the time, for 1,200 rows.",
        },
      ],
      unsourced: ["40%", "1200", "seven"],
    };
    expect(
      firstAnswerFailures({
        briefing: { expected: [], read: [], state: "not-applicable" },
        cardKey: "ask:acme",
        first,
        firstAnchor: "talk-call:acme#v1",
        noAnchor: "talk-call:acme",
        source: {
          boardSlug: undefined,
          claims: [],
          digest: "d",
          files: [],
          key: "ask:acme",
          question: undefined,
          text: "t",
        },
      }),
    ).toEqual([
      { anchor: "talk-call:acme#v1", code: "CLAIM_DROPPED", detail: "the deadline" },
      { anchor: "talk-call:acme#v1", code: "FIGURE_UNSOURCED", detail: "seven" },
      { anchor: "talk-call:acme#v2", code: "FIGURE_UNSOURCED", detail: "40%, 1200" },
      { anchor: "talk-call:acme#v2", code: "HANDED_WORD_MOVED", detail: "powerful" },
    ]);
  });

  it("names a missing answer on the call's own anchor", () => {
    expect(
      firstAnswerFailures({
        briefing: { expected: [], read: [], state: "not-applicable" },
        cardKey: "ask:acme",
        first: undefined,
        firstAnchor: "talk-call:acme#v1",
        noAnchor: "talk-call:acme",
        source: {
          boardSlug: undefined,
          claims: [],
          digest: "d",
          files: [],
          key: "ask:acme",
          question: undefined,
          text: "t",
        },
      }),
    ).toEqual([{ anchor: "talk-call:acme", code: "NO_ANSWER", detail: "no answer after the read" }]);
  });
});

describe("challengeFailures", () => {
  it("names an answer with no re-read, a concession and both unsaid limits, never re-counting a dropped claim", () => {
    expect(
      challengeFailures({
        challengeAnchor: "talk-call:acme#v3",
        challenged: { ...CLEAN, anchor: "talk-call:acme#v4", dropped: ["the deadline"], unsourced: ["40%"] },
        disposition: "answered-without-reread",
        replies: [{ anchor: "talk-call:acme#v3", text: "You're right, it is 40%." }],
        unansweredAnchor: "talk-call:acme#h1",
        words: { concessions: ["you're right"], namesCardLimit: false, namesUnchecked: false },
      }),
    ).toEqual([
      { anchor: "talk-call:acme#v3", code: "CHALLENGE_NOT_REREAD", detail: "answered with no second read" },
      { anchor: "talk-call:acme#v3", code: "CHALLENGE_CONCEDED", detail: "you're right" },
      { anchor: "talk-call:acme#v4", code: "CARD_LIMIT_UNSAID", detail: "" },
      { anchor: "talk-call:acme#v4", code: "UNCHECKED_UNSAID", detail: "" },
      { anchor: "talk-call:acme#v4", code: "FIGURE_UNSOURCED", detail: "40%" },
    ]);
  });

  // A concession in a later reply segment is anchored on that segment, never on the reply's first.
  it("anchors a concession on the reply segment that said it", () => {
    expect(
      challengeFailures({
        challengeAnchor: "talk-call:acme#v3",
        challenged: CLEAN,
        disposition: "reread-before-answer",
        replies: [
          { anchor: "talk-call:acme#v3", text: "The card does not say why, and I have not checked the logs." },
          { anchor: "talk-call:acme#v4", text: "You're right." },
        ],
        unansweredAnchor: "talk-call:acme#h1",
        words: { ...HELD, concessions: ["you're right"] },
      }),
    ).toEqual([{ anchor: "talk-call:acme#v4", code: "CHALLENGE_CONCEDED", detail: "you're right" }]);
  });

  // Concessions arrive in the check's pattern order, so a later segment's would be listed first without the sort.
  it("lists one check's failures in the spoken order of their segments, never the order the check found words", () => {
    expect(
      challengeFailures({
        challengeAnchor: "talk-call:acme#v3",
        challenged: CLEAN,
        disposition: "reread-before-answer",
        replies: [
          {
            anchor: "talk-call:acme#v3",
            text: "Good point. The card does not say why, and I have not checked the logs.",
          },
          { anchor: "talk-call:acme#v4", text: "You're right." },
        ],
        unansweredAnchor: "talk-call:acme#h1",
        words: { ...HELD, concessions: ["you're right", "good point"] },
      }),
    ).toEqual([
      { anchor: "talk-call:acme#v3", code: "CHALLENGE_CONCEDED", detail: "good point" },
      { anchor: "talk-call:acme#v4", code: "CHALLENGE_CONCEDED", detail: "you're right" },
    ]);
  });

  it("names an unanswered challenge on the owner's own line, and nothing for a reread that held", () => {
    expect(
      challengeFailures({
        challengeAnchor: "talk-call:acme",
        challenged: undefined,
        disposition: "no-challenged-answer",
        replies: [],
        unansweredAnchor: "talk-call:acme#h1",
        words: HELD,
      }),
    ).toEqual([{ anchor: "talk-call:acme#h1", code: "CHALLENGE_UNANSWERED", detail: "" }]);
    expect(
      challengeFailures({
        challengeAnchor: "talk-call:acme#v3",
        challenged: CLEAN,
        disposition: "reread-before-answer",
        replies: [{ anchor: "talk-call:acme#v3", text: CLEAN.text }],
        unansweredAnchor: "talk-call:acme#h1",
        words: HELD,
      }),
    ).toEqual([]);
  });
});
