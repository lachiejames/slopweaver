/**
 * One ledger row builder the review-cap tests share: a current CLEAN Codex review over diff `a`, every field a
 * case is not about held at that default.
 */
import type { LedgerEntry } from "../../../codex/ledger.js";

/**
 * A current CLEAN Codex review over diff `a`; a case overrides the fields it is about. Newest-first order is the
 * caller's.
 *
 * @returns the ledger row
 */
export function ledgerRow(over: Partial<LedgerEntry> = {}): LedgerEntry {
  return {
    artifactId: "art-1",
    capped: false,
    createdAtIso: "2026-11-11T01:00:00.000Z",
    diffSha256: "a",
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
