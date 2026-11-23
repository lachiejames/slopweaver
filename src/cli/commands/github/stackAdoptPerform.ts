/**
 * `slopweaver github stack adopt` — the write the door admits: re-read the pull request and refuse if it moved,
 * then rebase, push, and register the adoption locally and natively, ending in the lower-entry advisory. Every
 * step here runs INSIDE the door, handed to `throughDoor` as its `perform` callback by `./stackAdoptRun.ts`,
 * which keeps the argument, plan, lock and report half.
 */
import type { GithubWriteApi, WrittenPr } from "../../../corpus/github/write.js";
import { err, ok } from "../../../lib/result.js";
import { isRegisteredStackMember, registerStackMember } from "../../../outbound/github/stackLedger.js";
import { GithubVerbErrors, type GithubVerbResult } from "./errors.js";
import type { GithubPushDeps } from "./pushPrimitives.js";
import {
  type GithubStackAdoptLowerEntry,
  type GithubStackAdoptPlan,
  githubStackAdoptFreshness,
  githubStackAdoptWarning,
} from "./stackAdoptCore.js";
import { pushRebasedHead } from "./stackAdoptGit.js";
import { type GithubStackRegistrationOutcome, registerStackEntry } from "./stackRegistration.js";
import { rebaseSingleCommitOntoFreshBase } from "./stackSquash.js";

/**
 * Whether the adopted PR now sits above an unregistered, unmerged entry in its native stack, and the line to
 * report.
 *
 * **Known, accepted limitation**: `isRegisteredStackMember` collapses a genuinely-absent record and a
 * transiently-unreadable one (e.g. a permissions error) into the same `false` — matching every other reader
 * of this ledger, which treats an unreadable record as naming no PR (see `stackLedger.ts`). A rare read
 * failure could therefore make this warning fire for an entry that is actually registered. This is advisory,
 * never a refusal, and fails toward an over-cautious warning rather than a missed one — not worth widening
 * the ledger's own boolean contract to fix.
 */
async function lowerEntriesWarning({
  api,
  owner,
  repo,
  home,
  prNumber,
  registration,
}: {
  api: GithubWriteApi;
  owner: string;
  repo: string;
  home: string;
  prNumber: number;
  registration: GithubStackRegistrationOutcome;
}): Promise<string | undefined> {
  if (registration.kind !== "already-joined" && registration.kind !== "registered") {
    return undefined;
  }
  const stack = await api.getStack({ owner, repo, stackNumber: registration.stackNumber });
  if (stack.isErr()) {
    return undefined;
  }
  const index = stack.value.entries.findIndex((entry) => entry.number === prNumber);
  if (index <= 0) {
    return undefined;
  }
  const entriesBelow: readonly GithubStackAdoptLowerEntry[] = stack.value.entries.slice(0, index).map((entry) => ({
    merged: entry.mergedAtIso !== undefined,
    number: entry.number,
    registered: isRegisteredStackMember({ home, number: entry.number, owner, repo }),
  }));
  return githubStackAdoptWarning({ entriesBelow, prNumber, stackNumber: registration.stackNumber });
}

/** What the whole write actually produced. */
type StackAdoptOutcome =
  | {
      readonly kind: "adopted";
      readonly registration: GithubStackRegistrationOutcome;
      readonly warning: string | undefined;
    }
  | { readonly kind: "conflict" | "failed" | "unconfirmed"; readonly reason: string };

/**
 * Register the just-pushed adoption — locally AND natively — and compute the lower-entry warning.
 *
 * Local registration happens unconditionally once the rebase and push land — that IS what adopting means,
 * regardless of whether GitHub's own native stack registration below succeeds. The clock is read HERE, not
 * earlier: this is the actual moment of registration, and the freshness check this follows can await a slow
 * network call, so a timestamp captured before it would misreport when registration truly happened.
 */
async function registerAdoptedPr({
  plan,
  baseBranch,
  api,
  home,
  now,
}: {
  plan: GithubStackAdoptPlan;
  baseBranch: string;
  api: GithubWriteApi;
  home: string;
  now: () => Date;
}): Promise<{ readonly registration: GithubStackRegistrationOutcome; readonly warning: string | undefined }> {
  registerStackMember({
    home,
    nowIso: now().toISOString(),
    number: plan.prNumber,
    owner: plan.owner,
    repo: plan.repo,
    via: "adopt",
  });
  const registration = await registerStackEntry({
    api,
    base: baseBranch,
    defaultBranch: plan.defaultBranch,
    owner: plan.owner,
    prNumber: plan.prNumber,
    repo: plan.repo,
  });
  const warning = await lowerEntriesWarning({
    api,
    home,
    owner: plan.owner,
    prNumber: plan.prNumber,
    registration,
    repo: plan.repo,
  });
  return { registration, warning };
}

