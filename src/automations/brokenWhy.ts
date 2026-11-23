/**
 * Why a broken automation is broken, and who fixes it — the first and third of the five answers
 * (`./brokenAccount.ts`). Said as what the record supports and no more: a fix is the stage its board row is in, and
 * the scheduler is said as what it will or will not do, never as a promise.
 */
import type { FailureFixStage } from "../live/automation/failureHold.js";
import type { SilentRow } from "../live/automation/silentRows.js";
import type { RecipeSlotVerdict } from "../live/automation/slotAttempt.js";
import type { SilentSupervisorStop } from "../live/automation/supervisorStops.js";
import type { ResyncState } from "../live/resync/outcome.js";
import type { FiringView } from "./card.js";
import type { AutomationHealth } from "./health.js";

/** Who the fix rests on: the fleet, the owner, or nobody the record names. */
type FixOwner = "fleet" | "you" | "unknown";

/** Where the fix stands, and since when its row has. */
export interface FixAccount {
  readonly by: FixOwner;
  readonly words: string;
  readonly sinceIso: string | null;
}

/** Why, and who fixes it. */
interface WhyAndFix {
  readonly why: string;
  readonly fix: FixAccount;
}

/**
 * The fix sentence for each stage a failure hold's board row can be in.
 *
 * @param sinceIso when the hold was placed
 * @returns who the fix rests on, and where it stands
 */
export function fixStageAccount({ stage, sinceIso }: { stage: FailureFixStage; sinceIso: string }): FixAccount {
  switch (stage.kind) {
    case "queued":
      return { by: "fleet", sinceIso, words: "The fix is the fleet's. It is on the board, not picked up yet." };
    case "taken":
      return { by: "fleet", sinceIso, words: "The fix is the fleet's, and a session has taken it up." };
    case "parked":
      return { by: "fleet", sinceIso, words: "The fix is the fleet's. The session that took it up has parked it." };
    case "filed":
      return {
        by: "fleet",
        sinceIso,
        words:
          stage.status === null
            ? "The fix is the fleet's, filed as its own piece of work."
            : `The fix is the fleet's, filed as its own piece of work, which reads ${stage.status}.`,
      };
    case "closed-unsettled":
      return {
        by: "unknown",
        sinceIso,
        words: `Its fix row was closed as ${stage.status} without settling, so nothing will lift the pause on its own.`,
      };
    case "declined":
      return {
        by: "you",
        sinceIso,
        words: "You declined its fix, so it stays paused until you lift the pause or ask for another fix.",
      };
    case "landed":
      return { by: "fleet", sinceIso, words: "The fix has landed; the scheduler runs it again on its own." };
    case "unread":
      return { by: "unknown", sinceIso, words: "Its fix row could not be read, so where the fix stands is unknown." };
    default: {
      const unreachable: never = stage;
      return unreachable;
    }
  }
}

/** A resync blocked on the owner — a recorded blocker or a sign-in wall — or `null` when nothing is on them. */
function onYouAccount({ resync }: { resync: ResyncState | undefined }): WhyAndFix | null {
  const blocker = resync === undefined ? null : resync.blocker;
  if (blocker !== null) {
    const steps = blocker.steps.length > 0 ? ` ${blocker.steps.join("; ")}.` : "";
    return {
      fix: { by: "you", sinceIso: null, words: `It needs you.${steps}` },
      why: `It is blocked on something only you can clear: ${blocker.reason}.`,
    };
  }
  const wall = resync?.lastAttempt?.signInWall;
  if (wall === undefined) {
    return null;
  }
  return {
    fix: { by: "you", sinceIso: null, words: `It needs you to sign in at ${wall}.` },
    why: "It reached a sign-in page instead of the page it reads.",
  };
}

/** What an unheld row's why and fix are told from. */
interface UnheldInputs {
  readonly health: AutomationHealth;
  /** Newest slot first. */
  readonly firings: readonly FiringView[];
  readonly slotVerdict: RecipeSlotVerdict | null;
  readonly resync: ResyncState | undefined;
  readonly silent: SilentRow | undefined;
}

/** A row whose latest scheduled time's run was abandoned: it stopped partway, which is not the same as failing. */
const STOPPED_PARTWAY: WhyAndFix = {
  fix: {
    by: "fleet",
    sinceIso: null,
    words: "Nobody has been named to act; the scheduler decides whether it is safe to try it again.",
  },
  why: "The run for its latest scheduled time stopped partway and never finished.",
};

