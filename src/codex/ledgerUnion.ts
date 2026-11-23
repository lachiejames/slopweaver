/**
 * The pure fold every landing read ends in: one ledger per qualifying checkout, merged into the single list
 * `loopFailures` judges. Both the landing floor (`./landingGateRun.ts`) and the bump witness
 * (`./baselineBumpWitnessRun.ts`) ask several checkouts and fold their answers here, so the rule for which
 * checkout's fail-closed count is kept lives in one place.
 */

import type { BranchLedger, LedgerEntry } from "./ledger.js";

/**
 * Fold one ledger per qualifying checkout into the single list `loopFailures` judges.
 *
 * Re-sorted by the SAME rule `ledgerForBranch` applies within one checkout — newest first, tie-broken by
 * artifact id — because that ordering is load-bearing rather than cosmetic: `loopFailures` reads the first
 * conclusive plan as the latest word, and concatenating two already-sorted lists does not produce a sorted
 * one.
 *
 * ## `unknowable` sums only over checkouts that WORKED on this branch, and that bound is measured
 *
 * `unknowable` is the count the landing gate fails closed on — a pass whose tree capture failed outright,
 * which could have been the newest BLOCKED plan. Summing it over every qualifying checkout is the obvious
 * reading and it is wrong in practice, because a checkout qualifies by holding the head commit, which every
 * worktree of the repository does. MEASURED pressing one pull request with the naive sum: 5 records with no
 * `tree` field at all — passes predating the field, sitting in
 * worktrees that had never touched that branch — refused a pull request whose own loop was complete. Repro:
 * `slopweaver github enqueue --pr <n> --repo <owner/name> --dry-run`.
 *
 * A gate that refuses every pull request on the machine is not failing closed, it is the floor this whole
 * module exists to stop being acknowledged every time. So a checkout's unplaceable records count only when
 * that checkout contributed at least one row FOR THIS BRANCH — which is what makes it somewhere this
 * branch's evidence could actually be hiding, rather than a worktree full of unrelated history.
 *
 * **The verb's OWN checkout is counted whether or not it spoke, and that is what keeps this from being a
 * loosening at all.** The old reader consulted exactly one checkout — the presser's — and failed closed on
 * its `unknowable`. Dropping that when it happens to hold no row for the branch would let a pull request the
 * old code refused pass now, which is the one thing this change must never do. So `alwaysCount` marks it,
 * and every OTHER checkout — never read at all before this change, so never able to refuse anything — earns
 * its fail-closed weight by having contributed a row.
 *
 * **The residue, stated rather than discovered.** A checkout OTHER than the presser's that recorded passes on
 * this branch and whose every last one failed tree capture contributes no row, so its `unknowable` is
 * dropped, and a BLOCKED plan could hide there. Reaching it needs a checkout that holds the head commit, ran
 * passes on this branch, and had EVERY one fail capture — and it could not have refused anything before this
 * change either, because nothing read it.
 *
 * @param ledgers one per qualifying checkout, `alwaysCount` true for the one the verb is running in
 * @returns the merged ledger, newest first
 */
export function unionLedger({
  ledgers,
}: {
  ledgers: readonly { readonly ledger: BranchLedger; readonly alwaysCount: boolean }[];
}): BranchLedger {
  const entries: LedgerEntry[] = ledgers.flatMap((each) => [...each.ledger.entries]);
  const counted = ledgers.filter((each) => each.alwaysCount || each.ledger.entries.length > 0);
  return {
    entries: entries.toSorted(
      (a, b) => b.createdAtIso.localeCompare(a.createdAtIso) || b.artifactId.localeCompare(a.artifactId),
    ),
    unattributed: ledgers.reduce((total, each) => total + each.ledger.unattributed, 0),
    unknowable: counted.reduce((total, each) => total + each.ledger.unknowable, 0),
    // Under the SAME rule as `unknowable`, so the refusal names exactly the records it counted.
    unplaceable: counted
      .flatMap((each) => [...each.ledger.unplaceable])
      .toSorted((a, b) => b.createdAtIso.localeCompare(a.createdAtIso) || b.artifactId.localeCompare(a.artifactId)),
  };
}
