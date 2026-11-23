/**
 * The structural signals a supervisor's dispatch verdict is allowed to stand on — counted from facts, never
 * read from what a comment MEANS.
 *
 * A boot row carries whether CodeRabbit passes and how many unresolved comments, whether we replied to them,
 * whether other people commented and whether those were addressed and resolved, and whether the reviewer
 * pushed back. Two of those words are semantic and one is not:
 *
 * - **counting** open threads, who they are waiting on and whether we answered them is structural, and
 *   `./prStateDetail.ts` already decided every one of those per thread. This module GROUPS what that module
 *   classified; it never re-classifies, because a second opinion about a thread's disposition would drift
 *   from the first the moment either changed.
 * - **"pushed back"** is not structural at all, and this module refuses to claim it. What it can establish
 *   is that a human reviewer's LATEST opinionated review still says `CHANGES_REQUESTED`, and that name is
 *   what {@link standingChangesRequested} is called. `./prStateDetail.ts`'s own header carries the precedent
 *   the owner set: structural facts plus the owner's own judgement, never a sentiment classifier, because a
 *   bare "verdict equals pass" is not enough information.
 *
 * ## Why the two sides are counted separately
 *
 * A CodeRabbit thread and a colleague's thread are the same shape and dispatch differently — one to a session
 * that works through the bot's list, the other to a session that ANSWERS a person and may then owe them a
 * chase. Neither is carded: what reaches the owner is `./landingDispatch.ts`'s judgement signals, not a count. MEASURED over the
 * owner's 25 open pull requests: **four** carried an open CodeRabbit thread and exactly **one** carried an
 * open human thread (seven of them, every one `awaiting-us` from the same reviewer). One total across both would have
 * reported five rows needing the same thing.
 *
 * **{@link standingChangesRequested} is a separate count and reads ONE.** It does not count
 * `PrReviewState.reviewedSinceAsk`, which is empty whenever no Slack ask was found — the exact hole this
 * function exists to close — because that would report none while a pull request carried a reviewer's
 * standing `CHANGES_REQUESTED` and read `press`. `skills/github/reference/dispatch.md` carries the same number.
 *
 * Reproduce both with
 * `slopweaver github landing --repo acme/acme-admin --author <login> --json`, counting rows whose
 * `standingChangesRequested` is non-empty and whose `conversations.humans.open` is above zero.
 *
 * Pure. No I/O, no clock.
 */

import type { ThreadDetail } from "./prStateDetail.js";
import { approvingLogins, type HumanReview, isBotLogin, type ReviewFacts, reviewOpinion } from "./reviewState.js";

/** How one side of the conversation on a pull request stands, counted by thread disposition. */
export interface ConversationTally {
  /** Threads that side opened which are not resolved. */
  readonly open: number;
  /** Of those, the ones nobody from our side has replied to at all. */
  readonly awaitingUs: number;
  /** Of those, the ones we replied to and left open — answered, or argued with; the words say which. */
  readonly answeredOpen: number;
  /**
   * Of those, the ones where the OTHER side spoke last on a multi-comment thread.
   *
   * Named for exactly what `./prStateDetail.ts`'s `dispositionOf` establishes and no more: the last comment
   * is not the author's and the thread has more than one comment. It does NOT prove the sequence
   * reviewer → us → reviewer, and it is never called "pushback" anywhere it is printed.
   */
  readonly reviewerLastWord: number;
  readonly resolved: number;
}

/** Both sides of the conversation, counted apart. */
export interface ConversationTallies {
  /**
   * Every BOT's threads, CodeRabbit's and any other app's, counted together.
   *
   * Named for the one that opens nearly all of them, and the split it really draws is a machine's list from
   * a colleague's — a `dependabot[bot]` thread dispatches to the same session CodeRabbit's does. Anything
   * PRINTED off this count says "bot", never "CodeRabbit", so a reader is not told which app raised it when
   * this cannot say.
   */
  readonly codeRabbit: ConversationTally;
  readonly humans: ConversationTally;
}

/** An empty tally, so a pull request nobody has commented on reads as zeroes rather than as absent. */
const NO_THREADS: ConversationTally = {
  answeredOpen: 0,
  awaitingUs: 0,
  open: 0,
  reviewerLastWord: 0,
  resolved: 0,
};

