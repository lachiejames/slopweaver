/*
 * The ordered own-evidence rules: everything a row's placement can be decided from using its own status,
 * probes and run journal, with `blockedBy` deliberately not consulted.
 *
 * {@link ownEvidence} applies them in order and stops at the first match, and the order IS the rule — each
 * function's own header says which numbered rule it carries and what it defers to. A `"dependency-pending"`
 * result is this module saying it has nothing left to offer, which is what hands the row to
 * `boardDependencies.ts`.
 *
 * Nothing here reads another doc. That is why the whole family can be computed in one independent pass per
 * root, and why the module header of `boardState.ts` can promise there is no fixed point to reach.
 */

import { type OwnEvidence, type RunDisposition } from "./boardTypes.js";
import { type Consistency, consistencyOf } from "./consistency.js";
import { type DerivedRowState } from "./derivedRowState.js";
import { type DocProbeState, type DocStatus, type HandoverDoc, isTerminalDocStatus } from "./doc.js";
import type { ParkedEvent } from "./parkedEvent.js";
import { parkWakePhrase } from "./parkWake.js";
import { pausedPhrase, pausedStateOf } from "./paused.js";
import { preApprovedStopLine, preApprovedStopOf } from "./preApprovedStop.js";
import type { ComputedState, ProbeResult } from "./probe.js";

/** Whether every probe passed, given the doc declared at least one. */
function probesLanded({ computed }: { computed: ComputedState | undefined }): boolean {
  return computed === "landed";
}

/**
 * Whether the doc's probes are known to be failing, as distinct from never having been evaluated.
 *
 * `unevaluated` is deliberately NOT here — it means nothing that was actually checked failed, only that some
 * probe (usually a declined `command:` one) was never run. Folding it in here is the exact defect this
 * function exists to avoid: a `done` doc with an unrun probe would read as CONTRADICTION before anyone had
 * looked. See `probe.ts`'s `computeState` header comment for the measured case.
 */
function probesRegressed({ computed }: { computed: ComputedState | undefined }): boolean {
  return computed === "partial" || computed === "not-started";
}

/**
 * Rule 2 continued: probe-vs-status contradictions {@link consistencyOf} does not cover, since it never looks
 * at probes at all — only at authored status against the run journal.
 */
function probeStatusContradiction({
  status,
  computed,
}: {
  status: DocStatus;
  computed: ComputedState | undefined;
}): OwnEvidence | undefined {
  if (status === "done" && probesRegressed({ computed })) {
    return {
      reason: "declared done, but the repository currently shows its probes failing or partial",
      section: "CONTRADICTION",
    };
  }
  if ((status === "cancelled" || status === "rejected") && probesLanded({ computed })) {
    return {
      reason: `declared ${status}, but the repository currently shows every probe passing`,
      section: "CONTRADICTION",
    };
  }
  if (status === "draft" && probesLanded({ computed })) {
    return {
      reason: "declared draft, but the repository currently shows every probe passing",
      section: "CONTRADICTION",
    };
  }
  return undefined;
}

/** Rules 4 through 6: shipped, awaiting ship, or a landed proxy — everything a `done`-adjacent status decides. */
function shippedEvidence({
  doc,
  derived,
  run,
  computed,
}: {
  doc: HandoverDoc;
  derived: DerivedRowState;
  run: RunDisposition;
  computed: ComputedState | undefined;
}): OwnEvidence | undefined {
  if (derived.status === "done") {
    return { reason: "declared done", section: "DONE" };
  }
  // `notDoneReason` is deliberately NOT consulted here: it explains why a landed PROXY (no finished run) is
  // narrower than completion. A genuine `finished` event is stronger evidence than a pre-run caveat, so it
  // confirms DONE even when the doc still carries a stale `notDoneReason` from before the run happened.
  // A `closed` cycle outranks every probe reading below it: the verb that wrote it was SAYING the work
  // shipped, which is a stronger claim than "the run stopped and the probes happen to pass". It never falls
  // through to `AWAITING SHIP`, because there is nothing left to await.
  if (run.kind === "closed") {
    return { reason: `the run recorded that it shipped: ${run.summary}`, section: "DONE" };
  }
  if (run.kind === "finished" && probesLanded({ computed })) {
    return { reason: "the run finished and every probe now passes", section: "DONE" };
  }
  if (run.kind === "finished") {
    return { reason: "the run finished; probes do not yet independently confirm it shipped", section: "AWAITING SHIP" };
  }
  if (probesLanded({ computed })) {
    if (doc.notDoneReason === undefined) {
      return { reason: "every declared probe passes, with no run recorded as finished", section: "LOOKS SHIPPED" };
    }
    // notDoneReason declares these probes narrower than completion — fall through to dependency/ready rules.
    return { reason: doc.notDoneReason, section: "dependency-pending" };
  }
  return undefined;
}

