/**
 * Which of the owner's open pull requests can LAND, and what holds each of the rest — the pure core of
 * `slopweaver github landing`.
 *
 * ## What this answers, and what it deliberately does not
 *
 * The rule: at every fresh supervisor boot ONE command breaks down every open pull request of the owner's
 * with enough information to say whether one is blocked on a particular person, has failing CI, or has
 * failing CodeRabbit, so the reader does not have to infer much. So every field here is a fact GitHub already published, and each row carries ONE named
 * next act — press it, spawn a session, answer a reviewer, or wait on a person.
 *
 * It answers *"is anything still holding this"*, never *"is this a good idea"*. There is no judgement about
 * whether a pull request SHOULD land: the opt-out for that is a label a human attaches
 * ({@link LandingInputs.optOutLabels}), read at selection so one exists before the first press rather than
 * after the first surprise.
 *
 * ## The code-owner test reads GITHUB's answer, and that is the whole reason this module exists
 *
 * MEASURED on `acme/acme-admin`: `github enqueue` reported `clean` on
 * 20 of the owner's 29 open pull requests and exactly THREE were ready. Its approval check reads GitHub's aggregate
 * `reviewDecision`, which is **null on that repository**, and an absent decision read as satisfied — so 17
 * would have been queued over a live `asCodeOwner` review request. The DERIVED answer cannot replace it
 * either: nearly every rule there is a team rule, which `../review/codeownerRules.ts` calls `unknown` rather
 * than satisfied by design, so a selector built on it would queue nothing on that repository, ever (21
 * unsatisfied, 8 unknown, 0 satisfied on the same 29).
 *
 * So test {@link LandingTestId} `codeowners-satisfied` reads `PrReviewState.githubCodeowners` — GitHub's own
 * `asCodeOwner` requests plus the teams a review was submitted `onBehalfOf`. Its one stated limit is a
 * SATISFIED INDIVIDUAL owner: GitHub retires that request and leaves nothing behind, so a cleared person is
 * indistinguishable from any other approver. That limit is conservative in the safe direction — it can hold
 * a ready pull request back, never wave an unready one through — and it rides on every row as residue.
 *
 * Pure. No network, no clock beyond the instant a caller passes in, no filesystem.
 */

import type { BaseDistance } from "../live/github/baseDistance.js";
import type { ChecksRead } from "../live/github/headChecksRead.js";
import { askTrailOf, type LandingAsk } from "./askTrail.js";
import type { BumpVerdict } from "./cadence.js";
import type { ChannelShare } from "./channelShare.js";
import type { GithubCodeownerRequirement } from "./githubCodeowners.js";
import { type HumanWait, humanWaitOn } from "./humanWait.js";
import type { LandingBoardRow } from "./landingBoard.js";
import { type LandingCiFailure, landingCiFailure } from "./landingCiFailure.js";
import { type DispatchDecision, type DispatchVerdict, dispatchDecision } from "./landingDispatch.js";
import { failureLadder } from "./landingLadder.js";
import { blockedOn, landingTests } from "./landingTests.js";
import { owedCodeownerRules } from "./owedCodeownerRules.js";
import { type FailingCheckDetail, oursResolvable, type ThreadDetail, type ThreadTally } from "./prStateDetail.js";
import { type ConversationTallies, conversationTallies } from "./reviewSignals.js";
import {
  type CiVerdict,
  type CodeRabbitVerdict,
  type ConflictState,
  type HumanReview,
  type PrReviewState,
  type SlackReviewState,
} from "./reviewState.js";
import type { StackPlace } from "./stack.js";

/**
 * The six tests, in the order a row prints them.
 *
 * Every one is a fact GitHub published, and they are the criteria the owner named:
 * not a draft, CI green, mergeable, no thread a reviewer is waiting on, code-owner approvals satisfied, and
 * a base branch that actually has a queue to press.
 *
 * @internal read through {@link LandingTest}; no consumer outside this module and its renderer names it.
 */
