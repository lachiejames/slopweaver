/**
 * A pull request as the console draws it, out of the document `github read <pr> --files --json` prints — the pure
 * half of the pull-request view (`../components/console/PullView.tsx`, `../app/api/pull/route.ts`).
 *
 * The document is GitHub's own payload (`src/live/github/read.ts` selects it, `src/live/github/pullFiles.ts` adds
 * the files) inside Slopweaver's freshness and coverage wrapper. This reads it field by field with the `./bag.ts`
 * helpers and REFUSES the whole document when a field the view draws is not the shape GitHub writes — a view that
 * guessed would draw a confident pull request nobody read. What the read did not cover travels with it: the
 * wrapper's residue is the page's own "not read" list.
 */

import { type Bag, bool, isBag, num, str, strings, sub } from "./bag";
import { diffOnBaseOf } from "./pullViewDiff";
import { checksOf, commentsOf, loginOf, nodesOf, optionalStr, requestedOf, reviewOf, threadOf } from "./pullViewFields";
import type {
  PullComment,
  PullFile,
  PullRequested,
  PullReview,
  PullThread,
  PullTimelineItem,
  PullView,
} from "./pullViewTypes";

export {
  type CheckKind,
  checkKind,
  checkSummary,
  type PullDiffOnBaseNotice,
  pictureCount,
  pullDiffOnBaseNotice,
} from "./pullViewNotices";
export {
  type PullStanding,
  pullLogins,
  pullReviewers,
  reviewsCut,
  standingLines,
  standingOf,
} from "./pullViewStanding";
export type {
  Login,
  PullCheck,
  PullComment,
  PullDiffOnBase,
  PullDiffOnBaseVerdict,
  PullFile,
  PullRequested,
  PullReview,
  PullThread,
  PullTimelineItem,
  PullView,
} from "./pullViewTypes";

/** One changed file as GitHub's REST list writes it. */
function fileOf({ bag }: { bag: Bag }): PullFile | undefined {
  const filename = str({ bag, key: "filename" });
  const status = str({ bag, key: "status" });
  const additions = num({ bag, key: "additions" });
  const deletions = num({ bag, key: "deletions" });
  const patch = optionalStr({ bag, key: "patch" });
  const previous = optionalStr({ bag, key: "previous_filename" });
  if (filename === undefined || status === undefined || additions === undefined || deletions === undefined) {
    return undefined;
  }
  if (!patch.ok || !previous.ok) {
    return undefined;
  }
  return { additions, deletions, filename, patch: patch.value, previousFilename: previous.value, status };
}

/** The lifecycle word the header's state label draws. */
function lifecycleOf({ state, draft }: { state: string; draft: boolean }): PullView["lifecycle"] | undefined {
  if (state === "MERGED") {
    return "merged";
  }
  if (state === "CLOSED") {
    return "closed";
  }
  if (state !== "OPEN") {
    return undefined;
  }
  if (draft) {
    return "draft";
  }
  return "open";
}

/** Every item of a list read with `read`, or `undefined` when any one will not. */
function everyOf<T>({ rows, read }: { rows: readonly Bag[]; read: (bag: Bag) => T | undefined }): T[] | undefined {
  const out: T[] = [];
  for (const row of rows) {
    const one = read(row);
    if (one === undefined) {
      return undefined;
    }
    out.push(one);
  }
  return out;
}

/** The labels, each with GitHub's own colour. */
function labelsOf({ data }: { data: Bag }): PullView["labels"] | undefined {
  const nodes = nodesOf({ bag: data, key: "labels" });
  if (nodes === undefined) {
    return undefined;
  }
  return everyOf({
    read: (bag) => {
      const name = str({ bag, key: "name" });
      const color = str({ bag, key: "color" });
      if (name === undefined || color === undefined) {
        return undefined;
      }
      return { color, name };
    },
    rows: nodes,
  });
}

/** The activity lists, each read whole or refused. */
function activityOf({ data }: { data: Bag }):
  | {
      readonly requested: readonly PullRequested[];
      readonly reviews: readonly PullReview[];
      readonly threads: readonly PullThread[];
      readonly comments: readonly PullComment[];
      readonly files: readonly PullFile[];
    }
  | undefined {
  const requestedRows = nodesOf({ bag: data, key: "reviewRequests" });
  const reviewRows = nodesOf({ bag: data, key: "reviews" });
  const threadRows = nodesOf({ bag: data, key: "reviewThreads" });
  const fileRows = nodesOf({ bag: data, key: "files" });
  const comments = commentsOf({ bag: data, key: "comments" });
  if (requestedRows === undefined || reviewRows === undefined || threadRows === undefined || fileRows === undefined) {
    return undefined;
  }
  const requested = everyOf({ read: (bag) => requestedOf({ bag }), rows: requestedRows });
  const reviews = everyOf({ read: (bag) => reviewOf({ bag }), rows: reviewRows });
  const threads = everyOf({ read: (bag) => threadOf({ bag }), rows: threadRows });
  const files = everyOf({ read: (bag) => fileOf({ bag }), rows: fileRows });
  if (requested === undefined || reviews === undefined || threads === undefined || files === undefined) {
    return undefined;
  }
  if (comments === undefined) {
    return undefined;
  }
  return { comments, files, requested, reviews, threads };
}

