/**
 * `cmux takeover`'s host-dependent gates for every pairing of hosts: a cmux workspace or a session the desktop app
 * hosts, as the predecessor and as the successor. `./takeover.ts` keeps the gates that never depended on the host and
 * calls in here for the rest; steps 4–6 are `./takeoverSteps.ts`.
 *
 * | Predecessor | Successor | Step 4 |
 * | ----------- | --------- | ------ |
 * | cmux | cmux | unpin it, forget its record, pin and title this workspace, record it — as before the app arm |
 * | cmux | app | unpin it, forget its record, record this app session; no title, the app titled the card at launch |
 * | app | cmux | remove its exact record, pin and title this workspace, record it |
 * | app | app | remove its exact record, record this app session |
 * | gone, either host | either | remove its exact record, seat this session as above; step 5 ends its ledger row |
 *
 * No cmux pin, unpin or rename is ever called for an app session, and an app predecessor is closed only through
 * the session harness's own close (`./takeoverClose.ts`): nothing here reads a pid or kills a process. The app owns
 * its sessions' process groups.
 */
import type { CmuxWorkspaceSummary } from "../../../cmux/client.js";
import { logger } from "../../../lib/logger.js";
import { type AppSessionClaim, verifyAppSessionOrigin } from "../../../sessionHarness/appSessionOrigin.js";
import type { AppTransport } from "../../../sessionHarness/appSocketTransport.js";
import type { CmuxHostSurface } from "../../../sessionHarness/cmuxHost.js";
import type { HarnessTarget, SessionHarness } from "../../../sessionHarness/sessionHarness.js";
import type { CmuxSupervisorPinRecord, SupervisorPinTarget } from "../../../sessions/supervisorPin.js";
import { readSupervisorPinDisposition } from "../../../sessions/supervisorPinStore.js";
import { appPinLabel } from "../../../supervisor/appPin.js";
import { goneCmuxConfirmation, gonePredecessorLabel } from "../../../supervisor/gonePredecessor.js";
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
import { EXIT_ERROR } from "../../exitCodes.js";
import { answeredPictureOf } from "./picture.js";
import { type GonePredecessorRun, gonePredecessorRunGate } from "./takeoverGone.js";
import {
  type AppPredecessorRun,
  appPredecessorRunGate,
  type PredecessorRun,
  predecessorRunGate,
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
    }
  | { readonly kind: "gone"; readonly target: SupervisorPinTarget; readonly run: GonePredecessorRun };

/**
 * Gates (b) and (c): resolve the predecessor from cmux's own pin or the app record
 * (`../../../supervisor/takeoverSeat.ts`), resolve an app one live by its exact id, then confirm its run finished.
 * The cmux inventory is read once and paired against the ledger whole, as before. A record whose host no longer
 * holds the session — cmux no longer lists the workspace, or the app answers `SESSION_NOT_FOUND` — is a GONE
 * predecessor, gated by the same terminal-run test (`./takeoverGone.ts`). A cmux one is called gone only once the
 * STRICT inventory, which fails where the everyday one drops a row, also lists no workspace with its id.
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
  if (choice.value.kind === "gone-cmux") {
    return goneCmuxGate({ client, home, pin: choice.value.pin });
  }
  const { appSessionId } = choice.value.pin;
  const label = appPinLabel({ appSessionId });
  const resolved = await appHarness.resolve({ handle: label });
  if (resolved.isErr() && resolved.error.code === "SESSION_NOT_FOUND") {
    return goneGate({ home, target: { appSessionId, kind: "app" } });
  }
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

/**
 * Gates (b) and (c) for a cmux record the everyday inventory does not list: called gone only once the strict
 * inventory reads whole and lists no workspace with its id, then gated as any gone predecessor.
 */
async function goneCmuxGate({
  client,
  home,
  pin,
}: {
  client: CmuxHostSurface;
  home: string | undefined;
  pin: CmuxSupervisorPinRecord;
}): Promise<GatedPredecessor | number> {
  const target = { kind: "cmux", workspaceId: pin.workspaceId, workspaceRef: pin.workspaceRef } as const;
  const confirmed = goneCmuxConfirmation({ inventory: await client.listWorkspacesStrict(), target });
  if (confirmed.isErr()) {
    return refused({ line: confirmed.error.message });
  }
  return goneGate({ home, target });
}

/** Gates (b) and (c) for a predecessor its host no longer holds: resolved as gone, then its run read finished. */
function goneGate({
  home,
  target,
}: {
  home: string | undefined;
  target: SupervisorPinTarget;
}): GatedPredecessor | number {
  logger.out({
    line: `cmux takeover: step 2/6 — predecessor resolved: ${gonePredecessorLabel({ target })}, which its host no longer holds`,
  });
  const run = gonePredecessorRunGate({ home, target });
  return "refusal" in run ? refused({ line: run.refusal }) : { kind: "gone", run, target };
}

/** Print one refusal and answer the exit code that stops the takeover. */
function refused({ line }: { line: string }): number {
  logger.error({ msg: `cmux takeover: refusing — ${line}` });
  return EXIT_ERROR;
}

/**
 * The predecessor's name as every step line prints it.
 *
 * @param predecessor the gated predecessor
 * @returns its workspace ref, or its app or gone label
 */
export function predecessorLabel({ predecessor }: { predecessor: GatedPredecessor }): string {
  if (predecessor.kind === "cmux") {
    return predecessor.workspace.workspaceRef;
  }
  if (predecessor.kind === "gone") {
    return predecessor.run.label;
  }
  return predecessor.label;
}

/** What `--dry-run` names for releasing the predecessor and closing it, per where it is. */
function releaseAndClose({ predecessor, name }: { predecessor: GatedPredecessor; name: string }): {
  readonly release: string;
  readonly close: string;
} {
  if (predecessor.kind === "cmux") {
    return {
      close: `close ${name} (forced only when its screen proves it idle, or its one background work is a keep-alive another watch covers)`,
      release: `unpin ${name}`,
    };
  }
  if (predecessor.kind === "gone") {
    return {
      close: `end ${name}'s ledger row, since its host no longer holds it`,
      release: `remove ${name}'s supervisor pin record`,
    };
  }
  return {
    close: `close ${name} through the desktop app, which holds a session it cannot prove finished`,
    release: `remove ${name}'s supervisor pin record`,
  };
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
  const { release, close } = releaseAndClose({ name, predecessor });
  const seat =
    caller.kind === "cmux"
      ? "pin+title this session"
      : `record ${appPinLabel({ appSessionId: caller.appSessionId })} as the supervisor`;
  return `cmux takeover: --dry-run — would ${release}, ${seat}, ${close}, then close ${predecessor.run.slug}'s board row either way`;
}