export type LandingTestId =
  "undrafted" | "ci-green" | "mergeable" | "threads-clear" | "codeowners-satisfied" | "queue-available";

/**
 * One test's answer.
 *
 * `unknown` is a first-class arm rather than a failure, for the same reason it is one in
 * `./reviewState.ts`: a read that could not establish a test must never print what a read that established
 * it prints. An `unknown` can never produce {@link LandingAction} `press`.
 *
 * @internal read through {@link LandingTest}; no consumer outside this module and its renderer names it.
 */
export type LandingVerdict = "pass" | "fail" | "unknown";

/** One of the six tests, with the sentence a reader sees written next to the rule that produced it. */
export interface LandingTest {
  readonly id: LandingTestId;
  readonly verdict: LandingVerdict;
  /** Why this verdict, in the terms the row acts on. Always populated, `pass` included. */
  readonly why: string;
}

/**
 * The ONE next act for one pull request, so the supervisor presses, spawns or waits without inferring.
 *
 * Exactly one per row, decided by {@link landingAction}'s ladder. The three the owner named directly are
 * `press`, `spawn-ci` and `spawn-coderabbit`; the rest exist because a row that says nothing is a row the owner has
 * to work out alone, which is the cost this verb removes.
 */
export type LandingAction =
  /** Every test passed and it is not already queued: the supervisor's own click. */
  | "press"
  /** Already in its base branch's merge queue — nothing to do but let GitHub land it. */
  | "queued"
  /**
   * We pressed it, GitHub has no entry for it now, and the head has not moved. Never re-press this one.
   *
   * Named for what was OBSERVED rather than for a cause. The register cannot see WHY the entry went: the
   * queue may have tested the branch merged with its base and dropped it, or somebody may have run
   * `github enqueue --dequeue` by hand. Both are reasons not to press it again automatically, and neither is
   * established by the absence — an adversarial pass called the earlier name `evicted` an unsupported causal
   * claim, and it was right.
   */
  | "pressed-not-queued"
  /** Red CI, or a required context that never ran. Spawn a session to investigate. */
  | "spawn-ci"
  /** CodeRabbit asked for changes. Spawn a session to address them. */
  | "spawn-coderabbit"
  /** A reviewer's thread is waiting on us. */
  | "answer-threads"
  /** GitHub still holds a code-owner requirement open. {@link LandingRow.blockedOn} names who. */
  | "blocked-on"
  /** GitHub reports the branch will not merge into its base. */
  | "conflicting"
  /** Its base is not the default branch, so the bottom of its stack lands first. */
  | "stacked"
  /** Still a draft. */
  | "draft"
  /** Its base branch has no merge queue, so there is no button to press. */
  | "no-queue"
  /** A label on it opts it out of any press. */
  | "opted-out"
  /** Nothing failed, but a test could not be answered. {@link LandingRow.actionDetail} says which. */
  | "unknown";

/** Whether the base branch has a merge queue at all, as the shell's per-branch read concluded. */
export type QueueAvailability =
  | { readonly kind: "queue"; readonly url: string }
  | { readonly kind: "none" }
  | { readonly kind: "unread"; readonly why: string };

/** Where this pull request stands with the queue itself. */
export type LandingQueueState =
  | { readonly kind: "queued"; readonly position: number; readonly state: string }
  | { readonly kind: "not-queued" }
  /** Pressed at a head GitHub no longer has an entry for, with that head unchanged since. */
  | { readonly kind: "pressed-not-queued"; readonly pressedAtIso: string; readonly headOid: string }
  | { readonly kind: "no-queue" }
  | { readonly kind: "unread"; readonly why: string };

