/**
 * `github push --self-review`'s three steps, in the order the push runs them: decode the form before any Git
 * read, resolve the token, pull request and authorship before the branch moves, and post the round only after
 * the remote head reads back as the pushed commit. Split from `./pushRun.ts`, which owns the push itself.
 */
import type { GithubPushPlan } from "../../../admit/githubPush.js";
import { githubToken } from "../../../config.js";
import type { GithubWriteApi, WrittenPr } from "../../../corpus/github/write.js";
import { err, ok, type Result } from "../../../lib/result.js";
import type { SelfReviewForm } from "../../../outbound/github/selfReview.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { GithubVerbErrors, type GithubVerbResult } from "./errors.js";
import { type GithubPushDeps, ownerRepoOf } from "./pushPrimitives.js";
import { decodeSelfReview, sendAndReportSelfReview } from "./selfReviewFlow.js";

/**
 * Parse an optional review form before the push can mutate anything, or the exit code once refused.
 *
 * @param args the parsed invocation, whose `--self-review` source is decoded when present
 * @param home the state home whose profile the form's voice rules are read from
 * @returns the decoded form, `undefined` when none was asked for, or the exit code of the refusal printed
 */
export function resolvePushSelfReview({
  args,
  deps,
  home,
}: {
  args: { readonly selfReviewSource: string | undefined };
  deps: GithubPushDeps;
  home: string;
}): Result<SelfReviewForm | undefined, number> {
  const source = args.selfReviewSource;
  if (source === undefined) {
    return ok(undefined);
  }
  const reviewDeps = deps.selfReview;
  if (reviewDeps === undefined) {
    deps.out({ line: "refused: this push driver has no self-review capability" });
    return err(EXIT_USAGE);
  }
  return decodeSelfReview({
    home,
    nothingHappened: "nothing was pushed and no review was posted.",
    out: deps.out,
    readRaw: () => reviewDeps.readForm({ source }),
  });
}

/** Resolve the open pull request and prove the token owns it before changing the branch. */
async function selfReviewTarget({
  api,
  plan,
}: {
  api: GithubWriteApi;
  plan: GithubPushPlan;
}): Promise<GithubVerbResult<WrittenPr>> {
  const { owner, repo } = ownerRepoOf({ slug: plan.repo });
  const found = await api.findOpenPrByHead({ head: plan.branch, owner, repo });
  if (found.isErr()) {
    return err(GithubVerbErrors.openPrUnread({ branch: plan.branch, cause: found.error.message, repo: plan.repo }));
  }
  if (found.value === undefined) {
    return err(GithubVerbErrors.openPrMissing({ branch: plan.branch, repo: plan.repo }));
  }
  const identity = await api.authenticatedUserId();
  if (identity.isErr()) {
    return err(GithubVerbErrors.accountUnestablished({ cause: identity.error.message }));
  }
  if (found.value.authorId !== identity.value) {
    return err(GithubVerbErrors.selfReviewNotOwnPr());
  }
  return ok(found.value);
}

/** Everything established before a push when a review round was requested. */
export interface PreparedPushSelfReview {
  readonly api: GithubWriteApi;
  readonly form: SelfReviewForm;
  readonly now: () => Date;
  readonly pr: WrittenPr;
}

/**
 * Resolve the token, current pull request and authorship before mutating its branch.
 *
 * @param form the decoded round, or `undefined` when the push carries none
 * @param plan the safe push plan, naming the branch whose open pull request is resolved
 * @returns what the post needs, `undefined` with no round, or a failure whose refusal is already printed
 */
export async function preparePushSelfReview({
  deps,
  form,
  home,
  plan,
}: {
  deps: GithubPushDeps;
  form: SelfReviewForm | undefined;
  home: string;
  plan: GithubPushPlan;
}): Promise<Result<PreparedPushSelfReview | undefined, void>> {
  if (form === undefined) {
    return ok(undefined);
  }
  const reviewDeps = deps.selfReview;
  if (reviewDeps === undefined) {
    deps.out({ line: "refused: this push driver has no self-review capability" });
    return err(undefined);
  }
  const token = githubToken({ home });
  if (token === undefined) {
    deps.out({ line: "refused: no GitHub token resolved ($SLOPWEAVER_HOME/secrets/github-token, or gh auth token)" });
    return err(undefined);
  }
  const api = reviewDeps.makeApi({ home, token });
  const target = await selfReviewTarget({ api, plan });
  if (!target.isOk()) {
    deps.out({ line: `refused: ${target.error.message}` });
    return err(undefined);
  }
  return ok({ api, form, now: reviewDeps.now, pr: target.value });
}

/**
 * Re-read the pushed head, then post the prepared round only against those exact bytes.
 *
 * @param plan the push that was just confirmed, whose local SHA the re-read head must equal
 * @param prepared what {@link preparePushSelfReview} established, or `undefined` when no round was asked for
 * @returns the process exit code
 */
export async function postPushSelfReview({
  deps,
  home,
  plan,
  prepared,
}: {
  deps: GithubPushDeps;
  home: string;
  plan: GithubPushPlan;
  prepared: PreparedPushSelfReview | undefined;
}): Promise<number> {
  if (prepared === undefined) {
    return EXIT_OK;
  }
  const { owner, repo } = ownerRepoOf({ slug: plan.repo });
  const current = await prepared.api.getPr({ number: prepared.pr.number, owner, repo });
  if (current.isErr()) {
    deps.out({
      line: `self-review refused: pushed successfully but could not read #${String(prepared.pr.number)}: ${current.error.message}`,
    });
    return EXIT_ERROR;
  }
  if (current.value.head.sha !== plan.localSha) {
    deps.out({
      line:
        `self-review refused: pushed ${plan.localSha}, but GitHub reports head ${current.value.head.sha}; ` +
        "no comment was posted against stale code",
    });
    return EXIT_ERROR;
  }
  return sendAndReportSelfReview({
    api: prepared.api,
    command: "slopweaver github push",
    deps: { doorLedger: deps.doorLedger, now: prepared.now, out: deps.out },
    form: prepared.form,
    home,
    pr: current.value,
  });
}
