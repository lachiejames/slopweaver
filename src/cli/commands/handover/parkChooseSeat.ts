/**
 * `handover park`'s seat choice: which workspace is the run's seat, its screen as read now, and whether the policy
 * lets it close. Read once at the choice and again right before the journal append, because a seat starting a turn
 * after the first read no longer shows it idle.
 *
 * Which seat, and whether it may close, are `../../../handover/parkPolicy.ts`'s — pure, and tested there. This file
 * owns the two cmux reads that feed it. The park hatch is read by `./parkRun.ts`, the reader its registry row
 * names, and arrives here as `runningSeatHatchOpen` — a reader asked after each screen read, never a value cached
 * before it.
 */

import type { CmuxWorkspaceSummary } from "../../../cmux/client.js";
import { PARK_SCREEN_LINES } from "../../../handover/parkedEvent.js";
import { parkSeatRefusal, refusalShows, selectParkWorkspace } from "../../../handover/parkPolicy.js";
import { err, ok, type Result } from "../../../lib/result.js";
import type { CmuxHostSurface } from "../../../sessionHarness/cmuxHost.js";
import type { ParkFailure } from "./parkFailure.js";
import type { ParkPlan } from "./parkRunJournal.js";

/** The seat chosen, its screen as read, and whether only the hatch let it be closed. */
export interface ChosenSeat {
  readonly seat: CmuxWorkspaceSummary;
  readonly screen: string;
  readonly forced: boolean;
}

/**
 * The run's seat, its screen, and whether the policy lets it close — refused when it may not.
 *
 * @param callerWorkspaceId the caller's own `CMUX_WORKSPACE_ID`; a seat parking itself is read only for a queued line
 * @param requested the `--workspace` the caller named, if any
 * @param runningSeatHatchOpen asked once the screen is read: whether `SLOPWEAVER_ALLOW_PARK_RUNNING_SEAT=1` overrides
 *   a seat shown mid-turn
 * @returns the chosen seat, or the failure that refused it
 */
export async function chooseSeat({
  callerWorkspaceId,
  client,
  plan,
  requested,
  runningSeatHatchOpen,
}: {
  callerWorkspaceId: string | undefined;
  client: CmuxHostSurface;
  plan: Pick<ParkPlan, "runTree" | "seatHost">;
  requested: string | undefined;
  runningSeatHatchOpen: () => boolean;
}): Promise<Result<ChosenSeat, ParkFailure>> {
  const workspaces = await client.listWorkspaces();
  if (workspaces.isErr()) {
    return err({ error: workspaces.error, journalled: false, kind: "cmux" });
  }
  const target = selectParkWorkspace({
    callerWorkspaceId,
    requested,
    workspaces: workspaces.value,
    writerWorktree: plan.runTree,
  });
  if (target.isErr()) {
    return err({ error: target.error, kind: "seat" });
  }
  return judgeSeat({ callerWorkspaceId, client, plan, runningSeatHatchOpen, seat: target.value });
}

/**
 * Read the seat's screen now and judge whether it may close — run at the choice and again right before the append.
 *
 * @param callerWorkspaceId the caller's own `CMUX_WORKSPACE_ID`; a seat parking itself is read only for a queued line
 * @param runningSeatHatchOpen asked once the screen is read: whether `SLOPWEAVER_ALLOW_PARK_RUNNING_SEAT=1` overrides
 *   a seat shown mid-turn
 * @returns the seat with its fresh screen, or the failure that refused it
 */
export async function judgeSeat({
  callerWorkspaceId,
  client,
  plan,
  runningSeatHatchOpen,
  seat,
}: {
  callerWorkspaceId: string | undefined;
  client: CmuxHostSurface;
  plan: Pick<ParkPlan, "seatHost">;
  runningSeatHatchOpen: () => boolean;
  seat: CmuxWorkspaceSummary;
}): Promise<Result<ChosenSeat, ParkFailure>> {
  const screen = await client.readScreen({
    scrollbackLines: PARK_SCREEN_LINES,
    target: { workspaceId: seat.workspaceId },
  });
  if (screen.isErr()) {
    return err({ error: screen.error, journalled: false, kind: "cmux" });
  }
  const refusal = parkSeatRefusal({
    callerWorkspaceId,
    holderHost: plan.seatHost,
    screen: screen.value,
    target: seat,
  });
  if (refusal?.kind === "pinned") {
    return err({ kind: "pinned", workspaceRef: seat.workspaceRef });
  }
  if (refusal !== undefined && !runningSeatHatchOpen()) {
    return err({ kind: "mid-turn", shows: refusalShows({ refusal }), workspaceRef: seat.workspaceRef });
  }
  return ok({ forced: refusal !== undefined, screen: screen.value, seat });
}
