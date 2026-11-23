import { describe, expect, it } from "vitest";

import { cardSourceOf } from "../../../desktop/cardFidelitySource.js";
import { challengeWords, droppedClaims, questionQuoted, unsourcedFigures } from "../../../desktop/cardFidelityText.js";
import { e2eCallSteps } from "../../../desktop/e2eCallPlan.js";
import {
  cardInventoryOf,
  foreignCallWaitMs,
  inventorySettled,
  legLockStaleMs,
} from "../../../desktop/e2eCardInventory.js";
import { CARD_STEP_IDS, cardReadSteps } from "../../../desktop/e2eCardReadPlan.js";

/** A synthetic hand step, never this install's own. */
const HAND = "hand:acme-sample-step";

describe("cardSourceOf", () => {
  it("reads the claims in the card's order, the board slug and every file named once", () => {
    const answer = JSON.stringify({
      card: {
        boardSlug: "acme-slug",
        key: "ask:acme",
        options: [{ letter: "A", sentence: "Do it" }],
        question: "Ship it?",
        rows: [{ label: "why", value: "It is ready" }],
        what: "  ",
      },
      links: { files: ["/a.md"], pages: [{ file: "/a.md" }, { file: "/b.html" }, {}] },
    });
    const source = cardSourceOf({ answer, cardKey: "ask:acme" })!;
    expect([source.claims, source.boardSlug, source.files, source.question, source.digest.length]).toEqual([
      [
        { label: "question", text: "Ship it?" },
        { label: "option A", text: "Do it" },
        { label: "why", text: "It is ready" },
      ],
      "acme-slug",
      ["/a.md", "/b.html"],
      "Ship it?",
      64,
    ]);
  });

  it("is no source for text that is not JSON, not the card shape, or another card", () => {
    const other = JSON.stringify({ card: { key: "ask:other" }, links: {} });
    expect([
      cardSourceOf({ answer: "not json", cardKey: "ask:acme" }),
      cardSourceOf({ answer: "[1,2]", cardKey: "ask:acme" }),
      cardSourceOf({ answer: other, cardKey: "ask:acme" }),
    ]).toEqual([undefined, undefined, undefined]);
  });

  it("reads absent links as naming nothing", () => {
    const source = cardSourceOf({ answer: JSON.stringify({ card: { key: HAND } }), cardKey: HAND })!;
    expect([source.files, source.claims, source.boardSlug]).toEqual([[], [], undefined]);
  });
});

describe("droppedClaims", () => {
  const claims = [
    { label: "question", text: "Should we rotate the staging key?" },
    { label: "option A", text: "Rotate tonight" },
    { label: "option B", text: "Wait for the vendor" },
    { label: "lean", text: "Prefer tonight" },
  ];

  it("names only a required claim sharing no content word with the answer", () => {
    expect(droppedClaims({ answer: "It asks whether to rotate the staging key tonight.", claims })).toEqual([
      "option B",
    ]);
  });

  it("holds a hand step to its own rows, never its lean or what silence does", () => {
    const rows = [
      { label: "step", text: "Sign in to the vendor console" },
      { label: "if silent", text: "Nothing happens" },
    ];
    expect(droppedClaims({ answer: "You need to do something.", claims: rows })).toEqual(["step"]);
  });
});

describe("questionQuoted", () => {
  it("finds the question word for word through punctuation and case, and is undefined with none", () => {
    expect([
      questionQuoted({
        answer: "It asks — should we ROTATE the staging key?",
        question: "Should we rotate the staging key?",
      }),
      questionQuoted({ answer: "It asks about rotating keys.", question: "Should we rotate the staging key?" }),
      questionQuoted({ answer: "anything", question: undefined }),
    ]).toEqual([true, false, undefined]);
  });
});

describe("unsourcedFigures", () => {
  it("names each figure no source holds, once, reading thousands separators as one number", () => {
    const sources = ['{"count":"1,200 rows","cost":"$40"}', "my budget is 5%"];
    expect(unsourcedFigures({ answer: "About 1200 rows, $40, 5%, 7 days and 7 days.", sources })).toEqual(["7"]);
  });
});

describe("challengeWords", () => {
  it("reads a concession, and the two things a challenged answer must name", () => {
    expect(challengeWords({ answer: "Good point. The card doesn’t say why, and I haven’t checked the logs." })).toEqual(
      {
        concessions: ["good point"],
        namesCardLimit: true,
        namesUnchecked: true,
      },
    );
    expect(challengeWords({ answer: "The card claims the export failed." })).toEqual({
      concessions: [],
      namesCardLimit: false,
      namesUnchecked: false,
    });
  });
});

describe("cardInventoryOf", () => {
  it("keeps each key once, Queue first, and names a key no card scenario takes", () => {
    expect(
      cardInventoryOf({
        alignment: ["act:acme-1", "align:voice-acme", "ask:acme-a"],
        queue: ["ask:acme-a", "pr:12", "recipe:acme", "<bad>"],
      }),
    ).toEqual({ keys: ["ask:acme-a", "pr:12", "act:acme-1", "align:voice-acme"], refused: ["recipe:acme", "<bad>"] });
  });
});

describe("inventorySettled", () => {
  const same = [["ask:a"], ["ask:a"], ["ask:a"]];

  it("settles on three agreeing reads, no fold left and the minimum passed", () => {
    expect(inventorySettled({ elapsedMs: 10_000, foldsLeft: 0, minimumMs: 10_000, reads: same })).toBe(true);
  });

  it("never settles early, over a closed fold, or on reads that still change", () => {
    expect([
      inventorySettled({ elapsedMs: 9999, foldsLeft: 0, minimumMs: 10_000, reads: same }),
      inventorySettled({ elapsedMs: 20_000, foldsLeft: 1, minimumMs: 10_000, reads: same }),
      inventorySettled({ elapsedMs: 20_000, foldsLeft: 0, minimumMs: 10_000, reads: [["ask:a"], ["ask:a"], []] }),
      inventorySettled({ elapsedMs: 20_000, foldsLeft: 0, minimumMs: 10_000, reads: [[], []] }),
    ]).toEqual([false, false, false, false]);
  });
});

describe("the leg's waits", () => {
  const cards = cardReadSteps({
    cardKeys: Array.from({ length: 20 }, (_, n) => `ask:acme-${String(n)}`),
    surfaces: [...CARD_STEP_IDS],
  });

  it("holds the lock past the whole planned leg, never under two hours, and half a day for an inventory", () => {
    expect([
      legLockStaleMs({ inventory: false, steps: [] }),
      legLockStaleMs({ inventory: false, steps: cards }),
      legLockStaleMs({ inventory: true, steps: [] }),
    ]).toEqual([7_200_000, 80 * (300_000 + 600_000), 43_200_000]);
  });

  it("waits out a call of the owner's for half an hour on a card leg, three minutes otherwise", () => {
    expect([
      foreignCallWaitMs({ inventory: false, steps: e2eCallSteps({ holdMinutes: 5 }) }),
      foreignCallWaitMs({ inventory: false, steps: cards }),
      foreignCallWaitMs({ inventory: true, steps: [] }),
    ]).toEqual([180_000, 1_800_000, 1_800_000]);
  });
});
