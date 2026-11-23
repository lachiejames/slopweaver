/**
 * What `fleet resume` decides, apart from what it does: the order the other seats come back in, how a reseat
 * refusal becomes a fleet refusal, and how one attempt ends. The two lines it types live beside their reader, in
 * `../transcripts/fleetNudge.ts`.
 *
 * The order is the handover's: the console, then the supervisor, then — only once the supervisor has said it is
 * caught up — every other walled seat by its board row's priority band, the board's own p0 to p3 with a seat no row
 * names last. The pass never starts a seat that was not already running: recovery restores, it never invents work.
 *
 * Pure. The effects are `../cli/commands/fleet/resumeRun.ts`.
 */
import type { CmuxWorkspaceSummary } from "../cmux/client.js";
import { priorityIndex } from "../handover/rowKind.js";
import type { ReseatError } from "../sessions/reseatErrors.js";
import type { SeatWall } from "../sessions/seatRecovery.js";
import { type FleetAccountNames, type FleetRefusal, mapFleetRefusal } from "./refusals.js";
import type { SeatPriority } from "./types.js";

/**
 * The refusal for a seat that relaunched and still shows a wall. Any wall the detector names means the seat is not
 * back — a plan still at its usage limit as much as a signed-out store — so neither is ever journalled `reseated`.
 *
 * @param wall what the relaunched screen still showed
 * @param workspaceRef the seat's cmux workspace
 * @param alias the plan the relaunched session booted on, when known
 * @returns the refusal to journal
 */
export function stillWalledRefusal({
  wall,
  workspaceRef,
  alias,
}: {
  wall: SeatWall;
  workspaceRef: string;
  alias: string | undefined;
}): FleetRefusal & { readonly code: "SEAT_STILL_WALLED" | "SEAT_STILL_LIMITED" } {
  const named = alias === undefined ? {} : { alias };
  if (wall.kind === "limit-retrying") {
    return {
      code: "SEAT_STILL_LIMITED",
      message: `${workspaceRef} relaunched and its screen still waits on a usage limit`,
      workspaceRef,
      ...named,
    };
  }
  return {
    code: "SEAT_STILL_WALLED",
    message: `${workspaceRef} relaunched and its screen still reads "Not logged in"`,
    workspaceRef,
    ...named,
  };
}

/** One walled seat the pass will relaunch, with the row it runs. */
export interface FleetResumeTarget {
  readonly workspace: CmuxWorkspaceSummary;
  readonly priority: SeatPriority;
  readonly title: string;
}

/** A band's place in the order, `unassigned` after every board band. */
function bandRank({ priority }: { priority: SeatPriority }): number {
  if (priority === "unassigned") {
    return 4;
  }
  return priorityIndex({ priority });
}

/**
 * Order the walled seats the way the board ranks their rows.
 *
 * @param targets every walled seat but the supervisor and the pass's own tab
 * @returns them by priority band, then title, so two runs over one fleet agree
 */
export function orderResumeTargets({
  targets,
}: {
  targets: readonly FleetResumeTarget[];
}): readonly FleetResumeTarget[] {
  return targets.toSorted((left, right) => {
    const byBand = bandRank({ priority: left.priority }) - bandRank({ priority: right.priority });
    if (byBand !== 0) {
      return byBand;
    }
    return left.title.localeCompare(right.title);
  });
}

/**
 * One reseat refusal as the fleet journals it: the reseat's own code, its text kept for the fold.
 *
 * @param error what `cmux reseat`'s pass refused with
 * @param workspaceRef the seat it refused
 * @param alias the plan a credential refusal is about, when the pass knows it
 * @returns the refusal to journal
 */
export function fleetRefusalFromReseat({
  error,
  workspaceRef,
  alias,
}: {
  error: ReseatError;
  workspaceRef: string;
  alias: string | undefined;
}): FleetRefusal {
  const named = alias === undefined ? {} : { alias };
  if (error.code === "STORE_REFUSED") {
    return { code: error.code, message: error.message, storeRefusal: error.refusalKind, workspaceRef, ...named };
  }
  return { code: error.code, message: error.message, workspaceRef, ...named };
}

/** One configured plan's local credential state, read without a request. */
export interface FleetPlanCredential {
  readonly alias: string;
  readonly paused: boolean;
  /** A setup token file is present in its store, readable or not. */
  readonly hasToken: boolean;
  /** Its own store holds an access token. */
  readonly signedIn: boolean;
}

/**
 * The plan to ask the owner to sign in when routing could read no plan at all, or none.
 *
 * Routing refuses `unreadable-plan` both for a provider outage, which clears by itself, and for a fleet with no
 * credential left anywhere — MEASURED in a throwaway home whose two plans had no token and empty
 * stores, where the page said "usually clears by itself" over a lockout that never would. Only the second has a
 * hand step, so it is named only when EVERY plan in the fleet is visibly without a credential; one plan still
 * holding a token or a login means the gauges, not the logins, are what failed.
 *
 * @param plans every configured plan, in the register's order
 * @returns the first unpaused plan, when no unpaused plan has a token or a login; otherwise undefined
 */
export function signInWhenNothingRoutes({ plans }: { plans: readonly FleetPlanCredential[] }): string | undefined {
  const active = plans.filter((plan) => !plan.paused);
  if (active.some((plan) => plan.hasToken || plan.signedIn)) {
    return undefined;
  }
  return active[0]?.alias;
}