/**
 * A stuck row whose own firing is still open under its lease while a sync of its source has gone quiet. Nothing
 * stops the quiet sync, but the lease ends at the row's next scheduled time (`leaseExpiresIso`), or sooner when an
 * in-process holder is gone, and then the scheduler reads the run abandoned: a run that STARTED is retired dead
 * (`abandonedDeath`), and a death pauses the row and files its fix on the board (`slotFailureHold.ts`), while one
 * that never started is retaken only when that is safe (a held verdict does not say which). Each of those
 * writes can fail and is retried by a later tick (`slotDeadLetter.ts`), so the line says "tries". The quiet
 * sync is the SOURCE's, not proven to be this firing's (`automationCard` joins no run id), so it is said as both.
 */
const QUIET_WHILE_ITS_RUN_IS_OPEN: WhyAndFix = {
  fix: {
    by: "fleet",
    sinceIso: null,
    words:
      "Nobody needs to act yet. Once its next scheduled time passes, if not sooner, the scheduler stops waiting on " +
      "this run. If the run had started, the scheduler then tries to mark it dead, pause the automation and put a " +
      "fix on the board for the fleet; if not, it decides whether it is safe to try again.",
  },
  why: "A sync of its source has gone quiet, and this automation's own run has not finished.",
};

/**
 * A stuck row no firing of its own holds: a sync of its source, started elsewhere, still holds the source's refresh
 * slot (`syncRun/fold.ts`) and has gone quiet. Nothing here stops a live process, and this row's resync defers while
 * the slot is held (`resyncDeferredWhy.ts`), so nobody is named and the account says what clears it.
 */
const QUIET_SYNC_HOLDS_THE_SOURCE: WhyAndFix = {
  fix: {
    by: "unknown",
    sinceIso: null,
    words:
      "Nothing here stops a sync that has gone quiet. Until that sync finishes or is stopped, this automation " +
      "cannot sync its source.",
  },
  why: "A sync of its source is still running, but has gone quiet.",
};

/** A waiting, stuck or stopped row, or `null` for one whose latest scheduled time's run simply failed. */
function notRunningAccount({ health, slotVerdict, firings, silent }: UnheldInputs): WhyAndFix | null {
  if (health === "waiting") {
    const said = firings[0]?.detail;
    const detail = said == null ? "" : `: ${said}`;
    return {
      fix: { by: "fleet", sinceIso: null, words: "Nobody needs to act; waiting spends none of its retries." },
      why: `It is waiting on something else first${detail}.`,
    };
  }
  if (health === "stuck" && slotVerdict?.kind === "abandoned") {
    return STOPPED_PARTWAY;
  }
  if (health === "stuck" && slotVerdict?.kind === "held") {
    return QUIET_WHILE_ITS_RUN_IS_OPEN;
  }
  if (health === "stuck") {
    return QUIET_SYNC_HOLDS_THE_SOURCE;
  }
  if (health === "stopped") {
    return stoppedAccount({ silent });
  }
  return null;
}

/** Who runs a stopped row, said once: the supervisor, and nothing on a timer. */
const ONLY_THE_SUPERVISOR = "Only the supervisor runs it; nothing runs it on a timer.";

/** The fix account of a stopped row nothing more specific is known about. */
const SUPERVISOR_RUNS_IT: FixAccount = { by: "fleet", sinceIso: null, words: ONLY_THE_SUPERVISOR };

/**
 * Why a row stopped running on its schedule, in plain words, read off what the silence and the supervisor's own
 * record hold. The record's wording — slots, cadences, exit codes, the instants — is the row's detail, never this.
 *
 * @param silent the row's silence reading, when it has one
 * @returns the why sentence and the fix account
 */
export function stoppedAccount({ silent }: { silent: SilentRow | undefined }): WhyAndFix {
  if (silent === undefined) {
    return { fix: SUPERVISOR_RUNS_IT, why: "It has stopped running on its schedule." };
  }
  // A hold the chair recorded is the reason it is not running, whatever the silence classifier called the gap: a
  // held never-run row read only "It has never run" before. Not an unschedulable one: lifting
  // the hold would not run it, so its schedule is still the account that tells the owner what has to change.
  if (silent.supervisorStop?.kind === "held" && silent.reason !== "UNSCHEDULABLE") {
    return heldAccount({ stop: silent.supervisorStop });
  }
  switch (silent.reason) {
    case "UNSCHEDULABLE":
      return {
        fix: { by: "unknown", sinceIso: null, words: "Its schedule needs rewriting before it can run on its own." },
        why: "Its schedule cannot be read, so it will never run on its own.",
      };
    case "NEVER RUN":
      return { fix: SUPERVISOR_RUNS_IT, why: "It has never run." };
    case "DEFERRED":
      return {
        fix: {
          by: "fleet",
          sinceIso: null,
          words: "Nobody needs to act; it runs once what it is waiting for is there.",
        },
        why: "It is waiting for something it needs before it can run, and has not run since.",
      };
    case "FAILING":
      return { fix: SUPERVISOR_RUNS_IT, why: "Its last run failed, and it has not run on its schedule since." };
    case "MISSED":
      return missedAccount({ stop: silent.supervisorStop });
    default: {
      const unreachable: never = silent.reason;
      return unreachable;
    }
  }
}

