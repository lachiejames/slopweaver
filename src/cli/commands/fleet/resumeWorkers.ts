/**
 * The worker half of a recovery pass (`./resumeRun.ts`): every walled or cold seat other than the chair, in board
 * priority order, relaunched through `./resumeSeat.ts` and nudged once it is back — a crash-looping one held and
 * handed to the standing supervisor, and every one after a relaunch that failed past its stop left for the next
 * attempt. The chair's state never holds a worker.
 */
import { logger } from "#lib/logger.js";

import type { ClaudeAccount } from "../../../claude/contracts.js";
import type { CmuxWorkspaceSummary } from "../../../cmux/client.js";
import { realReachWaits } from "../../../cmux/reach.js";
import type { FleetCrashLoop } from "../../../fleet/crashLoop.js";
import { crashLoopAction, type FleetResumeTarget, orderResumeTargets } from "../../../fleet/resumePlan.js";
import { effectivePriority } from "../../../handover/rowKind.js";
import { lookupDocBySlug } from "../../../handover/store.js";
import type { CmuxHostReach, CmuxHostSurface } from "../../../sessionHarness/cmuxHost.js";
import { pairRowsToWorkspaces } from "../../../sessions/closeDone.js";
import type { ReseatWall } from "../../../sessions/reseat.js";
import type { SessionItem } from "../../../sessions/session.js";
import { stateHomePaths } from "../../../stateHome.js";
import { WORKER_NUDGE_LINE } from "../../../transcripts/fleetNudge.js";
import type { ReseatDeps } from "../cmux/reseatPass.js";
import { askChairToInvestigate } from "./resumeChair.js";
import { stillListedSeats, type UnresumedSeat, unresumedPassLine, unresumedSeatsLine } from "./resumeCold.js";
import { type PassState, refuseSeat } from "./resumePassState.js";
import { type ResumeEntry, resumeSeat } from "./resumeSeat.js";

/** Each worker to recover, by workspace id: walled ones by their wall, cold ones by the session saved for them. */
export type WorkerEntries = ReadonlyMap<
  string,
  { readonly entry: ResumeEntry; readonly sessionId: string | undefined }
>;

/**
 * Each walled workspace's board row, by the ledger row paired to it.
 *
 * @param home the state home the handover docs are looked up under
 * @param workspaces the workers to recover
 * @param rows the session ledger's rows, of which only the open ones pair
 * @returns each workspace with its board priority and title, `unassigned` when no doc pairs
 */
export function targetsOf({
  home,
  workspaces,
  rows,
}: {
  home: string;
  workspaces: readonly CmuxWorkspaceSummary[];
  rows: readonly SessionItem[];
}): readonly FleetResumeTarget[] {
  const paired = pairRowsToWorkspaces({ rows: rows.filter((row) => row.status === "open"), workspaces });
  const byWorkspace = new Map<string, SessionItem>();
  for (const [row, workspace] of paired) {
    byWorkspace.set(workspace.workspaceId, row);
  }
  return workspaces.map((workspace) => {
    const slug = byWorkspace.get(workspace.workspaceId)?.slug;
    const doc =
      slug === undefined ? undefined : lookupDocBySlug({ handoverDir: stateHomePaths({ home }).handovers, slug });
    if (doc === undefined) {
      return { priority: "unassigned" as const, title: workspace.workspaceRef, workspace };
    }
    return { priority: effectivePriority({ declared: doc.priority, kind: doc.kind }), title: doc.slug, workspace };
  });
}

/**
 * Each walled and cold worker's entry, keyed by its workspace.
 *
 * @param walled the walled workers
 * @param walls each walled workspace's wall
 * @param cold the cold workers, each with the session saved for it
 * @returns the entries `resumeWorkers` recovers by
 */
export function entriesOf({
  walled,
  walls,
  cold,
}: {
  walled: readonly CmuxWorkspaceSummary[];
  walls: ReadonlyMap<string, ReseatWall>;
  cold: readonly { readonly workspace: CmuxWorkspaceSummary; readonly sessionId: string }[];
}): WorkerEntries {
  const entries = new Map<string, { readonly entry: ResumeEntry; readonly sessionId: string | undefined }>();
  for (const workspace of walled) {
    entries.set(workspace.workspaceId, {
      entry: { kind: "walled", wall: walls.get(workspace.workspaceId) },
      sessionId: undefined,
    });
  }
  for (const seat of cold) {
    entries.set(seat.workspace.workspaceId, {
      entry: { kind: "cold", pinnedSessionId: undefined },
      sessionId: seat.sessionId,
    });
  }
  return entries;
}

/**
 * Name every bare-shell seat the pass would not type into: on the pass's own output whether or not the chair is
 * asked, so a send that fails, or no chair standing at all, still leaves every tab named.
 *
 * @param state the pass to record on
 * @param client the open cmux client
 * @param standingChair the standing supervisor's workspace, asked to investigate; absent when none stands
 * @param unresumed the bare-shell seats the pass would not type into
 */
