/**
 * The pass records and fallback receipts as the readers of ONE branch should see them: everything a proven
 * predecessor recorded inside its window (`./branchContinuity.ts`) shown under the judged branch's name. Pure.
 *
 * Applied once, where a reader has scanned the evidence and before it partitions checkouts or folds a ledger, so
 * every downstream filter (`ledgerForBranch`, `partitionCandidateRoots`, `reviewBaseRefs`, `fallbackLedgerEntries`,
 * `incompleteScanReason`) stays the exact branch match it always was. Nothing here is persisted: a record on disk
 * keeps the branch it was taken on, and only the in-memory view handed to one branch's readers is relabelled.
 *
 * Relabelling changes WHERE a row is counted and nothing about whether it still describes the code. A review is
 * still CURRENT only by its tree fingerprint or the unchanged-rebase diff carry (`./diffCarry.ts`), and a plan is
 * still required STALE, so a predecessor's review over a tree that has since changed stays STALE under the new name.
 */

import type { BranchContinuity, CarryWindow } from "./branchContinuity.js";
import type { FallbackReceiptScan } from "./fallbackDocuments.js";
import type { LedgerScan } from "./ledgerStore.js";
import type { CodexArtifactRecord } from "./types.js";

/** The two scans a branch's readers fold, as that branch should see them. */
export interface BranchEvidence {
  readonly scan: LedgerScan;
  readonly receipts: FallbackReceiptScan;
}

/**
 * Whether a window covers evidence recorded in `root`.
 *
 * @param window the predecessor's window
 * @param root the checkout the evidence names; read through `unknown` because no parser validates it
 * @param roots every checkout of the repository, the scope of a rename's window
 * @returns true when the checkout is in the window's scope
 */
function inScope({ window, root, roots }: { window: CarryWindow; root: unknown; roots: ReadonlySet<string> }): boolean {
  if (typeof root !== "string") {
    return false;
  }
  if (window.root === undefined) {
    return roots.has(root);
  }
  return window.root === root;
}

/**
 * Whether an instant falls inside a window, at the reflog's one-second grain.
 *
 * @param window the predecessor's window
 * @param atIso when the evidence was recorded; one that does not parse is never carried
 * @returns true when the evidence predates the link and postdates the predecessor's previous continuation
 */
function inWindow({ window, atIso }: { window: CarryWindow; atIso: unknown }): boolean {
  const atMs = typeof atIso === "string" ? Date.parse(atIso) : Number.NaN;
  if (Number.isNaN(atMs)) {
    return false;
  }
  const atSeconds = Math.floor(atMs / 1000);
  const afterPrevious = window.afterEpochSeconds === undefined || atSeconds > window.afterEpochSeconds;
  return afterPrevious && atSeconds <= window.throughEpochSeconds;
}

/**
 * Whether evidence recorded under `branch` in `root` counts for the judged branch.
 *
 * @param continuity the judged branch's proven predecessors
 * @param branch the branch the evidence was recorded on
 * @param root the checkout it was recorded in
 * @param atIso when it was recorded; one that does not parse is never carried
 * @returns true when a predecessor's window covers it
 */
function carried({
  continuity,
  branch,
  root,
  atIso,
}: {
  continuity: BranchContinuity;
  branch: unknown;
  root: unknown;
  atIso: unknown;
}): boolean {
  if (typeof branch !== "string" || branch === continuity.target) {
    return false;
  }
  return continuity.windows.some(
    (window) =>
      window.branch === branch && inScope({ root, roots: continuity.roots, window }) && inWindow({ atIso, window }),
  );
}

/**
 * A pass record under the judged branch's name when a predecessor's window covers it, else the record itself.
 *
 * @param continuity the judged branch's proven predecessors
 * @param record one pass record as read from disk
 * @returns the record to fold
 */
function viewRecord({
  continuity,
  record,
}: {
  continuity: BranchContinuity;
  record: CodexArtifactRecord;
}): CodexArtifactRecord {
  const tree = record.tree;
  if (
    tree == null ||
    !carried({ atIso: record.createdAtIso, branch: tree.branch, continuity, root: record.repoRoot })
  ) {
    return record;
  }
  return { ...record, tree: { ...tree, branch: continuity.target } };
}

