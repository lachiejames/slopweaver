/**
 * Building one `fresh-visible-session` ask dispatch's {@link VisibleSessionPlan} — its own module so
 * `cli/commands/turn/dispatch.ts` stays a thin shell over it, and because resolving the asking user's
 * display handle is a distinct small I/O step from the plan's own derivation.
 */
import { opusSpawnEffort } from "../../cmux/modelPin.js";
import { planAskSession, type VisibleSessionPlan } from "../../cmux/plan.js";
import { runningCheckoutBranch, runningCheckoutRoot } from "../../lib/gitRepo.js";
import type { DerivedRoster } from "../../silver/derivedRoster.js";
import type { IdentityRosterSnapshot } from "../../silver/identityRoster.js";
import { loadDerivedRoster } from "../../silver/loadDerivedRoster.js";
import { slackUserDisplayHandle } from "../../silver/slackUserHandle.js";
import type { AskIdentity } from "../ask/identity.js";
import { freshSessionPickupPrompt } from "./dispatch.js";
import type { RoutingJudgementInput } from "./judgement.js";
import type { RespondDecision } from "./tier.js";
import { pinnedWorkerModel } from "./workerModel.js";

/**
 * The three reads a plan takes from outside its arguments: the running checkout's root and branch (a `git`
 * call each) and the derived roster under the home (a file read). The human roster is NOT one of them: it is
 * the store's row, read once by the async caller and handed in as a snapshot, so this stays synchronous. Real
 * in production; a test passes plain functions so no repository and no home is ever read.
 */
export interface AskSessionPlanDeps {
  /** The root of the checkout this process runs from. */
  readonly checkoutRoot: () => string;
  /** That checkout's current branch, or `undefined` on a detached HEAD. */
  readonly checkoutBranch: () => string | undefined;
  /** The derived roster under the home; only its `roster` is read here. */
  readonly readDerivedRoster: (args: { readonly home: string; readonly rosterRevision: number | null }) => {
    readonly roster: DerivedRoster;
  };
}

/** The real reads: the running checkout through `git`, and the derived roster from the home. */
const PRODUCTION_ASK_SESSION_PLAN_DEPS: AskSessionPlanDeps = {
  checkoutBranch: runningCheckoutBranch,
  checkoutRoot: runningCheckoutRoot,
  readDerivedRoster: loadDerivedRoster,
};

/** The branch the plan names: a detached HEAD has none, and the plan says `detached` for exactly that. */
function checkoutBranchName({ deps }: { deps: AskSessionPlanDeps }): string {
  const branch = deps.checkoutBranch();
  if (branch == null) {
    return "detached";
  }
  return branch;
}

/**
 * The ask-driven session plan for one fresh dispatch — the current checkout, never a new worktree, with the
 * asking user resolved to a display handle through both roster layers (the human override wins, the derived
 * roster answers otherwise), falling back to the raw Slack id when unknown or ambiguous. The worker's model
 * is pinned here from the decision (`./workerModel.ts`), never inherited from a saved default.
 *
 * @param askIdentity the exact ask this dispatch is for
 * @param askQuestion the ask's raw question text, for the workspace's derived title
 * @param decision the judging session's own decision — its `model`, when named, pins the worker's tier
 * @param dispatchId the already-minted dispatch id, for the pickup prompt
 * @param home the Slopweaver home, for resolving the responding-to handle
 * @param identityRoster the store's human roster, read once by the caller; its records win the handle and its
 *   revision is what the derived roster's freshness is judged against
 * @param routingInput the decision's own routing input, for the plan's host
 * @param spawnedAt the already-captured wall-clock time of this spawn, ISO 8601
 * @param userId the asking Slack user's raw id
 * @param deps where the checkout and the derived roster are read from; omitted, the running checkout and the home
 * @returns the plan
 */
export function askSessionPlan({
  askIdentity,
  askQuestion,
  decision,
  dispatchId,
  home,
  identityRoster,
  routingInput,
  spawnedAt,
  userId,
  deps = PRODUCTION_ASK_SESSION_PLAN_DEPS,
}: {
  askIdentity: AskIdentity;
  askQuestion: string;
  decision: RespondDecision;
  dispatchId: string;
  home: string;
  identityRoster: IdentityRosterSnapshot;
  routingInput: RoutingJudgementInput;
  spawnedAt: string;
  userId: string;
  deps?: AskSessionPlanDeps;
}): VisibleSessionPlan {
  const repoRoot = deps.checkoutRoot();
  const branch = checkoutBranchName({ deps });
  const host = routingInput.execution.supervisorHost;
  const model = pinnedWorkerModel({ decision });
  const effort = opusSpawnEffort({ host, model });
  const respondingToHandle = slackUserDisplayHandle({
    derived: deps.readDerivedRoster({ home, rosterRevision: identityRoster.revision }).roster,
    overrides: identityRoster.records,
    userId,
  });
  return planAskSession({
    askChannel: askIdentity.channel,
    askMessageTs: askIdentity.messageTs,
    askQuestion,
    branch,
    ...(effort === undefined ? {} : { effort }),
    host,
    model,
    pickupCommand: freshSessionPickupPrompt({ dispatchId }),
    repoRoot,
    respondingToHandle,
    spawnedAt,
  });
}
