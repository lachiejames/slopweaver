/**
 * Who GitHub itself says the code owners of a pull request are — read off GitHub's own flags, never
 * recomputed from the CODEOWNERS file.
 *
 * ## Why this exists beside `./codeowners.ts`, which already answers a codeowner question
 *
 * Determining programmatically who the code owners are on a pull request has been hard: reading the CODEOWNERS
 * file and reverse-engineering it is the wrong route when the authoritative source can be read directly, and if
 * the data is not held it has been thrown away or projected away for no good reason.
 *
 * The projecting was the problem. MEASURED when this file was added: `src/live/github/read.ts`
 * selected **no** `reviewRequests` at all, so `slopweaver github read <pr url>` carried zero codeowner
 * information; `src/live/github/reviewState.ts` selected `reviewRequests` but dropped GitHub's own
 * `asCodeOwner` boolean off every node, and answered the codeowner question instead by fetching the
 * CODEOWNERS blob and re-implementing GitHub's glob matcher — 801 lines across `./codeowners.ts`,
 * `./codeownerRules.ts` and `./codeownerTeams.ts`. Reproduce both halves:
 * `grep -c reviewRequests src/live/github/read.ts` (0) and `grep -c asCodeOwner src/live/github/reviewState.ts` (0).
 *
 * So this module is the AUTHORITATIVE answer and that one is the DERIVED answer, and they are kept apart
 * rather than merged, because they answer different questions and only one of them is GitHub's:
 *
 * - **This module** reports the owners GitHub is currently applying to this pull request — the review
 *   requests GitHub flagged `asCodeOwner`, plus the teams a submitted review was made ON BEHALF OF. Nothing
 *   here parses a pattern, matches a path, or knows a rule exists.
 * - **`./codeownerRules.ts`** reports which CODEOWNERS *rules* a pull request still owes, and
 *   `./codeownerTeams.ts` reports whether those are an AND or an OR. GitHub's API states neither, so that
 *   answer stays derived, and this module deliberately claims **no connective** rather than inventing one.
 *
 * ## The one thing GitHub's flags cannot tell you, stated rather than discovered
 *
 * `asCodeOwner` rides an OPEN review request. GitHub retires the request the moment the requirement is
 * satisfied, so a codeowner who has already approved leaves no flagged request behind. For a TEAM that is
 * recoverable — GitHub records the team on the review itself as `onBehalfOf`, which is what the interface
 * renders as the satisfied owner — and those entries come back `approved` here. For an INDIVIDUAL codeowner
 * there is no equivalent field, so their satisfied requirement is indistinguishable from any other approval,
 * and that is a residue line on every answer rather than a silence.
 *
 * Pure. Every input is already-extracted GitHub state; the clock, the network and the CODEOWNERS file are
 * all somebody else's problem.
 */

/** One review request as GitHub returned it, with the flag that says GitHub itself required this reviewer. */
export interface GithubReviewRequest {
  /** `owner/team` for a team request and the login for a user request, exactly as GitHub spells it. */
  readonly name: string;
  readonly kind: "team" | "user";
  /** GitHub's own `PullRequestReviewRequest.asCodeOwner`. */
  readonly asCodeOwner: boolean;
}

/** One submitted review, carrying the teams GitHub recorded it as satisfying. */
export interface GithubReviewOnBehalfOf {
  readonly login: string;
  /** GitHub's review state — only `APPROVED` clears an owner. */
  readonly state: string;
  /** `owner/team` for every team in the review's `onBehalfOf` connection. */
  readonly onBehalfOf: readonly string[];
}

/**
 * Whether GitHub is still waiting on this owner, or has already recorded its approval.
 *
 * @internal
 */
export type GithubCodeownerState = "pending" | "approved";

/** One code owner GitHub itself is applying to the pull request. */
export interface GithubCodeowner {
  /** The `@`-prefixed token, spelled the way CODEOWNERS spells one: `@owner/team` or `@login`. */
  readonly token: string;
  readonly kind: "team" | "user";
  readonly state: GithubCodeownerState;
}

