/**
 * `cmux takeover`'s steps 1–6 for every pairing of hosts: a cmux workspace or a session the desktop app hosts, as
 * the predecessor and as the successor. `./takeover.ts` keeps the gates that never depended on the host and calls
 * in here for the rest.
 *
 * | Predecessor | Successor | Step 4 |
 * | ----------- | --------- | ------ |
 * | cmux | cmux | unpin it, forget its record, pin and title this workspace, record it — as before the app arm |
 * | cmux | app | unpin it, forget its record, record this app session; no title, the app titled the card at launch |
 * | app | cmux | remove its exact record, pin and title this workspace, record it |
 * | app | app | remove its exact record, record this app session |
 *
 * No cmux pin, unpin or rename is ever called for an app session, and an app predecessor is closed only through
 * the session harness's own close (`./takeoverClose.ts`): nothing here reads a pid or kills a process. The app owns
 * its sessions' process groups.
 */
import type { CmuxWorkspaceSummary } from "../../../cmux/client.js";
import { SUPERVISOR_WORKSPACE_TITLE } from "../../../cmux/supervisorWorkspace.js";
import { logger } from "../../../lib/logger.js";
import { readProcessTableWhole } from "../../../live/standing/inspect.js";
import { type AppSessionClaim, verifyAppSessionOrigin } from "../../../sessionHarness/appSessionOrigin.js";
import type { AppTransport } from "../../../sessionHarness/appSocketTransport.js";
import type { CmuxHostSurface } from "../../../sessionHarness/cmuxHost.js";
import type { HarnessTarget, SessionHarness } from "../../../sessionHarness/sessionHarness.js";
import { readSupervisorPinDisposition } from "../../../sessions/supervisorPinStore.js";
import { appPinLabel } from "../../../supervisor/appPin.js";
import type { VisibleSupervisorSession } from "../../../supervisor/session.js";
import {
  type AppSweepLeg,
  appSweepGateOutcome,
  appSweepLeg,
  resolveTakeoverPredecessor,
  type TakeoverCaller,
  TakeoverResolutionErrors,
} from "../../../supervisor/takeoverSeat.js";
import { claudeProjectsDir } from "../../../transcripts/source.js";
import { EXIT_ERROR, EXIT_OK } from "../../exitCodes.js";
import { answeredPictureOf } from "./picture.js";
import {
  forgetAppSupervisor,
  forgetUnpinnedSupervisor,
  recordAppSupervisorPin,
  recordSupervisorPin,
} from "./recordPin.js";
import { runAppTakeoverStep5, runTakeoverStep5 } from "./takeoverClose.js";
import {
  type AppPredecessorRun,
  appPredecessorRunGate,
  type PredecessorRun,
  predecessorRunGate,
  recordPredecessorRowClosed,
} from "./takeoverRow.js";
import { readTranscriptLeg } from "./takeoverTranscript.js";

/** How long the app has to answer the caller's own picture read. */
const APP_PICTURE_TIMEOUT_MS = 5_000;

/**
 * Gate (a) for a caller the desktop app hosts: the app must vouch that this process runs the session it claims, and
 * the caller's own picture — else its transcript — must show the sweep armed.
 *
 * @param claim the app session this process claims
 * @param session the visible session the takeover detected
 * @param transport the request channel to the app's control plane
 * @returns the caller, or the exit code of the refusal already printed
 */
export async function appCallerSweepGate({
  claim,
  session,
  transport,
}: {
  claim: AppSessionClaim;
  session: VisibleSupervisorSession;
  transport: AppTransport;
}): Promise<TakeoverCaller | number> {
  const vouched = await verifyAppSessionOrigin({ claim, transport });
  if (vouched.isErr()) {
    logger.error({
      msg: `cmux takeover: refusing — the desktop app did not vouch for this session: ${vouched.error.message}`,
    });
    return EXIT_ERROR;
  }
  const answered = answeredPictureOf({
    answered: await transport({
      request: { handle: appPinLabel({ appSessionId: claim.appSessionId }), kind: "picture.read" },
      timeoutMs: APP_PICTURE_TIMEOUT_MS,
    }),
  });
  const picture: AppSweepLeg =
    answered.kind === "picture"
      ? appSweepLeg({ appSessionId: claim.appSessionId, picture: answered.picture })
      : { kind: "unread", why: answered.line };
  const outcome =
    picture.kind === "witnessed"
      ? appSweepGateOutcome({ picture, transcript: undefined })
      : appSweepGateOutcome({
          picture,
          transcript: readTranscriptLeg({ env: process.env, projectsDir: claudeProjectsDir(), session }),
        });
  if (!outcome.armed) {
    logger.error({ msg: `cmux takeover: refusing — ${outcome.refusal}` });
    return EXIT_ERROR;
  }
  logger.out({ line: `cmux takeover: step 1/6 — sweep armed: yes (${outcome.witness})` });
  return { appSessionId: claim.appSessionId, kind: "app" };
}

/** The predecessor once gates (b) and (c) passed: where it is, and the run and ledger row it answers to. */
export type GatedPredecessor =
  | { readonly kind: "cmux"; readonly workspace: CmuxWorkspaceSummary; readonly run: PredecessorRun }
  | {
      readonly kind: "app";
      readonly appSessionId: string;
      readonly label: string;
      readonly target: HarnessTarget;
      readonly run: AppPredecessorRun;
    };

