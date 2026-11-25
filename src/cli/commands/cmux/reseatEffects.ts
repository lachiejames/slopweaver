/**
 * The production effects one `cmux reseat` pass runs on — the process table, the stop, the registry, the routing
 * gate and the boot credential — shared by `./reseat.ts` (the verb) and `fleet resume`, which reseats through the
 * same effects. What a pass decides is `../../../sessions/reseat.ts`; the pass and its order are `./reseatPass.ts`.
 */
import { existsSync } from "node:fs";
import { basename } from "node:path";

import { err, ok, type Result } from "#lib/result.js";

import { acquireOperationLockDetailed, type DetailedOperationLockResult } from "../../../admit/operationLock.js";
import { resolveAmbientCredential } from "../../../claude/ambientCredentialRead.js";
import type { ClaudeRotationError } from "../../../claude/errors.js";
import { type ClaudePlanProbesPort, claudePlanProbesPort } from "../../../claude/planProbes.js";
import { bootCredentialForStore } from "../../../claude/seatToken.js";
import { gateSpawnStore, spentPlanHatchOpen, unreadablePlanHatchOpen } from "../../../claude/spawnStore.js";
import { ALLOW_SPENT_PLAN_ENV, ALLOW_UNREADABLE_PLAN_ENV } from "../../../claude/spawnStoreRefusals.js";
import { fleetEnvPrefix } from "../../../cmux/fleetEnv.js";
import { pluginDirForSpawnTarget } from "../../../cmux/pluginDir.js";
import { liveSeatsFromScan, wholeRegistry } from "../../../fleet/liveSeat.js";
import { readProcessStarts } from "../../../fleet/processStarts.js";
import { logger } from "../../../lib/logger.js";
import { DEFAULT_TOP_N } from "../../../live/machine/capacity.js";
import { productionMachineCapacityDeps } from "../../../live/machine/read.js";
import { ownAncestry } from "../../../live/machine/reap.js";
import { recentBoots, recentBootsClause, recentBootsHolding } from "../../../live/machine/recentBoots.js";
import { readExecutables, readProcessGroups, readTtyHolders, readTtyModes } from "../../../live/standing/coldReads.js";
import { readProcessSnapshot, readProcessTableWhole } from "../../../live/standing/inspect.js";
import { transcriptPath } from "../../../live/turn/workerLog.js";
import type { PlanRegisterPort } from "../../../plans/port.js";
import type { CmuxHostSurface } from "../../../sessionHarness/cmuxHost.js";
import { scanSessions } from "../../../sessions/liveSessionStore.js";
import {
  ReseatErrors,
  type ReseatStoreRefusalKind,
  type ReseatStoreRefusedError,
} from "../../../sessions/reseatErrors.js";
import { pinnedCmuxWorkspaceId } from "../../../sessions/supervisorPin.js";
import { readSupervisorPin } from "../../../sessions/supervisorPinStore.js";
import { claudeHomeDir } from "../../../supervisor/chairRead.js";
import { claudeSessionIdOf } from "../../../supervisor/session.js";
import { mainCheckoutRoot as checkoutRootOf } from "../../../worktree/shell.js";
import { callerWorkspaceId } from "../session/seatWallScan.js";
import { COLD_SHELL_WAIT_SECONDS } from "./reseatCold.js";
import { reseatLockKey } from "./reseatOperation.js";
import { BOOT_PACE_POLL_SECONDS, paceOnBoots, type ReseatDeps } from "./reseatPass.js";
import { RESEAT_CONFIRM_SECONDS } from "./reseatReadback.js";
import { RESEAT_STOP_SECONDS } from "./reseatRelaunch.js";
import { readBootFor, seatLineFor } from "./reseatSeatReads.js";
import { pinnedStoreDir } from "./spawnPlanBuild.js";

/** Whether a `process.kill` failure says the pid no longer exists — the one failure that means "gone". */
function isNoSuchProcess({ error }: { error: unknown }): boolean {
  return error instanceof Error && "code" in error && error.code === "ESRCH";
}

/**
 * SIGTERM a pid and poll until it is gone, for at most {@link RESEAT_STOP_SECONDS}. Only `ESRCH` reads as gone:
 * an `EPERM` is a LIVE process this user cannot signal, and typing the relaunch line then would land it in that
 * live composer as a prompt.
 */
