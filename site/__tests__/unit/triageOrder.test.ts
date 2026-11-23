/*
 * The order a triage pass walks the Queue's cards in: section by section, the order given kept within one, never
 * regrouped by register.
 */

import { describe, expect, it } from "vitest";

import type { QueueSection } from "../../lib/queueFocus";
import { triageOrder } from "../../lib/triage";
import type { WaitingTier } from "../../lib/waitingRank";

const ROWS = [
  { key: "act:a", kind: "act" as const, tier: "check-in" as const },
  { key: "ask:b", kind: "ask" as const, tier: "fleet-blocked" as const },
  { key: "hand:c", kind: "hand" as const, tier: "fleet-blocked" as const },
  { key: "ask:d", kind: "ask" as const, tier: "fleet-blocked" as const },
];

/**
 * The section of a row while nothing is lifted: its tier.
 *
 * @returns the row's tier
 */
const byTier = (row: { readonly tier: WaitingTier }): QueueSection => row.tier;

describe("triageOrder", () => {
  it("walks the order it is given within a section, never regrouped by register", () => {
    expect(triageOrder({ rows: ROWS, sectionOf: byTier }).map((row) => row.key)).toEqual([
      "ask:b",
      "hand:c",
      "ask:d",
      "act:a",
    ]);
  });

  it("walks what blocks a colleague first, whatever its register, and a check-in hand step last", () => {
    const rows = [
      { key: "hand:try", kind: "hand" as const, tier: "check-in" as const },
      { key: "hand:c", kind: "hand" as const, tier: "fleet-blocked" as const },
      { key: "ask:work", kind: "ask" as const, tier: "team-blocked" as const },
    ];
    expect(triageOrder({ rows, sectionOf: byTier }).map((row) => row.key)).toEqual(["ask:work", "hand:c", "hand:try"]);
  });

  it("walks a blocker on the owner's priorities, then the owner's priorities, then a stopped automation, ahead of a colleague's card", () => {
    const rows = [
      { key: "hand:try", kind: "hand" as const, tier: "check-in" as const },
      { key: "hand:held", kind: "hand" as const, tier: "fleet-blocked" as const },
      { key: "ask:work", kind: "ask" as const, tier: "team-blocked" as const },
      { key: "ask:iso-policy", kind: "ask" as const, tier: "fleet-blocked" as const },
      { key: "ask:iso-blocker", kind: "ask" as const, tier: "team-blocked" as const },
    ];
    const lifted: Readonly<Record<string, QueueSection>> = {
      "ask:iso-blocker": "blocker",
      "ask:iso-policy": "focus",
      "hand:held": "stopping",
    };
    const sectionOf = (row: (typeof rows)[number]): QueueSection => {
      const section = lifted[row.key];
      if (section === undefined) {
        return row.tier;
      }
      return section;
    };
    expect(triageOrder({ rows, sectionOf }).map((row) => row.key)).toEqual([
      "ask:iso-blocker",
      "ask:iso-policy",
      "hand:held",
      "ask:work",
      "hand:try",
    ]);
  });

  it("walks a card the owner put off last, but keeps a put-off card that stops your work in its place", () => {
    const rows = [
      {
        deferredIso: "2026-10-05T11:58:00Z",
        key: "ask:deferred-blocker",
        stopping: { priorityRank: 1, reason: "blocks" as const },
        tier: "team-blocked" as const,
      },
      { deferredIso: "2026-10-04T09:00:00Z", key: "ask:put-off", tier: "fleet-blocked" as const },
      { key: "ask:work", tier: "team-blocked" as const },
    ];
    const sectionOf = (row: (typeof rows)[number]): QueueSection => {
      if (row.key === "ask:deferred-blocker") {
        return "blocker";
      }
      return row.tier;
    };
    expect(triageOrder({ rows, sectionOf }).map((row) => row.key)).toEqual([
      "ask:deferred-blocker",
      "ask:work",
      "ask:put-off",
    ]);
  });

  it("walks nothing when the Queue holds nothing", () => {
    expect(triageOrder({ rows: [], sectionOf: byTier })).toEqual([]);
  });
});