/**
 * Read `github read <pr> --files --json` into the view.
 *
 * @param payload the parsed document
 * @returns the view, or `undefined` when the document is not a pull request read with its files, in GitHub's shape
 */
export function readPullDocument({ payload }: { payload: unknown }): PullView | undefined {
  if (!isBag(payload)) {
    return undefined;
  }
  const data = sub({ bag: payload, key: "data" });
  const coverage = sub({ bag: payload, key: "coverage" });
  const readAtIso = str({ bag: payload, key: "readAtIso" });
  if (data === undefined || coverage === undefined || readAtIso === undefined || data["__typename"] !== "PullRequest") {
    return undefined;
  }
  const residue = strings({ bag: coverage, key: "residue" });
  const number = num({ bag: data, key: "number" });
  const title = str({ bag: data, key: "title" });
  const url = str({ bag: data, key: "url" });
  const body = str({ bag: data, key: "body" });
  const state = str({ bag: data, key: "state" });
  const draft = bool({ bag: data, key: "isDraft" });
  const author = loginOf({ bag: data, key: "author" });
  const baseRef = str({ bag: data, key: "baseRefName" });
  const headRef = str({ bag: data, key: "headRefName" });
  const createdAt = str({ bag: data, key: "createdAt" });
  const mergedAt = optionalStr({ bag: data, key: "mergedAt" });
  const closedAt = optionalStr({ bag: data, key: "closedAt" });
  const additions = num({ bag: data, key: "additions" });
  const deletions = num({ bag: data, key: "deletions" });
  const changedFiles = num({ bag: data, key: "changedFiles" });
  const mergeStateStatus = str({ bag: data, key: "mergeStateStatus" });
  const reviewDecision = optionalStr({ bag: data, key: "reviewDecision" });
  if (residue === undefined || number === undefined || title === undefined || url === undefined) {
    return undefined;
  }
  if (body === undefined || state === undefined || draft === undefined || !author.ok) {
    return undefined;
  }
  if (baseRef === undefined || headRef === undefined || createdAt === undefined) {
    return undefined;
  }
  if (additions === undefined || deletions === undefined || changedFiles === undefined) {
    return undefined;
  }
  if (!mergedAt.ok || !closedAt.ok || mergeStateStatus === undefined || !reviewDecision.ok) {
    return undefined;
  }
  const lifecycle = lifecycleOf({ draft, state });
  const labels = labelsOf({ data });
  const activity = activityOf({ data });
  const checks = checksOf({ data });
  const diffOnBase = diffOnBaseOf({ baseRef, data });
  if (lifecycle === undefined || labels === undefined || activity === undefined || checks === false) {
    return undefined;
  }
  if (!diffOnBase.ok) {
    return undefined;
  }
  return {
    additions,
    author: author.login,
    baseRef,
    body,
    changedFiles,
    checks: checks.value,
    closedAt: closedAt.value,
    comments: activity.comments,
    createdAt,
    deletions,
    diffOnBase: diffOnBase.value,
    files: activity.files,
    headOid: checks.oid,
    headRef,
    labels,
    lifecycle,
    mergeStateStatus,
    mergedAt: mergedAt.value,
    number,
    readAtIso,
    requested: activity.requested,
    residue,
    reviewDecision: reviewDecision.value,
    reviews: activity.reviews,
    threads: activity.threads,
    title,
    url,
  };
}

/**
 * The conversation, oldest first, as GitHub orders it: every comment, every review that says something or decides
 * something, and every inline thread at its first comment's instant. A bare `COMMENTED` review with no body is
 * the envelope GitHub makes for a batch of inline comments, which the threads already draw, so it is left out.
 *
 * @returns the timeline
 */
export function pullTimeline({ view }: { view: PullView }): readonly PullTimelineItem[] {
  const items: PullTimelineItem[] = [];
  for (const comment of view.comments) {
    items.push({ at: comment.createdAt, comment, kind: "comment" });
  }
  for (const review of view.reviews) {
    const envelope = review.state === "COMMENTED" && review.body.trim() === "";
    if (review.submittedAt !== undefined && !envelope) {
      items.push({ at: review.submittedAt, kind: "review", review });
    }
  }
  for (const thread of view.threads) {
    const first = thread.comments.at(0);
    if (first !== undefined) {
      items.push({ at: first.createdAt, kind: "thread", thread });
    }
  }
  return items.toSorted((a, b) => a.at.localeCompare(b.at));
}
