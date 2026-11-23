/**
 * One seat's relaunch inside a recovery pass: read every screen's wall once, relaunch a walled seat through `cmux
 * reseat`'s own pass, and watch its screen briefly afterwards — a store that is signed out walls it again within
 * seconds, and that is recorded as `SEAT_STILL_WALLED` with the plan it came back on.
 *
 * A COLD seat — a reopened bare shell with a saved session, cmux's own restore switched off — goes through the
 * reseat pass's cold arm instead (`coldResumeWorkspace`), and is watched for a wall afterwards exactly the same way. A
 * refused cold relaunch halts no later worker, since nothing was stopped (`refusalHalts`); a cold WORKER that relaunched
 * and came back still walled or limited halts them like any worker, since the route chose that plan and would again.
 *
 * A seat whose session never took a prompt has no transcript, so the reseat relaunches it FRESH (`fresh-seated`);
 * that is journalled as the not-yet refusal `SEAT_NOT_RESUMED`, never `reseated`, so health never reads an empty
 * composer as a recovered seat and the worker nudge is never typed into it.
 *
 * Journalled BEFORE and AFTER it acts, because the desktop learns what this pass is doing only from the journal.
 * Everything between those two lines runs under the workspace's reseat lock, so a hand `cmux reseat` of the same tab
 * is refused `RESEAT_CONTENDED` rather than stopping the session this pass just booted (`../cmux/reseatOperation.ts`).
 */
import type { Result } from "#lib/result.js";

import type { ClaudeAccount } from "../../../claude/contracts.js";
import type { CmuxWorkspaceSummary } from "../../../cmux/client.js";
import type { CmuxError } from "../../../cmux/errors.js";
import { fleetRefusalFromReseat, haltsLaterWorkers, stillWalledRefusal } from "../../../fleet/resumePlan.js";
import { type WallRecheckVerdict, wallRecheckVerdict } from "../../../fleet/wallRecheck.js";
import type { CmuxHostSurface } from "../../../sessionHarness/cmuxHost.js";
import type { ReseatWall } from "../../../sessions/reseat.js";
import { type ReseatError, ReseatErrors } from "../../../sessions/reseatErrors.js";
import { type ReseatOutcome, renderReseatOutcome } from "../../../sessions/reseatOutcome.js";
import type { SeatWall } from "../../../sessions/seatRecovery.js";
import { withReseatLock } from "../cmux/reseatOperation.js";
import { type ReseatDeps, reseatWallOf, reseatWorkspaceHeld } from "../cmux/reseatPass.js";
import { coldResumeWorkspace } from "../cmux/reseatRelaunch.js";
import { bootAliasOf } from "./resumeEvidence.js";
import { journal, nowIso, type PassState, refuseSeat } from "./resumePassState.js";

/**
 * How a seat comes back: a WALLED one (or a live one with no wall, the chair) has a live session to stop and
 * relaunch; a COLD one is a bare shell, resumed on its saved session — the pin's for the chair.
 */
export type ResumeEntry =
  | { readonly kind: "walled"; readonly wall: ReseatWall | undefined }
  | { readonly kind: "cold"; readonly pinnedSessionId: string | undefined };

/** How long a relaunched seat's screen is watched for a wall before it counts as through. */
const WALL_RECHECK_POLLS = 15;

/**
 * Every workspace's wall, read once — its screen's banner, else a session booted on no configured plan, which the
 * prompt hook refuses while the screen looks idle; a screen that will not read is left alone, never guessed at.
 *
 * @param deps the reseat deps, whose cmux client reads each screen and whose boot read judges each session
 * @param workspaces every workspace cmux lists
 * @returns each walled workspace's wall, keyed by workspace id
 */
export async function readWalls({
  deps,
  workspaces,
}: {
  deps: ReseatDeps;
  workspaces: readonly CmuxWorkspaceSummary[];
}): Promise<ReadonlyMap<string, ReseatWall>> {
  const walls = new Map<string, ReseatWall>();
  for (const workspace of workspaces) {
    const screen = await deps.client.readScreen({ target: { workspaceId: workspace.workspaceId } });
    if (screen.isErr()) {
      continue;
    }
    const wall = await reseatWallOf({ deps, screen: screen.value, workspace });
    if (wall !== undefined) {
      walls.set(workspace.workspaceId, wall);
    }
  }
  return walls;
}

/**
 * Watch a relaunched seat's screen briefly: the wall a signed-out store raises shows within seconds, and so does a
 * ANY wall the detector names means the seat is not back, and a
 * last read that failed means nobody knows (`../../../fleet/wallRecheck.ts`).
 */
async function recheckWall({
  client,
  pause,
  workspaceId,
}: {
  client: Pick<CmuxHostSurface, "readScreen">;
  pause: () => Promise<void>;
  workspaceId: string;
}): Promise<WallRecheckVerdict> {
  const readings: Result<string, CmuxError>[] = [];
  for (let poll = 0; poll < WALL_RECHECK_POLLS; poll += 1) {
    await pause();
    readings.push(await client.readScreen({ target: { workspaceId } }));
    const verdict = wallRecheckVerdict({ readings });
    if (verdict.kind === "walled") {
      return verdict;
    }
  }
  return wallRecheckVerdict({ readings });
}

