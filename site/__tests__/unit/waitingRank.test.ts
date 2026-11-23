/*
 * The console ranks what is waiting on the owner exactly as the verbs do.
 *
 * `site/` cannot import `src/`, so `site/lib/waitingRank.ts` is a copy of `src/waiting/rank.ts`; this test is
 * what makes the copy safe. Every facts combination and one mixed list run through BOTH, so a tier or an order
 * changed on one side only fails here rather than leading the owner to one thing on the Queue and another in the
 * banner.
 */
import { describe, expect, it } from "vitest";

import { QUEUE_BANDS as VERB_BANDS, rankQueue as verbQueue } from "../../../src/waiting/queueOrder";
import {
  TIER_ORDER,
  rankWaiting as verbRank,
  waitingTierOf as verbTier,
  type WaitingTier,
} from "../../../src/waiting/rank";
import { QUEUE_BANDS, type QueueFact, rankQueue } from "../../lib/queueOrderRank";
import { rankWaiting, TIER_WORDS, TIERS, waitingTierOf } from "../../lib/waitingRank";

const FACTS = [
  { checkIn: false, teamFacing: false },
  { checkIn: false, teamFacing: true },
  { checkIn: true, teamFacing: false },
  { checkIn: true, teamFacing: true },
];

/** One waiting thing in a test list. */
interface Item {
  readonly name: string;
  readonly tier: WaitingTier;
}

const tierOf = (item: Item): WaitingTier => item.tier;

describe("the console's copy of the waiting ranking", () => {
  it("gives every facts combination the verbs' tier", () => {
    expect(FACTS.map((facts) => waitingTierOf(facts))).toEqual(FACTS.map((facts) => verbTier(facts)));
  });

  it("orders a mixed list exactly as the verbs do", () => {
    const items: Item[] = [
      { name: "act-1", tier: "check-in" },
      { name: "fleet-1", tier: "fleet-blocked" },
      { name: "team-1", tier: "team-blocked" },
      { name: "act-2", tier: "check-in" },
      { name: "fleet-2", tier: "fleet-blocked" },
      { name: "team-2", tier: "team-blocked" },
    ];
    const drawn = rankWaiting({ items, tierOf }).map((item) => item.name);
    expect(drawn).toEqual(verbRank({ items, tierOf }).map((item) => item.name));
    expect(drawn).toEqual(["team-1", "team-2", "fleet-1", "fleet-2", "act-1", "act-2"]);
  });

  // Both mirrors read each tier once, in item order, so a reader that is not pure ranks alike.
  it("ranks alike with the verbs under a reader that answers differently each time it is asked", () => {
    const items: Item[] = [
      { name: "a", tier: "check-in" },
      { name: "b", tier: "check-in" },
    ];
    const reader = (): ((item: Item) => WaitingTier) => {
      const answers: WaitingTier[] = ["fleet-blocked", "team-blocked"];
      return () => answers.shift()!;
    };
    const drawn = rankWaiting({ items, tierOf: reader() }).map((item) => item.name);
    expect(drawn).toEqual(verbRank({ items, tierOf: reader() }).map((item) => item.name));
    expect(drawn).toEqual(["b", "a"]);
  });

  it("draws the tiers in the verbs' order", () => {
    expect(TIERS).toEqual(TIER_ORDER);
  });

  it("has words for every tier the verbs name, and no others", () => {
    expect(TIER_ORDER.length).toBeGreaterThan(0);
    expect(Object.keys(TIER_WORDS).toSorted()).toEqual([...TIER_ORDER].toSorted());
  });

  it("heads the check-ins as a review rather than as waiting work", () => {
    expect(TIER_WORDS["check-in"].heading).toBe("Check-ins: your word is a review");
  });
});

/** One thing in the one order's test list. */
interface Ordered {
  readonly name: string;
  readonly fact: QueueFact;
}

const factOf = (item: Ordered): QueueFact => item.fact;

