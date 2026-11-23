/*
 * The laps a Queue card took: the owner's words placed only on the card their record names, split into looks at the
 * half-hour silence, each lap the world's past a 72-hour absence, a re-cut hand step counted as the same card, and
 * the keyword matcher scored where the answer is known rather than trusted.
 */
import { describe, expect, it } from "vitest";

import {
  AWAY_MS,
  calibrateMatcher,
  cardLapsOf,
  type LapCandidate,
  type LapUtterance,
  LOOK_GAP_MS,
  lineageOf,
  looksOf,
  plainWords,
  STEER_CLIP,
  unplacedOf,
} from "../../../talk/cardLaps.js";

const CARD = "ask:collapse-a-steered-card";
const T0 = Date.parse("2026-10-01T00:00:00.000Z");

/** An instant `ms` after T0. */
const at = ({ ms }: { ms: number }): string => new Date(T0 + ms).toISOString();

/** One utterance of the owner's on {@link CARD}, overridable field by field. */
const said = (over: Partial<LapUtterance> = {}): LapUtterance => ({
  anchor: "talk-call:c#s-1",
  atIso: at({ ms: 0 }),
  card: CARD,
  source: "call",
  text: "tighten the summary",
  ...over,
});

const NO_RECUTS: ReadonlyMap<string, string> = new Map();

describe("looksOf", () => {
  it("keeps words inside the half hour in one look and starts another past it", () => {
    const words = [
      { atIso: at({ ms: 0 }) },
      { atIso: at({ ms: LOOK_GAP_MS }) },
      { atIso: at({ ms: 2 * LOOK_GAP_MS + 1 }) },
    ];
    expect(looksOf({ words }).map((look) => look.length)).toEqual([2, 1]);
  });

  it("reads no words as no looks", () => {
    expect(looksOf({ words: [] })).toEqual([]);
  });
});

describe("cardLapsOf", () => {
  it("reads one look as zero laps, its words all in the last look", () => {
    const [card] = cardLapsOf({ successorOf: NO_RECUTS, utterances: [said()] });
    expect(card).toEqual({
      fleetLaps: 0,
      firstIso: at({ ms: 0 }),
      key: CARD,
      keys: [CARD],
      laps: 0,
      last: [
        { anchor: "talk-call:c#s-1", atIso: at({ ms: 0 }), chars: 19, source: "call", text: "tighten the summary" },
      ],
      lastIso: at({ ms: 0 }),
      lastLookChars: 19,
      looks: 1,
      steeringChars: 0,
      steers: [],
      worldLaps: 0,
    });
  });

  it("counts laps as looks less one, the fleet's under the 72-hour absence and the world's at it", () => {
    const utterances = [
      said({ anchor: "a", atIso: at({ ms: 0 }), text: "first" }),
      said({ anchor: "b", atIso: at({ ms: LOOK_GAP_MS + 1 }), text: "second" }),
      said({ anchor: "c", atIso: at({ ms: LOOK_GAP_MS + 1 + AWAY_MS }), text: "third!" }),
    ];
    const [card] = cardLapsOf({ successorOf: NO_RECUTS, utterances });
    expect([card!.looks, card!.laps, card!.fleetLaps, card!.worldLaps]).toEqual([3, 2, 1, 1]);
    expect(card!.steers.map((lap) => [lap.cause, lap.awayMs, lap.words.map((word) => word.anchor)])).toEqual([
      ["fleet", LOOK_GAP_MS + 1, ["a"]],
      ["world", AWAY_MS, ["b"]],
    ]);
    expect([card!.steeringChars, card!.lastLookChars]).toEqual([11, 6]);
  });

  it("quotes a look's call words over the spoken relay that repeats them", () => {
    const utterances = [
      said({ anchor: "call", text: "drop the second line" }),
      said({ anchor: "relay", atIso: at({ ms: 1000 }), source: "relay", text: "drop the second line" }),
    ];
    const [card] = cardLapsOf({ successorOf: NO_RECUTS, utterances });
    expect([card!.last.map((word) => word.anchor), card!.lastLookChars]).toEqual([["call"], 20]);
  });

  it("quotes a relay when the look holds nothing else", () => {
    const [card] = cardLapsOf({ successorOf: NO_RECUTS, utterances: [said({ anchor: "relay", source: "relay" })] });
    expect(card!.last.map((word) => word.anchor)).toEqual(["relay"]);
  });

  it("places nothing a record does not name, and nothing whose instant does not parse", () => {
    const utterances = [said({ card: undefined, source: "chair" }), said({ atIso: "not-an-instant" })];
    expect(cardLapsOf({ successorOf: NO_RECUTS, utterances })).toEqual([]);
  });

  it("counts a re-cut hand step's looks on the card it became, under the newest key", () => {
    const successorOf = new Map([["hand:one", "hand:two"]]);
    const utterances = [
      said({ anchor: "a", card: "hand:one" }),
      said({ anchor: "b", atIso: at({ ms: 2 * LOOK_GAP_MS }), card: "hand:two" }),
    ];
    const cards = cardLapsOf({ successorOf, utterances });
    expect(cards.map((card) => [card.key, card.keys, card.laps])).toEqual([["hand:two", ["hand:one", "hand:two"], 1]]);
  });

  it("keeps every predecessor's key when two hand steps were re-cut into one", () => {
    const successorOf = new Map([
      ["hand:one", "hand:three"],
      ["hand:two", "hand:three"],
    ]);
    const utterances = [
      said({ anchor: "a", card: "hand:one" }),
      said({ anchor: "b", atIso: at({ ms: 2 * LOOK_GAP_MS }), card: "hand:two" }),
    ];
    const cards = cardLapsOf({ successorOf, utterances });
    expect(cards.map((card) => [card.key, card.keys, card.laps])).toEqual([
      ["hand:three", ["hand:one", "hand:two", "hand:three"], 1],
    ]);
  });

  it("clips a quoted word and keeps its whole length", () => {
    const text = "x".repeat(STEER_CLIP + 20);
    const [card] = cardLapsOf({ successorOf: NO_RECUTS, utterances: [said({ text })] });
    expect([card!.last[0]!.text.length, card!.last[0]!.chars]).toEqual([STEER_CLIP, STEER_CLIP + 20]);
  });

  it("orders the most recently looked-at card first", () => {
    const utterances = [said({ card: "pr:1" }), said({ atIso: at({ ms: 5000 }), card: "pr:2" })];
    expect(cardLapsOf({ successorOf: NO_RECUTS, utterances }).map((card) => card.key)).toEqual(["pr:2", "pr:1"]);
  });
});