/** A row the supervisor is holding back, in its own words — whatever silence reason the row also carries. */
function heldAccount({ stop }: { stop: Extract<SilentSupervisorStop, { kind: "held" }> }): WhyAndFix {
  return {
    fix: { by: "fleet", sinceIso: stop.recordedIso, words: "It runs when the supervisor lifts its hold." },
    why: `The supervisor is holding it back, and said why: “${stop.reason}”`,
  };
}

/** A row that went by its scheduled times unrun, said as what the supervisor's own record says about it. */
function missedAccount({ stop }: { stop: SilentSupervisorStop | undefined }): WhyAndFix {
  const missed = "It missed its scheduled time";
  if (stop === undefined) {
    return { fix: SUPERVISOR_RUNS_IT, why: `${missed}, and nothing on record says why.` };
  }
  switch (stop.kind) {
    case "held":
      return heldAccount({ stop });
    case "passed-over":
      return {
        fix: {
          by: "unknown",
          sinceIso: null,
          words: "No session is on it. You can ask the supervisor to run it, or why it keeps passing it over.",
        },
        why:
          `It is due, but the supervisor has seen it waiting ${String(stop.passes)} ` +
          `${stop.passes === 1 ? "time" : "times"} without running it or saying why.`,
      };
    case "no-due-reading":
      return {
        fix: { by: "fleet", sinceIso: null, words: "It runs the next time a supervisor check finds it due." },
        why: `${missed}, and no supervisor check has looked at it since.`,
      };
    case "unreadable":
      return {
        fix: { by: "unknown", sinceIso: null, words: ONLY_THE_SUPERVISOR },
        why: `${missed}, and the supervisor's record could not be read to say why.`,
      };
    default: {
      const unreachable: never = stop;
      return unreachable;
    }
  }
}

/**
 * A row whose latest scheduled time's run failed, said as what its slot verdict supports and no more. It names the
 * scheduled TIME, never "its newest run": an older time's run can finish after it, and the scheduler judges by time
 * A dead firing reads failed health, but it stopped partway and is said so.
 */
function failedRunAccount({
  latest,
  slotVerdict,
}: {
  latest: FiringView | undefined;
  slotVerdict: RecipeSlotVerdict | null;
}): WhyAndFix {
  if (slotVerdict?.kind === "exhausted") {
    return {
      fix: { by: "fleet", sinceIso: null, words: "Every retry failed; its next scheduled run tries again." },
      why: "The run for its latest scheduled time failed, and so did every retry.",
    };
  }
  if (slotVerdict?.kind === "cooling" || slotVerdict?.kind === "retry") {
    return {
      fix: { by: "fleet", sinceIso: null, words: "Nobody needs to act yet; the scheduler retries it on its own." },
      why: "The run for its latest scheduled time failed.",
    };
  }
  if (latest?.outcome === "dead") {
    return STOPPED_PARTWAY;
  }
  return {
    fix: { by: "fleet", sinceIso: null, words: "That run is not retried; its next scheduled run tries again." },
    why: "The run for its latest scheduled time failed.",
  };
}

/**
 * Why, and who fixes it, for a row no hold stands on: what is on the owner first, then why it is not running.
 *
 * @param inputs the row's health, newest firings, slot verdict, resync state and silence, as its card read them
 * @returns the why sentence and the fix account
 */
export function unheldAccount(inputs: UnheldInputs): WhyAndFix {
  const onYou = onYouAccount({ resync: inputs.resync });
  if (onYou !== null) {
    return onYou;
  }
  const notRunning = notRunningAccount(inputs);
  if (notRunning !== null) {
    return notRunning;
  }
  return failedRunAccount({ latest: inputs.firings[0], slotVerdict: inputs.slotVerdict });
}
