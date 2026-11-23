/**
 * The DISPATCH verdict — what the supervisor DOES about a landing row, as distinct from what holds it.
 *
 * A supervisor boot read must carry enough that the supervisor dispatches the obvious act to a spawned
 * session ITSELF and interrupts the owner only for the one it cannot: the right information in front of the
 * supervisor and good judgment. {@link DispatchVerdict} is the closed set, and every verdict in it is
 * dispatched to a spawned session except the owner-judgment verdict, which is carded HIGH on react-now and
 * dispatched to nobody.
 *
 * ## Nothing the owner owns goes stale
 *
 * Every open pull request of the owner's carries an act or a named wait. MEASURED over the owner's 31 open
 * `acme/acme-admin` pull requests: 6 drafts and one pull request with a code owner pending and nobody ever
 * asked dispatched `outside-the-set`, which is to say nothing moved them. So two verdicts name that work, and
 * each is bounded by the owner's steer: an unasked Slack send to a person, or an evidence-backed close of
 * something team-facing, is a queue card with the draft attached, never an act.
 *
 * - `draft-first-review-ask` — nobody was ever asked for a review. The session drafts the first ask to a
 *   named person, or a discussion opener where no discussion agreed the change and it is no obvious bug, and parks it for the owner's yes with
 *   `slack draft record`; it never sends it.
 * - `finish-or-card-close` — a draft no LIVE board row holds. The session finishes it unasked, or records a
 *   shaped card proposing its close; it never closes it. A draft a live row already holds is `waiting`,
 *   naming that row, because a second seat on one branch is duplicate work — UNLESS that row's run is parked
 *   at rest with the seat closed and no wake, which nothing ever reseats: MEASURED, two pull requests sat
 *   `waiting` on such rows for days. That draft is the act again, its brief naming the existing
 *   row's reseat (`./landingDispatchDraft.ts`).
 *
 * ## This is a SECOND layer, and `./landing.ts`'s ladder is untouched
 *
 * `LandingAction` answers "what holds this pull request" in thirteen arms and drives `pressable`, so it
 * stays exactly as it is. This module answers a coarser question on top of it. A handful of verdicts cannot
 * represent thirteen acts, and rather than force-fit them {@link DispatchDecision} carries three non-act arms
 * that a consumer can tell apart: a deliberate `waiting`, work no verdict names (`outside-the-set`), and
 * evidence this read could not establish (`unread`).
 *
 * ## The terminal evidence gate — the reason this module is careful rather than clever
 *
 * The verdicts split in two. `rebase-and-fix`, `coderabbit-loop`, `draft-first-review-ask` and
 * `finish-or-card-close` are NON-TERMINAL session acts: each names visible work a session can start now, and
 * none claims anything about what happens afterwards, so an unread fact further down the row cannot make one
 * wrong. `merge-now`, `resolve-then-merge` and `resolve-then-bump` are TERMINAL: each promises an end state,
 * so each is issued only when nothing material is unread. An
 * adversarial pass over the first draft of this design named that as its largest defect — it flattened
 * truncated thread reads and an uncomputed mergeability into confident terminal verdicts — and
 * `terminalEvidenceGate` (`./landingDispatchGate.ts`) is the answer for every fact that is material to EVERY
 * terminal verdict.
 *
 * An unbounded Slack window is material to only one pair of them, so it is not in that gate: the chase state
 * chooses between `resolve-then-merge` and `resolve-then-bump` and is checked where that choice is made
 * ({@link threadVerdict}), while `merge-now` has nobody waiting on it and nobody to chase. Gating a press on
 * a Slack window would refuse the very presses this verb exists for.
 *
 * ## The owner-judgment verdict fires on STRUCTURE, never on what a reply MEANS
 *
 * Pushback that conflicts with what the owner asked is the owner's call, and that is semantic: no pure function
 * decides it, and `./prStateDetail.ts`'s header carries the precedent — a sentiment classifier is refused in
 * favour of structural facts plus the owner's own judgement. So this module escalates on two things it
 * can actually observe, each named for what it saw and never for what it meant: a reviewer who spoke LAST on
 * an open thread, and a human whose latest opinionated review still says `CHANGES_REQUESTED`. The row carries
 * the excerpt and the reviewer; what either means stays the owner's call, and {@link DispatchDecision}'s `why` says so.
 *
 * ## A merge conflict is never the owner's card
 *
 * A general steer: conflicts on the owner's pull requests are the fleet's to resolve mechanically, markdown
 * included, and only a resolution that MATERIALLY changes what the pull request does or its risk reaches the
 * owner. A read cannot see that
 * — only the seat doing the resolution can — so every measured conflict is `rebase-and-fix`, and when the
 * local merge named paths the row's `why` hands the materiality judgement to that seat in words
 * ({@link conflictVerdict}). A third structural signal that carded every named-path conflict on an
 * unapproved pull request was removed: two README conflicts became an owner-judgment card telling the owner
 * the resolution was theirs to judge.
 *
 * Nothing that WRITES widens: `remoteJudgementSignals` — the filter `--press` re-asks immediately before each
 * click — never carried a conflict arm, and a conflicting pull request fails the `mergeable` test, so it can
 * never read `press` to begin with.
 *
 * Pure. No network, no clock, no filesystem.
 */