/**
 * A bound receipt under the judged branch's name when a predecessor's window covers the request it answers.
 *
 * Judged on the REQUEST's instant, because the request is what captured the tree.
 *
 * @param continuity the judged branch's proven predecessors
 * @param receipt a bound review or plan receipt
 * @returns the receipt to fold
 */
function viewReceipt<
  T extends {
    readonly request: {
      readonly createdAtIso: string;
      readonly repoRoot: string;
      readonly tree: { readonly branch: string | null };
    };
  },
>({ continuity, receipt }: { continuity: BranchContinuity; receipt: T }): T {
  const { request } = receipt;
  const atIso = request.createdAtIso;
  if (!carried({ atIso, branch: request.tree.branch, continuity, root: request.repoRoot })) {
    return receipt;
  }
  return { ...receipt, request: { ...request, tree: { ...request.tree, branch: continuity.target } } };
}

/**
 * The continuity with every window dropped whose predecessor, in its scope, holds a foreign or unbound placement.
 *
 * A placement is a receipt this build cannot judge, and it names a branch and a checkout but no instant, so no
 * window can be shown to cover it. Relabelling it would carry it without a proven window, and leaving it while
 * carrying the predecessor's judgeable rows would let the successor keep a pass the unjudgeable receipt might
 * contradict. So that predecessor carries nothing: its rows stay on its own name, exactly as before continuity.
 *
 * @param continuity the judged branch's proven predecessors
 * @param receipts every Claude fallback receipt and placement the scan classified
 * @returns the continuity whose every window may be carried
 */
function withoutPlacedPredecessors({
  continuity,
  receipts,
}: {
  continuity: BranchContinuity;
  receipts: FallbackReceiptScan;
}): BranchContinuity {
  const placements = [...receipts.foreignReceipts, ...receipts.unboundReceipts];
  const windows = continuity.windows.filter(
    (window) =>
      !placements.some(
        (placement) =>
          placement.branch === window.branch && inScope({ root: placement.repoRoot, roots: continuity.roots, window }),
      ),
  );
  return { ...continuity, windows };
}

/**
 * Whether any row names a branch other than `branch`: the only rows a continuity could relabel. When none does,
 * reading the reflogs could change nothing, so a reader skips the git read.
 *
 * @param branch the branch being judged
 * @param scan every pass record that could be read
 * @param receipts every Claude fallback receipt and placement the scan classified
 * @returns true when some row was recorded under another branch name
 */
export function namesAnotherBranch({
  branch,
  scan,
  receipts,
}: {
  branch: string;
  scan: LedgerScan;
  receipts: FallbackReceiptScan;
}): boolean {
  const named = [
    ...scan.records.map((record) => record.tree?.branch),
    ...[...receipts.receipts, ...receipts.planReceipts].map((receipt) => receipt.request.tree.branch),
    ...[...receipts.foreignReceipts, ...receipts.unboundReceipts].map((placement) => placement.branch),
  ];
  return named.some((one) => typeof one === "string" && one !== branch);
}

/**
 * The evidence as the judged branch's readers should fold it.
 *
 * @param continuity the judged branch's proven predecessors
 * @param scan every pass record that could be read
 * @param receipts every Claude fallback receipt and placement the scan classified
 * @returns both scans, with every carried row relabelled and every other row the same object it was; a placement
 *   is never relabelled
 */
export function evidenceForBranch({
  continuity: proven,
  scan,
  receipts,
}: {
  continuity: BranchContinuity;
  scan: LedgerScan;
  receipts: FallbackReceiptScan;
}): BranchEvidence {
  const continuity = withoutPlacedPredecessors({ continuity: proven, receipts });
  if (continuity.windows.length === 0) {
    return { receipts, scan };
  }
  return {
    receipts: {
      ...receipts,
      planReceipts: receipts.planReceipts.map((receipt) => viewReceipt({ continuity, receipt })),
      receipts: receipts.receipts.map((receipt) => viewReceipt({ continuity, receipt })),
    },
    scan: { ...scan, records: scan.records.map((record) => viewRecord({ continuity, record })) },
  };
}