/**
 * Count one set of threads by the disposition `./prStateDetail.ts` already gave each.
 *
 * @param threads the threads on one side of the conversation
 * @returns the tally
 */
function tally({ threads }: { threads: readonly ThreadDetail[] }): ConversationTally {
  const count = ({ disposition }: { disposition: ThreadDetail["disposition"] }): number =>
    threads.filter((thread) => thread.disposition === disposition).length;
  const resolved = count({ disposition: "resolved" });
  return {
    answeredOpen: count({ disposition: "answered-open" }),
    awaitingUs: count({ disposition: "awaiting-us" }),
    open: threads.length - resolved,
    reviewerLastWord: count({ disposition: "reviewer-replied" }),
    resolved,
  };
}

/**
 * Count the conversation on a pull request, CodeRabbit and humans apart.
 *
 * A thread the pull request's own author opened is in neither side: it is a `--self-review` walkthrough note,
 * unresolved by design, and it sat on six of the owner's 28 open pull requests when that distinction was
 * measured (`./prStateDetail.ts`). Reproduce with `slopweaver github review-state --repo acme/acme-admin
 * --author <login> --detail --json` and count rows whose only open thread openers are the author.
 *
 * **The side is decided by who OPENED a thread, and its one consequence is stated rather than left to be
 * found.** A colleague replying LAST on a CodeRabbit-opened thread is counted with the bot's. MEASURED
 * over 214 threads on the owner's open pull requests: that shape occurred **zero** times, which
 * is why the grouping stays on the opener rather than being redesigned around a case the fleet does not
 * produce. What that measurement does NOT license is a WRITE walking past the shape when it does occur, so
 * `remoteJudgementSignals` (`./landingDispatch.ts`) counts it directly off the threads and escalates it to
 * the owner rather than to a `coderabbit-loop` session, so the gap is never left to the tallies alone.
 * Reproduce by counting unresolved threads whose `openedByLogin` is a bot and whose `lastCommentLogin` is
 * neither a bot nor the author, in the same `--detail --json` read.
 *
 * @param threads every thread on the pull request
 * @param authorLogin the pull request's author, whose own threads belong to neither side
 * @returns the two tallies
 */
export function conversationTallies({
  threads,
  authorLogin,
}: {
  threads: readonly ThreadDetail[];
  authorLogin: string;
}): ConversationTallies {
  const theirs = threads.filter((thread) => thread.openedByLogin !== "" && thread.openedByLogin !== authorLogin);
  const bots = theirs.filter((thread) => isBotLogin({ login: thread.openedByLogin }));
  const humans = theirs.filter((thread) => !isBotLogin({ login: thread.openedByLogin }));
  return {
    codeRabbit: bots.length === 0 ? NO_THREADS : tally({ threads: bots }),
    humans: humans.length === 0 ? NO_THREADS : tally({ threads: humans }),
  };
}

/**
 * Whether a review state is one a reviewer meant as a verdict rather than as a note.
 *
 * @param state GitHub's own review state
 * @returns whether it is `APPROVED` or `CHANGES_REQUESTED`
 */
function isOpinionated({ state }: { state: string }): boolean {
  return state === "APPROVED" || state === "CHANGES_REQUESTED";
}

/**
 * Every human whose LATEST opinionated review on this pull request still asks for changes.
 *
 * Computed from the raw reviews rather than from `PrReviewState.reviewedSinceAsk`, and that is the whole
 * point: `reviewedSinceAsk` is empty whenever no Slack ask was found, so a reviewer who asked for changes on
 * a pull request nobody chased in Slack is invisible to it. A dispatch verdict resting on that would be
 * silently wrong on exactly the pull requests nobody has been talking about.
 *
 * `COMMENTED`, `DISMISSED` and `PENDING` do not replace an earlier verdict, which mirrors GitHub's own
 * behaviour: leaving a note does not withdraw a changes-requested review. Bots are excluded — CodeRabbit's
 * verdict is `PrReviewState.codeRabbit` and dispatches somewhere else entirely — and so is the author, who
 * cannot review their own pull request.
 *
 * @param reviews every review on the pull request, oldest first
 * @param authorLogin the pull request's author
 * @returns one entry per human still asking for changes, one per login, in the order each login FIRST
 *   reviewed — a reviewer who reviews twice keeps their original place rather than moving to the end
 */
