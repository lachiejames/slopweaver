/**
 * The lines `codex status` prints under its ledger table: what the table's subject leaves out. Pure.
 *
 * Moved out of `./statusRun.ts`, which sits past the file-size ratchet, so the OTHER CHECKOUTS line could join
 * the two it sits beside rather than grow that file. Each line answers the same question — "what is true of this
 * branch that the table above does not show" — and each prints only when it has something to say, so a clean
 * report is unchanged.
 */

import type { FallbackReceiptScan } from "../../../codex/fallbackDocuments.js";
import { shortDigest, type TreeFingerprint } from "../../../codex/fingerprint.js";
import type { OtherCheckoutPassSummary } from "../../../codex/otherCheckoutPasses.js";

/**
 * Every context line under the table, in print order: DIRTY, OTHER CHECKOUTS, then the fallback scan's.
 *
 * @param branch the branch the report is about, named in the OTHER CHECKOUTS line
 * @param localPassCount how many rows the table above printed for this checkout
 * @param now the working tree the rows were judged against, absent when it could not be captured
 * @param otherCheckouts the rows other checkouts hold on the same branch
 * @param receipts what the Claude fallback receipt scan found
 * @returns the lines, empty when nothing needs saying
 */
export function statusContextLines({
  branch,
  localPassCount,
  now,
  otherCheckouts,
  receipts,
}: {
  branch: string;
  localPassCount: number;
  now: TreeFingerprint | undefined;
  otherCheckouts: OtherCheckoutPassSummary;
  receipts: FallbackReceiptScan;
}): readonly string[] {
  return [
    ...dirtyTreeLines({ now }),
    ...otherCheckoutLines({ branch, localPassCount, otherCheckouts }),
    ...fallbackScanLines({ receipts }),
  ];
}

/**
 * The `DIRTY:` line: the rows above were judged against uncommitted bytes a landing will not carry.
 *
 * Printed only over a dirty tree, so a clean checkout's report is unchanged. Without it a row reads CURRENT here
 * and STALE at `github enqueue` with nothing on either page saying why (`codex/checkoutLandingFloor.ts`).
 */
function dirtyTreeLines({ now }: { now: TreeFingerprint | undefined }): readonly string[] {
  if (now === undefined || now.dirtyBytes === 0) {
    return [];
  }
  return [
    `DIRTY: the rows above are judged against the working tree, which carries ${String(now.dirtyBytes)} byte(s) ` +
      `of uncommitted change on HEAD ${shortDigest({ value: now.headSha })}; --check and github enqueue judge ` +
      "the commit, where a pass that read those bytes is STALE — commit or discard them, then take that pass again",
  ];
}

/**
 * The `OTHER CHECKOUTS:` line: this checkout holds no row on the branch, but another one does.
 *
 * MEASURED: from the landing seat's worktree, the table for one pull request's branch printed six NOT RUN while its author's
 * checkout held r1 and r2 BROKEN, and `--check` from the same seat refused on them. The table was right about its
 * subject and silent about the record a landing reads, so a reader concluded the gate read an empty record.
 * Printed only when the table is empty: a checkout with its own rows is reading its own loop, and saying more there
 * would be noise on every authoring session's report.
 */
function otherCheckoutLines({
  branch,
  localPassCount,
  otherCheckouts,
}: {
  branch: string;
  localPassCount: number;
  otherCheckouts: OtherCheckoutPassSummary;
}): readonly string[] {
  if (localPassCount > 0 || otherCheckouts.passCount === 0) {
    return [];
  }
  return [
    `OTHER CHECKOUTS: this checkout has no pass on ${branch}, but ${String(otherCheckouts.passCount)} pass(es) ` +
      `are recorded for that branch under ${String(otherCheckouts.roots.length)} other checkout root(s): ` +
      `${otherCheckouts.roots.join(", ")}; this table stays per-checkout, while --check, github enqueue and ` +
      "github merge --admin fold every qualifying checkout that holds the head commit",
  ];
}

/** What the Claude fallback scan adds under the ledger: pending requests and foreign ones. */
function fallbackScanLines({ receipts }: { receipts: FallbackReceiptScan }): readonly string[] {
  const lines: string[] = [];
  if (receipts.pending > 0) {
    lines.push(`PENDING: ${String(receipts.pending)} Claude fallback review request(s) prepared and not yet recorded`);
  }
  if (receipts.pendingPlans > 0) {
    lines.push(
      `PENDING: ${String(receipts.pendingPlans)} Claude fallback plan request(s) prepared and not yet recorded`,
    );
  }
  if (receipts.foreign > 0) {
    lines.push(
      `FOREIGN: ${String(receipts.foreign)} fallback request(s) declare a kind this build cannot read ` +
        `(${receipts.foreignModes.join(", ")}) — an answered one on the branch being judged makes ` +
        "`--check` and the landing verbs refuse that branch; this checkout is behind whichever one wrote them, " +
        "so rebase before trusting the counts above",
    );
  }
  return lines;
}
