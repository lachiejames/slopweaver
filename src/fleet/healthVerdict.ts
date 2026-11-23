/**
 * The fleet's one-word state and its headline, from the seats `./judge.ts` coloured.
 *
 * ## Four states
 *
 * - `down` — the console is not serving (down, or not measurable), or a seat that is not an empty slot is red, with no attempt running. The one
 *   state the desktop answers with a recovery attempt.
 * - `recovering` — an attempt is running, or a seat is yellow.
 * - `degraded` — the only red seats are ones recovery HELD because they kept falling over after being brought back
 *   (`./crashLoop.ts`). Stable, visibly impaired, and already handed to the supervisor, so the desktop launches
 *   nothing more for it (the owner does not want to be on the hook for dealing with it). Any OTHER red
 *   seat still makes the fleet `down`, so a dead fleet can never hide behind one held seat.
 * - `healthy` — none of the above.
 *
 * A hung cmux decides first: while `cmux revive` waits out its bound or restarts the app the fleet is `recovering`,
 * and only once restarts are held is it `down` — no seat's colour means anything while nothing can reach a seat.
 * A hang that came back within the hour after a restart is `degraded` instead (`CMUX_RECURRING`, naming how soon),
 * while it is open, while its restart runs, and for the hour after that restart unless something worse is true.
 *
 * Empty slots are red so the capacity line reads true, and never make the fleet down: recovery restores what was
 * running and never invents work.
 *
 * Pure: values in, a verdict out.
 */
import type { CmuxFleetState } from "../cmux/hang.js";
import type { CmuxFleetRecurrence } from "../cmux/recurrence.js";
import { headlineReason } from "./headlineReason.js";
import type { FleetAttemptFold } from "./journal.js";
import { type FleetAccountNames, type FleetRefusal, mapFleetRefusal } from "./refusals.js";
import type { FleetHealthDocument, FleetReason, FleetSeat } from "./types.js";

type ConsoleState = FleetHealthDocument["console"]["state"];

/** The state, the headline and the fold. */
export interface FleetHealthVerdict {
  readonly state: FleetHealthDocument["state"];
  readonly reason: FleetReason;
  readonly unmapped: readonly string[];
}

/** Every refusal the newest attempt recorded, its own finish line last. */
function attemptRefusals({ attempt }: { attempt: FleetAttemptFold | undefined }): readonly FleetRefusal[] {
  if (attempt === undefined) {
    return [];
  }
  const refusals: FleetRefusal[] = [];
  for (const phase of attempt.seats.values()) {
    if (phase.refusal !== undefined) {
      refusals.push(phase.refusal);
    }
  }
  if (attempt.finished?.refusal !== undefined) {
    refusals.push(attempt.finished.refusal);
  }
  return refusals;
}

/** One refusal no mapping names, as the fold shows it: its producer's own code, then its text. */
function unmappedLine({ refusal }: { refusal: FleetRefusal }): string {
  if (refusal.originalCode === undefined) {
    return refusal.message;
  }
  return `${refusal.originalCode}: ${refusal.message}`;
}

/** The headline when no refusal names one. */
function plainReason({
  state,
  downSeats,
  running,
  consoleState,
}: {
  state: FleetHealthDocument["state"];
  downSeats: number;
  running: boolean;
  consoleState: ConsoleState;
}): FleetReason {
  if (state === "healthy") {
    return {
      code: "HEALTHY",
      detail: "Every seat is up and the supervisor is caught up.",
      headline: "The fleet is running.",
    };
  }
  if (running) {
    return {
      code: "RECOVERING",
      detail:
        "The supervisor comes back first and reads the picture in; then every other seat, highest priority first.",
      headline: "Recovering the fleet.",
    };
  }
  if (state === "degraded") {
    return {
      code: "DEGRADED",
      detail: "Recovery stopped restarting a seat that kept falling over, and the supervisor is finding out why.",
      headline: "The fleet is running, less one seat being investigated.",
    };
  }
  if (state === "recovering") {
    return {
      code: "SETTLING",
      detail: "Nothing is down. A seat is still settling, or the supervisor has not said it is caught up.",
      headline: "The fleet is up and settling.",
    };
  }
  if (downSeats === 0 && consoleState !== "serving") {
    return {
      code: "CONSOLE_DOWN",
      detail: "Recovery starts by itself, and the console is its first step.",
      headline: consoleState === "down" ? "The console is down." : "The console could not be checked.",
    };
  }
  return {
    code: "FLEET_DOWN",
    detail: "Recovery starts by itself: the console, then the supervisor, then every other seat by priority.",
    headline: `${String(downSeats)} ${downSeats === 1 ? "seat is" : "seats are"} down.`,
  };
}

