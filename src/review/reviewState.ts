/**
 * The seven questions, answered — the pure core of `slopweaver github review-state`.
 *
 * > Is CI all green; is CodeRabbit all green; is it undrafted; which CODEOWNERS rules does it still owe a
 * > review; was the pull request mentioned in Slack at any point; have we explicitly asked someone to review
 * > it; has that review request gone stale and needs a bump.
 *
 * Question 4 never asks only WHO is required, because a name is not an answer: three rows once told the owner
 * to merge pull requests their codeowners had not approved, one of them naming a real required approver whose
 * tick satisfied a single rule while two others were still owed. `./codeownerRules.ts` computes the question
 * as asked above, and {@link PrReviewState.codeowners} is where a consumer reads it.
 *
 * Every answer here is a function of data somebody else fetched. The clock is a parameter, the network is not
 * reachable, and each verdict carries its own `why` so the sentence a reader sees is written next to the rule
 * that produced it.
 *
 * ## The one design rule that separates this from a board that is confidently wrong
 *
 * **An absence is a claim, and a claim needs a window.** Questions 5, 6 and 7 are answered from Slack, and the
 * local corpus is always some distance behind the clock (measured: twenty-five hours). So each of
 * them can answer `unknown`, and `unknown` is a first-class result rather than a failure — it is what
 * distinguishes "the owner has not asked anyone" from "we cannot see whether the owner asked anyone". Reporting the first
 * when only the second is known is the exact failure this verb exists to end.
 *
 * ## Why a tag, and not a link, is what counts as an ask
 *
 * The owner's own rule: a posted link is not a tag; a tag is an explicit mention of a person next to the link.
 * So question 5 counts links and question 6 counts links that also carry a structural mention run. Neither
 * infers INTENT — a message tagging somebody beside a pull-request link might be about a broken deploy — which
 * is why every ask row carries the message's own excerpt and permalink for a human to read.
 */

import type { BaseDistance } from "../live/github/baseDistance.js";
import type { ChecksRead } from "../live/github/headChecksRead.js";
import type { MergeQueueEntryState } from "../live/github/mergeQueue.js";
import type { RequiredContextGate } from "../live/github/requiredContexts.js";
import { absenceBounded } from "./absenceBounded.js";
import { type BumpVerdict, bumpVerdict, type ReviewerActivity } from "./cadence.js";
import type { ChannelShare } from "./channelShare.js";
import type { CodeownerReadScope, CodeownerReviewState } from "./codeownerRules.js";
import { isSelfOwner, type RequiredOwner } from "./codeowners.js";
import type { GithubCodeownerRequirement } from "./githubCodeowners.js";
import type { GithubMergeStatus } from "./githubMergeStatus.js";
import type { ReviewRequestTimes } from "./humanWait.js";
import type { FailingCheckDetail, ThreadDetail, ThreadTally } from "./prStateDetail.js";
import { askDecisionFor } from "./readingMerge.js";
import { sameConversation } from "./reviewConversation.js";
import { liveBeyondCorpus, type SlackCoverage, type SlackMention } from "./slackEvidenceTypes.js";
import type { StackPlace } from "./stack.js";

/**
 * The login GitHub reports for the CodeRabbit app's reviews and review threads.
 *
 * @internal
 */
export const CODERABBIT_LOGIN = "coderabbitai";

/**
 * Whether a review author is a machine rather than the colleague who was asked.
 *
 * MEASURED, and it is why this is not inlined: without it, six of the owner's pull requests
 * answered `unknown` to "has the ask gone stale" — because CodeRabbit had reviewed after the ask, and
 * {@link reviewerActivity} correctly refused to bind that review to the human who was tagged. The verdict was
 * right about what it could see and wrong about the question: a bot reviewing is not the reviewer answering,
 * so a bot review is not evidence either way and must not enter the silence test at all.
 *
 * @param login the review author's GitHub login
 * @returns whether the review came from an app rather than a person
 */
export function isBotLogin({ login }: { login: string }): boolean {
  const lowered = login.toLowerCase();
  return lowered === CODERABBIT_LOGIN || lowered.endsWith("[bot]");
}

/** Question 1. `none` is not a failure: a pull request touching no CI-covered path legitimately has none. */
export type CiVerdict = "green" | "red" | "running" | "none";

/**
 * Question 2. `stale` means CodeRabbit reviewed an EARLIER push, which reads as green and is not. `stuck`
 * means every CodeRabbit thread is resolved and its CHANGES_REQUESTED still stands — the state `github landing --press`
 * re-requests after twenty seconds (`./codeRabbitNudge.ts`).
 */
export type CodeRabbitVerdict = "green" | "changes-requested" | "stuck" | "stale" | "pending" | "none" | "unknown";

/** Questions 5 and 6 — three-valued on purpose. `unknown` means the window could not bound the absence. */
type SlackAnswer = "yes" | "no" | "unknown";

/**
 * What to do about a pull request's review ask, once all seven answers are in.
 *
 * `conflicting` is the one arm that is not about a review at all: GitHub reports the branch will not merge
 * into its base, and nothing else on the row — who reviews it, whether CI is green — changes what the owner has to
 * do next. It outranks every other arm for that reason; see {@link askRecommendation}.
 *
 * `stacked` is the arm for a pull request whose base is not the repository's default branch: it is never an
 * ask, whatever else is true of it, because the pull request at the bottom of its stack carries the stack's
 * only ask — see `./stack.ts`.
 */
