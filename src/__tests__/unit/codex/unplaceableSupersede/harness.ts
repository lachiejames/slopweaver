/**
 * Retiring a pass that recorded NO TREE (an owner ruling: a supersede verb, explicit and journalled, the gate
 * fail-closed by default).
 *
 * The shape under test is a measured one: a plan READY with no tree, a later placed p2 READY, and a pull request
 * unable to land without a hatch because nothing could retire the first.
 *
 * What the split test files share: the measured case's checkout, head and instant, its no-tree plan, and the
 * placed ledger rows built beside it. Pure data, no I/O. Moved here when the one test file was split per describe.
 */

import type { LedgerEntry } from "../../../../codex/ledger.js";
import type { UnplaceableRecord } from "../../../../codex/unplaceable.js";

export const REPO = "/w/a-link";
export const HEAD = "06e12d9aa1b2c3d4e5f60718293a4b5c6d7e8f90";
export const NO_TREE_AT = "2026-09-27T13:55:03.688Z";

/** The no-tree p2 from the measured case. */
export const NO_TREE_PLAN: UnplaceableRecord = {
  artifactId: "b44980e5",
  createdAtIso: NO_TREE_AT,
  mode: "plan",
  pass: "p2",
  propertyId: undefined,
  repoRoot: REPO,
  superseded: undefined,
  verdict: "READY",
};

/**
 * One placed ledger row, CURRENT and CLEAN unless a case says otherwise.
 *
 * @returns the placed ledger row, with `over` spread last
 */
export function entry(over: Partial<LedgerEntry> & { artifactId: string; createdAtIso: string }): LedgerEntry {
  return {
    capped: false,
    diffSha256: undefined,
    freshness: { kind: "current" },
    mode: "review",
    outcomeContext: undefined,
    pass: "r1",
    propertyId: "r1-01",
    provider: "codex",
    reviewSummary: undefined,
    superseded: undefined,
    verdict: "CLEAN",
    ...over,
  };
}

/** The placed p2 that replaced it, STALE — a plan the floor accepts. */
export const LATER_PLAN = entry({
  artifactId: "224c5d1c",
  createdAtIso: "2026-09-27T15:48:34.269Z",
  freshness: { kind: "stale", reason: "the committed tree changed after the pass read it" },
  mode: "plan",
  pass: "p2",
  propertyId: undefined,
  verdict: "READY",
});
