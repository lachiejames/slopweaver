/**
 * The effectful half of the unasked prune: claim this window's marker, head the log, and hand the verb to the
 * background so the caller — a disk read, a hook — never waits on a run that takes up to half an hour. What is
 * owed, and why there are two causes, is `./pruneTrigger.ts`; how the verb is started detached, and why that
 * is not a headless anything, is `./pruneTriggerDetach.ts`.
 *
 * Every function here answers a `Result` and never throws, because both callers are on a path that must not
 * fail for maintenance: a capacity read still returns its reading, and the `PreToolUse` gate still reaches
 * its verdict.
 *
 * **Only a caller that can hand its child a cmux capability claims a window.** The launched verb is
 * reparented to launchd, so cmux (`cmuxOnly`) answers it only when it presents the `CMUX_SOCKET_CAPABILITY`
 * it inherited; without one `worktree prune --apply` cannot read the live workspace list and refuses, as it
 * must. Measured on one `worktree-prune` slot: a hook call from a session started
 * outside cmux won the hour, its child was refused, and the row was held on a failure finding — while the next hour,
 * launched from inside cmux, had succeeded. Such a caller now answers `cannot-serve` and writes no marker, so
 * the next tool call from a session inside cmux claims the same window. The refused firing, on the machine:
 * `grep -n -B2 "Access denied" "$SLOPWEAVER_HOME/worktree-bundles/auto-prune.log"`.
 */
import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  readSync,
  renameSync,
  type Stats,
  unlinkSync,
  utimesSync,
  writeSync,
} from "node:fs";
import { join } from "node:path";

import { errorMessage } from "#lib/errorMessage.js";
import { installedTreeRoot } from "#lib/pluginRoot.js";
import { err, ok, type Result } from "#lib/result.js";

import { productionSocketPathSources, resolveCmuxSocketEndpoint, type SocketPathSources } from "../cmux/socketPath.js";
import { slopweaverHome } from "../homeDir.js";
import { mainCheckoutsFromProfile } from "../profileStore.js";
import { stateHomePaths } from "../stateHome.js";
import { choosePruneLauncher, executableFile, freshBuild, pruneLaunchEnv } from "./pruneLauncher.js";
import {
  MARKER_LAUNCHED,
  markerAbandoned,
  type PruneTriggerCause,
  pruneTriggerCommand,
  pruneTriggerMarker,
  staleTriggerMarkers,
  thresholdPruneOwed,
} from "./pruneTrigger.js";
import {
  launchDetached,
  launchLogPath,
  noteLaunch,
  type PruneTriggerError,
  PruneTriggerErrors,
} from "./pruneTriggerDetach.js";

/**
 * What one request did. `claimed-elsewhere` means this window already launched one; `cannot-serve` means a
 * prune is owed but this caller's child could not read the live workspace list, so the window is left for one
 * that can.
 */
export type PruneTriggerOutcome = "cannot-serve" | "claimed-elsewhere" | "launched" | "not-owed";

/** The effects a request needs, injected so a unit test asserts the order without a process or a disk. */
export interface PruneTriggerDeps {
  /**
   * Whether this window's marker already stands — the whole cost of a call once the window has launched. A
   * marker whose claimer died before launching reads as absent, so its window is still owed.
   */
  readonly markerExists: (args: { name: string }) => boolean;
  /**
   * Whether the home declares a main checkout. One that declares none has no tree to reclaim and is asked for
   * nothing — not even a marker, which is what keeps every throwaway test home, on this same volume, unwritten.
   */
  readonly hasCheckouts: () => boolean;
  /**
   * Whether a child launched from this process could read the live workspace list — it inherits a cmux
   * capability token. Asked before the claim, so a caller that cannot serve the window never takes it.
   */
  readonly servesLiveState: () => boolean;
  /** Create `name` exclusively; true when this call made it, false when it already existed. */
  readonly claim: (args: { name: string }) => Result<boolean, PruneTriggerError>;
  /** Delete a claimed marker whose launch failed, best effort. */
  readonly release: (args: { name: string }) => void;
  /** Mark a claimed marker as launched, best effort; until then it can be judged abandoned. */
  readonly confirm: (args: { name: string }) => void;
  /** Append the launch's heading line to the log. */
  readonly note: (args: { line: string }) => void;
  /** Background `argv` with its output appended to the log, handing marker `name` back if it never starts. */
  readonly launch: (args: { argv: readonly string[]; name: string }) => Result<void, PruneTriggerError>;
  readonly nowMs: () => number;
}