async function stopProcess({ pid }: { pid: number }): Promise<boolean> {
  try {
    process.kill(pid, "SIGTERM");
  } catch (error: unknown) {
    // Already gone between the read and the stop is the state the stop exists to reach; anything else is not.
    return isNoSuchProcess({ error });
  }
  const deadline = Date.now() + RESEAT_STOP_SECONDS * 1000;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 250));
    try {
      process.kill(pid, 0);
    } catch (error: unknown) {
      return isNoSuchProcess({ error });
    }
  }
  return false;
}

/** One pid's argv off the process table, or `undefined` when the table or the pid cannot be read. */
function readProcessArgv({ pid }: { pid: number }): string | undefined {
  const snapshot = readProcessSnapshot();
  if (snapshot.kind !== "rows") {
    return undefined;
  }
  return snapshot.rows.find((row) => row.pid === pid)?.argv;
}

/** This process's own parent chain off the process table, or why the table could not be read. */
function readCallerAncestry(): Result<ReadonlySet<number>, string> {
  const snapshot = readProcessSnapshot();
  if (snapshot.kind !== "rows") {
    return err(snapshot.problem);
  }
  return ok(ownAncestry({ processes: snapshot.rows, selfPid: process.pid }));
}

/**
 * Pace one worker relaunch on the boots in flight, for at most `seconds`, reading only the session registry and
 * `ps -o etime` — the two seams the boot cap reads.
 */
async function awaitBootSlotFor({ home, seconds }: { home: string; seconds: number }): Promise<void> {
  const capacity = productionMachineCapacityDeps({ home, topN: DEFAULT_TOP_N });
  await paceOnBoots({
    emit: ({ line }) => {
      logger.info({ msg: `cmux reseat: ${line}` });
    },
    holding: () => {
      const reading = recentBoots({ elapsedRows: capacity.elapsed(), sessions: capacity.sessions() });
      if (!recentBootsHolding({ reading })) {
        return undefined;
      }
      return recentBootsClause({ reading });
    },
    pause: () => new Promise((resolve) => setTimeout(resolve, BOOT_PACE_POLL_SECONDS * 1000)),
    polls: Math.ceil(seconds / BOOT_PACE_POLL_SECONDS),
  });
}

/** What `cmux spawn` would pass for a seat in `cwd`: its plugin dir and its fleet env prefix. */
function spawnDefaultsFor({ cwd }: { cwd: string }): { pluginDir: string | undefined; envPrefix: string } {
  const repoRoot = checkoutRootOf({ cwd });
  if (repoRoot === undefined) {
    return { envPrefix: "", pluginDir: undefined };
  }
  return { envPrefix: fleetEnvPrefix({ cwd, repoRoot }), pluginDir: pluginDirForSpawnTarget({ cwd, repoRoot }) };
}

/**
 * A routing refusal as the pass's typed error. A refusal the gate did not name is the configuration arm: the one kind
 * no hatch on this path releases.
 */
function refusedRoute({
  reason,
  refusalKind,
}: {
  reason: string;
  refusalKind: ReseatStoreRefusalKind | undefined;
}): ReseatStoreRefusedError {
  if (refusalKind === undefined) {
    return ReseatErrors.storeRefused({ reason, refusalKind: "configuration" });
  }
  return ReseatErrors.storeRefused({ reason, refusalKind });
}

/**
 * The store a relaunched seat is judged on rather than routed: the `--plan`-named one, else whatever the role's
 * seat pins (`seatPinning.ts` `storeDirForSeat`, `cmux spawn`'s rule) — and the supervisor chair pins nothing, so
 * a chair reseat with no `--plan` routes as Fable on live readings, exactly as a handoff does.
 *
 * A register that could not be READ is an `err`, never `ok(undefined)`: the routed gate that follows would read
 * the same register and refuse anyway, and the stop names the cause one step earlier.
 *
 * @param chair whether this seat is the supervisor chair
 * @param home the Slopweaver home the seat boots under, whose register the chair's pin is read from
 * @param namedStoreDir the store `--plan` named, or undefined when none was
 * @param port where the register is read
 * @returns the store to pin, `ok(undefined)` to route, or why the register could not be read
 */
