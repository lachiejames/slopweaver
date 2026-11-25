/**
 * The effectful edge of the chair's hand-off cadence: which Claude Code each chair session runs (its transcript),
 * which one a fresh boot runs (`claude --version`, through whatever wrapper PATH puts first — exactly what
 * `cmux spawn` would launch), the newest one installed (Claude Code's own versions directory), when each chair
 * session booted against what `origin/main` has changed in its canon since (`./chairCanon.ts`), and how many times
 * each chair session has been auto-compacted (`./chairAutoCompaction.ts`).
 *
 * Every read degrades to UNMEASURED rather than throwing: a tick must record whatever this could not see. The
 * judgement is `./chairCadence.ts`.
 */
import { execFileSync } from "node:child_process";
import { accessSync, constants, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { err, ok, type Result } from "#lib/result.js";
import {
  type ClaudeCodeVersionReading,
  newestClaudeCodeVersion,
  parseClaudeVersionOutput,
  readClaudeCodeVersion,
} from "../claude/claudeCodeVersion.js";

import { readTail, scanSessions, transcriptPathFor } from "../sessions/liveSessionStore.js";
import { DEPTH_TAIL_BYTES } from "../sessions/tokenDepth.js";
import { findOnlyTranscript, transcriptLines } from "../transcripts/source.js";
import { type ChairAutoCompactionReading, countChairAutoCompactions } from "./chairAutoCompaction.js";
import { type ChairCanonReading, canonLogArgs, readChairCanonFor, readChairCanonSince } from "./chairCanon.js";
import type { ChairRead } from "./chairGate.js";
import { claudeHomeDir } from "./chairRead.js";
import { type SupervisorCoreError, SupervisorCoreErrors } from "./errors.js";

/**
 * How long the canon `git log` may take. MEASURED in a worktree of this repository: 0.09s real for 33
 * canon commits over three days (`/usr/bin/time -p git log origin/main --since=<three days back>
 * --format=%H%x09%cI%x09%s -- skills/supervisor .claude/rules AGENTS.md`); five seconds keeps a wedged repository
 * from stalling a tick.
 *
 * @internal
 */
export const CANON_LOG_TIMEOUT_MS = 5_000;

/**
 * How long `claude --version` may take. MEASURED through the cmux shim: 0.17–0.28s real over
 * three runs (`/usr/bin/time -p claude --version`); five seconds keeps a wedged wrapper from stalling a tick.
 *
 * @internal
 */
export const CLAUDE_VERSION_TIMEOUT_MS = 5_000;

/** The seams the version reads touch, injected so a test passes plain functions. */
export interface ClaudeCodeVersionDeps {
  /** The versions directory's entries that are runnable executables, or throws. */
  readonly listInstalled: () => readonly string[];
  /** What `claude --version` printed, or throws. */
  readonly runVersion: () => string;
}

/**
 * Where the native installer keeps one executable per Claude Code version.
 *
 * @returns the absolute path
 */
function claudeVersionsDir(): string {
  return join(homedir(), ".local", "share", "claude", "versions");
}

/**
 * The Claude Code a fresh boot runs, and the newest one installed.
 *
 * @param deps the directory listing and the version command
 * @returns both readings, each measured or saying why not
 */
export function readClaudeCodeVersions({ deps }: { deps: ClaudeCodeVersionDeps }): {
  boots: ClaudeCodeVersionReading;
  newestInstalled: ClaudeCodeVersionReading;
} {
  let boots: ClaudeCodeVersionReading;
  try {
    boots = parseClaudeVersionOutput({ output: deps.runVersion() });
  } catch (error: unknown) {
    boots = { kind: "unmeasured", why: `\`claude --version\` failed (${String(error)})` };
  }
  let newestInstalled: ClaudeCodeVersionReading;
  try {
    const newest = newestClaudeCodeVersion({ names: deps.listInstalled() });
    newestInstalled =
      newest === undefined
        ? { kind: "unmeasured", why: "Claude Code's versions directory holds no version" }
        : { kind: "measured", version: newest };
  } catch (error: unknown) {
    newestInstalled = {
      kind: "unmeasured",
      why: `Claude Code's versions directory could not be listed (${String(error)})`,
    };
  }
  return { boots, newestInstalled };
}

/**
 * The entries of a versions directory that are runnable: a regular file, through any symlink, that this user may
 * execute. A dangling link or a stray file is not an installed Claude Code.
 *
 * @param dir the versions directory
 * @returns the runnable entries' names; throws when the directory cannot be listed
 */
export function listInstalledExecutables({ dir }: { dir: string }): readonly string[] {
  return readdirSync(dir).filter((name) => {
    const path = join(dir, name);
    try {
      accessSync(path, constants.X_OK);
      return statSync(path).isFile();
    } catch {
      return false;
    }
  });
}

/**
 * The production seams: the real directory and the real command.
 *
 * @returns the deps for {@link readClaudeCodeVersions}
 */
export function productionClaudeCodeVersionDeps(): ClaudeCodeVersionDeps {
  return {
    listInstalled: () => listInstalledExecutables({ dir: claudeVersionsDir() }),
    runVersion: () =>
      execFileSync("claude", ["--version"], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
        timeout: CLAUDE_VERSION_TIMEOUT_MS,
      }),
  };
}

