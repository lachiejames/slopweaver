/**
 * `slopweaver cmux pin` / `slopweaver cmux unpin` — move the sidebar pin that tells a supervised session the
 * supervisor from a peer (`.claude/rules/cross-session-messages.md`), without the owner's own click.
 *
 * The pin is what `workspace.action`'s own `pin`/`unpin` actions already write (`./run.ts`'s `renameWorkspace`
 * is the same call shape for `rename`). What this verb adds is the refusal cmux itself does not have —
 * `../../../cmux/pin.js`'s `pinCollisionRefusal`, measured to be genuinely necessary: pinning a
 * second workspace left cmux reporting BOTH `pinned: true`. Every arm runs under the supervisor-pin lock
 * (`../../../supervisor/pinLock.ts`), so that check and the pin it allows are one step.
 */
import { slopweaverHome } from "../../../homeDir.js";
import { logger } from "../../../lib/logger.js";
import { type AppSessionClaim, appSessionClaim } from "../../../sessionHarness/appSessionOrigin.js";
import { APP_SOCKET_ROOT, socketAppTransport } from "../../../sessionHarness/appSocketTransport.js";
import {
  listCmuxWorkspacesThrough,
  listLiveCmuxWorkspaces,
  withCmuxSessionHost,
} from "../../../sessionHarness/cmuxHost.js";
import { readSupervisorPinDisposition } from "../../../sessions/supervisorPinStore.js";
import { acquireSupervisorPinLock, type HoldSupervisorPinLock } from "../../../supervisor/pinLock.js";
import { detectSupervisorSession } from "../../../supervisor/session.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK } from "../../exitCodes.js";
import { parseCmuxVerb, stringFlag } from "./core.js";
import { pinAppSession } from "./pinApp.js";
import { pinCmuxWorkspace, unpinCmuxWorkspace } from "./pinWorkspace.js";
import { forgetUnpinnedSupervisor, recordAppSupervisorPin, recordSupervisorPin } from "./recordPin.js";
import { targetWorkspaceId } from "./run.js";

/** The production supervisor-pin lock: the resolved home's, stamped now. */
const holdPinLock: HoldSupervisorPinLock = () =>
  acquireSupervisorPinLock({ home: slopweaverHome(), nowIso: new Date().toISOString() });

/**
 * `cmux pin` — pin a workspace, refusing when a DIFFERENT one is already pinned rather than leaving two.
 *
 * @param argv the full process argv
 * @returns the process exit code
 */
export async function runCmuxPin(argv: readonly string[]): Promise<number> {
  const parsed = parseCmuxVerb({ argv, verb: "pin" });
  if (typeof parsed === "number") {
    return parsed;
  }
  const workspaceRef = stringFlag({ name: "workspace", parsed });
  // A bare pin from inside an app-hosted session records that session; `--workspace` always names a cmux workspace.
  if (workspaceRef === undefined) {
    const claim = appSessionClaim({ detection: detectSupervisorSession({ env: process.env }), env: process.env });
    if (claim.isErr()) {
      logger.error({ msg: `cmux pin: ${claim.error.message}` });
      return EXIT_ERROR;
    }
    if (claim.value !== undefined) {
      return runAppPin({ claim: claim.value });
    }
  }
  return runCmuxWorkspacePin({ workspaceRef });
}

/**
 * The cmux arm of `cmux pin`: pin the named workspace, or this process's own, refusing a second pinned workspace
 * and refusing outright while the pin record names an app session, which cmux cannot see.
 *
 * @param workspaceRef the `--workspace` value, or `undefined` to pin this process's own workspace
 * @returns the process exit code
 */
