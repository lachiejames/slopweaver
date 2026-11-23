/*
 * `fleet-unhealthy`'s card: every signal set round-tripped through its key, the one thing each set says, the step
 * the register accepts for each, and the lead a delta gives the line.
 */
import { describe, expect, it } from "vitest";

import { postingRefusal } from "../../../../hand/posting.js";
import { unwrap } from "../../../../lib/result.js";
import { buildArrival } from "../../../../monitor/card.js";
import { type FleetSignal, fleetHealthWhat, signalsOfKey } from "../../../../monitor/fleetHealth.js";
import { monitorDefinition } from "../../../../monitor/registry.js";

import { NOW } from "../fleetHealthFixtures.js";

describe("the card", () => {
  const SETS: readonly (readonly FleetSignal[])[] = [
    ["syncs"],
    ["deaths"],
    ["bot"],
    ["syncs", "deaths"],
    ["syncs", "bot"],
    ["deaths", "bot"],
    ["syncs", "deaths", "bot"],
  ];

  it("round-trips every signal set through its key", () => {
    expect(SETS.length).toBeGreaterThan(0);
    expect(SETS.map((signals) => signalsOfKey({ key: signals.join("-") }))).toEqual(SETS);
  });

  it("says one thing per set, asking the owner to seat the bot only when it is off Slack", () => {
    expect(SETS.map((signals) => fleetHealthWhat({ signals }))).toEqual([
      "Check fleet health — scheduled jobs are failing",
      "Check fleet health — syncs are dying mid-run",
      "Seat a visible bot session — it is off Slack",
      "Check fleet health — scheduled jobs are failing and syncs are dying mid-run",
      "Seat a visible bot session — it is off Slack, and scheduled jobs are failing",
      "Seat a visible bot session — it is off Slack, and scheduled jobs are dying mid-run",
      "Seat a visible bot session — it is off Slack, and scheduled jobs are failing and dying mid-run",
    ]);
  });

  it("builds a step the register accepts for every set, a check-in unless the bot is down", () => {
    const definition = monitorDefinition({ monitorId: "fleet-unhealthy" });
    const steps = SETS.map((signals) =>
      unwrap(
        buildArrival({
          address: { consoleBase: "http://localhost:3000", occurrence: 1 },
          definition,
          nowIso: NOW,
          postedBy: "supervisor",
          subject: {
            ...(signals.includes("bot") ? {} : { checkIn: true as const }),
            id: "fleet health",
            key: signals.join("-"),
            label: `as of 15:37Z, 42 of 145 scheduled runs in 24h failed; ${"resync-corpus-x ".repeat(30)}`,
          },
        }),
      ),
    );
    expect(steps.map((step) => postingRefusal({ step }))).toEqual(SETS.map(() => undefined));
    expect(steps.map((step) => step.checkIn)).toEqual([true, true, undefined, true, undefined, undefined, undefined]);
  });

  it("leads with what changed since the last note when the subject carries a delta", () => {
    const delta = {
      bot: "up",
      handMoved: [],
      newlyFailing: ["a", "b"],
      recovered: ["c"],
      stillFailing: ["d"],
      tripped: [],
      untripped: [],
    } as const;
    expect(fleetHealthWhat({ delta, signals: ["syncs"] })).toBe(
      "Check fleet health — 2 scheduled jobs newly failing, 1 recovered, 1 still failing",
    );
    expect(fleetHealthWhat({ delta: { ...delta, bot: "down" }, signals: ["syncs", "bot"] })).toBe(
      "Seat a visible bot session — it is off Slack; 2 scheduled jobs newly failing, 1 recovered, 1 still failing",
    );
    expect(
      fleetHealthWhat({
        delta: {
          bot: "back",
          handMoved: [],
          newlyFailing: [],
          recovered: [],
          stillFailing: ["d"],
          tripped: [],
          untripped: [],
        },
        signals: ["syncs"],
      }),
    ).toBe("Check fleet health — the bot is back on Slack; 1 still failing");
  });
});
