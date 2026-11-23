/**
 * One `cmux reseat` pass over injected effects: plan each seat, route its credential, wait, stop, send and read
 * back. What it decides is `../../../sessions/reseat.ts`; the production effects and the verb are `./reseat.ts`;
 * the relaunch once a seat is planned is `./reseatRelaunch.ts`, reading a tab cold `./reseatCold.ts`, and which live
 * session a seat stops `./reseatLiveSession.ts`.
 *
 * ## The order is the design
 *
 * Per seat: read everything and plan (refusals cost nothing), route the credential (a refused plan leaves the
 * seat running), pace on boots in flight (a worker; never the chair), stop the old `claude` and WAIT for it to be
 * gone, and only then type the line. A process that outlives its stop gets NOTHING typed: the surface would still be
 * its composer, and the launch line would be submitted as a prompt. The send goes through the client, not the
 * `cmux send` verb, so the chair needs no unpin — and `--resume` keeps the session id, so the supervisor pin
 * record still names it afterwards (measured: `claude seat --session <session-id>` → ON plan-one).
 *
 * ## The capacity HOLD never holds a reseat
 *
 * A reseat stops one `claude` and starts one in its place, so it never adds a session — and recovery is what brings
 * the supervisor that relieves pressure back. MEASURED: the owner's hand `cmux reseat --all` sat on
 * "machine capacity HOLD, waiting for it to clear", and the HOLD counts boots in flight (3 per 180 s,
 * `../../../live/machine/recentBoots.ts`), so a pass's OWN relaunches tripped it and every later seat came back
 * `held`. Capacity must never block recovery, so a worker relaunch
 * paces on the boots in flight alone — a six-boot burst is the one thing worth pacing — for at most the
 * pass's bound, and then goes anyway. cpu and memory are not read: reboot.md records a HOLD standing for hours on
 * FOREIGN processes, a wait that would never end.
 *
 * ## A cold seat has nothing to stop
 *
 * With cmux's own restore off, a reopened tab is a bare shell (`../../../sessions/coldSeat.ts`). Its relaunch skips
 * the stop and re-reads the tree right before typing: a line typed into anything but a bare shell lands in whatever
 * started there, so a tab that stopped being cold in between gets NOTHING and is refused `NOT_COLD`.
 *
 * ## A session with no transcript is relaunched FRESH, and says so
 *
 * Claude Code writes a transcript only on a session's first submitted prompt. MEASURED: a booted, never-prompted tab was stopped and typed `--resume <session-id>`, Claude printed `No
 * conversation found with session ID` and exited, and the pass journalled it `reseated` because the read-back
 * matched a dead registry row. So the live arm stats the transcript before it stops anything and plans a `fresh`
 * launch when none stands; the read-back requires a LIVE record inside this tab and a Claude composer on its screen;
 * and a resume that still prints "No conversation found" is retried ONCE fresh. A fresh seat is reported
 * `fresh-seated`, never `reseated`: it holds no conversation and no pickup.
 */
import { logger } from "#lib/logger.js";
import { err, ok, type Result } from "#lib/result.js";

import type { DetailedOperationLockResult } from "../../../admit/operationLock.js";
import type { SeatBootPlan } from "../../../claude/seatBoot.js";
import type { CmuxWorkspaceSummary } from "../../../cmux/client.js";
import type { TtyProcessRow } from "../../../live/standing/processes.js";
import type { ProcessGroup } from "../../../live/standing/processGroups.js";
import type { TtyModes } from "../../../live/standing/ttyModes.js";
import type { CmuxHostSurface } from "../../../sessionHarness/cmuxHost.js";
import type { SessionRecord } from "../../../sessions/liveSessions.js";
import {
  bootReseatWall,
  planReseat,
  type ReseatPlan,
  type ReseatWall,
  reseatAllTargets,
} from "../../../sessions/reseat.js";
import { type ReseatError, ReseatErrors, type ReseatStoreRefusedError } from "../../../sessions/reseatErrors.js";
import type { ReseatOutcome } from "../../../sessions/reseatOutcome.js";
import { detectSeatWall } from "../../../sessions/seatRecovery.js";
import { coldWhy, judgeWorkspaceCold } from "./reseatCold.js";
import { liveSessionOf } from "./reseatLiveSession.js";
import { withReseatLock } from "./reseatOperation.js";
import { coldResumeWorkspace, isChair, relaunch } from "./reseatRelaunch.js";