import type { LandingAction, LandingTest } from "./landing.js";
import type { LandingBoardRow } from "./landingBoard.js";
import { blockedVerdict, bumpWhy, FIRST_ASK_BRIEF, firstAsk, nobodyAsked } from "./landingDispatchAsk.js";
import { draftVerdict } from "./landingDispatchDraft.js";
import { gated, whyUnmeasured } from "./landingDispatchGate.js";
import type { ThreadDetail } from "./prStateDetail.js";
import type { ConversationTallies } from "./reviewSignals.js";
import { type HumanReview, isBotLogin, type PrReviewState } from "./reviewState.js";

/**
 * The closed set of dispatch verdicts: the owner's six in the order the owner named them, then the two that make
 * sure nothing the owner owns goes stale.
 *
 * The supervisor dispatches every one to a spawned session on its own judgment except the owner-judgment verdict,
 * which it cards HIGH on react-now and dispatches nothing for.
 */
export type DispatchVerdict =
  /** Red CI, or a conflict: rebase, and resolve what the rebase does not clear. A first-step verdict. */
  | "rebase-and-fix"
  /** Every test passed. Press it, or spawn a session to land it. */
  | "merge-now"
  /** We owe an answer on a thread, and after that it can land. */
  | "resolve-then-merge"
  /**
   * We owe an answer AND somebody else is still holding it — a code owner GitHub has not cleared, or a
   * reviewer whose chase is overdue. Both, because resolving our own threads does not finish either row.
   */
  | "resolve-then-bump"
  /** CodeRabbit's list is what stands between it and a review. A first-step verdict. */
  | "coderabbit-loop"
  /** The owner decides. The only arm that becomes a card, and the only one dispatched to nobody. */
  | "needs-owner-judgment"
  /**
   * Nobody was ever asked for a review. Draft the first ask to a named person, or a discussion opener where no
   * discussion agreed the change, and park it with `slack draft record` — never send it. A non-terminal
   * session act.
   */
  | "draft-first-review-ask"
  /**
   * A draft no live board row holds. Finish it unasked, or record a shaped card proposing its close — never
   * close it. A non-terminal session act.
   */
  | "finish-or-card-close";

/**
 * The verdict, or the honest absence of one.
 *
 * Three non-act arms rather than a single fallback, because a consumer that cannot tell them apart cannot
 * behave differently about them — and they demand different things. `waiting` is fine and needs nobody;
 * `outside-the-set` is real work with no verdict for it; `unread` is a hole in what this run could see.
 */
export type DispatchDecision =
  | { readonly kind: "act"; readonly verdict: DispatchVerdict; readonly why: string }
  /** A deliberate hold: the queue has it, a human opted it out, a live board row already holds the draft. */
  | { readonly kind: "waiting"; readonly why: string }
  /** Work no verdict names — a base branch with no queue to press. */
  | { readonly kind: "outside-the-set"; readonly why: string }
  /** Something this read could not establish. Never dispatched, and never carded as the owner's judgment. */
  | { readonly kind: "unread"; readonly why: string };

