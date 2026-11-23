/*
 * How a queue card's source block says where the card came from: its copy, the owner's words folded under a bears-on line,
 * and the quote every card belonging to a board row carries. Driven through the real readers, so every row is one the
 * page would actually hold.
 */

import { describe, expect, it } from "vitest";

import { readHandSteps } from "../../../components/live/read";
import { belongingRowSource, handSource, sourceForm } from "../../../lib/queueCardSource";
import { sourceBlockCopy } from "../../../lib/sourceBlock";
import { aboutChars, sourceInstant } from "../../../lib/sourceBlockWords";
import { ARCHIVED, ask, askRowOf, boardOf, CALL, QUOTE, SUBJECT, sourceOf, TALK } from "./harness";

describe("the block's copy", () => {
  it("carries a quote whose start the record lost as the words alone, and says where the cut is", () => {
    const copy = sourceBlockCopy({
      source: {
        bearsOn: undefined,
        kind: "words",
        quote: { ...QUOTE, cut: "start", where: "call", words: "the end of it" },
        steers: [],
      },
    });
    expect([copy.words, copy.line]).toEqual([
      { cut: "start", text: "the end of it" },
      "You said this on a console call; the call transcript recorded it at 2026-09-28 06:03Z. The record kept only the end of what you said.",
    ]);
  });

  it("names the card landing, never the call transcript, for words a call: anchor read off a landing", () => {
    const copy = sourceBlockCopy({
      source: { bearsOn: undefined, kind: "words", quote: { ...QUOTE, where: "call-landing" }, steers: [] },
    });
    expect(copy.line).toBe("You said this on a console call at 2026-09-28 06:03Z; the card landing captured it.");
  });

  it("carries a quote cut short at the cap as the words alone, and says the record holds the rest", () => {
    const copy = sourceBlockCopy({
      source: {
        bearsOn: undefined,
        kind: "words",
        quote: { ...QUOTE, cut: "end", where: "call", words: "the start of it" },
        steers: [],
      },
    });
    expect([copy.words, copy.line]).toEqual([
      { cut: "end", text: "the start of it" },
      "You said this on a console call; the call transcript recorded it at 2026-09-28 06:03Z. It is cut short; the record holds the rest.",
    ]);
  });

  it("says typed only where the record proves it", () => {
    const copy = sourceBlockCopy({
      source: { bearsOn: undefined, kind: "words", quote: { ...QUOTE, where: "console-typed" }, steers: [] },
    });
    expect(copy.line).toBe("You typed this to the console voice; the console record relayed it at 2026-09-28 06:03Z.");
  });

  it("dates a session turn as the transcript records it", () => {
    const copy = sourceBlockCopy({
      source: { bearsOn: undefined, kind: "words", quote: { ...QUOTE, where: "session" }, steers: [] },
    });
    expect(copy.line).toBe(
      "You said this in a Claude session at 2026-09-28 06:03Z; the session transcript captured it.",
    );
  });

  it("prints an instant to the minute in UTC, and a non-instant as stored", () => {
    expect([sourceInstant({ iso: "2026-09-28T16:03:54.584+10:00" }), sourceInstant({ iso: "yesterday" })]).toEqual([
      "2026-09-28 06:03Z",
      "yesterday",
    ]);
  });
});

describe("the owner's words fold under a bears-on line", () => {
  const LONG = Array.from(
    { length: 20 },
    (_unused, index) => `Sentence ${String(index + 1)} of what they said about the mirror carrying the evidence files.`,
  ).join(" ");
  const BEARS_ON = "The owner already said the mirror should hold what an auditor opens.";

  it("carries the row's bears-on line onto the ask's own card", () => {
    const row = askRowOf({ fields: { anchor: TALK, bearsOn: BEARS_ON, ownerWords: QUOTE } });
    expect(row.source).toStrictEqual({
      bearsOn: BEARS_ON,
      kind: "words",
      quote: QUOTE,
      steers: [],
      subject: SUBJECT,
    });
  });

  it("drops it on a hand step's card, which asks another question of the same words", () => {
    const rows = boardOf({ rows: [ask({ fields: { anchor: TALK, bearsOn: BEARS_ON, ownerWords: QUOTE } })] }).rows;
    const [step] = readHandSteps([
      {
        id: "steer-the-ask",
        postedBy: "workspace:93",
        postedIso: "2026-09-28T06:20:00.000Z",
        url: "http://localhost:3000/queue?open=ask%3Athe-ask",
        what: "Pick which lands first",
        where: "the queue page",
        witness: "slopweaver hand done steer-the-ask --did 'picked'",
      },
    ])!;
    expect(handSource({ rows, step })).toStrictEqual({
      bearsOn: undefined,
      kind: "words",
      quote: QUOTE,
      steers: [],
      subject: SUBJECT,
    });
  });

  it("folds long words by default, saying their size rounded to the hundred", () => {
    const copy = sourceBlockCopy({
      source: { bearsOn: BEARS_ON, kind: "words", quote: { ...QUOTE, words: LONG }, steers: [] },
    });
    expect(copy.bearsOn).toBe(BEARS_ON);
    expect(copy.fold!.aboutChars).toBe(aboutChars({ chars: LONG.length }));
    expect([copy.fold!.head, copy.fold!.moreBefore, copy.fold!.moreAfter]).toEqual([
      "Sentence 1 of what they said about the mirror carrying the evidence files.",
      false,
      true,
    ]);
    expect(copy.words!.text).toBe(LONG);
  });

  it("leads the fold with the sentence naming the card's subject, never the owner's opening filler", () => {
    const words =
      "Yeah, okay. Uh... so, um, hang on. I want the evidence mirror to hold every file an auditor opens, " +
      `and nothing else. ${LONG}`;
    const copy = sourceBlockCopy({
      source: {
        bearsOn: undefined,
        kind: "words",
        quote: { ...QUOTE, where: "call", words },
        steers: [],
        subject: "Which evidence lands in the auditor mirror?",
      },
    });
    expect([copy.fold!.head, copy.fold!.moreBefore, copy.fold!.moreAfter, copy.words!.text]).toEqual([
      "I want the evidence mirror to hold every file an auditor opens, and nothing else.",
      true,
      true,
      words,
    ]);
  });

  it("draws short words whole, with no fold", () => {
    const copy = sourceBlockCopy({ source: { bearsOn: undefined, kind: "words", quote: QUOTE, steers: [] } });
    expect(copy.fold).toBe(undefined);
  });

  it("keeps the bears-on line, drawn last as why the card is in front of the owner, beside their further steers", () => {
    const steer = { ...QUOTE, anchor: CALL, atIso: "2026-10-03T08:57:21.724Z", where: "call" };
    const source = sourceOf({
      fields: {
        anchor: TALK,
        bearsOn: BEARS_ON,
        ownerWords: QUOTE,
        ownerWordsSteers: [{ index: 1, kind: "held", quote: steer }],
      },
    });
    const copy = sourceBlockCopy({ source });
    expect([copy.words!.text, copy.steers!.placed.map((one) => one.words.text), copy.bearsOn]).toEqual([
      QUOTE.words,
      [QUOTE.words],
      BEARS_ON,
    ]);
  });

  it("rounds a length to the nearest hundred with a separator, never below one hundred", () => {
    expect([1412, 1449, 1450, 38, 0].map((chars) => aboutChars({ chars }))).toEqual([
      "1,400",
      "1,400",
      "1,500",
      "100",
      "100",
    ]);
  });
});