/** One pass's effects, injected so the order can be proven against a fake client and plain fakes. */
export interface ReseatDeps {
  readonly client: CmuxHostSurface;
  readonly ownWorkspaceId: string | undefined;
  /** This process's own parent chain, read before each plan: no session on it is ever stopped. */
  readonly callerAncestry: () => Result<ReadonlySet<number>, string>;
  /** The workspace `cmux pin` recorded as the supervisor's. */
  readonly chairWorkspaceId: string | undefined;
  /**
   * The Claude session the same pin recorded: what a cold chair tab resumes, over whatever cmux saved for it. A Codex
   * pin records none here, since its thread id is no Claude session to resume.
   */
  readonly chairSessionId: string | undefined;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly dryRun: boolean;
  readonly force: boolean;
  readonly flagModel: string | undefined;
  /** Each workspace's pinned ledger model, for a seat whose argv names none. */
  readonly ledgerModels: ReadonlyMap<string, string>;
  /** Claude Code's live-session registry. */
  readonly readRegistry: () => Result<readonly SessionRecord[], string>;
  /** The registry records whose own process runs NOW, any kind (`liveSeatsFromScan`), for judging a tab cold. */
  readonly readLiveRecords: () => Result<readonly SessionRecord[], string>;
  /**
   * The whole process table with each row's tty and state (`ps -ax -o pid=,ppid=,tty=,stat=,args=`), read only when
   * a tab's surfaces report any process, to graft the tty processes cmux attributes to no tree back in and to find a
   * process on the tab's tty cmux never reported, or one a signal stopped, before the tab is judged cold
   * (`graftTtyProcesses`).
   */
  readonly readProcessRows: () => Result<readonly TtyProcessRow[], string>;
  /**
   * The executable behind each of a few pids (`lsof -p <pids> -Fpfn`), read AFTER the graft over the forest's shells
   * and logins alone: the image the kernel mapped, which a process cannot name for itself the way it names its argv
   * (`executablesAgree`). A pid the read holds no image for is refused, never assumed.
   */
  readonly readExecutables: (options: {
    readonly pids: readonly number[];
  }) => Result<ReadonlyMap<number, string>, string>;
  /**
   * The tab's tty's input modes (`stty -f /dev/<tty> -g`), read after the executables: whether the kernel would
   * hand a typed line to the shell as a line, which no process read shows. A same-owner helper that set `icanon
   * inlcr -icrnl` on the tty and exited leaves every process read a bare prompt while the resume line queues
   * unentered (`ttyModesAtPrompt`). A canonical tty, one handing its line editing to the pty's master, or one with
   * a control character on `^J` or `^M`, is refused; a read that fails is refused whole.
   */
  readonly readTtyModes: (options: { readonly tty: string }) => Result<TtyModes, string>;
  /**
   * Every pid holding the tab's tty DEVICE open and on which descriptors (`lsof -Fpf /dev/<tty>`), read after the
   * modes: a process on no controlling tty can still hold a descriptor on the tab's tty and read what is typed
   * there, and a shell at the prompt can hold the tty on everything but its stdin, which no `ps` column shows
   * (`ttyHoldersAgree`). A holder outside the forest, or a prompt shell without fd 0 on the tty, is refused; a read
   * that fails is refused whole.
   */
  readonly readTtyHolders: (options: {
    readonly tty: string;
  }) => Result<ReadonlyMap<number, readonly number[]>, string>;
  /**
   * Each prompt shell's process group and the FOREGROUND group of its tty (`ps -o pid=,pgid=,tpgid= -p <pids>`),
   * read after the holders: a shell in any other group is stopped with `SIGTTIN` the moment it reads, so a typed
   * line queues unread while every other column shows a prompt (`foregroundAgrees`). A prompt shell whose group
   * is not its tty's foreground group, or has no entry, is refused; a read that fails is refused whole.
   */
  readonly readProcessGroups: (options: {
    readonly pids: readonly number[];
  }) => Result<ReadonlyMap<number, ProcessGroup>, string>;
  /** Whether a session's transcript is on disk under a directory, so `--resume` has something to resume. */
  readonly transcriptExists: (options: { readonly cwd: string; readonly sessionId: string }) => boolean;
  /** One process's argv, or `undefined` when it cannot be read. */
  readonly readArgv: (options: { readonly pid: number }) => string | undefined;
  /** What `cmux spawn` would pass for a seat in this directory when its argv names nothing. */
  readonly spawnDefaults: (options: { readonly cwd: string }) => {
    readonly pluginDir: string | undefined;
    readonly envPrefix: string;
  };
  /** Route the seat's credential: a `--plan` store when one was named, else by live gauges for the seat's own model, the chair included. */
  readonly routeCredential: (options: {
    readonly plan: ReseatPlan;
  }) => Promise<Result<{ readonly storeDir?: string; readonly tokenPath?: string }, ReseatStoreRefusedError>>;
  /** What one live session booted on, read the way `claude seat` reads it — `unresolved` when it cannot be. */
  readonly readBoot: (options: { readonly session: SessionRecord }) => Promise<SeatBootPlan>;
  /** Pace a worker relaunch on the boots in flight, for at most the pass's bound; it always resolves, never holds. */
  readonly awaitBootSlot: () => Promise<void>;
  /** SIGTERM the pid and wait for it to be gone: true once it is, false if it outlived the wait. */
  readonly stop: (options: { readonly pid: number }) => Promise<boolean>;
  /** One poll interval of the read-back. */
  readonly pause: () => Promise<void>;
  /** How many polls the read-back takes before calling the relaunch unconfirmed. */
  readonly confirmPolls: number;
  /** How many polls a reopened tab gets to come up as a bare shell before a cold resume gives up on it. */
  readonly coldShellPolls: number;
  /** `claude seat`'s line for a session. */
  readonly seatLine: (options: { readonly sessionId: string }) => Promise<string>;
  /** Take one workspace's reseat lock, never stale while its holder lives (`./reseatOperation.ts`). */
  readonly acquireReseatLock: (options: { readonly workspaceId: string }) => DetailedOperationLockResult;
}