/** GitHub's whole codeowner answer for one pull request. */
export interface GithubCodeownerRequirement {
  /** Every owner GitHub named, teams before users and alphabetical within each. */
  readonly owners: readonly GithubCodeowner[];
  /** The team tokens alone, sorted — the flat list a consumer that only wants teams takes. */
  readonly teams: readonly string[];
  /** The individually-named owner tokens alone, sorted. */
  readonly users: readonly string[];
  /** The whole sentence a reader reads, including what the flags alone cannot say. Always populated. */
  readonly sentence: string;
  /** What this answer could not establish, said out loud rather than folded into the sentence. */
  readonly residue: readonly string[];
  /**
   * Whether GitHub reported more review REQUESTS than the read carried — a PENDING owner may be missing.
   *
   * A flag rather than only a residue sentence, because the two truncations fail in opposite directions and
   * only this one is dangerous. A capped REVIEWS read can lose an APPROVED owner, so a satisfied owner reads
   * pending and the answer errs toward holding a pull request back. A capped REQUESTS read loses a PENDING
   * owner, so an unsatisfied requirement reads as satisfied — a false GREEN, which `./landing.ts`'s
   * `codeowners-satisfied` test must answer `unknown` to rather than `pass`. Prose cannot be branched on.
   */
  readonly requestsTruncated: boolean;
}

/** The residue every answer carries, because it is a property of GitHub's flags rather than of one read. */
const SATISFIED_OWNER_RESIDUE =
  "GitHub retires a code-owner review request once it is satisfied, so an INDIVIDUAL owner who has already " +
  "approved leaves no `asCodeOwner` request behind and is not distinguishable here from any other approver; " +
  "a satisfied TEAM is, through the review's `onBehalfOf`";

/** The `@`-prefixed token for a name GitHub returned bare. */
function tokenOf({ name }: { name: string }): string {
  return name.startsWith("@") ? name : `@${name}`;
}

/** Sort owners so teams lead and each kind is alphabetical — a stable order two reads can be compared across. */
function byKindThenToken({ a, b }: { a: GithubCodeowner; b: GithubCodeowner }): number {
  if (a.kind !== b.kind) {
    return a.kind === "team" ? -1 : 1;
  }
  return a.token.localeCompare(b.token);
}

/** The sentence for an answer, written so a reader never has to open the CODEOWNERS file to interpret it. */
function sentenceOf({ owners }: { owners: readonly GithubCodeowner[] }): string {
  if (owners.length === 0) {
    return "GitHub reports no code-owner review requirement on this pull request";
  }
  const parts = owners.map((owner) => `${owner.token} (${owner.state})`);
  return `GitHub reports these code owners: ${parts.join(", ")}`;
}

/**
 * Read GitHub's own code-owner answer for one pull request off the state GitHub returned.
 *
 * @param requests every review request on the pull request, flagged or not
 * @param requestsTruncated whether GitHub reported more review requests than the read asked for
 * @param reviews every submitted review this read carried, with its `onBehalfOf` teams
 * @param reviewsTruncated whether GitHub reported more reviews than the read asked for
 * @returns the owners GitHub named, with the connective deliberately absent and the residue stated
 */
export function githubCodeownerRequirement({
  requests,
  requestsTruncated,
  reviews,
  reviewsTruncated,
}: {
  requests: readonly GithubReviewRequest[];
  requestsTruncated: boolean;
  reviews: readonly GithubReviewOnBehalfOf[];
  reviewsTruncated: boolean;
}): GithubCodeownerRequirement {
  const byToken = new Map<string, GithubCodeowner>();
  for (const team of reviews
    .filter((review) => review.state === "APPROVED")
    .flatMap((review) => review.onBehalfOf)
    .filter((name) => name !== "")) {
    const token = tokenOf({ name: team });
    byToken.set(token, { kind: "team", state: "approved", token });
  }
  for (const request of requests.filter((entry) => entry.asCodeOwner && entry.name !== "")) {
    const token = tokenOf({ name: request.name });
    byToken.set(token, { kind: request.kind, state: "pending", token });
  }
  const owners = [...byToken.values()].toSorted((a, b) => byKindThenToken({ a, b }));
  const residue = [SATISFIED_OWNER_RESIDUE];
  if (requestsTruncated) {
    residue.push("GitHub reported more review requests than this read asked for, so a pending owner may be missing");
  }
  if (reviewsTruncated) {
    residue.push("GitHub reported more reviews than this read asked for, so an approved team owner may be missing");
  }
  return {
    owners,
    requestsTruncated,
    residue,
    sentence: sentenceOf({ owners }),
    teams: owners.filter((owner) => owner.kind === "team").map((owner) => owner.token),
    users: owners.filter((owner) => owner.kind === "user").map((owner) => owner.token),
  };
}
