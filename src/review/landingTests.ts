/**
 * The SIX landing tests, and the two helpers that read a CODEOWNERS token.
 *
 * Split out of `./landing.ts` to hold to the 300-code-line cap, along the seam that file
 * already described: a test answers `pass`/`fail`/`unknown` about ONE property of one pull request and composes
 * nothing, while `./landing.ts` assembles a row, picks its action and tallies a fleet. Every rule a reader wants
 * when asking *why did this row read fail* is here.
 */

import { inFlightChecksClause } from "../live/github/requiredContexts.js";
import {
  blockedWithoutReviewDecision,
  mergeStatusClause,
  pendingCodeownerRequestIsNonBlocking,
} from "./githubMergeStatus.js";
import type { LandingTest, LandingVerdict, QueueAvailability } from "./landing.js";
import { landingCiFailure } from "./landingCiFailure.js";
import { pendingCodeowners } from "./requiredCodeowners.js";
import { conflictPaths, conflictWhy, type PrReviewState } from "./reviewState.js";

/** The `@`-prefixed spelling of an owner token GitHub may have returned bare. */
function tokenOf({ name }: { name: string }): string {
  return name.startsWith("@") ? name : `@${name}`;
}

/**
 * The identity two GitHub reads spell differently, so one team cannot appear twice on one row.
 *
 * MEASURED on the first live run of this verb: one pull request named ten blockers of which five were
 * duplicates — `@acme/dx` beside `@dx`, and so on for every team on the row. The codeowner read
 * carries a team's `combinedSlug` (`owner/team`) and the review-request read carries its bare `slug`, so a
 * set of the printed strings deduplicates neither. The last path segment is what both spellings share.
 * Reproduce: `slopweaver github landing --repo acme/acme-admin --author <login> --json` and compare a
 * row's `blockedOn` against its `githubCodeowners.owners`.
 *
 * @param token an `@`-prefixed owner or reviewer token
 * @returns its last path segment, lower-cased
 */
export function identityOf({ token }: { token: string }): string {
  const parts = token.replace("@", "").split("/");
  // `split` always answers at least one element, so the last index is present rather than substituted for.
  return parts[parts.length - 1]!.toLowerCase();
}

/**
 * Which code owners are holding this pull request — GitHub's own pending ones, where GitHub's own merge
 * status says they are still a requirement.
 *
 * An ordinary review request never appears here: review requests happen in Slack, so the concept of a GitHub
 * reviewer request is ignored entirely. Owners are deduped by {@link identityOf}, since one team can reach the read
 * under two spellings.
 *
 * **It answers EMPTY where {@link codeownersTest} passed over a pending request**, and the two can never
 * disagree because both ask {@link pendingCodeownerRequestIsNonBlocking}. A row whose test reads *GitHub
 * would merge this now* while its `blockedOn` still names somebody is a row that contradicts itself on the
 * page — and `./bumpSelection.ts`'s `awaitingHumanReview` reads BOTH, so the drift would be silent. The
 * request register itself is untouched: `PrReviewState.githubCodeowners` still names everyone GitHub asked.
 *
 * **A LEFTOVER person request never appears here either** (`./requiredCodeowners.ts`): a request routed to
 * somebody for a team GitHub already recorded as approved, owning no rule, is not a review this pull request
 * waits on, and every chase that names a reviewer reads this list.
 *
 * @param state the pull request's answers
 * @returns the tokens, each `@`-prefixed and each identity appearing once; empty when GitHub would merge it
 */
export function blockedOn({ state }: { state: PrReviewState }): readonly string[] {
  const { requestsTruncated } = state.githubCodeowners;
  if (
    pendingCodeownerRequestIsNonBlocking({
      mergeStatus: state.githubMergeStatus,
      requestsTruncated,
      reviewDecision: state.reviewDecision,
    })
  ) {
    return [];
  }
  const names: string[] = [];
  const seen = new Set<string>();
  const add = ({ name }: { name: string }): void => {
    const token = tokenOf({ name });
    const identity = identityOf({ token });
    if (identity !== "" && !seen.has(identity)) {
      seen.add(identity);
      names.push(token);
    }
  };
  for (const owner of pendingCodeowners({ state }).holding) {
    add({ name: owner.token });
  }
  return names;
}

