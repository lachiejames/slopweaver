/**
 * Pure half of `slopweaver github pr standing`: one pull request read down to what a person opens GitHub to see —
 * who approved it (a person or a bot), who is still asked, what its base branch requires, CI, CodeRabbit, and
 * whether GitHub would merge it — plus one sentence that says it aloud.
 *
 * The reason it exists: a console voice reading `github read --json` sees `reviewDecision: APPROVED` near the
 * top of a 180 KB document its verb tool cuts at 20 KiB, and says "GitHub reports approved" when that decision
 * came only from a CodeRabbit approval, two teams are still asked, and the base requires no review at all. The
 * voice must see everything the owner would want it to see about a pull request they are looking at. Reproduce
 * the size with `slopweaver github read "<pull-request-url>" --json | wc -c`.
 *
 * Every verdict here is an existing one — `approvingLogins`, `ciVerdict`, `codeRabbitVerdict`, `mergeStatusClause`
 * — so this module decides nothing a landing or review-state row would decide differently.
 */
import { isRecord } from "../../../lib/parsers.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { summarizeChecks } from "../../../live/github/checks.js";
import type { ReviewGate, ReviewRule } from "../../../live/github/reviewRules.js";
import type { PrLiveState, PrReview } from "../../../live/github/reviewState.js";
import { codeRabbitVerdict } from "../../../review/codeRabbitVerdict.js";
import { mergeStatusClause } from "../../../review/githubMergeStatus.js";
import {
  approvingLogins,
  type CiVerdict,
  type CodeRabbitVerdict,
  ciVerdict,
  isBotLogin,
  reviewOpinion,
} from "../../../review/reviewState.js";
import type { FlagSpec } from "../../parseFlags.js";
import { parseFlags } from "../../parseFlags.js";

/** Every flag this verb accepts, named ONCE so the spec and the advertised list cannot disagree. */
const FLAG_STEMS: readonly string[] = ["home"];

/** The parse spec, built from the one stem list. */
const PR_STANDING_FLAGS: FlagSpec = { boolean: ["json"], string: FLAG_STEMS };

/** Every accepted flag for the help-truth ratchet. */
export const GITHUB_PR_STANDING_FLAG_NAMES: readonly string[] = [...FLAG_STEMS, "json"].map((name) => `--${name}`);

/** The resolved request: one pull-request address, and how to print it. */
export interface GithubPrStandingArgs {
  readonly url: string;
  readonly json: boolean;
  readonly home: string | undefined;
}

/**
 * Parse `github pr standing <url> [--json] [--home <dir>]` before touching the network.
 *
 * @param rest argv after `github pr standing`
 * @returns the address and output mode, or every usage problem
 */
export function parseGithubPrStandingArgs({ rest }: { rest: readonly string[] }): Result<GithubPrStandingArgs> {
  const parsed = parseFlags({ allowPositionals: true, args: rest, spec: PR_STANDING_FLAGS });
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  const { positionals, values } = parsed.value;
  if (positionals.length !== 1) {
    return err([`exactly one pull-request address is required; got ${String(positionals.length)}`]);
  }
  const home = values["home"];
  return ok({
    home: typeof home === "string" ? home : undefined,
    json: values["json"] === true,
    url: positionals[0]!,
  });
}

/** What the base branch requires before anything lands on it, or why this read could not say. */
type BaseReview =
  | { readonly kind: "required"; readonly rules: readonly ReviewRule[] }
  | { readonly kind: "none" }
  | { readonly kind: "unreadable"; readonly reason: string };

/** One review request still open, as GitHub holds it. */
interface PendingRequest {
  readonly name: string;
  readonly kind: "team" | "user";
  readonly codeOwner: boolean;
}

