/**
 * The recovery pass behind `slopweaver fleet resume`: the console, then the supervisor — relaunched if walled, resumed
 * on its pin if cold, and asked to catch up — then every other walled or cold seat by its board row's priority, and
 * only THEN a bounded wait for the supervisor's own line saying it is caught up.
 *
 * ## Nothing about the chair holds a worker
 *
 * MEASURED in one episode: their one press of the start-recovery note ran four attempts, every one
 * ending deferred with no worker touched, and they reseated the fleet by hand. Three things held it, and none does now.
 * The chair was booted on no configured plan, so the prompt hook refused every nudge while its screen looked idle —
 * an off-plan boot is now a wall (`../cmux/reseatPass.ts` `reseatWallOf`) and the chair is relaunched. Every
 * worker waited on the chair's reoriented line — the workers now run before that wait (`./resumeWorkers.ts`), and a
 * chair with no pin, no tab or no live session is recorded and passed over. And each worker waited on the
 * whole-machine capacity HOLD, which the pass's own boots tripped — a reseat now paces on boots in flight only, and
 * never holds (`../cmux/reseatPass.ts` § The capacity HOLD never holds a reseat).
 *
 * ## Runs in a tab they can see, and only there
 *
 * cmux refuses every client it did not start (measured), so this pass runs in a cmux terminal tab: the
 * desktop app opens one and types the command, or they do. Every seat it relaunches is relaunched in its own
 * existing, visible workspace by `cmux reseat`'s own pass (`../cmux/reseatPass.ts`) — the same plan, the same
 * routing gate, the same stop-then-type order — so rule 2 holds by construction: nothing here starts a session they
 * cannot see.
 *
 * ## The journal is how the page sees it
 *
 * Every step is journalled to the store's recovery journal BEFORE and AFTER it acts, because the desktop cannot read
 * cmux and learns what this pass is doing only from that journal, through `fleet health` (`../../../fleet/journal.ts`).
 *
 * ## One credential check the reseat does not make
 *
 * A plan with no setup token boots on its own store, and after a restart that store can be signed out: the relaunch
 * "succeeds" and walls again. So before anything is stopped the routed store is checked for a credential, and a
 * signed-out one is refused with the plan named — the sign-in button (`./resumeEvidence.ts`). After each relaunch
 * the screen is read once more, and a seat still walled is recorded as `SEAT_STILL_WALLED` (`./resumeSeat.ts`).
 *
 * ## A cold seat is recovered too, and only one the ledger says is open
 *
 * With cmux's own restore off (`slopweaver fleet restore-policy --apply`), a reopened worker tab is a bare shell, not
 * a walled seat, so no screen shows a wall for it. A tab that is a bare shell, paired to an OPEN ledger row BY ITS
 * WORKTREE, with a saved session cmux kept for it, is recovered beside the walled ones by the same priority order
 * (`../../../sessions/coldSeat.ts`). One whose transcript is gone is refused `NO_RESUMABLE_SESSION`. One with no saved
 * session at all, one whose saved session is live in another tab, one whose row names no worktree — so it paired on a `workspace:N` cmux reissues on reopen — or whose
 * worktree another tab shares (`pairingGuess`) is handed to the standing supervisor to find out, never typed into and
 * never fresh-spawned. So is a bare shell with a saved session — even one live in another tab — in any open row's
 * worktree that no open row paired to (`unclaimedWorktreeTabs`): a renumbered dispatch child's tab, or a second tab
 * beside a paired one. That reading is `./resumeCold.ts`.
 *
 * RESIDUE, stated rather than discovered: a ledger row carries no session id, so a lone tab in a worktree an OPEN row
 * names is taken as that row's seat even when the row is stale and the tab was their own; and the worktree-sharing count
 * is taken from the workspace list read at the start of the pass, not re-read at the send.
 *
 * ## A seat that keeps falling over is investigated, not relaunched again
 *
 * The journal is read once, under the lock, before this attempt writes anything: a worker recovery has relaunched
 * often enough, recently enough (`../../../fleet/crashLoop.ts`) is HELD — journalled `held` with `CRASH_LOOP` — and
 * the caught-up supervisor is asked to find the cause. Every other worker carries on.
 */
import { randomUUID } from "node:crypto";

import { err, ok, type Result } from "#lib/result.js";