/**
 * Rule 3b: the row is parked on a person.
 *
 * Placed ABOVE {@link shippedEvidence} and DEFERRING to two things, and every edge here was decided by the
 * first real instance rather than reasoned in advance.
 *
 * MEASURED on the live board: the ISO daily-reconcile row, paused on a colleague, printed under
 * `AWAITING SHIP` — *"the run finished; probes do not yet independently confirm it shipped"* — because
 * `shippedEvidence` reads a `finished` run before anything else could speak. That reading is exactly
 * backwards: recording the pause is the LAST thing a session does before closing its run, so `finished` plus
 * `paused` is the ordinary path, not evidence the work is awaiting confirmation. `../handover/consistency.ts`
 * already grades that pair a transition rather than a defect.
 *
 * **Defers while probes have LANDED.** Probes passing is repository evidence, and it outranks anything a doc
 * says about itself: the work may have shipped anyway, elsewhere, while nobody was pushing it. That row
 * belongs in `DONE`/`LOOKS SHIPPED` where a human is asked to confirm — not quietly parked. It is not a
 * `CONTRADICTION` the way a `draft` with passing probes is, because a draft claims work has not begun while a
 * pause claims only that nobody is pushing it.
 *
 * **Defers while a run is open or waiting on the owner.** Somebody IS inside the work, which outranks an
 * authored pause; and `WAITING ON OWNER` in particular is the owner's own move, which must never be filed behind
 * somebody else's silence.
 */
function pausedEvidence({
  doc,
  run,
  computed,
}: {
  doc: HandoverDoc;
  run: RunDisposition;
  computed: ComputedState | undefined;
}): OwnEvidence | undefined {
  const state = pausedStateOf({ doc });
  if (state === undefined || probesLanded({ computed }) || run.kind === "active" || run.kind === "waiting-on-owner") {
    return undefined;
  }
  const why = doc.statusSummary === undefined ? "" : ` — ${doc.statusSummary}`;
  return { reason: `${pausedPhrase({ state })}${why}`, section: "PAUSED" };
}

/**
 * What a `WAITING ON OWNER` row says about itself.
 *
 * A row parked on a question the owner has ALREADY answered — standing doctrine rather than this run's
 * subject — is not an ordinary pause, and printing it as one is what kept the class invisible: the board
 * showed a legitimate ending, so nobody looked. `./preApprovedStop.ts` carries the criterion and the ruling;
 * the question itself is still printed in full, because the row is still genuinely stopped and a reader
 * deciding what to do about it needs the words that stopped it.
 *
 * @param question the run journal's recorded question
 * @returns the reason line for the row
 */
function waitingReason({ question }: { question: string }): string {
  const stop = preApprovedStopOf({ question });
  if (stop === undefined) {
    return `waiting on the owner: ${question}`;
  }
  return `${preApprovedStopLine({ stop })} The recorded question: ${question}`;
}

/** How a row names a seat closed at rest: CLOSED, where it stood, so it never reads as a live seat holding capacity. */
function parkedPhrase({ parked }: { parked: ParkedEvent }): string {
  const waits = parked.wake === undefined ? "" : ` ${parkWakePhrase({ wake: parked.wake })}`;
  return `parked${waits}, seat closed (${parked.workspaceRef}; ${parked.worktree} on ${parked.branch})`;
}

/** What brings a seat parked between turns back: the tick's wake reading when it named one, else a hand spawn. */
function reseatPhrase({ parked }: { parked: ParkedEvent }): string {
  return parked.wake === undefined ? "`cmux spawn` reseats it" : "`handover wake` reseats it once due";
}

