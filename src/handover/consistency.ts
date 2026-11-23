/**
 * Whether a doc's AUTHORED status agrees with its CURRENT run journal — a cross-check `handover list` never
 * used to make, so an abandoned run's doc could sit forever showing whatever status it last declared.
 *
 * `consistent` and `transition` are both accepted: normal operation produces apparent disagreements (`start`
 * appends a journal event without flipping `ready` to `in-progress`; `finish` closes the run but tells the
 * user to wait until merge before authoring `status: done`), and a naive "flag every mismatch" detector would
 * false-positive on ordinary in-flight work. Only `contradiction` is a genuine defect: a terminal or draft doc
 * with an active/waiting run, which the board surfaces rather than silently trusting either fact over the
 * other.
 *
 * Pure: given an authored status and a derived {@link RunDisposition}, no filesystem, no clock.
 */

import type { RunDisposition } from "./boardTypes.js";
import type { DocStatus } from "./doc.js";

/** Whether an authored status and a journal's current disposition genuinely disagree. */
type ConsistencyKind = "consistent" | "transition" | "contradiction";

/** One consistency verdict, always carrying why. */
export interface Consistency {
  readonly kind: ConsistencyKind;
  readonly reason: string;
}

function consistent({ reason }: { reason: string }): Consistency {
  return { kind: "consistent", reason };
}

function transition({ reason }: { reason: string }): Consistency {
  return { kind: "transition", reason };
}

function contradiction({ reason }: { reason: string }): Consistency {
  return { kind: "contradiction", reason };
}

/** Whether a run is currently open or waiting on an answer — the two "live" dispositions. */
function isActiveRun({ run }: { run: RunDisposition }): boolean {
  return dispositionClass({ run }) === "live";
}

/**
 * The small closed set every status rule below actually branches on, derived in the ONE place a new
 * {@link RunDisposition} variant has to be considered.
 *
 * ## Why this exists rather than five hand-written kind checks
 *
 * MEASURED, by this module's own widening: adding `orphaned` to `RunDisposition` compiled
 * cleanly, and `tsc` flagged exactly one of the three readers that needed it — the one written as an
 * exhaustive `switch`. The two written as `||` chains silently took their `else` branch, so a reaped
 * `ready` row would have read as a transition and a reaped `cancelled` row would have reported "the run
 * finished rather than being abandoned", which is a false statement rather than a stale one. A union that
 * widens under a boolean expression does not fail; it answers wrong.
 *
 * That is the same defect this whole module exists to detect, one level up, so the fix is the house rule
 * from `.claude/rules/error-handling.md`: an exhaustive `switch` with a `default` assigning to `never`, so
 * the next variant fails to COMPILE here instead of being answered wrongly in five places.
 */
function dispositionClass({ run }: { run: RunDisposition }): "none" | "live" | "shipped" | "closed" | "unreadable" {
  switch (run.kind) {
    case "never-started":
      return "none";
    case "active":
    case "waiting-on-owner":
      return "live";
    // `closed` is the STRONGER member of the same class as `finished`: `finished` says the cycle ended,
    // `closed` says the work shipped. Every rule below asks only "did this cycle end having shipped", so the
    // two answer alike here; the one place the difference matters is `./boardState.ts`'s placement, which
    // reads the kind directly rather than through this class.
    case "finished":
    case "closed":
      return "shipped";
    // A cycle that ended without shipping. `abandoned` is a judgement about the WORK (someone gave up);
    // `orphaned` is a statement about the SESSION (it died holding the run) and leaves the row runnable.
    // Every rule below treats them alike because none of them is asking which of the two it was.
    case "abandoned":
    case "orphaned":
      return "closed";
    case "unreadable":
      return "unreadable";
    default: {
      const unhandled: never = run;
      return unhandled;
    }
  }
}

/** Row: `draft`. Active is a contradiction; anything else is consistent, live or historical. */
function draftConsistency({ run }: { run: RunDisposition }): Consistency {
  if (isActiveRun({ run })) {
    return contradiction({ reason: "declared draft, but a run is currently open or waiting on the owner" });
  }
  return dispositionClass({ run }) === "none"
    ? consistent({ reason: "declared draft and never started, as expected" })
    : consistent({ reason: "declared draft, with a closed historical cycle" });
}

/**
 * Row: `ready`. No run, a cleanly abandoned one, or a REAPED one is consistent; anything else mid-cycle is a
 * transition.
 *
 * `orphaned` sits with `abandoned` here rather than with `finished`, and that is the whole point of the kind
 * being separate: the session died holding the run, which says nothing about the work, so a `ready` doc whose
 * cycle was reaped is exactly as runnable as one that never started. Reading it as a transition would leave
 * every reaped row looking mid-flight to the one surface whose job is to say whether it is.
 */
function readyConsistency({ run }: { run: RunDisposition }): Consistency {
  const cycle = dispositionClass({ run });
  return cycle === "none" || cycle === "closed"
    ? consistent({ reason: "declared ready, with no live run in the way" })
    : transition({ reason: "declared ready, but a run cycle is in progress or just finished" });
}