/** One open pull request, broken down. */
export interface LandingRow {
  readonly repoSlug: string;
  readonly number: number;
  readonly title: string;
  readonly url: string;
  readonly headRefName: string;
  /** The head commit every judgement on this row was made about — what pins a press and an eviction. */
  readonly headOid: string;
  readonly baseRefName: string;
  /** Who opened it, so a bump bot's pull request is told from a session's without reading the title. */
  readonly authorLogin: string;
  /** Present when GitHub typed the author a `Bot`, whose GraphQL login carries no `[bot]` suffix. */
  readonly authorIsBot?: true;
  /** When it was opened. The wait denominator; see `./reviewState.ts`'s field for why not `updatedAtIso`. */
  readonly createdAtIso: string;
  readonly updatedAtIso: string;
  /** The six tests, always all six, in {@link LandingTestId}'s own order. */
  readonly tests: readonly LandingTest[];
  /** True only when every one of the six passed — never when one is `unknown`. */
  readonly ready: boolean;
  readonly action: LandingAction;
  /** The one sentence behind {@link LandingRow.action}. Always populated. */
  readonly actionDetail: string;
  /** Which person or team is holding it, `@`-prefixed as CODEOWNERS spells one. Empty when nobody is. */
  readonly blockedOn: readonly string[];
  /**
   * The code-owner rules behind {@link LandingRow.blockedOn}, each as the owners any ONE of whom clears it —
   * AND across entries, OR within one. Empty exactly when `blockedOn` is. `./owedCodeownerRules.ts`.
   */
  readonly owedCodeowners: readonly (readonly string[])[];
  readonly ci: CiVerdict;
  /**
   * Whether a red {@link LandingRow.ci} is red on a REQUIRED check, on advisory checks only, or on something
   * this read cannot classify — `./landingCiFailure.ts`. Beside `ci` rather than folded into it, so the rollup
   * word stays what GitHub said and every surface reads the same classification.
   */
  readonly ciFailure: LandingCiFailure;
  /** Every non-passing check, each marked with whether the base branch REQUIRES it. */
  readonly failingChecks: readonly FailingCheckDetail[];
  readonly codeRabbit: CodeRabbitVerdict;
  readonly codeRabbitDetail: string;
  /** Who is waiting on an unresolved thread, and on how many — reviewers only, never the author's own. */
  readonly openThreads: readonly ThreadTally[];
  /**
   * The pull request's own open walkthrough threads — nobody is waiting on one, and the fleet resolves them.
   *
   * On the row because a row that is SILENT about them is what parked a mergeable pull request for four
   * hours: `openThreads` excludes them by design, `./reviewSignals.ts`'s two tallies exclude every
   * author-opened thread by construction, and GitHub's conversation-resolution rule blocks the merge over
   * exactly these. MEASURED: 7 of the owner's 27 open pull requests carried 23 of them between them,
   * with `openThreads: []` and both tallies reading zero on every one.
   *
   * A count rather than the threads, because `./prStateDetail.ts`'s `oursResolvable` over
   * {@link LandingRow.threads} is the seam a WRITE uses and a second copy would drift. Bounded by
   * {@link LandingRow.threadsTruncated} like every other thread reading.
   */
  readonly oursResolvable: number;
  readonly stack: StackPlace;
  readonly queue: LandingQueueState;
  readonly boardRow: LandingBoardRow;
  readonly labels: readonly string[];
  /** What this row could not establish, stated rather than folded into a verdict. */
  readonly residue: readonly string[];
  /**
   * The ONE thing the supervisor does about this row — `./landingDispatch.ts`.
   *
   * A second, coarser layer above {@link LandingRow.action} rather than a replacement for it. The supervisor
   * dispatches every verdict to a spawned session on its own judgment except the one that needs the owner's
   * judgment, which it cards.
   */
  readonly dispatch: DispatchDecision;
  /** The conversation on the pull request, counted for CodeRabbit and for humans apart. */
  readonly conversations: ConversationTallies;
  /**
   * How far the head BRANCH is behind its base — context for a rebase, never a seventh test.
   *
   * Read by ref NAME, so it describes the branch's current tip rather than {@link LandingRow.headOid}. Safe
   * only because it gates nothing: see `../live/github/baseDistance.ts` for why pinning it would buy a stale
   * number over a current one.
   */
  readonly baseDistance: BaseDistance;
  /** GitHub's own mergeability and what a local merge established, carried whole. */
  readonly conflict: ConflictState;
  /**
   * The threads this read carried, so a card names what a reviewer actually said.
   *
   * NOT necessarily every thread: the fleet read caps them, and {@link LandingRow.threadsTruncated} is what
   * says so. A consumer counting these is reading a lower bound whenever that flag is set.
   */
  readonly threads: readonly ThreadDetail[];
  /** Every human whose latest opinionated review still asks for changes. */
  readonly standingChangesRequested: readonly HumanReview[];
  /** Lower-cased logins whose latest opinionated review is an approval — who, not only whether. */
  readonly approvedBy: readonly string[];
  /** GitHub's own code owners for the paths touched, each approved or pending — `./githubCodeowners.ts`. */
  readonly githubCodeowners: GithubCodeownerRequirement;
  /** Whether the Slack legs found an ask, bounded by the corpus watermark. */
  readonly slack: SlackReviewState;
  /**
   * Every certified ask on this pull request, newest first, with the people each asked ABOUT THIS pull
   * request — `./askTrail.ts`. What the pull-request page prints as "asked Rosa 26h ago in a DM", and what
   * `--record-reading` appends to the reviewer register as the owner's past picks.
   */
  readonly askTrail: readonly LandingAsk[];
  /**
   * Shared with a channel by the owner, nobody named, and where its business-day clock stands — `./channelShare.ts`.
   * The pull-request page's third review state, beside an ask trail and "nobody asked". `undefined` when it
   * does not apply.
   */
  readonly channelShare: ChannelShare | undefined;
  /**
   * Whether the head's check rollup carried more contexts than the read asked for.
   *
   * On the ROW rather than only on the state it came from, so the measurement its own `ci-green` arm cites
   * is reproducible from `--json` — a Codex review found the comment naming a command whose document did not
   * carry the field, which made the claim unfalsifiable by the path it named.
   */
  readonly checksTruncated: boolean;
  /** Whether the head's checks were read at all, as distinct from there being none. */
  readonly checksRead: ChecksRead;
  /** Whether GitHub had more reviews than this read carried, so a standing verdict may be missing. */
  readonly reviewsTruncated: boolean;
  /** Whether GitHub had more review threads than this read carried. */
  readonly threadsTruncated: boolean;
  /** Whether a chase is due on the newest ask-like message found. */
  readonly bump: BumpVerdict;
  /** On a `blocked-on` row, the five facts about the human it waits on — `./humanWait.ts`. */
  readonly humanWait: HumanWait | undefined;
}

