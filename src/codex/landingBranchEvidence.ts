/**
 * The landing floor's view of a pull request's evidence: every pass a proven predecessor of its head branch
 * recorded, shown under the head branch's name (`./branchContinuityView.ts`), before `./landingGateRun.ts` picks
 * the checkouts that may speak for the pull request and folds their ledgers.
 *
 * The reflogs are read in ONE checkout of the pull request's repository: the verb's own when its `origin` is that
 * repository, else the first candidate checkout whose `origin` is. A checkout of another repository would answer
 * about the wrong reflogs, so it is never asked. When no candidate is a checkout of the repository, nothing is
 * relabelled — no checkout can qualify either, so the floor refuses on that reason as it always did.
 */

import { ok, type Result } from "#lib/result.js";
import { originRepositoryOf } from "../config.js";
import type { BranchContinuityError } from "./branchContinuity.js";
import { readBranchEvidence } from "./branchContinuityGit.js";
import { type BranchEvidence, namesAnotherBranch } from "./branchContinuityView.js";
import { candidateRepoRoots } from "./candidateRepoRoots.js";
import type { FallbackReceiptScan } from "./fallbackDocuments.js";
import { resolveRepoRoot } from "./gitDiff.js";
import type { PullRequestHead } from "./landingGate.js";
import type { LedgerScan } from "./ledgerStore.js";

/**
 * The evidence the landing floor folds for one pull request.
 *
 * @param cwd the checkout the landing verb is running in, asked first
 * @param head the pull request being landed
 * @param scan every pass record that could be read
 * @param receipts every Claude fallback receipt the scan classified
 * @returns both scans as the head branch should see them, or why its continuity could not be read
 */
export function landingBranchEvidence({
  cwd,
  head,
  scan,
  receipts,
}: {
  cwd: string;
  head: PullRequestHead;
  scan: LedgerScan;
  receipts: FallbackReceiptScan;
}): Result<BranchEvidence, BranchContinuityError> {
  if (!namesAnotherBranch({ branch: head.branch, receipts, scan })) {
    return ok({ receipts, scan });
  }
  const own = resolveRepoRoot({ cwd });
  const ownRoot = own.isOk() ? own.value : undefined;
  // `candidateRepoRoots` lists the verb's own checkout first, so it is preferred whenever it qualifies.
  const root = candidateRepoRoots({ fallbackScan: receipts, ownRoot, records: scan.records }).find((candidate) => {
    const origin = originRepositoryOf({ cwd: candidate });
    return origin.isOk() && `${origin.value.owner}/${origin.value.repo}` === head.repository;
  });
  if (root === undefined) {
    return ok({ receipts, scan });
  }
  return readBranchEvidence({ branch: head.branch, cwd: root, receipts, scan });
}