/**
 * Launch one unasked prune for `cause`, unless this window already launched one.
 *
 * @param cause which trigger is asking
 * @param availableKib the reading a `threshold` cause compares against the floor; ignored for `schedule`
 * @param floorGb the floor a `threshold` reading is compared against (`./pruneFloor.ts`); the owner's fixed 100 GB
 *   when the caller has no session count
 * @param deps the claim, the log and the launch
 * @returns what happened, or why it could not launch
 */
export function requestWorktreePrune({
  availableKib,
  cause,
  floorGb,
  deps,
}: {
  availableKib?: number | undefined;
  cause: PruneTriggerCause;
  floorGb?: number | undefined;
  deps: PruneTriggerDeps;
}): Result<PruneTriggerOutcome, PruneTriggerError> {
  if (cause === "threshold" && !thresholdPruneOwed({ availableKib, floorGb })) {
    return ok("not-owed");
  }
  const nowMs = deps.nowMs();
  const name = pruneTriggerMarker({ cause, nowMs });
  if (deps.markerExists({ name })) {
    return ok("claimed-elsewhere");
  }
  if (!deps.hasCheckouts()) {
    return ok("not-owed");
  }
  if (!deps.servesLiveState()) {
    return ok("cannot-serve");
  }
  const claimed = deps.claim({ name });
  if (claimed.isErr()) {
    return err(claimed.error);
  }
  if (!claimed.value) {
    return ok("claimed-elsewhere");
  }
  const argv = pruneTriggerCommand({ cause });
  const free = availableKib === undefined ? "" : ` free=${String(Math.round((availableKib * 1024) / 1e8) / 10)}GB`;
  deps.note({ line: `${new Date(nowMs).toISOString()} cause=${cause}${free} launching: ${argv.join(" ")}` });
  const launched = deps.launch({ argv, name });
  if (launched.isErr()) {
    // Nothing started, so the window is handed back for the next caller to try.
    deps.release({ name });
    return err(launched.error);
  }
  deps.confirm({ name });
  return ok("launched");
}

/**
 * The schedule cause, as the `PreToolUse` hook asks for it on every tool call in every session: one `stat`
 * once this hour has launched, a launch of the hourly row's own firing the first time a session inside cmux
 * asks and it has not. Never throws and never reports — the gate's verdict is the hook's only output.
 *
 * @param importMetaUrl the hook entry's `import.meta.url`, from which this build's launcher is resolved
 */
export function requestScheduledWorktreePrune({ importMetaUrl }: { importMetaUrl: string }): void {
  try {
    requestWorktreePrune({
      cause: "schedule",
      deps: productionPruneTriggerDeps({ home: slopweaverHome(), importMetaUrl }),
    });
  } catch {
    // A maintenance launch never changes what the gate decides.
  }
}

/**
 * The real effects, under one state home: markers in its trigger directory, the log beside them, and the
 * main checkout's launcher (`./pruneLauncher.ts#choosePruneLauncher`).
 *
 * @param home the state home the prune runs against, passed to the child as `SLOPWEAVER_HOME`
 * @param importMetaUrl the calling module's `import.meta.url`, from which this build's launcher is resolved
 * @param socketPathSources where the cmux capability token is read from — the real environment unless a test
 *   injects one
 * @returns the production {@link PruneTriggerDeps}
 */
