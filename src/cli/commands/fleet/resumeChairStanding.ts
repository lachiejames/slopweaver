/**
 * Whether the supervisor STANDS once a recovery pass reaches it — brought through its wall, confirmed live in its own
 * tab, or resumed on the pin from a bare shell — the judgement `./resumeChair.ts` makes before it nudges the chair.
 *
 * The chair stands only where the pin's own pid runs: a nudge typed into a tab the pin does not run in lands in
 * whatever does. Every failure here is recorded as the chair's refusal, never a stop for the workers.
 *
 * RESIDUE, stated rather than discovered: the tab is read, then the nudge is typed. cmux types into a workspace, never
 * into a pid, so a pin that exits in that instant leaves the nudge to whatever the tab runs next — the
 * same window `../../../sessions/coldSeat.ts` names for a resume line, narrowed by nothing standing between the two.
 */
import { err, ok, type Result } from "#lib/result.js";
import type { ClaudeAccount } from "../../../claude/contracts.js";
import type { CmuxWorkspaceSummary } from "../../../cmux/client.js";
import type { FleetRefusal } from "../../../fleet/refusals.js";
import { fleetRefusalFromReseat } from "../../../fleet/resumePlan.js";
import type { TtyProcessRow } from "../../../live/standing/processes.js";
import type { CmuxHostSurface } from "../../../sessionHarness/cmuxHost.js";
import { liveSessionsInTab, type TabReport } from "../../../sessions/liveInTab.js";
import type { SessionRecord } from "../../../sessions/liveSessions.js";
import type { ReseatWall } from "../../../sessions/reseat.js";
import { type ReseatError, ReseatErrors } from "../../../sessions/reseatErrors.js";
import { awaitColdVerdict, coldWhy } from "../cmux/reseatCold.js";
import { stillLive } from "../cmux/reseatLiveSession.js";
import type { ReseatDeps } from "../cmux/reseatPass.js";
import { liveRecordFor } from "./resumeEvidence.js";
import { type PassState, refuseSeat } from "./resumePassState.js";
import { resumeSeat } from "./resumeSeat.js";

/**
 * Whether the pinned session's own process runs in the chair's tab. Live SOMEWHERE is not enough: the pin live in
 * another tab leaves this one a bare shell or another session, and a nudge typed into it would
 * land there, so the chair stands only where its pid is. "In the tab" is a pid cmux reported for it, attributed or
 * listed, or one the table puts under such a pid (`../../../sessions/liveInTab.ts`): MEASURED, reading
 * cmux's attributed tree alone refused the working chair `NO_LIVE_SESSION` (two attempts in
 * `$SLOPWEAVER_HOME/fleet/resume.jsonl`), because cmux 0.65.2 can attribute nothing to a tab whose session runs.
 *
 * @param sessionId the pinned session
 * @param liveRecords the registry records whose own process runs now
 * @param report what cmux reported for the chair's tab
 * @param rows the process table read beside it
 * @returns true when a live process of the pinned session is in the tab
 */
export function pinHostedHere({
  sessionId,
  liveRecords,
  report,
  rows,
}: {
  sessionId: string;
  liveRecords: readonly SessionRecord[];
  report: TabReport;
  rows: readonly TtyProcessRow[];
}): boolean {
  return liveSessionsInTab({ liveRecords, report, rows }).some((record) => record.sessionId === sessionId);
}

/**
 * The chair's no-session refusal: nothing resumable runs in its tab, and recovery never starts a fresh session there.
 * It names WHY the tab was not read as a bare shell and the way back — `fleet resume` again, or `cmux reseat` on the
 * chair's ref — because the worker fallback (`session re-seat`) excludes the chair by design, and a chair refused with
 * that fallback has no next move (measured, the cmux 0.65.2 relaunch).
 */
function noSessionRefusal({ workspaceRef, why }: { workspaceRef: string; why: string }): FleetRefusal {
  const error = ReseatErrors.noLiveSession({ notCold: { chair: true, why }, workspaceRef });
  return { code: error.code, message: error.message, workspaceRef };
}

