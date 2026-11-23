/**
 * Question 8 of `github review-state`, the conflict answer — beside `./reviewStateReport.ts` because it is
 * the one answer that joins GitHub's own word with a local measurement.
 */

import type { ConflictPathsRead } from "../../../checkouts/conflictPaths.js";
import type { PrLiveState } from "../../../live/github/reviewState.js";
import { asGithubMergeable, type ConflictState } from "../../../review/reviewState.js";

/**
 * Question 8, whole: GitHub's own mergeability, and what a local merge against the base could name.
 *
 * @param pr the live pull-request state
 * @param conflictPathsRead what the shell measured, or undefined when GitHub reports no conflict
 * @returns the conflict answer a row carries
 */
export function conflictState({
  pr,
  conflictPathsRead,
}: {
  pr: Pick<PrLiveState, "baseRefName" | "mergeable">;
  conflictPathsRead: ConflictPathsRead | undefined;
}): ConflictState {
  const mergeable = asGithubMergeable({ token: pr.mergeable });
  if (mergeable !== "CONFLICTING") {
    return { local: { kind: "not-requested" }, mergeable };
  }
  if (conflictPathsRead === undefined) {
    return { local: { kind: "unmeasured", why: "the conflicting paths were not measured" }, mergeable };
  }
  switch (conflictPathsRead.kind) {
    case "paths":
      return { local: { kind: "measured", paths: conflictPathsRead.paths, why: "" }, mergeable };
    case "clean": {
      const why = `a local merge of the head into ${pr.baseRefName} came out clean, so GitHub's conflict read may be stale or the base has moved`;
      return { local: { kind: "measured", paths: [], why }, mergeable };
    }
    case "unmeasured":
      return { local: { kind: "unmeasured", why: conflictPathsRead.why }, mergeable };
    default: {
      const unreachable: never = conflictPathsRead;
      return unreachable;
    }
  }
}