/** Everything one row is dispatched from that the pull request's own state does not carry. */
export interface DispatchInputs {
  readonly state: PrReviewState;
  /** The six landing tests, so an `unknown` verdict is a hole this layer can see. */
  readonly tests: readonly LandingTest[];
  /** `./landing.ts`'s own one act, which this layer coarsens rather than recomputes. */
  readonly action: LandingAction;
  /** The conversation, counted on both sides — `./reviewSignals.ts`. */
  readonly conversations: ConversationTallies;
  /**
   * The board row the read already joined to this head branch — `./landingBoard.ts`. Carried in rather than
   * re-read so this decision stays pure; a live one is what holds a draft for the seat already on it.
   */
  readonly boardRow: LandingBoardRow;
  /**
   * Whether the read was scoped to the OWNER'S OWN pull requests (`--author @me`) — `../cli/commands/github/landingRun.ts`.
   * Finishing a draft, carding its close and drafting its first review ask (or the discussion opener that comes
   * before one) are the owner's acts on their own work, so
   * the two verdicts that do them fire only here; over anyone else's pull request they read `outside-the-set`.
   */
  readonly authoredByOwner: boolean;
}

/**
 * Open threads a BOT opened where a colleague, not the bot and not the author, spoke last.
 *
 * The gap this closes is stated in {@link conversationTallies}: the tallies group by who OPENED a thread, so
 * a colleague's reply on a CodeRabbit thread lands on the bot's side and `humans.reviewerLastWord` stays
 * zero. That grouping is right for the tallies and is left alone — but a person pushing back is the owner's to read
 * whoever started the thread, and routing one at a `coderabbit-loop` session answers the wrong reviewer. A
 * Codex review built the case; `conversationTallies`' own measurement says the fleet produced it zero times,
 * which is why this counts the shape rather than redesigning the grouping around it.
 *
 * @param threads every thread on the pull request
 * @returns how many carry that shape
 */
function colleagueLastOnBotThread({ threads }: { threads: readonly ThreadDetail[] }): number {
  return threads.filter(
    (thread) =>
      thread.disposition === "reviewer-replied" &&
      isBotLogin({ login: thread.openedByLogin }) &&
      !isBotLogin({ login: thread.lastCommentLogin }),
  ).length;
}

/**
 * The judgement signals that live entirely in the REMOTE conversation, so every one of them can arrive
 * while the head stands still.
 *
 * Split out because `--press` has to re-ask this question immediately before it writes, and two copies of
 * "the owner has to read this" would drift: a reviewer replying between the fleet read and the click is the
 * exact sequence a Codex review built. They are now the WHOLE set: a conflict is the fleet's to resolve, never
 * a signal (this module's header), so {@link judgementSignals} asks nothing a working tree would add.
 *
 * @param conversations the tallies grouped by who opened each thread
 * @param standingChangesRequested every human whose changes-requested review no later review withdrew
 * @param threads every thread on the pull request, for the shape the tallies group onto the bot's side
 * @returns one sentence per signal that fired, worst first; empty when none did
 */
export function remoteJudgementSignals({
  conversations,
  standingChangesRequested,
  threads,
}: {
  conversations: ConversationTallies;
  standingChangesRequested: readonly HumanReview[];
  threads: readonly ThreadDetail[];
}): readonly string[] {
  const signals: string[] = [];
  if (conversations.humans.reviewerLastWord > 0) {
    signals.push(
      `a reviewer spoke LAST on ${String(conversations.humans.reviewerLastWord)} open thread(s) — read their words, ` +
        "this read does not judge whether they conflict with what you asked",
    );
  }
  const onBotThreads = colleagueLastOnBotThread({ threads });
  if (onBotThreads > 0) {
    signals.push(
      `a colleague spoke LAST on ${String(onBotThreads)} open CodeRabbit thread(s) — tallied with the bot's by ` +
        "opener, so read those words rather than sending a CodeRabbit session at them",
    );
  }
  if (standingChangesRequested.length > 0) {
    const who = standingChangesRequested.map((review) => review.login).join(", ");
    signals.push(`${who} has a standing CHANGES_REQUESTED review that no later review withdrew`);
  }
  return signals;
}

/** The structural escalations that reach {@link DispatchVerdict}'s owner-judgment verdict, each named for what it saw. */
function judgementSignals({ inputs }: { inputs: DispatchInputs }): readonly string[] {
  const { state, conversations } = inputs;
  return remoteJudgementSignals({
    conversations,
    standingChangesRequested: state.standingChangesRequested,
    threads: state.threads,
  });
}

