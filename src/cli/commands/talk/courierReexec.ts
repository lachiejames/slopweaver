/**
 * The chair's courier re-executes itself in place into the main checkout's CLI once the code it loaded is superseded —
 * the effectful half of `../../../talk/courierFreshness.ts`, which carries the measurement and the criterion.
 *
 * ## In place, so the chair never hears of it
 *
 * `process.execve` replaces the process image and keeps the pid and the three standard descriptors, so the chair's
 * background task — the one that started `talk courier --follow` — never ends and the chair is never notified.
 * Exiting and letting the chair restart it would interrupt the chair once per landing touching the courier's code, and
 * spawning a successor would need an ownership handoff between two typists; replacing the image needs neither. It runs
 * only after an awaited batch pass and before the next sleep, so no chair-wake lock is held and no line is mid-type.
 * The process start stamp an `attempting` wake names its holder by survives the exec too — MEASURED on darwin,
 * `ps -o lstart= -p <pid>` read the same instant before and after a `process.execve` — so a wake the follower
 * staged still reads as held by a running typist, exactly as if it had carried on.
 *
 * ## The same tier, never a new wrapper
 *
 * Under source the courier is tsx's CHILD, below a tsx CLI wrapper that waits on that pid and relays signals to it.
 * Exec'd plainly, the launcher's last line turned this pid into a NEW wrapper forking a new child, and the old wrapper
 * waited on it forever: MEASURED: 25 courier processes in one chain, 24 idle ~6 MB wrappers over one live
 * courier (`pgrep -fl 'cli/index.ts talk cour'`). So the request carries `LAUNCHER_NO_TSX_WRAPPER_VAR`, and the
 * launcher starts the source as the child itself. Never reap a middle wrapper: its relay would kill the live courier.
 *
 * ## The one failure Node 24 cannot survive
 *
 * MEASURED on v24.21.0: `process.execve` on a missing file aborts the process (`process.execve failed with
 * error code ENOENT`, exit 134) rather than throwing; only Node 26.1 makes it catchable. So the launcher is checked
 * executable immediately before the call and an exec is never attempted past a failed check. What remains is a file
 * removed or replaced between the check and the call: the courier dies, its background task ends, and the chair restarts
 * it by the boot rule (`skills/supervisor/reference/relay-courier.md`) — the restart this module exists to avoid, as the
 * worst case rather than every case. Repro: `node -e 'process.execve("/nonexistent", ["/nonexistent"], process.env)'`.
 * A MAIN no boot could start ends it the same way; the check is a cheap guard, never a proof MAIN runs, and the
 * chair's restart goes through MAIN and meets the same breakage, so a re-exec loses nothing a restart would keep.
 */
import { existsSync, realpathSync } from "node:fs";
import { join } from "node:path";

import { LAUNCHER_NO_TSX_WRAPPER_VAR } from "#lib/launcherEnv.js";

import { productionInspectDeps } from "../../../checkouts/inspect.js";
import { installedTreeRoot, LAUNCHER_RELATIVE_PATH } from "../../../lib/pluginRoot.js";
import { err, type Result } from "../../../lib/result.js";
import { resolveSupervisorBinCheckout, SUPERVISOR_CLI_RELATIVE_PATH } from "../../../live/standing/supervisor.js";
import { mainCheckoutsFromProfile } from "../../../profileStore.js";
import {
  COURIER_CODE_PATHSPECS,
  COURIER_FRESHNESS_EVERY_MS,
  COURIER_REEXEC_AT_ENV,
  COURIER_REEXEC_PID_ENV,
  type CourierGitRead,
  type CourierMainRead,
  type CourierRestartCandidate,
  courierRestartLine,
  decideCourierFreshness,
  reexecStampOf,
} from "../../../talk/courierFreshness.js";
import { launcherExecutable, mainBuiltCliRefusal } from "./courierExecChecks.js";

/** One process-image replacement: the launcher, its argv, and the environment it starts with. */
export interface CourierExecRequest {
  readonly mainRoot: string;
  readonly file: string;
  readonly argv: readonly string[];
  readonly env: NodeJS.ProcessEnv;
}

/** The launcher failed its executable check, so no exec was tried and the courier follows on. */
export interface LauncherNotExecutableError {
  readonly code: "LAUNCHER_NOT_EXECUTABLE";
  readonly message: string;
  readonly file: string;
}

