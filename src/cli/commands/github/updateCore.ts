/**
 * The `github pr update` decisions, as pure functions — addressing, authorisation, freshness and replacement.
 *
 * They live here rather than in `./core.ts` because that file is already large and these are the parts most
 * worth testing directly: every one of them is a policy that used to be either absent or wrong.
 *
 * ## Authorship answers authorisation, and nothing else
 *
 * The old gate asked "did slopweaver open this pull request?" and answered it from a local ledger, because
 * under a personal token GitHub attributes every write to the operator and so the pull request cannot prove
 * its own provenance. That reasoning is correct and the conclusion was still wrong: provenance was never the
 * interesting question. "Is this pull request authored by the account I am authed as?" is answerable in one
 * call, and it is the question that actually protects anything.
 *
 * So authorship is an AUTHORISATION check. It is not a statement about the body — a pull request the authed
 * user opened can still have a description written by another tool or in a shape this repository cannot
 * represent. Body safety is `../../../outbound/github/recovery.ts`'s job, and keeping the two apart is what
 * stops either being asked to carry the other's weight.
 *
 * Comparison is by immutable numeric id, never by login. A login can be changed and reused; an id cannot.
 *
 * ## Fail closed on an identity we could not establish
 *
 * `users.getAuthenticated` is documented for user access tokens and fine-grained PATs, with 401 and 403
 * failure states, and an installation token is not on that list. An App-created pull request will normally
 * expose a bot author. None of that is branched on by guessing: an identity read that did not succeed, or a
 * pull request with no author, is a refusal rather than a pass.
 */
import { lfLineEndings } from "../../../outbound/github/lineEndings.js";
import type { PrFormDraft } from "../../../outbound/github/types.js";

/** The live pull request, narrowed to what a decision here needs. */
export interface LivePr {
  readonly number: number;
  readonly authorId: number | undefined;
  readonly body: string | undefined;
  readonly title: string;
  readonly draft: boolean;
  readonly state: string;
  readonly baseRef: string;
  readonly baseRepoFullName: string;
  /**
   * The head branch's identity.
   *
   * `repoFullName` is undefined when GitHub reports `head.repo` as null, which happens once a fork is deleted.
   * That stays a DISTINCT state rather than being coalesced to the base repository: collapsing it would let a
   * deleted-fork pull request and a same-repository one share an address.
   */
  readonly head: {
    readonly ref: string;
    readonly label: string;
    readonly repoFullName: string | undefined;
    readonly sha: string;
  };
}

/** Whether this caller may edit this pull request's description. */
export type Authorisation =
  | { readonly kind: "self" }
  | { readonly kind: "overridden"; readonly notice: string }
  | { readonly kind: "refused"; readonly reason: string };

/** The environment variable that lets a foreign-authored pull request through, for one run. */
export const ALLOW_FOREIGN_PR = "SLOPWEAVER_ALLOW_FOREIGN_PR";

/** The environment variable that lets a wholesale description replacement through, for one run. */
export const ALLOW_PR_REPLACE = "SLOPWEAVER_ALLOW_PR_REPLACE";

/** What a caller is asking to do to a foreign-authored pull request — only changes the wording below. */
export type GithubPrAuthorisationPurpose =
  "description-update" | "stack-adopt" | "stack-register" | "stack-remove" | "request-review" | "retarget";