/** How a `rebase-and-fix` describes the rebase half, which it may only claim when the distance was read. */
function rebaseWhy({ inputs }: { inputs: DispatchInputs }): string {
  const { baseDistance } = inputs.state;
  if (baseDistance.kind === "unread") {
    return `how far it is behind ${inputs.state.baseRefName} was not read (${baseDistance.why}), so rebase only if it is`;
  }
  if (baseDistance.value.behindBy === 0) {
    return `it is level with ${inputs.state.baseRefName}, so there is nothing to rebase onto`;
  }
  return `it is ${String(baseDistance.value.behindBy)} commit(s) behind ${inputs.state.baseRefName}`;
}

/** The two rows whose state a human set by hand: an opt-out label, and a draft. */
function settledByHand({ inputs }: { inputs: DispatchInputs }): DispatchDecision | undefined {
  if (inputs.action === "opted-out") {
    return { kind: "waiting", why: `a label opts it out of any press: ${inputs.state.labels.join(", ")}` };
  }
  if (inputs.action === "draft") {
    return draftVerdict({ inputs });
  }
  return undefined;
}

/** The arms where nothing is dispatched because nothing is owed. */
function nothingOwed({ inputs }: { inputs: DispatchInputs }): DispatchDecision | undefined {
  const { action, state } = inputs;
  if (action === "queued") {
    return { kind: "waiting", why: "GitHub's merge queue has it — nothing to send anybody" };
  }
  if (action === "pressed-not-queued") {
    return {
      kind: "waiting",
      why:
        "this machine pressed it and GitHub has no entry at that same head — do not press it again until " +
        "the head moves",
    };
  }
  if (action === "stacked") {
    return { kind: "waiting", why: `its base is ${state.baseRefName} — the bottom of its stack carries the act` };
  }
  if (action === "no-queue") {
    return {
      kind: "outside-the-set",
      why: `${state.baseRefName} has no merge queue, so there is no button to press and no dispatch verdict fits`,
    };
  }
  if (action === "unknown") {
    return { kind: "unread", why: "a landing test could not be answered, so there is no honest act to send" };
  }
  return undefined;
}

/** Whether a code owner is still pending, which is what turns a resolve into a resolve-then-bump. */
function codeownerPending({ inputs }: { inputs: DispatchInputs }): boolean {
  return inputs.tests.some((test) => test.id === "codeowners-satisfied" && test.verdict === "fail");
}

/**
 * The verdict for a row whose open threads are the thing standing in the way.
 *
 * A thread only a BOT is waiting on goes to the same session a `spawn-coderabbit` row does — CodeRabbit
 * opens nearly all of them and another app's dispatches identically, which is why the tally groups them and
 * the sentence says "bot"; a human's
 * goes to a session that answers them, and then either the pull request lands or somebody must be chased.
 */
function threadVerdict({ inputs }: { inputs: DispatchInputs }): DispatchDecision {
  const { conversations, state } = inputs;
  if (conversations.humans.open === 0 && conversations.codeRabbit.open > 0) {
    return {
      kind: "act",
      verdict: "coderabbit-loop",
      why:
        `${String(conversations.codeRabbit.open)} open BOT thread(s) — CodeRabbit's or another app's — and ` +
        "no human waiting on us",
    };
  }
  const who = state.waitingOn.map((tally) => `${tally.login} (${String(tally.open)})`).join(", ");
  // A `due` chase resting on an UNBOUNDED window is not a settled fact: the ask was found, but a reply
  // beyond the corpus watermark would have ended the silence and nothing here can see it. Reported as unread
  // rather than as a chase to send — a Codex review followed the lost bound through to exactly this verdict.
  if (state.bump.kind === "due" && !state.slack.bounded) {
    return {
      kind: "unread",
      why:
        `${who} is waiting on us and an ask went unanswered inside the Slack window this read could see, ` +
        "but that window cannot carry an absence, so whether a chase is still owed is not established",
    };
  }
  if (state.bump.kind === "due") {
    return {
      kind: "act",
      verdict: "resolve-then-bump",
      why: `${who} is waiting on us, and ${bumpWhy({ inputs })}`,
    };
  }
  // The chase state is checked BEFORE the code-owner branch, not after it. Both terminal arms here promise
  // what happens once our own threads are answered — one says the pull request lands, the other says somebody
  // still has to be chased — so an unknown chase makes the CHOICE unknown even when a code owner is plainly
  // pending. An earlier order picked `resolve-then-bump` off the pending owner alone and let an unbounded
  // Slack window through the gate, which this module's own header said it would not; a Codex review found it.
  if (state.bump.kind === "unknown" && !nobodyAsked({ inputs })) {
    return {
      kind: "unread",
      why:
        `${who} is waiting on us, and whether anybody is ALSO owed a chase could not be established ` +
        `(${state.bump.why}) — a chase that is due would make this resolve-then-bump instead`,
    };
  }
  return settledChaseVerdict({ inputs, who });
}

