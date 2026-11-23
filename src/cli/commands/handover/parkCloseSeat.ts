/**
 * `handover park`'s last act: park the seat through the session harness seam, which records its ledger row closed,
 * then reap what its worktree left. Split from `./parkRun.ts`, which journals the park before calling this, because
 * a seat parking itself does not outlive the close.
 */

import type { CmuxWorkspaceSummary } from "../../../cmux/client.js";
import { parkCloseMode } from "../../../handover/parkPolicy.js";
import { err, ok, type Result } from "../../../lib/result.js";
import type { CmuxHostSurface } from "../../../sessionHarness/cmuxHost.js";
import { sessionFromCmux } from "../../../sessionHarness/cmuxSession.js";
import { recordingSessionHarness } from "../../../sessionHarness/recordingHarness.js";
import type { SessionHarness } from "../../../sessionHarness/sessionHarness.js";
import { sessionLedgerDeps } from "../../../sessionHarness/sessionLedger.js";
import { openSessionKeyFor } from "../cmux/run.js";
import { reapClosedSeat, renderResidueReport } from "../cmux/worktreeResidue.js";
import type { ParkFailure } from "./parkFailure.js";

/**
 * Park the seat and reap its residue. The recording harness writes the row's close — before the park for a seat
 * parking ITSELF, which does not outlive it, and only off a park that went through for any other. Which park is
 * `parkCloseMode`'s: forced for its own seat or a hatch-forced one, bounded by a fresh screen proof otherwise.
 *
 * @param callerWorkspaceId the workspace the verb runs in, which decides whether the seat is parking itself
 * @param forced whether only the hatch let the seat be closed
 * @param harness the seam's harness over the host's connection, which the recorder wraps
 * @param home the state home whose session ledger records the row's close
 * @returns the residue report lines, or the failure the park met — journalled either way
 */
export async function closeSeat({
  callerWorkspaceId,
  client,
  forced,
  harness: hostHarness,
  home,
  seat,
}: {
  callerWorkspaceId: string | undefined;
  client: CmuxHostSurface;
  forced: boolean;
  harness: SessionHarness;
  home: string;
  seat: CmuxWorkspaceSummary;
}): Promise<Result<readonly string[], ParkFailure>> {
  const harness = recordingSessionHarness({
    callerSessionId: callerWorkspaceId,
    harness: hostHarness,
    ledger: sessionLedgerDeps({ home }),
  });
  const own = seat.workspaceId === callerWorkspaceId;
  // The row's key is read BEFORE the park: the recorder closes the row once the park goes through, and the reap
  // below subtracts this key from the worktree's live holders, so a key read after it would find no open row.
  const sessionKeyBeforePark = openSessionKeyFor({ home, workspaceRef: seat.workspaceRef });
  const parked = await harness.park({
    mode: parkCloseMode({ hatchForced: forced, own }),
    target: { session: sessionFromCmux({ workspace: seat }) },
  });
  if (parked.isErr()) {
    return err({ error: parked.error, journalled: true, kind: "cmux" });
  }
  if (parked.value.kind === "held") {
    return err({
      journalled: true,
      kind: "held",
      verdict: parked.value.reason,
      workspaceRef: parked.value.session.handle,
    });
  }
  const { session } = parked.value;
  const reaped = await reapClosedSeat({
    client,
    currentDirectory: session.directory,
    home,
    ref: session.handle,
    sessionKeyFor: () => sessionKeyBeforePark,
    workspaceId: session.id,
  });
  return ok(renderResidueReport({ dryRun: false, report: reaped.residue, verb: "handover park" }));
}
