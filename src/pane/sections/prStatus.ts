/**
 * PULL REQUESTS — every open pull request on the repository, ranked by how close it is to merging.
 *
 * ## Why this section enrols differently from NEEDS YOU
 *
 * NEEDS YOU requires an orchestration doc AND a started run, which is why the design brief counts ~25 live
 * branches as invisible by construction. This section asks GitHub directly, so a pull request opened by hand,
 * by another session, or by an agent whose doc was never written still appears. The two enrolment rules are
 * deliberately different and both are stated on screen: a row here with no matching NEEDS YOU row is not a
 * contradiction, it is a pull request with no doc.
 *
 * ## The ranking is the owner's: how close each open pull request is to merging
 *
 * So the sort key is {@link MERGE_LADDER} — a rung, not a score. A ladder is auditable ("this is on `review`
 * because checks are green and review is required"); a weighted score is not, and the pane is required to put
 * the reason for a row's position on the screen next to it.
 *
 * ## The weakest check decides the rung, never the average
 *
 * A rollup is graded by its worst member — that is {@link ../../measurement/measure.checkRollupOf}, reused rather
 * than reimplemented. Averaging a check list is the specific error the design brief calls out.
 *
 * Pure builder. This is the domain half of the section (the file-size ratchet split it into five): decoding
 * `gh`'s raw JSON lives in {@link ./prStatusDecode.js}, the rate-limit budget in
 * {@link ./prStatusRateLimit.js}, the identity gap and omission line in {@link ./prStatusIdentity.js}, and
 * the effectful `gh` collection edge in {@link ./prStatusCollect.js}. The builder here is handed
 * already-parsed pull requests.
 */

import { absentAs } from "#lib/absent.js";
import { checkRollupOf } from "../../measurement/measure.js";
import { type Measured, measured, unmeasurable } from "../../measurement/status.js";
import { type BadgeKind, type PaneRow, type RankCandidate, rankRows, type SectionResult } from "../section.js";
import { type AskWindow, absenceReportable, asksForPr, type SlackAsk } from "./slackAsk.js";

/** The section's stable id — the filter value, and the prefix of every row key it produces. */
const PR_STATUS_ID = "prs";

/** The command this section is a view of, printed so its numbers can be checked against it. */
const SOURCE =
  "gh pr list --state open --author @me --json …, plus a `--json number,author` scan of every open one, TWO calls per watched repository, plus one gh api rate_limit and one local gh auth status";

/** What an empty list means here. Measured emptiness, which is not the same as an unread GitHub. */
const EMPTY_REASON =
  "Every watched repository was asked and none reported an open pull request authored by the account named for it. This is a measured zero, not an unread one — an unread one appears above with its reason, and so does a repository that has open pull requests but matched none of them.";

/** One sentence saying what this section answers. */
const BLURB =
  "Your open pull requests across every watched repository, closest to merging first — each with what it is blocked on and the problem it says it solves, parsed from its own body. The team's are counted but not listed: the owner is asked to review in Slack, not through GitHub's review-request field, so enrolling on that field would be hundreds of rows that are not the ask.";

/**
 * The rungs between an open pull request and a merged one, closest first.
 *
 * Ordered by what has to happen next, not by severity. `conflict` sits below `changes` because a rebase is
 * mechanical while requested changes need a decision, and `pending` sits below both because nothing can be
 * done about it at all except wait.
 */
export const MERGE_LADDER = [
  "merge",
  "undraft",
  "review",
  "changes",
  "conflict",
  "failing",
  "pending",
  "unknown",
] as const;

/** One rung of {@link MERGE_LADDER}. */
type MergeRung = (typeof MERGE_LADDER)[number];

/**
 * One party review has been requested from.
 *
 * A user and a team are kept APART because they are different actions. "Chase @a-person" is something the
 * owner can do; "chase @a-team" is not an action, it is a shrug with a handle on it, and rendering the second
 * as if it were the first is the kind of confidently useless row that costs a board its trust.
 *
 * `unknown` exists so that an entry `gh` did not type stays visible AS untyped. Dropping it would turn input
 * we could not read into a confident "nobody has been asked", which is a measured zero that was never
 * measured — the one failure this section is built to refuse.
 */
export interface RequestedReviewer {
  readonly kind: "user" | "team" | "unknown";
  /**
   * What to chase with: a login for a user, a SLUG for a team, the raw label for an unknown.
   *
   * A team's slug rather than its display `name`, because the name is prose — a team called "Platform Owners"
   * renders as the unusable `@Platform Owners`, while its slug is the thing that actually addresses it.
   */
  readonly handle: string;
}

