/**
 * Why a Codex pass-record scan cannot answer for a pull request — the two pure reasons the landing floor,
 * `codex status --check` and `codex supersede` share. Split out of `./landingGateRun.ts`, which reads the
 * records, along the seam between READING the evidence and JUDGING whether what was read is complete.
 */

import type { FallbackReceiptScan } from "./fallbackDocuments.js";
import type { BranchLedger } from "./ledger.js";
import type { LedgerScan } from "./ledgerStore.js";

/**
 * Why the scan could not READ everything, or `undefined` when it did — {@link incompleteScanReason} without
 * the no-tree records and the branch's foreign receipts.
 *
 * `codex supersede` asks this and not the whole question, and the difference is a measured defect: it used to
 * fail closed on `unknowable` BEFORE judging its target, so a checkout holding one no-tree record could retire
 * nothing at all — not a wording, and not the no-tree record itself, which is the one act that clears it. An
 * unreadable record could be the very pass a caller named; a no-tree record cannot hide anything from that
 * verb, because it is held by id and can never be a replacement (it is never current and never later-with-a-tree).
 *
 * @param scan what the record scan covered and what it skipped
 * @param receipts what the fallback receipt scan covered and what it could not read
 * @returns the reason, or `undefined` when every record and receipt was read
 */
export function unreadableScanReason({
  scan,
  receipts,
}: {
  scan: LedgerScan;
  receipts: FallbackReceiptScan;
}): string | undefined {
  if (receipts.unreadable > 0) {
    return (
      `${String(receipts.unreadable)} Claude fallback review receipt(s) could not be read or no longer bind to ` +
      `their request, so the review floor cannot be judged: ${receipts.problems.join("; ")}`
    );
  }
  if (scan.unreadable > 0) {
    return (
      `${String(scan.unreadable)} pass record(s) could not be parsed, so the ledger for this branch ` +
      "may be missing the newest plan or review"
    );
  }
  return undefined;
}

/**
 * Why a newer build's answer on THIS branch keeps this build from judging it, or `undefined` when there is none.
 *
 * An answered request in a mode this build has no parser for may be a BLOCKED plan or a BROKEN review that
 * outranks every row it can read, so judging the survivors could pass a branch a newer build would refuse.
 * Scoped to the exact checkout and branch, because a foreign row elsewhere says nothing about this one, and an
 * unanswered one carries no verdict at all — `./fallbackDocuments.ts` keeps only the answered, placed ones.
 *
 * @param branch the branch being judged
 * @param receipts what the fallback receipt scan covered, its placed foreign receipts among it
 * @param repoRoots the checkouts whose evidence is being judged
 * @returns the reason, naming each foreign request and the remedy, or `undefined` when none is on this branch
 */
export function foreignReceiptScanReason({
  branch,
  receipts,
  repoRoots,
}: {
  branch: string;
  receipts: FallbackReceiptScan;
  repoRoots: ReadonlySet<string>;
}): string | undefined {
  const here = receipts.foreignReceipts.filter((one) => one.branch === branch && repoRoots.has(one.repoRoot));
  if (here.length === 0) {
    return undefined;
  }
  const named = here.map((one) => `${one.requestId} (${one.mode}, in ${one.repoRoot})`);
  return (
    `${String(here.length)} Claude fallback receipt(s) on ${branch} declare a kind this build cannot read, so ` +
    `its plan or review may be the one that decides the floor: ${named.join("; ")}. Run this from a checkout ` +
    "that knows the kind — pull or rebase this one onto the base branch, then `slopweaver dev build`"
  );
}

/**
 * Why a receipt that no longer binds to its request keeps this build from judging THIS branch, or `undefined`.
 *
 * Such a receipt could be the one BROKEN review or BLOCKED plan that decides the branch it answered, so that
 * branch is not judged over the survivors. Scoped to the checkouts and branches its request or its own
 * embedded copy names (`./fallbackDocuments.ts`'s `UnboundFallbackReceipt`), because it cannot decide any other;
 * one naming nowhere is still counted install-wide by {@link unreadableScanReason}.
 *
 * @param branch the branch being judged
 * @param receipts what the fallback receipt scan covered, its placed unbound receipts among it
 * @param repoRoots the checkouts whose evidence is being judged
 * @returns the reason, naming each unbound receipt, or `undefined` when none is on this branch
 * @internal
 */