describe("lineageOf", () => {
  it("walks to the newest key and stops at a cycle rather than looping", () => {
    expect(lineageOf({ key: "hand:a", successorOf: new Map([["hand:a", "hand:b"]]) })).toEqual({
      key: "hand:b",
      keys: ["hand:a", "hand:b"],
    });
    const cycle = new Map([
      ["hand:a", "hand:b"],
      ["hand:b", "hand:a"],
    ]);
    expect(lineageOf({ key: "hand:a", successorOf: cycle })).toEqual({ key: "hand:b", keys: ["hand:a", "hand:b"] });
  });
});

describe("unplacedOf", () => {
  it("counts the words naming no card, per source", () => {
    const utterances = [said(), said({ card: undefined }), said({ card: undefined, source: "chair" })];
    expect(unplacedOf({ utterances })).toEqual({ call: 1, chair: 1, relay: 0, typed: 0 });
  });
});

describe("plainWords", () => {
  it("drops an image placeholder and a paste's tags, keeping the words", () => {
    expect(plainWords({ text: '[Image #2] see <pasted_content id="x">this</pasted_content>' })).toBe("  see  this ");
  });
});

describe("calibrateMatcher", () => {
  // A token counts only when it sits in at most a tenth of the cards AND of the owner's words, so both sides need ten members
  // before a token seen once can count at all; the fillers share nothing with anything.
  const fillerCards: readonly LapCandidate[] = Array.from({ length: 8 }, (_, n) => ({
    bornIso: undefined,
    key: `ask:filler-${String(n)}`,
    text: `fillercard${String(n)}`,
  }));
  const kafka: LapCandidate = {
    bornIso: undefined,
    key: "ask:kafka",
    text: "rebalance kafka consumer partitions zookeeper",
  };
  const gcp: LapCandidate = { bornIso: undefined, key: "ask:gcp", text: "terraform bucket lifecycle retention" };
  const fillerWords = Array.from({ length: 7 }, (_, n) =>
    said({ anchor: `chair-${String(n)}`, card: undefined, source: "chair", text: `fillerword${String(n)}` }),
  );
  const named = [
    // Three of the kafka card's rare tokens, and named as it: a right pick.
    said({ anchor: "right", card: "ask:kafka", text: "kafka consumer partitions" }),
    // Two of the kafka card's, named as the gcp card: a wrong pick, the class that kept matching out of the reading.
    said({ anchor: "wrong", card: "ask:gcp", text: "rebalance zookeeper" }),
    // Named, but not a card the matcher could pick: never scored.
    said({ anchor: "elsewhere", card: "pr:9", text: "terraform bucket" }),
  ];

  it("scores only the words naming a candidate, and counts the right picks at each floor", () => {
    const candidates = [...fillerCards, kafka, gcp];
    expect(calibrateMatcher({ candidates, floors: [2, 3, 4], utterances: [...fillerWords, ...named] })).toEqual({
      named: 2,
      rows: [
        { attributed: 2, correct: 1, floor: 2 },
        { attributed: 1, correct: 1, floor: 3 },
        { attributed: 0, correct: 0, floor: 4 },
      ],
    });
  });

  it("never picks a card raised after the word", () => {
    const candidates = [...fillerCards, { ...kafka, bornIso: at({ ms: 1000 }) }, gcp];
    expect(calibrateMatcher({ candidates, floors: [2], utterances: [...fillerWords, ...named] }).rows).toEqual([
      { attributed: 0, correct: 0, floor: 2 },
    ]);
  });
});