/** An instant as `HH:MM` UTC, the way the page's other lines name a time. */
function clockOf({ iso }: { iso: string }): string {
  return `${iso.slice(11, 16)}Z`;
}

/**
 * The verdict a hung cmux forces, or `undefined` when cmux is answering or was not measured. While it hangs no seat
 * can be read, reseated or reached, so every seat's own colour is stale: the fleet is recovering while the revive
 * waits out its bound or restarts the app, and down only once restarts are held.
 *
 * @param cmux cmux as `cmux revive` last heard it
 * @returns the verdict, or `undefined`
 */
function cmuxVerdict({ cmux }: { cmux: CmuxFleetState }): FleetHealthVerdict | undefined {
  const active = cmux.kind === "restarting" || (cmux.kind === "unresponsive" && !cmux.held);
  if (active && cmux.recurring !== undefined) {
    return recurringVerdict({
      detail:
        "The fleet restarts it this once more. If it hangs again within the hour, restarts are held and the supervisor investigates why.",
      recurring: cmux.recurring,
    });
  }
  if (cmux.kind === "restarting") {
    return {
      reason: {
        code: "CMUX_RESTARTING",
        detail: "Every seat comes back once it answers: the supervisor first, then the rest by priority.",
        headline: `cmux stopped answering, so the fleet is restarting it (since ${clockOf({ iso: cmux.sinceIso })}).`,
      },
      state: "recovering",
      unmapped: [],
    };
  }
  if (cmux.kind !== "unresponsive") {
    return undefined;
  }
  if (cmux.held) {
    return {
      reason: {
        code: "CMUX_HUNG_HELD",
        detail: "It hung again after the fleet restarted it, so restarts are held and the supervisor investigates why.",
        headline: `cmux has not answered since ${clockOf({ iso: cmux.sinceIso })}.`,
      },
      state: "down",
      unmapped: [],
    };
  }
  return {
    reason: {
      code: "CMUX_UNRESPONSIVE",
      detail:
        "If it has not answered ten minutes after it stopped, the fleet quits and reopens it, then brings every seat back.",
      headline: `cmux stopped answering at ${clockOf({ iso: cmux.sinceIso })}.`,
    },
    state: "recovering",
    unmapped: [],
  };
}

/** A cmux hang that came back after a restart, as one degraded verdict naming how soon. */
function recurringVerdict({
  recurring,
  detail,
}: {
  recurring: CmuxFleetRecurrence;
  detail: string;
}): FleetHealthVerdict {
  const minutes = Math.round(recurring.intervalMs / 60_000);
  return {
    reason: {
      code: "CMUX_RECURRING",
      detail,
      headline: `cmux hung again ${String(minutes)} ${minutes === 1 ? "minute" : "minutes"} after the fleet restarted it at ${clockOf({ iso: recurring.afterRestartIso })}.`,
    },
    state: "degraded",
    unmapped: [],
  };
}

/**
 * Judge the fleet's state and headline.
 *
 * @param accounts each plan's email, for a sign-in headline
 * @param attempt the newest recovery attempt
 * @param attemptRunning whether that attempt is still running
 * @param cmux cmux as `cmux revive` last heard it from outside — a hang decides the verdict before any seat does
 * @param consoleState the console's state — recovery's first step, so anything but serving is down even with every seat
 *   green: a console health could not measure is never a healthy one
 * @param heldSeatIds the seats recovery held as crash loops
 * @param seats every seat, empty slots included
 * @returns the verdict
 */
