/**
 * The one observer of a running Codex pass: it relays each event, folds it, and may abort the pass.
 *
 * Split out of `./runPass.ts`'s state machine along the seam between the clock that bounds a pass (there) and
 * the watch that judges what the pass is doing while it runs (here).
 */

import { type CodexActivity, foldCodexEvent, initialCodexActivity } from "./progress.js";
import type { DeadlineRuntime } from "./runPass.js";
import { assessPassActivity, type TripwireAssessment } from "./tripwire.js";
import type { CodexEventSink } from "./types.js";

/** The one observer of a running pass: it relays, it folds, and it may abort. */
interface PassWatch {
  readonly onEvent: CodexEventSink;
  readonly abort: AbortController;
  readonly tripped: () => TripwireAssessment | undefined;
  /**
   * The fold as it stands. Exposed because it is the ONLY copy of what a pass did that survives an abort —
   * `run()` rejects, so the `Turn` carrying the items and the response is never returned.
   */
  readonly activity: () => CodexActivity;
  /**
   * Stop judging, keep folding.
   *
   * Called once the initial turn is over. The wrap-up turn is routed through this same sink so its message
   * lands in the fold and can be salvaged — but it must NOT be assessable: it was told to stop investigating,
   * so any command it runs is a deviation the tripwire was never calibrated on, and aborting the one turn
   * whose whole job is to produce a conclusion would defeat the conclusion window entirely.
   */
  readonly seal: () => void;
  /** Forget the last reported failure, and nothing else — the salvage stays cumulative across turns. */
  readonly beginTurn: () => void;
}

/**
 * Watch the event stream and abort a pass that has clearly gone hunting.
 *
 * The composed sink is what makes this work without a second stream: the caller's own `onEvent` still sees
 * every event, and the fold plus the assessment ride along behind it. `AbortSignal.any` then lets the
 * tripwire and the deadline share one turn without either knowing about the other.
 *
 * @returns the watch whose sink relays and folds every event and whose controller the tripwire aborts
 */
export function armTripwire({
  onEvent,
  runtime,
  startedAtMs,
  workspaceRoot,
  repoRoot,
}: {
  onEvent: CodexEventSink | undefined;
  runtime: DeadlineRuntime;
  startedAtMs: number;
  workspaceRoot: string;
  repoRoot: string;
}): PassWatch {
  const abort = new AbortController();
  let activity = initialCodexActivity();
  let assessment: TripwireAssessment | undefined;
  let sealed = false;
  return {
    abort,
    activity: () => activity,
    beginTurn: () => {
      activity = { ...activity, lastReportedFailure: undefined };
    },
    onEvent: (event) => {
      // FOLD FIRST, RELAY SECOND, and swallow the relay's failure.
      //
      // Found by a live p1 pass reviewing this very change, which 3,913 unit tests did not catch. The relay
      // used to run first and unguarded. `client.notify` try/catches the sink it is handed — but the sink it is
      // handed is THIS whole closure, so a caller's progress relay that threw took the fold and the assessment
      // down with it, and the event was silently lost from both. That makes the tripwire blind to a command and
      // the salvage a liar about what the pass did, on the strength of a broken progress line.
      activity = foldCodexEvent({ activity, event });
      try {
        onEvent?.(event);
      } catch {
        // Deliberately ignored — the same rule `client.notify` applies, for the same reason: a broken relay
        // must not be able to affect a pass that costs real money and up to an hour.
      }
      if (assessment !== undefined || sealed) {
        return;
      }
      const verdict = assessPassActivity({
        activity,
        elapsedMs: runtime.nowMs() - startedAtMs,
        repoRoot,
        workspaceRoot,
      });
      if (verdict.verdict === "abort") {
        assessment = verdict;
        abort.abort();
      }
    },
    seal: () => {
      sealed = true;
    },
    tripped: () => assessment,
  };
}