/**
 * Whether a seat's refusal stops the pass from touching any later worker: one raised AFTER that seat's stop, so the
 * relaunch path itself is failing and the next seat would be stopped into the same failure. A refusal
 * raised before the stop — a store, a model, a busy seat — is that seat's alone, and the others go on.
 *
 * A seat that relaunched and came back walled or limited halts the workers after it only when it is a WORKER: the
 * worker route chose that plan and would choose it again. The chair routes as a Fable seat, judged on its Fable window
 * the workers' all-models route never reads, so a chair still walled is the chair's alone — MEASURED on one episode, where a chair
 * held off the plans halted every worker four attempts running and the owner had to reseat them by hand.
 *
 * @param code the reseat refusal's code, or `SEAT_STILL_WALLED`/`SEAT_STILL_LIMITED` for a relaunch that came back
 *   on a sign-in wall or a usage limit
 * @param role whether the seat is the supervisor's
 * @returns true when every later worker must wait for the next attempt
 */
export function haltsLaterWorkers({
  code,
  role,
}: {
  code: ReseatError["code"] | "SEAT_STILL_WALLED" | "SEAT_STILL_LIMITED";
  role: "supervisor" | "worker";
}): boolean {
  if (code === "KILL_TIMEOUT" || code === "RELAUNCH_FAILED" || code === "UNCONFIRMED") {
    return true;
  }
  return role === "worker" && (code === "SEAT_STILL_WALLED" || code === "SEAT_STILL_LIMITED");
}

/** How one attempt ended. */
export type FleetAttemptOutcome = "healthy" | "hand-step" | "deferred" | "failed";

/**
 * How an attempt ended, from what it recorded.
 *
 * A refusal that offers the owner a button is a hand step, whatever else stands beside it, because that button is the
 * one thing that moves the fleet. A capacity hold or a supervisor still reading in is NOT YET rather than a
 * failure: nothing is broken, and the next attempt picks up where this one stopped.
 *
 * @param refusals every refusal the attempt recorded
 * @param deferred whether a hold or the reorientation wait stopped it early
 * @param accounts each plan's email, so the mapping that decides "is there a button" is the page's own
 * @returns the outcome
 */
export function attemptOutcome({
  refusals,
  deferred,
  accounts,
}: {
  refusals: readonly FleetRefusal[];
  deferred: boolean;
  accounts: FleetAccountNames;
}): FleetAttemptOutcome {
  const offersButton = refusals.some((refusal) => mapFleetRefusal({ accounts, refusal }).handStep !== undefined);
  if (offersButton) {
    return "hand-step";
  }
  if (refusals.some((refusal) => !NOT_YET_CODES.has(refusal.code))) {
    return "failed";
  }
  if (deferred || refusals.length > 0) {
    return "deferred";
  }
  return "healthy";
}

/**
 * The refusals that mean NOT YET — a prerequisite still in progress, which the next attempt picks up unchanged — or,
 * for a crash loop, a seat deliberately left for the supervisor to investigate, which is handled rather than failed. A
 * seat relaunched FRESH (`SEAT_NOT_RESUMED`) is handled the same way: `session close-done` re-seats an idle seat with
 * no pickup from its row, so the attempt is not healthy and nothing in it failed. A seat another reseat already holds
 * (`RESEAT_CONTENDED`) is that other reseat's to finish, and the next attempt reads whatever it left; so is a seat whose
 * wall had cleared by the time its lock was held (`WALL_CLEARED`).
 */
const NOT_YET_CODES: ReadonlySet<FleetRefusal["code"]> = new Set([
  "HELD",
  "RESEAT_CONTENDED",
  "WALL_CLEARED",
  "CHAIR_REORIENTATION_TIMEOUT",
  "CRASH_LOOP",
  "SEAT_NOT_RESUMED",
]);

/**
 * What the pass does with a seat it keeps relaunching (`./crashLoop.ts`). A worker is held and investigated; the
 * supervisor is relaunched regardless, because holding it would stop every other seat, and is told the same thing
 * about itself once it is back.
 */
export type CrashLoopAction =
  | { readonly kind: "hold-worker"; readonly refusal: FleetRefusal; readonly investigationLine: string }
  | { readonly kind: "reseat-chair"; readonly refusal: FleetRefusal; readonly investigationLine: string };

/**
 * The refusal and the supervisor's instruction for one looping seat.
 *
 * @param reseats how many attempts inside the window relaunched it
 * @param role whether the seat is the supervisor's
 * @param title the board row it runs, or its workspace ref when no row names it
 * @param workspaceRef the seat
 * @returns the hold for a worker, the advisory for the supervisor
 */
export function crashLoopAction({
  reseats,
  role,
  title,
  workspaceRef,
}: {
  reseats: number;
  role: "supervisor" | "worker";
  title: string;
  workspaceRef: string;
}): CrashLoopAction {
  const history = `relaunched ${String(reseats)} times in the last hour and walled again each time`;
  if (role === "supervisor") {
    return {
      investigationLine:
        `You (${workspaceRef}) have been ${history}; you were relaunched anyway, because every other seat waits on you. ` +
        "Find out why this seat keeps falling over after recovery brings it back, and fix the cause.",
      kind: "reseat-chair",
      refusal: {
        code: "CRASH_LOOP",
        message: `the supervisor (${workspaceRef}) was ${history}; it was relaunched rather than held, and asked to investigate`,
        workspaceRef,
      },
    };
  }
  return {
    investigationLine:
      `Recovery held ${workspaceRef} (${title}) instead of relaunching it again: it was ${history}. ` +
      "Investigate why it falls over after being brought back, fix the cause, and reseat it yourself once fixed — recovery will not.",
    kind: "hold-worker",
    refusal: {
      code: "CRASH_LOOP",
      message: `${workspaceRef} (${title}) was ${history}, so it was held and the supervisor asked to investigate`,
      workspaceRef,
    },
  };
}