/** Everything one row is computed from that the pull request's own state does not carry. */
export interface LandingInputs {
  readonly state: PrReviewState;
  /** Whether the pull request's BASE branch has a merge queue, from the shell's one-read-per-branch cache. */
  readonly queueAvailability: QueueAvailability;
  /** The board row that stated this pull request's head branch (declared, or its run's recorded), when one did. */
  readonly boardRow: LandingBoardRow;
  /** A press this machine already recorded for this pull request, when there is one. */
  readonly press: RecordedPress | undefined;
  /** The labels that opt a pull request out of any press, lower-cased by the caller. */
  readonly optOutLabels: readonly string[];
  /** When the read was taken — what a wait's staleness is measured against. */
  readonly nowIso: string;
  /** Whether the read was scoped to the owner's own pull requests — `./landingDispatch.ts`'s `authoredByOwner`. */
  readonly authoredByOwner: boolean;
}

/** One press this machine recorded, so an eviction is visible rather than silently re-pressed. */
export interface RecordedPress {
  readonly atIso: string;
  /** The head the press was pinned to — an eviction only counts while the head has not moved. */
  readonly headOid: string;
}

/** Where this pull request stands with the queue, folding a recorded press in so an eviction is visible. */
function queueStateOf({
  state,
  queueAvailability,
  press,
}: {
  state: PrReviewState;
  queueAvailability: QueueAvailability;
  press: RecordedPress | undefined;
}): LandingQueueState {
  const entry = state.queueEntry;
  if (entry !== undefined) {
    return { kind: "queued", position: entry.position, state: entry.state };
  }
  if (press !== undefined && press.headOid === state.headOid) {
    return { headOid: press.headOid, kind: "pressed-not-queued", pressedAtIso: press.atIso };
  }
  if (queueAvailability.kind === "none") {
    return { kind: "no-queue" };
  }
  if (queueAvailability.kind === "unread") {
    return { kind: "unread", why: queueAvailability.why };
  }
  return { kind: "not-queued" };
}

