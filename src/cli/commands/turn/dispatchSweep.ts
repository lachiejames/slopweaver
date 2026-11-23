/**
 * `slopweaver turn dispatch --sweep` — reporting every currently-`dispatched` ask's real state, and never
 * relaunching anything.
 *
 * Split out of `./dispatch.ts` because that file reached its 1000-line ceiling; the sweep is the natural seam
 * to lift, being one whole mode of the verb with its own injected effects and no shared state with the
 * dispatch path beyond the store functions both read.
 *
 * ## Five findings, and why `phantom` and `worker-failed` are among them
 *
 * `ready`, `still working` and `lease-expired` were the original three, and `still working` was doing two
 * jobs it could not both do. It is the SCREEN's default arm — no completion marker rendered — so it also
 * absorbed every dispatch whose workspace had been closed, whose host had exited, or whose surface simply
 * would not answer. Measured: a sweep counted such an ask among "2 still working" while two
 * sessions spent an hour trying to prove, with the wrong oracle, that nothing was running. `phantom` is the
 * fourth finding and it is checked, not inferred — see `../../../cmux/liveness.ts`.
 *
 * `worker-failed` is the fifth: a worker that reported its own failure (`turn resume --failed`, or an answer
 * that would not validate) used to count as `still working` until its lease ran out — two hours of a card
 * saying "answering" over a session that had already said no answer was coming. Since the worker posts its
 * own answer, its FAILED report is the one terminal the loop still has to finalise, and this is where.
 *
 * ## An unwitnessed dispatch is swept exactly like a running one, and no arm here had to learn about it
 *
 * Every finding above keys on the ask's `activeDispatch`, never on its `state`, so a `dispatch-unwitnessed`
 * ask — whose dispatch is deliberately NOT superseded (`../../../live/ask/lifecycle.ts`) — flows through
 * {@link sweepDecision} unchanged: it is reported still working, its lease still expires, and a workspace
 * holding no session is still caught as `phantom`. That is the fix for the measured hole: while
 * the same case was recorded `dispatch-failed`, the sweep reported `0 ready / 0 working / 0 worker-failed /
 * 0 phantom` over a live worker, so nothing would have reported its death, its stall or its lease.
 *
 * `./sweepWorkerEvidence.ts`'s `reconcileUnwitnessedDispatch` is the one thing that IS new — the positive half, settling the doubt
 * when cmux's own delivery record later corroborates the pickup.
 *
 * ## The REVIEWER half of the same delivery record, and the one write this sweep makes into a surface
 *
 * The reconciliation above only ever looked at the WORKER's workspace, so a reviewer whose pickup went
 * astray was reconciled by nothing at all. Measured: a reviewer
 * sat fourteen minutes with its full instruction typed and unsent — no
 * `latest_submitted_message`, no `latest_submitted_at`, no verdict — on the same day this sweep settled all
 * three stranded worker pickups against exactly that record. `reviewSurface.ts`'s
 * `reconcileStrandedReviewer` is the missing half, run for every still-working ask.
 *
 * It reaches a surface rather than reporting on one, and the distinction is narrow on purpose: it presses
 * ENTER on a line already sitting in an idle input box. It sends no text, opens no workspace and starts no
 * process, so `DispatchSweepDeps`'s own claim below — no way to launch anything — is unchanged.
 *
 * ## The reaction assertion is the OTHER surface-reaching thing
 *
 * `{@link assertReaction}` checks a still-live ask's tagged reaction against `../../../live/turn/reactionState.ts`'s
 * decision and converges it when the two disagree. It is a genuine WRITE rather than a keypress, which is
 * why it takes its own injected dep rather than reaching for a transport: the reason it exists is that a
 * self-recovery left a warning standing over a live worker for 43 minutes and no path could put the capture
 * emoji back. It changes no finding, no count and no summary line, and prints nothing for a healthy ask —
 * the sweep's own report is byte-identical for every message already telling the truth.
 *
 * ## `never-dispatched` and `unrouted` are the sixth and seventh, and the only two that do NOT key on a dispatch
 *
 * Keying every arm on `activeDispatch` left one whole class outside the sweep entirely: an ask that was
 * CAPTURED — reaction up, capture-time card posted — and never routed at all. Measured, and the
 * measurement is the incident: a burst-queued follow-up was promoted by `turn answer` running inside the
 * PREVIOUS ask's one-shot fresh-visible-session child, which printed the burst handoff line to a stdout
 * nobody was left to read. `sweepDecision` never saw the ask, so the card sat on `Work out how to answer` in
 * a public channel for six hours and the message queued behind it was stranded for good. {@link
 * settleUndispatched} is that arm; `../../../live/turn/undispatchedSweep.ts#undispatchedSweepAction` is its decision
 * and carries the measured bound.
 *
 * `unrouted` is the SAME ask, before that bound, and it settles nothing at all. The thirty minutes
 * `never-dispatched` waits are the right place to finalise a card and the wrong place to start telling
 * anyone — measured, a burst survivor was carded in a public channel and every
 * sweep run in the next 33 minutes reported a clean board. `../../../live/turn/undispatchedSweep.ts#unroutedSweepNotice`
 * is its decision.
 *
 * `in-review` is the third reading of that same ask, and it OUTRANKS both: no `dispatched` event does not
 * mean nobody is inside the turn. An inline turn journals a dispatch only if `./dispatch.ts`'s `handleInline`
 * ran, and a turn composed and reviewed straight off its brief and decision files never reaches it — so the
 * two arms above were reading an ask under active review as one nobody had picked up. Measured;
 * `../../../live/turn/inlineReviewHold.ts` carries it. `../../../live/turn/reviewPosture.ts` therefore runs for BOTH
 * passes now, not only the dispatched one.
 *
 * ## Both print FIRST, and the summary line leads with them
 *
 * The rule: a never-dispatched line is the loudest thing this prints.
 * So {@link sweepDispatchedAsks} runs these two arms as their own PASS before any dispatched ask is judged,
 * each line ends in the `turn brief` command that routes it (`../../../live/turn/unroutedReport.ts`), and
 * `../../../live/turn/sweepSummary.ts` re-orders the closing line whenever either fired.
 *
 * ## A PERMANENTLY IGNORED ask is not swept at all, and says so
 *
 * The sweep is an entrance that asks the permanent ignore registries: an ask the owner killed otherwise goes
 * on being reported `ready` — with an answer path that had been reaped — every ten minutes for six days. `../../../live/turn/sweepIgnored.ts` carries that measurement, why the whole ask
 * is excluded rather than just its `ready` reading (three of the five arms below are outbound WRITES), and
 * the residue the `ignored (not swept)` line exists to keep visible.
 */