/** One open pull request, as far as `gh` could describe it. */
export interface PrRecord {
  /** Which repository this pull request is in, as `owner/name`. */
  readonly repo: string;
  readonly number: number;
  readonly title: string;
  readonly headRefName: string;
  readonly isDraft: boolean;
  /** `MERGEABLE` / `CONFLICTING` / `UNKNOWN`, or the empty string when `gh` omitted it. */
  readonly mergeable: string;
  /** `APPROVED` / `CHANGES_REQUESTED` / `REVIEW_REQUIRED`, or the empty string when nobody is assigned. */
  readonly reviewDecision: string;
  readonly updatedAt: string;
  readonly url: string;
  /** The login that opened it, or the empty string when `gh` omitted it. Team rows need a name on them. */
  readonly author: string;
  /** Who review has been requested from, each kept apart by kind. Empty when nobody has been asked. */
  readonly reviewRequests: readonly RequestedReviewer[];
  /** The pull-request body, verbatim. The Problem cell is PARSED out of it, never generated. */
  readonly body: string;
  /** The raw `statusCheckRollup` array, folded by {@link checkRollupOf} rather than read here. */
  readonly statusCheckRollup: unknown;
}

/** What a rung means for the reader: the badge, who is blocking, and the one thing to do. */
interface RungMeaning {
  readonly badgeKind: BadgeKind;
  readonly verb: string;
}

/**
 * Who each rung is blocked on and what it wants doing.
 *
 * `pending` is the only `machine` rung — everything else is a person's move, and on this repository that
 * person is almost always the owner. `unknown` is `unmeasured` rather than a grade, so a pull request GitHub
 * could not describe can never share a colour with one that is ready.
 */
const RUNG_MEANING: Readonly<Record<MergeRung, RungMeaning>> = {
  changes: { badgeKind: "warn", verb: "fix" },
  conflict: { badgeKind: "warn", verb: "rebase" },
  failing: { badgeKind: "bad", verb: "fix" },
  merge: { badgeKind: "ok", verb: "merge" },
  pending: { badgeKind: "machine", verb: "wait" },
  review: { badgeKind: "you", verb: "review" },
  undraft: { badgeKind: "you", verb: "undraft" },
  unknown: { badgeKind: "unmeasured", verb: "decide" },
};

/** The rung a pull request sits on once its checks have been graded, plus the evidence for it. */
interface Rung {
  readonly rung: MergeRung;
  readonly why: string;
}

/** The rung implied by the checks alone, or `undefined` when the checks are not what is blocking. */
function checkRung({ pr }: { pr: PrRecord }): Rung | undefined {
  const rollup = checkRollupOf({ value: pr.statusCheckRollup });
  if (rollup.state === "failing") {
    return { rung: "failing", why: `checks failing: ${rollup.failing.join(", ")}` };
  }
  if (rollup.state === "pending") {
    return { rung: "pending", why: "checks still running" };
  }
  if (rollup.state === "unknown") {
    return { rung: "unknown", why: "the check rollup could not be read from `gh`" };
  }
  return undefined;
}

/** The rung implied by review and mergeability, once the checks are known not to be blocking. */
function reviewRung({ pr }: { pr: PrRecord }): Rung {
  const checks =
    checkRollupOf({ value: pr.statusCheckRollup }).state === "none" ? "no checks configured" : "checks green";
  if (pr.mergeable === "CONFLICTING") {
    return { rung: "conflict", why: `${checks}, but the branch conflicts with its base` };
  }
  if (pr.reviewDecision === "CHANGES_REQUESTED") {
    return { rung: "changes", why: `${checks}, and a reviewer has requested changes` };
  }
  if (pr.reviewDecision === "APPROVED") {
    return pr.isDraft
      ? { rung: "undraft", why: `${checks} and approved, but it is still a draft` }
      : { rung: "merge", why: `${checks}, approved, and not a draft` };
  }
  return {
    rung: "review",
    why: `${checks}, and review is ${pr.reviewDecision === "" ? "not requested from anyone yet" : "required"}`,
  };
}

/**
 * Which rung of {@link MERGE_LADDER} a pull request sits on, and why.
 *
 * Exported for its own test: the ladder is the section's whole claim, and a rung chosen wrongly is a row in
 * the wrong place with a confident sentence explaining the wrong position.
 *
 * @param pr the pull request as `gh` described it
 * @returns the rung and the evidence sentence printed on the row
 */
export function rungFor({ pr }: { pr: PrRecord }): Rung {
  const present = checkRung({ pr });
  if (present === undefined) {
    return reviewRung({ pr });
  }
  return present;
}