export async function nameUnresumed({
  state,
  client,
  standingChair,
  unresumed,
}: {
  state: PassState;
  client: CmuxHostSurface & CmuxHostReach;
  standingChair: CmuxWorkspaceSummary | undefined;
  unresumed: readonly UnresumedSeat[];
}): Promise<void> {
  if (unresumed.length === 0) {
    return;
  }
  const relisted = await client.listWorkspaces();
  const { closed, standing } = stillListedSeats({
    relisted: relisted.isOk() ? relisted.value : undefined,
    unresumed,
  });
  for (const ref of closed) {
    state.lines.push(`${ref}\tclosed while the pass read the fleet, so not named`);
  }
  if (standing.length === 0) {
    return;
  }
  const line = unresumedSeatsLine({ unresumed: standing });
  state.lines.push(unresumedPassLine({ chairStanding: standingChair !== undefined, line }));
  if (standingChair !== undefined) {
    await askChairToInvestigate({ chair: standingChair, client, line, state });
  }
}

/**
 * Every other walled or cold seat, by priority, one nudge each once it is back — and a looping one held, not
 * relaunched. Only a relaunch path that is itself failing stops the later ones (`haltsLaterWorkers`); the chair's
 * state never does, and with no chair standing a looping worker is still held and the missing investigation said so.
 *
 * @param state the pass to record on
 * @param client the open cmux client
 * @param chair the standing supervisor's workspace, asked to investigate a loop; absent when none stands
 * @param deps the guarded reseat deps
 * @param accounts the plan register
 * @param signedOut each workspace the guard refused, with the plan it named
 * @param targets the walled and cold workers, with their board priority
 * @param entries each target's entry: walled by its wall, cold by the session saved for it
 * @param loops every seat recovery keeps relaunching
 */
export async function resumeWorkers({
  state,
  client,
  chair,
  deps,
  accounts,
  signedOut,
  targets,
  entries,
  loops,
}: {
  state: PassState;
  client: CmuxHostSurface & CmuxHostReach;
  chair: CmuxWorkspaceSummary | undefined;
  deps: ReseatDeps;
  accounts: readonly ClaudeAccount[];
  signedOut: ReadonlyMap<string, string>;
  targets: readonly FleetResumeTarget[];
  entries: WorkerEntries;
  loops: ReadonlyMap<string, FleetCrashLoop>;
}): Promise<void> {
  for (const target of orderResumeTargets({ targets })) {
    const ref = target.workspace.workspaceRef;
    const { entry, sessionId } = entries.get(target.workspace.workspaceId)!;
    if (state.deferred) {
      await holdBehindEarlierSeat({ entry, sessionId, state, workspaceRef: ref });
      continue;
    }
    const loop = loops.get(ref);
    if (loop !== undefined) {
      // Not `state.deferred`: that would hold every later worker, and only this one is looping.
      const action = crashLoopAction({ reseats: loop.reseats, role: "worker", title: target.title, workspaceRef: ref });
      await refuseSeat({ phase: "held", refusal: action.refusal, role: "worker", sessionId: undefined, state });
      if (chair === undefined) {
        state.lines.push(`${ref}\tno supervisor stands to investigate this loop`);
      } else {
        await askChairToInvestigate({ chair, client, line: action.investigationLine, state });
      }
      continue;
    }
    const outcome = await resumeSeat({
      accounts,
      client,
      deps,
      entry,
      role: "worker",
      sessionId,
      signedOut,
      state,
      workspace: target.workspace,
    });
    if (outcome.kind === "reseated") {
      await nudgeWorker({ client, workspace: target.workspace });
    }
  }
}

/**
 * Leave a worker as it stands because an earlier relaunch failed after its stop. A cold one is JOURNALLED held,
 * since nothing else would show it: it has no wall, and health sees no live session in its tab.
 *
 * @param state the pass to record on
 * @param entry whether the seat is walled or cold
 * @param sessionId its saved Claude session, when known
 * @param workspaceRef the seat's cmux workspace
 */
async function holdBehindEarlierSeat({
  state,
  entry,
  sessionId,
  workspaceRef,
}: {
  state: PassState;
  entry: ResumeEntry;
  sessionId: string | undefined;
  workspaceRef: string;
}): Promise<void> {
  if (entry.kind === "walled") {
    state.lines.push(
      `${workspaceRef}\tnot yet — an earlier relaunch failed after its stop, so this one waits for the next attempt`,
    );
    return;
  }
  const refusal = {
    code: "HELD" as const,
    message: "an earlier relaunch failed after its stop, so this cold seat waits for the next attempt",
    workspaceRef,
  };
  await refuseSeat({ phase: "held", refusal, role: "worker", sessionId, state });
}

/**
 * Tell a reseated worker to pick its work back up, read back as the supervisor's nudge is: a just-relaunched session
 * can leave the line in its composer.
 *
 * @param client the open cmux client
 * @param workspace the reseated worker's workspace
 */
async function nudgeWorker({
  client,
  workspace,
}: {
  client: CmuxHostSurface & CmuxHostReach;
  workspace: CmuxWorkspaceSummary;
}): Promise<void> {
  const ref = workspace.workspaceRef;
  const reached = await client.reachSession({
    target: { workspaceId: workspace.workspaceId },
    text: WORKER_NUDGE_LINE,
    waits: realReachWaits(),
  });
  if (reached.isErr()) {
    logger.error({ msg: `fleet resume: ${ref}'s nudge did not send: ${reached.error.message}` });
  } else if (reached.value.disposition === "stranded") {
    logger.error({ msg: `fleet resume: ${ref}'s nudge is still in its composer after one more Enter` });
  }
}