/**
 * Bring the chair through its wall when its screen shows one, confirm its session is live when it does not, and resume
 * it on the pin when its tab is a bare shell.
 *
 * @param state the pass to record on
 * @param client the open cmux client
 * @param deps the guarded reseat deps
 * @param accounts the plan register
 * @param signedOut each workspace the guard refused, with the plan it named
 * @param chair the supervisor's workspace
 * @param wall the wall its screen showed, if any
 * @param sessionId the pinned Claude session
 * @returns whether the chair is standing, so the pass may wait for it to catch up
 */
export async function chairStanding({
  state,
  client,
  deps,
  accounts,
  signedOut,
  chair,
  wall,
  sessionId,
}: {
  state: PassState;
  client: CmuxHostSurface;
  deps: ReseatDeps;
  accounts: readonly ClaudeAccount[];
  signedOut: ReadonlyMap<string, string>;
  chair: CmuxWorkspaceSummary;
  wall: ReseatWall | undefined;
  sessionId: string;
}): Promise<boolean> {
  if (wall !== undefined) {
    const outcome = await resumeSeat({
      accounts,
      client,
      deps,
      entry: { kind: "walled", wall },
      role: "supervisor",
      sessionId,
      signedOut,
      state,
      workspace: chair,
    });
    // A relaunch is confirmed on the session's new pid anywhere on the machine, so the tab is checked too.
    return outcome.kind === "reseated" && (await chairHostsPin({ chair, client, deps, sessionId, state }));
  }
  if (liveRecordFor({ sessionId }) !== undefined) {
    return chairHostsPin({ chair, client, deps, sessionId, state });
  }
  return coldChairStanding({ accounts, chair, client, deps, sessionId, signedOut, state });
}

/** The cold arm of `chairStanding`: resume the pin from a bare shell, then check the tab hosts it. */
async function coldChairStanding({
  state,
  client,
  deps,
  accounts,
  signedOut,
  chair,
  sessionId,
}: {
  state: PassState;
  client: CmuxHostSurface;
  deps: ReseatDeps;
  accounts: readonly ClaudeAccount[];
  signedOut: ReadonlyMap<string, string>;
  chair: CmuxWorkspaceSummary;
  sessionId: string;
}): Promise<boolean> {
  const verdict = await awaitColdVerdict({ deps, pinnedSessionId: sessionId, workspace: chair });
  const refuseChair = async ({ why }: { why: string }): Promise<false> => {
    await refuseSeat({
      refusal: noSessionRefusal({ why, workspaceRef: chair.workspaceRef }),
      role: "supervisor",
      sessionId,
      state,
    });
    return false;
  };
  if (verdict.isErr()) {
    return refuseChair({ why: verdict.error.message });
  }
  const judged = verdict.value;
  if (judged.kind !== "cold" && judged.kind !== "unresumable") {
    return refuseChair({ why: coldWhy({ verdict: judged }) });
  }
  if (judged.kind === "cold" && judged.mismatch !== undefined) {
    state.lines.push(
      `supervisor\tresuming the pinned session ${judged.mismatch.pinned}; cmux had saved ${judged.mismatch.bound} for this tab`,
    );
  }
  const outcome = await resumeSeat({
    accounts,
    client,
    deps,
    entry: { kind: "cold", pinnedSessionId: sessionId },
    role: "supervisor",
    sessionId,
    signedOut,
    state,
    workspace: chair,
  });
  // A relaunch is confirmed on the session's new pid anywhere on the machine, so the tab is checked too.
  return outcome.kind === "reseated" && (await chairHostsPin({ chair, client, deps, sessionId, state }));
}

/**
 * Whether the chair's tab hosts the live pinned session, refusing the chair when it does not: the chair stands, and is
 * nudged, only where the pin's own pid runs. Failing CLOSED, so a tab never read is never nudged.
 *
 * @param state the pass to record a refusal on
 * @param client the open cmux client, to read the chair's process tree
 * @param deps the reseat deps, whose live-seat read names the pin's live processes
 * @param chair the supervisor's workspace
 * @param sessionId the pinned Claude session
 * @returns true when the pinned session's live process is in the chair's tab
 */