/** One pull request's standing, as a person would read it off GitHub. */
export interface GithubPrStanding {
  readonly number: number;
  readonly url: string;
  readonly title: string;
  readonly author: string;
  readonly draft: boolean;
  readonly base: {
    readonly name: string;
    readonly defaultBranch: string;
    /**
     * GitHub's own `protected` flag off the branch read, which needs only read access — or `unread`. It is what
     * makes a `none` review answer safe to say aloud: classic protection's own rules are readable only with admin
     * access and answer a non-admin 404, which the review read takes for "no classic protection".
     */
    readonly protected: boolean | "unread";
    readonly review: BaseReview;
  };
  readonly reviews: {
    /** People whose latest verdict is an approval — never the author, never a bot. */
    readonly approvedBy: readonly string[];
    /** People whose latest verdict is a change request. */
    readonly changesRequestedBy: readonly string[];
    /** Bots whose latest verdict is an approval — shown apart, because a bot's tick is not a person's. */
    readonly botApprovedBy: readonly string[];
    readonly requested: readonly PendingRequest[];
    /** GitHub's own aggregate, verbatim, or the empty string when it states none. */
    readonly reviewDecision: string;
    /** Whether GitHub reported more reviews or requests than this read carried. */
    readonly truncated: boolean;
  };
  readonly ci: {
    readonly verdict: CiVerdict | "unread";
    readonly total: number;
    readonly failing: readonly string[];
    readonly running: number;
    /** Why the checks could not be read, or whether the rollup was cut; empty when neither. */
    readonly residue: readonly string[];
  };
  readonly codeRabbit: { readonly verdict: CodeRabbitVerdict; readonly detail: string };
  readonly merge: { readonly mergeable: string; readonly status: string };
  /** The whole standing as one or two spoken sentences, ids left out. */
  readonly sentence: string;
  /** The provider read's own instant — the moment these fields were true. */
  readonly readAtIso: string;
}

/** The base gate as the three answers a reader branches on. */
function baseReviewOf({ gate }: { gate: ReviewGate }): BaseReview {
  if (gate.kind === "unreadable") {
    return { kind: "unreadable", reason: gate.reason };
  }
  if (gate.rules.length === 0) {
    return { kind: "none" };
  }
  return { kind: "required", rules: gate.rules };
}

/**
 * GitHub's `protected` flag off a raw `GET /repos/{owner}/{repo}/branches/{branch}` response, or `unread` when
 * the response carries no boolean there — a read that failed is handed in as `undefined` and reads the same.
 *
 * @param response the raw REST response, unvalidated, or undefined when the read failed
 * @returns the flag, or `unread`
 */
export function branchProtectedOf({ response }: { response: unknown }): boolean | "unread" {
  const data = isRecord(response) ? response["data"] : undefined;
  const flag = isRecord(data) ? data["protected"] : undefined;
  if (typeof flag !== "boolean") {
    return "unread";
  }
  return flag;
}

/** Whether a review came from a machine — by GitHub's own actor type, or by the login when the type is absent. */
function byBot({ review }: { review: PrReview }): boolean {
  return review.byBot === true || isBotLogin({ login: review.login });
}

/** Every login whose LATEST opinionated review is a change request, author and bots excluded. */
function changesRequestedLogins({ pr }: { pr: PrLiveState }): readonly string[] {
  const latest = new Map<string, string>();
  for (const review of pr.reviews) {
    const opinion = reviewOpinion({ state: review.state });
    const countable =
      review.login.toLowerCase() !== pr.authorLogin.toLowerCase() && !byBot({ review }) && opinion !== "commented";
    if (countable) {
      latest.set(review.login.toLowerCase(), opinion);
    }
  }
  return [...latest.entries()].filter(([, opinion]) => opinion === "changes-requested").map(([login]) => login);
}

/** Every bot whose latest opinionated review is an approval. */
function botApprovals({ pr }: { pr: PrLiveState }): readonly string[] {
  const latest = new Map<string, string>();
  for (const review of pr.reviews) {
    const opinion = reviewOpinion({ state: review.state });
    if (byBot({ review }) && opinion !== "commented") {
      latest.set(review.login.toLowerCase(), opinion);
    }
  }
  return [...latest.entries()].filter(([, opinion]) => opinion === "approved").map(([login]) => login);
}

