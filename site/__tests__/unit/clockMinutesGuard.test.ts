/*
 * The guard that keeps the voice from picking a number for the owner's clock: a length stands only when the owner's
 * newest words say it.
 */
import { describe, expect, it } from "vitest";

import {
  CLOCK_MINUTES_MALFORMED,
  CLOCK_MINUTES_NOT_SAID,
  heardClockMinutes,
  minuteSpellings,
  ownerMinutesOf,
  spokenMinutes,
} from "../../lib/clockMinutesGuard";
import type { GateEntry } from "../../lib/relayGate";
import { TRIAGE_ASK_WINDOW } from "../../lib/triageAskGuard";

/**
 * A relay-gate record of the owner saying each line, in order.
 *
 * @param lines what the owner was heard saying
 * @returns the record
 */
function heard({ lines }: { lines: readonly string[] }): readonly GateEntry[] {
  return lines.map((text) => ({ kind: "heard" as const, text }));
}

describe("minuteSpellings", () => {
  it("spells a small number as its digits and its word", () => {
    expect(minuteSpellings({ minutes: 5 })).toEqual(["5", "five"]);
  });

  it("spells a round ten as its digits and its tens word", () => {
    expect(minuteSpellings({ minutes: 40 })).toEqual(["40", "forty"]);
  });

  it("spells a compound number hyphenated and spaced", () => {
    expect(minuteSpellings({ minutes: 25 })).toEqual(["25", "twenty-five", "twenty five"]);
  });

  it("adds the phrases that name a length without a number", () => {
    expect([minuteSpellings({ minutes: 15 }), minuteSpellings({ minutes: 30 })]).toEqual([
      ["15", "fifteen", "quarter of an hour", "quarter hour"],
      ["30", "thirty", "half an hour", "half hour"],
    ]);
  });

  it("spells a length in hours", () => {
    expect([minuteSpellings({ minutes: 60 }), minuteSpellings({ minutes: 90 })]).toEqual([
      ["60", "sixty", "1 hour", "1 hours", "one hour", "one hours", "an hour"],
      ["90", "ninety", "1 and a half hours", "one and a half hours", "an hour and a half", "hour and a half"],
    ]);
  });

  // Review pass two's counterexample: a length of a hundred minutes or more had no words, so "one hundred minutes" was
  // refused and the "ten" of "one hundred and ten" passed alone.
  it("spells a length of a hundred minutes or more in words", () => {
    expect([minuteSpellings({ minutes: 100 }), minuteSpellings({ minutes: 120 })]).toEqual([
      ["100", "one hundred", "a hundred"],
      [
        "120",
        "one hundred and twenty",
        "one hundred twenty",
        "a hundred and twenty",
        "a hundred twenty",
        "2 hour",
        "2 hours",
        "two hour",
        "two hours",
      ],
    ]);
  });
});