/**
 * One reseat, journalled: recovering first, then what came of it.
 *
 * @param state the pass to record on
 * @param deps the guarded reseat deps
 * @param client the open cmux client, for the wall re-check
 * @param accounts the plan register, to name the plan a still-walled seat came back on
 * @param signedOut each workspace the guard refused, with the plan it named
 * @param workspace the seat
 * @param entry whether it is walled, and by what, or cold
 * @param role whether the seat is the supervisor's
 * @param sessionId its Claude session, when known before the reseat
 * @returns what the reseat did — `reseated` only for a seat that is back and through its wall
 */
export async function resumeSeat({
  state,
  deps,
  client,
  accounts,
  signedOut,
  workspace,
  entry,
  role,
  sessionId,
}: {
  state: PassState;
  deps: ReseatDeps;
  client: CmuxHostSurface;
  accounts: readonly ClaudeAccount[];
  signedOut: ReadonlyMap<string, string>;
  workspace: CmuxWorkspaceSummary;
  entry: ResumeEntry;
  role: "supervisor" | "worker";
  sessionId: string | undefined;
}): Promise<ReseatOutcome> {
  const seat = { role, state, workspaceRef: workspace.workspaceRef };
  await journalSeat({ ...seat, phase: "recovering", sessionId });
  const refuse = async (outcome: Extract<ReseatOutcome, { readonly kind: "refused" }>): Promise<ReseatOutcome> => {
    const alias = signedOut.get(workspace.workspaceId);
    await refuseSeat({
      refusal: fleetRefusalFromReseat({ alias, error: outcome.error, workspaceRef: workspace.workspaceRef }),
      role,
      sessionId,
      state,
    });
    if (refusalHalts({ entry, error: outcome.error, role })) {
      state.deferred = true;
    }
    return outcome;
  };
  // One lock across the relaunch, the wall re-check and the journal line: no second reseat reads this seat until
  // this one has judged it (`../cmux/reseatOperation.ts`).
  const held = await withReseatLock({
    body: async () => {
      const outcome = await relaunchEntry({ deps, entry, workspace });
      if (outcome.kind === "refused") {
        return refuse(outcome);
      }
      return settleRelaunched({ accounts, client, outcome, pause: deps.pause, seat });
    },
    deps,
    workspace,
  });
  if (held.isErr()) {
    return refuse({ error: held.error, kind: "refused", workspaceRef: workspace.workspaceRef });
  }
  return held.value;
}

/**
 * What a relaunch that was not refused comes to: a dry run as it stands, a fresh boot as the not-yet
 * `SEAT_NOT_RESUMED`, a resumed seat once its wall re-check is read.
 *
 * @param pause one poll interval of the wall re-check
 * @param seat the seat's pass, role and workspace ref
 * @returns the outcome as journalled
 */
async function settleRelaunched({
  accounts,
  client,
  outcome,
  pause,
  seat,
}: {
  accounts: readonly ClaudeAccount[];
  client: CmuxHostSurface;
  outcome: Exclude<ReseatOutcome, { readonly kind: "refused" }>;
  pause: () => Promise<void>;
  seat: { readonly role: "supervisor" | "worker"; readonly state: PassState; readonly workspaceRef: string };
}): Promise<ReseatOutcome> {
  const { role, state, workspaceRef } = seat;
  if (outcome.kind === "would-reseat") {
    return outcome;
  }
  if (outcome.kind === "fresh-seated") {
    // Never `reseated`: nothing the seat was doing came back, and no later worker waits on it.
    await refuseSeat({
      refusal: {
        code: "SEAT_NOT_RESUMED",
        message: renderReseatOutcome({ outcome }),
        workspaceRef,
      },
      role,
      sessionId: outcome.freshSessionId,
      state,
    });
    return outcome;
  }
  return verifyReseatedSeat({ accounts, client, outcome, pause, seat });
}

/**
 * A seat that relaunched on its own session id: watch its screen for a wall, and journal it reseated only once the
 * last read came back clear. A watch whose last read failed is refused `CMUX_READ_FAILED`, halting nobody: the seat
 * runs, and only whether it is through its wall is unknown.
 *
 * @param pause one poll interval of the watch
 * @param seat the seat's pass, role and workspace ref
 * @returns the outcome as it stands, or the still-walled or unreadable refusal
 */
