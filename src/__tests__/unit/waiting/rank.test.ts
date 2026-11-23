import { describe, expect, it } from "vitest";

import { rankWaiting, TIER_ORDER, type WaitingTier, waitingTierOf } from "../../../waiting/rank.js";

/** One waiting thing in a test list: a name to read the order by, and its tier. */
interface Item {
  readonly name: string;
  readonly tier: WaitingTier;
}

const tierOf = (item: Item): WaitingTier => item.tier;

describe("waitingTierOf", () => {
  it("puts work a colleague waits on in the first tier", () => {
    expect(waitingTierOf({ checkIn: false, teamFacing: true })).toBe("team-blocked");
  });

  it("puts the fleet's own stopped work in the second", () => {
    expect(waitingTierOf({ checkIn: false, teamFacing: false })).toBe("fleet-blocked");
  });

  it("keeps a check-in last even when a colleague's work is its subject", () => {
    expect(waitingTierOf({ checkIn: true, teamFacing: true })).toBe("check-in");
    expect(waitingTierOf({ checkIn: true, teamFacing: false })).toBe("check-in");
  });
});

describe("rankWaiting", () => {
  it("leads with the team-blocked thing and ends on the check-ins, whatever order they arrived in", () => {
    // A measured shape: check-ins arriving ahead of the one thing a colleague was waiting on.
    const items: Item[] = [
      { name: "act-1", tier: "check-in" },
      { name: "fleet-ask", tier: "fleet-blocked" },
      { name: "act-2", tier: "check-in" },
      { name: "work-pr", tier: "team-blocked" },
      { name: "held-reply", tier: "team-blocked" },
    ];
    expect(rankWaiting({ items, tierOf }).map((item) => item.name)).toEqual([
      "work-pr",
      "held-reply",
      "fleet-ask",
      "act-1",
      "act-2",
    ]);
  });

  it("keeps the caller's order within a tier", () => {
    const items: Item[] = [
      { name: "oldest", tier: "fleet-blocked" },
      { name: "middle", tier: "fleet-blocked" },
      { name: "newest", tier: "fleet-blocked" },
    ];
    expect(rankWaiting({ items, tierOf }).map((item) => item.name)).toEqual(["oldest", "middle", "newest"]);
  });

  it("returns a new list and leaves the caller's untouched", () => {
    const items: Item[] = [
      { name: "act", tier: "check-in" },
      { name: "pr", tier: "team-blocked" },
    ];
    rankWaiting({ items, tierOf });
    expect(items.map((item) => item.name)).toEqual(["act", "pr"]);
  });

  it("answers an empty list with an empty list", () => {
    expect(rankWaiting({ items: [], tierOf })).toEqual([]);
  });

  // The band moved out of rankWaiting into rankQueue, tested in queueOrder.test.ts.
  // The site's mirror reads each thing's tier once, in item order; this one reads it the same way, so a reader
  // that is not pure still ranks identically in both.
  it("reads each thing's tier once, in the caller's order, before sorting", () => {
    const asked: string[] = [];
    const tiers: WaitingTier[] = ["fleet-blocked", "team-blocked"];
    const items: Item[] = [
      { name: "a", tier: "check-in" },
      { name: "b", tier: "check-in" },
    ];
    const ranked = rankWaiting({
      items,
      tierOf: (item) => {
        asked.push(`tier:${item.name}`);
        return tiers.shift()!;
      },
    });
    expect(ranked.map((item) => item.name)).toEqual(["b", "a"]);
    expect(asked).toEqual(["tier:a", "tier:b"]);
  });

  it("names the three tiers in the order they lead", () => {
    expect(TIER_ORDER).toEqual(["team-blocked", "fleet-blocked", "check-in"]);
  });
});