/**
 * What a pull request is waiting on. Six states, and `none` and `unknown` are NOT interchangeable.
 *
 * "This pull request has nothing blocking it" and "we could not ask GitHub" are different facts with
 * different fixes, and collapsing them is exactly how a board starts lying — a row that could not be measured
 * would sit in the same colour as one that is ready to merge.
 */
type BlockedKind = "ci" | "review" | "person" | "team" | "conflict" | "none" | "unknown";

/** What a pull request is blocked on, and the evidence for saying so. */
export interface BlockedOn {
  readonly kind: BlockedKind;
  readonly why: string;
}

/**
 * What the Slack side of the join says about one pull request, as a sentence for the row.
 *
 * Three outcomes, and the third is the point: the owner raised it and here is when, they demonstrably never raised it,
 * or we cannot tell. The corpus is windowed and refreshed by hand, so "no ask found" and "no ask sent" are
 * different facts — printing the second when only the first is known is how a board starts lying about the
 * one thing it exists to say.
 */
function raisedClause({ pr, asks, window }: { pr: PrRecord; asks: readonly SlackAsk[]; window: AskWindow }): string {
  const raised = asksForPr({ asks, url: pr.url });
  const latest = raised[0];
  if (latest !== undefined) {
    const who = latest.named.length === 0 ? "naming nobody" : `naming ${latest.named.map((n) => `@${n}`).join(", ")}`;
    const by = latest.author === "" ? "by someone gh did not name" : `by @${latest.author}`;
    return `raised in Slack on ${latest.atIso} ${by}, ${who}`;
  }
  const reportable = absenceReportable({ prUpdatedIso: pr.updatedAt, window });
  return reportable.known
    ? `NOT raised in any Slack conversation this corpus can read since ${window.startIso} — the likeliest one to go stale, though a DM or an un-ingested channel would not appear here`
    : `whether it was raised in Slack is NOT MEASURED — ${reportable.why}`;
}

/**
 * Who a pull request awaiting review is actually waiting on.
 *
 * Split out of {@link blockedOnFor} to keep that function under the cognitive-complexity cap, and because
 * this is the one branch where the GitHub half and the Slack half are combined — the rest of the ladder
 * never needs the join at all.
 *
 * The order is deliberate: a NAMED HUMAN outranks a team, because only the first is someone the owner can
 * chase. A team-only request is reported as its own kind rather than dressed up as a person.
 */
function reviewBlocked({
  pr,
  asks,
  window,
  why,
}: {
  pr: PrRecord;
  asks: readonly SlackAsk[];
  window: AskWindow;
  why: string;
}): BlockedOn {
  const raised = raisedClause({ asks, pr, window });
  const people = pr.reviewRequests.filter((reviewer) => reviewer.kind === "user");
  const teams = pr.reviewRequests.filter((reviewer) => reviewer.kind === "team");
  const untyped = pr.reviewRequests.filter((reviewer) => reviewer.kind === "unknown");
  const unreadable =
    untyped.length === 0 ? "" : `, plus ${String(untyped.length)} request(s) gh did not describe well enough to type`;
  if (people.length > 0) {
    const names = people.map((reviewer) => `@${reviewer.handle}`).join(", ");
    return { kind: "person", why: `${why} — requested from ${names}${unreadable}, ${raised}` };
  }
  if (teams.length > 0) {
    const names = teams.map((reviewer) => `@${reviewer.handle}`).join(", ");
    return {
      kind: "team",
      why: `${why} — only a team has been asked (${names})${unreadable}, so there is no one person to chase, ${raised}`,
    };
  }
  return { kind: "review", why: `${why}${unreadable}, ${raised}` };
}

/**
 * What one pull request is blocked on, joining what GitHub records to what the owner actually did in Slack.
 *
 * Derived from {@link rungFor} rather than from a second reading of the same fields. Two independent
 * classifications of one pull request is two things to keep in step, and the first time they disagreed the
 * row would carry a badge and a sentence contradicting each other on the page built to be trusted.
 *
 * ## Why the Slack half is here at all
 *
 * GitHub's review-request field is NOT how the owner asks or is asked. So `reviewRequests` alone answers a formality, and the question the owner actually has ("who do I
 * chase, and did I ever chase them") needs the Slack record joined in. That join is matched on the pull
 * request's own URL, so it requires no identity resolution and cannot mis-merge two people.
 *
 * ## What is deliberately NOT decided here
 *
 * `CHANGES_REQUESTED` is not forced to "the author's move". Measured on both of the owner's
 * pull requests carrying that decision, the still-outstanding reviewers were DISJOINT from whoever requested
 * the changes — GitHub drops a reviewer from `reviewRequests` once they review, so a populated list means the
 * ball has already moved to somebody else by name. Grading those "you" would delete a live, named ask.
 *
 * @param pr the pull request as `gh` described it
 * @param asks every Slack message on the board that linked a pull request and named somebody
 * @param window the slice of Slack that was read, which bounds what an absence may claim
 * @returns the state it is blocked in, and the evidence
 */
