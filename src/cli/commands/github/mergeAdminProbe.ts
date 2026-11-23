/**
 * The post-merge docs-budget probe `github merge --admin` runs once a merge lands, and the production edge it
 * probes through.
 *
 * Its own module because it decides nothing about the merge: `./mergeAdminRun.ts` holds the order and every
 * refusal, and calls this only after GitHub has merged. See that module's header for why the probe exists
 * alongside the pre-merge check `mergeRun.ts` already runs.
 */

import { type MergeDocsBudgetSweep, sweepMergeDocsBudget } from "../../../outbound/github/docsBudgetSweep.js";
import { deletePrivateRef, fetchBranchIntoPrivateRef, newPrivateFetchRef } from "./gitAncestry.js";
import { postMergeDocsBudgetOutcome } from "./mergeAdminCore.js";
// Type-only, so it is erased at runtime and the pair is not a module cycle: `./mergeAdminRun.ts` imports this
// module's functions as VALUES, and this one takes only the deps' shape back.
import type { GithubAdminMergeDeps } from "./mergeAdminTypes.js";
import { productionGithubPushDeps } from "./pushRun.js";

/**
 * Once a merge lands, fetch the base branch's live tip fresh and probe its own docs budget — printing what it
 * found, and publishing to the supervisor stream only on a real crossing.
 *
 * @param repo the `owner/name` the alert names
 * @param repoRoot the repository root the fetch runs in
 * @param baseBranch the branch just merged into
 */
export function runPostMergeDocsBudgetProbe({
  deps,
  home,
  repo,
  remote,
  repoRoot,
  baseBranch,
}: {
  deps: Pick<GithubAdminMergeDeps, "nowIso" | "out" | "probePostMergeDocsBudget" | "publishAlert">;
  home: string;
  repo: string;
  remote: string;
  repoRoot: string;
  baseBranch: string;
}): void {
  const sweep = deps.probePostMergeDocsBudget({ baseBranch, cwd: repoRoot, remote });
  const probe = postMergeDocsBudgetOutcome({ baseBranch, repo, sweep });
  for (const line of probe.lines) {
    deps.out({ line });
  }
  if (probe.alertWhy !== undefined) {
    deps.publishAlert({
      event: { atIso: deps.nowIso(), kind: "main-gate-failed", repo, source: "github-merge", why: probe.alertWhy },
      home,
    });
  }
}

/**
 * Fetch `baseBranch`'s live tip from `remote` into a private ref, sweep its own docs budget, and always clean
 * the ref up — the same fetch-measure-cleanup shape `baseFreshnessRun.ts`'s `measureAgainstFetchedDefault`
 * uses, reused here for the post-merge probe rather than the base-freshness ancestry check.
 *
 * @param cwd the repository root
 * @param remote the configured Git remote
 * @param baseBranch the branch just merged into
 * @returns the swept docs budget, or why the fresh tip could not be fetched
 */
export function productionProbePostMergeDocsBudget({
  cwd,
  remote,
  baseBranch,
}: {
  cwd: string;
  remote: string;
  baseBranch: string;
}): MergeDocsBudgetSweep {
  const git = productionGithubPushDeps();
  const ref = newPrivateFetchRef();
  try {
    const fetched = fetchBranchIntoPrivateRef({ branch: baseBranch, cwd, git, ref, remote });
    if (fetched.isErr()) {
      return {
        kind: "not-evaluated",
        reason: `could not fetch ${remote}/${baseBranch} to probe it post-merge: ${fetched.error.message}`,
      };
    }
    return sweepMergeDocsBudget({ baseRef: ref, headRef: ref, repoRoot: cwd });
  } finally {
    const deleted = deletePrivateRef({ cwd, git, ref });
    if (deleted.isErr()) {
      git.out({ line: `warning: could not delete private ref ${ref}: ${deleted.error.message}` });
    }
  }
}