export function productionPruneTriggerDeps({
  home,
  importMetaUrl,
  socketPathSources = productionSocketPathSources(),
}: {
  home: string;
  importMetaUrl: string;
  socketPathSources?: SocketPathSources;
}): PruneTriggerDeps {
  const paths = stateHomePaths({ home });
  const dir = paths.worktreePruneTriggerDir;
  const log = paths.worktreePruneTriggerLog;
  return {
    claim: ({ name }) => claimMarker({ dir, name }),
    confirm: ({ name }) => {
      confirmMarker({ path: join(dir, name) });
    },
    hasCheckouts: () => mainCheckoutsFromProfile({ home }).length > 0,
    markerExists: ({ name }) => markerStands({ path: join(dir, name) }),
    launch: ({ argv, name }) => {
      try {
        const launcher = choosePruneLauncher({
          executable: executableFile,
          fallbackRoot: installedTreeRoot({ importMetaUrl }),
          fresh: freshBuild,
          mainCheckouts: mainCheckoutsFromProfile({ home }),
        });
        noteLaunch({ line: `  launcher: ${launcher.source} ${launcher.path}`, logPath: log });
        return launchDetached({
          argv: [launcher.path, ...argv],
          cwd: home,
          env: pruneLaunchEnv({ base: process.env, cliDir: launcher.cliDir, home }),
          logPath: launchLogPath({ logPath: log }),
          markerPath: join(dir, name),
        });
      } catch (error) {
        return err(PruneTriggerErrors.launchFailed({ detail: errorMessage({ error }) }));
      }
    },
    note: ({ line }) => {
      noteLaunch({ line, logPath: log });
    },
    nowMs: () => Date.now(),
    release: ({ name }) => {
      releaseMarker({ path: join(dir, name) });
    },
    servesLiveState: () =>
      resolveCmuxSocketEndpoint({ capability: undefined, socketPath: undefined, sources: socketPathSources })
        .capability !== undefined,
  };
}

/**
 * Write {@link MARKER_LAUNCHED} into a claimed marker, best effort. Non-blocking, and written only into a
 * regular file: a FIFO swapped in at the path must not hold the hook.
 *
 * @param path the marker this call claimed
 */
function confirmMarker({ path }: { path: string }): void {
  try {
    const fd = openSync(path, constants.O_WRONLY | constants.O_NONBLOCK | constants.O_NOFOLLOW);
    try {
      if (fstatSync(fd).isFile()) {
        writeSync(fd, MARKER_LAUNCHED);
      }
    } finally {
      closeSync(fd);
    }
  } catch {
    // Unconfirmed, the marker reads as abandoned after a minute: one extra launch, which the apply lock refuses.
  }
}

/**
 * Hand a claimed window back after a failed launch, best effort.
 *
 * @param path the marker this call claimed
 */
function releaseMarker({ path }: { path: string }): void {
  try {
    unlinkSync(path);
  } catch {
    // A directory that refuses the delete still lets its owner backdate the marker, which then reads as
    // abandoned to the very next caller. Absent already, the window is open either way.
    try {
      utimesSync(path, 0, 0);
    } catch {
      // Gone, or not ours: the minute's abandonment still hands it back.
    }
  }
}

/**
 * Create one marker exclusively, deleting the windows that have passed once this one is won.
 *
 * @param dir the trigger directory, created when absent
 * @param name the marker for this window
 * @returns true when this call created it, false when it already existed
 */