describe("a card belonging to a board row carries a quote of the owner's on every card", () => {
  const OWN = { kind: "unrecorded", origin: "a session parked this draft: a heads-up", steers: [] } as const;
  const EARLIER = { ...QUOTE, anchor: "talk:earlier", atIso: "2026-09-30T01:00:00.000Z", words: "the earlier one" };

  it("reads the owner's words off the row it belongs to, and keeps what it says of itself when it names none", () => {
    const rows = boardOf({ rows: [ask({ fields: { anchor: TALK, bearsOn: "on the ask", ownerWords: QUOTE } })] }).rows;
    expect([
      belongingRowSource({ otherwise: OWN, rows, slug: "the-ask" }),
      belongingRowSource({ otherwise: OWN, rows, slug: undefined }),
    ]).toEqual([{ bearsOn: undefined, kind: "words", quote: QUOTE, steers: [], subject: SUBJECT }, OWN]);
  });

  it("waits on the board read while the board has no reading, and says the row is not read once off the live board", () => {
    expect([
      belongingRowSource({ otherwise: OWN, rows: undefined, slug: "the-ask" }),
      belongingRowSource({ otherwise: OWN, rows: [], slug: "the-ask" }),
    ]).toEqual([
      { kind: "board-pending", steers: [] },
      { kind: "unread", steers: [], why: ARCHIVED },
    ]);
  });

  it("keeps its own origin when the row records nothing more", () => {
    const rows = boardOf({ rows: [ask({ fields: {} })] }).rows;
    expect(belongingRowSource({ otherwise: OWN, rows, slug: "the-ask" })).toEqual({ ...OWN, subject: SUBJECT });
  });

  it("keeps its own origin but carries the row's steers when the row records no more of where it came from", () => {
    const steer = { index: 1, kind: "held", quote: EARLIER } as const;
    const rows = boardOf({ rows: [ask({ fields: { ownerWordsSteers: [steer] } })] }).rows;
    expect(belongingRowSource({ otherwise: OWN, rows, slug: "the-ask" })).toEqual({
      ...OWN,
      steers: [steer],
      subject: SUBJECT,
    });
  });

  it("says a row missing the owner's words aloud, and never refuses the card — a refused card draws no draft", () => {
    const rows = boardOf({ rows: [ask({ fields: { anchor: TALK } })] }).rows;
    const source = belongingRowSource({ otherwise: OWN, rows, slug: "the-ask" });
    expect([source, sourceForm({ source })]).toEqual([
      {
        kind: "unread",
        steers: [],
        subject: SUBJECT,
        why: "no quote is stored on its board row yet, so your words behind it are not on this card",
      },
      { kind: "drawn" },
    ]);
  });

  it("says a row whose stored quote does not read with its own reason beneath the line, never inside it", () => {
    const rows = boardOf({
      rows: [ask({ fields: { anchor: TALK, ownerWords: { ...QUOTE, where: "somewhere" } } })],
    }).rows;
    const source = belongingRowSource({ otherwise: OWN, rows, slug: "the-ask" });
    const copy = sourceBlockCopy({ source });
    expect([source.kind, copy.line, copy.quoted, sourceForm({ source })]).toEqual([
      "unread",
      "Not read yet.",
      [
        {
          lead: "the quote stored on its board row does not read, so your words behind it are not on this card",
          why: "the board published a quote for this row that does not read",
        },
      ],
      { kind: "drawn" },
    ]);
  });
});