/** Main's launcher would run a built CLI whose own guard refuses it, so no exec was tried and the courier follows on. */
export interface MainBuildStaleError {
  readonly code: "MAIN_BUILD_STALE";
  readonly message: string;
  readonly mainRoot: string;
}

/** Why the courier did not re-execute. Each is said before the exec, since past it a failed exec cannot return. */
export type CourierReexecError = LauncherNotExecutableError | MainBuildStaleError;

/** The courier re-exec's error factory. */
export const CourierReexecErrors = {
  launcherNotExecutable: ({ file, cause }: { file: string; cause: unknown }): LauncherNotExecutableError => ({
    code: "LAUNCHER_NOT_EXECUTABLE",
    file,
    message: `talk courier: not re-executing — ${file} is not executable here (${cause instanceof Error ? cause.message : String(cause)}); following on, and a later check tries again`,
  }),
  mainBuildStale: ({ mainRoot, why }: { mainRoot: string; why: string }): MainBuildStaleError => ({
    code: "MAIN_BUILD_STALE",
    mainRoot,
    message: `talk courier: not re-executing — ${mainRoot}'s launcher would run its built CLI, which would refuse (${why}); following on until it is rebuilt`,
  }),
} as const;

/** The calls an exec makes, as seams: the two checks ahead of it, and the replacement itself. */
export interface CourierExecDeps {
  /**
   * Why main's launcher, started with this environment, would pick a built CLI whose staleness guard then refuses
   * before any verb runs — or `undefined` when it would run the source, or a build that is current.
   */
  readonly builtCliRefusal: (options: {
    readonly mainRoot: string;
    readonly env: NodeJS.ProcessEnv;
  }) => string | undefined;
  /** Throws when the file is not executable by this process. */
  readonly accessExecutable: (options: { readonly file: string }) => void;
  readonly execve: (options: CourierExecRequest) => never;
}

/**
 * The real calls. `process.execve` is optional in Node's types, so its absence is part of the check. The exec starts in
 * main, as a boot there does: an exec keeps the working directory, and a tree whose plugin manifest is missing is
 * identified by it (`installedTreeRoot`), so an image left in the old tree's directory would read itself off main and
 * re-exec again after every cooldown. Main's launcher was found a moment ago, so the change
 * fails only in the race the module header names.
 */
const PROCESS_EXEC: CourierExecDeps = {
  accessExecutable: launcherExecutable,
  builtCliRefusal: mainBuiltCliRefusal,
  execve: ({ mainRoot, file, argv, env }) => {
    if (process.execve === undefined) {
      throw new Error(`this Node (${process.version}) has no process.execve`);
    }
    process.chdir(mainRoot);
    return process.execve(file, [...argv], env);
  },
};

/**
 * The exec that restarts the courier from the main checkout: its own launcher, forced with `SLOPWEAVER_CLI_DIR` so no
 * inherited plugin root can pick another tree and marked to start at this tier (module header), every other variable kept — `CMUX_WORKSPACE_ID` is what admits it as the
 * pinned chair's courier — and the instant stamped so the follower it starts can bound a loop, beside this pid, which
 * the exec keeps, so a process that merely inherits the stamp never reads it as its own (`reexecStampOf`).
 *
 * @param mainRoot the canonical main checkout
 * @param env this process's environment
 * @param pid this process's pid, the one the new image runs under
 * @param reexecAtIso the instant of this exec
 * @returns the request
 */
export function courierExecRequest({
  mainRoot,
  env,
  pid,
  reexecAtIso,
}: {
  mainRoot: string;
  env: NodeJS.ProcessEnv;
  pid: number;
  reexecAtIso: string;
}): CourierExecRequest {
  const file = join(mainRoot, LAUNCHER_RELATIVE_PATH);
  return {
    argv: [file, "talk", "courier", "--follow"],
    env: {
      ...env,
      [COURIER_REEXEC_AT_ENV]: reexecAtIso,
      [COURIER_REEXEC_PID_ENV]: String(pid),
      [LAUNCHER_NO_TSX_WRAPPER_VAR]: "1",
      SLOPWEAVER_CLI_DIR: mainRoot,
    },
    file,
    mainRoot,
  };
}