/**
 * Run `git` with an argv and return its stdout, or the typed failure — the production canon-log seam.
 *
 * @param args the argv, without the `git` itself
 * @returns stdout, or why git could not be run
 */
function runCanonGit({ args }: { args: readonly string[] }): Result<string, SupervisorCoreError> {
  try {
    return ok(
      execFileSync("git", [...args], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        timeout: CANON_LOG_TIMEOUT_MS,
      }),
    );
  } catch (error: unknown) {
    return err(SupervisorCoreErrors.canonLogFailed({ cause: error }));
  }
}

/**
 * Each chair session's boot, off Claude Code's own session registry, and the canon commits `origin/main` has
 * landed since — run in the pinned workspace's own worktree, which is the checkout the chair loaded its text from.
 *
 * A registry that cannot be read, or holds no file for a session's pid, reads that session UNMEASURED rather than
 * dropping it, exactly as the plan and version reads do.
 *
 * @param read the chair read the gate already made
 * @param claudeHome the resolved `~/.claude`
 * @param runGit runs `git` with an argv; {@link runCanonGit} in production
 * @returns one reading per session id; empty when the chair could not be read
 */
function readChairCanon({
  read,
  claudeHome,
  runGit,
}: {
  read: ChairRead;
  claudeHome: string;
  runGit: (options: { args: readonly string[] }) => Result<string, SupervisorCoreError>;
}): ReadonlyMap<string, ChairCanonReading> {
  const readings = new Map<string, ChairCanonReading>();
  if (read.kind === "unresolved") {
    return readings;
  }
  const scan = scanSessions({ sessionsDir: join(claudeHome, "sessions") });
  for (const { sessionId, pid } of read.sessions) {
    if (scan.unreadable !== undefined) {
      readings.set(sessionId, {
        kind: "unmeasured",
        why: `the Claude session registry could not be read (${scan.unreadable})`,
      });
      continue;
    }
    if (pid === undefined) {
      readings.set(sessionId, {
        kind: "unmeasured",
        why: "an app-hosted chair names no pid, so its boot is not in the Claude session registry to read",
      });
      continue;
    }
    const record = scan.records.find((entry) => entry.pid === pid && entry.sessionId === sessionId);
    if (record === undefined) {
      readings.set(sessionId, { kind: "unmeasured", why: "the Claude session registry holds no file for its pid" });
      continue;
    }
    readings.set(
      sessionId,
      readChairCanonFor({
        runLog: ({ sinceIso }) => runGit({ args: canonLogArgs({ cwd: read.directory, sinceIso }) }),
        startedAtMs: record.startedAtMs,
      }),
    );
  }
  return readings;
}

/**
 * {@link readChairCanon} as `supervisor tick-record` runs it: the real `~/.claude` registry and the real `git`.
 *
 * @param chair the chair read the gate already made
 * @returns one reading per session id; empty when the chair could not be read
 */
export function readLiveChairCanon({ chair }: { chair: ChairRead }): ReadonlyMap<string, ChairCanonReading> {
  return readChairCanon({ claudeHome: claudeHomeDir(), read: chair, runGit: runCanonGit });
}