/**
 * The whole write, already inside the door: rebase, push, then register — locally AND natively.
 *
 * `baseBranch` and `headSha` come from `reconfirmFreshness`'s OWN read, immediately before this call, never
 * from `plan` — those two fields are exactly what a PR retarget or a real force-push could move between
 * planning and now, and using the plan's older snapshot here would silently re-open the window freshness
 * just closed. Everything else on `plan` (owner, repo, prNumber, the local branch, repoRoot) is not a GitHub
 * PR field freshness re-reads, so the plan's own value is still the current one.
 */
async function performStackAdopt({
  plan,
  baseBranch,
  headSha,
  api,
  home,
  remote,
  git,
  now,
}: {
  plan: GithubStackAdoptPlan;
  baseBranch: string;
  headSha: string;
  api: GithubWriteApi;
  home: string;
  remote: string;
  git: GithubPushDeps;
  now: () => Date;
}): Promise<StackAdoptOutcome> {
  const rebased = rebaseSingleCommitOntoFreshBase({ baseBranch, git, headSha, remote, worktreePath: plan.repoRoot });
  if (!rebased.isOk()) {
    return { kind: "conflict", reason: rebased.error.message };
  }
  const pushed = pushRebasedHead({
    branch: plan.branch,
    expectedRemoteSha: headSha,
    git,
    home,
    remote,
    repoRoot: plan.repoRoot,
  });
  if (pushed.kind !== "pushed") {
    return { kind: pushed.kind, reason: pushed.reason };
  }
  const { registration, warning } = await registerAdoptedPr({ api, baseBranch, home, now, plan });
  return { kind: "adopted", registration, warning };
}

/**
 * Re-confirm the pull request has not moved between planning and the door admitting the write.
 *
 * Returns the FRESH pull request on success, not just a boolean — `performStackAdopt` rebases and registers
 * against its `baseRef`/`head.sha`, never `plan`'s older snapshot, so the destructive write always acts on
 * the most recent state this process has actually observed.
 *
 * **Known, accepted residual**: this closes the window between PLANNING and this GET, but a base retarget
 * landing in the (much smaller) window between this GET returning and the fetch inside
 * `rebaseSingleCommitOntoFreshBase` starting is still possible — the same irreducible "one network read, then
 * act" gap already accepted for the head-SHA lease. It cannot drop content (the fetch and rebase still use
 * git's own graph correctly against whichever base branch NAME this read confirms); at worst it means the
 * push lands against a base this PR's OWN metadata has since stopped naming, a confusing state to notice and
 * re-run against, not a silent loss.
 *
 * @param api the GitHub write surface
 * @param plan the plan built from the earlier read
 * @param previewedPr the pull request exactly as read while building that plan
 * @returns the freshly re-read pull request, or the freshness refusal naming what moved
 */
async function reconfirmFreshness({
  api,
  plan,
  previewedPr,
}: {
  api: GithubWriteApi;
  plan: GithubStackAdoptPlan;
  previewedPr: WrittenPr;
}): Promise<GithubVerbResult<WrittenPr>> {
  const current = await api.getPr({ number: plan.prNumber, owner: plan.owner, repo: plan.repo });
  if (current.isErr()) {
    return err(GithubVerbErrors.prRereadFailed({ cause: current.error.message, number: plan.prNumber }));
  }
  const freshness = githubStackAdoptFreshness({ current: current.value, previewed: previewedPr });
  const subject = `#${String(plan.prNumber)}`;
  return freshness.fresh ? ok(current.value) : err(GithubVerbErrors.factRefused({ reason: freshness.reason, subject }));
}

/**
 * Re-confirm freshness, then perform the write — the door's own `perform` callback, split out for line count.
 *
 * @returns what the write produced: adopted with its registration and warning, or the conflict, failure or
 * unconfirmed push that stopped it
 */
export async function reconfirmAndPerform({
  api,
  plan,
  previewedPr,
  home,
  remote,
  git,
  now,
}: {
  api: GithubWriteApi;
  plan: GithubStackAdoptPlan;
  previewedPr: WrittenPr;
  home: string;
  remote: string;
  git: GithubPushDeps;
  now: () => Date;
}): Promise<StackAdoptOutcome> {
  const fresh = await reconfirmFreshness({ api, plan, previewedPr });
  if (!fresh.isOk()) {
    return { kind: "failed", reason: fresh.error.message };
  }
  return performStackAdopt({
    api,
    baseBranch: fresh.value.baseRef,
    git,
    headSha: fresh.value.head.sha,
    home,
    now,
    plan,
    remote,
  });
}