export type AskRecommendation =
  | "conflicting"
  | "send-ask"
  | "bump"
  | "already-asked"
  | "still-draft"
  | "blocked"
  | "self-merges"
  | "stacked"
  | "unknown";

/**
 * GitHub's own `mergeable`, narrowed to the three values it documents.
 *
 * `UNKNOWN` is not a shade of green: GitHub computes mergeability LAZILY, so a query for one it has not
 * computed answers `UNKNOWN` and starts the job — which makes a FIRST read the one most likely to get it,
 * measured at 15 of 20 over a genuinely cold fleet rather than all of them. Reproduce over pull requests
 * nobody has queried: `slopweaver github review-state --repo acme/acme-admin --json | jq
 * '[.pullRequests[].conflict.mergeable] | group_by(.) | map({(.[0]): length}) | add'`, twice in a row. A token this repository has not seen is read as
 * `UNKNOWN` too, which is the conservative direction — it can only ever hold a row back.
 */
export type GithubMergeable = "MERGEABLE" | "CONFLICTING" | "UNKNOWN";

/**
 * Whether a token GitHub returned is one of the three it documents.
 *
 * @param token whatever the read carried in the `mergeable` field
 * @returns the token when GitHub documents it, else `UNKNOWN`
 */
export function asGithubMergeable({ token }: { token: string }): GithubMergeable {
  if (token === "MERGEABLE" || token === "CONFLICTING") {
    return token;
  }
  return "UNKNOWN";
}

/**
 * What a local `git merge-tree` of the head into the base established, as its own typed answer.
 *
 * A value rather than a reading of prose, because an empty path list meant two OPPOSITE things and only
 * {@link ConflictState}'s old `why` sentence told them apart. MEASURED over the owner's 30 open
 * pull requests: four read `conflicting` and THREE of them carried an empty list from a CLEAN local merge,
 * so a consumer branching on the array's length alone got three of four rows backwards. Reproduce with
 * `slopweaver github review-state --repo acme/acme-admin --author <login> --detail --json` and read each
 * conflicting row's `conflict`.
 *
 * @internal read through {@link ConflictState}; no consumer outside this module names it directly.
 */
export type ConflictMeasurement =
  /** GitHub reports no conflict, so no local merge was attempted at all. */
  | { readonly kind: "not-requested" }
  /** The local merge ran; `paths` is what it could not resolve, and empty means it came out CLEAN. */
  | { readonly kind: "measured"; readonly paths: readonly string[]; readonly why: string }
  /** The measurement was attempted and could not be made — no declared checkout, a failed fetch. */
  | { readonly kind: "unmeasured"; readonly why: string };

/**
 * Question 8 — does the branch merge into its base, and where does it not.
 *
 * Two fields and no derived third: a shape carrying `conflicted` beside `mergeable` lets a fixture — and
 * therefore a bug — assert a pull request that is both. Read {@link conflicting} for the boolean.
 */
export interface ConflictState {
  /** GitHub's own answer, three-valued, so a green is told apart from one it has not computed. */
  readonly mergeable: GithubMergeable;
  /** What a local merge of the head into the base established, when one was attempted. */
  readonly local: ConflictMeasurement;
}

/**
 * Whether GitHub itself reports the branch as `CONFLICTING` against its base.
 *
 * @param conflict question 8's answer
 * @returns whether GitHub said `CONFLICTING` — never true for an answer it has not computed
 */
export function conflicting({ conflict }: { conflict: ConflictState }): boolean {
  return conflict.mergeable === "CONFLICTING";
}

/**
 * The paths a local merge could not resolve, or empty when it was clean or never made.
 *
 * @param conflict question 8's answer
 * @returns the conflicting paths
 */
export function conflictPaths({ conflict }: { conflict: ConflictState }): readonly string[] {
  return conflict.local.kind === "measured" ? conflict.local.paths : [];
}

/**
 * Why a conflicting pull request names no paths, or the empty string when it names some.
 *
 * @param conflict question 8's answer
 * @returns the sentence a reader sees instead of a path list
 */
export function conflictWhy({ conflict }: { conflict: ConflictState }): string {
  if (conflict.local.kind === "not-requested") {
    return "";
  }
  return conflict.local.kind === "measured" && conflict.local.paths.length > 0 ? "" : conflict.local.why;
}

/** One owner required by CODEOWNERS, with whether it can actually satisfy the requirement. */
export interface RequiredApprover extends RequiredOwner {
  /** True when the token names the pull request's own author, who can never approve their own pull request. */
  readonly isAuthor: boolean;
}