/** How often a paced relaunch re-reads the boots in flight. */
export const BOOT_PACE_POLL_SECONDS = 5;

/**
 * Pace one relaunch on the boots in flight: return at once when they hold nothing, else re-read each poll until they
 * clear or the polls run out — and then return anyway. It never refuses and never holds the seat.
 *
 * @param holding the boots-in-flight clause while they hold, `undefined` once they do not
 * @param pause one poll interval
 * @param polls how many re-reads the pass's bound allows
 * @param emit where the two progress lines go
 * @returns `clear` when the boots cleared, `bound` when the bound passed first and the relaunch goes regardless
 */
export async function paceOnBoots({
  holding,
  pause,
  polls,
  emit,
}: {
  holding: () => string | undefined;
  pause: () => Promise<void>;
  polls: number;
  emit: (options: { readonly line: string }) => void;
}): Promise<"clear" | "bound"> {
  let clause = holding();
  if (clause === undefined) {
    return "clear";
  }
  emit({ line: `${clause} — pacing this relaunch on them, never holding it` });
  for (let poll = 0; poll < polls; poll += 1) {
    await pause();
    clause = holding();
    if (clause === undefined) {
      return "clear";
    }
  }
  emit({ line: `${clause} — relaunching anyway: a reseat replaces a session, it never adds one` });
  return "bound";
}

/**
 * The wall one workspace stands behind: the banner its screen draws, else the boot credential of the one live
 * session in it when that credential is no plan's. A workspace with no readable session — a shell tab, a Codex seat,
 * a tree that would not read — has no boot wall: only a positive off-plan reading counts.
 *
 * @param deps the pass's effects
 * @param screen its rendered text, already read
 * @returns the wall, or `undefined`
 */
export async function reseatWallOf({
  deps,
  workspace,
  screen,
}: {
  deps: ReseatDeps;
  workspace: CmuxWorkspaceSummary;
  screen: string;
}): Promise<ReseatWall | undefined> {
  const banner = detectSeatWall({ screen });
  if (banner !== undefined) {
    return banner;
  }
  const session = await liveSessionOf({ deps, workspace });
  if (session.isErr()) {
    return undefined;
  }
  return bootReseatWall({ plan: await deps.readBoot({ session: session.value }) });
}

