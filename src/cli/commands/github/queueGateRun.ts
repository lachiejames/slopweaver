/**
 * The live read behind the queue relaxation: what one base branch's native merge queue actually gates on.
 *
 * Its own module because BOTH doors that refuse a `base-moved` head need it — `github push` and the creation
 * door `github stack push` runs — and neither is the natural owner of the other's edge. What is done with
 * the answer is decided by `queueGatedBaseMoved` in `./baseFreshnessCore.js`; nothing here judges anything.
 *
 * **Where it may be called from.** Only after any synchronous `git` child process has already run, and
 * before a write client is opened — the ordering `./stackPushGates.ts` documents at length. This opens a
 * pooled connection, and a synchronous child process while one is open is the socket death that ordering
 * exists to prevent.
 */
import { githubToken } from "../../../config.js";
import { type GithubMergeQueueApi, makeGithubMergeQueueApi } from "../../../outbound/github/mergeQueue.js";
import { githubWritePrivacy } from "../../../outbound/github/writePrivacy.js";
import type { QueueGate } from "./baseFreshnessCore.js";

/** The injectable shape of {@link readQueueGate}, so a test never opens a socket. */
export type ReadQueueGate = (args: { repo: string; branch: string; home: string }) => Promise<QueueGate | undefined>;

/**
 * Resolve one `owner/name` slug, or `undefined` when it is not one — an empty half, or a second `/`, which no
 * GitHub repository name can contain.
 */
function ownerRepoOf({ slug }: { slug: string }): { readonly owner: string; readonly repo: string } | undefined {
  const [owner, repo, ...extra] = slug.split("/");
  if (owner === undefined || repo === undefined || owner === "" || repo === "" || extra.length > 0) {
    return undefined;
  }
  return { owner, repo };
}

/**
 * Read what one base branch's native merge queue gates on, over a given credential read and queue API.
 *
 * Every failure answers `undefined` rather than an error, and that is the whole safety property: `undefined`
 * means the relaxation does not apply, so the `base-moved` refusal stands. An unreadable queue, a branch
 * with no queue at all, an unreadable rules payload, a malformed slug and a missing token are therefore all
 * the same answer, the one that changes nothing.
 *
 * @param repo the `owner/name` slug the pull request targets
 * @param branch the base branch whose queue is asked about
 * @param home the state home holding the GitHub credential
 * @param tokenFor reads the GitHub credential under a home; the installed token by default
 * @param queueApiFor opens the two queue reads over a token; the pooled GitHub client by default
 * @returns what that branch's queue gates on, or `undefined` when it could not be established
 */
export async function readQueueGateVia({
  repo,
  branch,
  home,
  tokenFor = githubToken,
  queueApiFor = ({ token: queueToken, home: queueHome }) =>
    makeGithubMergeQueueApi({ privacy: githubWritePrivacy({ home: queueHome }), token: queueToken }),
}: {
  repo: string;
  branch: string;
  home: string;
  tokenFor?: (args: { home: string }) => string | undefined;
  queueApiFor?: (args: { token: string; home: string }) => Pick<GithubMergeQueueApi, "queue" | "requiredContexts">;
}): Promise<QueueGate | undefined> {
  const token = tokenFor({ home });
  if (token === undefined) {
    return undefined;
  }
  const address = ownerRepoOf({ slug: repo });
  if (address === undefined) {
    return undefined;
  }
  const api = queueApiFor({ home, token });
  const queue = await api.queue({ branch, owner: address.owner, repo: address.repo });
  if (queue.isErr() || queue.value === undefined) {
    return undefined;
  }
  const contexts = await api.requiredContexts({ branch, owner: address.owner, repo: address.repo });
  if (contexts.isErr()) {
    return undefined;
  }
  return { branch, contexts: contexts.value.contexts, url: queue.value.url };
}

/**
 * Read what one base branch's native merge queue gates on, in the same two reads `github enqueue` takes.
 *
 * @param repo the `owner/name` slug the pull request targets
 * @param branch the base branch whose queue is asked about
 * @param home the state home holding the GitHub credential
 * @returns what that branch's queue gates on, or `undefined` when it could not be established
 */
export const readQueueGate: ReadQueueGate = ({ repo, branch, home }) => readQueueGateVia({ branch, home, repo });
