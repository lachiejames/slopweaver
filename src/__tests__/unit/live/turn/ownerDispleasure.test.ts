/** Owner displeasure quoting the bot's own words — the addressing shape that is a STOP, not an ask. */
import { describe, expect, it } from "vitest";

import {
  classifyOwnerDispleasure,
  DISPLEASURE_PHRASES,
  ownerDispleasureLines,
} from "../../../../live/turn/ownerDispleasure.js";

/** The incident reply, exactly as the brief carried it — the bot's own sentence, quoted, plus four words. */
const INCIDENT =
  "> the monitors are not deployed ... these charts are a replay of the pr's queries and thresholds over " +
  "real cost data @(UFIXTUREAC) thanks for nothing";

describe("classifyOwnerDispleasure", () => {
  it("fires on the incident's own message, and reports what it matched", () => {
    const fired = classifyOwnerDispleasure({ text: INCIDENT })!;

    expect(fired.phrase).toBe("thanks for nothing");
    expect(fired.quoted).toBe(
      "the monitors are not deployed ... these charts are a replay of the pr's queries and thresholds over " +
        "real cost data @(UFIXTUREAC) thanks for nothing",
    );
  });

  it("does NOT fire on displeasure with no quote — that is usually a real ask", () => {
    expect(classifyOwnerDispleasure({ text: "this is useless, can you check the pool config instead" })).toBe(
      undefined,
    );
  });

  it("does NOT fire on a quote with no displeasure — quoting is ordinary thread convention", () => {
    expect(classifyOwnerDispleasure({ text: "> the pool exhausted at 14:02\ncan you dig into this" })).toBe(undefined);
  });

  it("finds the quote on any line, not only the first", () => {
    const fired = classifyOwnerDispleasure({ text: "hold on\n  > the charts are a replay\nthanks for nothing" })!;

    expect(fired.quoted).toBe("the charts are a replay");
  });

  it("ignores a bare `>` carrying nothing", () => {
    expect(classifyOwnerDispleasure({ text: ">\nthanks for nothing" })).toBe(undefined);
  });

  it("keeps the phrase table small enough to stay a complaint detector rather than a tone detector", () => {
    expect(DISPLEASURE_PHRASES.includes("thanks for nothing")).toBe(true);
    expect(DISPLEASURE_PHRASES.length).toBe(8);
  });
});

describe("ownerDispleasureLines", () => {
  it("leads with the STOP and quotes the evidence back rather than asserting a mood", () => {
    const lines = ownerDispleasureLines({ text: INCIDENT });

    expect(lines[0]).toBe(
      'THIS QUOTES SOMETHING BACK AND SAYS "thanks for nothing" — STOP, do not dispatch an investigation.',
    );
    expect(lines.join("\n")).toContain("Check FIRST whether that line is this bot's own last answer");
  });

  it("renders nothing at all for every other ask, so no other brief grows", () => {
    expect(ownerDispleasureLines({ text: "can you check the staging pool" })).toEqual([]);
  });
});