/** The `undrafted` test. */
function undraftedTest({ state }: { state: PrReviewState }): LandingTest {
  return state.undrafted
    ? { id: "undrafted", verdict: "pass", why: "it is not a draft" }
    : { id: "undrafted", verdict: "fail", why: "it is still a draft" };
}

/**
 * The `ci-green` test, which is the rollup AND the base branch's required set.
 *
 * A required context that never ran is a FAILURE here even though every check present passed, because
 * `statusCheckRollup` summarises the runs on the head rather than the ones the branch demands — the false
 * green `../live/github/requiredContexts.ts` exists to catch. A gate that could not be read at all is
 * `unknown`: a run that never looked must not print what a run that looked and found nothing prints.
 *
 * A name absent from a TRUNCATED checks page is `unknown` for the same reason and not `fail`: the read saw
 * a page rather than the head, so it has neither proved nor disproved the gate. Either way this is not a
 * pass — a landing decision may never rest on a required context nobody actually looked at.
 *
 * **A red that is PROVEN advisory passes**, because GitHub's merge queue gates on the required set and nothing
 * else. A red rollup that failed here regardless would let an advisory-only red step aside only to a LATER
 * hold — so with nothing later holding it, a pull request read `spawn-ci` forever. MEASURED on
 * one pull request: approved, mergeable, every required context green, three `Advisory local browser
 * E2E` lanes red, and classed `spawn-ci` / `rebase-and-fix` on every reading for four days until the owner
 * pressed it by hand; a button that only needs clicking is clicked. "Proven" is
 * `./landingCiFailure.ts`'s `required: false`: a whole checks page, a non-empty required set with nothing missing
 * or unproven, and no failing check that is required or gates a landing unrequired (`./gatingChecks.ts`).
 */
function ciTest({ state }: { state: PrReviewState }): LandingTest {
  const gate = state.requiredContexts;
  if (gate.kind === "read" && gate.missing.length > 0) {
    const absence = requiredAbsence({ inFlight: gate.inFlight, missing: gate.missing });
    return {
      id: "ci-green",
      verdict: "fail",
      why: `${String(gate.missing.length)} context(s) ${gate.branch} REQUIRES ${absence}`,
    };
  }
  const failure = landingCiFailure({ state });
  if (failure.kind === "red" && failure.required === false) {
    const names = state.failingChecks.map((check) => check.name).join(", ");
    return {
      id: "ci-green",
      verdict: "pass",
      why: `every context ${state.baseRefName} requires passed; its only red is advisory — ${names} (${state.ciDetail})`,
    };
  }
  if (state.ci === "red") {
    return { id: "ci-green", verdict: "fail", why: state.ciDetail };
  }
  if (gate.kind === "read" && gate.unproven.length > 0) {
    return {
      id: "ci-green",
      verdict: "unknown",
      why:
        `${String(gate.unproven.length)} context(s) ${gate.branch} REQUIRES were not on the truncated page ` +
        `this read saw: ${gate.unproven.join(", ")} — re-read the checks with a larger limit`,
    };
  }
  if (gate.kind === "unreadable") {
    return { id: "ci-green", verdict: "unknown", why: `required contexts UNREAD (${gate.reason})` };
  }
  if (state.checksRead.kind === "unread") {
    return { id: "ci-green", verdict: "unknown", why: `the head's checks were not read (${state.checksRead.why})` };
  }
  // A capped rollup can only ever LOSE a non-passing context, so it produces a false GREEN and never a false
  // RED — the identical shape as `threadsTest`'s truncation arm below, and it is answered the same way. A red
  // rollup is already `fail` above, so this only ever demotes a green nobody had earned. MEASURED
  // when this read still asked for a 60-context page: **5 of the owner's 24 open pull requests**
  // carried more contexts than the page did, and
  // `GithubChecksSnapshot.residue` had recorded that all along with nothing reading it. Reproduce by
  // counting rows whose `checksTruncated` is true in
  // `slopweaver github landing --repo acme/acme-admin --author <login> --json` — a field this row carries
  // precisely so that command settles the claim.
  if (state.checksTruncated) {
    return {
      id: "ci-green",
      verdict: "unknown",
      why: `GitHub has more check contexts than this read carried (${state.ciDetail}), and a capped read can only LOSE a failing one`,
    };
  }
  if (state.ci === "green") {
    return { id: "ci-green", verdict: "pass", why: state.ciDetail };
  }
  return { id: "ci-green", verdict: "unknown", why: `CI reads ${state.ci} — ${state.ciDetail}` };
}

