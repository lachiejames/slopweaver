/**
 * The two question decoders called directly, where `unit/handover/ledger.test.ts` reaches them through
 * `decodeLedgerLine` — which is the caller's view and cannot express the property that matters here.
 *
 * That property is OMISSION: an absent optional field must be missing from the returned object rather than
 * present holding `undefined`, because `handover/rowEvent.ts` compares its own append to what the file
 * parses back to and `JSON.stringify` drops an explicit `undefined` on the way out. `toStrictEqual` is what
 * tells the two apart; `toEqual` passes on either.
 */
import { describe, expect, it } from "vitest";

import { questionEvent, questionPostedEvent } from "../../../handover/questionLineDecode.js";

describe("questionEvent", () => {
  it("carries all three halves of the shape when the line declares them", () => {
    const event = questionEvent({
      atIso: "2026-09-21T14:00:00.000Z",
      payload: {
        lean: "take the schema",
        options: [
          { option: "cap it in the schema", tradeoff: "one more form to keep" },
          { option: "cap it in review", tradeoff: "a reviewer has to catch it" },
        ],
        problem: "the drawer prints a wall",
        question: "how should the fold be capped?",
      },
    });

    expect(event).toStrictEqual({
      atIso: "2026-09-21T14:00:00.000Z",
      kind: "question",
      lean: "take the schema",
      options: [
        { letter: "A", option: "cap it in the schema", tradeoff: "one more form to keep" },
        { letter: "B", option: "cap it in review", tradeoff: "a reviewer has to catch it" },
      ],
      problem: "the drawer prints a wall",
      question: "how should the fold be capped?",
    });
  });

  it("OMITS every absent half, so a free-text line from before the ruling still reads", () => {
    const event = questionEvent({
      atIso: "2026-09-01T00:00:00.000Z",
      payload: { question: "which one?" },
    });

    expect(event).toStrictEqual({ atIso: "2026-09-01T00:00:00.000Z", kind: "question", question: "which one?" });
  });

  it("re-derives each letter by POSITION, so a line carrying the wrong one cannot make two options agree", () => {
    const event = questionEvent({
      atIso: "2026-09-21T14:00:00.000Z",
      payload: {
        options: [
          { letter: "B", option: "cap it in the schema", tradeoff: "one more form" },
          { letter: "B", option: "cap it in review", tradeoff: "a reviewer catches it" },
        ],
        question: "which one?",
      },
    });

    expect(event).toStrictEqual({
      atIso: "2026-09-21T14:00:00.000Z",
      kind: "question",
      options: [
        { letter: "A", option: "cap it in the schema", tradeoff: "one more form" },
        { letter: "B", option: "cap it in review", tradeoff: "a reviewer catches it" },
      ],
      question: "which one?",
    });
  });

  it("drops a member missing its trade-off and re-letters the rest, never leaving a gap at A", () => {
    const event = questionEvent({
      atIso: "2026-09-21T14:00:00.000Z",
      payload: {
        options: [{ option: "no trade-off stated" }, { option: "cap it in review", tradeoff: "a reviewer catches it" }],
        question: "which one?",
      },
    });

    expect(event).toStrictEqual({
      atIso: "2026-09-21T14:00:00.000Z",
      kind: "question",
      options: [{ letter: "A", option: "cap it in review", tradeoff: "a reviewer catches it" }],
      question: "which one?",
    });
  });

  it("omits `options` for a line whose options are not a usable list, rather than carrying an empty one", () => {
    const event = questionEvent({
      atIso: "2026-09-01T00:00:00.000Z",
      payload: { options: "cap it in the schema", question: "which one?" },
    });

    expect(event).toStrictEqual({ atIso: "2026-09-01T00:00:00.000Z", kind: "question", question: "which one?" });
  });
});

describe("questionPostedEvent", () => {
  it("carries the permalink when the line has one", () => {
    const event = questionPostedEvent({
      atIso: "2026-09-21T14:05:00.000Z",
      payload: { channel: "D123", permalink: "https://example.slack.com/p1", question: "which one?", ts: "1.2" },
    });

    expect(event).toStrictEqual({
      atIso: "2026-09-21T14:05:00.000Z",
      channel: "D123",
      kind: "question-posted",
      permalink: "https://example.slack.com/p1",
      question: "which one?",
      ts: "1.2",
    });
  });

  it("OMITS the permalink when the workspace URL would not resolve at post time", () => {
    const event = questionPostedEvent({
      atIso: "2026-09-21T14:05:00.000Z",
      payload: { channel: "D123", question: "which one?", ts: "1.2" },
    });

    expect(event).toStrictEqual({
      atIso: "2026-09-21T14:05:00.000Z",
      channel: "D123",
      kind: "question-posted",
      question: "which one?",
      ts: "1.2",
    });
  });
});

describe("questionEvent — the stakes", () => {
  const SHAPE = {
    lean: "take the schema",
    options: [
      { option: "cap it in the schema", tradeoff: "one more form to keep" },
      { option: "cap it in review", tradeoff: "a reviewer has to catch it" },
    ],
    problem: "the drawer prints a wall",
    question: "how should the fold be capped?",
  };
  const STAKES = {
    blastRadius: "every card",
    risk: "a wall reaches the owner",
    stillReal: "the drawer still prints one",
  };

  it("carries all three stakes when the line declares them", () => {
    const event = questionEvent({ atIso: "2026-09-22T14:00:00.000Z", payload: { ...SHAPE, stakes: STAKES } });

    expect(event).toMatchObject({ kind: "question", stakes: STAKES });
  });

  it("OMITS stakes missing a field rather than holding a half-set a card would print as whole", () => {
    const event = questionEvent({
      atIso: "2026-09-22T14:00:00.000Z",
      payload: { ...SHAPE, stakes: { blastRadius: "every card", risk: "a wall reaches the owner" } },
    });

    expect(Object.keys(event)).not.toContain("stakes");
    expect(Object.keys(event)).toContain("lean");
  });
});