/** The Slack half of one pull request's answer. */
export interface SlackReviewState {
  readonly mentioned: SlackAnswer;
  readonly asked: SlackAnswer;
  /** Every message that linked the pull request, newest first. */
  readonly mentions: readonly SlackMention[];
  /** The subset that also tagged somebody other than the poster, newest first. */
  readonly asks: readonly SlackMention[];
  /** Why the answer is `unknown`, or the empty string when it is not. */
  readonly why: string;
  /**
   * Whether the Slack window can carry an ABSENCE at all, carried as its own value.
   *
   * `why` is cleared the moment an ask is FOUND, so a consumer reading `why === ""` as "the window was
   * bounded" is right about a `no` and wrong about a `yes`: an ask found inside a stale corpus tells you
   * nothing about whether a later reply exists beyond it. A Codex review followed that through to a
   * `resolve-then-bump` resting on a chase the window could not actually establish was still owed, so the
   * bound is a field rather than something inferred from a sentence.
   */
  readonly bounded: boolean;
  /**
   * The corpus watermark, present ONLY when the window is unbounded because the corpus is provably BEHIND —
   * it ends before the pull request's last activity, or the live leg saw a message newer than it — the two
   * refusals a sync settles. A page says "Slack history stale since" this instant rather than a verdict the
   * window cannot carry (the red "nobody seated" pill is never shown on it). Absent on every other
   * arm, a never-ingested corpus included.
   */
  readonly staleThroughIso?: string;
}

