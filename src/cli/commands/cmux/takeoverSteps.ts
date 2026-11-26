/**
 * `cmux takeover`'s steps 4–6, once `./takeoverHosts.ts` has gated the predecessor: release it, seat this session,
 * close it, and record its board row closed — for every pairing of hosts that file's table names.
 */
import { SUPERVISOR_WORKSPACE_TITLE } from "../../../cmux/supervisorWorkspace.js";
import { logger } from "../../../lib/logger.js";
import { readProcessTableWhole } from "../../../live/standing/inspect.js";
import type { CmuxHostSurface } from "../../../sessionHarness/cmuxHost.js";
import type { SessionHarness } from "../../../sessionHarness/sessionHarness.js";
import { appPinLabel } from "../../../supervisor/appPin.js";
import type { VisibleSupervisorSession } from "../../../supervisor/session.js";
import type { TakeoverCaller } from "../../../supervisor/takeoverSeat.js";
import { EXIT_ERROR, EXIT_OK } from "../../exitCodes.js";
import {
  forgetAppSupervisor,
  forgetUnpinnedSupervisor,
  recordAppSupervisorPin,
  recordSupervisorPin,
  type StaleRecordOutcome,
} from "./recordPin.js";
import { runAppTakeoverStep5, runTakeoverStep5 } from "./takeoverClose.js";
import { endGonePredecessorRow } from "./takeoverGone.js";
import { type GatedPredecessor, predecessorLabel } from "./takeoverHosts.js";
import { recordPredecessorRowClosed } from "./takeoverRow.js";

/**
 * Step 4's first half: take the seat off the predecessor. A cmux workspace is unpinned and its record forgotten; an
 * app or gone predecessor's exact record is removed, which is the only pin it still has.
 *
 * @returns true when the seat is free, false when the step printed why it stopped
 */
async function releasePredecessor({
  client,
  home,
  predecessor,
}: {
  client: CmuxHostSurface;
  home: string | undefined;
  predecessor: GatedPredecessor;
}): Promise<boolean> {
  if (predecessor.kind === "cmux") {
    const unpinned = await client.unpinWorkspace({ workspaceId: predecessor.workspace.workspaceId });
    if (unpinned.isErr()) {
      logger.error({ msg: `cmux takeover: ${unpinned.error.message}` });
      return false;
    }
    forgetUnpinnedSupervisor({
      unpinnedWorkspaceId: predecessor.workspace.workspaceId,
      ...(home === undefined ? {} : { home }),
    });
    logger.out({ line: `cmux takeover: step 4/6 — unpinned ${predecessor.workspace.workspaceRef}` });
    return true;
  }
  const label = predecessorLabel({ predecessor });
  if (forgetPredecessorRecord({ home, predecessor }) === "failed") {
    logger.error({ msg: `cmux takeover: ${label}'s supervisor pin record would not go, so nothing moved` });
    return false;
  }
  logger.out({ line: `cmux takeover: step 4/6 — removed ${label}'s supervisor pin record` });
  return true;
}

/**
 * Remove the exact record an app or gone predecessor holds the seat by: the app arm by its session id, a gone cmux
 * chair's by its workspace id, which cmux no longer lists to unpin.
 *
 * @returns what removing it came to
 */
function forgetPredecessorRecord({
  home,
  predecessor,
}: {
  home: string | undefined;
  predecessor: Exclude<GatedPredecessor, { readonly kind: "cmux" }>;
}): StaleRecordOutcome {
  const homeOption = home === undefined ? {} : { home };
  if (predecessor.kind === "app") {
    return forgetAppSupervisor({ appSessionId: predecessor.appSessionId, ...homeOption });
  }
  const { target } = predecessor;
  if (target.kind === "app") {
    return forgetAppSupervisor({ appSessionId: target.appSessionId, ...homeOption });
  }
  return forgetUnpinnedSupervisor({ unpinnedWorkspaceId: target.workspaceId, ...homeOption });
}

/**
 * Step 5 for any predecessor: close a cmux one in cmux, an app one through the desktop app, and end a gone one's
 * ledger row, since no host holds it to close.
 *
 * @returns true when it closed, or was gone and its ledger row ended
 */
async function closePredecessor({
  appHarness,
  client,
  home,
  predecessor,
}: {
  appHarness: Pick<SessionHarness, "close">;
  client: CmuxHostSurface;
  home: string | undefined;
  predecessor: GatedPredecessor;
}): Promise<boolean> {
  if (predecessor.kind === "cmux") {
    return runTakeoverStep5({
      client,
      home,
      predecessorId: predecessor.workspace.workspaceId,
      predecessorRef: predecessor.workspace.workspaceRef,
      predecessorRow: predecessor.run.row,
      processTable: readProcessTableWhole,
    });
  }
  if (predecessor.kind === "gone") {
    return endGonePredecessorRow({ home, nowIso: new Date().toISOString(), run: predecessor.run });
  }
  return runAppTakeoverStep5({
    harness: appHarness,
    home,
    label: predecessor.label,
    row: predecessor.run.row,
    target: predecessor.target,
  });
}