/** The purpose-specific fragment of the foreign-author messages below. */
function purposeWording({ purpose }: { purpose: GithubPrAuthorisationPurpose }): {
  readonly gerund: string;
  readonly verbNotFor: string;
} {
  if (purpose === "stack-adopt") {
    return {
      gerund: "rebasing, squashing and force-pushing a pull request you did not author",
      verbNotFor: "adopting someone else's pull request into your local stack state is not what this verb is for",
    };
  }
  if (purpose === "stack-register") {
    return {
      gerund: "registering native membership and local enrolment for a pull request you did not author",
      verbNotFor: "registering someone else's pull request into your local stack state is not what this verb is for",
    };
  }
  if (purpose === "stack-remove") {
    return {
      gerund: "removing a pull request you did not author from its native stack",
      verbNotFor: "removing someone else's pull request from a stack is not what this verb is for",
    };
  }
  if (purpose === "request-review") {
    return {
      gerund: "requesting review on a pull request you did not author",
      verbNotFor: "asking a colleague to review someone else's pull request is not what this verb is for",
    };
  }
  if (purpose === "retarget") {
    return {
      gerund: "retargeting the base branch of a pull request you did not author",
      verbNotFor: "retargeting someone else's pull request is not what this verb is for",
    };
  }
  return {
    gerund: "editing a description on a pull request you did not author",
    verbNotFor: "editing other people's descriptions is not what this verb is for",
  };
}

/**
 * Whether the authed user may act on this pull request.
 *
 * @param prAuthorId the pull request's author id, or undefined when the read did not carry one
 * @param authedUserId the authenticated user's id, or undefined when that read did not succeed
 * @param allowForeign whether the break-glass variable is set for this run
 * @param purpose what the caller is asking to do, for the message's wording only
 * @returns the decision, with a reason naming the escape when it refuses
 */
export function authorisationFor({
  prAuthorId,
  authedUserId,
  allowForeign,
  purpose,
}: {
  prAuthorId: number | undefined;
  authedUserId: number | undefined;
  allowForeign: boolean;
  purpose: GithubPrAuthorisationPurpose;
}): Authorisation {
  if (authedUserId === undefined) {
    return {
      kind: "refused",
      reason:
        "could not establish which GitHub account this token belongs to, so whether you authored this pull " +
        "request cannot be checked. Refusing rather than guessing — an App installation token cannot answer this",
    };
  }
  if (prAuthorId === undefined) {
    return {
      kind: "refused",
      reason:
        "GitHub returned no author for this pull request, so authorship cannot be checked. Refusing rather than guessing",
    };
  }
  if (prAuthorId === authedUserId) {
    return { kind: "self" };
  }
  const { gerund, verbNotFor } = purposeWording({ purpose });
  if (allowForeign) {
    return {
      kind: "overridden",
      notice: `OVERRIDDEN via ${ALLOW_FOREIGN_PR}=1 — ${gerund}. Say so in the pull request.`,
    };
  }
  return {
    kind: "refused",
    reason:
      "this pull request was opened by a different GitHub account from the one this token belongs to, and " +
      `${verbNotFor}. Re-run with ${ALLOW_FOREIGN_PR}=1 if you really mean to`,
  };
}

/** Whether a wholesale description replacement may proceed. */
export type ReplaceDecision =
  { readonly kind: "allowed"; readonly notice: string } | { readonly kind: "refused"; readonly reason: string };

/**
 * Whether `--form` may replace the whole description.
 *
 * This gate is on the MODE, never on provenance or on whether the live body is house-format: a complete form
 * works on any pull request the authorisation check passed, which is the whole point of the mode. What it does
 * not do is act silently. The bytes a replacement discards are unrecoverable — GitHub exposes no body history
 * — so the verb refuses once, prints the before-image, and names the key.
 *
 * @param allowReplace whether the break-glass variable is set for this run
 * @param unchanged whether the replacement renders exactly the bytes already live
 * @returns the decision, with a reason naming the escape when it refuses
 */
export function replaceDecisionFor({
  allowReplace,
  unchanged,
}: {
  allowReplace: boolean;
  unchanged: boolean;
}): ReplaceDecision {
  if (unchanged) {
    // Nothing is discarded, so there is nothing to consent to. Refusing here would make an idempotent re-run
    // demand a variable, which teaches the caller to set it permanently — the opposite of a single-run escape.
    return { kind: "allowed", notice: "the replacement is byte-identical to the live description" };
  }
  if (allowReplace) {
    return {
      kind: "allowed",
      notice: `OVERRIDDEN via ${ALLOW_PR_REPLACE}=1 — replacing the whole description. Say so in the pull request.`,
    };
  }
  return {
    kind: "refused",
    reason:
      "--form REPLACES the whole description, so anything in the live one that a form cannot carry is " +
      `discarded and GitHub keeps no history of it. The diff above is what would change. Re-run with ` +
      `${ALLOW_PR_REPLACE}=1 if that is what you want`,
  };
}

