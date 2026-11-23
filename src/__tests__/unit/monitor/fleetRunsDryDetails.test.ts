/**
 * The dry card's details list the machine and every Claude and Codex plan — status, the spent window holding it,
 * its reset, its account and its free resets — and refuse a fleet they cannot carry whole. Every instant prints as
 * its UTC minute.
 */
import { describe, expect, it } from "vitest";

import { assessFleetDry, type FleetDryInterval } from "../../../monitor/fleetRunsDryCeilings.js";
import { fleetDryDetails, minute } from "../../../monitor/fleetRunsDryDetails.js";

import { cappedCodex, dryReading, MONTHLY_CODEX, NOW, ROUTING_BARS, readingOf } from "./fleetRunsDryFixtures.js";

const READING = readingOf({ ceilings: [...dryReading().ceilings, MONTHLY_CODEX] });
const INTERVAL = (
  assessFleetDry({
    maxAgeMs: 7_200_000,
    minDryHours: 4,
    nowIso: NOW,
    reading: READING,
    registered: [],
    routingBars: ROUTING_BARS,
  }) as {
    readonly interval: FleetDryInterval;
  }
).interval;

describe("minute", () => {
  it("prints an instant as its UTC minute, converting an offset rather than slicing it", () => {
    expect(minute({ iso: "2026-10-04T21:00:30.000+10:00" })).toBe("2026-10-04T11:00Z");
    expect(minute({ iso: "2026-10-04T11:00:59.999Z" })).toBe("2026-10-04T11:00Z");
  });

  it("prints a value that names no instant as filed, never as a wrong instant", () => {
    expect(minute({ iso: "not an instant" })).toBe("not an instant");
  });
});

describe("fleetDryDetails", () => {
  it("lists the machine and every plan in the reading's order, the relieving plan marked", () => {
    expect(fleetDryDetails({ interval: INTERVAL, reading: READING })).toEqual({
      details: [
        "machine — open, load 11 of 22: not what stops a seat",
        "claude:plan-one — Claude, refusing, seven-day 100 of 100: resets 2026-11-06T06:00Z; plan-one (acme); free resets unread",
        "claude:plan-two — Claude, refusing, seven-day 100 of 100: resets 2026-11-05T16:00Z; plan-two (acme); free resets unread; its reset ends the dry interval",
        "codex:codex-one — Codex, at-usage-limit, weekly 30 of 30: resets 2026-11-06T06:00Z; codex-one (acme); 2 free reset(s) held",
        "codex:monthly — Codex, monthly spend, never routed: monthly (acme); free resets unread",
      ],
    });
  });

  it("refuses a fleet longer than a card carries rather than dropping a plan", () => {
    const many = Array.from({ length: 12 }, (_, index) =>
      cappedCodex({ alias: `codex-${String(index)}`, resetAtIso: "2026-11-06T06:00:00.000Z" }),
    );
    const listed = fleetDryDetails({
      interval: INTERVAL,
      reading: readingOf({ ceilings: [...READING.ceilings, ...many] }),
    });
    expect(listed).toEqual({
      because:
        "the fleet is 17 detail lines and a card carries 12, so it cannot list every plan — `slopweaver machine capacity` prints them all",
    });
  });

  it("refuses a line longer than a card line carries rather than cutting it", () => {
    const long = {
      ...cappedCodex({ alias: "codex-long", resetAtIso: "2026-11-06T06:00:00.000Z" }),
      account: "x".repeat(400),
    };
    const listed = fleetDryDetails({
      interval: INTERVAL,
      reading: readingOf({ ceilings: [...READING.ceilings, long] }),
    });
    expect("because" in listed).toBe(true);
    expect((listed as { readonly because: string }).because).toContain("a card line carries 320");
  });
});