/** Read the one live session in a workspace, and its wall again, and plan its relaunch. */
async function planOne({
  deps,
  workspace,
  prior,
}: {
  deps: ReseatDeps;
  workspace: CmuxWorkspaceSummary;
  prior: ReseatWall | undefined;
}): Promise<Result<ReseatPlan, ReseatError>> {
  if (workspace.workspaceId === deps.ownWorkspaceId) {
    return err(ReseatErrors.ownWorkspace({ workspaceRef: workspace.workspaceRef }));
  }
  const reread = await wallUnderLock({ deps, prior, workspace });
  if (reread.isErr()) {
    return err(reread.error);
  }
  const wall = reread.value;
  const session = await liveSessionOf({ deps, workspace });
  if (session.isErr()) {
    return err(session.error);
  }
  const ancestry = deps.callerAncestry();
  if (ancestry.isErr()) {
    return err(ReseatErrors.cmuxReadFailed({ cause: ancestry.error, what: "this command's own parent chain" }));
  }
  let argv = deps.readArgv({ pid: session.value.pid });
  if (argv === undefined) {
    logger.error({
      msg: `cmux reseat: pid ${String(session.value.pid)}'s argv could not be read — using spawn's own defaults`,
    });
    argv = "";
  }
  return planReseat({
    argv,
    callerAncestry: ancestry.value,
    chair: isChair({ deps, workspace }),
    defaults: deps.spawnDefaults({ cwd: session.value.cwd }),
    env: deps.env,
    flagModel: deps.flagModel,
    force: deps.force,
    ledgerModel: deps.ledgerModels.get(workspace.workspaceId),
    ownWorkspaceId: deps.ownWorkspaceId,
    session: session.value,
    // Read BEFORE anything is routed or stopped: a session that never took a prompt has no transcript, and a
    // `--resume` on it only prints "No conversation found", so its plan boots fresh.
    transcriptExists: deps.transcriptExists({ cwd: session.value.cwd, sessionId: session.value.sessionId }),
    wall,
    workspace,
  });
}

/**
 * Reseat one workspace: a live `claude` is stopped and relaunched in place; a tab with none that is a bare shell
 * holding a saved session is resumed cold, the chair's on its pin. A tab with neither is refused `NO_LIVE_SESSION`
 * naming why it was not read as a bare shell either — the single-tab verb had no cold arm at first, and its
 * own refusal was the fallback a refused chair was handed, and that verb had nothing to offer the chair.
 *
 * Held under the workspace's reseat lock from its plan to its read-back, the caller's wall read again under it: a
 * second live reseat of the same tab is refused `RESEAT_CONTENDED` having stopped and typed nothing
 * (`./reseatOperation.ts`).
 *
 * @param deps the pass's effects
 * @param workspace the workspace to relaunch in
 * @param wall the wall its screen or boot credential shows, when known
 * @returns what happened
 */
export async function reseatWorkspace({
  deps,
  workspace,
  wall,
}: {
  deps: ReseatDeps;
  workspace: CmuxWorkspaceSummary;
  wall: ReseatWall | undefined;
}): Promise<ReseatOutcome> {
  const held = await withReseatLock({ body: () => reseatWorkspaceHeld({ deps, wall, workspace }), deps, workspace });
  if (held.isErr()) {
    return { error: held.error, kind: "refused", workspaceRef: workspace.workspaceRef };
  }
  return held.value;
}

/**
 * The wall to plan on, judged again under the lock. A caller's wall was read BEFORE the lock, and a wall is what lets a
 * mid-turn session be stopped, so a reseat that ran in between and brought the seat back must not leave its working
 * session stopped on a stale reading. With no wall passed nothing loosens the plan, and nothing is read.
 *
 * A wall passed and gone under the lock is `WALL_CLEARED`, never a plan: the tab was picked FOR that wall, so the
 * session now in it is not the one picked — `--force` included, which loosens only the mid-turn guard, and an idle
 * session that another reseat just brought back included. A named reseat with no wall stays a plan.
 *
 * @param prior the wall the caller read before the lock, if any
 * @returns the wall the screen and boot credential show now, or the read that failed, or `WALL_CLEARED`
 */