/** One pull request's complete answer to all seven questions. */
export interface PrReviewState extends CodeownerReadScope {
  readonly repoSlug: string;
  readonly number: number;
  readonly title: string;
  readonly url: string;
  readonly authorLogin: string;
  /**
   * Present only when GitHub typed the author a `Bot` — how a bare `renovate` login from the GraphQL read is
   * told from a person of that name. Carried to the landing row, where the bump signal reads it.
   */
  readonly authorIsBot?: true;
  /**
   * The branch the pull request merges into, as GitHub names it — what a `conflicting` row says to rebase
   * onto, and the half of the stack join that tells a base apart from a sibling's head.
   */
  readonly baseRefName: string;
  /**
   * When the pull request was OPENED, which is the only honest denominator for how long it has waited.
   *
   * `updatedAtIso` is not that measurement and must never be printed as one: GitHub bumps it on a check
   * re-run, so a pull request trailing by 324 commits behind `main` with eight checks
   * failing can read `updatedAt` four hours old. `../review/bottleneck.ts` takes both and says which
   * is which.
   */
  readonly createdAtIso: string;
  readonly updatedAtIso: string;
  /**
   * Whether GitHub would let this pull request merge RIGHT NOW — its own `mergeStateStatus`, classified by
   * `./githubMergeStatus.ts`.
   *
   * Beside {@link PrReviewState.conflict} rather than inside it, because the two answer different questions:
   * `conflict` is *do these trees merge*, this is *would GitHub allow it*, and a row can read `MERGEABLE`
   * and `blocked` at once. It is what tells a pending code-owner REQUEST apart from a code-owner
   * REQUIREMENT — see `./landingTests.ts`'s `codeownersTest`.
   */
  readonly githubMergeStatus: GithubMergeStatus;
  /**
   * GitHub's aggregate `reviewDecision`, empty where it stated none.
   *
   * Carried only so the code-owner exception can ask whether GitHub STATED a decision, which is the half of
   * the enqueue door's own criterion a `mergeStateStatus` cannot stand in for.
   */
  readonly reviewDecision: string;
  /**
   * Whether the branch merges into its base, and where it does not.
   *
   * Carried as its own answer rather than folded into `recommendation`, because the paths are what a row
   * ACTS on: "rebase it" is a sentence the owner already has, "it conflicts in `package.json`" is the one they
   * need. MEASURED: two of the owner's open pull requests were `CONFLICTING` on GitHub and both read
   * `self-merges` here, because the mergeable read was computed and then thrown away.
   */
  readonly conflict: ConflictState;
  readonly ci: CiVerdict;
  readonly ciDetail: string;
  readonly codeRabbit: CodeRabbitVerdict;
  readonly codeRabbitDetail: string;
  readonly undrafted: boolean;
  readonly requiredApprovers: readonly RequiredApprover[];
  /** Why the approver list may be incomplete — a file cap hit, or no CODEOWNERS at all. */
  readonly approverResidue: readonly string[];
  readonly slack: SlackReviewState;
  /**
   * Posted into a channel by the owner with nobody named, and where its business-day clock stands — `./channelShare.ts`.
   * `undefined` whenever that state does not apply: an ask names somebody, a message is undecided, a human has
   * reviewed on GitHub, or no channel post of the owner's links the pull request.
   */
  readonly channelShare: ChannelShare | undefined;
  readonly bump: BumpVerdict;
  /** When each reviewer was last requested, off the timeline — absent when the read did not select it. */
  readonly reviewRequestTimes?: ReviewRequestTimes;
  /**
   * Humans who reviewed on GitHub after the newest ask, with WHAT THEY SAID — context a sender needs before
   * bumping, and the field a consumer reads to tell "merge it" from "act on the changes they asked for".
   *
   * It carries what they said, not logins alone, so the session-start row can say more than
   * *act on the review*: a login says somebody answered, never whether they approved.
   */
  readonly reviewedSinceAsk: readonly HumanReview[];
  /** Lower-cased logins whose LATEST opinionated review on this pull request is an approval. */
  readonly approvedBy: readonly string[];
  /**
   * Which CODEOWNERS rules the changed paths invoked, and which of them a landed review has satisfied.
   *
   * The whole point of the field is that a consumer names what is MISSING rather than asserting ready — see
   * `./codeownerRules.ts` for the three rows that asserted it wrongly.
   */
  readonly codeowners: CodeownerReviewState;
  /**
   * Who GITHUB says the code owners are — its own `asCodeOwner` review requests and the teams a review was
   * submitted on behalf of, projected through untouched.
   *
   * Beside {@link PrReviewState.codeowners} rather than instead of it, because the two answer different
   * questions: this one is authoritative about WHO and says nothing about the connective, that one is
   * derived from the file and is the only thing that can say which rules are still owed. See
   * `./githubCodeowners.ts` for the owner ask that added it and for what GitHub's flags cannot cover.
   */
  readonly githubCodeowners: GithubCodeownerRequirement;
  /**
   * Where the pull request sits in a stack of the owner's own open pull requests, read off the fleet's base and
   * head branches — `./stack.ts`. `stack.stacked` is what makes the recommendation `stacked`; the position and
   * chain are what a row shows so the owner can see which pull request carries the ask.
   */
  readonly stack: StackPlace;
  readonly recommendation: AskRecommendation;
  /**
   * The branch the pull request's commits sit on.
   *
   * Carried so a consumer can tell that one of the owner's pull requests is stacked on another (its base is a
   * sibling's head) and so a run journal's own `branch` joins to the pull request that run is working. Both
   * are joins on a name GitHub owns, never a guess from a title.
   */
  readonly headRefName: string;
  /**
   * Every review thread, with who raised it, its first line and where it has got to — `./prStateDetail.ts`.
   *
   * The seven answers above are verdicts, and a verdict is not enough on its own: a bare "verdict equals
   * pass" is not enough information. These three fields are the granularity that adds, and they are on the STATE rather than
   * only in the detail renderer so `--json` and every consumer get them without a second read.
   */
  readonly threads: readonly ThreadDetail[];
  /** Who is waiting on an answer, and on how many threads — reviewers only, never the author's own. */
  readonly waitingOn: readonly ThreadTally[];
  /** Every non-passing check, each marked with whether the base branch REQUIRES it. */
  readonly failingChecks: readonly FailingCheckDetail[];
  /**
   * What the base branch's required-context read concluded, carried whole.
   *
   * Carried rather than reduced to a boolean because `unreadable` is a real third answer: a run that could
   * not find out what the base requires must not print the same thing as one that found it requires nothing.
   */
  readonly requiredContexts: RequiredContextGate;
  /**
   * Whether the threads above carry their comment text, or only who wrote them and when.
   *
   * The fleet read asks for bodies only under `--detail`, because a hundred CodeRabbit bodies across twenty
   * pull requests is a payload it does not survive — see `../live/github/reviewState.ts`'s `PrReviewThread`.
   * A consumer reading an empty `openerLine` needs to know which of the two it is looking at.
   */
  readonly threadBodiesRead: boolean;
  /**
   * The head commit GitHub currently reports, so a judgement can be PINNED to the commit it was made about.
   *
   * Two things here need it and neither can be answered without it: an eviction only counts while the head
   * has not moved (`./landing.ts`), and a re-press after a force-push is a different act from a re-press of
   * the same commit. The empty string when the read could not name one.
   */
  readonly headOid: string;
  /**
   * Whether GitHub has more review threads than this read carried.
   *
   * A capped thread read can only ever LOSE an unresolved thread, so it produces a false GREEN and never a
   * false CHANGES — which is why `./landing.ts`'s `threads-clear` test answers `unknown` on it rather than
   * reading the visible page as the whole picture. See `../live/github/reviewState.ts` for the measurement.
   */
  readonly threadsTruncated: boolean;
  /**
   * Whether the head's check rollup carried more contexts than the read asked for.
   *
   * `GithubChecksSnapshot` has recorded this all along and NOTHING consumed it, so
   * {@link PrReviewState.failingChecks} has silently been a lower bound. MEASURED when every
   * read here asked for a 60-context page: **5 of the owner's 24 open pull requests** carried more contexts
   * than the page did. They all ask for `CHECK_PAGE` (`../live/github/reviewState.ts`) now, so a truncation
   * means a head past GitHub's own ceiling rather than a page somebody chose too small.
   * A truncated rollup can only ever LOSE a failing check, so it produces a false GREEN — the same shape as
   * {@link PrReviewState.threadsTruncated}, and it is carried for the same reason. Reproduce by counting the
   * rows whose `checksTruncated` is true in `slopweaver github landing --json`.
   */
  readonly checksTruncated: boolean;
  /** Whether the head's checks were READ at all, as distinct from there being none. */
  readonly checksRead: ChecksRead;
  /**
   * How far the head is from its base, or why that was not read.
   *
   * A boot row carries mergeable state and whether the branch is behind its base. It is CONTEXT and never a
   * test: a merge queue rebases, so MEASURED one pull request read `press` at 400 behind beside another at 0
   * behind. Only `github landing` asks for it — every other caller
   * reads {@link ../live/github/baseDistance.DISTANCE_NOT_REQUESTED}, which is an `unread` naming itself.
   */
  readonly baseDistance: BaseDistance;
  /**
   * Every human whose LATEST opinionated review still asks for changes — `./reviewSignals.ts`.
   *
   * Beside {@link PrReviewState.reviewedSinceAsk} rather than instead of it, because that one is empty
   * whenever no Slack ask was found: a reviewer who asked for changes on a pull request nobody chased in
   * Slack is invisible to it, and a dispatch verdict resting on that would be wrong on exactly the pull
   * requests nobody has been talking about.
   */
  readonly standingChangesRequested: readonly HumanReview[];
  /**
   * Whether GitHub reported more reviews than this read carried.
   *
   * It already reaches {@link PrReviewState.githubCodeowners}'s residue as prose, which is enough for a
   * reader and not enough for a gate: a consumer deciding whether it may make a TERMINAL claim about this
   * pull request has to branch on it, and parsing a residue sentence to do that is the prose-reading this
   * repository forbids. A capped reviews read loses an APPROVED owner and a standing opinion alike.
   */
  readonly reviewsTruncated: boolean;
  /**
   * The pull request's own merge-queue entry, or `undefined` when GitHub reports none.
   *
   * Carried on the state rather than fetched per pull request by whoever needs it, because the fleet read
   * already selects the field: `../cli/commands/github/landingRun.ts` reads it once for every open pull
   * request at boot, and the eviction test — a pull request that WAS queued and now reports `undefined` —
   * has nowhere else to live.
   */
  readonly queueEntry: MergeQueueEntryState | undefined;
  /**
   * Every label GitHub has on the pull request, in its own order.
   *
   * The opt-out a human can attach from GitHub's own interface, honoured by `./landing.ts` so a green pull
   * request opened to start an argument is never selected for a press.
   */
  readonly labels: readonly string[];
  /**
   * Whether GitHub has more labels than this read carried, so the opt-out label may be invisible.
   *
   * A truncated label page is a false green on the ONE control a human attaches by hand, which is why it is a
   * terminal-evidence fact in `./landingDispatch.ts` rather than a note.
   */
  readonly labelsTruncated: boolean;
}