/**
 * How `ciTest`'s `fail` arm words required contexts absent from the head: not yet created while other checks
 * are still in flight, never ran once nothing is. Only the words change; the verdict stays `fail` either way.
 *
 * @param missing the required contexts absent from the head
 * @param inFlight the running or queued checks the read saw
 * @returns the absence phrase, naming every missing context
 */
function requiredAbsence({ missing, inFlight }: { missing: readonly string[]; inFlight: readonly string[] }): string {
  if (inFlight.length > 0) {
    return `not yet created: ${missing.join(", ")} (${inFlightChecksClause({ names: inFlight })})`;
  }
  return `never ran: ${missing.join(", ")}`;
}

/**
 * The `mergeable` test, off GitHub's own three-valued `mergeable` — and `UNKNOWN` is not a pass.
 *
 * Reading `!conflicted` would make GitHub's THIRD answer a green: `mergeable` is
 * `MERGEABLE`, `CONFLICTING` or `UNKNOWN`, and everything that was not `CONFLICTING` collapsed to
 * `conflicted: false` in `../cli/commands/github/reviewStateReport.ts`. GitHub computes mergeability lazily,
 * so a read of a pull request it has not computed answers `UNKNOWN` and starts the job, which makes a FIRST
 * read the one most likely to get it — MEASURED over the
 * owner's fleet, the first read of the session answered `UNKNOWN` on **16 of 31** while a later
 * read answered it on none, and the `CONFLICTING` count rose from 5 to 8 across the two. Three of the owner's open
 * pull requests were therefore printed as mergeable in a landing run whose very next read called them
 * conflicting, and one of the four rows that read `press` did so over an answer GitHub had not computed.
 *
 * `unknown` here can only ever hold a row back, never wave one through. The other half of the fix is that
 * the fleet read RE-READS what came back `UNKNOWN` before this test ever sees it
 * (`../live/github/reviewState.ts`), so a cold boot does not turn half the fleet into `unknown` rows.
 * Reproduce with
 * `slopweaver github review-state --repo acme/acme-admin --author <login> --json | jq '[.pullRequests[].conflict.mergeable] | group_by(.) | map({(.[0]): length}) | add'`
 * run twice in a row, and compare the two `UNKNOWN` counts.
 */
function mergeableTest({ state }: { state: PrReviewState }): LandingTest {
  const { conflict } = state;
  if (conflict.mergeable === "MERGEABLE") {
    return { id: "mergeable", verdict: "pass", why: `it merges cleanly into ${state.baseRefName}` };
  }
  if (conflict.mergeable === "UNKNOWN") {
    return {
      id: "mergeable",
      verdict: "unknown",
      why:
        `GitHub has not computed whether it merges into ${state.baseRefName} — it computes that lazily, so ` +
        "this is an answer it has not reached rather than a clean one",
    };
  }
  const paths = conflictPaths({ conflict });
  const where = paths.length === 0 ? `; ${conflictWhy({ conflict })}` : ` in ${paths.join(", ")}`;
  return {
    id: "mergeable",
    verdict: "fail",
    why: `GitHub reports it CONFLICTING against ${state.baseRefName}${where}`,
  };
}

/**
 * The `threads-clear` test.
 *
 * `waitingOn` is the exact instrument rather than a count of unresolved threads: it already excludes the
 * author's own `--self-review` walkthrough comments, which are unresolved by design and sat on six of the owner's
 * 28 open pull requests when that distinction was measured (`./prStateDetail.ts`). A capped thread read can
 * only ever LOSE an unresolved thread, so a truncated one is `unknown` rather than a green.
 */
