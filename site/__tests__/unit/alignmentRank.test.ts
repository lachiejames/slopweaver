/*
 * The Alignment page leads with the question one answer would change the most future behaviour for: the ones most
 * likely to improve fleet behaviour, and never a pull request that merged a month ago and was the right call.
 */

import { describe, expect, it } from "vitest";

import { alignmentOrder, answeredLast } from "../../lib/alignmentRank";
import type { CardRulingCandidate, RulingCandidate } from "../../lib/alignmentRules";

/** Stakes the ranking never reads, so one fixed pair stands for every question here. */
const STAKES = { blastRadius: "fixture blast radius", risk: "fixture risk" };

/** A "make it a general ruling?" question over a kind of act, steered on `steered` acts. */
const actRuling = ({ kind, steered }: { kind: string; steered: number }): RulingCandidate => ({
  key: `align:rule-${kind}`,
  kind,
  quotes: [{ acts: steered, dateBasis: "steered", latestIso: "2026-10-01T00:00:00.000Z", words: "fine" }],
  stakes: STAKES,
  steered,
});

/** A "make it a general ruling?" question over a class of card, sent back on `chains` drafts. */
const cardRuling = ({ chains }: { chains: number }): CardRulingCandidate => ({
  feedback: "no-receipts",
  key: "align:rule-card-no-receipts",
  quotes: Array.from({ length: chains }, (_, index) => ({
    atIso: "2026-10-13T02:00:00.000Z",
    draftId: `sd-0000000${String(index)}`,
    words: "no receipts",
  })),
  stakes: STAKES,
});

/** An act a month old, the case the ranking must demote. */
const oldAct = { key: "act:a-1", title: "Was merging the pull request the right call?" };

const ACT_LINE = "Your word records whether this one act was right, and changes that act only.";

describe("alignmentOrder", () => {
  it("puts a general ruling the owner keeps having to give ahead of a month-old act", () => {
    const order = alignmentOrder({
      actRulings: [actRuling({ kind: "github.rebase", steered: 3 })],
      acts: [oldAct],
      answered: [],
      cardRulings: [],
    });
    expect(order).toEqual([
      {
        from: "act-ruling",
        improves:
          "One answer could settle every future “github rebase” act. You have given your word on 3 acts of this kind.",
        key: "align:rule-github.rebase",
        title: "Make your word on “github rebase” a general ruling?",
      },
      { from: "act", improves: ACT_LINE, key: "act:a-1", title: "Was merging the pull request the right call?" },
    ]);
  });

  it("ranks card classes and act kinds together by how often the owner has said it", () => {
    const order = alignmentOrder({
      actRulings: [actRuling({ kind: "merge", steered: 2 }), actRuling({ kind: "rebase", steered: 5 })],
      acts: [],
      answered: [],
      cardRulings: [cardRuling({ chains: 3 })],
    });
    expect(order.map((item) => item.key)).toEqual([
      "align:rule-rebase",
      "align:rule-card-no-receipts",
      "align:rule-merge",
    ]);
    expect(order.filter((item) => item.key === "align:rule-card-no-receipts")).toEqual([
      {
        from: "card-ruling",
        improves: "One answer could hold every card that reaches you to this. You have sent back 3 drafts for it.",
        key: "align:rule-card-no-receipts",
        title: "Make sending back a card that makes a claim with no receipt to check it a general ruling?",
      },
    ]);
  });

  it("keeps an act kind and a card class apart when their keys happen to match", () => {
    const order = alignmentOrder({
      actRulings: [actRuling({ kind: "card-no-receipts", steered: 2 })],
      acts: [],
      answered: [],
      cardRulings: [cardRuling({ chains: 2 })],
    });
    expect(order.map((item) => [item.from, item.key])).toEqual([
      ["card-ruling", "align:rule-card-no-receipts"],
      ["act-ruling", "align:rule-card-no-receipts"],
    ]);
  });

  it("gives a tie to the card class, which governs every card, and then to the key", () => {
    const order = alignmentOrder({
      actRulings: [actRuling({ kind: "zeta", steered: 2 }), actRuling({ kind: "alpha", steered: 2 })],
      acts: [],
      answered: [],
      cardRulings: [cardRuling({ chains: 2 })],
    });
    expect(order.map((item) => item.key)).toEqual([
      "align:rule-card-no-receipts",
      "align:rule-alpha",
      "align:rule-zeta",
    ]);
  });

  it("asks the rulings first and then the acts, the acts in the Queue's order, and no voice question at all", () => {
    const order = alignmentOrder({
      actRulings: [actRuling({ kind: "merge", steered: 2 })],
      acts: [oldAct, { key: "act:b-2", title: "Was rebasing owner/repo#9 the right call?" }],
      answered: [],
      cardRulings: [],
    });
    expect(order.map((item) => [item.key, item.title, item.improves])).toEqual([
      [
        "align:rule-merge",
        "Make your word on “merge” a general ruling?",
        "One answer could settle every future “merge” act. You have given your word on 2 acts of this kind.",
      ],
      ["act:a-1", "Was merging the pull request the right call?", ACT_LINE],
      ["act:b-2", "Was rebasing owner/repo#9 the right call?", ACT_LINE],
    ]);
  });

  it("never leads with a question the owner has answered, so the first act leads once the ruling is answered", () => {
    const order = alignmentOrder({
      actRulings: [actRuling({ kind: "merge", steered: 4 })],
      acts: [oldAct],
      answered: [{ about: "align:rule-merge" }, { about: "align:voice-length" }],
      cardRulings: [],
    });
    expect(order.map((item) => item.key)).toEqual(["act:a-1"]);
  });

  it("names one act in the singular", () => {
    const order = alignmentOrder({
      actRulings: [actRuling({ kind: "merge", steered: 1 })],
      acts: [],
      answered: [],
      cardRulings: [],
    });
    expect(order.map((item) => item.improves)).toEqual([
      "One answer could settle every future “merge” act. You have given your word on 1 act of this kind.",
    ]);
  });

  it("is empty when nothing is asked", () => {
    expect(alignmentOrder({ actRulings: [], acts: [], answered: [], cardRulings: [] })).toEqual([]);
  });
});

describe("answeredLast", () => {
  const items = [{ key: "a" }, { key: "b" }, { key: "c" }, { key: "d" }];

  it("puts what the owner has not answered first, each side in its own order", () => {
    expect(answeredLast({ answered: [{ about: "a" }, { about: "c" }], items })).toEqual([
      { key: "b" },
      { key: "d" },
      { key: "a" },
      { key: "c" },
    ]);
  });

  it("leaves the order as given while the owner's answers have not read", () => {
    expect(answeredLast({ answered: undefined, items })).toEqual(items);
  });
});