function claimMarker({ dir, name }: { dir: string; name: string }): Result<boolean, PruneTriggerError> {
  const path = join(dir, name);
  if (abandonedMarker({ path })) {
    // Taken over by RENAME, which exactly one caller wins, so two that both judged it abandoned cannot both
    // delete it and then both claim; the loser's rename fails and its exclusive create decides it.
    const aside = `${path}.abandoned-${String(process.pid)}`;
    try {
      renameSync(path, aside);
      unlinkSync(aside);
    } catch {
      // Another caller took it over first.
    }
  }
  moveAsideNonDirectory({ dir });
  try {
    mkdirSync(dir, { recursive: true });
    closeSync(openSync(path, "wx"));
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "EEXIST") {
      return ok(false);
    }
    return err(PruneTriggerErrors.markerUnwritable({ cause: error, dir }));
  }
  // The window is won from here on, so nothing below may stop the launch it owes: cleanup is
  // best effort, and a marker left behind is deleted by the next claim that can read the directory.
  try {
    for (const stale of staleTriggerMarkers({ current: name, names: readdirSync(dir) })) {
      try {
        unlinkSync(join(dir, stale));
      } catch {
        // Another launcher deleted it first.
      }
    }
  } catch {
    // An unreadable directory costs the cleanup, never the launch.
  }
  return ok(true);
}

/**
 * Whether this window's marker stands as a live claim. A path this cannot even `lstat` — the trigger
 * directory replaced by a file, say, which makes every marker under it `ENOTDIR` — stands for nothing, so the
 * claim that follows meets it and repairs it rather than every caller skipping the launch.
 *
 * @param path the marker
 * @returns true only for a marker present and not {@link abandonedMarker abandoned}
 */
function markerStands({ path }: { path: string }): boolean {
  try {
    return lstatSync(path, { throwIfNoEntry: false }) !== undefined && !abandonedMarker({ path });
  } catch {
    return false;
  }
}

/**
 * Rename aside anything but a directory standing at the trigger directory's path. Nothing a claim writes
 * puts one there, and left in place it fails every claim under it for good; renamed rather
 * than deleted, because it is not this module's to destroy.
 *
 * @param dir the trigger directory
 */
function moveAsideNonDirectory({ dir }: { dir: string }): void {
  try {
    const stat = lstatSync(dir, { throwIfNoEntry: false });
    if (stat !== undefined && !stat.isDirectory()) {
      renameSync(dir, `${dir}.not-a-directory-${String(process.pid)}`);
    }
  } catch {
    // Unreadable, or moved by another caller first: the create below decides it.
  }
}

/** A marker longer than this holds no claim's content, so it is judged without being read. */
const MARKER_READ_BYTES = 64;

/**
 * Whether the marker at `path` is anything but a live claim — see {@link markerAbandoned}. Absent, or a path
 * this cannot even `lstat`, reads as not abandoned and is left to the exclusive create. A regular file it
 * cannot READ is abandoned: its content cannot vouch for a launch, and taking it over needs only the
 * directory.
 *
 * @param path the marker
 * @returns true when the next caller should take the window over
 */
function abandonedMarker({ path }: { path: string }): boolean {
  let stat: Stats | undefined;
  try {
    // `lstat`, never `stat`: a symlink at the marker path is no claim's, and following it would let any
    // non-empty file it points at stand in for a launch.
    stat = lstatSync(path, { throwIfNoEntry: false });
  } catch {
    return false;
  }
  if (stat === undefined) {
    return false;
  }
  const judged = { mtimeMs: stat.mtimeMs, nowMs: Date.now(), regularFile: stat.isFile() };
  if (!judged.regularFile || stat.size > MARKER_READ_BYTES) {
    return markerAbandoned({ ...judged, content: "\u0000" });
  }
  try {
    return markerAbandoned({ ...judged, content: readMarker({ path }) });
  } catch {
    return true;
  }
}

/**
 * A marker's content, read so that nothing swapped in at the path can block or redirect the read: no
 * following a symlink, non-blocking open, and refused unless the opened file is regular.
 *
 * @param path the marker
 * @returns at most {@link MARKER_READ_BYTES} of it, as UTF-8
 */
function readMarker({ path }: { path: string }): string {
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    if (!fstatSync(fd).isFile()) {
      throw new Error("the marker is not a regular file");
    }
    const buffer = Buffer.alloc(MARKER_READ_BYTES);
    const read = readSync(fd, buffer, 0, MARKER_READ_BYTES, 0);
    return buffer.subarray(0, read).toString("utf8");
  } finally {
    closeSync(fd);
  }
}