function threadsTest({ state }: { state: PrReviewState }): LandingTest {
  if (state.waitingOn.length > 0) {
    const who = state.waitingOn.map((tally) => `${tally.login} (${String(tally.open)})`).join(", ");
    return { id: "threads-clear", verdict: "fail", why: `a reviewer thread is open and waiting on us: ${who}` };
  }
  if (state.threadsTruncated) {
    return {
      id: "threads-clear",
      verdict: "unknown",
      why: "GitHub has more review threads than this read carried, and a capped read can only LOSE an unresolved one",
    };
  }
  return { id: "threads-clear", verdict: "pass", why: "no reviewer thread is waiting on us" };
}

/**
 * The words a row whose code owner is still pending opens its sentence with.
 *
 * The owner's rule is to auto-merge every dependency bump PR and nearly every slopweaver PR. The one gap the
 * owner asked to have NAMED rather than routed around is `acme/acme-admin`'s branch protection, which wants a human review — so a bump there is
 * pressed when that approval lands, and until it does the read says this, in these words.
 *
 * A constant because three surfaces print it and they may never disagree:
 * `../cli/commands/github/landingReport.ts`'s WHY cell, `./landingDispatch.ts`'s `blockedVerdict`, and
 * `./bumpSelection.ts`'s `awaiting-human-review` arm. All three read it out of THIS test's `why` rather than
 * composing a sentence of their own, which is why one edit reaches every one of them.
 */
export const AWAITING_HUMAN_REVIEW = "waiting on a human review";

/**
 * The `codeowners-satisfied` test, read off GITHUB's answer — see this module's own header for why.
 *
 * **An EMPTY owner list is only `pass` when the read was complete.** The two truncations on that read fail in
 * opposite directions and only one is dangerous: a capped REVIEWS read loses an APPROVED owner, so a
 * satisfied one reads pending and the row is held back — safe. A capped REQUESTS read loses a PENDING owner,
 * so an unsatisfied requirement reads as no requirement at all, and every other test can pass over it. That
 * is a false GREEN reaching a press, so `requestsTruncated` answers `unknown` rather than `pass`
 * (`./githubCodeowners.ts`). Found by an adversarial pass over this file before it shipped.
 *
 * **The FAIL sentence opens with {@link AWAITING_HUMAN_REVIEW} and then names who.** A pending code-owner
 * request is GitHub holding this pull request for a person, and saying so in those words turns a row a reader
 * had to interpret into one that states its own answer.
 *
 * ## A pending REQUEST is not a REQUIREMENT, and GitHub's own merge status is what tells them apart
 *
 * Failing on any pending owner would make *GitHub asked somebody* and *this base
 * branch requires somebody* one claim. They are not one claim, and the gap is not academic: a pull request
 * with three approvals, 92 checks green, no conflicts,
 * GitHub itself offering "Merge when ready", one open `asCodeOwner` request to an individual, and this test
 * reading `waiting on a human review` had to be pressed by hand.
 *
 * So a pending request is cleared exactly where GitHub says it would merge the pull request NOW
 * ({@link pendingCodeownerRequestIsNonBlocking}), and held everywhere else. MEASURED, that is a
 * narrow release rather than a blanket one: all TEN of `acme-admin`'s bumps reading `awaiting-human-review`
 * at the time came back
 * `mergeable: MERGEABLE` and `mergeStateStatus: BLOCKED`, so every one of them stays held by this test.
 * Reproduce with `slopweaver github bump-drive --repo acme/acme-admin --dry-run` and compare each row
 * against `slopweaver github read <url>`'s `mergeStateStatus`.
 *
 * The second release is a LEFTOVER person request (`./requiredCodeowners.ts`): every invoked rule approved,
 * no team pending, and the person owning none of the rules. It needs no merge status, which is what
 * was lacking when a chase named a team's delegate as the last codeowner tick.
 *
 * ## An EMPTY register is not an approval either
 *
 * Nor is an absent decision: a stated non-APPROVED decision fails, and BLOCKED with none stated fails once CI
 * passed and reads `unknown` before ({@link blockedUndecidedTest}). Only a register GitHub states APPROVED
 * over, or one GitHub reports `mergeable` over, passes — and its sentence names which, so a stored reading
 * shows the input it rested on.
 *
 * **Any other status is `unknown`, never `pass`**, because `./githubMergeStatus.ts` proves only its three
 * mergeable tokens and GitHub documents no precedence among blockers. MEASURED across two stored landing
 * readings 54 minutes apart, same heads and same CI (required green, advisory-only red), no
 * decision and no open request on six pull requests: the first read BLOCKED and held all six for a human review;
 * the second, where other rows of the same repository read GitHub's lazy `UNKNOWN`, passed all six while this
 * arm still passed every status but BLOCKED, so the fleet pressed them and the enqueue door's own fresh read
 * found BLOCKED and refused every one with `review-not-approved`. The row then carried no merge status, so the
 * reading could not name the token that flipped. Reproduce: `slopweaver reading list --producer "github
 * landing"`, then compare a row's `codeowners-satisfied` across two readings with the same `headOid`.
 */