export function blockedOnFor({
  pr,
  asks,
  window,
}: {
  pr: PrRecord;
  asks: readonly SlackAsk[];
  window: AskWindow;
}): BlockedOn {
  const { rung, why } = rungFor({ pr });
  if (rung === "unknown") {
    return { kind: "unknown", why };
  }
  if (rung === "failing" || rung === "pending") {
    return { kind: "ci", why };
  }
  if (rung === "conflict") {
    return { kind: "conflict", why };
  }
  if (rung === "undraft") {
    return { kind: "person", why: `${why} — so it is blocked on ${pr.author === "" ? "its author" : `@${pr.author}`}` };
  }
  if (rung === "changes" || rung === "review") {
    return reviewBlocked({ asks, pr, why, window });
  }
  // The `merge` rung asks only whether the branch CONFLICTS. GitHub computes mergeability asynchronously and
  // reports `UNKNOWN` until it has, so a pull request that is otherwise ready but unmeasured is `unknown`
  // rather than `none` — the whole point of keeping those two apart.
  return pr.mergeable === "MERGEABLE"
    ? { kind: "none", why: `nothing is blocking it — ${why}` }
    : {
        kind: "unknown",
        why: `${why}, but gh reported mergeable "${pr.mergeable === "" ? "(absent)" : pr.mergeable}" — GitHub computes that asynchronously, so it was NOT measured`,
      };
}

/** How many words the repository's own template allows in a Problem cell. */
export const PROBLEM_WORD_CAP = 50;

/** The Problem cell of the header-less HTML table this repository's pull-request template emits. */
const HTML_PROBLEM = /<td>[^<]*<strong>[^<]*Problem[^<]*<\/strong>[^<]*<\/td>[^<]*<td>([\s\S]*?)<\/td>/i;

/** The Problem row of a markdown table, for a body written without the template. */
const MARKDOWN_PROBLEM = /^[ \t]*\|[ \t*]*Problem[ \t*]*\|([^\n|]*)\|/im;

/** A `## Problem` heading and the prose under it, for a body written as sections. */
const HEADING_PROBLEM = /^#{1,6}[ \t]*Problem[ \t]*$([\s\S]*?)(?=^#{1,6}[ \t]|(?![\s\S]))/im;

