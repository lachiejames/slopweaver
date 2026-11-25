/**
 * The supervisor's half of a recovery pass: relaunch it when walled, ask it to read the picture back in, and — once
 * every worker is reseated — wait for its OWN line saying it has, never written on its behalf. No worker waits on
 * that line: MEASURED in one episode, workers held behind a chair that could not answer four attempts running,
 * and they reseated every one by hand.
 *
 * ## A cold chair is resumed on the PIN
 *
 * With cmux's own restore off (`slopweaver fleet restore-policy --apply`), a reopened chair tab is a bare shell, so
 * no live session carries the pin. MEASURED: cmux's restore had relaunched it with no setup token, and
 * restoring it through Slopweaver's own commands is acceptable. So a bare-shell chair is
 * resumed on the pinned session through the reseat pass's cold arm — FIRST, before any worker — and a tab running
 * anything else still refuses `NO_LIVE_SESSION`, never a fresh session in its place. That judgement — walled, live in
 * its own tab, or cold on the pin — is `./resumeChairStanding.ts`.
 *
 * It is also the one place a crash loop is investigated (`../../../fleet/crashLoop.ts`): the chair is the pinned,
 * visible session they already watch, so asking it is investigation with nothing headless and nothing new launched
 * (AGENTS.md rule 2).
 */
import { logger } from "#lib/logger.js";

import type { ClaudeAccount } from "../../../claude/contracts.js";
import type { CmuxWorkspaceSummary } from "../../../cmux/client.js";
import { realReachWaits } from "../../../cmux/reach.js";
import { isPinnedSupervisorWorkspace } from "../../../cmux/supervisorWorkspace.js";
import type { FleetCrashLoop } from "../../../fleet/crashLoop.js";
import { foldNewestAttempt } from "../../../fleet/journal.js";
import { crashLoopAction } from "../../../fleet/resumePlan.js";
import type { CmuxHostReach, CmuxHostSurface } from "../../../sessionHarness/cmuxHost.js";
import type { ReseatWall } from "../../../sessions/reseat.js";
import {
  type ClaudeCmuxSupervisorPin,
  pinnedCmuxWorkspaceId,
  type SupervisorPinRecord,
} from "../../../sessions/supervisorPin.js";
import { chairNudgeLine } from "../../../transcripts/fleetNudge.js";
import type { ReseatDeps } from "../cmux/reseatPass.js";
import { chairStanding } from "./resumeChairStanding.js";
import { chairReoriented } from "./resumeEvidence.js";
import { journal, nowIso, type PassState, POLL_MS, pause, refusePass, refuseSeat } from "./resumePassState.js";

/**
 * The workspace the supervisor runs in: the pin's, else cmux's own pinned supervisor tab — the one a pass with no
 * pin still keeps out of the workers, so a chair is never relaunched on worker routing.
 *
 * @param pin the supervisor pin, when one is recorded
 * @param workspaces every workspace cmux lists
 * @returns the chair's workspace, when one is found
 */
export function chairWorkspaceOf({
  pin,
  workspaces,
}: {
  pin: SupervisorPinRecord | undefined;
  workspaces: readonly CmuxWorkspaceSummary[];
}): CmuxWorkspaceSummary | undefined {
  // Only a cmux pin names a workspace; an app pin falls through to cmux's own pinned tab, never matched on its id.
  const pinnedWorkspaceId = pinnedCmuxWorkspaceId({ pin });
  const byPin = workspaces.find(
    (workspace) => pinnedWorkspaceId !== undefined && workspace.workspaceId === pinnedWorkspaceId,
  );
  if (byPin !== undefined) {
    return byPin;
  }
  return workspaces.find((workspace) =>
    isPinnedSupervisorWorkspace({ pinned: workspace.pinned, title: workspace.title }),
  );
}

