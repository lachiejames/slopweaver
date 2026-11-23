import { describe, expect, it } from "vitest";

import { cardClockLines } from "../../../../../cli/commands/turn/dispatchInitial.js";
import { tickerStartCommand } from "../../../../../cli/commands/turn/tickerOwner.js";

const START = { briefPath: "/h/briefs/C1-1.json", home: "/h", launcher: "/repo/bin/slopweaver" };

describe("tickerStartCommand", () => {
  it("backgrounds the resolved launcher's ticker with a bare &", () => {
    expect(tickerStartCommand(START)).toBe('"/repo/bin/slopweaver" turn watch --brief /h/briefs/C1-1.json --home /h &');
  });
});

describe("cardClockLines", () => {
  it("opens the inline handoff with the ticker", () => {
    expect(cardClockLines({ ...START, tier: "inline" })).toEqual([
      "inline — FIRST, start this card's clock ONCE, backgrounded with a bare & (it keeps the card saying how long the reader has waited, and stops itself once the ask is answered):",
      '  "/repo/bin/slopweaver" turn watch --brief /h/briefs/C1-1.json --home /h &',
    ]);
  });

  it("opens the read-only-subagent handoff with the same ticker", () => {
    expect(cardClockLines({ ...START, tier: "read-only-subagent" })[1]).toBe(
      '  "/repo/bin/slopweaver" turn watch --brief /h/briefs/C1-1.json --home /h &',
    );
  });
});
