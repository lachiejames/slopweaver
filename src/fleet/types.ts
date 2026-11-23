/**
 * The fleet's health contract: what `slopweaver fleet health --json` prints and the desktop app renders as its
 * sessions page, with the app's own bridge failures as the one input it adds itself.
 *
 * ## Three colours, and what each one promises
 *
 * Red is down: no live session, a seat walled behind a sign-in, a refused recovery, or an empty slot. Flashing
 * yellow is a recovery attempt underway on that seat with no outcome yet. Steady yellow is a live seat whose boot
 * credential could not be read, so it is neither proven healthy nor proven down. Green is the seat's OWN health
 * signal passing — and for the supervisor that signal is its reorientation or a sweep it closed since it took the
 * seat, never its process existing (`./chairSeat.ts`).
 *
 * ## No secret is representable
 *
 * Every field here is an identity the owner may read: a plan alias, a bound email, a session id, a board row. A token, a
 * store path's contents, an organisation id — none of them has a field, so none of them can reach the page.
 *
 * Pure types. No I/O.
 */
import type { BoardPriority } from "../handover/rowKind.js";

/**
 * One seat's colour on the sessions page.
 *
 * @internal
 */
export type SeatColour = "red" | "yellow" | "green";

/**
 * What a seat is for. `empty` pads the page to the configured capacity.
 *
 * @internal
 */
export type SeatRole = "supervisor" | "loop" | "keep-alive" | "worker" | "empty";

/** A seat's priority band: its board row's, or `unassigned` when no board row names it. */
export type SeatPriority = BoardPriority | "unassigned";

/** One seat on the sessions page. */
export interface FleetSeat {
  /** Stable within one reading: the session id, a standing service's name, or `slot-<n>`. */
  readonly seatId: string;
  readonly role: SeatRole;
  readonly colour: SeatColour;
  /** True only while a recovery attempt is underway on this seat. */
  readonly flashing: boolean;
  readonly priority: SeatPriority;
  /** The board row it runs, when one names it. */
  readonly rowId?: string;
  /** What it runs, in one line. */
  readonly rowTitle: string;
  readonly sessionId?: string;
  /** Why it has this colour, in plain words. */
  readonly detail: string;
  /** Present only on a seat recovery held as a crash loop and handed to the supervisor: no attempt moves it. */
  readonly held?: true;
  /**
   * Present only on the supervisor's seat while its own session's process runs with no login wall read, whatever its
   * colour or whether its plan could be read, or while a Codex process holds a Codex chair's thread: a chair that has not said it is caught up is still running. The desktop never asks the owner to press recovery
   * over it — the chair is the fleet's recovery while it runs.
   */
  readonly live?: true;
  /**
   * The supervisor's newest sign that it is working — it said it is caught up, or it closed a sweep — and when, so
   * the page can say what was last seen and what has not arrived since. Present only on the supervisor's seat, and
   * only once one was ever seen; a sign from before it took the seat is still named, never counted.
   */
  readonly lastSignal?: FleetChairSignal;
  /**
   * When a sign of working has been expected from: the later of the supervisor's process starting and its taking the
   * seat. Present only on a live supervisor whose plan reads, so the page can name what has not arrived since when.
   */
  readonly signalExpectedSinceIso?: string;
}

/** One sign the supervisor gave that it is working. */
export interface FleetChairSignal {
  readonly kind: "reoriented" | "swept";
  readonly atIso: string;
}

/**
 * What the one button does. A closed set the desktop maps to a FIXED command, so nothing a refusal printed is ever
 * typed into a terminal.
 *
 * @internal
 */
export type FleetHandAction =
  /** Run `slopweaver claude signin --plan <alias>` in a visible cmux tab. */
  | { readonly kind: "claude-signin"; readonly alias: string; readonly email: string | undefined }
  /** Re-run `fleet resume` with one named escape hatch set, for a gate whose override is the owner's to give. */
  | { readonly kind: "policy-override"; readonly hatch: FleetResumeHatch }
  /** Open System Settings › Privacy & Security › Automation. */
  | { readonly kind: "automation-consent" }
  /** Open cmux, then continue the same attempt. */
  | { readonly kind: "open-cmux" };

/**
 * The escape hatches a hand step may set on a resume — the two gates the lockout path can refuse on.
 *
 * @internal
 */
export type FleetResumeHatch = "ALLOW_FABLE_OVERRIDE" | "SLOPWEAVER_ALLOW_SPENT_PLAN";

/** The one step only the owner can take, with the note the floating window shows. */
export interface FleetHandStep {
  /** Stable for one cause, so the note re-shows only when the cause changes. */
  readonly id: string;
  readonly label: string;
  readonly note: string;
  readonly action: FleetHandAction;
}

/** The headline, in plain words, and what sits under the fold. */
export interface FleetReason {
  readonly code: string;
  readonly headline: string;
  readonly detail: string;
  /** The producer's own text, shown only under a fold — never the headline. */
  readonly raw?: string;
  readonly handStep?: FleetHandStep;
}

/** The whole fleet, at one instant. */
export interface FleetHealthDocument {
  readonly schemaVersion: 1;
  readonly observedAtIso: string;
  /**
   * `degraded`: the only red seats are crash loops recovery held for the supervisor, or cmux hung again within the
   * hour after a restart (`./healthVerdict.ts`).
   */
  readonly state: "healthy" | "recovering" | "degraded" | "down";
  readonly capacity: { readonly online: number; readonly configured: number };
  readonly console: { readonly state: "serving" | "down" | "unmeasured"; readonly port?: number };
  readonly seats: readonly FleetSeat[];
  readonly reason: FleetReason;
  /** Every refusal this reading could not map, raw, for the fold. Never a headline. */
  readonly unmapped: readonly string[];
  /** The recovery attempt the journal last recorded, when one is open. */
  readonly recovery?: {
    readonly attemptId: string;
    readonly phase: string;
    readonly startedAtIso: string;
  };
  /**
   * How the newest FINISHED attempt ended, and the episode it ran for — what lets the desktop continue an episode
   * whose attempt deferred (a slow supervisor, a capacity hold) instead of waiting forever on one spent launch. The
   * attempt id is what lets it continue each deferral exactly once.
   */
  readonly lastAttempt?: {
    readonly attemptId: string;
    readonly episodeId: string;
    readonly outcome: "healthy" | "hand-step" | "deferred" | "failed";
  };
  /**
   * The newest attempt the journal records as STARTED, finished or not. `lastAttempt` is finished-only, so its absence
   * never proves no attempt began: one may have started and died unfinished. The desktop's note reads this before
   * it says what recovery did.
   */
  readonly newestAttempt?: {
    readonly attemptId: string;
    readonly episodeId: string;
    readonly finished: boolean;
  };
}