/** Strip HTML tags and collapse every run of whitespace, so a table cell becomes one readable sentence. */
function flatten({ text }: { text: string }): string {
  return text
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * The problem a pull request says it solves, PARSED out of its body.
 *
 * Never generated. This repository's template already requires a Problem cell capped at 50 words, so the
 * statement exists, it is already in the owner's own voice, and it is free. Generating one instead would put
 * a language model in the render path of a page whose entire purpose is to be cheap and instantly true — and
 * a plausible sentence nobody wrote is the one thing this page must never show.
 *
 * A pull request without one — every team pull request, which follows no such template — says so. That is a
 * measured absence, not a gap to fill.
 *
 * @param body the pull-request body exactly as `gh` returned it
 * @returns the statement, or the reason there is none to show
 */
export function problemStatement({ body }: { body: string }): Measured<string> {
  const matched = [HTML_PROBLEM, MARKDOWN_PROBLEM, HEADING_PROBLEM]
    .map((pattern) => pattern.exec(body)?.[1])
    .map((captured) => (captured === undefined ? "" : flatten({ text: captured })))
    .find((text) => text.length > 0);
  if (matched === undefined) {
    return unmeasurable({
      why: "this body carries no Problem cell — the repository template requires one, and a statement is PARSED here rather than generated, so there is nothing to show",
    });
  }
  const words = matched.split(" ");
  return words.length <= PROBLEM_WORD_CAP
    ? measured({ value: matched })
    : measured({
        value: `${words.slice(0, PROBLEM_WORD_CAP).join(" ")} … [CUT at the template's ${String(PROBLEM_WORD_CAP)}-word cap; the body carries ${String(words.length)}]`,
      });
}

/** The collapsed detail for one pull request — every field, including the ones `gh` left empty. */
function detailFor({
  pr,
  asks,
  window,
}: {
  pr: PrRecord;
  asks: readonly SlackAsk[];
  window: AskWindow;
}): readonly string[] {
  const rollup = checkRollupOf({ value: pr.statusCheckRollup });
  const blocked = blockedOnFor({ asks, pr, window });
  const problem = problemStatement({ body: pr.body });
  return [
    `problem  ${problem.known ? problem.value : `NOT MEASURED — ${problem.why}`}`,
    `blocked  ${blocked.kind} — ${blocked.why}`,
    `repo     ${pr.repo}`,
    `author   ${pr.author === "" ? "NOT MEASURED — gh reported no author" : `@${pr.author}`}`,
    `branch   ${pr.headRefName}`,
    `state    ${pr.isDraft ? "draft" : "NOT a draft"}`,
    `checks   ${rollup.state}${rollup.failing.length === 0 ? "" : ` — failing: ${rollup.failing.join(", ")}`}`,
    `review   ${pr.reviewDecision === "" ? "NOT MEASURED — gh reported no review decision, which means nobody has been asked" : pr.reviewDecision}`,
    `asked    ${pr.reviewRequests.length === 0 ? "nobody — review has been requested from no user or team (a measured zero)" : pr.reviewRequests.map((reviewer) => `${reviewer.kind}:@${reviewer.handle}`).join(", ")}`,
    `mergeable ${pr.mergeable === "" ? "NOT MEASURED — gh reported no mergeable state" : pr.mergeable}`,
    `updated  ${pr.updatedAt}`,
    `url      ${pr.url}`,
  ];
}

/** How the six blocked-on states read on a row. `NOTHING` and `UNKNOWN` are deliberately nothing alike. */
const BLOCKED_LABEL: Readonly<Record<BlockedKind, string>> = {
  ci: "blocked on CI",
  conflict: "blocked on a MERGE CONFLICT",
  none: "blocked on NOTHING",
  person: "blocked on a PERSON",
  review: "blocked on REVIEW",
  team: "blocked on a TEAM — nobody in particular",
  unknown: "blocked on UNKNOWN — GitHub was asked and did not say",
};

/**
 * Build the PULL REQUESTS section from already-parsed pull requests.
 *
 * @param prs the open pull requests, in any order
 * @param measuredAtIso when `gh` was asked, or why that instant is not known
 * @param asks every Slack message that linked one of these pull requests and named somebody
 * @param window the slice of Slack that was read, which bounds what an absence may claim
 * @returns the section, ranked closest-to-merge first
 */
export function buildPrStatusSection({
  prs,
  measuredAtIso,
  asks,
  window,
}: {
  prs: readonly PrRecord[];
  measuredAtIso: Measured<string>;
  asks: readonly SlackAsk[];
  window: AskWindow;
}): SectionResult {
  const candidates: readonly RankCandidate[] = prs.map((pr) => {
    const { rung } = rungFor({ pr });
    const meaning = RUNG_MEANING[rung];
    const distance = MERGE_LADDER.indexOf(rung);
    const blocked = blockedOnFor({ asks, pr, window });
    return {
      rankWhy: `rung ${rung} — ${String(distance + 1)} of ${String(MERGE_LADDER.length)} on the merge ladder, then pull-request number`,
      row: {
        age: `updated ${pr.updatedAt}`,
        badge: rung,
        badgeKind: meaning.badgeKind,
        detail: detailFor({ asks, pr, window }),
        key: `${PR_STATUS_ID}:${pr.repo}#${String(pr.number)}`,
        title: `${shortRepo({ repo: pr.repo })} #${String(pr.number)} ${pr.author === "" ? "" : `@${pr.author} `}${pr.title}`,
        verb: meaning.verb,
        // The blocked-on state LEADS the evidence column, because it is the question this section exists to
        // answer. The rung it was derived from stays on the rank line, so the two can never drift apart.
        why: `${BLOCKED_LABEL[blocked.kind]} — ${blocked.why}`,
      },
      // Padded so rung 10 would not sort before rung 2, and the number is padded for the same reason.
      sortKey: `${String(distance).padStart(2, "0")}${pr.repo}${String(pr.number).padStart(8, "0")}`,
    };
  });
  const rows: readonly PaneRow[] = rankRows({ candidates, sectionId: PR_STATUS_ID });
  return {
    blurb: BLURB,
    emptyReason: EMPTY_REASON,
    id: PR_STATUS_ID,
    measuredAtIso,
    rows,
    source: SOURCE,
    title: "Pull requests",
    unavailable: undefined,
  };
}

/** The short repository label shown on a row — the name, without the owner. */
function shortRepo({ repo }: { repo: string }): string {
  return absentAs({ value: repo.split("/")[1], whenAbsent: repo });
}
