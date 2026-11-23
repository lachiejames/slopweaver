/**
 * Executing one planned stack step — rebase the entry's single commit onto its base's fresh tip, push it
 * with an exact lease, confirm the remote landed exactly what was sent.
 *
 * One module because `stack sync` and the push-time carry gate do the identical thing to a step and must
 * never drift into two ideas of what "this entry moved" means; only the words they PRINT differ, which is
 * what {@link stackStepOutcomeLines} takes as arguments rather than as two copies.
 *
 * The run stops at the first step that does not land. Entry N+1's base is entry N's head, so continuing past
 * a failure would replay onto a base that was never written.
 */
import { type GithubPushFacts, pushAndVerify } from "../../../admit/githubPush.js";
import { githubPushPlan, NO_BASE_FRESHNESS_ACKNOWLEDGEMENT, NO_ORPHANS_ACCEPTED } from "./pushCore.js";
import { type GithubPushDeps } from "./pushPrimitives.js";
import { rebaseSingleCommitOntoFreshBase } from "./stackSquash.js";
import type { GithubStackSyncStep } from "./stackSyncCore.js";

/** What executing one step actually produced. */
export type StackStepOutcome =
  | { readonly kind: "landed"; readonly step: GithubStackSyncStep }
  | {
      readonly kind: "conflict" | "failed" | "unconfirmed";
      readonly step: GithubStackSyncStep;
      readonly reason: string;
    };

/** Push one already-rebased step with an exact lease, then confirm the remote landed the local SHA. */
function pushStep({
  step,
  git,
  home,
  remote,
}: {
  step: GithubStackSyncStep;
  git: GithubPushDeps;
  home: string;
  remote: string;
}): StackStepOutcome {
  const localSha = git.readGit({ args: ["rev-parse", "HEAD"], cwd: step.worktreePath });
  const text = git.readGit({ args: ["ls-remote", remote, `refs/heads/${step.branch}`], cwd: step.worktreePath });
  const facts: GithubPushFacts = {
    branch: step.branch,
    defaultBranch: "", // never equals step.branch; only used by githubPushPlan's default-branch refusal
    localSha,
    remoteBranchSha: text.length === 0 ? undefined : text.split(/\s+/)[0],
    repo: "", // unused by gitArgs; githubPushPlan only reads it onto the returned plan, not into the argv
    repoRoot: step.worktreePath,
  };
  const planned = githubPushPlan({
    args: {
      baseFreshnessAcknowledgement: NO_BASE_FRESHNESS_ACKNOWLEDGEMENT,
      cwd: step.worktreePath,
      dryRun: false,
      forceWithLease: true,
      home: undefined,
      orphanAbove: NO_ORPHANS_ACCEPTED,
      remote,
      selfReviewSource: undefined,
    },
    facts,
  });
  if (!planned.isOk()) {
    return { kind: "failed", reason: planned.error.message, step };
  }
  const outcome = pushAndVerify({ deps: git, home, plan: planned.value });
  return outcome.kind === "pushed" ? { kind: "landed", step } : { kind: outcome.kind, reason: outcome.reason, step };
}

/**
 * Rebase one step onto its base's live tip and push it.
 *
 * The rebase is `stackSquash.ts`'s safe single-commit primitive — see its module doc for why this is not
 * `--fork-point`, and for every refusal it makes before touching the branch.
 *
 * @param step the entry to move, already planned
 * @param home the state home whose push-root register each push is judged against
 * @returns what happened to it
 */
function executeStackStep({
  step,
  git,
  home,
  remote,
}: {
  step: GithubStackSyncStep;
  git: GithubPushDeps;
  home: string;
  remote: string;
}): StackStepOutcome {
  // The old-history guard runs inside `pushStep`'s `pushAndVerify`, after the rebase and before the push: what
  // it must judge is the head the rebase PRODUCES, which does not exist until the base is fetched. The fetch only
  // reads the remote, so no commit is sent before the guard has passed it.
  const rebased = rebaseSingleCommitOntoFreshBase({
    baseBranch: step.baseBranch,
    git,
    headSha: step.headSha,
    remote,
    worktreePath: step.worktreePath,
  });
  return rebased.isOk()
    ? pushStep({ git, home, remote, step })
    : { kind: "conflict", reason: rebased.error.message, step };
}

/**
 * Run every step in order, stopping at the first one that does not land.
 *
 * @param steps the planned steps, ordered bottom to top
 * @param home the state home whose push-root register each push is judged against
 * @returns one outcome per ATTEMPTED step — shorter than `steps` exactly when one of them failed
 */
export function executeStackSteps({
  steps,
  git,
  home,
  remote,
}: {
  steps: readonly GithubStackSyncStep[];
  git: GithubPushDeps;
  home: string;
  remote: string;
}): readonly StackStepOutcome[] {
  const outcomes: StackStepOutcome[] = [];
  for (const step of steps) {
    const outcome = executeStackStep({ git, home, remote, step });
    outcomes.push(outcome);
    if (outcome.kind !== "landed") {
      break;
    }
  }
  return outcomes;
}

/**
 * Lines describing what actually happened, one per attempted step.
 *
 * @param landedWord the verb's own word for a step that moved — `synced` for `stack sync`, `carried` for a push
 * @param prefix what each line is prefixed with, so a carry's lines are distinguishable inside a push's report
 * @returns the report lines, in order
 */
export function stackStepOutcomeLines({
  outcomes,
  landedWord,
  prefix,
}: {
  outcomes: readonly StackStepOutcome[];
  landedWord: string;
  prefix: string;
}): readonly string[] {
  return outcomes.map((outcome) => {
    const label = `${outcome.step.branch} (PR #${String(outcome.step.pullRequestNumber)})`;
    return outcome.kind === "landed"
      ? `${prefix}${landedWord} ${label}`
      : `${prefix}${outcome.kind}: ${label} — ${outcome.reason}`;
  });
}

/**
 * Whether every planned step actually landed.
 *
 * @returns true when the plan was empty, or every step in it landed
 */
export function stackStepsFullyLanded({
  outcomes,
  steps,
}: {
  outcomes: readonly StackStepOutcome[];
  steps: readonly GithubStackSyncStep[];
}): boolean {
  return outcomes.length === steps.length && outcomes.every((outcome) => outcome.kind === "landed");
}