function codeownersTest({ state, ciVerdict }: { state: PrReviewState; ciVerdict: LandingVerdict }): LandingTest {
  const { holding: pending, leftovers } = pendingCodeowners({ state });
  if (pending.length > 0) {
    const who = pending.map((owner) => tokenOf({ name: owner.token })).join(", ");
    const { requestsTruncated } = state.githubCodeowners;
    const mergeStatus = state.githubMergeStatus;
    if (
      pendingCodeownerRequestIsNonBlocking({ mergeStatus, requestsTruncated, reviewDecision: state.reviewDecision })
    ) {
      return {
        id: "codeowners-satisfied",
        verdict: "pass",
        why: `${mergeStatusClause({ mergeStatus })} — its open request to ${who} is not a review ${state.baseRefName} requires`,
      };
    }
    return {
      id: "codeowners-satisfied",
      verdict: "fail",
      why: `${AWAITING_HUMAN_REVIEW} — GitHub still holds a code-owner request out to ${who}, and ${mergeStatusClause({ mergeStatus })}`,
    };
  }
  if (leftovers.length > 0) {
    const who = leftovers.map((owner) => tokenOf({ name: owner.token })).join(", ");
    return {
      id: "codeowners-satisfied",
      verdict: "pass",
      why: `every CODEOWNERS rule it invokes is approved — the open request to ${who}, who owns none of them, is a leftover rather than a requirement`,
    };
  }
  if (state.githubCodeowners.requestsTruncated) {
    return {
      id: "codeowners-satisfied",
      verdict: "unknown",
      why: "GitHub reported more review requests than this read carried, so a PENDING code owner may be missing",
    };
  }
  return emptyRegisterTest({ ciVerdict, state });
}

/**
 * The `codeowners-satisfied` verdict over a COMPLETE, EMPTY request register — decided by GitHub's stated decision,
 * then its merge status. {@link codeownersTest}'s § "An EMPTY register is not an approval either" is why.
 */
function emptyRegisterTest({ state, ciVerdict }: { state: PrReviewState; ciVerdict: LandingVerdict }): LandingTest {
  // An EMPTY register is not an approval either, when GitHub has stated a decision against it. GitHub RETIRES
  // a request the moment the reviewer acts, so a code owner who answered CHANGES_REQUESTED leaves nothing
  // behind — and this arm read that absence as satisfaction. BLOCKED plus
  // CHANGES_REQUESTED over an empty register must not reach `pass`. APPROVED still passes, and so does an absent
  // decision GitHub reports `mergeable` over — every settled row on a base that requires no review.
  const decision = state.reviewDecision;
  if (decision.length > 0 && decision !== "APPROVED") {
    return {
      id: "codeowners-satisfied",
      verdict: "fail",
      why: `${AWAITING_HUMAN_REVIEW} — GitHub holds no open code-owner request, but its review decision reads ${decision}`,
    };
  }
  if (decision === "APPROVED") {
    return {
      id: "codeowners-satisfied",
      verdict: "pass",
      why: "GitHub states APPROVED and holds no open code-owner request",
    };
  }
  const mergeStatus = state.githubMergeStatus;
  if (blockedWithoutReviewDecision({ mergeStatus, reviewDecision: decision })) {
    return blockedUndecidedTest({ ciVerdict, state });
  }
  if (mergeStatus.kind !== "mergeable") {
    return {
      id: "codeowners-satisfied",
      verdict: "unknown",
      why: `GitHub holds no open code-owner request and states no review decision, but ${mergeStatusClause({ mergeStatus })}`,
    };
  }
  return {
    id: "codeowners-satisfied",
    verdict: "pass",
    why: `${mergeStatusClause({ mergeStatus })} — GitHub holds no open code-owner request`,
  };
}