/** The address a caller gave, in whichever of the two shapes they used. */
export type PrAddress =
  | { readonly kind: "number"; readonly owner: string; readonly repo: string; readonly number: number }
  | {
      readonly kind: "branch";
      readonly owner: string;
      readonly repo: string;
      readonly base: string;
      readonly head: string;
    };

/**
 * Which pull request a branch address resolved to.
 *
 * Generic in the candidate so the caller gets its OWN richer payload back rather than the narrowed view this
 * module reasons over — the shell needs the node id and URL that {@link LivePr} deliberately omits.
 */
export type CandidateChoice<T extends LivePr> =
  | { readonly kind: "one"; readonly candidate: T }
  | { readonly kind: "none"; readonly reason: string }
  | { readonly kind: "many"; readonly reason: string };

/** Whether a repository slug names the same repository, case-insensitively as GitHub treats them. */
function sameRepo({ left, right }: { left: string; right: string }): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

/**
 * Whether one candidate matches a branch address.
 *
 * A plain `--head feature` means "a branch in the base repository", so it requires a non-null head repository
 * equal to the base one — a deleted-fork pull request whose ref happens to match is NOT this pull request. A
 * qualified `--head owner:feature` compares the owner case-insensitively and the ref exactly, because GitHub
 * owner names are case-insensitive while git refs are not.
 */
function matchesAddress({
  candidate,
  owner,
  repo,
  base,
  head,
}: {
  candidate: LivePr;
  owner: string;
  repo: string;
  base: string;
  head: string;
}): boolean {
  if (!sameRepo({ left: candidate.baseRepoFullName, right: `${owner}/${repo}` }) || candidate.baseRef !== base) {
    return false;
  }
  const colon = head.indexOf(":");
  if (colon >= 0) {
    const wantOwner = head.slice(0, colon);
    const wantRef = head.slice(colon + 1);
    const gotOwner = candidate.head.label.slice(0, Math.max(0, candidate.head.label.indexOf(":")));
    return gotOwner.toLowerCase() === wantOwner.toLowerCase() && candidate.head.ref === wantRef;
  }
  return (
    candidate.head.ref === head &&
    candidate.head.repoFullName !== undefined &&
    sameRepo({ left: candidate.head.repoFullName, right: candidate.baseRepoFullName })
  );
}

/**
 * Choose the pull request a branch address names, refusing rather than picking when it is not unique.
 *
 * Two pull requests can share a base and head pair over time — one merged, one opened later by hand — and
 * silently editing the older one is the worst available outcome. So a tie is a refusal that lists both numbers
 * and tells the caller to use `--number`. Never newest, never oldest.
 *
 * @param candidates every pull request GitHub returned for this base and head
 * @param address the branch address the caller gave
 * @returns the single match, or a named refusal
 */
export function selectPrCandidate<T extends LivePr>({
  candidates,
  address,
}: {
  candidates: readonly T[];
  address: Extract<PrAddress, { kind: "branch" }>;
}): CandidateChoice<T> {
  // OPEN is required here for the same reason `cachedCandidateUsable` requires it, and leaving it off was
  // incoherent rather than merely lax: the ledger hint was rejected for naming a closed pull request, and then
  // this fallback listed `state: "all"` and handed back the very same one. So a branch pair reused after its
  // pull request merged resolved to the MERGED pull request, and the update rewrote a description on work
  // already landed. `state: "all"` stays right for the LIST — seeing a merged pull request is how ambiguity is
  // detected — but a closed candidate can never be the one the caller means to edit.
  const matched = candidates.filter(
    (candidate) =>
      candidate.state.toLowerCase() === "open" &&
      matchesAddress({ base: address.base, candidate, head: address.head, owner: address.owner, repo: address.repo }),
  );
  const locus = `${address.owner}/${address.repo}#${address.base}...${address.head}`;
  if (matched.length === 0) {
    return {
      kind: "none",
      reason: `no pull request on GitHub matches ${locus}. If its branches have since been deleted or renamed, address it by --number instead`,
    };
  }
  if (matched.length > 1) {
    // Sorted NUMERICALLY. Sorting the rendered strings would put ten before nine, and this line is the operator's
    // only list of which pull requests to disambiguate with --number.
    const numbers = matched
      .map((c) => c.number)
      .toSorted((a, b) => a - b)
      .map((n) => `#${String(n)}`)
      .join(", ");
    return {
      kind: "many",
      reason: `${matched.length} pull requests match ${locus} (${numbers}), so the address is ambiguous. Name one with --number`,
    };
  }
  return { candidate: matched[0]!, kind: "one" };
}

