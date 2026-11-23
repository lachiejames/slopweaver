/**
 * The candidate checkouts a branch's Codex evidence could live in. Pure.
 *
 * Shared by the landing floor (`./landingGateRun.ts`), which narrows them with `partitionCandidateRoots`
 * (`./branchEvidenceRoots.ts`), and by `codex status`'s other-checkouts line (`./otherCheckoutPasses.ts`). It sits in
 * its own module rather than beside that partition because `./branchEvidenceRoots.ts` is a baseline policy file:
 * adding a function there is a policy row a ratchet-bump witness must judge, and listing roots changes no policy.
 */

import type { FallbackReceiptScan } from "./fallbackDocuments.js";
import type { CodexArtifactRecord } from "./types.js";

/**
 * Every checkout this machine might ask about a branch — the records' own roots plus the caller's own.
 *
 * Both receipt kinds contribute a root, and so does an answered receipt of a kind this build cannot read
 * (`./scanReasons.ts`'s `foreignReceiptScanReason`), not only pass records: a checkout whose whole loop was taken as
 * Claude fallbacks while Codex was capped holds no pass record at all, and omitting it
 * would make the cap path unable to land from anywhere but the authoring session.
 *
 * `repoRoot` is filtered for being a non-empty string rather than trusted. `isRecordShaped`
 * (`./ledgerStore.ts`) validates five fields and `repoRoot` is not among them, so the declared `string` type
 * asserts more than was ever checked and a `null` from disk arrives here typed as one — the same trap
 * `./ledger.ts` documents for `tree`.
 *
 * @param ownRoot the caller's checkout, already resolved, or `undefined` when it is none
 * @param records every pass record that could be read
 * @param fallbackScan every Claude fallback receipt that read, bound or not
 * @returns the distinct candidate roots, in first-seen order
 */
export function candidateRepoRoots({
  ownRoot,
  records,
  fallbackScan,
}: {
  ownRoot: string | undefined;
  records: readonly CodexArtifactRecord[];
  fallbackScan: FallbackReceiptScan;
}): readonly string[] {
  const roots = new Set<string>();
  if (ownRoot !== undefined) {
    roots.add(ownRoot);
  }
  for (const record of records) {
    if (typeof record.repoRoot === "string" && record.repoRoot.length > 0) {
      roots.add(record.repoRoot);
    }
  }
  for (const receipt of [...fallbackScan.receipts, ...fallbackScan.planReceipts]) {
    const root: unknown = receipt.request.repoRoot;
    if (typeof root === "string" && root.length > 0) {
      roots.add(root);
    }
  }
  // A foreign receipt's checkout must be ASKED, or the branch-local refusal over it could never fire.
  for (const foreign of fallbackScan.foreignReceipts) {
    roots.add(foreign.repoRoot);
  }
  // An unbound receipt's checkout likewise, or its branch-local refusal could never fire.
  for (const unbound of fallbackScan.unboundReceipts) {
    roots.add(unbound.repoRoot);
  }
  return [...roots];
}