import { ownProcessStart } from "../../../admit/lockHolder.js";
import type { ClaudeAccount } from "../../../claude/contracts.js";
import type { CmuxWorkspaceSummary } from "../../../cmux/client.js";
import { crashLoopingSeats } from "../../../fleet/crashLoop.js";
import { acquireFleetLock } from "../../../fleet/locks.js";
import type { FleetPort } from "../../../fleet/port.js";
import type { PlanRegisterPort } from "../../../plans/port.js";
import type { CmuxHostReach, CmuxHostSurface } from "../../../sessionHarness/cmuxHost.js";
import { pinnedModelsByWorkspace, type ReseatWall } from "../../../sessions/reseat.js";
import { foldSessions, parseSessionLog, type SessionItem } from "../../../sessions/session.js";
import { readSessionLogText } from "../../../sessions/sessionStore.js";
import { type ClaudeSupervisorPin, claudeHeldPin } from "../../../sessions/supervisorPin.js";
import { readSupervisorPin } from "../../../sessions/supervisorPinStore.js";
import { reseatProductionDeps } from "../cmux/reseatEffects.js";
import type { ReseatDeps } from "../cmux/reseatPass.js";
import { type FleetCommandError, FleetCommandErrors } from "./errors.js";
import { awaitChairReorientation, type ChairHalf, chairWorkspaceOf, resumeChair } from "./resumeChair.js";
import { readColdWorkers } from "./resumeCold.js";
import { accountNames, accountsOf, guardedDeps } from "./resumeEvidence.js";
import {
  type FleetResumeCompletion,
  finish,
  nowIso,
  type PassState,
  refusePass,
  resumeConsole,
} from "./resumePassState.js";
import { readWalls } from "./resumeSeat.js";
import { entriesOf, nameUnresumed, resumeWorkers, targetsOf } from "./resumeWorkers.js";

/** What one invocation asked for. */
export interface FleetResumeRequest {
  readonly home: string;
  readonly episodeId: string;
  /** The longest one worker relaunch paces on the boots in flight before it goes regardless. */
  readonly bootPaceSeconds: number;
  /** How long the supervisor gets to say it is caught up. */
  readonly reorientSeconds: number;
}

/**
 * The reseat deps one pass relaunches through: production deps under the sign-in guard, never forced, each seat on
 * the model its ledger pinned.
 *
 * @param request the invocation, for its home and its boot pacing bound
 * @param client the open cmux client
 * @param accounts the plan register the guard checks
 * @param signedOut filled by the guard with each workspace it refused, and the plan it named
 * @param rows the session ledger's rows, for each workspace's pinned model
 * @param workspaces every workspace cmux lists
 * @param port the plan register the routing gate reads — the same one the pass's accounts came from
 * @returns the guarded deps
 */
function passDeps({
  request,
  client,
  accounts,
  signedOut,
  rows,
  workspaces,
  port,
}: {
  request: FleetResumeRequest;
  client: CmuxHostSurface;
  accounts: readonly ClaudeAccount[];
  signedOut: Map<string, string>;
  rows: readonly SessionItem[];
  workspaces: readonly CmuxWorkspaceSummary[];
  port: PlanRegisterPort;
}): ReseatDeps {
  return guardedDeps({
    accounts,
    base: reseatProductionDeps({
      client,
      flags: { dryRun: false, force: false, model: undefined, namedStoreDir: undefined },
      home: request.home,
      ledgerModels: pinnedModelsByWorkspace({ rows, workspaces }),
      port,
      timeoutSeconds: request.bootPaceSeconds,
    }),
    signedOut,
  });
}

/**
 * Open one attempt: take the lock, read the journal's history, and journal the start.
 *
 * @param request the invocation
 * @param fleet where the journal lives
 * @returns the pass's state and the seats the history says are looping, or why it could not open — the lock not
 *   free, or a journal that would not read or would not take the start
 */