/**
 * The thread verdict once the chase state is settled: a pending code owner nobody asked is the first ask to
 * draft (or, with no agreed discussion behind it and no obvious bug, a discussion opener), one somebody asked is a chase, and nobody else holding it means the pull request can land.
 *
 * @param who the reviewers waiting on us, as the row names them
 * @returns the verdict
 */
function settledChaseVerdict({ inputs, who }: { inputs: DispatchInputs; who: string }): DispatchDecision {
  // Nobody was ever asked, so there is no ask to BUMP: calling this `resolve-then-bump` would send a session
  // to chase a message that does not exist. The threads come first, then the first ask (or the
  // discussion opener that must precede one) is drafted.
  if (codeownerPending({ inputs }) && nobodyAsked({ inputs })) {
    return firstAsk({
      inputs,
      why:
        `${who} is waiting on us, a code owner is still pending, and ${bumpWhy({ inputs })} — resolve those ` +
        `threads first, then ${FIRST_ASK_BRIEF}`,
    });
  }
  if (codeownerPending({ inputs })) {
    return {
      kind: "act",
      verdict: "resolve-then-bump",
      why: `${who} is waiting on us, a code owner is still pending, and ${bumpWhy({ inputs })}`,
    };
  }
  return { kind: "act", verdict: "resolve-then-merge", why: `${who} is waiting on us, and ${bumpWhy({ inputs })}` };
}

/**
 * Coarsen one landing row into the ONE thing the supervisor does about it.
 *
 * @param inputs the row's state, its six tests, its act, its conversation and its joined board row
 * @returns the verdict and the sentence behind it, or the honest reason there is no verdict
 */
export function dispatchDecision({ inputs }: { inputs: DispatchInputs }): DispatchDecision {
  // ORDER, and it is a choice rather than an accident. `opted-out` and `draft` outrank the judgment arm: an
  // opt-out is a human's own word, and a draft is not yet asking anybody to review it — the session finishing
  // it reads its threads as part of finishing — so a card over either is a card the owner did not ask for. Every
  // OTHER non-act arm sits BELOW it, so a `queued`, `stacked` or `no-queue` row carrying a standing
  // changes-requested still reaches the owner — and the queued case is the whole argument: a pull request already
  // in the merge queue with an unwithdrawn objection on it is the most urgent card this verb can produce,
  // not a row to file under "nothing to do". A Codex review asked whether the ordering was intended; it is.
  const byHand = settledByHand({ inputs });
  if (byHand !== undefined) {
    return byHand;
  }
  const signals = judgementSignals({ inputs });
  if (signals.length > 0) {
    return { kind: "act", verdict: "needs-owner-judgment", why: signals.join("; ") };
  }
  const owed = nothingOwed({ inputs });
  if (owed !== undefined) {
    return owed;
  }
  if (inputs.action === "conflicting") {
    return conflictVerdict({ inputs });
  }
  if (inputs.action === "spawn-ci") {
    return {
      kind: "act",
      verdict: "rebase-and-fix",
      why: `${ciWhy({ inputs })} — ${rebaseWhy({ inputs })}`,
    };
  }
  if (inputs.action === "spawn-coderabbit") {
    // `codeRabbitDetail` is an unrestricted string, so an empty one would leave an act verdict with no
    // sentence behind it — every arm here promises one. A Codex review found the hole by construction.
    const detail = inputs.state.codeRabbitDetail;
    return {
      kind: "act",
      verdict: "coderabbit-loop",
      why: detail === "" ? "CodeRabbit asked for changes" : detail,
    };
  }
  return gated({ decision: terminalVerdict({ inputs }), inputs });
}

