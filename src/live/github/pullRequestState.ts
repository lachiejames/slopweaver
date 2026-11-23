/**
 * One pull request's live state, read through the door: open, closed or merged, not there at all, or not
 * established. Two verbs ask it — `session-start`'s verify pass (`../../cli/commands/sessionStart/verifyRows.ts`),
 * before it tells the owner a row still needs them, and `slack draft record`'s settled-chase hold
 * (`../../cli/commands/slack/draftSettledChase.ts`), before a chase on a finished pull request reaches the owner's Queue.
 */
import { githubToken } from "../../config.js";
import { isRecord } from "../../lib/parsers.js";
import type { GithubLiveError } from "./errors.js";
import { githubReadGraphql, readGithubObject } from "./read.js";

/** GitHub's own words for a pull request that is no longer live work. */
const SETTLED_PULL_REQUEST_STATES = new Set(["CLOSED", "MERGED"]);

/** GitHub's own word for a pull request still being worked. */
const OPEN_PULL_REQUEST_STATE = "OPEN";

/**
 * What a read must find at the number. GitHub resolves `issueOrPullRequest`, so an issue answers a pull-request
 * address with its own state. `session-start` judges a bare `#N` that may name either, and keeps that reading; the
 * settled-chase hold links a pull request by URL, and an OPEN issue at that number is no open pull request.
 */
export type PullRequestSubject = "issue-or-pull-request" | "pull-request";

/** GitHub's GraphQL type name for a pull request node. */
const PULL_REQUEST_TYPENAME = "PullRequest";

/** GitHub's GraphQL type name for an issue node, which answers a number no pull request holds. */
const ISSUE_TYPENAME = "Issue";

/**
 * What one live pull-request read established.
 *
 * `notChecked` is a first-class answer rather than a missing one. An expired token, a rate limit, a
 * repository this reader cannot name or a state it cannot decode all establish NOTHING, and folding any of
 * them into `absent` would mark every row on the list stale over one configuration problem — the
 * silent-failure class `slopweaver audit run` shipped when it turned a refused corpus read into `0 records`.
 * Folding one into `open` is the other half of the same class: a chase whose pull request was never proved
 * open would park as though it had been.
 */
export type PullRequestLiveState =
  | { readonly kind: "absent" }
  | { readonly kind: "notChecked" }
  | { readonly kind: "open" }
  | { readonly kind: "settled"; readonly state: string };

/**
 * Read one pull request's live state.
 *
 * Only a genuine `NOT_FOUND`, or an issue answering a `pull-request` subject, answers `absent`. Every other
 * failure — no credential, a rate limit, a transport error, an address this reader will not parse — answers
 * `notChecked`, meaning nothing was established. That distinction is the whole function; see
 * {@link PullRequestLiveState}.
 *
 * @param repo the `owner/name` slug the number belongs to
 * @param number the referenced pull request
 * @param home the state home whose stored GitHub token is the fallback credential; the ambient one when absent
 * @param subject whether an issue at the number counts, see {@link PullRequestSubject}
 * @returns what the provider said, or `notChecked` when it was never asked
 */
export async function readPullRequestState({
  home,
  number,
  repo,
  subject,
}: {
  home?: string;
  number: number;
  repo: string;
  subject: PullRequestSubject;
}): Promise<PullRequestLiveState> {
  const token = githubToken(home === undefined ? {} : { home });
  if (token === undefined) {
    return { kind: "notChecked" };
  }
  const read = await readGithubObject({
    address: pullRequestStateAddress({ number, repo, subject }),
    graphql: githubReadGraphql({ token }),
    limit: 1,
    nowIso: () => new Date().toISOString(),
  });
  if (read.isErr()) {
    return saysNoSuchPullRequest({ error: read.error }) ? { kind: "absent" } : { kind: "notChecked" };
  }
  return pullRequestStateOf({ data: read.value.data, subject });
}