/** Row: `in-progress`. Consistent only while a run is actually open or waiting; otherwise a transition. */
function inProgressConsistency({ run }: { run: RunDisposition }): Consistency {
  if (dispositionClass({ run }) === "none") {
    return transition({ reason: "declared in-progress with no journal — work done outside a run" });
  }
  return isActiveRun({ run })
    ? consistent({ reason: "declared in-progress, matching an open or waiting run" })
    : transition({ reason: "declared in-progress, but the run cycle already finished or abandoned" });
}

/**
 * Row: `paused`. The common case — parked on a person with no run open — is CONSISTENT, which is the whole
 * point of the state existing.
 *
 * MEASURED, and the reason this arm is written rather than folded into `in-progress`: the only
 * spelling the board had for "waiting on somebody" was `in-progress` plus a `blockedBy:` sentence, and
 * {@link inProgressConsistency} grades `in-progress` with no journal a TRANSITION — "work done outside a
 * run". A workstream deliberately parked for as long as it takes is neither of those, and every surface
 * that reads consistency was being told it was both.
 *
 * A run that is genuinely open while the doc says paused is a transition, not a contradiction: recording the
 * pause is something a session does from INSIDE its run, just before closing it, so the two overlap for one
 * step in the ordinary path. A finished cycle is a transition for the same reason `in-progress` is — the
 * doc is expected to move on and has not yet.
 */
function pausedConsistency({ run }: { run: RunDisposition }): Consistency {
  if (isActiveRun({ run })) {
    return transition({ reason: "declared paused, with a run still open — close it once the pause is recorded" });
  }
  return run.kind === "finished"
    ? transition({ reason: "declared paused, but the run cycle already finished" })
    : consistent({ reason: "declared paused, waiting on a person, with no live run in the way" });
}

/** Row: `done`. An active run always contradicts it; a genuinely abandoned cycle does too. */
function doneConsistency({ run }: { run: RunDisposition }): Consistency {
  if (isActiveRun({ run })) {
    return contradiction({ reason: "declared done, but a run is currently open or waiting on the owner" });
  }
  // The ONE rule that must tell `abandoned` from `orphaned`, which is why it switches on the kind itself
  // rather than going through `dispositionClass` like every other rule here. Collapsing them would answer
  // one of the two wrongly whichever way it went, so the shared class deliberately does not serve this case.
  switch (run.kind) {
    case "abandoned":
      // A genuine contradiction: the doc claims the work shipped, but its own cycle was given up on.
      return contradiction({ reason: "declared done, but its run cycle was abandoned rather than finished" });
    case "orphaned":
      // NOT a contradiction. The session died holding the run; that says nothing about whether the work
      // shipped, and the doc is the only party here making a claim about that.
      return consistent({ reason: "declared done, with its run cycle reaped after the session died" });
    case "finished":
    case "closed":
    case "never-started":
      // `never-started` is a pre-journal or externally shipped doc; both are consistent with completion.
      return consistent({ reason: "declared done, with no unresolved live run" });
    case "active":
    case "waiting-on-owner":
    case "unreadable":
      // Unreachable: `consistencyOf` returns on `unreadable` before dispatching, and the live cases were
      // handled by the guard above. Named rather than defaulted so a future variant lands in `never` below.
      return consistent({ reason: "declared done, with no unresolved live run" });
    default: {
      const unhandled: never = run;
      return unhandled;
    }
  }
}

/** Rows: `cancelled`/`rejected`. Consistent only with no run or a clean abandonment; anything else contradicts. */
function terminalNotShippedConsistency({
  status,
  run,
}: {
  status: "cancelled" | "rejected";
  run: RunDisposition;
}): Consistency {
  if (isActiveRun({ run })) {
    return contradiction({ reason: `declared ${status}, but a run is currently open or waiting on the owner` });
  }
  // `orphaned` joins the clean cases: a cancelled doc whose session died holding the run is not a doc whose run
  // FINISHED, so the contradiction message below would be a false statement about it rather than a finding.
  const cycle = dispositionClass({ run });
  return cycle === "none" || cycle === "closed"
    ? consistent({ reason: `declared ${status}, with no unresolved live run` })
    : contradiction({ reason: `declared ${status}, but the run finished rather than being abandoned` });
}

/**
 * The authored-status × run-disposition matrix.
 *
 * @param status the doc's authored status
 * @param run the doc's current-cycle run disposition
 * @returns whether the two agree, are a normal transition window, or genuinely contradict
 */
export function consistencyOf({ status, run }: { status: DocStatus; run: RunDisposition }): Consistency {
  if (run.kind === "unreadable") {
    return contradiction({ reason: `the current run journal could not be read: ${run.reason}` });
  }
  switch (status) {
    case "unknown":
      return contradiction({
        reason: "the doc declares no usable status, so its journal cannot be trusted against it",
      });
    case "draft":
      return draftConsistency({ run });
    case "ready":
      return readyConsistency({ run });
    case "in-progress":
      return inProgressConsistency({ run });
    case "paused":
      return pausedConsistency({ run });
    case "done":
      return doneConsistency({ run });
    case "cancelled":
    case "rejected":
      return terminalNotShippedConsistency({ run, status });
  }
}
