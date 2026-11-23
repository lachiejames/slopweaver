/**
 * Where each person stands on a pull request, the lines their hover card says, and the logins the page asks about.
 * Split out of `./pullView.ts`, which re-exports every name here.
 */

import type { Login, PullView } from "./pullViewTypes";

/** Where one person stands on this pull request, as the reviewers sidebar and their hover card say it. */
export interface PullStanding {
  readonly login: string;
  /** Their latest deciding review — `APPROVED`, `CHANGES_REQUESTED`, `DISMISSED` — else `COMMENTED` if they only commented. */
  readonly review: string | undefined;
  readonly requested: boolean;
  readonly asCodeOwner: boolean;
  readonly author: boolean;
  /** The teams an approval of theirs satisfied. */
  readonly onBehalfOf: readonly string[];
}

/**
 * Each reviewer's standing, as GitHub's sidebar computes it: the LATEST review that decided something wins over any
 * earlier one, and a person whose only reviews are comments reads as having commented. A pending request is kept
 * beside it — GitHub re-requests after a review, so both can be true.
 *
 * @returns one row per person, requested reviewers first in GitHub's order, then reviewers by their latest review
 */
export function pullReviewers({ view }: { view: PullView }): readonly PullStanding[] {
  const rows = new Map<string, PullStanding>();
  for (const request of view.requested) {
    if (request.kind === "user") {
      rows.set(request.name, {
        asCodeOwner: request.asCodeOwner,
        author: request.name === view.author,
        login: request.name,
        onBehalfOf: [],
        requested: true,
        review: undefined,
      });
    }
  }
  const submitted = view.reviews.filter((review) => review.submittedAt !== undefined && review.state !== "PENDING");
  const ordered = submitted.toSorted((a, b) => a.submittedAt!.localeCompare(b.submittedAt!));
  for (const review of ordered) {
    if (review.author === undefined || review.author === view.author) {
      continue;
    }
    const held = rows.get(review.author);
    let state = review.state;
    let onBehalfOf = review.onBehalfOf;
    if (review.state === "COMMENTED" && held?.review !== undefined) {
      state = held.review;
      onBehalfOf = held.onBehalfOf;
    }
    // Only an approval satisfies a code-owner team, as `src/review/githubCodeowners.ts` counts it: GitHub keeps
    // `onBehalfOf` on a review that asked for changes or was dismissed, and that one counts for nobody.
    if (state !== "APPROVED") {
      onBehalfOf = [];
    }
    rows.set(review.author, {
      asCodeOwner: held?.asCodeOwner === true,
      author: false,
      login: review.author,
      onBehalfOf,
      requested: held?.requested === true,
      review: state,
    });
  }
  return [...rows.values()];
}

/**
 * One person's standing, for any chip on the page: a reviewer's row, the author's own, or none for a person who
 * only commented.
 *
 * @param reviewers the page's {@link pullReviewers}, computed once
 * @returns the standing, or `undefined`
 */
export function standingOf({
  view,
  reviewers,
  login,
}: {
  view: PullView;
  reviewers: readonly PullStanding[];
  login: Login;
}): PullStanding | undefined {
  if (login === undefined) {
    return undefined;
  }
  if (login === view.author) {
    return { asCodeOwner: false, author: true, login, onBehalfOf: [], requested: false, review: undefined };
  }
  return reviewers.find((row) => row.login === login);
}

/** What a review state reads as in a sentence. */
const REVIEW_WORDS: Readonly<Partial<Record<string, string>>> = {
  APPROVED: "approved",
  CHANGES_REQUESTED: "asked for changes",
  COMMENTED: "commented",
  DISMISSED: "had a review dismissed",
};

/**
 * The lines a person's hover card says about them on this pull request, in GitHub's words.
 *
 * @returns the lines, empty when the pull request names them only as a commenter
 */
export function standingLines({ standing }: { standing: PullStanding | undefined }): readonly string[] {
  if (standing === undefined) {
    return [];
  }
  const lines: string[] = [];
  if (standing.author) {
    lines.push("opened this pull request");
  }
  if (standing.review !== undefined) {
    let said = standing.review.toLowerCase();
    const word = REVIEW_WORDS[standing.review];
    if (word !== undefined) {
      said = word;
    }
    lines.push(said);
  }
  if (standing.onBehalfOf.length > 0) {
    lines.push(`approval counts for ${standing.onBehalfOf.join(", ")}`);
  }
  if (standing.requested && standing.asCodeOwner) {
    lines.push("review requested, as a code owner");
  } else if (standing.requested) {
    lines.push("review requested");
  }
  return lines;
}

/**
 * Whether the read stopped short of the pull request's first review. `github read` takes the NEWEST reviews, so past
 * that page an early approval is simply absent, and a sidebar drawn from what remains would read as complete.
 *
 * @returns true when the document's residue names another page of `data.reviews`
 */
export function reviewsCut({ view }: { view: PullView }): boolean {
  return view.residue.some((line) => line.startsWith("data.reviews "));
}

/**
 * Every distinct login the view names, for the member roster's pictures and names.
 *
 * @returns the logins, author first
 */
export function pullLogins({ view }: { view: PullView }): readonly string[] {
  const out: string[] = [];
  const add = (login: Login): void => {
    if (login !== undefined && !out.includes(login)) {
      out.push(login);
    }
  };
  add(view.author);
  for (const request of view.requested) {
    if (request.kind === "user") {
      add(request.name);
    }
  }
  for (const review of view.reviews) {
    add(review.author);
  }
  for (const comment of view.comments) {
    add(comment.author);
  }
  for (const thread of view.threads) {
    for (const comment of thread.comments) {
      add(comment.author);
    }
  }
  return out;
}