/** Ask the supervisor to reorient, without waiting: true when it already has, so nothing need wait on it. */
async function askChairToReorient({
  state,
  client,
  chair,
  sessionId,
}: {
  state: PassState;
  client: CmuxHostSurface & CmuxHostReach;
  chair: CmuxWorkspaceSummary;
  sessionId: string;
}): Promise<boolean> {
  if (await chairReoriented({ fleet: state.fleet, home: state.home, sessionId })) {
    state.lines.push("supervisor\talready caught up");
    return true;
  }
  await journal({
    event: {
      atIso: nowIso(),
      attemptId: state.attemptId,
      chairSessionId: sessionId,
      chairWorkspaceId: chair.workspaceId,
      kind: "chair-awaiting-reorientation",
      schemaVersion: 1,
    },
    state,
  });
  // `reachSession`, never a bare `sendLine`: MEASURED (drill X2, Claude Code 2.1.289), the nudge typed
  // into a just-relaunched chair sat in its composer UNSUBMITTED for the whole 600s wait, and the pass deferred
  // on a chair that never saw it. `reachSession` reads the composer back and presses Enter once for a strand.
  const reached = await client.reachSession({
    target: { workspaceId: chair.workspaceId },
    text: chairNudgeLine({ attemptId: state.attemptId }),
    waits: realReachWaits(),
  });
  if (reached.isErr()) {
    logger.error({ msg: `fleet resume: the supervisor's nudge did not send: ${reached.error.message}` });
  } else if (reached.value.disposition === "stranded") {
    logger.error({ msg: "fleet resume: the supervisor's nudge is still in its composer after one more Enter" });
  }
  state.lines.push("supervisor\tasked to catch up — every walled worker is reseated meanwhile");
  return false;
}

/** Wait for the supervisor's own line saying it is caught up. */
async function awaitReorientedLine({ state, seconds }: { state: PassState; seconds: number }): Promise<boolean> {
  state.lines.push(`supervisor\twaiting up to ${String(seconds)}s for it to say it is caught up`);
  const deadline = Date.now() + seconds * 1000;
  while (Date.now() < deadline) {
    await pause({ ms: POLL_MS * 5 });
    const read = await state.fleet.readResumeJournal({ home: state.home });
    if (read.isOk() && foldNewestAttempt({ events: read.value.events })?.chair.kind === "reoriented") {
      state.lines.push("supervisor\tcaught up");
      return true;
    }
  }
  return false;
}

/**
 * Hand one crash loop to the caught-up supervisor, without interrupting its turn: a line that queues behind its
 * current work still arrives, and investigation is never urgent enough to discard that work.
 *
 * @param state the pass, for its printed lines
 * @param client the open cmux client
 * @param chair the supervisor's workspace
 * @param line the instruction
 */
export async function askChairToInvestigate({
  state,
  client,
  chair,
  line,
}: {
  state: PassState;
  client: CmuxHostSurface & CmuxHostReach;
  chair: CmuxWorkspaceSummary;
  line: string;
}): Promise<void> {
  const reached = await client.reachSession({
    target: { workspaceId: chair.workspaceId },
    text: line,
    waits: realReachWaits(),
  });
  if (reached.isErr()) {
    logger.error({ msg: `fleet resume: the supervisor's investigation line did not send: ${reached.error.message}` });
    state.lines.push("supervisor\tthe investigation line did not send");
    return;
  }
  state.lines.push(`supervisor\tasked to investigate — ${reached.value.disposition}`);
}

/** What the chair half left for the rest of the pass. */
export interface ChairHalf {
  /** The chair's workspace, kept out of the workers whether or not it stands. */
  readonly workspace: CmuxWorkspaceSummary | undefined;
  /** Present once the chair stands: whether it is already caught up, and the crash loop it is in, if any. */
  readonly standing:
    { readonly sessionId: string; readonly caughtUp: boolean; readonly loop: FleetCrashLoop | undefined } | undefined;
}

/**
 * The supervisor's half, up to the nudge: relaunch it when walled, confirm it is live, and ask it to catch up —
 * never waiting for the answer, which `awaitChairReorientation` does once every worker is reseated. A chair that
 * is itself crash-looping is relaunched anyway — holding it would stop every seat — and told so once it is back.
 *
 * @param state the pass to record on
 * @param client the open cmux client
 * @param deps the guarded reseat deps
 * @param accounts the plan register
 * @param signedOut each workspace the guard refused, with the plan it named
 * @param pin the supervisor pin
 * @param workspaces every workspace cmux lists
 * @param walls each walled workspace's wall
 * @param loops every seat recovery keeps relaunching
 * @returns the chair's workspace, and whether it stands to be waited on — never a reason to stop the workers
 */