/**
 * The `codeowners-satisfied` verdict where GitHub holds no request, states no decision, and still reports the
 * merge BLOCKED.
 *
 * MEASURED on a live `acme/acme-admin` pull request: `mergeable: MERGEABLE`, `mergeStateStatus: BLOCKED`,
 * `reviewDecision: null`, nobody approved, no open request — and every one of the six tests read `pass`, so the
 * row read `press` and dispatch `merge-now` over a pull request its base still held for a review. A review
 * requirement GitHub enforces through a ruleset does not populate `reviewDecision`, so an absent decision
 * there says nothing. Reproduce with `slopweaver github read https://github.com/acme/acme-admin/pull/<number> --json`.
 *
 * **CI decides which of two holds this is, never whether to hold.** GitHub also reports BLOCKED while a
 * REQUIRED check is still running or red — every `lachiejames/slopweaver` pull request does, then reads `CLEAN`
 * once its checks pass — so BLOCKED alone cannot be laid on a review. With `ci-green` passing, the base's
 * required checks are not what holds it, so the row FAILS in {@link AWAITING_HUMAN_REVIEW}'s words; without,
 * it is `unknown`, which still never presses. A `fail` there would outrank `ci-running` in `./bottleneck.ts`
 * and relabel every pull request whose checks are still running as a review owed to nobody.
 */
function blockedUndecidedTest({ state, ciVerdict }: { state: PrReviewState; ciVerdict: LandingVerdict }): LandingTest {
  const clause = mergeStatusClause({ mergeStatus: state.githubMergeStatus });
  if (ciVerdict === "pass") {
    return {
      id: "codeowners-satisfied",
      verdict: "fail",
      why: `${AWAITING_HUMAN_REVIEW} — GitHub holds no open code-owner request and states no review decision, but every required check passed and ${clause}`,
    };
  }
  return {
    id: "codeowners-satisfied",
    verdict: "unknown",
    why: `GitHub holds no open code-owner request and states no review decision, but ${clause} while its checks are not green — a running or red required check blocks it the same way, so whether a review also holds it is not yet told apart`,
  };
}

/** The `queue-available` test: a base that is the default branch AND actually has a queue to press. */
function queueTest({
  state,
  queueAvailability,
}: {
  state: PrReviewState;
  queueAvailability: QueueAvailability;
}): LandingTest {
  if (state.stack.stacked) {
    return {
      id: "queue-available",
      verdict: "fail",
      why: `its base is ${state.baseRefName}, not ${state.stack.defaultBranch} — the bottom of its stack lands first`,
    };
  }
  if (queueAvailability.kind === "none") {
    return { id: "queue-available", verdict: "fail", why: `${state.baseRefName} has no merge queue` };
  }
  if (queueAvailability.kind === "unread") {
    return { id: "queue-available", verdict: "unknown", why: queueAvailability.why };
  }
  return { id: "queue-available", verdict: "pass", why: `${state.baseRefName} has a merge queue` };
}

/**
 * All six tests for one pull request, always all six and always in order.
 *
 * @param state the pull request's answers
 * @param queueAvailability whether its base branch has a merge queue
 * @returns the six tests
 */
export function landingTests({
  state,
  queueAvailability,
}: {
  state: PrReviewState;
  queueAvailability: QueueAvailability;
}): readonly LandingTest[] {
  const ci = ciTest({ state });
  return [
    undraftedTest({ state }),
    ci,
    mergeableTest({ state }),
    threadsTest({ state }),
    codeownersTest({ ciVerdict: ci.verdict, state }),
    queueTest({ queueAvailability, state }),
  ];
}