/** What one human said on a pull request, in the three words a consumer branches on. */
export type ReviewOpinion = "approved" | "changes-requested" | "commented";

/** One human review, reduced to who left it, what they said and when. */
export interface HumanReview {
  readonly login: string;
  readonly opinion: ReviewOpinion;
  readonly atIso: string;
}

/**
 * The checks facts question 1 is decided from.
 *
 * @internal
 */
export interface ChecksFacts {
  readonly total: number;
  readonly passed: number;
  readonly failed: number;
  readonly running: number;
  readonly queued: number;
}

/**
 * Question 1 — is CI all green.
 *
 * Decided from the DEDUPED per-check states rather than from GitHub's own aggregate `state`, because the
 * aggregate reports `SUCCESS` for a rollup that still has a queued context: a re-run creates a new check
 * suite rather than replacing the old one, and the aggregate is not what `gh pr checks` shows a human.
 *
 * @param checks how many checks are in each state
 * @returns the verdict
 */
export function ciVerdict({ checks }: { checks: ChecksFacts }): CiVerdict {
  if (checks.total === 0) {
    return "none";
  }
  if (checks.failed > 0) {
    return "red";
  }
  return checks.running + checks.queued > 0 ? "running" : "green";
}

/**
 * One review, reduced to the three fields question 2 needs.
 *
 * @internal
 */
export interface ReviewFacts {
  readonly login: string;
  readonly state: string;
  readonly submittedAtIso: string;
  readonly commitOid: string;
}

/**
 * One review thread, reduced to the three fields question 2 needs.
 *
 * @internal
 */
export interface ThreadFacts {
  readonly openedByLogin: string;
  readonly isResolved: boolean;
  readonly isOutdated: boolean;
}

/**
 * Question 4's first half — who is codeowner-required at all. Whether those requirements are SATISFIED is
 * `./codeownerRules.ts`, and it is the half a row must lead with.
 *
 * @param owners the owner tokens the last matching CODEOWNERS rule named for each changed path
 * @param authorLogin the pull request's author, who cannot satisfy their own requirement
 * @returns the owners, each flagged with whether it names the author
 */
export function requiredApprovers({
  owners,
  authorLogin,
}: {
  owners: readonly RequiredOwner[];
  authorLogin: string;
}): readonly RequiredApprover[] {
  return owners.map((owner) => ({ ...owner, isAuthor: isSelfOwner({ authorLogin, token: owner.token }) }));
}

/**
 * Whether a message put the pull request in front of a named human audience.
 *
 * @param mention one message that linked the pull request
 * @returns whether it is a certified ask
 */
export function isAsk({ mention }: { mention: SlackMention }): boolean {
  return askDecisionFor({ mention }).kind === "ask";
}

/**
 * Who an ask addressed, as a Slack id a bump could be sent to.
 *
 * **Scoped to THIS pull request**, which is the correction. A message naming ten pull requests, one per line
 * with its own reviewer, would answer with the first id tagged anywhere in it: in one such batch, two of the five rows still open named
 * somebody who had never been asked about them.
 *
 * @param mention the ask
 * @returns the first person this message asked ABOUT THIS PULL REQUEST, else empty
 * @internal
 */
export function askTarget({ mention }: { mention: SlackMention }): string {
  const decision = askDecisionFor({ mention });
  if (decision.kind !== "ask") {
    return "";
  }
  // An ask's recipients are never empty by construction (`./evidence.ts`), so the first is really there.
  return decision.recipients[0]!;
}

/**
 * Questions 5 and 6 — was it mentioned in Slack, and was anybody explicitly asked.
 *
 * @param mentions every message either leg found for this pull request, newest first
 * @param coverage how far each leg reached
 * @param prUpdatedAtIso when the pull request was last active
 * @returns the two answers, the evidence behind each, and why an answer is `unknown`
 */
