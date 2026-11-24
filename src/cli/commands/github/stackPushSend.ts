/**
 * `slopweaver github stack push`'s locked write: the door, then amend → push → carry → write preflight → create →
 * register, the report, and the optional walkthrough post.
 *
 * Split out of `./stackPushRun.ts` (the file-size ratchet, step 5), which still resolves the plan this file sends
 * and takes the operation lock; it calls {@link sendStackPush} once that lock is held.
 */

import { DEFAULT_GATES } from "../../../admit/door.js";
import { throughDoor } from "../../../admit/effects.js";
import type { GithubWriteApi } from "../../../corpus/github/write.js";
import type { DescriptionReviewComment } from "../../../outbound/github/descriptionReviewTypes.js";
import { renderSelfReviewComments, type SelfReviewForm } from "../../../outbound/github/selfReview.js";
import { registerStackMember } from "../../../outbound/github/stackLedger.js";
import { EXIT_ERROR, EXIT_OK } from "../../exitCodes.js";
import type { PrOutcome } from "./core.js";
import { applyKindLabels } from "./kindLabelApply.js";
import { performCreate } from "./performCreate.js";
import type { DescriptionPullRequest } from "./prDescriptionReviewCore.js";
import type { GithubPushDeps } from "./pushRun.js";
import { missingWalkthroughLine } from "./selfReviewCore.js";
import { sendAndReportSelfReview } from "./selfReviewFlow.js";
import { runStackCarry, type StackCarryGate } from "./stackCarryRun.js";
import {
  type GatedStackPushPlan,
  type GithubStackPushArgs,
  type GithubStackPushPlan,
  githubStackPushDoorRequest,
} from "./stackPushCore.js";
import { type GithubStackPushDeps, toGithubPrDeps } from "./stackPushDeps.js";
import { stackPushWriteBlocked } from "./stackPushGates.js";
import { amendAndPush } from "./stackPushGit.js";
import { recordRaise, reportStackPush } from "./stackPushReport.js";
import { type GithubStackRegistrationOutcome, registerStackEntry } from "./stackRegistration.js";

/**
 * The write preflight and the create itself, in the one order they may run in. See `performStackPush`'s own
 * doc for why the retryable GET has to come first.
 *
 * @param api the client minted after the push
 * @param locus the branch locus the reservation is keyed on
 * @param out where `performCreate` prints its own progress
 * @returns the create outcome, or the preflight's refusal in its place
 */
async function preflightThenCreate({
  api,
  comments,
  deps,
  home,
  locus,
  out,
  plan,
  pullRequest,
}: {
  api: GithubWriteApi;
  comments: readonly DescriptionReviewComment[];
  deps: Pick<GithubStackPushDeps, "autonomy" | "cwd" | "descriptionReview" | "doorLedger" | "now" | "sleep">;
  home: string;
  locus: string;
  out: (input: { line: string }) => void;
  plan: GatedStackPushPlan;
  pullRequest: DescriptionPullRequest;
}): Promise<PrOutcome> {
  const blocked = await stackPushWriteBlocked({ api, target: plan.form.target });
  if (blocked !== undefined) {
    return { kind: "refused", reason: blocked };
  }
  const { form: draft, installationIdentifiers } = plan;
  return performCreate({
    api,
    comments,
    deps: toGithubPrDeps({ deps, out }),
    draft,
    home,
    installationIdentifiers,
    locus,
    pullRequest,
  });
}

