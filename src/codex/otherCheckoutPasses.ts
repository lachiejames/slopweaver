/**
 * How many passes OTHER checkouts hold on a branch, for `codex status`'s one advisory line. Pure.
 *
 * `codex status` is a report about ONE checkout: its rows are judged against that checkout's own working tree, so
 * folding another worktree's rows into the table would mark them CURRENT or STALE against bytes they never read.
 * That keying is right and stays. What it hid was the other half: run from a checkout that authored nothing — the
 * landing seat's — the table printed six NOT RUN on a branch whose author had r1 and r2 BROKEN, while
 * `codex status --check` from the same checkout read them (`./landingGateRun.ts` folds every qualifying checkout). The
 * report and the gate looked like they disagreed about the record; they disagreed about the subject.
 *
 * So this counts the rows another checkout's own ledger would show, through the same fold — `ledgerForBranch` over
 * pass records and bound fallback receipts — never raw documents: a foreign or unbound receipt is a landing
 * refusal's business, not a pass anyone can read.
 */

import { candidateRepoRoots } from "./candidateRepoRoots.js";
import type { FallbackReceiptScan } from "./fallbackDocuments.js";
import { fallbackLedgerEntries } from "./fallbackPlan.js";
import { ledgerForBranch } from "./ledger.js";
import type { Supersession } from "./supersession.js";
import type { CodexArtifactRecord } from "./types.js";

/** The passes on one branch that checkouts other than the caller's hold. */
export interface OtherCheckoutPassSummary {
  /** Ledger rows across every other checkout, each counted once, in that checkout's own fold. */
  readonly passCount: number;
  /** The other checkouts holding at least one row, in candidate order. */
  readonly roots: readonly string[];
}

/**
 * Count the rows every checkout but the caller's holds on `branch`.
 *
 * @param branch the branch the report is about
 * @param ownRoot the caller's checkout, never counted
 * @param records every pass record the scan read
 * @param fallbackScan every Claude fallback receipt the scan read
 * @param supersessions the register of retired passes, so a retired row is shown exactly as its checkout would show it
 * @returns the row count and the checkouts holding them
 */
export function otherCheckoutPassSummary({
  branch,
  ownRoot,
  records,
  fallbackScan,
  supersessions,
}: {
  branch: string;
  ownRoot: string;
  records: readonly CodexArtifactRecord[];
  fallbackScan: FallbackReceiptScan;
  supersessions: ReadonlyMap<string, Supersession>;
}): OtherCheckoutPassSummary {
  const roots: string[] = [];
  let passCount = 0;
  for (const repoRoot of candidateRepoRoots({ fallbackScan, ownRoot, records })) {
    if (repoRoot === ownRoot) {
      continue;
    }
    const rows = ledgerForBranch({
      branch,
      fallbackEntries: fallbackLedgerEntries({ branch, now: undefined, repoRoot, scan: fallbackScan }),
      now: undefined,
      records,
      repoRoot,
      supersessions,
    }).entries.length;
    if (rows > 0) {
      roots.push(repoRoot);
      passCount += rows;
    }
  }
  return { passCount, roots };
}
