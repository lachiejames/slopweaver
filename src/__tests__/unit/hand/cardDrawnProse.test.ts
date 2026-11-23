/*
 * The leaf criterion `hand post`'s machine-id rule and the site lane's parity test both read: which drawn field names
 * a machine id first, and which steps have no card to withhold.
 */
import { describe, expect, it } from "vitest";

import { machineIdInCardProse, machineIdInOpenedAsk } from "../../../hand/cardDrawnProse.js";

/** A step whose every drawn field is clean prose. */
const CLEAN = {
  id: "send-the-reply",
  unblocks: "the reply to the room",
  what: "Pick whether the reply goes today",
  witness: "slopweaver hand done send-the-reply",
} as const;

describe("machineIdInCardProse", () => {
  it("finds nothing in a clean step", () => {
    expect(machineIdInCardProse({ step: CLEAN })).toBe(undefined);
  });

  it("names the field and the id a witness carries", () => {
    const step = { ...CLEAN, witness: "the reply call a0000019 asked for is sent" };
    expect(machineIdInCardProse({ step })).toEqual({ field: "witness", id: "call a0000019" });
  });

  it("names the first drawn field, in the card's order, when two carry an id", () => {
    const step = { ...CLEAN, what: "Answer call a0000019", witness: "run 9f3a1c2e is settled" };
    expect(machineIdInCardProse({ step })).toEqual({ field: "what", id: "call a0000019" });
  });

  it("skips an id inside a URL in prose", () => {
    const step = { ...CLEAN, witness: "https://example.test/call/a0000019 is answered" };
    expect(machineIdInCardProse({ step })).toBe(undefined);
  });

  it("reads nothing on a notice, which is on no Queue", () => {
    const step = { ...CLEAN, notice: true, what: "Answer call a0000019" } as const;
    expect(machineIdInCardProse({ step })).toBe(undefined);
  });
});

/** An opened ask's decision whose every drawn field is clean prose. */
const ASK = {
  lean: "Send it today",
  options: [
    { option: "Send it today", tradeoff: "the room reads it now" },
    { option: "Hold it a day", tradeoff: "the room waits" },
  ],
  blastRadius: "one thread",
  problem: "the release reply is unsent",
  risk: "a late reply",
  stillReal: "checked this morning",
  summary: "the release reply",
} as const;

describe("machineIdInOpenedAsk", () => {
  it("finds nothing in a clean ask", () => {
    expect(machineIdInOpenedAsk({ ask: ASK })).toBe(undefined);
  });

  it("names the ask field and the id its problem carries", () => {
    const ask = { ...ASK, problem: "call a0000019 left the release reply unsent" };
    expect(machineIdInOpenedAsk({ ask })).toEqual({ field: "ask problem", id: "call a0000019" });
  });

  it("reads whole stakes beside an absent summary", () => {
    const ask = { ...ASK, stillReal: "run 9f3a1c2e saw it", summary: undefined };
    expect(machineIdInOpenedAsk({ ask })).toEqual({ field: "ask stakes", id: "run 9f3a1c2e" });
  });

  it("reads no stakes line when the card draws no stakes — one absent, or one blank", () => {
    const lone = { ...ASK, risk: undefined, stillReal: "run 9f3a1c2e saw it" };
    const blank = { ...ASK, blastRadius: "  ", stillReal: "run 9f3a1c2e saw it" };
    expect([machineIdInOpenedAsk({ ask: lone }), machineIdInOpenedAsk({ ask: blank })]).toEqual([undefined, undefined]);
  });
});