/**
 * Whether a cached ledger candidate may be accepted without listing GitHub for competitors.
 *
 * It may not, unless it is still OPEN. That is the whole content of this function and it closes a real hole: a
 * record naming a merged pull request on `main...feature` would be accepted on topology alone, while a later
 * hand-opened pull request reusing the same branch pair is the one the caller means. Both have the same author,
 * so authorisation would pass and the write would land on the closed one.
 *
 * @param candidate the pull request the cached record's number resolved to
 * @param address the branch address the caller gave
 * @returns true only when this candidate is unambiguously the right one
 */
export function cachedCandidateUsable({
  candidate,
  address,
}: {
  candidate: LivePr;
  address: Extract<PrAddress, { kind: "branch" }>;
}): boolean {
  if (candidate.state.toLowerCase() !== "open") {
    return false;
  }
  return matchesAddress({
    base: address.base,
    candidate,
    head: address.head,
    owner: address.owner,
    repo: address.repo,
  });
}

/** Whether the pull request is still the one every decision was made against. */
export type Freshness = { readonly fresh: true } | { readonly fresh: false; readonly reason: string };

/**
 * Re-check, inside the door, that nothing a decision depended on has moved.
 *
 * The GET-to-PATCH race cannot be closed — GitHub offers no conditional update for a pull-request body — but
 * it can be kept SHORT. Address resolution, the identity read, parsing and the diff all happen before the
 * door, which would stretch that window considerably; re-reading immediately before the PATCH puts it back to
 * one round trip.
 *
 * `head.sha` is compared as well as the body, and that is not incidental. A gold proof anchor is checked by CI
 * against the real head SHA, so a force-push between the two reads would leave a description whose anchor is
 * stale — valid-looking locally, red in CI, reported as success here.
 *
 * @param previewed the pull request as read when the decisions were made
 * @param current the pull request as read again inside the door
 * @returns whether the PATCH may proceed, with the field that moved when it may not
 */
export function updateFreshnessFor({ previewed, current }: { previewed: LivePr; current: LivePr }): Freshness {
  const moved: readonly { readonly what: string; readonly same: boolean }[] = [
    { same: previewed.number === current.number, what: "the pull-request number" },
    { same: previewed.authorId === current.authorId, what: "the author" },
    { same: previewed.body === current.body, what: "the description" },
    { same: previewed.title === current.title, what: "the title" },
    { same: previewed.head.sha === current.head.sha, what: "the head commit" },
    { same: previewed.state.toLowerCase() === current.state.toLowerCase(), what: "the open/closed state" },
    // `draft` is compared even though a PATCH cannot change it, and that is the point: a whole form's draft
    // field is overlaid from the FIRST read, so if another actor flips draft inside the window the recorded
    // form would carry the stale value and the run would report `updated` without ever stating the
    // disagreement. Refusing is cheaper than recording something untrue.
    { same: previewed.draft === current.draft, what: "the draft state" },
  ];
  const changed = moved.find((entry) => !entry.same);
  if (changed === undefined) {
    return { fresh: true };
  }
  return {
    fresh: false,
    reason: `${changed.what} changed between reading this pull request and writing to it, so nothing was sent. Re-run to work from the current state`,
  };
}