async function wallUnderLock({
  deps,
  workspace,
  prior,
}: {
  deps: ReseatDeps;
  workspace: CmuxWorkspaceSummary;
  prior: ReseatWall | undefined;
}): Promise<Result<ReseatWall | undefined, ReseatError>> {
  if (prior === undefined) {
    return ok(undefined);
  }
  const screen = await deps.client.readScreen({ target: { workspaceId: workspace.workspaceId } });
  if (screen.isErr()) {
    return err(
      ReseatErrors.cmuxReadFailed({ cause: screen.error.message, what: `${workspace.workspaceRef}'s screen` }),
    );
  }
  const now = await reseatWallOf({ deps, screen: screen.value, workspace });
  if (now === undefined) {
    return err(ReseatErrors.wallCleared({ wall: prior.kind, workspaceRef: workspace.workspaceRef }));
  }
  return ok(now);
}

/**
 * {@link reseatWorkspace} for a caller already holding the workspace's reseat lock — `fleet resume`, which holds it
 * through its own wall re-check as well.
 *
 * @param deps the pass's effects
 * @param workspace the workspace to relaunch in, whose lock the caller holds
 * @param wall the wall its screen or boot credential showed before the lock, read again here
 * @returns what happened
 */
export async function reseatWorkspaceHeld({
  deps,
  workspace,
  wall: prior,
}: {
  deps: ReseatDeps;
  workspace: CmuxWorkspaceSummary;
  wall: ReseatWall | undefined;
}): Promise<ReseatOutcome> {
  const workspaceRef = workspace.workspaceRef;
  const planned = await planOne({ deps, prior, workspace });
  if (planned.isOk()) {
    return relaunch({ deps, plan: planned.value });
  }
  if (planned.error.code !== "NO_LIVE_SESSION") {
    return { error: planned.error, kind: "refused", workspaceRef };
  }
  const chair = isChair({ deps, workspace });
  const pinnedSessionId = chair ? deps.chairSessionId : undefined;
  const judged = await judgeWorkspaceCold({ deps, pinnedSessionId, workspace });
  if (judged.isErr()) {
    return { error: judged.error, kind: "refused", workspaceRef };
  }
  if (judged.value.kind !== "not-cold") {
    return coldResumeWorkspace({ deps, pinnedSessionId, workspace });
  }
  const why = coldWhy({ verdict: judged.value });
  return {
    error: ReseatErrors.noLiveSession({ notCold: { chair, why }, workspaceRef }),
    kind: "refused",
    workspaceRef,
  };
}

/**
 * Reseat every walled workspace but the caller's own, the chair first — walled by a screen banner or by a boot
 * credential no plan names. Nothing holds the pass: each worker paces on the boots in flight and then goes.
 *
 * @param deps the pass's effects
 * @param workspaces the live cmux inventory
 * @returns each walled workspace's outcome, and each screen that could not be read
 */
export async function reseatAll({
  deps,
  workspaces,
}: {
  deps: ReseatDeps;
  workspaces: readonly CmuxWorkspaceSummary[];
}): Promise<readonly ReseatOutcome[]> {
  const walls = new Map<string, ReseatWall>();
  const outcomes: ReseatOutcome[] = [];
  for (const workspace of workspaces) {
    if (workspace.workspaceId === deps.ownWorkspaceId) {
      continue;
    }
    const screen = await deps.client.readScreen({ target: { workspaceId: workspace.workspaceId } });
    if (screen.isErr()) {
      outcomes.push({
        error: ReseatErrors.cmuxReadFailed({ cause: screen.error.message, what: `${workspace.workspaceRef}'s screen` }),
        kind: "refused",
        workspaceRef: workspace.workspaceRef,
      });
      continue;
    }
    const wall = await reseatWallOf({ deps, screen: screen.value, workspace });
    if (wall !== undefined) {
      walls.set(workspace.workspaceId, wall);
    }
  }
  const targets = reseatAllTargets({
    chairWorkspaceId: deps.chairWorkspaceId,
    ownWorkspaceId: deps.ownWorkspaceId,
    walls,
    workspaces,
  });
  for (const workspace of targets) {
    outcomes.push(await reseatWorkspace({ deps, wall: walls.get(workspace.workspaceId), workspace }));
  }
  return outcomes;
}