/**
 * Gates (b) and (c): resolve the predecessor from cmux's own pin or the app record
 * (`../../../supervisor/takeoverSeat.ts`), resolve an app one live by its exact id, then confirm its run finished.
 * The cmux inventory is read once and paired against the ledger whole, as before.
 *
 * @param appHarness the app session harness, of which only `resolve` is used here
 * @param caller the session taking the seat
 * @param client the takeover's cmux connection
 * @param home the state home the pin record, ledger and journals live under
 * @returns the gated predecessor, or the exit code of the refusal already printed
 */
export async function predecessorGates({
  appHarness,
  caller,
  client,
  home,
}: {
  appHarness: Pick<SessionHarness, "resolve">;
  caller: TakeoverCaller;
  client: CmuxHostSurface;
  home: string | undefined;
}): Promise<GatedPredecessor | number> {
  const workspaces = await client.listWorkspaces();
  if (workspaces.isErr()) {
    logger.error({ msg: `cmux takeover: ${workspaces.error.message}` });
    return EXIT_ERROR;
  }
  const choice = resolveTakeoverPredecessor({
    caller,
    disposition: readSupervisorPinDisposition(home === undefined ? {} : { home }),
    workspaces: workspaces.value,
  });
  if (choice.isErr()) {
    return refused({ line: choice.error.message });
  }
  if (choice.value.kind === "cmux") {
    const predecessor = choice.value.workspace;
    logger.out({ line: `cmux takeover: step 2/6 — predecessor resolved: ${predecessor.workspaceRef}` });
    const run = predecessorRunGate({ home, predecessor, workspaces: workspaces.value });
    return "refusal" in run ? refused({ line: run.refusal }) : { kind: "cmux", run, workspace: predecessor };
  }
  const { appSessionId } = choice.value.pin;
  const label = appPinLabel({ appSessionId });
  const resolved = await appHarness.resolve({ handle: label });
  if (resolved.isErr()) {
    return refused({ line: TakeoverResolutionErrors.appNotLive({ label, why: resolved.error.message }).message });
  }
  logger.out({ line: `cmux takeover: step 2/6 — predecessor resolved: ${label}` });
  const run = appPredecessorRunGate({ appSessionId, directory: resolved.value.session.directory, home });
  if ("refusal" in run) {
    return refused({ line: run.refusal });
  }
  return { appSessionId, kind: "app", label, run, target: resolved.value };
}

/** Print one refusal and answer the exit code that stops the takeover. */
function refused({ line }: { line: string }): number {
  logger.error({ msg: `cmux takeover: refusing — ${line}` });
  return EXIT_ERROR;
}

/** The predecessor's name as every step line prints it. */
function predecessorLabel({ predecessor }: { predecessor: GatedPredecessor }): string {
  return predecessor.kind === "cmux" ? predecessor.workspace.workspaceRef : predecessor.label;
}

/**
 * What `--dry-run` says the takeover would do, naming only the acts this pairing of hosts really takes.
 *
 * @param caller the session taking the seat
 * @param predecessor the gated predecessor
 * @returns the one line
 */
export function takeoverDryRunLine({
  caller,
  predecessor,
}: {
  caller: TakeoverCaller;
  predecessor: GatedPredecessor;
}): string {
  const name = predecessorLabel({ predecessor });
  const release = predecessor.kind === "cmux" ? `unpin ${name}` : `remove ${name}'s supervisor pin record`;
  const seat =
    caller.kind === "cmux"
      ? "pin+title this session"
      : `record ${appPinLabel({ appSessionId: caller.appSessionId })} as the supervisor`;
  const close =
    predecessor.kind === "cmux"
      ? `close ${name} (forced only when its screen proves it idle, or its one background work is a keep-alive another watch covers)`
      : `close ${name} through the desktop app, which holds a session it cannot prove finished`;
  return `cmux takeover: --dry-run — would ${release}, ${seat}, ${close}, then close ${predecessor.run.slug}'s board row either way`;
}

/**
 * Step 4's first half: take the seat off the predecessor. A cmux workspace is unpinned and its record forgotten; an
 * app session's exact record is removed, which is the only pin it ever had.
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
  const homeOption = home === undefined ? {} : { home };
  if (predecessor.kind === "cmux") {
    const unpinned = await client.unpinWorkspace({ workspaceId: predecessor.workspace.workspaceId });
    if (unpinned.isErr()) {
      logger.error({ msg: `cmux takeover: ${unpinned.error.message}` });
      return false;
    }
    forgetUnpinnedSupervisor({ unpinnedWorkspaceId: predecessor.workspace.workspaceId, ...homeOption });
    logger.out({ line: `cmux takeover: step 4/6 — unpinned ${predecessor.workspace.workspaceRef}` });
    return true;
  }
  if (forgetAppSupervisor({ appSessionId: predecessor.appSessionId, ...homeOption }) === "failed") {
    logger.error({ msg: `cmux takeover: ${predecessor.label}'s supervisor pin record would not go, so nothing moved` });
    return false;
  }
  logger.out({ line: `cmux takeover: step 4/6 — removed ${predecessor.label}'s supervisor pin record` });
  return true;
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
  const closed =
    predecessor.kind === "cmux"
      ? await runTakeoverStep5({
          client,
          home,
          predecessorId: predecessor.workspace.workspaceId,
          predecessorRef: predecessor.workspace.workspaceRef,
          predecessorRow: predecessor.run.row,
          processTable: readProcessTableWhole,
        })
      : await runAppTakeoverStep5({
          harness: appHarness,
          home,
          label: predecessor.label,
          row: predecessor.run.row,
          target: predecessor.target,
        });
  recordPredecessorRowClosed({ home, predecessorSlug: predecessor.run.slug, successorLabel: seated.label });
  return closed ? EXIT_OK : EXIT_ERROR;
}