export async function seatPinnedStore({
  chair,
  home,
  namedStoreDir,
  port,
}: {
  chair: boolean;
  home: string;
  namedStoreDir: string | undefined;
  port: PlanRegisterPort;
}): Promise<Result<string | undefined, ClaudeRotationError>> {
  if (namedStoreDir !== undefined) {
    return ok(namedStoreDir);
  }
  if (!chair) {
    return ok(undefined);
  }
  return pinnedStoreDir({ home, port, role: "supervisor" });
}

/**
 * The routing gate a relaunched seat passes, then the boot credential for the store it allowed.
 *
 * @param home the state home the boot credential is read from
 * @param namedStoreDir the store `--plan` named, resolved against {@link home}; undefined when none was
 * @param port where the gate and the chair's pin read the plan register
 * @param probesPort where the gate files each plan's probe for the owner's sign-in note
 * @returns the route step one pass runs per seat
 */
function credentialRouteFor({
  home,
  namedStoreDir,
  port,
  probesPort,
}: {
  home: string;
  namedStoreDir: string | undefined;
  port: PlanRegisterPort;
  probesPort: ClaudePlanProbesPort;
}): ReseatDeps["routeCredential"] {
  const spentPlanHatch = spentPlanHatchOpen({ env: process.env[ALLOW_SPENT_PLAN_ENV], flag: false });
  const unreadableHatch = unreadablePlanHatchOpen({ env: process.env[ALLOW_UNREADABLE_PLAN_ENV] });
  return async ({ plan }) => {
    const pinned = await seatPinnedStore({ chair: plan.chair, home, namedStoreDir, port });
    if (pinned.isErr()) {
      // The configuration arm: no hatch on this path releases a register nobody could read.
      return err(refusedRoute({ reason: pinned.error.message, refusalKind: undefined }));
    }
    // The gate reads THIS home's register, pin or none: the boot credential below comes from this home, so a gate
    // reading the ambient one could allow a seat while the register the seat boots under does not read.
    const gated = await gateSpawnStore({
      chair: plan.chair,
      context: {
        ambient: resolveAmbientCredential(),
        home,
        ...(namedStoreDir === undefined ? {} : { namedPin: true }),
        port,
        probesPort,
        unreadableHatchOpen: unreadableHatch,
      },
      force: spentPlanHatch,
      model: plan.model,
      pinnedStoreDir: pinned.value,
    });
    if (gated.refusal !== undefined) {
      return err(refusedRoute({ reason: gated.refusal, refusalKind: gated.refusalKind }));
    }
    if (gated.storeDir === undefined) {
      return ok({});
    }
    return bootCredentialForStore({ home, seat: basename(plan.cwd), storeDir: gated.storeDir }).mapErr((reason) =>
      ReseatErrors.storeRefused({ reason, refusalKind: "token" }),
    );
  };
}

/**
 * The four reads the cold-seat verdict takes off the machine, in the order it takes them. The whole table, every
 * wrapped line joined back: a row the tolerant decoder drops is a process the cold verdict never sees, and a child
 * whose argv began with a newline read as a bare prompt. The image behind each shell and
 * `login` the graft placed: the one column a process cannot set for itself, since `execve("/tmp/zsh", ["/bin/zsh"])`
 * prints `/bin/zsh` in every `ps` column. Every pid holding the tab's tty device open:
 * a `setsid`'d helper on no controlling tty that kept fd 0 on the tab's tty reads the typed line, and no `ps` column
 * places it on the tab. Each prompt shell's process group beside its tty's foreground
 * group: a shell in a background group is stopped with `SIGTTIN` the moment it reads, and the typed line queues
 * unread. The tab's tty's input modes: a same-owner helper that set `icanon inlcr
 * -icrnl` and exited leaves every process read a bare prompt while the typed line queues unentered.
 *
 * @returns the production process reads, each failure folded to its message
 */
function processReads(): Pick<
  ReseatDeps,
  "readExecutables" | "readProcessGroups" | "readProcessRows" | "readTtyHolders" | "readTtyModes"
