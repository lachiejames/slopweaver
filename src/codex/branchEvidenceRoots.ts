/**
 * Which candidate checkouts could change a landing verdict for one branch, and which could not. Pure.
 *
 * Both landing reads — the pairing floor (`./landingGateRun.ts`) and the ratchet-bump witness
 * (`./baselineBumpWitnessRun.ts`) — fold one ledger per checkout that holds the pull request's head commit, and
 * deciding that a checkout holds it costs two git spawns. Every worktree of the repository holds it through the
 * shared object store, so that question was asked of every checkout any pass record ever named. MEASURED: 965
 * candidate roots, 303 qualifying, 176s for the qualification alone, and each press reads the floor
 * twice and the witness once — a single `github enqueue` cost about 320s, so the supervisor tick's 300s landing
 * budget killed every pass that pressed anything. Reproduce the counts with
 * `grep -rhoE '"repoRoot": ?"[^"]*"' $SLOPWEAVER_HOME/orchestration | sort -u | wc -l`.
 *
 * A checkout contributes to either verdict ONLY through evidence naming it on the branch: a pass record whose
 * `repoRoot` and `tree.branch` match (`ledgerForBranch`, `./ledger.ts`), a bound review or plan receipt with the
 * same checkout-and-branch filter (`./fallbackReview.ts`, `./fallbackPlan.ts`), or an answered foreign receipt
 * on the branch (`foreignReceiptScanReason`, `./scanReasons.ts`). A checkout with none of those folds an empty
 * ledger whose `unknowable` count `unionLedger` ignores, because it is neither the presser's own checkout nor one
 * that contributed a row. So the relevant set is the own checkout plus every checkout named on the branch, and
 * asking the rest changes no verdict. The caller still falls back to every candidate when no relevant checkout
 * qualifies, which keeps the "no checkout holds that commit" refusal and the empty-ledger read exactly as they were.
 *
 * **The residue, stated rather than discovered.** The merged ledger's `unattributed` total DOES narrow: a
 * checkout whose only passes ran on a detached HEAD is named on no branch, so it is not asked and its count
 * drops out (found by a Codex review). Neither landing read ever reads that total — the floor fails closed on
 * `unknowable` alone (`BranchLedger`, `./ledger.ts`, says why), and `codex status` builds its own one-checkout
 * ledger — so no verdict and no refusal moves. Reading it from a landing read would make this a loosening.
 */

import type { FallbackReceiptScan } from "./fallbackDocuments.js";
import type { CodexArtifactRecord } from "./types.js";

/** The candidate checkouts split by whether they can change a verdict for one branch, each in candidate order. */
export interface CandidateRootPartition {
  /** The own checkout and every candidate some evidence names on the branch. */
  readonly relevant: readonly string[];
  /** Every other candidate: asking it could change no verdict. */
  readonly remaining: readonly string[];
}

/**
 * Split the candidate checkouts into the ones whose evidence could change a verdict on `branch` and the rest.
 *
 * Only candidates are ever returned — evidence naming a checkout outside the list adds nothing — and both halves
 * keep the candidates' order, so the first qualifying relevant checkout is the same one the full scan would have
 * reached first among them.
 *
 * @param branch the pull request's head branch
 * @param candidates every checkout the read would otherwise ask, in its order
 * @param ownRoot the checkout the verb runs in, relevant whether or not anything names it — `unionLedger` counts
 *   its unplaceable records unconditionally
 * @param records every pass record the scan read; `repoRoot` is checked at runtime because the record parser
 *   never validates it
 * @param fallbackScan the Claude fallback receipts, or `undefined` for the bump witness, which folds none
 * @returns the two halves, disjoint and together exactly the candidates
 */
export function partitionCandidateRoots({
  branch,
  candidates,
  ownRoot,
  records,
  fallbackScan,
}: {
  branch: string;
  candidates: readonly string[];
  ownRoot: string | undefined;
  records: readonly CodexArtifactRecord[];
  fallbackScan: FallbackReceiptScan | undefined;
}): CandidateRootPartition {
  const named = branchEvidenceRoots({ branch, fallbackScan, records });
  if (ownRoot !== undefined) {
    named.add(ownRoot);
  }
  return {
    relevant: candidates.filter((root) => named.has(root)),
    remaining: candidates.filter((root) => !named.has(root)),
  };
}

/**
 * Every checkout some piece of evidence names on `branch`.
 *
 * @param branch the branch being judged
 * @param records every pass record the scan read
 * @param fallbackScan the Claude fallback receipts, when the read folds them
 * @returns the named roots, non-empty strings only
 */
function branchEvidenceRoots({
  branch,
  records,
  fallbackScan,
}: {
  branch: string;
  records: readonly CodexArtifactRecord[];
  fallbackScan: FallbackReceiptScan | undefined;
}): Set<string> {
  const named = new Set<string>();
  for (const claim of checkedClaims({ branch, fallbackScan, records })) {
    const root = claim.root;
    if (claim.onBranch && typeof root === "string" && root.length > 0) {
      named.add(root);
    }
  }
  // Exactly as the candidate list admits them — unfiltered — so a foreign or unbound receipt the full scan would
  // have asked about is asked about here too, and its branch-local refusal still fires.
  const placed = fallbackScan === undefined ? [] : [...fallbackScan.foreignReceipts, ...fallbackScan.unboundReceipts];
  for (const receipt of placed) {
    if (receipt.branch === branch) {
      named.add(receipt.repoRoot);
    }
  }
  return named;
}

/** One piece of evidence naming a checkout, and whether it names it on the branch being judged. */
interface RootClaim {
  readonly onBranch: boolean;
  /**
   * Through `unknown`: `isRecordShaped` never inspects `repoRoot`, so a `null` from disk arrives typed as a string,
   * and a receipt's request is checked the same way.
   */
  readonly root: unknown;
}

/**
 * The claims whose checkout must be a non-empty string to count: every pass record, and every bound review or
 * plan receipt when the read folds them.
 *
 * @param branch the branch being judged
 * @param records every pass record the scan read
 * @param fallbackScan the Claude fallback receipts, when the read folds them
 * @returns one claim per piece of evidence
 */
function checkedClaims({
  branch,
  records,
  fallbackScan,
}: {
  branch: string;
  records: readonly CodexArtifactRecord[];
  fallbackScan: FallbackReceiptScan | undefined;
}): readonly RootClaim[] {
  const fromRecords = records.map((record): RootClaim => ({
    onBranch: record.tree?.branch === branch,
    root: record.repoRoot,
  }));
  if (fallbackScan === undefined) {
    return fromRecords;
  }
  const receipts = [...fallbackScan.receipts, ...fallbackScan.planReceipts];
  return [
    ...fromRecords,
    ...receipts.map((receipt): RootClaim => ({
      onBranch: receipt.request.tree.branch === branch,
      root: receipt.request.repoRoot,
    })),
  ];
}
