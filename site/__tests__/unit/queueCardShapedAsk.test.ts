/*
 * The queue's ask card over a SHAPED ask — a row carrying problem, options and a lean — split out of
 * `queueCard.test.ts` by describe block so each file sits under the test-file size cap.
 */

import { describe, expect, it } from "vitest";

import { askCard } from "../../lib/queueCardAsk";

describe("askCard over a SHAPED ask", () => {
  /** A row carrying the whole shape, as `handover list --json` publishes one. */
  const shaped = {
    lean: "Take B: the queue card is what the owner reads first, so the fields have to land there.",
    options: [
      { letter: "A", option: "Ship the schema alone", tradeoff: "the card still reads as a paragraph" },
      { letter: "B", option: "Ship the schema and the card together", tradeoff: "one more day before either lands" },
    ],
    priority: "p1",
    problem: "No verb states a lean, so every recorded ask reaches the owner as a paragraph to parse.",
    question: "Which half do you want first?",
    reason: "waiting on the owner",
    artifactPage: undefined,
    slug: "a-recorded-ask-carries-problem-options-and-a-lean",
    summary: undefined,
    commands: [],
    offered: undefined,
    threadUrl: undefined,
    risk: undefined,
    blastRadius: undefined,
    stillReal: undefined,
    stillRealIso: undefined,
    examples: [],
    exampleGap: undefined,
  };

  it("draws the problem off the row", () => {
    const card = askCard({ row: shaped });
    expect(card.problem).toBe(
      "No verb states a lean, so every recorded ask reaches the owner as a paragraph to parse.",
    );
  });

  // Text on the cards the owner does not read comes off: both lines were the same sentence on every ask, and the
  // owner's reactions never turned on either.
  it("draws no why-you and no if-silent: each was one sentence on every ask", () => {
    const card = askCard({ row: shaped });
    expect([card.whyYou, card.ifSilent]).toEqual([undefined, undefined]);
  });

  it("draws the lean off the row", () => {
    const card = askCard({ row: shaped });
    expect(card.lean).toBe("Take B: the queue card is what the owner reads first, so the fields have to land there.");
  });

  it("draws exactly the RECORDED options, each with its trade-off, and no silence one bolted on", () => {
    const card = askCard({ row: shaped });
    expect(card.options.map((option) => option.letter)).toEqual(["A", "B"]);
    expect(card.options[0].sentence).toBe("Ship the schema alone");
    expect(card.options[0].tradeoff).toBe("the card still reads as a paragraph");
    expect(card.options[1].tradeoff).toBe("one more day before either lands");
  });

  it("routes every recorded option to the supervisor chat, because handover answer is gated elsewhere", () => {
    const card = askCard({ row: shaped });
    expect(card.options.map((option) => option.how)).toEqual([
      { command: undefined, kind: "elsewhere", where: "the supervisor chat" },
      { command: undefined, kind: "elsewhere", where: "the supervisor chat" },
    ]);
  });

  it("letters a full four exactly as the verb recorded them", () => {
    const four = ["A", "B", "C", "D"].map((letter) => ({
      letter,
      option: `Do ${letter}`,
      tradeoff: `it costs ${letter}`,
    }));
    const card = askCard({ row: { ...shaped, options: four } });
    expect(card.options.map((option) => option.letter)).toEqual(["A", "B", "C", "D"]);
  });

  it("draws no problem or lean on an UNSHAPED ask, rather than a sentence saying it has none", () => {
    const card = askCard({ row: { ...shaped, lean: undefined, options: [], problem: undefined } });
    expect([card.problem, card.lean]).toEqual([undefined, undefined]);
  });

  it("draws the verb's own stakes, with the instant the still-real check was confirmed", () => {
    const card = askCard({
      row: {
        ...shaped,
        blastRadius: "every ask on the queue, no teammate",
        risk: "the owner answers a card that no longer describes the problem",
        stillReal: "handover list --json still shows asks with no lean",
        stillRealIso: "2026-09-23T01:00:00.000Z",
      },
    });
    expect(card.stakes).toEqual({
      blastRadius: "every ask on the queue, no teammate",
      checkedIso: "2026-09-23T01:00:00.000Z",
      kind: "stated",
      risk: "the owner answers a card that no longer describes the problem",
      stillReal: "handover list --json still shows asks with no lean",
    });
  });

  it("draws no stakes on an ask shaped before they were required", () => {
    const card = askCard({ row: shaped });
    expect(card.stakes).toBe(undefined);
  });

  it("cites the row's published page FIRST, and once when the question names it too", () => {
    const pageAt = (slug: string): string => `file:///Users/someone/.slopweaver/pages/${slug}/index.html`;
    const published = { slug: "swirls", url: pageAt("swirls") };
    const question = `Which of ${pageAt("rival")} or ${pageAt("swirls")} reads better?`;
    const card = askCard({ row: { ...shaped, artifactPage: published, question } });
    expect(card.pages).toEqual([published, { slug: "rival", url: pageAt("rival") }]);
  });

  it("never draws two stakes of three — a row missing one draws none, not a short card", () => {
    const card = askCard({
      row: { ...shaped, blastRadius: undefined, risk: "r", stillReal: "s", stillRealIso: undefined },
    });
    expect(card.stakes).toBe(undefined);
  });

  it("draws no options on an unshaped ask, leaving the reaction field as the way to answer it", () => {
    const card = askCard({ row: { ...shaped, lean: undefined, options: [], problem: undefined } });
    expect(card.options).toEqual([]);
  });

  // Every open ask carries a concrete second-person scene above its options.
  it("carries the row's one scene into the example slot", () => {
    const scene = "You open the card and see the fleet merged its own fix. Was that the right call?";
    const card = askCard({ row: { ...shaped, examples: [scene] } });
    expect(card.examples).toEqual({ kind: "scenes", scenes: [scene] });
  });

  it("keeps related asks' scenes in the order the card numbers them", () => {
    const card = askCard({ row: { ...shaped, examples: ["You see one. Right?", "You see two. Right?"] } });
    expect(card.examples).toEqual({ kind: "scenes", scenes: ["You see one. Right?", "You see two. Right?"] });
  });

  it("draws the row's own gap line when it recorded one instead of a scene", () => {
    const card = askCard({ row: { ...shaped, exampleGap: "The row names no observed event to build a scene from." } });
    expect(card.examples).toEqual({ kind: "gap", line: "The row names no observed event to build a scene from." });
  });

  it("says plainly that no scene is recorded rather than inventing one, and treats a blank scene as none", () => {
    expect(askCard({ row: shaped }).examples).toEqual({ kind: "unrecorded" });
    expect(askCard({ row: { ...shaped, examples: ["   "] } }).examples).toEqual({ kind: "unrecorded" });
  });

  it("keeps the whole question on the card, so the mark hides nothing", () => {
    const card = askCard({ row: { ...shaped, lean: undefined, options: [], problem: undefined } });
    expect(card.question).toBe("Which half do you want first?");
  });

  // The owner was shown "sign plan-3 in again" with no command and said never to show a hand step without one.
  it("carries an option's own command to your terminal, and only on that option", () => {
    const options = [
      {
        command: "slopweaver claude signin --plan plan-3",
        letter: "A",
        option: "sign plan-3 in again",
        tradeoff: "one browser sign-in by you",
      },
      { letter: "B", option: "leave plan-3 off", tradeoff: "the other plans reach their caps sooner" },
    ];
    const card = askCard({ row: { ...shaped, options } });
    expect(card.options.map((option) => option.how)).toEqual([
      { command: "slopweaver claude signin --plan plan-3", kind: "elsewhere", where: "your terminal" },
      { command: undefined, kind: "elsewhere", where: "the supervisor chat" },
    ]);
  });
});