/**
 * The ladder that turns the six tests' verdicts into ONE next act.
 *
 * The order is the owner's, not a taxonomy: an opt-out beats everything because it is a human saying "not
 * this one"; a draft cannot land until it is finished and undrafted, and a conflict must be resolved
 * before any other act can land; then the two the owner named as spawns (CI, then CodeRabbit); then a stack or a
 * missing queue; then the two waits (a reviewer's thread, a code owner). CodeRabbit sits BELOW CI because a
 * red build makes its review moot, and ABOVE the waits because addressing it is work we can start now rather
 * than something to wait on somebody for.
 *
 * **`spawn-ci` outranks `stacked` deliberately.** A red build on a stacked pull request is work a session
 * can start THIS MINUTE, and landing the bottom of its stack cannot make that build green — so reporting
 * `stacked` would hide the one actionable thing about the row until some later boot. An adversarial pass
 * over this file caught the earlier order doing exactly that. It does not touch the owner's ruling on asks,
 * which is about review ASKS: a stacked row still gets no ask, and a GREEN stacked row still reads
 * `stacked`.
 *
 * `stale` CodeRabbit is deliberately not an act. It is reported on every row and it demotes nothing:
 * two pull requests once read `stale` while being the only pressable ones,
 * so treating staleness as a hold would have withheld the very presses this verb was built for.
 *
 * @param tests the six landing tests, each with its verdict
 * @param state the pull request's answers, for the CodeRabbit arm and the blocked-on names
 * @param queue where it stands with the queue
 * @param optedOut whether a label opts it out of any press
 * @returns the one act, with the sentence behind it
 */
export function landingAction({
  tests,
  state,
  queue,
  optedOut,
}: {
  tests: readonly LandingTest[];
  state: PrReviewState;
  queue: LandingQueueState;
  optedOut: boolean;
}): { readonly action: LandingAction; readonly detail: string } {
  if (optedOut) {
    return { action: "opted-out", detail: `a label opts it out of any press: ${state.labels.join(", ")}` };
  }
  const ladder = failureLadder({ state, tests });
  if (ladder !== undefined) {
    return ladder;
  }
  if (queue.kind === "pressed-not-queued") {
    return {
      action: "pressed-not-queued",
      detail:
        `pressed at ${queue.pressedAtIso} and GitHub has no entry for it now, with its head still ` +
        `${queue.headOid.slice(0, 7)} — the queue may have tested it merged with ${state.baseRefName} and ` +
        "dropped it, or somebody may have dequeued it by hand; either way do not re-press until the head moves",
    };
  }
  if (queue.kind === "queued") {
    return { action: "queued", detail: `already in the queue at position ${String(queue.position)} (${queue.state})` };
  }
  const unknown = tests.find((test) => test.verdict === "unknown");
  if (unknown !== undefined) {
    return { action: "unknown", detail: `${unknown.id} could not be answered: ${unknown.why}` };
  }
  return { action: "press", detail: "every test passed and it is not queued — press 'Merge when ready'" };
}