export function slackReviewState({
  mentions,
  coverage,
  prUpdatedAtIso,
}: {
  mentions: readonly SlackMention[];
  coverage: SlackCoverage;
  prUpdatedAtIso: string;
}): SlackReviewState {
  const asks = mentions.filter((mention) => isAsk({ mention }));
  const bound = absenceBounded({
    coverage,
    liveFoundBeyondCorpus: liveBeyondCorpus({ coverage, mentions }),
    prUpdatedAtIso,
  });
  const found = mentions.length > 0;
  const asked = asks.length > 0;
  const mentioned = found ? "yes" : unknownUnlessBounded({ bounded: bound.bounded });
  let behind: { staleThroughIso?: string } = {};
  if (bound.staleThroughIso !== undefined) {
    behind = { staleThroughIso: bound.staleThroughIso };
  }
  const evidence = { asks, bounded: bound.bounded, mentioned, mentions, ...behind };
  if (asked) {
    return { ...evidence, asked: "yes", why: found ? "" : bound.why };
  }
  // AN ABSTENTION IS NOT AN ABSENCE. A message the classifier answered `undecided` about may be the owner's ask, so
  // "never asked" is exactly the confident answer it refused to give — and it is what dispatch acts on:
  // measured over the same live read, a message such as "@reviewer one more if you have the patience" went
  // from waiting on its reviewer to `outside-the-set` on this collapse alone. Reproduce with
  // `slopweaver github landing --repo acme/acme-admin --author <login> --slack-live --json`.
  const unsettled = mentions.filter((mention) => askDecisionFor({ mention }).kind === "undecided");
  if (unsettled.length > 0) {
    return {
      ...evidence,
      asked: "unknown",
      why: `${String(unsettled.length)} message(s) this read cannot settle as an ask or not, for a visible session to read: ${unsettled.map((mention) => mention.permalink).join(" ")}`,
    };
  }
  return { ...evidence, asked: unknownUnlessBounded({ bounded: bound.bounded }), why: bound.why };
}

/** `no` when the window can carry an absence, `unknown` when it cannot. */
function unknownUnlessBounded({ bounded }: { bounded: boolean }): SlackAnswer {
  return bounded ? "no" : "unknown";
}

/**
 * Question 7 — has the ask gone stale.
 *
 * Delegated to `./cadence.ts` rather than re-decided here, so the review-state read and the chase path share
 * one rule about what a day of silence is and who may end it. What this adds is the ACTIVITY that cadence
 * refuses to guess: a later Slack message from the person who was tagged, IN THE ASK'S OWN THREAD or direct
 * message, ends the silence exactly — see `./reviewConversation.ts` for why elsewhere does not — and a
 * GitHub review from someone who is not the author ends it too — but only when the reviewer's login can be
 * bound to the Slack id that was tagged. An unbindable review is `unknown`, never silence and never a reply.
 *
 * @param asks every ask found for this pull request, newest first
 * @param mentions every message found, so a later reply from the tagged person can be seen
 * @param reviews every review on the pull request
 * @param authorLogin the pull request's author, whose own review never ends a silence
 * @param slackIdForLogin the roster's login → Slack id map, empty when no roster could be read
 * @param bounded whether the Slack window can carry an absence at all
 * @param nowIso the reference instant
 * @returns whether a bump is due, and why when it is not
 */
export function askBumpVerdict({
  asks,
  mentions,
  reviews,
  authorLogin,
  slackIdForLogin,
  bounded,
  nowIso,
}: {
  asks: readonly SlackMention[];
  mentions: readonly SlackMention[];
  reviews: readonly ReviewFacts[];
  authorLogin: string;
  slackIdForLogin: ReadonlyMap<string, string>;
  bounded: boolean;
  nowIso: string;
}): BumpVerdict {
  const newest = asks[0];
  if (newest === undefined) {
    return { kind: "unknown", why: "nobody has been asked, so there is nothing to bump" };
  }
  const target = askTarget({ mention: newest });
  if (target === "") {
    return { kind: "unknown", why: "the ask named nobody this read could address" };
  }
  // ONE LANDED REVIEW CLOSES THE ASK, whoever it came from. An ask that tags two
  // people is answered when either of them reviews — chasing the other adds nothing, because the pull
  // request is no longer waiting on a human. Checked before the per-target silence test, which would
  // otherwise report a bump on the person who happened to be tagged first.
  const closed = humanReviewsSince({ askIso: newest.atIso, authorLogin, reviews }).at(-1);
  if (closed !== undefined) {
    return {
      kind: "replied",
      why: `${closed.login} reviewed after the ask, and one landed review closes it`,
    };
  }
  const activity = reviewerActivity({
    ask: newest,
    authorLogin,
    bounded,
    mentions,
    reviews,
    slackIdForLogin,
    target,
  });
  return bumpVerdict({ activity, lastSentIso: newest.atIso, nowIso, targetSlackUserId: target });
}

/**
 * Every review a HUMAN other than the author submitted after an ask.
 *
 * @param reviews every review on the pull request
 * @param askIso when the ask was posted
 * @param authorLogin the pull request's author, whose own review is never a reviewer answering
 * @returns the reviews that could bear on whether the ask was answered
 */
export function humanReviewsSince({
  reviews,
  askIso,
  authorLogin,
}: {
  reviews: readonly ReviewFacts[];
  askIso: string;
  authorLogin: string;
}): readonly ReviewFacts[] {
  return reviews.filter(
    (review) => review.login !== authorLogin && !isBotLogin({ login: review.login }) && review.submittedAtIso > askIso,
  );
}