export function unboundReceiptScanReason({
  branch,
  receipts,
  repoRoots,
}: {
  branch: string;
  receipts: FallbackReceiptScan;
  repoRoots: ReadonlySet<string>;
}): string | undefined {
  const here = receipts.unboundReceipts.filter((one) => one.branch === branch && repoRoots.has(one.repoRoot));
  if (here.length === 0) {
    return undefined;
  }
  return (
    `${String(here.length)} Claude fallback receipt(s) on ${branch} no longer bind to their request, so the ` +
    `review floor for this branch cannot be judged: ${here.map((one) => one.problem).join("; ")}`
  );
}

/**
 * Why this scan cannot answer for the pull request at all, or `undefined` when it covered everything.
 *
 * A scan that SUCCEEDED can still have skipped records: `scanPassRecords` counts an unparseable one in
 * `unreadable` and walks on, and `ledgerForBranch` counts a record whose tree capture FAILED in `unknowable`.
 * Either could be the newest plan on this branch, BLOCKED — so reading the survivors as the whole ledger
 * would turn "some of the evidence is missing" into "the evidence is clean", which is the one thing this
 * module refuses everywhere else. Found by a Codex review of this change.
 *
 * It reads `unknowable` rather than the wider `unattributed`, and `BranchLedger` says why: a pass recorded on
 * a DETACHED HEAD is knowledge that it was not on this branch, not absence of it. Folding the two left a
 * checkout that had run a review mid-rebase permanently unable to land.
 *
 * `legacy` is deliberately NOT counted here: it is runs written before records existed at all, a known and
 * bounded historical set rather than something that went wrong now.
 *
 * A Claude fallback receipt that will not parse, or no longer binds to its request, is counted FIRST and for
 * the same reason: it could be the one CLEAN review the floor would otherwise accept, or the one BROKEN it
 * would otherwise refuse on, and either way the survivors cannot be judged as the whole record.
 *
 * `receipts.foreign` is deliberately NOT counted install-wide: counting it is what cost an install its review
 * floor on every branch when the plan kind landed in a newer checkout sharing the same `$SLOPWEAVER_HOME` (the
 * measurement is in `./fallbackDocuments.ts`'s § A kind this build does not know). An ANSWERED one placed on
 * the branch being judged, in a checkout being judged, refuses that branch alone — {@link foreignReceiptScanReason}.
 *
 * **The no-tree clause names its way out.** It used to say only how many, so a session could not find the
 * artifact id to act on and reached for `SLOPWEAVER_ALLOW_UNREVIEWED` instead. It now
 * names each unretired record and `codex supersede`, which retires one beside a later pass that captured a tree.
 *
 * @param scan what the record scan covered and what it skipped
 * @param ledger the merged ledger, for the passes that ran but could not be placed on a branch
 * @param receipts what the fallback receipt scan covered and what it could not read
 * @param branch the branch being judged
 * @param repoRoots the checkouts whose evidence is being judged
 * @returns the reason, or `undefined` when nothing was skipped
 */
export function incompleteScanReason({
  scan,
  ledger,
  receipts,
  branch,
  repoRoots,
}: {
  scan: LedgerScan;
  ledger: BranchLedger;
  receipts: FallbackReceiptScan;
  branch: string;
  repoRoots: ReadonlySet<string>;
}): string | undefined {
  const unreadable = unreadableScanReason({ receipts, scan });
  if (unreadable !== undefined) {
    return unreadable;
  }
  const foreign = foreignReceiptScanReason({ branch, receipts, repoRoots });
  if (foreign !== undefined) {
    return foreign;
  }
  const unbound = unboundReceiptScanReason({ branch, receipts, repoRoots });
  if (unbound !== undefined) {
    return unbound;
  }
  if (ledger.unknowable > 0) {
    const named = ledger.unplaceable
      .filter((record) => record.superseded === undefined)
      .map(
        (record) =>
          `${record.artifactId} (${record.pass} ${record.verdict}, ${record.createdAtIso}, in ${record.repoRoot})`,
      );
    return (
      `${String(ledger.unknowable)} recorded pass(es) could not capture a tree at all, so ` +
      `nothing is known about what they described: ${named.join("; ")}. Once a later pass of the same kind on ` +
      "this branch has captured a tree, retire each with " +
      "`slopweaver codex supersede --artifact <id> --reason <text> --repo <its checkout>`"
    );
  }
  return undefined;
}