/** People who approved, excluding any login GitHub typed a bot that the login test alone would miss. */
function humanApprovals({ pr }: { pr: PrLiveState }): readonly string[] {
  const bots = new Set(pr.reviews.filter((review) => byBot({ review })).map((review) => review.login.toLowerCase()));
  return [...approvingLogins({ authorLogin: pr.authorLogin, reviews: pr.reviews })].filter((login) => !bots.has(login));
}

/** The CI half: the shared verdict over the deduped checks, or `unread` when the rollup was never read. */
function ciOf({ pr }: { pr: PrLiveState }): GithubPrStanding["ci"] {
  const summary = summarizeChecks({ checks: pr.checks.checks });
  const failing = pr.checks.checks.filter((check) => check.state === "failed").map((check) => check.name);
  const residue: string[] = [];
  if (pr.checksTruncated) {
    residue.push("more checks ran than this read carried, so a failing one may be missing");
  }
  if (pr.checksRead.kind === "unread") {
    return { failing, residue: [pr.checksRead.why, ...residue], running: 0, total: 0, verdict: "unread" };
  }
  return {
    failing,
    residue,
    running: summary.running + summary.queued,
    total: summary.total,
    verdict: ciVerdict({ checks: summary }),
  };
}

/** A list of names as speech: "a", "a and b", "a, b and c". */
function spokenList({ names }: { names: readonly string[] }): string {
  if (names.length <= 1) {
    return names.join("");
  }
  return `${names.slice(0, -1).join(", ")} and ${names.at(-1)!}`;
}

/** One rule as the words a person uses for it. */
function ruleWords({ rule }: { rule: ReviewRule }): string {
  if (rule.codeOwners && rule.approvals > 0) {
    return `a code owner's approval plus ${String(rule.approvals)} approving review(s)`;
  }
  if (rule.codeOwners) {
    return "a code owner's approval";
  }
  return `${String(rule.approvals)} approving review(s)`;
}

/** The base-branch clause: what it requires, so "no approvals" reads as expected or as missing. */
function baseClause({ standing }: { standing: Omit<GithubPrStanding, "sentence"> }): string {
  const { base } = standing;
  const defaultNote = base.name === base.defaultBranch ? " (the default branch)" : "";
  if (base.review.kind === "unreadable") {
    return `It targets ${base.name}${defaultNote}; whether that branch requires a review could not be read (${base.review.reason}).`;
  }
  // Only an UNPROTECTED branch licenses "no approval is needed": on a protected one, classic protection's own
  // review rule may be one this credential cannot read, so "found none" is all this read can honestly say.
  if (base.review.kind === "none" && base.protected === false) {
    const approvals = standing.reviews.approvedBy.length === 0 ? " — so no approval is needed to merge it" : "";
    return `It targets ${base.name}${defaultNote}, which is unprotected and requires no review${approvals}.`;
  }
  if (base.review.kind === "none" && base.protected === true) {
    return `It targets ${base.name}${defaultNote}, a protected branch; no review requirement was found in the rules this read could see.`;
  }
  if (base.review.kind === "none") {
    return `It targets ${base.name}${defaultNote}; no review requirement was found, and whether it is protected could not be read.`;
  }
  const rules = spokenList({ names: base.review.rules.map((rule) => ruleWords({ rule })) });
  return `It targets ${base.name}${defaultNote}, which requires ${rules}.`;
}

/** The review clause: who approved, who asked for changes, who is still asked, and what a bot's tick means. */
function reviewClause({ standing }: { standing: Omit<GithubPrStanding, "sentence"> }): string {
  const { reviews } = standing;
  const parts: string[] = [];
  if (reviews.approvedBy.length > 0) {
    parts.push(`Approved by ${spokenList({ names: reviews.approvedBy })}.`);
  } else {
    parts.push("No person has approved it.");
  }
  if (reviews.changesRequestedBy.length > 0) {
    parts.push(`Changes requested by ${spokenList({ names: reviews.changesRequestedBy })}.`);
  }
  if (reviews.requested.length > 0) {
    const names = reviews.requested.map((request) =>
      request.codeOwner ? `${request.name} (code owner)` : request.name,
    );
    parts.push(`Review is still requested from ${spokenList({ names })}.`);
  }
  const botOnly =
    reviews.reviewDecision === "APPROVED" && reviews.approvedBy.length === 0 && reviews.botApprovedBy.length > 0;
  if (botOnly) {
    parts.push(
      `GitHub's review decision reads APPROVED only because ${spokenList({ names: reviews.botApprovedBy })} approved — a bot, not a person.`,
    );
  }
  if (reviews.truncated) {
    parts.push("GitHub reported more reviews or requests than this read carried.");
  }
  return parts.join(" ");
}

