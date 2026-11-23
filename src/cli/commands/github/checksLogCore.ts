/**
 * `github checks --log` — turning a pull request's checks snapshot into the log reads it implies, purely.
 *
 * This is the whole of what `--log` adds on top of the snapshot `checks` already takes: a failed check's
 * `detailsUrl` names its Actions run AND its job, so nothing has to be searched for. Grouping by run is not
 * cosmetic — one pull request's failed checks can belong to different runs after a re-run, and one jobs-page
 * read serves every job within a run.
 */

import type { GithubChecksSnapshot } from "../../../live/github/checks.js";
import { parseCheckLogTarget } from "../../../live/github/jobLogShape.js";

/**
 * One Actions run, and the jobs within it whose logs this read wants.
 *
 * @internal read through {@link CheckLogSelection}, which is what a caller holds.
 */
export interface CheckLogGroup {
  readonly runId: number;
  readonly jobIds: readonly number[];
}

/** What a snapshot's failed checks resolve to. */
export interface CheckLogSelection {
  readonly groups: readonly CheckLogGroup[];
  /** Failed checks whose details URL named no Actions job — a legacy Status, or another CI system. */
  readonly unreadable: readonly string[];
}

/**
 * The log reads a checks snapshot's FAILED checks imply.
 *
 * Runs are returned in the order their first failed check appears, and job ids are deduped within a run:
 * a check named twice by a truncated page must not cost two log streams.
 *
 * @param snapshot one pull request's checks, as `github checks` already read them
 * @returns the grouped reads, and the failed checks no log could be found for
 */
export function selectCheckLogs({ snapshot }: { snapshot: GithubChecksSnapshot }): CheckLogSelection {
  const byRun = new Map<number, number[]>();
  const order: number[] = [];
  const unreadable: string[] = [];
  for (const check of snapshot.checks) {
    if (check.state !== "failed") {
      continue;
    }
    const target = parseCheckLogTarget({ url: check.url });
    if (target === undefined) {
      unreadable.push(check.name);
      continue;
    }
    const existing = byRun.get(target.runId);
    if (existing === undefined) {
      byRun.set(target.runId, [target.jobId]);
      order.push(target.runId);
      continue;
    }
    if (!existing.includes(target.jobId)) {
      existing.push(target.jobId);
    }
  }
  return {
    // `order` only gains a run id on the same branch that sets its entry, so the lookup cannot miss.
    groups: order.map((runId) => ({ jobIds: byRun.get(runId)!, runId })),
    unreadable,
  };
}

/**
 * The line reported when a pull request's head carries no failed check at all.
 *
 * Its own function because it is the answer a reader most needs to be unambiguous: `--log` finding nothing
 * means the head is GREEN, not that the log read broke.
 *
 * @param snapshot the checks snapshot that carried no failure
 * @returns one line naming the head and its rollup
 */
export function noFailedCheckLine({ snapshot }: { snapshot: GithubChecksSnapshot }): string {
  return (
    `no failed check on ${snapshot.headSha} — GitHub's rollup reads ${snapshot.rollupState} over ` +
    `${String(snapshot.checks.length)} check(s), so there is no job log to read`
  );
}