/** What the CI half of a `rebase-and-fix` names, preferring the checks the base actually requires. */
function ciWhy({ inputs }: { inputs: DispatchInputs }): string {
  const required = inputs.state.failingChecks.filter((check) => check.required).map((check) => check.name);
  if (required.length > 0) {
    return `required check(s) failing: ${required.join(", ")}`;
  }
  return inputs.state.ciDetail;
}

/** The verdict for a row GitHub calls CONFLICTING, which turns entirely on what the local merge established. */
function conflictVerdict({ inputs }: { inputs: DispatchInputs }): DispatchDecision {
  const { local } = inputs.state.conflict;
  if (local.kind !== "measured") {
    return { kind: "unread", why: whyUnmeasured({ conflict: inputs.state.conflict }) };
  }
  // Named paths are the seat's to resolve, never the owner's card (this module's header). This
  // `why` is the WHOLE brief a registered board row carries (`landingRegister.ts`), so the one judgement the
  // seat still owes the owner — a material change — is said here in words, or no seat would know to make it.
  const named =
    local.paths.length > 0
      ? [
          `resolve ${local.paths.join(", ")} yourself, markdown included, and card the owner only if the resolution ` +
            "materially changes what this pull request does or its risk, naming that change",
        ]
      : [];
  // Joined from the clauses that HAVE something to say. A measured conflict carries no `why` of its own when
  // the paths came off the aliased read, and a blind template then opened the sentence with a bare em dash:
  // MEASURED on a real pull request, which printed `rebase-and-fix:  — it is 51 commit(s) behind`.
  return {
    kind: "act",
    verdict: "rebase-and-fix",
    why: [local.why, rebaseWhy({ inputs }), ...named].filter((clause) => clause !== "").join(" — "),
  };
}

/** The two arms that promise an END state, before the evidence gate has had its say. */
function terminalVerdict({ inputs }: { inputs: DispatchInputs }): DispatchDecision {
  if (inputs.action === "answer-threads") {
    return threadVerdict({ inputs });
  }
  if (inputs.action === "blocked-on") {
    return blockedVerdict({ inputs });
  }
  // The ladder never presses over a failed `ci-green`, but this layer does not lean on that: a merge-now issued
  // with it failed would promise a landing over a red nobody read. An advisory-only
  // red PASSES `ci-green` (`./landingTests.ts`), so it reaches `merge-now` here exactly as GitHub's queue would.
  if (ciFailed({ inputs })) {
    return {
      kind: "act",
      verdict: "rebase-and-fix",
      why: `its CI is red (${failingNames({ inputs })}) — read why and fix it; nothing here promises it lands over that red`,
    };
  }
  return { kind: "act", verdict: "merge-now", why: "every test passed and it is not queued" };
}

/** Whether the row's `ci-green` landing test FAILED — the one fact no verdict that promises a landing may ignore. */
function ciFailed({ inputs }: { inputs: DispatchInputs }): boolean {
  return inputs.tests.some((test) => test.id === "ci-green" && test.verdict === "fail");
}

/** The failing checks' names, joined for a `why`. */
function failingNames({ inputs }: { inputs: DispatchInputs }): string {
  return inputs.state.failingChecks.map((check) => check.name).join(", ");
}

/** One row, reduced to what {@link supervisorDispatchRows} needs of it. */
export interface DispatchedRow {
  readonly dispatch: DispatchDecision;
}

/**
 * The rows the supervisor spawns a session for, in the order the read produced them.
 *
 * The owner-judgment verdict is excluded by construction: it is the one arm the owner asked to be CARDED rather than
 * dispatched, and a selector that included it would put a session inside a decision the owner has not made.
 *
 * @param rows every row this read produced
 * @returns the dispatchable subset, fleet order preserved
 */
export function supervisorDispatchRows<Row extends DispatchedRow>({ rows }: { rows: readonly Row[] }): readonly Row[] {
  return rows.filter((row) => row.dispatch.kind === "act" && row.dispatch.verdict !== "needs-owner-judgment");
}