/** Rules 7 through 9: an open run cycle, or other probe evidence short of landed. */
function inFlightEvidence({
  derived,
  run,
  probe,
}: {
  derived: DerivedRowState;
  run: RunDisposition;
  probe: DocProbeState | undefined;
}): OwnEvidence | undefined {
  if (run.kind === "waiting-on-owner") {
    const waiting = waitingReason({ question: run.question });
    // A parked seat names where it stood on the row itself, so the board says the seat is CLOSED and what
    // reopens it — never a waiting row that reads as a live seat holding capacity.
    const reason = run.parked === undefined ? waiting : `${parkedPhrase({ parked: run.parked })} — ${waiting}`;
    return { reason, section: "WAITING ON OWNER" };
  }
  if (run.kind === "active") {
    const reason =
      run.parked === undefined
        ? "a run is currently open"
        : `${parkedPhrase({ parked: run.parked })} between turns — ${reseatPhrase({ parked: run.parked })}`;
    return { reason, section: "IN FLIGHT" };
  }
  if (probe?.computed === "partial") {
    const passed = probe.results.filter((result: ProbeResult) => result.outcome === "pass").length;
    return { reason: `${String(passed)} of ${String(probe.results.length)} probes pass`, section: "IN FLIGHT" };
  }
  if (probe?.computed === "unevaluated") {
    const passed = probe.results.filter((result: ProbeResult) => result.outcome === "pass").length;
    const skipped = probe.results.filter((result: ProbeResult) => result.outcome === "not-evaluated").length;
    return {
      reason: `${String(passed)} of ${String(probe.results.length)} probes pass, ${String(skipped)} not evaluated — pass --probe to check the rest`,
      section: "IN FLIGHT",
    };
  }
  if (probe?.computed === "in-flight") {
    return {
      reason: `${String(probe.commitsAhead)} commit(s) ahead of base, nothing observable yet`,
      section: "IN FLIGHT",
    };
  }
  if (derived.status === "in-progress" && run.kind === "never-started") {
    return { reason: "declared in-progress, with nothing to check it against", section: "IN FLIGHT" };
  }
  return undefined;
}

/**
 * Rule 1: a front-matter or `doneWhen:`/`outputs:` parse defect, which outranks everything else in
 * {@link ownEvidence} — a doc whose probes could not even be READ has nothing else here worth trusting.
 *
 * Measured: four unparseable `doneWhen:` entries (each carrying `name:` alongside `command:`)
 * parsed to zero probes and zero failures, so `list` read the doc as an ordinary no-probe `ready` doc instead
 * of the malformed one it was — the same silent-drop this module's `doc.problems` field exists to prevent,
 * reintroduced one layer up by a reader that never looked at it.
 */
function docProblemsEvidence({ doc }: { doc: HandoverDoc }): OwnEvidence | undefined {
  if (doc.problems.length === 0) {
    return undefined;
  }
  return {
    reason:
      doc.problems.length === 1
        ? doc.problems[0]!
        : `${String(doc.problems.length)} problems, e.g. ${doc.problems[0]!}`,
    section: "CONTRADICTION",
  };
}

/**
 * An ASK row's own settlement, which is terminal and outranks everything below it.
 *
 * An ask carries no probes and no shipped code, so none of the evidence the rules below weigh applies to it.
 * What it carries instead is a witness — the doc slug it became, the permalink it was answered at, or the
 * owner's reason and anchor for declining it — and `./askRow.ts` has already refused a settlement that lacks
 * one, so by the time a settled ask reaches here its terminal state is backed by something checkable.
 *
 * `filed` and `answered` are `DONE`: the owner's ask WAS actioned, which is the number the register exists to
 * report. `declined` is `CLOSED — NOT SHIPPED`, beside a cancelled doc, because an ask talked away and an
 * ask actioned must never be counted together — that conflation is the whole reason settlement is its own
 * field rather than a reuse of `status:`.
 */
function askSettlementEvidence({
  doc,
  derived,
}: {
  doc: HandoverDoc;
  derived: DerivedRowState;
}): OwnEvidence | undefined {
  if (doc.kind !== "ask" || derived.settlement === undefined) {
    return undefined;
  }
  const { settlementReason = "no reason recorded", settlementWitness: witness = "no witness" } = derived;
  if (derived.settlement === "declined") {
    return {
      reason: `declined by the owner: ${settlementReason} (${witness})`,
      section: "CLOSED — NOT SHIPPED",
    };
  }
  const became = derived.settlement === "filed" ? "filed as" : "answered at";
  return { reason: `${became} ${witness}`, section: "DONE" };
}

