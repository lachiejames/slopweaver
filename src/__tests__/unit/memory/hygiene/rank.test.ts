/**
 * CARD ORDER, RECURRENCE AND THE FOLD.
 *
 * Two properties carry the weight. **Severity is the registry's own order**, so the ordering case asserts a
 * shuffled input comes back in `HYGIENE_CHECK_IDS` order rather than asserting one pair — an implementation that
 * sorted by check id alphabetically would pass a two-element test. **Recurrence breaks ties and never crosses a
 * check boundary**, so the chronic case pits a 9-day duplicate against a 1-day index budget and the index budget
 * still wins.
 *
 * Everything here is invented. This is a public repository, and a fixture is the easiest place for a private
 * string to arrive unnoticed.
 */
import { describe, expect, it } from "vitest";

import type { HygieneState } from "../../../../memory/hygiene/ledger.js";
import { ABOVE_FOLD_CAP, rankProposals, withRecurrence } from "../../../../memory/hygiene/rank.js";
import {
  HYGIENE_CHECK_IDS,
  type HygieneCheckId,
  type MemoryHygieneProposal,
} from "../../../../memory/hygiene/types.js";

/** A proposal carrying only what ranking reads. `id` is the subject, so a fixture is readable in a failure. */
function proposalOf({
  check,
  subject,
  daysSeen = 0,
}: {
  check: HygieneCheckId;
  subject: string;
  daysSeen?: number;
}): MemoryHygieneProposal {
  return {
    check,
    daysSeen,
    evidence: [],
    files: [subject],
    id: subject,
    recommendation: "adjust",
    refutations: [],
    subject,
    summary: `${check} on ${subject}`,
  };
}

/** A folded state carrying only what recurrence reads. */
function stateOf({ id, daysSeen, refused }: { id: string; daysSeen: number; refused: boolean }): HygieneState {
  return {
    accepted: false,
    check: "duplicate",
    daysSeen,
    firstSeenIso: "2026-09-10T00:00:00.000Z",
    id,
    lastSeenIso: "2026-09-18T00:00:00.000Z",
    recommendation: "adjust",
    refused,
    subject: id,
    why: undefined,
  };
}

describe("withRecurrence", () => {
  it("counts today, so an unseen proposal is one day rather than none", () => {
    const proposals = [proposalOf({ check: "duplicate", subject: "fresh" })];
    expect(withRecurrence({ proposals, states: new Map() }).map((entry) => entry.daysSeen)).toEqual([1]);
  });

  it("adds today to a proposal the ledger already knows", () => {
    const proposals = [proposalOf({ check: "duplicate", subject: "chronic" })];
    const states = new Map([["chronic", stateOf({ daysSeen: 8, id: "chronic", refused: false })]]);
    expect(withRecurrence({ proposals, states }).map((entry) => entry.daysSeen)).toEqual([9]);
  });

  it("drops a terminally refused proposal before ranking, so it never consumes a slot", () => {
    const proposals = [
      proposalOf({ check: "duplicate", subject: "refused-one" }),
      proposalOf({ check: "duplicate", subject: "live-one" }),
    ];
    const states = new Map([["refused-one", stateOf({ daysSeen: 4, id: "refused-one", refused: true })]]);
    expect(withRecurrence({ proposals, states }).map((entry) => entry.subject)).toEqual(["live-one"]);
  });

  it("keeps a proposal the owner ACCEPTED, because acceptance is not terminal", () => {
    const proposals = [proposalOf({ check: "duplicate", subject: "accepted-one" })];
    const accepted = { ...stateOf({ daysSeen: 2, id: "accepted-one", refused: false }), accepted: true };
    expect(withRecurrence({ proposals, states: new Map([["accepted-one", accepted]]) }).length).toBe(1);
  });
});

describe("rankProposals", () => {
  it("orders by the check registry's own severity, from a shuffled input", () => {
    expect(HYGIENE_CHECK_IDS.length).toBeGreaterThan(0);
    const shuffled = [...HYGIENE_CHECK_IDS]
      .toSorted((left, right) => left.localeCompare(right))
      .map((check) => proposalOf({ check, subject: check, daysSeen: 1 }));
    const ranked = rankProposals({ cap: HYGIENE_CHECK_IDS.length, proposals: shuffled });
    expect(ranked.aboveFold.map((entry) => entry.check)).toEqual([...HYGIENE_CHECK_IDS]);
    expect(ranked.belowFold).toEqual([]);
  });

  it("breaks a tie inside one check by recurrence, then by subject", () => {
    const proposals = [
      proposalOf({ check: "duplicate", daysSeen: 1, subject: "b-fresh" }),
      proposalOf({ check: "duplicate", daysSeen: 1, subject: "a-fresh" }),
      proposalOf({ check: "duplicate", daysSeen: 9, subject: "z-chronic" }),
    ];
    expect(rankProposals({ proposals }).aboveFold.map((entry) => entry.subject)).toEqual([
      "z-chronic",
      "a-fresh",
      "b-fresh",
    ]);
  });

  it("never lets recurrence cross a check boundary — a chronic duplicate loses to a fresh index budget", () => {
    const proposals = [
      proposalOf({ check: "duplicate", daysSeen: 9, subject: "chronic-pair" }),
      proposalOf({ check: "index-budget", daysSeen: 1, subject: "MEMORY.md" }),
    ];
    expect(rankProposals({ proposals }).aboveFold.map((entry) => entry.check)).toEqual(["index-budget", "duplicate"]);
  });

  it("splits at the cap, carrying the overflow below the fold rather than discarding it", () => {
    const proposals = Array.from({ length: ABOVE_FOLD_CAP + 3 }, (_unused, position) =>
      proposalOf({ check: "duplicate", daysSeen: 1, subject: `pair-${String(position)}` }),
    );
    const ranked = rankProposals({ proposals });
    expect(ranked.aboveFold.length).toBe(ABOVE_FOLD_CAP);
    expect(ranked.belowFold.map((entry) => entry.subject)).toEqual(["pair-5", "pair-6", "pair-7"]);
  });

  it("returns two empty halves for an empty run", () => {
    expect(rankProposals({ proposals: [] })).toEqual({ aboveFold: [], belowFold: [] });
  });
});
