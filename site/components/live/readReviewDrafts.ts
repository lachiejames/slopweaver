/**
 * The reader for `slopweaver github review-draft list --json`: the owner's review of somebody else's pull request — a
 * verdict, a body and line comments, each with the diff hunk it sits on — parked for the owner to read before anything
 * reaches GitHub.
 *
 * Same discipline as `./readSlackDrafts.ts`: a row that will not parse refuses the WHOLE reading, so the panel says
 * NOT MEASURED rather than drawing a review with a comment missing. What this reads is exactly what a post would
 * send under the owner's name, so a card that quietly dropped a comment would show the owner something other than what the owner
 * approves.
 *
 * The contract is `src/__tests__/fixtures/contract/github-review-draft-list.json`, which the verb's own test prints
 * and `site/__tests__/unit/reviewDraftListContract.test.ts` reads back through this reader.
 */

import { type Bag, bags, isBag, num, str, sub } from "../../lib/bag";

/** GitHub's three review events, closed: an unknown one refuses the reading. */
export type ReviewVerdict = "APPROVE" | "COMMENT" | "REQUEST_CHANGES";

const VERDICTS: readonly ReviewVerdict[] = ["APPROVE", "COMMENT", "REQUEST_CHANGES"];

/** One line of a stored hunk, as GitHub draws it above a review comment. */
export interface ReviewHunkLine {
  readonly kind: "header" | "add" | "del" | "context";
  readonly text: string;
  /** The base-side number, absent on an added line and on the header. */
  readonly oldLine: number | undefined;
  /** The head-side number, absent on a removed line and on the header. */
  readonly newLine: number | undefined;
}

const HUNK_KINDS: readonly ReviewHunkLine["kind"][] = ["header", "add", "del", "context"];

/** One line comment, anchored on the head side of the diff. */
export interface ReviewComment {
  readonly path: string;
  /** The head-side line it sits on — the LAST line of a range. */
  readonly line: number;
  /** The first line of a multi-line comment, absent on a single line. */
  readonly startLine: number | undefined;
  readonly body: string;
  readonly hunk: readonly ReviewHunkLine[];
}

/** What became of a parked review: still waiting on the owner's word, posted through the door, or dropped unposted. */
export type ReviewDraftState = "held" | "posted" | "dropped";

const STATES: readonly ReviewDraftState[] = ["held", "posted", "dropped"];

/** One parked review, as `github review-draft list --json` prints it. */
export interface ParkedReview {
  readonly id: string;
  readonly state: ReviewDraftState;
  /** When it was posted or dropped — always present on those two, absent while it is held. */
  readonly resolvedIso: string | undefined;
  /** The posted review's URL, or the drop's note. Absent while held. */
  readonly outcome: string | undefined;
  readonly tsIso: string;
  /** `owner/name`. */
  readonly repo: string;
  readonly number: number;
  readonly title: string;
  readonly url: string;
  /** The pull request's author login, when GitHub named one. */
  readonly author: string | undefined;
  readonly headSha: string;
  readonly verdict: ReviewVerdict;
  readonly body: string;
  readonly comments: readonly ReviewComment[];
  /** The risk a deeper review would settle — an offer to the owner, never posted. */
  readonly deeperReview: string | undefined;
  readonly why: string;
  /** What the owner's approval binds: the pull request, its head, the verdict, the body and every comment. */
  readonly digest: string;
  /** The one command the owner's yes becomes — present exactly while the row is held. */
  readonly postCommand: string | undefined;
}

/**
 * Whether a parked review is still waiting on the owner's word.
 *
 * @returns true while the register still holds it unposted
 */
export function isHeldReview({ review }: { review: ParkedReview }): boolean {
  return review.state === "held";
}

/** Whether an OPTIONAL field is present but not the type it must be — malformed, which refuses, never read as absent. */
function wrongType({ bag, key, type }: { bag: Bag; key: string; type: "string" | "number" }): boolean {
  return bag[key] !== undefined && typeof bag[key] !== type;
}

/** One hunk line, or `undefined` when it is not one. */
function hunkLineOf({ line }: { line: Bag }): ReviewHunkLine | undefined {
  const kind = HUNK_KINDS.find((one) => one === str({ bag: line, key: "kind" }));
  const text = str({ bag: line, key: "text" });
  if (
    kind === undefined ||
    text === undefined ||
    wrongType({ bag: line, key: "oldLine", type: "number" }) ||
    wrongType({ bag: line, key: "newLine", type: "number" })
  ) {
    return undefined;
  }
  return { kind, newLine: num({ bag: line, key: "newLine" }), oldLine: num({ bag: line, key: "oldLine" }), text };
}