/** Rules 2b and 3: the terminals a doc AUTHORS rather than the repository proving — a settled ask, or a
 * `cancelled`/`rejected` doc, plus the probe-versus-status contradiction that sits between them. */
function authoredTerminal({
  computed,
  doc,
  derived,
}: {
  computed: ComputedState | undefined;
  doc: HandoverDoc;
  derived: DerivedRowState;
}): OwnEvidence | undefined {
  const settled = askSettlementEvidence({ derived, doc });
  if (settled !== undefined) {
    return settled;
  }
  const probeContradiction = probeStatusContradiction({ computed, status: derived.status });
  if (probeContradiction !== undefined) {
    return probeContradiction;
  }
  if (isTerminalDocStatus(derived.status) && derived.status !== "done") {
    const { statusSummary = `declared ${derived.status}` } = derived;
    return { reason: statusSummary, section: "CLOSED — NOT SHIPPED" };
  }
  return undefined;
}

/**
 * Rules 1 through 9 and the terminal half of 10 — everything decidable from a doc's own status, probes, and
 * run journal alone. A `"dependency-pending"` result means the doc reached the point where `blockedBy` alone
 * decides between `RUN NOW` and `NOT YET`, or where a `scope-remains` reading applies.
 *
 * @returns the first rule that matched, as a section and the reason line it prints
 */
export function ownEvidence({
  doc,
  derived,
  probe,
  run,
  consistency,
}: {
  doc: HandoverDoc;
  derived: DerivedRowState;
  probe: DocProbeState | undefined;
  run: RunDisposition;
  consistency: Consistency;
}): OwnEvidence {
  const computed = probe?.computed;

  const docProblems = docProblemsEvidence({ doc });
  if (docProblems !== undefined) {
    return docProblems;
  }

  // Rule 2: status-vs-journal contradiction, via the single shared consistency check.
  if (consistency.kind === "contradiction") {
    return { reason: consistency.reason, section: "CONTRADICTION" };
  }

  // Rule 2b/3: a settled ask row, then an authored cancelled/rejected doc — the two authored terminals, both
  // checked before any probe rule. The consistency check above does NOT catch a settled ask with an open run:
  // it reads `status:`, a settled ask keeps `status: ready` (see `./askRow.ts`'s `settledAskRefusal` for why
  // that is deliberate), and `ready` + an open run is a `transition` rather than a contradiction. That row is
  // DONE here and its stranded session is what `./reconcile.ts` reports; the fix is that the execution doors
  // now refuse to open one at all, not that this rule detects the aftermath.
  const terminal = authoredTerminal({ computed, derived, doc });
  if (terminal !== undefined) {
    return terminal;
  }

  // BEFORE the shipped rules, and the ordering is the fix for a real misplacement — see `pausedEvidence`'s
  // own header. It defers to landed probes and to an open run on its own, so nothing above it is weakened.
  const paused = pausedEvidence({ computed, doc, run });
  if (paused !== undefined) {
    return paused;
  }

  const shipped = shippedEvidence({ computed, derived, doc, run });
  if (shipped !== undefined) {
    return shipped;
  }

  const inFlight = inFlightEvidence({ derived, probe, run });
  if (inFlight !== undefined) {
    return inFlight;
  }
  return remainingEvidence({ derived, run });
}

/** Rule 10's draft half and rules 11-12: everything left, which `blockedBy` alone decides. */
function remainingEvidence({ derived, run }: { derived: DerivedRowState; run: RunDisposition }): OwnEvidence {
  if (derived.status === "draft") {
    return { reason: "declared draft", section: "NOT YET" };
  }
  if (run.kind === "active" || run.kind === "waiting-on-owner") {
    // An open/waiting run whose own probes/status reached here still needs the dependency check, so a
    // contradictory unsatisfied dependency (rule 3's remaining case) can be found below.
    return { reason: "a run is currently open or waiting on the owner", section: "dependency-pending" };
  }
  return { reason: "declared ready", section: "dependency-pending" };
}