/**
 * The whole write, already inside the door: amend, push, carry, create, then register — locally AND natively.
 *
 * **The write preflight runs HERE, after the push and immediately before the create, and that placement is
 * the fix for a measured data-losing failure.** The push is a synchronous child process streaming this
 * repository's pre-push gate — 444s and 1314s on two runs, MEASURED (`time yarn validate` under
 * fleet load; the hook now runs `yarn validate:local`, shorter but still minutes). Any keep-alive socket an earlier GET left behind is dead by then, and the create POST
 * inherits it: `UNCONFIRMED: the create call failed (write EPIPE)` twice, with the branch already on the
 * remote — the unrecoverable half of this verb's contract. Minting a fresh `GithubWriteApi` does NOT fix it,
 * measured: Octokit shares undici's global dispatcher, so a new instance reuses the same dead connection.
 * What fixes it is that `canPush` is `retryMode: "transient"` while the create is `retryMode: "never"` — so
 * running the retryable GET first absorbs the dead socket and hands the irreversible POST a live one. Plain
 * `pr create` never met this because it never pushed; `stack push` always does. Pinned by
 * `stackPushCreation.test.ts`.
 */
async function performStackPush({
  plan,
  carry,
  comments,
  freshApi,
  home,
  locus,
  remote,
  git,
  deps,
  out,
  pullRequest,
}: {
  plan: GatedStackPushPlan;
  /** The pull request the early description review bound; the create's review binds the same one. */
  pullRequest: DescriptionPullRequest;
  /** What the carry gate decided BEFORE the door — see `./stackCarryRun.ts` for why that order is the contract. */
  carry: StackCarryGate;
  /** The walkthrough this push posts after the create, exactly as GitHub receives it; the review binds it. */
  comments: readonly DescriptionReviewComment[];
  freshApi: () => GithubWriteApi;
  home: string;
  locus: string;
  remote: string;
  git: GithubPushDeps;
  deps: Pick<GithubStackPushDeps, "autonomy" | "cwd" | "descriptionReview" | "doorLedger" | "now" | "sleep">;
  out: (input: { line: string }) => void;
}): Promise<{
  readonly create: PrOutcome;
  readonly registration: GithubStackRegistrationOutcome | undefined;
  readonly carried: boolean;
  /**
   * The head this push actually put on the remote, absent when the push never landed.
   *
   * Read back from the amend rather than taken from `plan.facts.localSha`, which was measured BEFORE any
   * amend rewrote the commit; HEAD itself when there was nothing to amend. It is what the checks-read register
   * records the raise against.
   */
  readonly headSha: string | undefined;
}> {
  const pushed = amendAndPush({ git, home, locus, plan, remote });
  if (!pushed.isOk()) {
    return { carried: true, create: pushed.error, headSha: undefined, registration: undefined };
  }
  // An amend above, when one ran, REWROTE this branch's commit, so every entry stacked on it lost its base. The
  // carry runs here — after the branch is on the remote and before anything else — because a rebase onto a
  // base that has not been pushed yet replays onto the old commit.
  const carried = runStackCarry({ gate: carry, git, home, out, remote });
  const api = freshApi();
  const created = await preflightThenCreate({ api, comments, deps, home, locus, out, plan, pullRequest });
  if (created.kind !== "created") {
    return { carried, create: created, headSha: pushed.value, registration: undefined };
  }
  const registration = await registerCreated({ api, created, deps, home, plan });
  await labelCreated({ api, number: created.number, out, plan });
  return { carried, create: created, headSha: pushed.value, registration };
}

/**
 * A pull request `stack push` just created is the owner's own, on this repository, so its kind labels are derived
 * from its title and applied here; a label that cannot be is a warning, never the create's outcome.
 */
async function labelCreated({
  api,
  number,
  out,
  plan,
}: {
  api: GithubWriteApi;
  number: number;
  out: (input: { line: string }) => void;
  plan: GatedStackPushPlan;
}): Promise<void> {
  const { owner, repo } = plan.form.target;
  const labelled = await applyKindLabels({ api, target: { number, owner, repo, title: plan.form.title } });
  for (const line of labelled) {
    out({ line });
  }
}

/**
 * Register a freshly created pull request, locally AND natively.
 *
 * Local registration happens regardless of the NATIVE registration outcome — this PR was created by
 * `stack push`, which is exactly what makes it part of local stack state, per the local-state registration
 * scope design rule. `stack sync`'s own discovery reads from this ledger, never from GitHub authorship.
 *
 * @returns what the native registration did, or why it could not be decided
 */
