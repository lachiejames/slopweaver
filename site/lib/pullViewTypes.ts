/**
 * The pull request view's shapes, split out of `./pullView.ts`, which reads GitHub's document into them and re-exports
 * every one.
 */

import type { DiffSide } from "./unifiedDiff";

/** A person as GitHub names one; `undefined` is a deleted account, which GitHub reports as a null author. */
export type Login = string | undefined;

/** A comment on the conversation, or one inside a review thread. */
export interface PullComment {
  readonly id: string;
  readonly author: Login;
  readonly body: string;
  readonly url: string;
  readonly createdAt: string;
}

/** A submitted review. */
export interface PullReview {
  readonly id: string;
  readonly author: Login;
  readonly body: string;
  readonly url: string;
  /** `APPROVED`, `CHANGES_REQUESTED`, `COMMENTED`, `DISMISSED` or `PENDING`, as GitHub writes it. */
  readonly state: string;
  readonly submittedAt: string | undefined;
  /** The code-owner teams this review was submitted on behalf of. */
  readonly onBehalfOf: readonly string[];
}

/** An inline review conversation on one line of one file. */
export interface PullThread {
  readonly id: string;
  readonly path: string;
  readonly line: number | undefined;
  /** Which file `line` counts in: `LEFT` the old one, for a comment on a removed line, `RIGHT` the new one. */
  readonly side: DiffSide;
  readonly resolved: boolean;
  readonly outdated: boolean;
  /** The code above the first comment, from its `diffHunk`. */
  readonly diffHunk: string | undefined;
  readonly comments: readonly PullComment[];
}

/** A reviewer GitHub is still waiting on. */
export interface PullRequested {
  readonly kind: "user" | "team";
  /** A login, or a team's `org/slug`. */
  readonly name: string;
  readonly asCodeOwner: boolean;
}

/** One check on the head commit. */
export interface PullCheck {
  readonly name: string;
  /** A finished check's conclusion, or where an unfinished one is — `SUCCESS`, `FAILURE`, `IN_PROGRESS`, `PENDING`. */
  readonly result: string;
  readonly url: string | undefined;
}

/** One changed file. */
export interface PullFile {
  readonly filename: string;
  readonly previousFilename: string | undefined;
  /** `added`, `removed`, `modified`, `renamed`, `copied`, `changed` or `unchanged`, as GitHub writes it. */
  readonly status: string;
  readonly additions: number;
  readonly deletions: number;
  /** GitHub's patch; `undefined` for a binary file or one too large for GitHub to diff. */
  readonly patch: string | undefined;
}

/** Whether a diff is already on its base branch's current tip — `src/live/github/diffOnBaseJudge.ts`'s four answers. */
export type PullDiffOnBaseVerdict = "on-base" | "partly" | "not-on-base" | "unknown";

/**
 * The live current-base receipt `github read --files` carries for an un-merged pull request
 * (`src/live/github/diffOnBase.ts`): GitHub's own diff is against the branch's merge base, which stops moving, so a
 * change that reached the base another way still draws as an open +1/−1.
 */
export interface PullDiffOnBase {
  readonly verdict: PullDiffOnBaseVerdict;
  readonly baseRef: string;
  /** The base tip commit every file was judged against; `null` on an `unknown` that never read the base. */
  readonly baseOid: string | null;
  /** When the base was read — later than the pull request's own read. */
  readonly checkedAtIso: string;
  readonly reason: string | undefined;
}

/** One entry of the conversation, oldest first. */
export type PullTimelineItem =
  | { readonly kind: "comment"; readonly at: string; readonly comment: PullComment }
  | { readonly kind: "review"; readonly at: string; readonly review: PullReview }
  | { readonly kind: "thread"; readonly at: string; readonly thread: PullThread };

/** The pull request as the view draws it. */
export interface PullView {
  readonly readAtIso: string;
  readonly number: number;
  readonly title: string;
  readonly url: string;
  readonly body: string;
  readonly lifecycle: "open" | "draft" | "merged" | "closed";
  readonly author: Login;
  readonly baseRef: string;
  readonly headRef: string;
  readonly createdAt: string;
  readonly mergedAt: string | undefined;
  readonly closedAt: string | undefined;
  readonly additions: number;
  readonly deletions: number;
  readonly changedFiles: number;
  /** GitHub's `MergeStateStatus`, which it always sends — `CLEAN`, `BLOCKED`, `BEHIND`, `UNKNOWN` and the rest. */
  readonly mergeStateStatus: string;
  readonly reviewDecision: string | undefined;
  readonly labels: readonly { readonly name: string; readonly color: string }[];
  readonly requested: readonly PullRequested[];
  readonly reviews: readonly PullReview[];
  readonly threads: readonly PullThread[];
  readonly comments: readonly PullComment[];
  /** The head commit's rollup, or `undefined` when GitHub reports no checks on it. */
  readonly checks: { readonly state: string; readonly total: number; readonly items: readonly PullCheck[] } | undefined;
  readonly headOid: string | undefined;
  readonly files: readonly PullFile[];
  /** The current-base receipt; `undefined` on a merged pull request, and on a read that predates the check. */
  readonly diffOnBase: PullDiffOnBase | undefined;
  /** What the read did not cover, as the wrapper stated it. */
  readonly residue: readonly string[];
}
