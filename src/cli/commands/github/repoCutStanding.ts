/**
 * What a re-cut repository's push-root binding and its fresh cut's verification say about the next write.
 *
 * Two writes read it. `--push-fresh-cut` needs the binding, so it pushes only the root the old-history guard already
 * accepts. `--set-public` needs the cut's latest `fresh-cut verify` to read `clear`: a refused verification means a
 * line of that tree still matches the denylist or a private term, and publishing it is the one step that cannot
 * be taken back. A repository with no binding was never re-cut here, and `--set-public` judges it as before.
 */

import { type PushRootBinding, pushRootForRepository } from "../../../admit/pushRootRegistry.js";
import { readPushRootState } from "../../../admit/pushRootStore.js";
import { cutRootStanding } from "../../../freshCut/store.js";
import { err, ok } from "../../../lib/result.js";
import { GithubVerbErrors, type GithubVerbResult } from "./errors.js";

/**
 * The binding the push-root register holds for any of a repository's spellings.
 *
 * @param home the state home whose register is read
 * @param repositories the `owner/name` spellings of one repository: as typed, and as GitHub answered it
 * @returns the binding, undefined when the repository is not bound, or the refusal when the register is unreadable
 */
export function boundRootOf({
  home,
  repositories,
}: {
  home: string;
  repositories: readonly string[];
}): GithubVerbResult<PushRootBinding | undefined> {
  const state = readPushRootState({ home });
  if (state.isErr()) {
    return err(GithubVerbErrors.repoCutStandingUnreadable({ subject: repositories[0]!, why: state.error.message }));
  }
  if (state.value.kind === "absent") {
    return ok(undefined);
  }
  const { registry } = state.value;
  for (const repository of repositories) {
    const binding = pushRootForRepository({ registry, repository });
    if (binding !== undefined) {
      return ok(binding);
    }
  }
  return ok(undefined);
}

/**
 * Refuse making a re-cut repository public unless the latest verification of its cut reads `clear`.
 *
 * @param home the state home holding the register and the cut records
 * @param repositories the `owner/name` spellings of the repository about to be made public
 * @returns nothing when it may go public, or the refusal naming what the verification says
 */
export function refusePublicUnlessCutClear({
  home,
  repositories,
}: {
  home: string;
  repositories: readonly string[];
}): GithubVerbResult<void> {
  const bound = boundRootOf({ home, repositories });
  if (bound.isErr()) {
    return err(bound.error);
  }
  if (bound.value === undefined) {
    return ok(undefined);
  }
  const { repository, rootSha } = bound.value;
  const standing = cutRootStanding({ home, rootSha });
  if (standing.isErr()) {
    return err(GithubVerbErrors.repoCutStandingUnreadable({ subject: repository, why: standing.error.message }));
  }
  const root = rootSha.slice(0, 12);
  if (standing.value.kind === "no-record") {
    return err(
      GithubVerbErrors.repoPublicCutUnverified({
        repository,
        why: `it is bound to root ${root}, and no fresh-cut record carries that root, so nothing verified it`,
      }),
    );
  }
  if (standing.value.kind === "unverified") {
    return err(
      GithubVerbErrors.repoPublicCutUnverified({
        repository,
        why: `its cut ${standing.value.recordIds.join(", ")} has never been verified; run fresh-cut verify first`,
      }),
    );
  }
  if (standing.value.status !== "clear") {
    return err(
      GithubVerbErrors.repoPublicCutUnverified({
        repository,
        why: `the latest fresh-cut verify of cut ${standing.value.recordId} (${standing.value.verifiedAtIso}) refused`,
      }),
    );
  }
  return ok(undefined);
}