/**
 * Replace this process with the request, or say why it was not tried. Two checks run first, each a way the new image
 * would die before reaching the follow loop: main's built CLI refusing as stale, and the
 * launcher not being executable. The executable check runs last, so nothing sits between it and the call: past it, a
 * failed exec aborts on Node 24 (module header), so no `try` is put around it to pretend otherwise.
 *
 * @param request the exec
 * @param deps the checks and the replacement; the real ones unless a test passes its own
 * @returns never on success; the first check's failure, with nothing exec'd
 */
export function execCourier({
  request,
  deps = PROCESS_EXEC,
}: {
  request: CourierExecRequest;
  deps?: CourierExecDeps;
}): Result<never, CourierReexecError> {
  const stale = deps.builtCliRefusal({ env: request.env, mainRoot: request.mainRoot });
  if (stale !== undefined) {
    return err(CourierReexecErrors.mainBuildStale({ mainRoot: request.mainRoot, why: stale }));
  }
  try {
    deps.accessExecutable({ file: request.file });
  } catch (cause) {
    return err(CourierReexecErrors.launcherNotExecutable({ cause, file: request.file }));
  }
  return deps.execve(request);
}

/** What one freshness check reads: the main checkout, and git in it. */
export interface CourierMeasurement {
  readonly main: CourierMainRead;
  readonly current: CourierGitRead;
}

/** The follower's seams: every read, the clock, the output, and the exec. */
export interface CourierFollowerDeps {
  readonly runningRoot: string;
  readonly startHead: string | undefined;
  readonly reexecAtIso: string | undefined;
  readonly measure: (options: { readonly startHead: string | undefined }) => CourierMeasurement;
  readonly nowMs: () => number;
  readonly out: (options: { readonly line: string }) => void;
  readonly error: (options: { readonly line: string }) => void;
  readonly drain: () => Promise<void>;
  readonly exec: (options: {
    readonly mainRoot: string;
    readonly reexecAtIso: string;
  }) => Result<never, CourierReexecError>;
}

/** The follower's freshness state, checked once after each batch pass. */
export interface CourierFollower {
  /** Measure when due, and re-exec into main when the decision says so; returns when the courier carries on. */
  readonly check: () => Promise<void>;
}

/**
 * The follower's freshness check: due every {@link COURIER_FRESHNESS_EVERY_MS} from the first pass, never between a
 * pass's start and its end. A notice, or a refused exec, is said once per distinct sentence; a failed check before an exec clears the
 * candidate, so the next try waits for two fresh observations rather than retrying every five seconds.
 *
 * @param deps the seams
 * @returns the check the follow loop calls after each batch pass
 */
export function courierFollower({ deps }: { deps: CourierFollowerDeps }): CourierFollower {
  let dueAtMs = deps.nowMs();
  let previous: CourierRestartCandidate | undefined;
  const said = new Set<string>();
  return {
    check: async () => {
      const nowMs = deps.nowMs();
      if (nowMs < dueAtMs) {
        return;
      }
      dueAtMs = nowMs + COURIER_FRESHNESS_EVERY_MS;
      const measured = deps.measure({ startHead: deps.startHead });
      const nowIso = new Date(nowMs).toISOString();
      const decision = decideCourierFreshness({
        current: measured.current,
        main: measured.main,
        nowIso,
        previousCandidate: previous,
        reexecAtIso: deps.reexecAtIso,
        runningRoot: deps.runningRoot,
        startHead: deps.startHead,
      });
      if (decision.kind === "continue") {
        previous = decision.candidate;
        const notice = decision.notice;
        if (notice !== undefined && !said.has(notice.why)) {
          said.add(notice.why);
          deps.error({ line: `talk courier: ${notice.why}` });
        }
        return;
      }
      previous = undefined;
      deps.out({ line: courierRestartLine({ candidate: decision.candidate }) });
      await deps.drain();
      const tried = deps.exec({ mainRoot: decision.candidate.mainRoot, reexecAtIso: nowIso });
      if (tried.isErr() && !said.has(tried.error.message)) {
        said.add(tried.error.message);
        deps.error({ line: tried.error.message });
      }
    },
  };
}