/**
 * The address a subject is read by. The live reader refuses an issue answering a `/pull/` address
 * (`NOT_A_PULL_REQUEST`), so a subject admitting either kind is read by `/issues/`, which GitHub answers with
 * whichever kind holds the number.
 *
 * @param repo the `owner/name` slug the number belongs to
 * @param subject whether an issue at the number counts, see {@link PullRequestSubject}
 * @returns the `/pull/` URL for a `pull-request` subject, the `/issues/` URL for an `issue-or-pull-request` one
 */
export function pullRequestStateAddress({
  number,
  repo,
  subject,
}: {
  number: number;
  repo: string;
  subject: PullRequestSubject;
}): string {
  const family = subject === "pull-request" ? "pull" : "issues";
  return `https://github.com/${repo}/${family}/${String(number)}`;
}

/**
 * Which live state a read pull-request node carries.
 *
 * Only GitHub's own `OPEN` answers `open`, and only `CLOSED` or `MERGED` answers `settled`. A node whose
 * `state` is missing or is some other word answers `notChecked`: the read happened, but it established neither,
 * and each caller already keeps an unestablished subject exactly as it found it. Asked for a `pull-request`, an
 * `Issue` node is GitHub saying no pull request holds that number, so `absent` — the live reader already refuses
 * one at a `/pull/` address, so this holds for a node handed in directly — and a node of no stated type
 * established nothing, so `notChecked`.
 *
 * @param data the node the live reader returned
 * @param subject whether an issue node counts, see {@link PullRequestSubject}
 * @returns `settled` for a closed or merged pull request, `open` for an open one, `absent` for an issue where a
 * pull request was asked for, `notChecked` otherwise
 */
export function pullRequestStateOf({
  data,
  subject,
}: {
  data: unknown;
  subject: PullRequestSubject;
}): PullRequestLiveState {
  if (subject === "pull-request") {
    const typename = isRecord(data) ? data["__typename"] : undefined;
    if (typename === ISSUE_TYPENAME) {
      return { kind: "absent" };
    }
    if (typename !== PULL_REQUEST_TYPENAME) {
      return { kind: "notChecked" };
    }
  }
  const state = isRecord(data) ? data["state"] : undefined;
  if (typeof state !== "string") {
    return { kind: "notChecked" };
  }
  const word = state.toUpperCase();
  if (SETTLED_PULL_REQUEST_STATES.has(word)) {
    return { kind: "settled", state: word };
  }
  return word === OPEN_PULL_REQUEST_STATE ? { kind: "open" } : { kind: "notChecked" };
}

/**
 * The words GitHub's GraphQL API uses for a pull request that does not exist.
 *
 * MEASURED — `slopweaver github read https://github.com/lachiejames/slopweaver/pull/<number>` answers
 * `Could not resolve to an issue or pull request with the number of 505.` That arrives as a `READ_FAILED`
 * rather than a `NOT_FOUND`, because the reader maps every GraphQL response error the same way, so matching
 * on the error CODE alone silently disables this whole check: it was disabled exactly that way for one
 * revision, and the rows it had correctly flagged quietly stopped being flagged.
 *
 * @internal exported for its own tests until a consumer outside this module reads it.
 */
export const NO_SUCH_PULL_REQUEST = "could not resolve to an issue or pull request";

/**
 * Whether a failed read means the pull request does not exist, as opposed to the read not happening.
 *
 * A `NOT_FOUND` is taken at face value, and so is a `NOT_A_PULL_REQUEST` — GitHub answering the number with an
 * issue is GitHub saying no pull request holds it. A `READ_FAILED` counts only when it carries GitHub's own
 * no-such-object wording. Anything else — a rate limit, an expired token, a transport error — establishes
 * nothing, and saying otherwise would mark every row on the list stale over one bad credential.
 *
 * @param error what the read returned
 * @returns true only when the provider said the object is not there
 */
export function saysNoSuchPullRequest({ error }: { error: GithubLiveError }): boolean {
  if (error.code === "NOT_FOUND" || error.code === "NOT_A_PULL_REQUEST") {
    return true;
  }
  return error.code === "READ_FAILED" && error.message.toLowerCase().includes(NO_SUCH_PULL_REQUEST);
}