async function openPass({
  fleet,
  request,
}: {
  fleet: FleetPort;
  request: FleetResumeRequest;
}): Promise<Result<{ state: PassState; loops: ReturnType<typeof crashLoopingSeats> }, FleetCommandError>> {
  const locked = acquireFleetLock({ home: request.home, nowIso: nowIso() });
  if (locked.isErr()) {
    return err(FleetCommandErrors.lockUnavailable({ cause: locked.error }));
  }
  const history = await fleet.readResumeJournal({ home: request.home });
  if (history.isErr()) {
    locked.value.release();
    return err(FleetCommandErrors.resumeJournalReadFailed({ cause: history.error }));
  }
  const loops = crashLoopingSeats({ events: history.value.events, nowIso: nowIso() });
  const state: PassState = {
    attemptId: randomUUID(),
    deferred: false,
    fleet,
    home: request.home,
    lines: [],
    passRefusal: undefined,
    refusals: [],
    releaseLock: locked.value.release,
  };
  const pidStart = ownProcessStart();
  // Never best-effort: an attempt the journal does not show is one the page and the app cannot see, so nothing runs.
  const started = await fleet.appendResumeEvent({
    event: {
      atIso: nowIso(),
      attemptId: state.attemptId,
      episodeId: request.episodeId,
      kind: "attempt-started",
      pid: process.pid,
      schemaVersion: 1,
      ...(pidStart === undefined ? {} : { pidStart }),
    },
    home: request.home,
  });
  if (started.isErr()) {
    state.releaseLock();
    return err(FleetCommandErrors.resumeStartJournalFailed({ cause: started.error }));
  }
  return ok({ loops, state });
}

/**
 * The workers this pass recovers: only a walled seat, never the chair nor the tab this pass runs in.
 *
 * @param workspaces every workspace cmux lists
 * @param walls each walled workspace's wall
 * @param skip the chair's workspace and this pass's own
 * @returns the walled worker workspaces
 */
function walledWorkers({
  workspaces,
  walls,
  skip,
}: {
  workspaces: readonly CmuxWorkspaceSummary[];
  walls: ReadonlyMap<string, ReseatWall>;
  skip: readonly (string | undefined)[];
}): readonly CmuxWorkspaceSummary[] {
  return workspaces.filter((workspace) => !skip.includes(workspace.workspaceId) && walls.has(workspace.workspaceId));
}

/**
 * Run one recovery attempt.
 *
 * A plan register that could not be read refuses the whole pass right after it opens — journalled, and before the
 * console, the chair or any worker is touched — because relaunching on an unknown set of plans is booting on
 * whatever credential is ambient, the fall-through the register exists to prevent.
 *
 * @param request the invocation
 * @param client the open cmux client
 * @param port where the plan register is read — `planRegisterPort()` from the verb, a seam in a test
 * @param fleet where the recovery journal lives — `fleetPort()` from the verb, a seam in a test
 * @returns how it ended and whether its finish was journalled, or why it could not start — another live attempt
 *   holding the lock, or a journal that would not read or would not take its start, since a pass the journal
 *   cannot show acts out of everyone's sight
 */
export async function runFleetResumePass({
  request,
  client,
  fleet,
  port,
}: {
  request: FleetResumeRequest;
  client: CmuxHostSurface & CmuxHostReach;
  fleet: FleetPort;
  port: PlanRegisterPort;
}): Promise<Result<FleetResumeCompletion, string>> {
  const opened = await openPass({ fleet, request });
  if (opened.isErr()) {
    return err(opened.error.message);
  }
  const { loops, state } = opened.value;
  const read = await accountsOf({ home: request.home, port });
  if (read.isErr()) {
    return ok(await refuseUnreadableRegister({ message: read.error.message, request, state }));
  }
  const accounts = read.value;
  const names = accountNames({ accounts, home: request.home });
  await resumeConsole({ state });
  const pin = readPinOrRecord({ home: request.home, state });
  const listed = await client.listWorkspaces();
  if (listed.isErr()) {
    refusePass({ refusal: { code: "CMUX_ACCESS_DENIED", message: listed.error.message }, state });
    return ok(await finish({ accounts: names, state }));
  }
  const rows = foldSessions({ events: parseSessionLog({ text: readSessionLogText({ home: request.home }) }).events });
  const signedOut = new Map<string, string>();
  const deps = passDeps({ accounts, client, port, request, rows, signedOut, workspaces: listed.value });
  const walls = await readWalls({ deps, workspaces: listed.value });
  const half =
    pin === undefined
      ? { standing: undefined, workspace: chairWorkspaceOf({ pin, workspaces: listed.value }) }
      : await resumeChair({ accounts, client, deps, loops, pin, signedOut, state, walls, workspaces: listed.value });
  await recoverWorkers({
    accounts,
    client,
    deps,
    half,
    loops,
    request,
    rows,
    signedOut,
    state,
    walls,
    workspaces: listed.value,
  });
  await awaitStandingChair({ client, half, reorientSeconds: request.reorientSeconds, state });
  return ok(await finish({ accounts: names, state }));
}