export function standingChangesRequested({
  reviews,
  authorLogin,
}: {
  reviews: readonly ReviewFacts[];
  authorLogin: string;
}): readonly HumanReview[] {
  const latest = new Map<string, ReviewFacts>();
  for (const review of reviews) {
    if (review.login === "" || review.login === authorLogin || isBotLogin({ login: review.login })) {
      continue;
    }
    if (isOpinionated({ state: review.state })) {
      latest.set(review.login.toLowerCase(), review);
    }
  }
  return [...latest.values()]
    .filter((review) => review.state === "CHANGES_REQUESTED")
    .map((review) => ({
      atIso: review.submittedAtIso,
      login: review.login,
      opinion: reviewOpinion({ state: review.state }),
    }));
}

/**
 * The one reason `github landing --press` writes to the door ledger when it acknowledges the Codex pairing
 * floor itself.
 *
 * ONE constant, so "the reason written once" is a property of the code rather than a promise: every automatic
 * press writes this exact sentence, and a reader counting waivers in the door ledger (`door_event`)
 * can tell an automatic one from a chair's hand-typed reason by the string alone.
 */
export const PRESS_CODEX_WAIVER_REASON =
  "a human reviewer's standing approval is what this pull request was paired against — " +
  "the Codex pairing floor cannot be examined for a head no checkout on this machine holds, and a green, " +
  "approved, mergeable pull request of the owner's is enqueued the same pass it becomes so rather than refused to a chair";

/**
 * The reason to acknowledge `codex-loop-incomplete` with on an automatic press, or `undefined` to acknowledge
 * nothing and let the refusal stand.
 *
 * ## Why an AFFIRMATIVE approval, and not "it passed the six landing tests"
 *
 * `codeownersTest` (`./landing.ts`) answers `pass` on an EMPTY owner list, so a pressable row is not evidence
 * that any human read the diff: a pull request of the owner's on a repository whose CODEOWNERS the change never
 * touches passes all six tests with nobody having looked at it. Acknowledging the floor there would waive
 * rule 9's pairing on the fleet's own unreviewed work, which is the failure `../codex/landingGate.ts`'s
 * header records — *a floor acknowledged every time is not a floor*.
 *
 * So the substitution rests on a person having said yes. {@link standingChangesRequested}'s sibling
 * `approvingLogins` (`./reviewState.ts`) already excludes the author, every bot login and `COMMENTED`
 * reviews, and keeps only each login's LATEST opinionated review — so a withdrawn approval is not one.
 *
 * **The bound is carried entirely here.** One subject covers every way the loop can be incomplete
 * (`../codex/landingGate.ts`), deliberately, so there is no way to acknowledge only the could-not-examine arm
 * at the argv boundary — which means this predicate is the ONLY thing standing between an automatic press and
 * a waived pairing floor.
 *
 * **What it assumes, stated rather than left to be discovered.** It reads "a non-author, non-bot login
 * approved" as "a human approved". GitHub forbids approving your own pull request and the fleet writes under
 * one identity, so that holds today — but it holds by circumstance, and `isBotLogin`'s `[bot]` suffix is the
 * only thing that would stand between a second fleet identity and a self-approved waiver.
 *
 * @param reviews every review on the pull request, from the read taken immediately before the press
 * @param authorLogin the pull request's author, who cannot approve it
 * @param reviewsTruncated whether GitHub had more reviews than that read carried — an incomplete read can
 *   only LOSE a withdrawal, so it waives nothing
 * @returns the constant waiver reason when a standing human approval covers the press, else `undefined`
 */
export function pressCodexWaiverReason({
  reviews,
  authorLogin,
  reviewsTruncated,
}: {
  reviews: readonly ReviewFacts[];
  authorLogin: string;
  reviewsTruncated: boolean;
}): string | undefined {
  if (reviewsTruncated) {
    return undefined;
  }
  if (approvingLogins({ authorLogin, reviews }).size === 0) {
    return undefined;
  }
  return PRESS_CODEX_WAIVER_REASON;
}