/**
 * What GitHub's own review state means in the three words a consumer branches on.
 *
 * @param state GitHub's own `APPROVED` / `CHANGES_REQUESTED` / `COMMENTED` / `DISMISSED` / `PENDING`
 * @returns the opinion, treating anything that is not a verdict as a comment
 */
export function reviewOpinion({ state }: { state: string }): ReviewOpinion {
  if (state === "APPROVED") {
    return "approved";
  }
  return state === "CHANGES_REQUESTED" ? "changes-requested" : "commented";
}

/**
 * Every human review landed after an ask, carrying what each person actually said.
 *
 * @param reviews every review on the pull request, oldest first
 * @param askIso when the newest ask was posted
 * @param authorLogin the pull request's author, whose own review is never a reviewer answering
 * @returns one entry per review, newest last, in the order GitHub returned them
 */
export function humanReviewsAfter({
  reviews,
  askIso,
  authorLogin,
}: {
  reviews: readonly ReviewFacts[];
  askIso: string;
  authorLogin: string;
}): readonly HumanReview[] {
  return humanReviewsSince({ askIso, authorLogin, reviews }).map((review) => ({
    atIso: review.submittedAtIso,
    login: review.login,
    opinion: reviewOpinion({ state: review.state }),
  }));
}

/**
 * The logins whose LATEST opinionated review is an approval — GitHub's own arithmetic, not a count of ticks.
 *
 * The latest one wins, which is the half a naive `some(state === "APPROVED")` gets wrong: a reviewer who
 * approved on Monday and requested changes on Thursday has NOT approved this pull request, and a rule
 * treating their Monday tick as standing is a rule that reports a blocked pull request as ready. A review
 * GitHub has dismissed carries the state `DISMISSED` rather than `APPROVED`, so it drops out here for free.
 *
 * Bots are excluded because a CodeRabbit tick is never a codeowner's approval, and the author is excluded
 * because GitHub does not let anyone approve their own pull request.
 *
 * @param reviews every review on the pull request, oldest first
 * @param authorLogin the pull request's author
 * @returns the lower-cased logins that currently stand as approvals
 */
export function approvingLogins({
  reviews,
  authorLogin,
}: {
  reviews: readonly ReviewFacts[];
  authorLogin: string;
}): ReadonlySet<string> {
  const latest = new Map<string, string>();
  for (const review of reviews) {
    const login = review.login.toLowerCase();
    const opinion = reviewOpinion({ state: review.state });
    const countable = login !== authorLogin.toLowerCase() && !isBotLogin({ login }) && opinion !== "commented";
    if (countable) {
      latest.set(login, opinion);
    }
  }
  return new Set([...latest.entries()].filter(([, opinion]) => opinion === "approved").map(([login]) => login));
}

/**
 * Whether a message reaches this pull request only through a thread whose root does not name it alone.
 *
 * @param mention a message in the ask's conversation
 * @param ask the ask it might answer, whose own link settles what its thread is about
 * @returns whether what it is about cannot be read off its thread
 */
function scopeAmbiguous({ mention, ask }: { mention: SlackMention; ask: SlackMention }): boolean {
  if (mention.association !== "thread") {
    return false;
  }
  // THE ASK ITSELF settles what its thread is about when the owner's own words link the pull request in it.
  // Demanding the ROOT name it reported 89 of 290 verdicts `unknown` over the owner's corpus — every one a person
  // who really had answered in the ask's own thread, half of them under a root that links nothing at all. The reply is still only a reply to THAT ask: a different thread is not this one.
  if (ask.linkSpans.length > 0 && ask.threadKey === mention.threadKey && !mention.versionsDisagree) {
    return false;
  }
  // Copies that disagree may reach another pull request between them, so what the reply is about is unread.
  if (mention.versionsDisagree) {
    return true;
  }
  const [only, ...rest] = mention.threadPrKeys;
  return only !== mention.prKey || rest.length > 0;
}

/**
 * What the tagged person has done since the ask — exactly, or `unknown` rather than a guess.
 *
 * Only a message in the ask's own conversation can be a reply ({@link sameConversation}). One that joins the
 * pull request only through a thread whose root links several pull requests may be about another of them,
 * so it is `unknown` with its permalink rather than a reply. Speaking in the thread ends a SILENCE; it is
 * never review completion, which only a landed GitHub review establishes.
 */