describe("heardClockMinutes", () => {
  it("hears a length said as a word", () => {
    expect(heardClockMinutes({ log: heard({ lines: ["Ten on this one."] }), minutes: 10 })).toBe(true);
  });

  it("hears a length said as digits or as a phrase", () => {
    expect([
      heardClockMinutes({ log: heard({ lines: ["give me 20 minutes for the Queue"] }), minutes: 20 }),
      heardClockMinutes({ log: heard({ lines: ["half an hour on the briefing"] }), minutes: 30 }),
    ]).toEqual([true, true]);
  });

  it("never hears a number inside a longer word or number", () => {
    expect([
      heardClockMinutes({ log: heard({ lines: ["I often skip this one"] }), minutes: 10 }),
      heardClockMinutes({ log: heard({ lines: ["there are 100 cards"] }), minutes: 10 }),
      heardClockMinutes({ log: heard({ lines: ["twenty-five on this"] }), minutes: 5 }),
    ]).toEqual([false, false, false]);
  });

  // Review pass one's counterexample: "an hour" inside "half an hour" let the voice arm sixty minutes on thirty.
  it("never hears a shorter length inside a longer one the owner said", () => {
    const said = ({ words, minutes }: { words: string; minutes: number }): boolean =>
      heardClockMinutes({ log: heard({ lines: [words] }), minutes });
    expect([
      said({ minutes: 60, words: "half an hour on this one" }),
      said({ minutes: 30, words: "half an hour on this one" }),
      said({ minutes: 60, words: "a quarter of an hour" }),
      said({ minutes: 60, words: "an hour and a half" }),
      said({ minutes: 90, words: "an hour and a half" }),
      said({ minutes: 5, words: "twenty five on this" }),
      said({ minutes: 20, words: "twenty five on this" }),
      said({ minutes: 25, words: "twenty five on this" }),
      said({ minutes: 2, words: "two hours" }),
      said({ minutes: 1, words: "one hour" }),
    ]).toEqual([false, true, false, false, true, false, false, true, false, false]);
  });

  // Review pass two's counterexamples, and the same shape past the clock's cap: a longer length's last word never passes.
  it("hears a length of a hundred minutes or more whole, and never its last word", () => {
    const said = ({ words, minutes }: { words: string; minutes: number }): boolean =>
      heardClockMinutes({ log: heard({ lines: [words] }), minutes });
    expect([
      said({ minutes: 100, words: "one hundred minutes on this one" }),
      said({ minutes: 110, words: "give me one hundred and ten minutes" }),
      said({ minutes: 10, words: "give me one hundred and ten minutes" }),
      said({ minutes: 1, words: "give me one hundred and ten minutes" }),
      said({ minutes: 110, words: "a hundred ten on this" }),
      said({ minutes: 50, words: "one hundred and fifty minutes" }),
      said({ minutes: 3, words: "three hours on this" }),
      said({ minutes: 2, words: "2 hours" }),
      said({ minutes: 120, words: "2 hours" }),
      said({ minutes: 60, words: "1 hour and a half" }),
      said({ minutes: 90, words: "1 hour and a half" }),
      said({ minutes: 90, words: "one and a half hours" }),
      said({ minutes: 25, words: "twenty five hours" }),
      said({ minutes: 110, words: "a hundred and ten hours" }),
    ]).toEqual([true, true, false, false, true, false, false, false, true, false, true, true, false, false]);
  });

  it("hears every separate length the owner said", () => {
    expect([...spokenMinutes({ text: "ten cards left, give me five on this" })].toSorted((a, b) => a - b)).toEqual([
      5, 10,
    ]);
  });

  it("hears nothing the owner did not say", () => {
    expect([
      heardClockMinutes({ log: heard({ lines: ["give me a minute"] }), minutes: 5 }),
      heardClockMinutes({ log: [], minutes: 2 }),
    ]).toEqual([false, false]);
  });

  it("reads only the owner's newest words", () => {
    const older = `ten on this one ${"x".repeat(TRIAGE_ASK_WINDOW)}`;
    expect(heardClockMinutes({ log: heard({ lines: [older, " next card"] }), minutes: 10 })).toBe(false);
  });
});

describe("ownerMinutesOf", () => {
  const log = heard({ lines: ["ten on this one"] });

  it("takes no length as the card's own default", () => {
    expect(ownerMinutesOf({ args: {}, log })).toEqual({ kind: "named", minutes: undefined });
  });

  it("takes a length the owner said", () => {
    expect(ownerMinutesOf({ args: { minutes: 10 }, log })).toEqual({ kind: "named", minutes: 10 });
  });

  it("refuses a length the owner did not say", () => {
    expect(ownerMinutesOf({ args: { minutes: 5 }, log })).toEqual({ kind: "refused", why: CLOCK_MINUTES_NOT_SAID });
  });

  it("refuses a length that is not a whole number from 1 to 120, even one the owner said", () => {
    expect([
      ownerMinutesOf({ args: { minutes: 0 }, log: heard({ lines: ["zero"] }) }),
      ownerMinutesOf({ args: { minutes: 121 }, log: heard({ lines: ["121"] }) }),
      ownerMinutesOf({ args: { minutes: 2.5 }, log: heard({ lines: ["2.5"] }) }),
      ownerMinutesOf({ args: { minutes: "10" }, log }),
    ]).toEqual([
      { kind: "refused", why: CLOCK_MINUTES_MALFORMED },
      { kind: "refused", why: CLOCK_MINUTES_MALFORMED },
      { kind: "refused", why: CLOCK_MINUTES_MALFORMED },
      { kind: "refused", why: CLOCK_MINUTES_MALFORMED },
    ]);
    expect(CLOCK_MINUTES_MALFORMED).toBe("minutes must be a whole number from 1 to 120");
  });
});