async function verifyReseatedSeat({
  accounts,
  client,
  outcome,
  pause,
  seat,
}: {
  accounts: readonly ClaudeAccount[];
  client: CmuxHostSurface;
  outcome: Extract<ReseatOutcome, { readonly kind: "reseated" }>;
  pause: () => Promise<void>;
  seat: { readonly role: "supervisor" | "worker"; readonly state: PassState; readonly workspaceRef: string };
}): Promise<ReseatOutcome> {
  const relaunched = outcome.plan.sessionId;
  const after = await recheckWall({ client, pause, workspaceId: outcome.plan.workspace.workspaceId });
  if (after.kind === "walled") {
    return refuseStillWalled({
      alias: bootAliasOf({ accounts, sessionId: relaunched }),
      ...seat,
      sessionId: relaunched,
      wall: after.wall,
    });
  }
  if (after.kind === "unreadable") {
    const error = ReseatErrors.cmuxReadFailed({
      cause: after.cause,
      what: `${seat.workspaceRef}'s screen after relaunch`,
    });
    await refuseSeat({
      refusal: fleetRefusalFromReseat({ alias: undefined, error, workspaceRef: seat.workspaceRef }),
      role: seat.role,
      sessionId: relaunched,
      state: seat.state,
    });
    return { error, kind: "refused", workspaceRef: seat.workspaceRef };
  }
  seat.state.lines.push(`${seat.workspaceRef}\treseated — ${outcome.seat}`);
  await journalSeat({ ...seat, phase: "reseated", sessionId: relaunched });
  return outcome;
}

/**
 * Whether a refused relaunch halts every later worker. A refusal halts only where `haltsLaterWorkers` says so AND the
 * seat was walled: a walled relaunch stops the old session first, so a stop that timed out or a relaunch that failed
 * after it means the next would be stopped into the same failure.
 * A COLD seat stops nothing — a failed send into its bare shell is that seat's alone — and neither does
 * a walled relaunch whose line could not even be composed, refused before its stop.
 *
 * @param error the reseat refusal
 * @param entry whether the seat was walled or cold
 * @param role whether the seat is the supervisor's
 * @returns true when every later worker must wait for the next attempt
 */
export function refusalHalts({
  error,
  entry,
  role,
}: {
  error: ReseatError;
  entry: ResumeEntry;
  role: "supervisor" | "worker";
}): boolean {
  if (entry.kind !== "walled") {
    return false;
  }
  if (error.code === "RELAUNCH_FAILED" && !error.afterStop) {
    return false;
  }
  return haltsLaterWorkers({ code: error.code, role });
}

/** Relaunch one seat through the reseat pass's arm for its entry, under the reseat lock its caller holds. */
async function relaunchEntry({
  deps,
  entry,
  workspace,
}: {
  deps: ReseatDeps;
  entry: ResumeEntry;
  workspace: CmuxWorkspaceSummary;
}): Promise<ReseatOutcome> {
  if (entry.kind === "cold") {
    return coldResumeWorkspace({ deps, pinnedSessionId: entry.pinnedSessionId, workspace });
  }
  return reseatWorkspaceHeld({ deps, wall: entry.wall, workspace });
}

/**
 * Journal one seat's phase.
 *
 * @param state the pass whose journal takes the line
 * @param phase where the seat is in its recovery
 * @param role whether the seat is the supervisor's
 * @param workspaceRef the seat's cmux workspace
 * @param sessionId its Claude session, when known
 */
async function journalSeat({
  state,
  phase,
  role,
  workspaceRef,
  sessionId,
}: {
  state: PassState;
  phase: "recovering" | "reseated";
  role: "supervisor" | "worker";
  workspaceRef: string;
  sessionId: string | undefined;
}): Promise<void> {
  await journal({
    event: {
      atIso: nowIso(),
      attemptId: state.attemptId,
      kind: "seat",
      phase,
      role,
      schemaVersion: 1,
      workspaceRef,
      ...(sessionId === undefined ? {} : { sessionId }),
    },
    state,
  });
}

/**
 * Refuse a seat that relaunched and still shows a wall — the sign-in one, or a usage limit — halting later workers when it
 * is a worker (`haltsLaterWorkers`).
 *
 * @param state the pass to record on
 * @param alias the plan the relaunched session booted on, when known
 * @param role whether the seat is the supervisor's
 * @param workspaceRef the seat's cmux workspace
 * @param sessionId the relaunched Claude session
 * @param wall what its screen still showed
 * @returns the refused outcome
 */
async function refuseStillWalled({
  state,
  alias,
  role,
  workspaceRef,
  sessionId,
  wall,
}: {
  state: PassState;
  alias: string | undefined;
  role: "supervisor" | "worker";
  workspaceRef: string;
  sessionId: string;
  wall: SeatWall;
}): Promise<ReseatOutcome> {
  const refusal = stillWalledRefusal({ alias, wall, workspaceRef });
  await refuseSeat({ refusal, role, sessionId, state });
  if (haltsLaterWorkers({ code: refusal.code, role })) {
    state.deferred = true;
  }
  return {
    error: ReseatErrors.unconfirmed({ seconds: WALL_RECHECK_POLLS, sessionId, workspaceRef }),
    kind: "refused",
    workspaceRef,
  };
}