function reviewerActivity({
  target,
  ask,
  mentions,
  reviews,
  authorLogin,
  slackIdForLogin,
  bounded,
}: {
  target: string;
  ask: SlackMention;
  mentions: readonly SlackMention[];
  reviews: readonly ReviewFacts[];
  authorLogin: string;
  slackIdForLogin: ReadonlyMap<string, string>;
  bounded: boolean;
}): ReviewerActivity {
  const askIso = ask.atIso;
  const replies = mentions.filter(
    (mention) => mention.authorId === target && mention.atIso > askIso && sameConversation({ ask, message: mention }),
  );
  const spoke = replies.find((mention) => !scopeAmbiguous({ ask, mention }));
  if (spoke !== undefined) {
    return { atIso: spoke.atIso, bySlackUserId: target, kind: "replied" };
  }
  const ambiguous = replies[0];
  if (ambiguous !== undefined) {
    const reason = `they replied in the ask's thread (${ambiguous.permalink}), whose root does not name this pull request alone`;
    return { kind: "unknown", reason };
  }
  const since = humanReviewsSince({ askIso, authorLogin, reviews });
  const byTarget = since.find((review) => slackIdForLogin.get(review.login.toLowerCase()) === target);
  if (byTarget !== undefined) {
    return { atIso: byTarget.submittedAtIso, bySlackUserId: target, kind: "replied" };
  }
  // A review by somebody the roster does NOT know could be the person we asked, so it is not evidence of
  // silence. A review by somebody the roster maps to a DIFFERENT id is evidence about them, not about the
  // target, and leaves the target exactly as silent as before — which is why only the first blocks a verdict.
  const unresolved = since.find((review) => !slackIdForLogin.has(review.login.toLowerCase()));
  if (unresolved !== undefined) {
    const reason = `${unresolved.login} reviewed after the ask, but their login is not on the roster`;
    return { kind: "unknown", reason };
  }
  return bounded ? { kind: "silent" } : { kind: "unknown", reason: "the Slack window cannot carry an absence" };
}

/**
 * What to do about this pull request — the one-word column the ask list is built from.
 *
 * The order is the product rule. A merge conflict outranks everything, because it is a fact about the
 * branch that no reviewer and no green check changes; a self-merging pull request is never an ask at all; a
 * stacked pull request is never an ask until it targets the default branch; a draft is not ready to be asked
 * about; red checks waste a reviewer's time; an unanswerable Slack window may never be
 * reported as "never asked"; and only then does an absent ask become an ask to send.
 *
 * @param state the answers that gate an ask — CodeRabbit is deliberately absent, see the note below
 * @param selfMerging whether this repository lands its own pull requests without asking anyone — see
 *   `./codeowners.ts`'s `isSoleAuthorRepository`
 * @param stacked whether this pull request targets a branch other than the repository's default — see
 *   `./stack.ts`
 * @param conflicted whether GitHub reports the branch as conflicting with its base
 * @returns the recommendation
 */
export function askRecommendation({
  state,
  selfMerging,
  stacked,
  conflicted,
}: {
  state: Pick<PrReviewState, "undrafted" | "ci" | "slack" | "bump">;
  selfMerging: boolean;
  stacked: boolean;
  conflicted: boolean;
}): AskRecommendation {
  const beforeTheAnswers = shortCircuit({ conflicted, selfMerging, stacked });
  if (beforeTheAnswers !== undefined) {
    return beforeTheAnswers;
  }
  if (!state.undrafted) {
    return "still-draft";
  }
  // BLOCKED is red CI — never an open CodeRabbit thread. CodeRabbit is ADVISORY on this repository, so
  // its open comments are worked in parallel with a human review rather than ahead of it. The owner does not
  // care whether CodeRabbit re-reviews a head that already carries one CodeRabbit tick and one human tick, so
  // gating on it would withhold asks the owner has already decided to make.
  if (state.ci === "red") {
    return "blocked";
  }
  // Only the SLACK answer can make the recommendation unknown. A CodeRabbit read this verb could not
  // complete is still reported on the row, but it is advisory and so cannot withhold an ask either.
  if (state.slack.asked === "unknown") {
    return "unknown";
  }
  if (state.slack.asked === "no") {
    return "send-ask";
  }
  return state.bump.kind === "due" ? "bump" : "already-asked";
}

/**
 * The three facts about a pull request that settle the recommendation before a single review answer is read.
 *
 * Each is a fact about the BRANCH rather than about a review, which is why all three sit ahead of the draft,
 * CI and Slack ladder in {@link askRecommendation} — a review answer cannot change any of them, and letting
 * one be masked by a later arm is how each of these was originally missed.
 *
 * @param conflicted whether GitHub reports the branch as conflicting with its base
 * @param selfMerging whether this repository's sole codeowner is also its sole author
 * @param stacked whether the base is a branch other than the repository's default
 * @returns the recommendation these three imply, or undefined when the review answers decide it
 */
function shortCircuit({
  conflicted,
  selfMerging,
  stacked,
}: {
  conflicted: boolean;
  selfMerging: boolean;
  stacked: boolean;
}): AskRecommendation | undefined {
  // A CONFLICTING branch is checked before every shortcut below, including self-merging.
  // Folding the conflict into `blocked` and evaluating it AFTER `selfMerging` would read a conflicting pull
  // request in a self-merging repository as "land it yourself" with CI green from a stale head, and it would
  // never reach a react-now card. Whoever reviews it, it has to be rebased first.
  if (conflicted) {
    return "conflicting";
  }
  // A repository whose sole codeowner is also its sole author lands its own work — over a hundred in a row
  // here — so nobody is ever asked to review one, and a row proposing it is noise the owner has to dismiss.
  // Checked ahead of the draft and CI answers so it cannot be masked by them.
  if (selfMerging) {
    return "self-merges";
  }
  // A pull request targeting anything but the default branch is stacked on something that has not landed,
  // and the bottom of that stack carries the only ask, so the owner is never asked to undraft and name a reviewer
  // on a pull request deeper in the stack. Checked BEFORE the draft test because such a pull request is often a
  // draft too, and `still-draft` would say "undraft it and ask" — the wrong sentence for a stacked pull request.
  if (stacked) {
    return "stacked";
  }
  return undefined;
}