/** What one row could not establish, stated rather than folded into a verdict. */
function residueOf({ state, queue }: { state: PrReviewState; queue: LandingQueueState }): readonly string[] {
  const lines = [...state.githubCodeowners.residue];
  if (queue.kind === "unread") {
    lines.push(`whether ${state.baseRefName} has a merge queue was not read: ${queue.why}`);
  }
  if (state.requiredContexts.kind === "unreadable") {
    lines.push(`what ${state.baseRefName} REQUIRES was not read: ${state.requiredContexts.reason}`);
  }
  return lines;
}

/**
 * Break one open pull request down into the row the supervisor acts on.
 *
 * @param inputs the pull request's answers plus the four things its own state cannot carry
 * @returns the row, with all six tests, one named act and its residue
 */
export function landingRow({ inputs }: { inputs: LandingInputs }): LandingRow {
  const { state, queueAvailability, boardRow, press, optOutLabels, nowIso, authoredByOwner } = inputs;
  const tests = landingTests({ queueAvailability, state });
  const queue = queueStateOf({ press, queueAvailability, state });
  const optedOut = state.labels.some((label) => optOutLabels.includes(label.toLowerCase()));
  const { action, detail } = landingAction({ optedOut, queue, state, tests });
  const conversations = conversationTallies({ authorLogin: state.authorLogin, threads: state.threads });
  return {
    action,
    actionDetail: detail,
    approvedBy: state.approvedBy,
    baseRefName: state.baseRefName,
    githubCodeowners: state.githubCodeowners,
    blockedOn: blockedOn({ state }),
    authorLogin: state.authorLogin,
    ...(state.authorIsBot === true ? { authorIsBot: true as const } : {}),
    boardRow,
    ci: state.ci,
    ciFailure: landingCiFailure({ state }),
    createdAtIso: state.createdAtIso,
    codeRabbit: state.codeRabbit,
    codeRabbitDetail: state.codeRabbitDetail,
    failingChecks: state.failingChecks,
    headOid: state.headOid,
    headRefName: state.headRefName,
    humanWait: humanWaitOn({ action, nowIso, state, who: blockedOn({ state }) }),
    labels: state.labels,
    number: state.number,
    openThreads: state.waitingOn,
    owedCodeowners: owedCodeownerRules({ state }),
    oursResolvable: oursResolvable({ details: state.threads }).length,
    queue,
    ready: tests.every((test) => test.verdict === "pass"),
    repoSlug: state.repoSlug,
    baseDistance: state.baseDistance,
    bump: state.bump,
    checksRead: state.checksRead,
    checksTruncated: state.checksTruncated,
    conflict: state.conflict,
    conversations,
    dispatch: dispatchDecision({ inputs: { action, authoredByOwner, boardRow, conversations, state, tests } }),
    residue: residueOf({ queue, state }),
    slack: state.slack,
    askTrail: askTrailOf({ asks: state.slack.asks }),
    channelShare: state.channelShare,
    stack: state.stack,
    reviewsTruncated: state.reviewsTruncated,
    standingChangesRequested: state.standingChangesRequested,
    tests,
    threads: state.threads,
    threadsTruncated: state.threadsTruncated,
    title: state.title,
    updatedAtIso: state.updatedAtIso,
    url: state.url,
  };
}