/**
 * Recover every other walled or cold seat once the chair has been dealt with: name the bare shells the pass will
 * not type into, then relaunch the rest by board priority. Nothing here waits on the chair.
 *
 * @param accounts the plan register
 * @param client the open cmux client
 * @param deps the guarded reseat deps
 * @param half the chair's half of the pass, which says whether a supervisor stands to be asked
 * @param loops every seat recovery keeps relaunching
 * @param request the invocation, for its home
 * @param rows the session ledger's rows
 * @param signedOut each workspace the guard refused, with the plan it named
 * @param state the pass to record on
 * @param walls each walled workspace's wall
 * @param workspaces every workspace cmux lists
 */
async function recoverWorkers({
  accounts,
  client,
  deps,
  half,
  loops,
  request,
  rows,
  signedOut,
  state,
  walls,
  workspaces,
}: {
  accounts: readonly ClaudeAccount[];
  client: CmuxHostSurface & CmuxHostReach;
  deps: ReseatDeps;
  half: ChairHalf;
  loops: ReturnType<typeof crashLoopingSeats>;
  request: FleetResumeRequest;
  rows: readonly SessionItem[];
  signedOut: ReadonlyMap<string, string>;
  state: PassState;
  walls: ReadonlyMap<string, ReseatWall>;
  workspaces: readonly CmuxWorkspaceSummary[];
}): Promise<void> {
  const skip = [half.workspace?.workspaceId, deps.ownWorkspaceId];
  const walled = walledWorkers({ skip, walls, workspaces });
  const { cold, unresumed } = await readColdWorkers({
    chairWorkspaceId: half.workspace?.workspaceId,
    deps,
    rows,
    skip,
    state,
    walls,
    workspaces,
  });
  const standingChair = half.standing === undefined ? undefined : half.workspace;
  await nameUnresumed({ client, standingChair, state, unresumed });
  await resumeWorkers({
    accounts,
    chair: standingChair,
    client,
    deps,
    entries: entriesOf({ cold, walled, walls }),
    loops,
    signedOut,
    state,
    targets: targetsOf({ home: request.home, rows, workspaces: [...walled, ...cold.map((seat) => seat.workspace)] }),
  });
}

/**
 * End a pass whose plan register could not be read: journalled as a refusal, before the console, the chair or any
 * worker is touched.
 *
 * @param message why the register would not read
 * @param request the invocation, for its home
 * @param state the pass to record on
 * @returns how the pass ended, with no accounts to name
 */
async function refuseUnreadableRegister({
  message,
  request,
  state,
}: {
  message: string;
  request: FleetResumeRequest;
  state: PassState;
}): Promise<FleetResumeCompletion> {
  refusePass({
    refusal: {
      code: "STORE_REFUSED",
      message: `the plan register could not be read, so no seat was touched: ${message}`,
      storeRefusal: "configuration",
    },
    state,
  });
  return finish({ accounts: accountNames({ accounts: [], home: request.home }), state });
}

/** Once every worker is reseated, wait for a standing chair's own caught-up line; a chair that never stood is not waited on. */
async function awaitStandingChair({
  state,
  client,
  half,
  reorientSeconds,
}: {
  state: PassState;
  client: CmuxHostSurface & CmuxHostReach;
  half: ChairHalf;
  reorientSeconds: number;
}): Promise<void> {
  if (half.standing === undefined || half.workspace === undefined) {
    return;
  }
  await awaitChairReorientation({ chair: half.workspace, client, reorientSeconds, standing: half.standing, state });
}

/**
 * The supervisor pin, with its absence recorded — never a stop: the workers are recovered without a chair. A Codex
 * chair is recorded the same way: recovery resumes a Claude session by its id, which a Codex thread is not.
 */
function readPinOrRecord({ home, state }: { home: string; state: PassState }): ClaudeSupervisorPin | undefined {
  const pin = readSupervisorPin({ home });
  if (pin === undefined) {
    refusePass({ refusal: { code: "NO_CHAIR_PIN", message: "no supervisor pin is recorded under this home" }, state });
    return undefined;
  }
  const held = claudeHeldPin({ pin });
  if (held === undefined) {
    refusePass({
      refusal: {
        code: "CHAIR_ON_CODEX",
        message: `the supervisor pin names Codex thread ${pin.session.id}, and recovery resumes only Claude sessions`,
      },
      state,
    });
    return undefined;
  }
  return held;
}
