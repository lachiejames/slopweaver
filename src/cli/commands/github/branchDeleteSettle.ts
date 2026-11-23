/**
 * What a branch delete's write left behind, read back — the half of the verb after the atomic update is sent.
 * Split from `./branchDeleteRun.ts` along that seam: the shell decides and writes, this settles and confirms.
 */

import { err, ok, type Result } from "../../../lib/result.js";
import type { GithubRefsApi } from "../../../outbound/github/refs.js";
import type { GithubBranchArgs } from "./branchDeleteCore.js";
import { type GithubRefsError, GithubRefsErrors } from "./refsErrors.js";

/** A settled delete: the tip it removed and the tag it kept, for the report. */
export interface Deleted {
  readonly tip: string;
  readonly keptAs: string | undefined;
  /** False when the write answered an error and only the read-back shows the end state — its author is unknown. */
  readonly byThisRun: boolean;
}

/** What the remote holds after the write, read back — the branch, the keep-tag, and both in words for a failure. */
async function refStateAfter({
  api,
  address,
  args,
  tip,
}: {
  api: GithubRefsApi;
  address: { owner: string; repo: string };
  args: GithubBranchArgs;
  tip: string;
}): Promise<
  Result<{ branch: string | undefined; tag: string | undefined; tagAtTip: boolean; description: string }, string>
> {
  const branch = await api.branchTip({ ...address, branch: args.branch });
  if (branch.isErr()) {
    return err(branch.error.message);
  }
  const branchWords = `branch ${args.branch} reads back ${branch.value === undefined ? "absent" : `at ${branch.value}`}`;
  let tagAtTip = true;
  let tagValue: string | undefined;
  let description = branchWords;
  if (args.keepAsTag !== undefined) {
    const tag = await api.tagCommit({ ...address, tag: args.keepAsTag });
    if (tag.isErr()) {
      return err(tag.error.message);
    }
    tagAtTip = tag.value === tip;
    tagValue = tag.value;
    const tagWords = tag.value === undefined ? "absent" : `at ${tag.value}`;
    description = `${branchWords}, tag ${args.keepAsTag} reads back ${tagWords}`;
  }
  // GitHub answers 404 for a resource the caller can no longer see, so "absent" above means absent only if the
  // repository still reads AFTER those reads: access lost at any point before this one fails it.
  const repository = await api.defaultBranch(address);
  if (repository.isErr()) {
    return err(repository.error.message);
  }
  return ok({ branch: branch.value, description, tag: tagValue, tagAtTip });
}

/**
 * Settle a write that answered an error: the update is whole or nothing, but a lost ANSWER is not a lost write,
 * so the end state is read. Deleted-and-tagged is success whose author is unknown; anything else is the failure,
 * carrying what the remote now holds.
 *
 * @param cause the write's own error, carried into the failure
 * @param createTag the keep-tag this update was to create, if any
 * @param tip the tip the update named
 * @returns the delete with no author claimed, or the failure naming what the remote holds
 */
export async function settleErroredWrite({
  api,
  args,
  cause,
  createTag,
  tip,
}: {
  api: GithubRefsApi;
  args: GithubBranchArgs;
  cause: string;
  createTag: string | undefined;
  tip: string;
}): Promise<Result<Deleted, GithubRefsError>> {
  const address = { owner: args.owner, repo: args.repo };
  const landed = await refStateAfter({ address, api, args, tip });
  if (landed.isOk() && landed.value.branch === undefined && landed.value.tagAtTip) {
    return ok({ byThisRun: false, keptAs: args.keepAsTag, tip });
  }
  let state: string;
  if (landed.isErr()) {
    const tagClause = createTag === undefined ? "" : ` and tag ${createTag} created at ${tip}`;
    const applied = `branch ${args.branch} deleted at ${tip}${tagClause}`;
    state = `reading it back failed too (${landed.error}), so GitHub may or may not have applied it: either ${applied}, or nothing changed`;
  } else {
    state = landed.value.description;
  }
  return err(
    GithubRefsErrors.providerFailed({
      cause: `${cause}; ${state}`,
      kept: undefined,
      step: "the atomic tag-and-delete",
    }),
  );
}

/**
 * Confirm a write GitHub accepted by the same read-back as the error path: the repository is read LAST, so a 404
 * from lost access never confirms. Only a tag THIS update created is claimed to stay; a held one is read.
 *
 * @param createTag the keep-tag this update created, if any
 * @param tip the tip the update deleted
 * @returns the confirmed delete, or the failure naming what reads back instead
 */
export async function confirmAcceptedWrite({
  api,
  args,
  createTag,
  tip,
}: {
  api: GithubRefsApi;
  args: GithubBranchArgs;
  createTag: string | undefined;
  tip: string;
}): Promise<Result<Deleted, GithubRefsError>> {
  const kept = createTag === undefined ? undefined : { tag: createTag, tip };
  const madeTag = createTag === undefined ? "" : ` and creating tag ${createTag} there`;
  const step = `the read-back after GitHub accepted deleting ${args.branch} at ${tip}${madeTag}`;
  const after = await refStateAfter({ address: { owner: args.owner, repo: args.repo }, api, args, tip });
  if (after.isErr()) {
    return err(GithubRefsErrors.providerFailed({ cause: after.error, kept, step }));
  }
  if (after.value.branch !== undefined) {
    const ref = `branch ${args.branch}`;
    return err(GithubRefsErrors.unconfirmed({ expected: "absent", kept, readBack: `at ${after.value.branch}`, ref }));
  }
  if (!after.value.tagAtTip) {
    // The branch IS gone (read back above); the tag is not where it should be, so nothing claims it stayed.
    const ref = `tag ${String(args.keepAsTag)} (branch ${args.branch} was deleted at ${tip})`;
    const found = after.value.tag === undefined ? "absent" : `at ${after.value.tag}`;
    return err(GithubRefsErrors.unconfirmed({ expected: tip, kept: undefined, readBack: found, ref }));
  }
  return ok({ byThisRun: true, keptAs: args.keepAsTag, tip });
}
