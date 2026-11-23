/*
 * The schema half of the rule that queue cards carry no junk: a card that draws
 * a field its record does not hold is refused, judged against the record rather than against the wording, so a
 * recorded sentence that happens to read like an absence is still drawn.
 */

import { describe, expect, it } from "vitest";

import { type BriefingCardBasis, briefingCardForm } from "../../lib/briefingCardForm";
import { postCard } from "../../lib/postCard";
import { type BriefingCard, foldedText } from "../../lib/queueCard";
import { actCard } from "../../lib/queueCardAct";
import { askCard } from "../../lib/queueCardAsk";
import { draftCard } from "../../lib/queueCardDraft";

/** A record that holds every optional field. */
const ALL_HELD: BriefingCardBasis = { lean: "present", problem: "present", stakes: "present", what: "present" };

/** A record that holds none of them. */
const NONE_HELD: BriefingCardBasis = { lean: "absent", problem: "absent", stakes: "absent", what: "absent" };

/** An ask carrying its whole shape, whose recorded problem opens on words an absence sentence would use. */
const SHAPED_ASK = askCard({
  row: {
    blastRadius: "every ask on the queue",
    commands: [],
    exampleGap: undefined,
    examples: [],
    lean: "Take B.",
    offered: undefined,
    options: [
      { letter: "A", option: "Ship the schema alone", tradeoff: "the card still reads as a paragraph" },
      { letter: "B", option: "Ship both", tradeoff: "one more day" },
    ],
    priority: undefined,
    problem: "No verb states a lean, so every recorded ask reaches the owner as a paragraph to parse.",
    question: "Which half do you want first? The schema or the card.",
    reason: "waiting on the owner",
    risk: "the owner answers a stale card",
    artifactPage: undefined,
    slug: "a-shaped-ask",
    stillReal: "handover list still shows unshaped asks",
    stillRealIso: "2026-09-27T00:00:00.000Z",
    summary: undefined,
    threadUrl: undefined,
  },
});

/** An act recorded before the ledger asked for a plain-words line. */
const BARE_ACT = actCard({
  act: { kind: "kill-stale-process", said: undefined, subject: "state:scratch/du.out", why: "pid 1: orphaned" },
  pulls: [],
});

describe("briefingCardForm", () => {
  it("draws a recorded problem whose words read like an absence, because its record holds it", () => {
    expect(briefingCardForm({ basis: ALL_HELD, card: SHAPED_ASK })).toEqual({ kind: "drawn" });
  });

  it("refuses the same sentence in a lean slot whose record holds no lean, quoting it", () => {
    const card: BriefingCard = { ...BARE_ACT, lean: "No verb states a lean on an act already taken." };
    expect(briefingCardForm({ basis: NONE_HELD, card })).toEqual({
      kind: "refused",
      why: 'This card would draw a lean its record does not hold ("No verb states a lean on an act already taken."), so it is refused rather than drawn.',
    });
  });

  it("draws a card that omits every field its record does not hold", () => {
    expect(briefingCardForm({ basis: NONE_HELD, card: BARE_ACT })).toEqual({ kind: "drawn" });
  });

  it("refuses a problem sentence on a register that records no problem", () => {
    const card: BriefingCard = {
      ...BARE_ACT,
      problem: "Only a recorded ask carries a problem statement; this row comes from a different register.",
    };
    expect(briefingCardForm({ basis: NONE_HELD, card })).toEqual({
      kind: "refused",
      why: 'This card would draw a problem its record does not hold ("Only a recorded ask carries a problem statement; this row comes from a different register."), so it is refused rather than drawn.',
    });
  });

  it("refuses a what on an act whose record carries no plain-words line", () => {
    const card: BriefingCard = { ...BARE_ACT, what: foldedText({ text: "There is no line for this act." }) };
    expect(briefingCardForm({ basis: NONE_HELD, card })).toEqual({
      kind: "refused",
      why: 'This card would draw a what its record does not hold ("There is no line for this act."), so it is refused rather than drawn.',
    });
  });

  it("refuses stakes a record does not state, quoting the risk", () => {
    const card: BriefingCard = { ...BARE_ACT, stakes: { ...SHAPED_ASK.stakes!, risk: "No risk is stated." } };
    expect(briefingCardForm({ basis: NONE_HELD, card })).toEqual({
      kind: "refused",
      why: 'This card would draw a stakes its record does not hold ("No risk is stated."), so it is refused rather than drawn.',
    });
  });

  it("names the first field in drawn order when several are unheld", () => {
    const card: BriefingCard = { ...SHAPED_ASK };
    expect(briefingCardForm({ basis: { ...ALL_HELD, lean: "absent", problem: "absent" }, card })).toEqual({
      kind: "refused",
      why: 'This card would draw a problem its record does not hold ("No verb states a lean, so every recorded ask reaches the owner as a paragraph to parse."), so it is refused rather than drawn.',
    });
  });
});

describe("every briefing builder, over a record holding no optional field", () => {
  it("draws no problem, stakes or lean on an act, a held reply's problem or stakes, or a parked post's", () => {
    const draft = draftCard({
      draft: { askedBy: "U1", channel: "C1", id: "d1", question: "q?", reason: "it names a date" },
    });
    const post = postCard({
      post: {
        act: undefined,
        addressed: "in #dev",
        advisory: [],
        context: undefined,
        people: [],
        digest: "abc",
        id: "sd-1",
        mentions: [],
        parent: undefined,
        receiptsLine: "No receipts named",
        release: { command: "slopweaver slack post --as me --draft sd-1 --approve abc", kind: "send" },
        text: "hi",
        why: "a note",
      },
    });
    const unheld = [BARE_ACT, draft, post].map((card) => [card.problem, card.stakes]);
    expect(unheld).toEqual([
      [undefined, undefined],
      [undefined, undefined],
      [undefined, undefined],
    ]);
    expect([BARE_ACT.what, BARE_ACT.lean, post.lean]).toEqual([undefined, undefined, undefined]);
  });
});
