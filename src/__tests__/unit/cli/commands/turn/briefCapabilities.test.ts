/**
 * The routing inventory `turn brief` grades, with the host observation replaced by a typed observer fake: the
 * observer is asked ONCE, under the brief's home, about the merged table (an overlay row included, every
 * registered atlas the generic table does not already read gets a derived row), and what it observed is what the
 * inventory is graded against — its launcher replaces a leading `slopweaver`, and its store reading decides
 * the history row's bucket.
 */
import { describe, expect, it } from "vitest";

import {
  type RoutingCapabilitiesObserver,
  routingCapabilitiesFor,
} from "../../../../../cli/commands/turn/briefCapabilities.js";
import { atlasPlatformOf } from "../../../../../route/atlasReading.js";
import { registeredAtlasSources } from "../../../../../route/atlasSources.js";
import type { SourceCapability } from "../../../../../route/profile.js";
import { GENERIC_SOURCE_CAPABILITIES } from "../../../../../route/sourcePlan.js";

const HOME = "/homes/brief";
const LAUNCHER = "/opt/slopweaver/bin/slopweaver";

const LEDGER: SourceCapability = {
  availability: { kind: "available" },
  command: ["slopweaver", "acme", "ledger", "{question}"],
  coverage: { detail: "every posted entry", kind: "complete" },
  effect: "read",
  freshness: { detail: "read at call time", kind: "live" },
  id: "acme-ledger",
  owner: "private-console",
  sourceClass: "provider",
  terms: ["ledger"],
  truthMode: "current",
  what: "posted ledger entries",
};

/** An observer fake that records each call and answers empty gradings, the launcher above and an unselected store. */
function recordingObserver(): {
  calls: Parameters<RoutingCapabilitiesObserver>[0][];
  observe: RoutingCapabilitiesObserver;
} {
  const calls: Parameters<RoutingCapabilitiesObserver>[0][] = [];
  const observe: RoutingCapabilitiesObserver = async (input) => {
    calls.push(input);
    return {
      atlasReadings: new Map(),
      commandReadings: new Map(),
      connectionReadings: new Map(),
      slopweaverCommand: LAUNCHER,
      storeReading: { because: "no store is selected under this home", kind: "unselected" },
    };
  };
  return { calls, observe };
}

describe("routingCapabilitiesFor", () => {
  it("asks the observer once, under the brief's home, about a table carrying the overlay's row", async () => {
    const { calls, observe } = recordingObserver();

    await routingCapabilitiesFor({
      capabilityOutcome: { kind: "profile", profile: { capabilities: [LEDGER], schemaVersion: 1 }, skipped: [] },
      home: HOME,
      observe,
      question: "why did the June close slip",
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]!.home).toBe(HOME);
    expect(calls[0]!.capabilities.filter((capability) => capability.id === "acme-ledger")).toEqual([LEDGER]);
  });

  it("offers the overlay row as available, its argv on the observed launcher with the question substituted", async () => {
    const { observe } = recordingObserver();

    const inventory = await routingCapabilitiesFor({
      capabilityOutcome: { kind: "profile", profile: { capabilities: [LEDGER], schemaVersion: 1 }, skipped: [] },
      home: HOME,
      observe,
      question: "why did the June close slip",
    });

    expect(inventory.available.filter((capability) => capability.id === "acme-ledger")).toEqual([
      { ...LEDGER, command: [LAUNCHER, "acme", "ledger", "why did the June close slip"] },
    ]);
  });

  it("files the history row unavailable carrying the observed store's reason", async () => {
    const { observe } = recordingObserver();

    const inventory = await routingCapabilitiesFor({
      capabilityOutcome: { kind: "absent" },
      home: HOME,
      observe,
      question: "what did we decide",
    });

    expect(inventory.historical.map((capability) => capability.id)).not.toContain("corpus");
    expect(
      inventory.unavailable
        .filter((capability) => capability.id === "corpus")
        .map(({ availability, command }) => ({ availability, command })),
    ).toEqual([{ availability: { kind: "unavailable", reason: "no store is selected under this home" }, command: [] }]);
  });

  it("shows the observer a derived row for every registered atlas the generic table does not already read", async () => {
    const { calls, observe } = recordingObserver();
    const derivedIds = registeredAtlasSources()
      .filter(
        ({ platform }) =>
          !GENERIC_SOURCE_CAPABILITIES.some((capability) => atlasPlatformOf({ capability }) === platform),
      )
      .map(({ platform }) => `${platform}-atlas`);

    await routingCapabilitiesFor({
      capabilityOutcome: { kind: "absent" },
      home: HOME,
      observe,
      question: "what is open",
    });

    expect(derivedIds.length).toBeGreaterThan(0);
    expect(calls[0]!.capabilities.map((capability) => capability.id)).toEqual(expect.arrayContaining(derivedIds));
  });
});