> {
  return {
    readExecutables: ({ pids }) => readExecutables({ pids }).mapErr((problem) => problem.message),
    readProcessGroups: ({ pids }) => readProcessGroups({ pids }).mapErr((problem) => problem.message),
    readProcessRows: () => readProcessTableWhole().mapErr((problem) => problem.message),
    readTtyHolders: ({ tty }) => readTtyHolders({ tty }).mapErr((problem) => problem.message),
    readTtyModes: ({ tty }) => readTtyModes({ tty }).mapErr((problem) => problem.message),
  };
}

/** One workspace's reseat lock under `home`, never stale while its holder lives (`./reseatOperation.ts`). */
function acquireReseatLockFor({
  home,
  workspaceId,
}: {
  home: string;
  workspaceId: string;
}): DetailedOperationLockResult {
  return acquireOperationLockDetailed({
    home,
    key: reseatLockKey({ workspaceId }),
    nowIso: new Date().toISOString(),
    staleAfterMs: Number.POSITIVE_INFINITY,
  });
}

/**
 * The production deps for one pass — `cmux reseat`'s, and `fleet resume`'s, which reseats through the same effects.
 *
 * @param client the open cmux client
 * @param home the state home
 * @param flags the pass's own switches; `namedStoreDir` is the store `--plan` named, which every seat in the pass
 * boots on instead of its role pin or a routed plan
 * @param ledgerModels each workspace's pinned ledger model
 * @param port where the routing gate, the chair's pin and the seat readings read the plan register — the verb's
 *   own, so a pass reads the same register its `--plan` was checked against
 * @param timeoutSeconds the longest a worker relaunch paces on the boots in flight before it goes regardless
 * @returns the effects one pass runs on
 */
export function reseatProductionDeps({
  client,
  home,
  flags,
  ledgerModels,
  port,
  timeoutSeconds,
}: {
  client: CmuxHostSurface;
  home: string;
  flags: {
    readonly dryRun: boolean;
    readonly force: boolean;
    readonly model: string | undefined;
    readonly namedStoreDir: string | undefined;
  };
  ledgerModels: ReadonlyMap<string, string>;
  port: PlanRegisterPort;
  timeoutSeconds: number;
}): ReseatDeps {
  const sessionsDir = `${claudeHomeDir()}/sessions`;
  const pollMs = 1000;
  const pin = readSupervisorPin({ home });
  const probesPort = claudePlanProbesPort();
  return {
    ...processReads(),
    acquireReseatLock: ({ workspaceId }) => acquireReseatLockFor({ home, workspaceId }),
    awaitBootSlot: () => awaitBootSlotFor({ home, seconds: timeoutSeconds }),
    callerAncestry: readCallerAncestry,
    chairSessionId: claudeSessionIdOf({ session: pin?.session }),
    // An app-hosted chair sits in no cmux workspace, so no workspace is the chair's to protect here.
    chairWorkspaceId: pinnedCmuxWorkspaceId({ pin }),
    client,
    coldShellPolls: COLD_SHELL_WAIT_SECONDS,
    confirmPolls: RESEAT_CONFIRM_SECONDS,
    dryRun: flags.dryRun,
    env: process.env,
    flagModel: flags.model,
    force: flags.force,
    ledgerModels,
    ownWorkspaceId: callerWorkspaceId({ env: process.env }),
    pause: () => new Promise((resolve) => setTimeout(resolve, pollMs)),
    readArgv: readProcessArgv,
    readBoot: ({ session }) => readBootFor({ home, port, session }),
    readLiveRecords: () => {
      const read = readProcessStarts();
      if ("why" in read) {
        return err(read.why);
      }
      return liveSeatsFromScan({ scan: scanSessions({ sessionsDir }), starts: read.starts });
    },
    readRegistry: () => wholeRegistry({ scan: scanSessions({ sessionsDir }) }),
    routeCredential: credentialRouteFor({ home, namedStoreDir: flags.namedStoreDir, port, probesPort }),
    seatLine: ({ sessionId }) => seatLineFor({ home, port, sessionId }),
    spawnDefaults: spawnDefaultsFor,
    stop: stopProcess,
    transcriptExists: ({ cwd, sessionId }) => existsSync(transcriptPath({ cwd, sessionId })),
  };
}