describe("the console's copy of the one Queue order", () => {
  // The ruled order: a blocker on the owner's priorities first, then the first priority's cards, then the second's, ranked by
  // the controls each resolves, a stopped automation after them, the rest last.
  const items: readonly Ordered[] = [
    { fact: { band: "rest" }, name: "colleague-reply" },
    { fact: { band: "stopped" }, name: "held-error-tracking" },
    { fact: { band: "priority", boardBand: 0, controlsResolved: 3, priorityRank: 1 }, name: "vanta-clears-3" },
    { fact: { band: "priority", boardBand: 0, priorityRank: 1 }, name: "vanta-no-count" },
    { fact: { band: "priority", boardBand: 0, controlsResolved: 8, priorityRank: 1 }, name: "vanta-clears-8" },
    { fact: { band: "priority", boardBand: 3, controlsResolved: 20, priorityRank: 1 }, name: "vanta-parked-p3" },
    { fact: { band: "priority", boardBand: 0, priorityRank: 0 }, name: "nag-proposal" },
    { fact: { band: "blocker", priorityRank: 1 }, name: "blocks-vanta" },
    { fact: { band: "blocker", priorityRank: 0 }, name: "blocks-nag" },
    { fact: { band: "rest" }, name: "stale-p1" },
  ];

  it("orders the ruled card set exactly as the verbs do", () => {
    const drawn = rankQueue({ factOf, items }).map((item) => item.name);
    expect(drawn).toEqual(verbQueue({ factOf, items }).map((item) => item.name));
    expect(drawn).toEqual([
      "blocks-nag",
      "blocks-vanta",
      "nag-proposal",
      "vanta-clears-8",
      "vanta-clears-3",
      "vanta-no-count",
      "vanta-parked-p3",
      "held-error-tracking",
      "colleague-reply",
      "stale-p1",
    ]);
  });

  it("reads no board band or count inside the blocker band, keeping the order given there, on both sides", () => {
    const blockers: readonly Ordered[] = [
      { fact: { band: "blocker", boardBand: 3, controlsResolved: 1, priorityRank: 0 }, name: "first" },
      { fact: { band: "blocker", boardBand: 0, controlsResolved: 9, priorityRank: 0 }, name: "second" },
    ];
    expect(rankQueue({ factOf, items: blockers }).map((item) => item.name)).toEqual(["first", "second"]);
    expect(verbQueue({ factOf, items: blockers }).map((item) => item.name)).toEqual(["first", "second"]);
  });

  it("puts an unranked priority after every ranked one, on both sides", () => {
    const priorities: readonly Ordered[] = [
      { fact: { band: "priority" }, name: "unranked" },
      { fact: { band: "priority", priorityRank: 4 }, name: "ranked" },
    ];
    expect(rankQueue({ factOf, items: priorities }).map((item) => item.name)).toEqual(["ranked", "unranked"]);
    expect(verbQueue({ factOf, items: priorities }).map((item) => item.name)).toEqual(["ranked", "unranked"]);
  });

  it("puts an unstated rank, band or count after the largest stated one, never tied with it", () => {
    const largest = Number.MAX_SAFE_INTEGER;
    const cases: readonly (readonly Ordered[])[] = [
      [
        { fact: { band: "priority" }, name: "unstated" },
        { fact: { band: "priority", priorityRank: largest }, name: "stated" },
      ],
      [
        { fact: { band: "priority", priorityRank: 1 }, name: "unstated" },
        { fact: { band: "priority", boardBand: largest, priorityRank: 1 }, name: "stated" },
      ],
      [
        { fact: { band: "priority", boardBand: 0, priorityRank: 1 }, name: "unstated" },
        { fact: { band: "priority", boardBand: 0, controlsResolved: 0, priorityRank: 1 }, name: "stated" },
      ],
    ];
    const site = cases.map((pair) => rankQueue({ factOf, items: pair }).map((item) => item.name));
    const verb = cases.map((pair) => verbQueue({ factOf, items: pair }).map((item) => item.name));
    expect(site).toEqual([
      ["stated", "unstated"],
      ["stated", "unstated"],
      ["stated", "unstated"],
    ]);
    expect(verb).toEqual(site);
  });

  it("reads past two equal infinite ranks to the board band, on both sides", () => {
    const infinite: readonly Ordered[] = [
      { fact: { band: "priority", boardBand: 1, priorityRank: Infinity }, name: "p1" },
      { fact: { band: "priority", boardBand: 0, priorityRank: Infinity }, name: "p0" },
    ];
    expect(rankQueue({ factOf, items: infinite }).map((item) => item.name)).toEqual(["p0", "p1"]);
    expect(verbQueue({ factOf, items: infinite }).map((item) => item.name)).toEqual(["p0", "p1"]);
  });

  it("hands the same list back when nothing moves, on both sides", () => {
    const settled = rankQueue({ factOf, items });
    expect(rankQueue({ factOf, items: settled })).toBe(settled);
    const verbSettled = verbQueue({ factOf, items });
    expect(verbQueue({ factOf, items: verbSettled })).toBe(verbSettled);
  });

  it("draws the bands in the verbs' order", () => {
    expect(QUEUE_BANDS).toEqual(VERB_BANDS);
  });
});