async function registerCreated({
  api,
  created,
  deps,
  home,
  plan,
}: {
  api: GithubWriteApi;
  created: Extract<PrOutcome, { kind: "created" }>;
  deps: { now: () => Date };
  home: string;
  plan: GithubStackPushPlan;
}): Promise<GithubStackRegistrationOutcome> {
  registerStackMember({
    home,
    nowIso: deps.now().toISOString(),
    number: created.number,
    owner: plan.form.target.owner,
    repo: plan.form.target.repo,
    via: "push",
  });
  return registerStackEntry({
    api,
    base: plan.form.target.base,
    defaultBranch: plan.facts.defaultBranch,
    owner: plan.form.target.owner,
    prNumber: created.number,
    repo: plan.form.target.repo,
  });
}

/** Post a walkthrough only after the newly created stack entry reads back from GitHub. */
async function postStackSelfReview({
  api,
  create,
  deps,
  form,
  home,
  plan,
}: {
  api: GithubWriteApi;
  create: Extract<PrOutcome, { kind: "created" }>;
  deps: GithubStackPushDeps;
  form: SelfReviewForm;
  home: string;
  plan: GithubStackPushPlan;
}): Promise<number> {
  const current = await api.getPr({
    number: create.number,
    owner: plan.form.target.owner,
    repo: plan.form.target.repo,
  });
  if (current.isErr()) {
    deps.out({
      line: `self-review refused: could not read #${String(create.number)} at its current head: ${current.error.message}`,
    });
    return EXIT_ERROR;
  }
  return sendAndReportSelfReview({ api, command: "slopweaver github stack push", deps, form, home, pr: current.value });
}

/** The part of the verb's deps the locked write itself reads. */
function lockedWriteDeps({ deps }: { deps: GithubStackPushDeps }): Parameters<typeof performStackPush>[0]["deps"] {
  return {
    autonomy: deps.autonomy,
    cwd: deps.cwd,
    descriptionReview: deps.descriptionReview,
    doorLedger: deps.doorLedger,
    now: deps.now,
    sleep: deps.sleep,
  };
}

/**
 * Run the already-locked stack write, report it, then attach the optional walkthrough.
 *
 * @returns the process exit code
 */
export async function sendStackPush({
  carry,
  freshApi,
  args,
  deps,
  home,
  locus,
  plan,
  pullRequest,
  selfReview,
}: {
  carry: StackCarryGate;
  /** Mints a client with an empty connection pool; see `performStackPush`'s own parameter doc for why. */
  freshApi: () => GithubWriteApi;
  args: GithubStackPushArgs;
  deps: GithubStackPushDeps;
  home: string;
  locus: string;
  plan: GatedStackPushPlan;
  pullRequest: DescriptionPullRequest;
  selfReview: SelfReviewForm | undefined;
}): Promise<number> {
  const routed = await throughDoor({
    gates: DEFAULT_GATES,
    home,
    ledger: deps.doorLedger,
    perform: () =>
      performStackPush({
        carry,
        comments: renderSelfReviewComments({ form: selfReview }),
        deps: lockedWriteDeps({ deps }),
        freshApi,
        git: deps.git,
        home,
        locus,
        out: deps.out,
        plan,
        pullRequest,
        remote: args.remote,
      }),
    request: githubStackPushDoorRequest({ home, plan }),
  });
  const exitCode = reportStackPush({ deps, routed });
  if (routed.performed) {
    recordRaise({ deps, home, plan, result: routed.result });
  }
  if (exitCode !== EXIT_OK || !routed.performed || routed.result.create.kind !== "created") {
    return exitCode;
  }
  if (selfReview === undefined) {
    deps.out({ line: missingWalkthroughLine({ number: routed.result.create.number, repoSlug: plan.facts.repo }) });
    return exitCode;
  }
  return postStackSelfReview({ api: freshApi(), create: routed.result.create, deps, form: selfReview, home, plan });
}