export async function chairHostsPin({
  state,
  client,
  deps,
  chair,
  sessionId,
}: {
  state: PassState;
  client: CmuxHostSurface;
  deps: ReseatDeps;
  chair: CmuxWorkspaceSummary;
  sessionId: string;
}): Promise<boolean> {
  const hosted = await readChairHosting({ chair, client, deps, sessionId });
  if (hosted.isOk()) {
    return true;
  }
  await refuseSeat({
    refusal: fleetRefusalFromReseat({ alias: undefined, error: hosted.error, workspaceRef: chair.workspaceRef }),
    role: "supervisor",
    sessionId,
    state,
  });
  return false;
}

/** Read the chair's tab, the live registry and the table, and fail with the reason the pin is not hosted there. */
async function readChairHosting({
  client,
  deps,
  chair,
  sessionId,
}: {
  client: CmuxHostSurface;
  deps: ReseatDeps;
  chair: CmuxWorkspaceSummary;
  sessionId: string;
}): Promise<Result<true, ReseatError>> {
  const top = await client.workspaceTop({ workspaceId: chair.workspaceId });
  if (top.isErr()) {
    return err(ReseatErrors.cmuxReadFailed({ cause: top.error.message, what: `${chair.workspaceRef}'s process tree` }));
  }
  // One surface only: cmux's listing pools every surface's pids, so a pin on a hidden pane would otherwise stand the
  // chair whose nudge lands in the selected one.
  if (top.value.surfaces !== 1) {
    return err(
      ReseatErrors.cmuxReadFailed({
        cause: `cmux's process listing holds ${String(top.value.surfaces)} surfaces for the tab, not one`,
        what: `${chair.workspaceRef}'s process tree`,
      }),
    );
  }
  const live = deps.readLiveRecords();
  if (live.isErr()) {
    return err(ReseatErrors.cmuxReadFailed({ cause: live.error, what: "which Claude sessions are live" }));
  }
  // A pin cmux reported itself needs no table, so a `ps` that fails cannot refuse it.
  if (pinHostedHere({ liveRecords: live.value, report: top.value, rows: [], sessionId })) {
    return ok(true);
  }
  return pinStandsByTable({ chair, deps, liveRecords: live.value, report: top.value, sessionId });
}

/**
 * The half of {@link readChairHosting} that needs the process table: whether the pin cmux did not report itself runs
 * in the chair's tab by its tty.
 *
 * @param liveRecords the live registry, already read
 * @param report the chair tab's `system.top` read, already narrowed to one surface
 * @returns `true` when the pin stands there, else the reason it does not
 */
function pinStandsByTable({
  chair,
  deps,
  liveRecords,
  report,
  sessionId,
}: {
  chair: CmuxWorkspaceSummary;
  deps: ReseatDeps;
  liveRecords: readonly SessionRecord[];
  report: TabReport;
  sessionId: string;
}): Result<true, ReseatError> {
  const rows = deps.readProcessRows();
  if (rows.isErr()) {
    return err(
      ReseatErrors.cmuxReadFailed({
        cause: rows.error,
        what: `the process table behind ${chair.workspaceRef}'s processes`,
      }),
    );
  }
  // Only the pin's records the table put IN this tab, validated again after it: a pid reused on the tab's tty, or the
  // pin running only in another tab by then, never stands the chair (`stillLive`).
  const pin = stillLive({
    deps,
    sessions: liveSessionsInTab({ liveRecords, report, rows: rows.value }).filter(
      (record) => record.sessionId === sessionId,
    ),
  });
  if (pin.isErr()) {
    return err(ReseatErrors.cmuxReadFailed({ cause: pin.error, what: "which Claude sessions are live" }));
  }
  if (pin.value.length > 0) {
    return ok(true);
  }
  return err(
    ReseatErrors.noLiveSession({
      notCold: {
        chair: true,
        why: `the pinned session ${sessionId} does not run in this tab, so nothing was typed into it`,
      },
      workspaceRef: chair.workspaceRef,
    }),
  );
}