import type { WorkspaceLivenessCheck } from "../../../cmux/liveness.js";
import { logger } from "../../../lib/logger.js";
import {
  type AskLifecycle,
  type DispatchedEvent,
  foldAskLifecycle,
  parseAskLifecycleLog,
} from "../../../live/ask/lifecycle.js";
import { readAskLifecycleText } from "../../../live/ask/store.js";
import type { ProcessSnapshot } from "../../../live/standing/inspect.js";
import {
  dispatchIdOf,
  type FreshDispatchRecord,
  type SweepAction,
  sweepDecision,
  terminalSweepAction,
} from "../../../live/turn/dispatch.js";
import { currentGenerationDispatchRecord } from "../../../live/turn/dispatchStore.js";
import { reviewPostureOf } from "../../../live/turn/reviewPosture.js";
import { emptySweepCounts, type SweepCounts, sweepSummaryLine } from "../../../live/turn/sweepSummary.js";
import { EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { settleSweptTerminal, settleUndispatched } from "./abandoned.js";
import { type LiveScreenRead, liveScreenRead } from "./liveScreenRead.js";
import { assertAskReaction, type ReactionAssertDeps, reactionAssertionLine } from "./reactionAssert.js";
import { type ReviewerSweepDeps, reconcileStrandedReviewer } from "./reviewSurface.js";
import { admittedSweepAsks } from "./sweepEntrance.js";
import { readySweepLine } from "./sweepLines.js";
import { reportStillWorking } from "./sweepStillWorking.js";
import { readyWorkerAlivePastLease, reconcileUnwitnessedDispatch } from "./sweepWorkerEvidence.js";

/**
 * The effects {@link sweepDispatchedAsks} needs, injected so a test can drive the sweep without a live cmux
 * binary. Deliberately no spawn/relaunch capability — a sweep only ever reports what it finds, and this type
 * makes "no way to launch anything" a fact the type system can check rather than a convention the function
 * body happens to follow. `freshScreenRead` carries the FULL live read (raw screen + record), not just the
 * classified truth, because `pushLiveChecklistDetail`'s live in-flight-step display needs the raw screen text
 * too — narrowing it to just `FreshScreenTruth` would have no way to express that need.
 */
export interface DispatchSweepDeps {
  readonly nowIso: () => string;
  readonly freshScreenRead: (input: {
    entry: AskLifecycle;
    home: string;
  }) => Promise<(LiveScreenRead & { readonly record: FreshDispatchRecord }) | undefined>;
  /**
   * cmux's own `latest_submitted_message` for one workspace — the surface a queued pickup command actually
   * reaches, and therefore the only one that can reconcile a `dispatch-unwitnessed` ask. Separate from
   * `freshScreenRead` because it is exactly NOT the rendering: the screen is where the false negative this
   * whole state exists for lives.
   */
  readonly latestSubmittedMessage: (input: { workspaceId: string }) => Promise<string | undefined>;
  /**
   * Whether a dispatch's recorded workspace still holds a running host — asked ONLY for a `ready` truth
   * already past its lease, the one case where a live worker is the reprieve `sweepDecision` weighs. A durable
   * `ready` marker is read without cmux on purpose (`./liveScreenRead.ts`), so this is the sole liveness read
   * a ready ask ever gets, and it costs nothing on the ordinary path.
   */
  readonly workerLiveness: WorkspaceLivenessCheck;
  /**
   * The reviewer half of that same delivery record, plus the Enter a typed-unsent pickup wants. Kept as its
   * own pair rather than folded into `latestSubmittedMessage` because the reviewer's evidence is TWO
   * readings — cmux's record and the surface's screen — and the decision built on it refuses to act on
   * either alone (`../../../live/turn/reviewDelivery.ts`).
   */
  readonly reviewer: ReviewerSweepDeps;
  /**
   * One reading of the process table, for deciding whether a dispatch's own `turn watch` ticker is running.
   *
   * An effect rather than a direct call so the DECISION ({@link tickerMissingClause}) stays pure, and read
   * ONCE per sweep by the wiring in `./dispatch.ts` rather than once per ask — `ps -ax` is not free, and
   * every ask in one sweep is judged against one instant of the table anyway.
   */
  readonly processSnapshot: () => ProcessSnapshot;
  /**
   * The Slack reaction read and convergence the per-tick assertion runs through, absent when this home has
   * no bot token — in which case the assertion reports what it could not check rather than claiming a match.
   *
   * Injected for the same reason every other field here is: it keeps `sweepOne`'s own regression test off
   * the network, and it is a WRITE, so leaving it as a dep rather than reaching for
   * `makeSlackWriteTransport` inside the sweep keeps this interface's claim about what the sweep can reach
   * checkable rather than aspirational.
   */
  readonly reaction: ReactionAssertDeps | undefined;
  readonly writeLine: (input: { line: string }) => void;
}

/**
 * Scan every currently-`dispatched` ask and report its state — ready, still working, or past its lease.
 * Never relaunches anything; see {@link DispatchSweepDeps}'s own header for why that is a type-level fact.
 *
 * @param home the resolved state home
 * @param deps the effects to run the sweep through — `runSweep` supplies the real clock, `readScreen` and
 *   `logger`; a test supplies plain fakes
 * @param only restrict the whole sweep to ONE ask — the by-hand correction path, because a sweep FINALISES
 *   what it finds and an install carrying a backlog would otherwise post to every stuck thread at once
 * @returns the process exit code — `EXIT_OK`, since a sweep finding nothing to do is a correct report, or
 *   `EXIT_USAGE` when an `only` was named that this home carries no ask for
 */
export async function sweepDispatchedAsks({
  home,
  deps,
  only,
}: {
  home: string;
  deps: DispatchSweepDeps;
  only?: { readonly channel: string; readonly messageTs: string } | undefined;
}): Promise<number> {
  const folded = foldAskLifecycle({ events: parseAskLifecycleLog({ text: readAskLifecycleText({ home }) }).events });
  const nowIso = deps.nowIso();
  const counts = emptySweepCounts();
  // TWO passes, and the order is the finding. An unrouted ask is the only one with a person waiting on a
  // card nobody is behind, so it must not be buried under a healthy `still working` for every other ask —
  // it is the loudest thing this prints. Every arm in the second pass needs an
  // `activeDispatch`, and every arm in the first needs there to be none, so the split costs one predicate.
  const selected = [...folded.values()].filter(
    (ask) => only === undefined || (ask.channel === only.channel && ask.messageTs === only.messageTs),
  );
  // The entrance gate, BEFORE both passes and after `only`'s own selection — `./sweepEntrance.ts`, and
  // `../../../live/turn/sweepIgnored.ts` for the measurement. `selected` is what `--ask`'s refusal below
  // still reads: an operator naming a real ask that is really ignored is told that, not "no ask here".
  const admitted = admittedSweepAsks({ counts, entries: selected, home, writeLine: deps.writeLine });
  for (const entry of admitted.filter((ask) => ask.activeDispatch === undefined)) {
    await settleUndispatched({
      entry,
      home,
      nowIso,
      onInReview: () => counts.inReview++,
      onUndispatched: () => counts.undispatched++,
      onUnrouted: () => counts.unrouted++,
      review: reviewPostureOf({ askIdentity: entry, home }),
      writeLine: deps.writeLine,
    });
  }
  await sweepDispatchedPass({ counts, deps, entries: admitted, home, nowIso });
  if (only !== undefined && selected.length === 0) {
    // A refusal rather than a clean "0 of everything": a mistyped ts would otherwise report a perfectly
    // healthy sweep over an ask that is not in the log at all, which is the one answer an operator
    // correcting a specific stuck card must never be given.
    logger.error({ msg: `turn dispatch --sweep --ask: no ask ${only.channel}/${only.messageTs} in this home` });
    return EXIT_USAGE;
  }
  deps.writeLine({ line: sweepSummaryLine({ counts }) });
  return EXIT_OK;
}

/**
 * The SECOND pass — every ask a worker is actually holding, judged and reported.
 *
 * Split out of {@link sweepDispatchedAsks} to keep it under the line cap; the split is where the two passes
 * already divide, so nothing crosses it but the counters.
 *
 * @param counts the sweep's counters, incremented in place
 * @param entries every ask this sweep selected, unrouted ones included — filtered here
 */
async function sweepDispatchedPass({
  counts,
  deps,
  entries,
  home,
  nowIso,
}: {
  counts: SweepCounts;
  deps: DispatchSweepDeps;
  entries: readonly AskLifecycle[];
  home: string;
  nowIso: string;
}): Promise<void> {
  for (const entry of entries.filter((ask) => ask.activeDispatch !== undefined)) {
    await sweepOne({
      deps,
      entry,
      home,
      nowIso,
      onChecklistUpdateFailed: () => counts.checklistUpdateFailed++,
      onExpired: () => counts.expired++,
      onFailed: () => counts.failed++,
      onPhantom: () => counts.phantom++,
      onReady: () => counts.ready++,
      onWorking: () => counts.working++,
    });
  }
}

/**
 * Read the review posture and the ready worker's liveness, then ask {@link sweepDecision} what this one
 * dispatched entry's sweep finding is — split out of {@link sweepOne} to keep that function under the line cap.
 *
 * @returns the finding the sweep reached for the entry
 */
async function decideSweepAction({
  deps,
  dispatched,
  entry,
  home,
  nowIso,
  read,
}: {
  deps: DispatchSweepDeps;
  dispatched: DispatchedEvent;
  entry: AskLifecycle;
  home: string;
  nowIso: string;
  read: (LiveScreenRead & { readonly record: FreshDispatchRecord }) | undefined;
}): Promise<SweepAction> {
  const review = reviewPostureOf({ askIdentity: entry, home, postedDigest: entry.firstAnswer?.answerDigest });
  const firstAnswer = entry.firstAnswer;
  const readyWorkerAlive = await readyWorkerAlivePastLease({ deps, dispatched, firstAnswer, nowIso, read });
  return sweepDecision({
    ask: entry,
    dispatched,
    firstAnswer,
    nowIso,
    readyWorkerAlive,
    review,
    screenTruth: read?.truth,
  });
}

/**
 * One DISPATCHED entry's sweep action, applied — split out of {@link sweepDispatchedAsks} to keep that
 * function under the line cap. An entry with no active dispatch never reaches here; `settleUndispatched` has
 * already reported it in the earlier pass.
 */
async function sweepOne({
  deps,
  entry,
  home,
  nowIso,
  onChecklistUpdateFailed,
  onExpired,
  onFailed,
  onPhantom,
  onReady,
  onWorking,
}: {
  deps: DispatchSweepDeps;
  entry: AskLifecycle;
  home: string;
  nowIso: string;
  onChecklistUpdateFailed: () => void;
  onExpired: () => void;
  onFailed: () => void;
  onPhantom: () => void;
  onReady: () => void;
  onWorking: () => void;
}): Promise<void> {
  // `activeDispatch`, never `state === "dispatched"`: the fold's `state` is the NEWEST event's kind, so an
  // observation appended over a live dispatch — a recovery re-capture's `captured`/`checklist-posted` — used
  // to take the ask out of this loop entirely and with it every terminal, lease expiry and death this sweep
  // is here to catch. Measured; see `../../../live/ask/lifecycle.ts#AskLifecycle.activeDispatch`.
  //
  // Never `undefined` here: {@link sweepDispatchedAsks} routes an entry with no active dispatch to
  // `settleUndispatched` in its own earlier pass, so that the unrouted findings print first. The local
  // binding stays because every call below reads a dispatch's own fields.
  const dispatched: DispatchedEvent | undefined = entry.activeDispatch;
  if (dispatched === undefined) {
    return;
  }
  const read = dispatched.tier === "fresh-visible-session" ? await deps.freshScreenRead({ entry, home }) : undefined;
  await reconcileUnwitnessedDispatch({ deps, entry, home, nowIso, record: read?.record });
  const action = await decideSweepAction({ deps, dispatched, entry, home, nowIso, read });
  await assertReactionUnlessTerminal({ action, deps, entry, home });
  await actOnSweepFinding({
    action,
    deps,
    dispatched,
    entry,
    home,
    nowIso,
    onChecklistUpdateFailed,
    onExpired,
    onFailed,
    onPhantom,
    onReady,
    onWorking,
    read,
  });
}

/**
 * Check one still-live ask's tagged reaction against its own state, converge it when they disagree, and say
 * so — the per-tick half of the phantom-reaction fix.
 *
 * **A TERMINAL finding is skipped, and the gate is `terminalSweepAction` for exactly the reason
 * {@link actOnSweepFinding}'s own routing uses it**: a terminal arm is about to settle this ask's reaction
 * itself through `settleSweptTerminal`, so asserting first would converge the message to `working` one call
 * before the sweep converged it to an ending — two writes that disagree, which is the class
 * `../../../live/turn/lifecycleReactions.ts` exists to end.
 *
 * `../../../live/turn/reactionState.ts` carries the measurement: the dispatch path is what puts the capture
 * emoji back when a worker self-recovers, and this is what catches every other way the message and the
 * ledger can come apart — a converge that was written and lost, a re-dispatch by an older binary, an
 * operator's own `reactions.remove`. `./reactionAssert.ts` says why the check asks Slack rather than the
 * event log. A healthy ask prints nothing, so a sweep's output is unchanged for every message that is
 * already telling the truth.
 *
 * @param action the finding this tick reached for the ask
 * @param deps the sweep's effects, carrying the reaction read/write or `undefined` with no bot token
 * @param entry the ask being swept
 * @param home the resolved state home, for the configured emoji names
 */
async function assertReactionUnlessTerminal({
  action,
  deps,
  entry,
  home,
}: {
  action: SweepAction;
  deps: DispatchSweepDeps;
  entry: AskLifecycle;
  home: string;
}): Promise<void> {
  if (terminalSweepAction({ action }) !== undefined) {
    return;
  }
  const assertion = await assertAskReaction({ deps: deps.reaction, entry, home });
  const line = reactionAssertionLine({ askIdentity: entry, assertion });
  if (line !== undefined) {
    deps.writeLine({ line });
  }
}

/**
 * Act on the finding {@link sweepDecision} reached for one dispatched ask — report it, and for a terminal one
 * settle it. Split out of {@link sweepOne} to keep that function under the line cap; the split is where the
 * READ ends and the response begins, so everything above it is state-gathering and everything here is what
 * the sweep says and does about what it found.
 *
 * The routing is on {@link terminalSweepAction}, never on "anything that is not still-working". That is the
 * whole fix: `lease-held` is a WORKING finding whose own meaning is that a reviewer is
 * mid-verdict or a clean verdict is already written, and routing it into {@link settleSweptTerminal} — whose
 * first act releases the ask's reviewer — closed one inline re-answer's reviewer on five consecutive laps.
 */
async function actOnSweepFinding({
  action,
  deps,
  dispatched,
  entry,
  home,
  nowIso,
  onChecklistUpdateFailed,
  onExpired,
  onFailed,
  onPhantom,
  onReady,
  onWorking,
  read,
}: {
  action: SweepAction;
  deps: DispatchSweepDeps;
  dispatched: DispatchedEvent;
  entry: AskLifecycle;
  home: string;
  nowIso: string;
  onChecklistUpdateFailed: () => void;
  onExpired: () => void;
  onFailed: () => void;
  onPhantom: () => void;
  onReady: () => void;
  onWorking: () => void;
  read: (LiveScreenRead & { readonly record: FreshDispatchRecord }) | undefined;
}): Promise<void> {
  if (action.kind === "ready") {
    deps.writeLine({ line: readySweepLine({ answerPath: action.answerPath, entry, home, nowIso }) });
    onReady();
    return;
  }
  const terminal = terminalSweepAction({ action });
  if (terminal !== undefined) {
    await settleSweptTerminal({
      action: terminal,
      counters: { onExpired, onFailed, onPhantom },
      dispatched,
      entry,
      home,
      nowIso,
      writeLine: deps.writeLine,
    });
    return;
  }
  if (action.kind === "lease-held") {
    // Reported, then FALLEN THROUGH into the still-working tail rather than returned from. A held lease means
    // a reviewer is mid-verdict or a clean verdict is already written, so this ask is the one that most needs
    // `reconcileStrandedReviewer` below — the reviewer whose pickup was typed and never submitted is exactly
    // the stranded-reviewer measurement in this file's header. Routing must not return early and reap instead.
    deps.writeLine({ line: `lease held open (not expired): ${entry.channel}/${entry.messageTs} — ${action.because}` });
  }
  if (read !== undefined) {
    await reportStillWorking({ deps, entry, home, nowIso, onChecklistUpdateFailed, read });
  }
  await reconcileStrandedReviewer({ askIdentity: entry, deps: deps.reviewer, home, nowIso, writeLine: deps.writeLine });
  onWorking();
}

/**
 * One `fresh-visible-session` entry's live screen read during a sweep — the raw text, its classified truth,
 * and the dispatch record both came from — or `undefined` with no CURRENT record found.
 *
 * `dispatchId` alone cannot tell two dispatch GENERATIONS of the same ask apart — it is derived from the ask
 * identity alone, on purpose, so `--poll`/`--dispatch`/`turn resume` share one token. A re-dispatched ask
 * (lease expired, re-judged, sent to a NEW workspace) reuses that same id, so a record left over from the
 * PRIOR generation would still "match" by id alone. {@link currentGenerationDispatchRecord} is what actually
 * proves the record describes the workspace THIS lease opened, not an older one `recordFreshDispatch` has
 * not finished overwriting yet.
 *
 * @param entry the ask this dispatch is for
 * @param home the resolved state home
 * @returns the live screen read for THIS generation, or `undefined` when no current record is found
 */
export async function freshVisibleSessionScreenRead({
  entry,
  home,
}: {
  entry: AskLifecycle;
  home: string;
}): Promise<(LiveScreenRead & { readonly record: FreshDispatchRecord }) | undefined> {
  const record = currentGenerationDispatchRecord({ askIdentity: entry, home });
  if (record === undefined) {
    return undefined;
  }
  const read = await liveScreenRead({
    askIdentity: entry,
    dispatchId: dispatchIdOf({ askIdentity: entry }),
    home,
    notBeforeIso: entry.firstAnswer?.tsIso,
    surfaceId: record.session.surfaceId,
    workspaceId: record.session.workspaceId,
  });
  return { ...read, record };
}
