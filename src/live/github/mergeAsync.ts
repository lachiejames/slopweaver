/**
 * The POLL half of GitHub's asynchronous merge: `GET /repos/{owner}/{repo}/pulls/{pull_number}/merge-async/
 * {uuid}`, which "fetches the current result of an asynchronous merge request, identified by the UUID that
 * was returned when the merge was requested".
 *
 * It lives on the READ lane rather than beside the write in `../../corpus/github/writeQueue.ts` because it
 * is a read: repeating it is free, and the write lane's whole reason to exist is that repeating a write is
 * not (see that lane's header). GitHub retains a result for 24 hours after its last update.
 *
 * The projection itself is shared with the write — `../../corpus/github/mergeAsync.ts` — so the two halves
 * of one request can never disagree about what a status means.
 */
import { type GithubAsyncMergeState, parseGithubAsyncMergeState } from "../../corpus/github/mergeAsync.js";
import { isRecord } from "../../lib/parsers.js";
import { err, ok, type Result } from "../../lib/result.js";
import { type GithubLiveError, GithubLiveErrors } from "./errors.js";
import type { GithubReadRest } from "./read.js";

/** Read one in-flight asynchronous merge request's current state, by the uuid its acceptance named. */
export type FetchGithubAsyncMerge = (args: {
  owner: string;
  repo: string;
  number: number;
  uuid: string;
}) => Promise<Result<GithubAsyncMergeState, GithubLiveError>>;

/**
 * Build the asynchronous-merge poll over an already-safe-wrapped REST transport.
 *
 * @param rest the injected REST seam — the same one the required-contexts read rides
 * @returns a fetcher for one asynchronous merge request's current state
 */
export function makeFetchGithubAsyncMerge({ rest }: { rest: GithubReadRest }): FetchGithubAsyncMerge {
  return async ({ owner, repo, number, uuid }) => {
    const answered = await rest({
      params: { owner, pull_number: number, repo, uuid },
      route: "GET /repos/{owner}/{repo}/pulls/{pull_number}/merge-async/{uuid}",
    });
    if (answered.isErr()) {
      return err(answered.error);
    }
    const body = isRecord(answered.value) ? answered.value["data"] : undefined;
    const state = parseGithubAsyncMergeState({ data: body });
    if (state.isErr()) {
      return err(
        GithubLiveErrors.readFailed({
          message:
            `GitHub's asynchronous merge result for ${owner}/${repo}#${String(number)} (request ${uuid}) ` +
            `could not be read: ${state.error.message}`,
        }),
      );
    }
    return ok(state.value);
  };
}