/**
 * A Codex chair's canon staleness from the instant its record took the chair, with the real `git` — no rollout is
 * opened and no Claude registry is read.
 *
 * @param cwd the checkout the tick runs in, which is the chair's own when the chair records its tick
 * @param bootedIso the instant the chair's pin or chain link took the chair
 * @returns the instant and every canon commit strictly after it, or why either could not be read
 */
export function readLiveChairCanonSince({ cwd, bootedIso }: { cwd: string; bootedIso: string }): ChairCanonReading {
  return readChairCanonSince({
    bootedIso,
    runLog: ({ sinceIso }) => runCanonGit({ args: canonLogArgs({ cwd, sinceIso }) }),
  });
}

/**
 * The Claude Code version each chair session's transcript was last written by.
 *
 * @param read the chair read the gate already made
 * @param claudeHome the resolved `~/.claude`
 * @returns one reading per session id; empty when the chair could not be read
 */
export function readChairClaudeCodeVersions({
  read,
  claudeHome,
}: {
  read: ChairRead;
  claudeHome: string;
}): ReadonlyMap<string, ClaudeCodeVersionReading> {
  const readings = new Map<string, ClaudeCodeVersionReading>();
  if (read.kind === "unresolved") {
    return readings;
  }
  for (const { sessionId } of read.sessions) {
    const path = transcriptPathFor({ projectsDir: join(claudeHome, "projects"), sessionId });
    if (path === undefined) {
      readings.set(sessionId, { kind: "unmeasured", why: "no transcript was found for this session" });
      continue;
    }
    try {
      readings.set(sessionId, readClaudeCodeVersion({ text: readTail({ maxBytes: DEPTH_TAIL_BYTES, path }) }));
    } catch (error: unknown) {
      readings.set(sessionId, { kind: "unmeasured", why: `its transcript could not be read (${String(error)})` });
    }
  }
  return readings;
}

/**
 * One chair session's automatic compactions, streamed off its one transcript and stopped at the trial count.
 *
 * The count is of the transcript as it stood when the walk opened: a boundary the chair appends mid-walk is the next
 * tick's, a hand-off one tick late rather than a count the snapshot understates.
 *
 * @param projectsDir `~/.claude/projects`
 * @param sessionId the chair session
 * @returns the count, the trial reached, or why its transcript cannot say
 */
function sessionAutoCompactions({
  projectsDir,
  sessionId,
}: {
  projectsDir: string;
  sessionId: string;
}): ChairAutoCompactionReading {
  const path = findOnlyTranscript({ projectsDir, sessionId });
  if (path.isErr()) {
    return { kind: "unmeasured", why: path.error.message };
  }
  const stream = transcriptLines({ path: path.value });
  if (stream.isErr()) {
    return { kind: "unmeasured", why: stream.error.message };
  }
  const counted = countChairAutoCompactions({ lines: stream.value.lines });
  // Five verified boundaries prove the trial whatever the unread tail holds; a count below it is only as good
  // as the whole walk, so a partial one cannot vouch for it.
  const [problem] = stream.value.problems;
  if (counted.kind === "below-trial" && problem !== undefined) {
    return { kind: "unmeasured", why: `its transcript could not be read whole — ${problem}` };
  }
  return counted;
}

/**
 * How many times each chair session has been auto-compacted, read once per session id (`./chairCadence.ts`
 * judges it against the five-auto-compaction trial).
 *
 * Two live processes resuming one session id share one transcript, so it is walked once and counted once.
 *
 * @param read the chair read the gate already made
 * @param claudeHome the resolved `~/.claude`, which holds the transcripts
 * @returns one reading per session id; empty when the chair could not be read
 */
export function readChairAutoCompactions({
  read,
  claudeHome,
}: {
  read: ChairRead;
  claudeHome: string;
}): ReadonlyMap<string, ChairAutoCompactionReading> {
  const readings = new Map<string, ChairAutoCompactionReading>();
  if (read.kind === "unresolved") {
    return readings;
  }
  const projectsDir = join(claudeHome, "projects");
  for (const { sessionId } of read.sessions) {
    if (!readings.has(sessionId)) {
      readings.set(sessionId, sessionAutoCompactions({ projectsDir, sessionId }));
    }
  }
  return readings;
}
