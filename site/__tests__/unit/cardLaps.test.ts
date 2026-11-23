/*
 * A Queue card's laps on the page: the strict reader of `talk laps --json`, and the line a steered card carries.
 */
import { describe, expect, it } from "vitest";

import { readCardLaps } from "../../components/live/readCardLaps";
import { cardLapsFor, lapsLine } from "../../lib/cardLaps";

/** One quoted word as the verb writes it. */
const word = ({ anchor, text }: { anchor: string; text: string }) => ({
  anchor,
  atIso: "2026-10-04T10:00:00.000Z",
  chars: text.length,
  source: "call",
  text,
});

/** One card as the verb writes it: two looks, one fleet lap, unless overridden. */
const card = (over: Record<string, unknown> = {}) => ({
  firstIso: "2026-10-04T10:00:00.000Z",
  fleetLaps: 1,
  key: "hand:two",
  keys: ["hand:one", "hand:two"],
  laps: 1,
  last: [word({ anchor: "b", text: "ship it" })],
  lastIso: "2026-10-04T12:00:00.000Z",
  lastLookChars: 7,
  looks: 2,
  steeringChars: 18,
  steers: [
    {
      awayMs: 7_200_000,
      cause: "fleet",
      startIso: "2026-10-04T10:00:00.000Z",
      words: [word({ anchor: "a", text: "the title is wrong" })],
    },
  ],
  worldLaps: 0,
  ...over,
});

/** The verb's whole payload. */
const payload = (over: Record<string, unknown> = {}) => ({
  cards: [card()],
  gaps: [],
  observedAtIso: "2026-10-05T00:00:00.000Z",
  ok: true,
  sinceIso: "2026-09-21T00:00:00.000Z",
  unplaced: { call: 2, chair: 1, relay: 0, typed: 0 },
  ...over,
});

describe("readCardLaps", () => {
  it("reads the verb's shape, summing what named no card", () => {
    const reading = readCardLaps(payload())!;
    expect([reading.sinceIso, reading.unplaced, reading.gaps, reading.cards.length]).toEqual([
      "2026-09-21T00:00:00.000Z",
      3,
      [],
      1,
    ]);
    expect(reading.cards[0].steers[0].words).toEqual([
      { anchor: "a", atIso: "2026-10-04T10:00:00.000Z", text: "the title is wrong" },
    ]);
  });

  it("refuses a card carrying a key the verb never writes", () => {
    expect(readCardLaps(payload({ cards: [card({ approved: true })] }))).toBe(undefined);
  });

  it("refuses a card whose counts disagree with its laps", () => {
    expect(readCardLaps(payload({ cards: [card({ laps: 2 })] }))).toBe(undefined);
    expect(readCardLaps(payload({ cards: [card({ fleetLaps: 0 })] }))).toBe(undefined);
  });

  it("refuses a card whose fleet and world counts sum right but name the other lap's cause", () => {
    // The line would say one fleet lap while the fold heads the same lap the world's.
    expect(readCardLaps(payload({ cards: [card({ fleetLaps: 0, worldLaps: 1 })] }))).toBe(undefined);
  });

  it("refuses a card with no latest look, and one whose key is not the newest it carried", () => {
    expect(readCardLaps(payload({ cards: [card({ last: [] })] }))).toBe(undefined);
    expect(readCardLaps(payload({ cards: [card({ key: "hand:one" })] }))).toBe(undefined);
  });

  it("refuses a reading the verb did not mark ok, and one with a source it does not name", () => {
    expect(readCardLaps(payload({ ok: false }))).toBe(undefined);
    expect(readCardLaps(payload({ unplaced: { call: 0, chair: 0, relay: 0, slack: 1, typed: 0 } }))).toBe(undefined);
  });

  it("carries each gap's reason", () => {
    expect(readCardLaps(payload({ gaps: [{ source: "calls", why: "a line did not parse" }] }))!.gaps).toEqual([
      "a line did not parse",
    ]);
  });
});

describe("cardLapsFor and lapsLine", () => {
  const reading = readCardLaps(payload())!;

  it("finds a re-cut card by its predecessor's key and says its laps and whose", () => {
    expect(lapsLine({ card: cardLapsFor({ key: "hand:one", reading })! })).toBe("1 lap(s) so far: 1 fleet, 0 world");
  });

  it("draws no line for a card looked at once, and finds no card the owner never spoke on", () => {
    const once = readCardLaps(payload({ cards: [card({ fleetLaps: 0, laps: 0, steers: [] })] }))!;
    expect(lapsLine({ card: cardLapsFor({ key: "hand:two", reading: once })! })).toBe(undefined);
    expect(cardLapsFor({ key: "pr:1", reading })).toBe(undefined);
  });
});