export async function resumeChair({
  state,
  client,
  deps,
  accounts,
  signedOut,
  pin,
  workspaces,
  walls,
  loops,
}: {
  state: PassState;
  client: CmuxHostSurface & CmuxHostReach;
  deps: ReseatDeps;
  accounts: readonly ClaudeAccount[];
  signedOut: ReadonlyMap<string, string>;
  pin: ClaudeCmuxSupervisorPin;
  workspaces: readonly CmuxWorkspaceSummary[];
  walls: ReadonlyMap<string, ReseatWall>;
  loops: ReadonlyMap<string, FleetCrashLoop>;
}): Promise<ChairHalf> {
  const sessionId = pin.session.id;
  const chair = chairWorkspaceOf({ pin, workspaces });
  if (chair === undefined) {
    await refuseSeat({
      refusal: {
        code: "NO_LIVE_SESSION",
        message: "no cmux workspace is the supervisor's — neither the pinned id nor a pinned supervisor tab",
        workspaceRef: "supervisor",
      },
      role: "supervisor",
      sessionId,
      state,
    });
    return { standing: undefined, workspace: undefined };
  }
  const wall = walls.get(chair.workspaceId);
  const loop = wall === undefined ? undefined : loops.get(chair.workspaceRef);
  if (!(await chairStanding({ accounts, chair, client, deps, sessionId, signedOut, state, wall }))) {
    return { standing: undefined, workspace: chair };
  }
  const caughtUp = await askChairToReorient({ chair, client, sessionId, state });
  return { standing: { caughtUp, loop, sessionId }, workspace: chair };
}

/**
 * The supervisor's half, after the workers: wait for its own line saying it is caught up, then advise a chair that
 * was crash-looping. A chair that does not answer in time ends the attempt NOT YET, every worker already reseated.
 *
 * @param state the pass to record on
 * @param client the open cmux client
 * @param chair the supervisor's workspace
 * @param standing what `resumeChair` left: its session, whether it is caught up, its crash loop
 * @param reorientSeconds how long the chair gets to say it is caught up
 */
export async function awaitChairReorientation({
  state,
  client,
  chair,
  standing,
  reorientSeconds,
}: {
  state: PassState;
  client: CmuxHostSurface & CmuxHostReach;
  chair: CmuxWorkspaceSummary;
  standing: NonNullable<ChairHalf["standing"]>;
  reorientSeconds: number;
}): Promise<void> {
  if (!standing.caughtUp && !(await awaitReorientedLine({ seconds: reorientSeconds, state }))) {
    state.deferred = true;
    refusePass({
      refusal: {
        code: "CHAIR_REORIENTATION_TIMEOUT",
        message: `the supervisor did not run \`supervisor reoriented --attempt ${state.attemptId}\` within ${String(reorientSeconds)}s`,
        workspaceRef: chair.workspaceRef,
      },
      state,
    });
    return;
  }
  if (standing.loop !== undefined) {
    await adviseLoopingChair({ chair, client, loop: standing.loop, sessionId: standing.sessionId, state });
  }
}

/**
 * Tell a crash-looping chair, once it is caught up, that it was relaunched regardless and should find the cause.
 *
 * @param state the pass to record on
 * @param client the open cmux client
 * @param chair the supervisor's workspace
 * @param loop how often recovery has relaunched it
 * @param sessionId the pinned Claude session
 */
async function adviseLoopingChair({
  state,
  client,
  chair,
  loop,
  sessionId,
}: {
  state: PassState;
  client: CmuxHostSurface & CmuxHostReach;
  chair: CmuxWorkspaceSummary;
  loop: FleetCrashLoop;
  sessionId: string;
}): Promise<void> {
  const action = crashLoopAction({
    reseats: loop.reseats,
    role: "supervisor",
    title: "Supervisor",
    workspaceRef: chair.workspaceRef,
  });
  state.refusals.push(action.refusal);
  state.lines.push(`supervisor\t${action.refusal.code} — ${action.refusal.message}`);
  // The chair WAS relaunched, so its newest phase stays `reseated`; the advisory rides on that line.
  await journal({
    event: {
      atIso: nowIso(),
      attemptId: state.attemptId,
      kind: "seat",
      phase: "reseated",
      refusal: action.refusal,
      role: "supervisor",
      schemaVersion: 1,
      sessionId,
      workspaceRef: chair.workspaceRef,
    },
    state,
  });
  await askChairToInvestigate({ chair, client, line: action.investigationLine, state });
}