/** How many rows fell to each act, so a boot line says what the read found without listing it. */
export interface LandingTally {
  readonly total: number;
  readonly ready: number;
  readonly byAction: readonly { readonly action: LandingAction; readonly count: number }[];
  /**
   * How many rows fell to each DISPATCH verdict, commonest first.
   *
   * Only the `act` arm is counted, the verdict that routes a row to the owner included — a `waiting`, `outside-the-set` or
   * `unread` row is not a verdict and printing it as one would put a number against an act nobody named.
   */
  readonly byDispatch: readonly { readonly verdict: DispatchVerdict; readonly count: number }[];
  /**
   * Rows whose only red is ADVISORY (`ciFailure` red, `required: false`), whatever act they read. `ci-green`
   * passes such a red, so these rows sit under the act their other tests give them — a wait, a press, the
   * queue — rather than under CI. Counted so passing them never hides the reds: a zero under the CI heading
   * beside red heads is the confident-but-wrong count this verb exists to end. The name dates from when
   * these rows could only step aside to a later hold; it is kept because the site reads it.
   */
  readonly advisoryRedBypassed: number;
}

/**
 * Count the rows by act, commonest first.
 *
 * @param rows every row this read produced
 * @returns the totals plus one entry per act that actually occurred
 */
export function landingTally({ rows }: { rows: readonly LandingRow[] }): LandingTally {
  const counts = new Map<LandingAction, number>();
  const verdicts = new Map<DispatchVerdict, number>();
  for (const row of rows) {
    // An act's tally opens at its first row.
    const { action } = row;
    if (!counts.has(action)) {
      counts.set(action, 0);
    }
    counts.set(action, counts.get(action)! + 1);
    if (row.dispatch.kind === "act") {
      // A dispatch verdict's tally opens at its first row.
      const { verdict } = row.dispatch;
      if (!verdicts.has(verdict)) {
        verdicts.set(verdict, 0);
      }
      verdicts.set(verdict, verdicts.get(verdict)! + 1);
    }
  }
  return {
    byAction: [...counts.entries()]
      .map(([action, count]) => ({ action, count }))
      .toSorted((left, right) => right.count - left.count || left.action.localeCompare(right.action)),
    byDispatch: [...verdicts.entries()]
      .map(([verdict, count]) => ({ count, verdict }))
      .toSorted((left, right) => right.count - left.count || left.verdict.localeCompare(right.verdict)),
    advisoryRedBypassed: rows.filter((row) => row.ciFailure.kind === "red" && row.ciFailure.required === false).length,
    ready: rows.filter((row) => row.ready).length,
    total: rows.length,
  };
}

/**
 * Every row that is a press RIGHT NOW, in a stable order.
 *
 * The one selector `--press` acts on, so the set that gets clicked is the set the table printed. A row that
 * is `ready` but already `queued`, or pressed and not queued, is not here: `action` folds both in, so this
 * reads the act rather than the flag.
 *
 * **A row the dispatch layer sends to the OWNER is excluded, and that is the whole point of the layer reaching
 * the write path.** The two answers are independent: all six tests can pass — `action: "press"` — while a
 * colleague's standing `CHANGES_REQUESTED` makes the dispatch the verdict that routes the row to the owner. A
 * selector reading `action` alone would go on pressing such a row while the table said it was the owner's to
 * answer. Narrowing is safe by construction: this can only ever press FEWER pull requests than before, never
 * one it would not have. `ready` is a second lock of the same kind: `press` never follows a failed test, and
 * this makes that a property of the write path rather than of the ladder alone. An advisory-only red is not a
 * failed test — `ci-green` passes it, as GitHub's queue does — so it is pressed here like any other green row.
 * The dispatch must positively read `merge-now`, not merely
 * avoid the owner-routing verdict: a row whose terminal evidence gate found a fact `unread` (a truncated review
 * or label list, say) can still pass all six tests, and pressing it would act on the hole the dispatch named.
 *
 * @param rows every row this read produced
 * @returns the pressable rows, lowest number first
 */
export function pressable({ rows }: { rows: readonly LandingRow[] }): readonly LandingRow[] {
  return rows
    .filter(
      (row) =>
        row.action === "press" && row.ready && row.dispatch.kind === "act" && row.dispatch.verdict === "merge-now",
    )
    .toSorted((left, right) => left.repoSlug.localeCompare(right.repoSlug) || left.number - right.number);
}