export function fleetHealthVerdict({
  accounts,
  attempt,
  attemptRunning,
  cmux,
  consoleState,
  heldSeatIds,
  seats,
}: {
  accounts: FleetAccountNames;
  attempt: FleetAttemptFold | undefined;
  attemptRunning: boolean;
  cmux: CmuxFleetState;
  consoleState: ConsoleState;
  heldSeatIds: ReadonlySet<string>;
  seats: readonly FleetSeat[];
}): FleetHealthVerdict {
  const hung = cmuxVerdict({ cmux });
  if (hung !== undefined) {
    return hung;
  }
  const red = seats.filter((seat) => seat.colour === "red" && seat.role !== "empty");
  const down = red.filter((seat) => !heldSeatIds.has(seat.seatId)).length;
  let state: FleetHealthDocument["state"] = "healthy";
  if (attemptRunning) {
    state = "recovering";
  } else if (consoleState !== "serving" || down > 0) {
    state = "down";
  } else if (red.length > 0) {
    state = "degraded";
  } else if (seats.some((seat) => seat.colour === "yellow")) {
    state = "recovering";
  }
  const refusals = state === "healthy" ? [] : attemptRefusals({ attempt });
  const headline = headlineReason({ reasons: refusals.map((refusal) => mapFleetRefusal({ accounts, refusal })) });
  const unmapped = refusals.filter((refusal) => refusal.code === "UNKNOWN").map((refusal) => unmappedLine({ refusal }));
  if (headline !== undefined) {
    return { reason: headline, state, unmapped };
  }
  if (state === "healthy" && cmux.recurring !== undefined) {
    // A floor, never a mask: the hour after a loop's restart reads degraded only when nothing worse is true.
    return recurringVerdict({
      detail:
        "It answers again. If it hangs once more within the hour, restarts are held and the supervisor investigates why.",
      recurring: cmux.recurring,
    });
  }
  return { reason: plainReason({ consoleState, downSeats: down, running: attemptRunning, state }), state, unmapped };
}

/**
 * The attempt fields of the document: the newest attempt that started, the running attempt's phase, and the newest
 * finished attempt's outcome.
 *
 * @param attempt the attempt the journal last recorded
 * @param attemptRunning whether that attempt's own pass is still running
 * @returns `newestAttempt` whenever an attempt was recorded, `recovery` and `lastAttempt` each only when it applies
 */
export function attemptFields({
  attempt,
  attemptRunning,
}: {
  attempt: FleetAttemptFold | undefined;
  attemptRunning: boolean;
}): Pick<FleetHealthDocument, "recovery" | "lastAttempt" | "newestAttempt"> {
  if (attempt === undefined) {
    return {};
  }
  return {
    newestAttempt: {
      attemptId: attempt.attemptId,
      episodeId: attempt.episodeId,
      finished: attempt.finished !== undefined,
    },
    ...(attemptRunning
      ? {
          recovery: {
            attemptId: attempt.attemptId,
            phase: recoveryPhase({ attempt }),
            startedAtIso: attempt.startedAtIso,
          },
        }
      : {}),
    ...(attempt.finished === undefined
      ? {}
      : {
          lastAttempt: {
            attemptId: attempt.attemptId,
            episodeId: attempt.episodeId,
            outcome: attempt.finished.outcome,
          },
        }),
  };
}

/**
 * Where a running attempt is, in one phrase.
 *
 * @param attempt the running attempt
 * @returns the phase, as the capacity line shows it
 */
export function recoveryPhase({ attempt }: { attempt: FleetAttemptFold }): string {
  if (attempt.chair.kind === "awaiting") {
    return "waiting for the supervisor to say it is caught up";
  }
  if (attempt.chair.kind === "reoriented") {
    return "resuming the other seats by priority";
  }
  if (attempt.console === undefined) {
    return "bringing the console back";
  }
  return "bringing the supervisor back";
}