async function runCmuxWorkspacePin({ workspaceRef }: { workspaceRef: string | undefined }): Promise<number> {
  const pinned = await withCmuxSessionHost({
    // Every failure stays its own typed value until the one line below that prints it. The inventory, the record
    // check, the pin and the record write are one critical section under the supervisor-pin lock.
    body: ({ harness, host }) =>
      pinCmuxWorkspace({
        deps: {
          holdPinLock,
          listWorkspaces: () => listCmuxWorkspacesThrough({ harness }),
          nowIso: () => new Date().toISOString(),
          pinWorkspace: (options) => host.pinWorkspace(options),
          readDisposition: () => readSupervisorPinDisposition(),
          recordPin: ({ nowIso, ownWorkspaceId, pinnedWorkspaceId, workspaceRef: ref }) =>
            recordSupervisorPin({
              detection: detectSupervisorSession({ env: process.env }),
              nowIso,
              ownWorkspaceId,
              pinnedWorkspaceId,
              workspaceRef: ref,
            }),
          targetWorkspaceId: ({ workspaceRef: named }) =>
            targetWorkspaceId({ env: process.env, harness, workspaceRef: named }),
        },
        workspaceRef,
      }),
  });
  if (pinned.isErr()) {
    logger.error({ msg: `cmux pin: ${pinned.error.message}` });
    return EXIT_ERROR;
  }
  logger.out({ line: `cmux pin: pinned ${pinned.value.ref}` });
  if (pinned.value.self) {
    logger.out({ line: "cmux pin: recorded this session as the supervisor for the depth guard" });
  }
  return EXIT_OK;
}

/**
 * The app arm of `cmux pin`, over the production seams: the app's socket, one cmux listing, the strict pin record.
 *
 * @param claim the app session this process claims
 * @returns the process exit code
 */
async function runAppPin({ claim }: { claim: AppSessionClaim }): Promise<number> {
  const pinned = await pinAppSession({
    claim,
    deps: {
      holdPinLock,
      nowIso: () => new Date().toISOString(),
      pinnedWorkspaceRefs: async () =>
        (await listLiveCmuxWorkspaces())
          .map((workspaces) =>
            workspaces.filter((workspace) => workspace.pinned).map((workspace) => workspace.workspaceRef),
          )
          .mapErr((error) => ({ message: error.message })),
      readDisposition: () => readSupervisorPinDisposition(),
      record: ({ appSessionId, session, nowIso }) => recordAppSupervisorPin({ appSessionId, nowIso, session }),
      transport: socketAppTransport({ root: APP_SOCKET_ROOT }),
    },
  });
  if (pinned.isErr()) {
    logger.error({ msg: `cmux pin: ${pinned.error.message}` });
    return EXIT_ERROR;
  }
  if (!pinned.value.wrote) {
    logger.out({ line: `cmux pin: ${pinned.value.label} is already recorded as the supervisor` });
    return EXIT_OK;
  }
  logger.out({ line: `cmux pin: recorded ${pinned.value.label}, the app session this runs in, as the supervisor` });
  return EXIT_OK;
}

/**
 * `cmux unpin` — unpin a workspace. Idempotent: unpinning an already-unpinned workspace is a no-op success,
 * since a caller (a handoff's successor, unpinning its predecessor before pinning itself) cannot know which
 * state it is in without a read it has no other reason to make.
 *
 * @param argv the full process argv
 * @returns the process exit code
 */
export async function runCmuxUnpin(argv: readonly string[]): Promise<number> {
  const parsed = parseCmuxVerb({ argv, verb: "unpin" });
  if (typeof parsed === "number") {
    return parsed;
  }
  const unpinned = await withCmuxSessionHost({
    body: ({ harness, host }) =>
      unpinCmuxWorkspace({
        deps: {
          forgetRecord: ({ unpinnedWorkspaceId }) => forgetUnpinnedSupervisor({ unpinnedWorkspaceId }),
          holdPinLock,
          label: async ({ workspaceId }) => {
            const resolved = await harness.resolve({ handle: workspaceId });
            return resolved.isOk() ? resolved.value.session.handle : workspaceId;
          },
          targetWorkspaceId: ({ workspaceRef }) => targetWorkspaceId({ env: process.env, harness, workspaceRef }),
          unpinWorkspace: (options) => host.unpinWorkspace(options),
        },
        workspaceRef: stringFlag({ name: "workspace", parsed }),
      }),
  });
  if (unpinned.isErr()) {
    logger.error({ msg: `cmux unpin: ${unpinned.error.message}` });
    return EXIT_ERROR;
  }
  logger.out({ line: `cmux unpin: unpinned ${unpinned.value.label}` });
  return unpinned.value.stale === "failed" ? EXIT_ERROR : EXIT_OK;
}

export const cmuxPinCommand = defineCommand({ run: runCmuxPin });

export const cmuxUnpinCommand = defineCommand({ run: runCmuxUnpin });