/** The CI clause. */
function ciClause({ ci }: { ci: GithubPrStanding["ci"] }): string {
  if (ci.verdict === "unread") {
    return "CI could not be read.";
  }
  if (ci.verdict === "none") {
    return "No CI ran on it.";
  }
  if (ci.verdict === "red") {
    return `CI is failing: ${spokenList({ names: ci.failing })}.`;
  }
  if (ci.verdict === "running") {
    return `CI is still running (${String(ci.running)} of ${String(ci.total)} checks).`;
  }
  return `CI is green (${String(ci.total)} checks).`;
}

/** The whole standing as the sentences a voice says. */
function sentenceOf({ standing }: { standing: Omit<GithubPrStanding, "sentence"> }): string {
  const draft = standing.draft ? " It is a draft." : "";
  return [
    `Pull request ${String(standing.number)} by ${standing.author}.${draft}`,
    baseClause({ standing }),
    reviewClause({ standing }),
    ciClause({ ci: standing.ci }),
    `CodeRabbit: ${standing.codeRabbit.detail}.`,
    `Merge: ${standing.merge.status}.`,
  ].join(" ");
}

/**
 * Read one pull request's live state and its base branch's review requirement down to its standing.
 *
 * @param pr the live pull-request state, from the same by-number read `github review-state` uses
 * @param baseGate what the base branch requires, read from both classic protection and rulesets
 * @param baseProtected GitHub's own `protected` flag for the base branch, or `unread`
 * @param readAtIso the read's own instant
 * @returns the standing, sentence included
 */
export function githubPrStandingOf({
  pr,
  baseGate,
  baseProtected,
  readAtIso,
}: {
  pr: PrLiveState;
  baseGate: ReviewGate;
  baseProtected: boolean | "unread";
  readAtIso: string;
}): GithubPrStanding {
  const standing: Omit<GithubPrStanding, "sentence"> = {
    author: pr.authorLogin,
    base: {
      defaultBranch: pr.defaultBranch,
      name: pr.baseRefName,
      protected: baseProtected,
      review: baseReviewOf({ gate: baseGate }),
    },
    ci: ciOf({ pr }),
    codeRabbit: codeRabbitVerdict({
      headOid: pr.headOid,
      reviews: pr.reviews,
      reviewsTruncated: pr.reviewsTruncated,
      threadCount: pr.threadCount,
      threads: pr.threads,
      threadsTruncated: pr.threadsTruncated,
    }),
    draft: pr.isDraft,
    merge: { mergeable: pr.mergeable, status: mergeStatusClause({ mergeStatus: pr.githubMergeStatus }) },
    number: pr.number,
    readAtIso,
    reviews: {
      approvedBy: humanApprovals({ pr }),
      botApprovedBy: botApprovals({ pr }),
      changesRequestedBy: changesRequestedLogins({ pr }),
      requested: pr.codeownerRequests.map((request) => ({
        codeOwner: request.asCodeOwner,
        kind: request.kind,
        name: request.name,
      })),
      reviewDecision: pr.reviewDecision,
      truncated: pr.reviewsTruncated || pr.codeownerRequestsTruncated,
    },
    title: pr.title,
    url: pr.url,
  };
  return { ...standing, sentence: sentenceOf({ standing }) };
}

/**
 * The standing as the lines a terminal reader wants: the sentence, then the residue a reader should not miss.
 *
 * @returns the lines
 */
export function renderGithubPrStandingText({ standing }: { standing: GithubPrStanding }): readonly string[] {
  return [`#${String(standing.number)} ${standing.title}`, standing.url, standing.sentence, ...standing.ci.residue];
}
