/**
 * `slopweaver github stack push`'s locked write: the door, then amend → push → carry → write preflight → create →
 * register (or, on a branch whose pull request is open, that pull request's update), the report, and the optional
 * walkthrough post.
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
import { performUpdate } from "./performWrite.js";
import type { GithubPushDeps } from "./pushRun.js";
import { missingWalkthroughLine } from "./selfReviewCore.js";
import { postSelfReview, sendAndReportSelfReview } from "./selfReviewFlow.js";
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
import { recordRaise, reportStackPush, type SucceededWrite, walkthroughAfterReport } from "./stackPushReport.js";
import { previewedAfterStackPush, type StackPushWrite } from "./stackPushUpdate.js";
import { type GithubStackRegistrationOutcome, registerStackEntry } from "./stackRegistration.js";

/**
 * The write preflight, then the create or the update, in the one order they may run in. See `performStackPush`'s
 * own doc for why the retryable GET has to come first.
 *
 * An update is `pr update`'s own mutation: it re-reads the pull request (a retryable GET, immediately before the
 * never-retried PATCH), refuses when anything but the head this push moved has changed since the read before the
 * push, covers the exact bytes and walkthrough with a CLEAN review bound to that pull request, then confirms the
 * ledger and its kind labels. It never falls back to a create: an open pull request that closed during the push
 * is a refusal, and a re-run reads the branch again.
 *
 * @param api the client minted after the push
 * @param locus the branch locus the reservation is keyed on
 * @param out where the write prints its own progress
 * @param pushedHeadSha the commit the push landed on the branch, which an update's re-read is expected to report
 * @param write the create, or the update of the branch's open pull request, as gated before the push
 * @returns the write's outcome, or the preflight's refusal in its place
 */
async function preflightThenWrite({
  api,
  comments,
  deps,
  home,
  locus,
  out,
  plan,
  pushedHeadSha,
  write,
}: {
  api: GithubWriteApi;
  comments: readonly DescriptionReviewComment[];
  deps: Pick<GithubStackPushDeps, "autonomy" | "cwd" | "descriptionReview" | "doorLedger" | "now" | "sleep">;
  home: string;
  locus: string;
  out: (input: { line: string }) => void;
  plan: GatedStackPushPlan;
  pushedHeadSha: string;
  write: StackPushWrite;
}): Promise<PrOutcome> {
  const blocked = await stackPushWriteBlocked({ api, target: plan.form.target });
  if (blocked !== undefined) {
    return { kind: "refused", reason: blocked };
  }
  const { installationIdentifiers } = plan;
  const prDeps = toGithubPrDeps({ deps, out });
  if (write.kind === "update") {
    return performUpdate({
      api,
      comments,
      deps: prDeps,
      draft: write.draft,
      home,
      installationIdentifiers,
      locus,
      // A whole form replaces the whole description, pasted media included; the wholesale consent before the push
      // already covered that.
      pasted: [],
      previewed: previewedAfterStackPush({ previewed: write.previewed, pushedHeadSha }),
      trailing: "",
    });
  }
  return performCreate({
    api,
    comments,
    deps: prDeps,
    draft: plan.form,
    home,
    installationIdentifiers,
    locus,
  });
}

/**
 * The whole write, already inside the door: amend, push, carry, then create and register — locally AND natively —
 * or, on a branch whose pull request is already open, update that pull request.
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
  write,
}: {
  plan: GatedStackPushPlan;
  /** The create, or the update of the open pull request the early description review bound. */
  write: StackPushWrite;
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
  /** What the create or the update did. */
  readonly outcome: PrOutcome;
  /** The native stack registration a create performs; `undefined` for an update, which registers nothing. */
  readonly registration: GithubStackRegistrationOutcome | undefined;
  readonly carried: boolean;
  /**
   * The head this push put on the remote, read back from the amend (HEAD when nothing was amended), never the
   * pre-amend `plan.facts.localSha`; absent when the push never landed. The checks-read register records it.
   */
  readonly headSha: string | undefined;
}> {
  const pushed = amendAndPush({ git, home, locus, plan, remote });
  if (!pushed.isOk()) {
    return { carried: true, headSha: undefined, outcome: pushed.error, registration: undefined };
  }
  // An amend above, when one ran, REWROTE this branch's commit, so every entry stacked on it lost its base. The
  // carry runs here — after the branch is on the remote and before anything else — because a rebase onto a
  // base that has not been pushed yet replays onto the old commit.
  const carried = runStackCarry({ gate: carry, git, home, out, remote });
  const api = freshApi();
  const request = { api, comments, deps, home, locus, out, plan, pushedHeadSha: pushed.value, write };
  const outcome = await preflightThenWrite(request);
  // Only a pull request this push OPENED joins the stack and takes the create's labels; an update registers nothing
  // new, and `performUpdate` applied its own kind labels.
  if (outcome.kind !== "created") {
    return { carried, headSha: pushed.value, outcome, registration: undefined };
  }
  const registration = await registerCreated({ api, created: outcome, deps, home, plan });
  await labelCreated({ api, number: outcome.number, out, plan });
  return { carried, headSha: pushed.value, outcome, registration };
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

/**
 * After a confirmed write, the walkthrough, if one was given. An update posts it as `pr update --self-review` does:
 * re-read at the current head and checked against the description now live, then posted. A create posts it once the
 * new pull request reads back; a create given none says so.
 *
 * @param outcome the write's outcome, a create or update that reached the pull request
 * @returns the process exit code
 */
async function postWalkthrough({
  deps,
  freshApi,
  home,
  outcome,
  plan,
  selfReview,
}: {
  deps: GithubStackPushDeps;
  freshApi: () => GithubWriteApi;
  home: string;
  outcome: SucceededWrite;
  plan: GatedStackPushPlan;
  selfReview: SelfReviewForm | undefined;
}): Promise<number> {
  if (outcome.kind !== "created") {
    if (selfReview === undefined) {
      return EXIT_OK;
    }
    const { owner, repo } = plan.form.target;
    return postSelfReview({
      api: freshApi(),
      command: "slopweaver github stack push",
      deps: { ...toGithubPrDeps({ deps, out: deps.out }), env: deps.env },
      form: selfReview,
      home,
      number: outcome.number,
      owner,
      repo,
    });
  }
  if (selfReview === undefined) {
    deps.out({ line: missingWalkthroughLine({ number: outcome.number, repoSlug: plan.facts.repo }) });
    return EXIT_OK;
  }
  return postStackSelfReview({ api: freshApi(), create: outcome, deps, form: selfReview, home, plan });
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
  selfReview,
  write,
}: {
  carry: StackCarryGate;
  /** Mints a client with an empty connection pool; see `performStackPush`'s own parameter doc for why. */
  freshApi: () => GithubWriteApi;
  args: GithubStackPushArgs;
  deps: GithubStackPushDeps;
  home: string;
  locus: string;
  plan: GatedStackPushPlan;
  selfReview: SelfReviewForm | undefined;
  /** The create, or the update of the branch's open pull request, decided and gated before the lock. */
  write: StackPushWrite;
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
        remote: args.remote,
        write,
      }),
    request: githubStackPushDoorRequest({ createsWorkItem: write.kind === "create", home, plan }),
  });
  const exitCode = reportStackPush({ deps, routed });
  if (routed.performed) {
    recordRaise({ deps, home, plan, result: routed.result });
  }
  return walkthroughAfterReport({
    outcome: routed.performed ? routed.result.outcome : undefined,
    reported: exitCode,
    walk: ({ outcome }) => postWalkthrough({ deps, freshApi, home, outcome, plan, selfReview }),
  });
}