/**
 * Step 4's second half for a cmux successor: pin and title THIS workspace, then scope the supervisor depth guard to
 * it. It answers with the ref the successor is really known by, for step 6's witness; `resolveWorkspace` failing
 * is not a reason to stop a handoff whose pin has already moved, since the id names the same workspace.
 *
 * @returns this session's label, or the message that stops the takeover
 */
async function seatCmuxSession({
  client,
  home,
  ownWorkspaceId,
  session,
}: {
  client: CmuxHostSurface;
  home: string | undefined;
  ownWorkspaceId: string;
  session: VisibleSupervisorSession;
}): Promise<{ readonly failure: string } | { readonly label: string }> {
  const pinned = await client.pinWorkspace({ workspaceId: ownWorkspaceId });
  if (pinned.isErr()) {
    return { failure: pinned.error.message };
  }
  const renamed = await client.renameWorkspace({ title: SUPERVISOR_WORKSPACE_TITLE, workspaceId: ownWorkspaceId });
  if (renamed.isErr()) {
    return { failure: renamed.error.message };
  }
  logger.out({ line: `cmux takeover: step 4/6 — pinned and titled this session (${SUPERVISOR_WORKSPACE_TITLE})` });
  const resolved = await client.resolveWorkspace({ ref: ownWorkspaceId });
  const ownRef = resolved.isOk() ? resolved.value.workspaceRef : ownWorkspaceId;
  const recorded = recordSupervisorPin({
    detection: { kind: "active", session },
    nowIso: new Date().toISOString(),
    ownWorkspaceId,
    ...(home === undefined ? {} : { home }),
    pinnedWorkspaceId: ownWorkspaceId,
    workspaceRef: ownRef,
  });
  logger.out({
    line: `cmux takeover: step 4/6 — supervisor depth guard ${recorded ? "now scoped to this session" : "NOT recorded (the write failed, see above) — this session is unguarded"}`,
  });
  return { label: ownRef };
}

/**
 * Step 4's second half for an app successor: write its pin record. That record IS the seat, since cmux cannot pin
 * an app session, so a write that fails stops the takeover before the predecessor is closed.
 *
 * @returns this session's label, or the message that stops the takeover
 */
function seatAppSession({
  appSessionId,
  home,
  session,
}: {
  appSessionId: string;
  home: string | undefined;
  session: VisibleSupervisorSession;
}): { readonly failure: string } | { readonly label: string } {
  const label = appPinLabel({ appSessionId });
  const recorded = recordAppSupervisorPin({
    appSessionId,
    nowIso: new Date().toISOString(),
    session,
    ...(home === undefined ? {} : { home }),
  });
  if (!recorded) {
    return { failure: `${label}'s supervisor pin record would not write, so no session holds the seat now` };
  }
  logger.out({ line: `cmux takeover: step 4/6 — recorded ${label} as the supervisor` });
  return { label };
}

/**
 * Steps 4–6 for any pairing of hosts: release the predecessor, seat this session, close the predecessor, and record
 * its board row closed. Step 6 runs whatever step 5 did: the seat has moved and gate (c) read the run finished, so the
 * chair is retired whether or not it closed (`./takeoverRow.ts`).
 *
 * @param appHarness the app session harness, of which only `close` is used here
 * @param caller the session taking the seat
 * @param client the takeover's cmux connection
 * @param home the state home everything is recorded under
 * @param predecessor the gated predecessor
 * @param session the visible session the pin record names
 * @returns the process exit code
 */
export async function performTakeover({
  appHarness,
  caller,
  client,
  home,
  predecessor,
  session,
}: {
  appHarness: Pick<SessionHarness, "close">;
  caller: TakeoverCaller;
  client: CmuxHostSurface;
  home: string | undefined;
  predecessor: GatedPredecessor;
  session: VisibleSupervisorSession;
}): Promise<number> {
  if (!(await releasePredecessor({ client, home, predecessor }))) {
    return EXIT_ERROR;
  }
  const seated =
    caller.kind === "cmux"
      ? await seatCmuxSession({ client, home, ownWorkspaceId: caller.workspaceId, session })
      : seatAppSession({ appSessionId: caller.appSessionId, home, session });
  if ("failure" in seated) {
    logger.error({ msg: `cmux takeover: ${seated.failure}` });
    return EXIT_ERROR;
  }
  const closed = await closePredecessor({ appHarness, client, home, predecessor });
  recordPredecessorRowClosed({ home, predecessorSlug: predecessor.run.slug, successorLabel: seated.label });
  return closed ? EXIT_OK : EXIT_ERROR;
}