/**
 * Refuse an update whose caller derived it at a head the pull request no longer has.
 *
 * `updateFreshnessFor` compares the door's two reads, so it starts from whatever the FIRST read saw. A caller
 * that derived its edit from an earlier read (`github pr reviewers --apply` cuts a table from the diff) names
 * that head, and this pins the door's first read to it. With both, the window left is the PATCH round trip.
 *
 * @param number the pull request's number, for the message
 * @param headSha the live head the door's first read saw
 * @param expectHead the head the caller derived the edit at, or undefined when it named none
 * @returns the refusal reason, or undefined when no head was expected or the live one matches it
 */
export function updateHeadRefusal({
  number,
  headSha,
  expectHead,
}: {
  number: number;
  headSha: string;
  expectHead: string | undefined;
}): string | undefined {
  if (expectHead === undefined || headSha === expectHead) {
    return undefined;
  }
  return `#${String(number)} is at ${headSha}, not the expected head ${expectHead}, so nothing was sent. Re-derive the edit from the current head`;
}

/**
 * Whether the write would change nothing.
 *
 * A pure predicate rather than an inline comparison, so the DECISION is pinned by a test and not merely the
 * message that reports it. It is called inside the door, after the freshness re-read, and that placement is
 * load-bearing: an earlier attempt compared against the pre-door snapshot, where a concurrent edit would have
 * made it claim "unchanged" about a description that had since moved. Behind a freshness check that cannot
 * happen, because anything moving is already a refusal before this is reached.
 *
 * The TITLE is compared as well as the body. A PATCH sends both, so a title-only change is a real change and
 * must not be short-circuited as a no-op.
 *
 * The body is compared with CRLF read as LF. GitHub's web editor stores a description with CRLF while the
 * renderer writes LF, so a byte comparison saw an unchanged re-send as a change: it PATCHed, reported `updated`
 * and owed a fresh description review for content that had not moved. `gatePrBody` already judges content, not
 * line endings, and recovery reads a CRLF body as the same form, cache included, so all three read through
 * `lfLineEndings` and cannot disagree. Any other whitespace difference is still a change.
 *
 * @param renderedBody the exact bytes the write would send
 * @param renderedTitle the title the write would send
 * @param live the pull request as re-read immediately before writing
 * @returns true when sending would leave the pull request's title and description content unchanged
 */
export function writeWouldChangeNothing({
  renderedBody,
  renderedTitle,
  live,
}: {
  renderedBody: string;
  renderedTitle: string;
  live: Pick<LivePr, "body" | "title">;
}): boolean {
  if (live.body === undefined || renderedTitle !== live.title) {
    return false;
  }
  return lfLineEndings({ text: renderedBody }) === lfLineEndings({ text: live.body });
}

/**
 * Whether a complete form agrees with the pull request it is being sent to.
 *
 * A form carries its own target, and a caller who fills one by hand can get it wrong. Sending it anyway would
 * quietly record a locus that does not describe the pull request that was written, so it is refused instead.
 * `draft` is not compared: a REST PATCH cannot change draft state, so a disagreement there is not actionable.
 *
 * @param form the complete form the caller supplied
 * @param live the pull request the address resolved to
 * @returns a reason when the two disagree, or undefined when they are consistent
 */
export function formTargetMismatch({ form, live }: { form: PrFormDraft; live: LivePr }): string | undefined {
  const formRepo = `${form.target.owner}/${form.target.repo}`;
  if (!sameRepo({ left: formRepo, right: live.baseRepoFullName })) {
    return `the form's target repository is ${formRepo} but #${String(live.number)} is on ${live.baseRepoFullName}`;
  }
  if (form.target.base !== live.baseRef) {
    return `the form's base branch is ${form.target.base} but #${String(live.number)} targets ${live.baseRef}`;
  }
  if (form.target.head !== live.head.ref && form.target.head !== live.head.label) {
    return `the form's head branch is ${form.target.head} but #${String(live.number)} comes from ${live.head.label}`;
  }
  return undefined;
}