/**
 * One bounded git read in a checkout, `undefined` on any failure — a failed read is unmeasured, never unchanged. It is
 * the checkout inspector's own read-only seam (`../../../checkouts/inspect.ts`), whose timeout sits under the quiet.
 */
const { git } = productionInspectDeps();

/** A path canonicalised, or itself when it cannot be — two spellings of one tree must compare equal. */
function canonical({ path }: { path: string }): string {
  try {
    return realpathSync.native(path);
  } catch {
    return path;
  }
}

/** The main checkout carrying the CLI, canonicalised, read fresh each check. */
function readMain({ home }: { home: string }): CourierMainRead {
  const resolved = resolveSupervisorBinCheckout({
    carriesCli: ({ path }) => existsSync(join(path, SUPERVISOR_CLI_RELATIVE_PATH)),
    checkoutPaths: mainCheckoutsFromProfile({ home }).map((checkout) => checkout.path),
  });
  if (resolved.value === undefined) {
    return { kind: "unresolved", why: `cannot name the main checkout to run from: ${resolved.problems.join("; ")}` };
  }
  return { kind: "resolved", root: canonical({ path: resolved.value }) };
}

/** A checkout's HEAD, or `undefined` when git cannot say. */
function headOf({ root }: { root: string }): string | undefined {
  const printed = git({ args: ["rev-parse", "HEAD"], cwd: root })?.trim();
  if (printed === undefined || printed === "") {
    return undefined;
  }
  return printed;
}

/** Main's head and the code paths changed since the follower's start head. */
function readGit({ mainRoot, startHead }: { mainRoot: string; startHead: string | undefined }): CourierGitRead {
  const head = headOf({ root: mainRoot });
  if (head === undefined) {
    return { kind: "unresolved", why: `cannot read the main checkout's HEAD in ${mainRoot}` };
  }
  if (startHead === undefined) {
    return { kind: "unresolved", why: "the head this follower started at could not be read" };
  }
  if (head === startHead) {
    return { changedPaths: [], head, kind: "resolved" };
  }
  const diff = git({
    args: ["diff", "--name-only", "-z", startHead, head, "--", ...COURIER_CODE_PATHSPECS],
    cwd: mainRoot,
  });
  if (diff === undefined) {
    return { kind: "unresolved", why: `cannot diff ${startHead}..${head} in ${mainRoot}` };
  }
  return { changedPaths: diff.split("\0").filter((path) => path !== ""), head, kind: "resolved" };
}

/**
 * The real follower's seams for this process: the tree its code was loaded from, the head it starts at when that tree
 * is main, and the stamp a re-exec left it.
 *
 * @param home the state home, whose profile names the main checkouts
 * @param importMetaUrl the courier module's own `import.meta.url`, anchoring the tree it was loaded from
 * @param out the stdout line writer
 * @param error the stderr line writer
 * @param drain flushes stdout and stderr before an exec
 * @returns the seams
 */
export function processCourierFollowerDeps({
  home,
  importMetaUrl,
  out,
  error,
  drain,
}: {
  home: string;
  importMetaUrl: string;
  out: CourierFollowerDeps["out"];
  error: CourierFollowerDeps["error"];
  drain: CourierFollowerDeps["drain"];
}): CourierFollowerDeps {
  const runningRoot = canonical({ path: installedTreeRoot({ importMetaUrl }) });
  const main = readMain({ home });
  const startsOnMain = main.kind === "resolved" && main.root === runningRoot;
  return {
    drain,
    error,
    exec: ({ mainRoot, reexecAtIso }) =>
      execCourier({ request: courierExecRequest({ env: process.env, mainRoot, pid: process.pid, reexecAtIso }) }),
    measure: ({ startHead }) => {
      const measuredMain = readMain({ home });
      if (measuredMain.kind === "unresolved" || measuredMain.root !== runningRoot) {
        return { current: { kind: "unresolved", why: "not measured off main" }, main: measuredMain };
      }
      return { current: readGit({ mainRoot: measuredMain.root, startHead }), main: measuredMain };
    },
    nowMs: () => Date.now(),
    out,
    reexecAtIso: reexecStampOf({ env: process.env, pid: process.pid }),
    runningRoot,
    startHead: startsOnMain ? headOf({ root: runningRoot }) : undefined,
  };
}
