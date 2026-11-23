/**
 * `github repo --set-public`: make a repository public, on the preview's digest.
 *
 * The least reversible write the verb has: once anyone has read the code, making it private again does not take it
 * back. So the preview names what GitHub documents happening with it, and the digest binds the repository's
 * immutable id and its visibility, privacy and archive state as read — a repository that moved or changed since the
 * preview holds the write. Success is a read-back of the same id showing `public`.
 */

import { formatIngestError } from "../../../lib/ingestError.js";
import { err, ok } from "../../../lib/result.js";
import type { GithubRepoLifecycleApi, RepoLifecycleState } from "../../../outbound/github/repoLifecycle.js";
import { GithubVerbErrors, type GithubVerbResult } from "./errors.js";
import { type ApprovedRepoWrite, type ApprovedWriteOutcome, upstreamRefusedOf } from "./repoApprovedWrite.js";

/**
 * What GitHub documents making a private repository public does beyond the code itself, as an approval accepts it.
 * Source: GitHub's "Setting repository visibility" documentation.
 */
export const SET_PUBLIC_CONSEQUENCES: readonly string[] = [
  "every file and every commit in its history becomes readable by anyone",
  "private forks are detached from it and stay private",
  "its GitHub Actions history and logs become readable by anyone",
  "push rulesets on it are disabled",
  "activity on it is published publicly from then on",
];

/** Whether the state read is already public, by both of GitHub's fields. */
function isPublic({ state }: { state: RepoLifecycleState }): boolean {
  return state.visibility === "public" && !state.private;
}

/** Send the visibility change once, then require the same repository to read back public. */
async function publishAndConfirm({
  api,
  current,
}: {
  api: GithubRepoLifecycleApi;
  current: RepoLifecycleState;
}): Promise<GithubVerbResult<ApprovedWriteOutcome>> {
  const { ownerLogin: owner, name: repo } = current;
  const sent = await api.setPublic({ owner, repo });
  if (sent.isErr()) {
    return err(upstreamRefusedOf({ error: sent.error, operation: `make ${current.fullName} public` }));
  }
  const read = await api.read({ owner, repo });
  if (read.isErr()) {
    const cause = `read-back: ${formatIngestError({ error: read.error })}`;
    return err(GithubVerbErrors.repoVisibilityUnconfirmed({ cause, fullName: current.fullName }));
  }
  const sameRepository =
    read.value.id === current.id && read.value.fullName.toLowerCase() === current.fullName.toLowerCase();
  if (!sameRepository || !isPublic({ state: read.value })) {
    return err(GithubVerbErrors.repoVisibilityUnconfirmed({ cause: undefined, fullName: current.fullName }));
  }
  return ok({ fields: { repository: read.value }, line: `${read.value.fullName} is public  ${read.value.htmlUrl}` });
}

/**
 * Read the repository and build the previewed visibility change.
 *
 * @param api the lifecycle client
 * @param owner the owner login typed
 * @param repo the repository name typed
 * @returns the write the shared shell previews or sends, or the read's failure
 */
export async function planRepoSetPublic({
  api,
  owner,
  repo,
}: {
  api: GithubRepoLifecycleApi;
  owner: string;
  repo: string;
}): Promise<GithubVerbResult<ApprovedRepoWrite>> {
  const read = await api.read({ owner, repo });
  if (read.isErr()) {
    return err(upstreamRefusedOf({ error: read.error, operation: `read ${owner}/${repo}` }));
  }
  const current = read.value;
  return ok({
    alreadyDone: isPublic({ state: current }),
    change: `make ${current.fullName} (id ${String(current.id)}, ${current.visibility}) public`,
    consequences: SET_PUBLIC_CONSEQUENCES,
    kind: "set-public",
    perform: () => publishAndConfirm({ api, current }),
    previewCommand: `slopweaver github repo --repo ${owner}/${repo} --set-public`,
    view: {
      action: "set-public",
      current: {
        archived: current.archived,
        fullName: current.fullName,
        id: current.id,
        // The send's address is built from these two, so the digest binds them as well as fullName.
        name: current.name,
        ownerLogin: current.ownerLogin,
        private: current.private,
        visibility: current.visibility,
      },
      request: { visibility: "public" },
      source: `${owner}/${repo}`,
    },
    waiting: [],
  });
}