/** One comment, or `undefined` when it or any line of its hunk is unreadable. */
function commentOf({ comment }: { comment: Bag }): ReviewComment | undefined {
  const path = str({ bag: comment, key: "path" });
  const line = num({ bag: comment, key: "line" });
  const body = str({ bag: comment, key: "body" });
  const rows = bags({ bag: comment, key: "hunk" });
  if (
    path === undefined ||
    line === undefined ||
    body === undefined ||
    rows === undefined ||
    wrongType({ bag: comment, key: "startLine", type: "number" })
  ) {
    return undefined;
  }
  const hunk: ReviewHunkLine[] = [];
  for (const row of rows) {
    const read = hunkLineOf({ line: row });
    if (read === undefined) {
      return undefined;
    }
    hunk.push(read);
  }
  return { body, hunk, line, path, startLine: num({ bag: comment, key: "startLine" }) };
}

/** Every comment of one draft, or `undefined` when any one is unreadable. */
function commentsOf({ draft }: { draft: Bag }): readonly ReviewComment[] | undefined {
  const rows = bags({ bag: draft, key: "comments" });
  if (rows === undefined) {
    return undefined;
  }
  const out: ReviewComment[] = [];
  for (const row of rows) {
    const read = commentOf({ comment: row });
    if (read === undefined) {
      return undefined;
    }
    out.push(read);
  }
  return out;
}

/**
 * A row's post command: present on a held row and absent on a resolved one, or `"malformed"` for either the wrong
 * way round — a held card with no command is one that would have to guess the verb.
 */
function postCommandOf({ item, held }: { item: Bag; held: boolean }): string | undefined | "malformed" {
  const post = item["post"];
  if (!held) {
    return post === undefined ? undefined : "malformed";
  }
  if (!isBag(post)) {
    return "malformed";
  }
  const command = str({ bag: post, key: "command" });
  return command ?? "malformed";
}

/** One row, or `undefined` when any part of it is unreadable. */
function reviewOf({ item }: { item: Bag }): ParkedReview | undefined {
  const id = str({ bag: item, key: "id" });
  const state = STATES.find((one) => one === str({ bag: item, key: "state" }));
  const draft = sub({ bag: item, key: "draft" });
  if (
    id === undefined ||
    state === undefined ||
    draft === undefined ||
    wrongType({ bag: item, key: "outcome", type: "string" }) ||
    wrongType({ bag: item, key: "resolvedIso", type: "string" })
  ) {
    return undefined;
  }
  const resolvedIso = str({ bag: item, key: "resolvedIso" });
  // A posted or dropped row says WHEN; one that does not is not a row this reader can describe truthfully.
  if (state !== "held" && resolvedIso === undefined) {
    return undefined;
  }
  const postCommand = postCommandOf({ held: state === "held", item });
  const verdict = VERDICTS.find((one) => one === str({ bag: draft, key: "verdict" }));
  const comments = commentsOf({ draft });
  const fields = {
    body: str({ bag: draft, key: "body" }),
    digest: str({ bag: draft, key: "digest" }),
    headSha: str({ bag: draft, key: "headSha" }),
    number: num({ bag: draft, key: "number" }),
    repo: str({ bag: draft, key: "repo" }),
    title: str({ bag: draft, key: "title" }),
    tsIso: str({ bag: draft, key: "tsIso" }),
    url: str({ bag: draft, key: "url" }),
    why: str({ bag: draft, key: "why" }),
  };
  if (
    postCommand === "malformed" ||
    verdict === undefined ||
    comments === undefined ||
    str({ bag: draft, key: "id" }) !== id ||
    wrongType({ bag: draft, key: "author", type: "string" }) ||
    wrongType({ bag: draft, key: "deeperReview", type: "string" })
  ) {
    return undefined;
  }
  const { body, digest, headSha, number, repo, title, tsIso, url, why } = fields;
  if (
    body === undefined ||
    digest === undefined ||
    headSha === undefined ||
    number === undefined ||
    repo === undefined ||
    title === undefined ||
    tsIso === undefined ||
    url === undefined ||
    why === undefined
  ) {
    return undefined;
  }
  return {
    author: str({ bag: draft, key: "author" }),
    body,
    comments,
    deeperReview: str({ bag: draft, key: "deeperReview" }),
    digest,
    headSha,
    id,
    number,
    outcome: str({ bag: item, key: "outcome" }),
    postCommand,
    repo,
    resolvedIso,
    state,
    title,
    tsIso,
    url,
    verdict,
    why,
  };
}

/**
 * Read a `github review-draft list --json` payload.
 *
 * @param payload the parsed stdout
 * @returns every parked review, newest first, or `undefined` when the payload is not one
 */
export function readParkedReviews(payload: unknown): readonly ParkedReview[] | undefined {
  if (!isBag(payload)) {
    return undefined;
  }
  const items = bags({ bag: payload, key: "items" });
  if (items === undefined) {
    return undefined;
  }
  const out: ParkedReview[] = [];
  for (const item of items) {
    const review = reviewOf({ item });
    if (review === undefined) {
      return undefined;
    }
    out.push(review);
  }
  return out;
}
