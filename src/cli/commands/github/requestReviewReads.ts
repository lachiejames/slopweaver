/**
 * The two provider reads `github pr request-review` makes, each converted from neverthrow's `ResultAsync` into the
 * command's small ordinary `Result`.
 *
 * Split out of {@link ./requestReviewRun.js} (the file-size ratchet), which states the order the verb runs its phases
 * in. The parameters name only the API method each read calls, so a test hands the one method it means rather than the
 * whole write API.
 */
import type { GithubWriteApi, RequestedReviewers, WrittenPr } from "../../../corpus/github/write.js";
import { GithubVerbErrors, type GithubVerbResult } from "./errors.js";
import type { GithubPrRequestReviewArgs } from "./requestReviewCore.js";

/**
 * Read the pull request, as a command `Result` whose failure names which pull request was unread.
 *
 * @returns the pull request as GitHub holds it, or the typed failure naming the one that was unread
 */
export async function readPr({
  api,
  args,
}: {
  api: Pick<GithubWriteApi, "getPr">;
  args: GithubPrRequestReviewArgs;
}): Promise<GithubVerbResult<WrittenPr>> {
  const { owner, repo, number } = args;
  const read = await api.getPr({ number, owner, repo });
  return read.mapErr((error) => GithubVerbErrors.prUnread({ cause: error.message, number, owner, repo }));
}

/**
 * Read the pull request's currently requested reviewers, as a command `Result`.
 *
 * @returns the users and teams already requested, or the typed failure of the read
 */
export async function readRequested({
  api,
  args,
}: {
  api: Pick<GithubWriteApi, "requestedReviewers">;
  args: GithubPrRequestReviewArgs;
}): Promise<GithubVerbResult<RequestedReviewers>> {
  const read = await api.requestedReviewers({ number: args.number, owner: args.owner, repo: args.repo });
  const operation = "requested reviewers";
  return read.mapErr((error) => GithubVerbErrors.upstreamRefused({ operation, reasons: [error.message] }));
}
