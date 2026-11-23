/**
 * The effectful edge of `slopweaver fleet burn`: which transcripts and rollouts the last 24 hours touched, streamed
 * line by line through `./hostBurn.ts`'s folds. Nothing here holds a file whole.
 *
 * - **Claude**: every session transcript under `~/.claude/projects` written inside the window, and its subagent
 *   transcripts — a subagent draws from the same plan (`../sessions/spendStore.ts`).
 * - **Codex**: every registered Codex home's rollouts modified inside the window, each physical home read ONCE
 *   (`../codex/modelBurnScan.ts`'s precedent: two spellings of one directory would count every token twice).
 *
 * A host whose root cannot be listed at all is `unavailable` with the reason; a file that cannot be opened makes it
 * `partial`. Read-only, no network, no credential.
 */
import { type Dirent, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { realHomeOf } from "../codex/modelBurnScan.js";
import { rolloutsModifiedWithin } from "../codex/quotaLog.js";
import type { PlanRegisterPort } from "../plans/port.js";
import { plansForProvider } from "../plans/register.js";
import { MAX_LINE_BYTES, surveySessions, transcriptLines } from "../transcripts/source.js";
import { advanceCodexSession, type CodexSessionBurn, codexBurnOf, emptyCodexSessionFold } from "./codexBurn.js";
import {
  ACTIVE_WITHIN_MINUTES,
  advanceClaudeBurn,
  BURN_WINDOW_HOURS,
  type BurnWindow,
  burnWindowOf,
  claudeBurnOf,
  emptyClaudeBurnFold,
  type FleetBurnReport,
  type HostBurn,
} from "./hostBurn.js";

/**
 * Stream one file's lines into a fold, or name why it could not be opened.
 *
 * @param path the file
 * @param onLine what each whole line is handed to
 * @param problems where an unopenable or partly read file is named
 */
function streamInto({
  path,
  onLine,
  problems,
}: {
  path: string;
  onLine: (line: string) => void;
  problems: string[];
}): void {
  const opened = transcriptLines({ path });
  if (opened.isErr()) {
    problems.push(opened.error.message);
    return;
  }
  for (const raw of opened.value.lines) {
    // A line past the reader's limit carries no text, so whatever it held is not counted — said, never dropped.
    if ("oversized" in raw) {
      problems.push(
        `${path}: line ${String(raw.lineNumber)} is over the reader's ${String(MAX_LINE_BYTES)}-byte limit and was not read`,
      );
      continue;
    }
    onLine(raw.line);
  }
  opened.value.problems.forEach((problem) => problems.push(`${path}: ${problem}`));
}

/**
 * Every directory of a Codex home's `sessions/YYYY/MM/DD` tree that exists but could not be listed, and every rollout
 * in it that could not be statted, named. `rolloutsModifiedWithin` reads either as absent, which here would be a
 * smaller figure said as a whole one; a missing `sessions` directory is a home that has run nothing yet, and is no
 * problem.
 *
 * @param sessionsRoot the home's `sessions` directory
 * @param problems where each directory that would not list, or rollout that would not stat, is named
 */
function nameUnlistableUnder({ sessionsRoot, problems }: { sessionsRoot: string; problems: string[] }): void {
  const named = ({ path, verb, error }: { path: string; verb: string; error: unknown }): void => {
    if (!isMissing({ error })) {
      problems.push(`${path}: could not be ${verb} (${messageOf({ error })})`);
    }
  };
  const walk = ({ dir, depth }: { dir: string; depth: number }): void => {
    let entries: Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch (error) {
      named({ error, path: dir, verb: "listed" });
      return;
    }
    if (depth === 3) {
      // A day directory that lists but will not let its files be statted (read without search permission) is read as
      // empty by `rolloutFilesIn` too, so each rollout's mtime is asked for here.
      for (const entry of entries.filter((candidate) => candidate.name.endsWith(".jsonl"))) {
        try {
          statSync(join(dir, entry.name));
        } catch (error) {
          named({ error, path: join(dir, entry.name), verb: "statted" });
        }
      }
      return;
    }
    for (const entry of entries.filter((candidate) => candidate.isDirectory())) {
      walk({ depth: depth + 1, dir: join(dir, entry.name) });
    }
  };
  walk({ depth: 0, dir: sessionsRoot });
}

/** Whether a filesystem error says the path is not there. */
function isMissing({ error }: { error: unknown }): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

/** A filesystem error's message, for a problem line. */
function messageOf({ error }: { error: unknown }): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

/**
 * The transcripts among `paths` last written after an instant, naming any whose mtime cannot be read.
 *
 * @param cutoffMs only a transcript written after this instant is returned
 * @param problems where an unstattable transcript is named
 * @returns the paths
 */
function writtenAfter({
  paths,
  cutoffMs,
  problems,
}: {
  paths: readonly string[];
  cutoffMs: number;
  problems: string[];
}): readonly string[] {
  const fresh: string[] = [];
  for (const path of paths) {
    try {
      if (statSync(path).mtimeMs > cutoffMs) {
        fresh.push(path);
      }
    } catch (error) {
      problems.push(`${path}: could not be read (${messageOf({ error })})`);
    }
  }
  return fresh;
}

/**
 * A session's subagent transcripts written inside the window, judged by their OWN mtime: a subagent can keep writing
 * long after its parent last did. A missing `subagents` directory is the ordinary case; one that will not list, or a
 * transcript whose mtime cannot be read, is named.
 *
 * @param sessionPath the session transcript whose `subagents` directory is read
 * @param cutoffMs only a subagent transcript written after this instant is returned
 * @param problems where an unreadable directory or file is named
 * @returns the paths
 */
function freshSubagents({
  sessionPath,
  cutoffMs,
  problems,
}: {
  sessionPath: string;
  cutoffMs: number;
  problems: string[];
}): readonly string[] {
  const dir = join(sessionPath.slice(0, -".jsonl".length), "subagents");
  let names: readonly string[];
  try {
    names = readdirSync(dir).filter((name) => name.endsWith(".jsonl"));
  } catch (error) {
    if (!isMissing({ error })) {
      problems.push(`${dir}: could not be listed (${messageOf({ error })})`);
    }
    return [];
  }
  return writtenAfter({ cutoffMs, paths: names.map((name) => join(dir, name)), problems });
}

/**
 * Claude's burn over the window.
 *
 * @returns the burn, `unavailable` when the projects directory cannot be listed
 */
function scanClaude({ projectsDir, window }: { projectsDir: string; window: BurnWindow }): HostBurn {
  const listed = surveySessions({ projectsDir });
  if (listed.isErr()) {
    return { kind: "unavailable", why: listed.error.message };
  }
  const fold = emptyClaudeBurnFold();
  // A project directory that would not list may hold a transcript inside the window, so its absence is named.
  const problems: string[] = listed.value.unreadableDirs.map(
    (dir) => `${join(projectsDir, dir)}: could not be listed, so its transcripts were not read`,
  );
  // A transcript only grows by append, so a turn written inside the window moved its mtime inside it too: a file last
  // written at or before the cutoff holds nothing to count. The premise fails only for a file whose mtime was set back.
  // Each file is judged by its own mtime, so a fresh subagent under an older parent is still read.
  for (const session of listed.value.sessions) {
    const parent = session.lastWriteMs > window.cutoffMs ? [session.path] : [];
    const subagents = freshSubagents({ cutoffMs: window.cutoffMs, problems, sessionPath: session.path });
    for (const path of [...parent, ...subagents]) {
      streamInto({
        onLine: (line) => {
          advanceClaudeBurn({ fold, line, path, window });
        },
        path,
        problems,
      });
    }
  }
  return claudeBurnOf({ fold, problems });
}

/**
 * Codex's burn over the window, across every registered home.
 *
 * @returns the burn, `unavailable` when the plan register cannot be read
 */
async function scanCodex({
  home,
  port,
  window,
}: {
  home: string;
  port: PlanRegisterPort;
  window: BurnWindow;
}): Promise<HostBurn> {
  const register = await port.read({ home });
  if (register.isErr()) {
    return { kind: "unavailable", why: register.error.message };
  }
  const seen = new Set<string>();
  const homes = plansForProvider({ plans: register.value.plans, provider: "codex" }).filter((plan) => {
    const real = realHomeOf({ storeDir: plan.storeDir });
    if (seen.has(real)) {
      return false;
    }
    seen.add(real);
    return true;
  });
  if (homes.length === 0) {
    return { kind: "unavailable", why: "the plan register names no Codex home" };
  }
  const problems: string[] = [];
  const sessions: CodexSessionBurn[] = [];
  for (const plan of homes) {
    nameUnlistableUnder({ problems, sessionsRoot: join(plan.storeDir, "sessions") });
    const rollouts = rolloutsModifiedWithin({
      codexHome: plan.storeDir,
      nowMs: window.nowMs,
      windowMs: window.nowMs - window.cutoffMs,
    }).filter((candidate) => candidate.mtimeMs > window.cutoffMs);
    for (const candidate of rollouts) {
      const fold = emptyCodexSessionFold();
      streamInto({
        onLine: (line) => {
          advanceCodexSession({ fold, line, window });
        },
        path: candidate.path,
        problems,
      });
      sessions.push({ fold, path: candidate.path });
    }
  }
  return codexBurnOf({ problems, sessions, window });
}

/**
 * Measure both hosts' burn over the {@link BURN_WINDOW_HOURS} ending at an instant.
 *
 * @param home the state home holding the plan register
 * @param projectsDir `~/.claude/projects`, or a fixture
 * @param nowIso the instant the window ends at
 * @param port where the plan register naming the Codex homes is read; a store outage makes the Codex host
 *   `unavailable`, never a measured zero
 * @returns the report — always one, each host saying for itself what it could not read
 */
export async function scanFleetBurn({
  home,
  projectsDir,
  nowIso,
  port,
}: {
  home: string;
  projectsDir: string;
  nowIso: string;
  port: PlanRegisterPort;
}): Promise<FleetBurnReport> {
  const window = burnWindowOf({ nowMs: Date.parse(nowIso) });
  const claude = scanClaude({ projectsDir, window });
  const codex = await scanCodex({ home, port, window });
  return {
    activeWithinMinutes: ACTIVE_WITHIN_MINUTES,
    fromIso: new Date(window.cutoffMs).toISOString(),
    hosts: { claude, codex },
    observedAtIso: nowIso,
    windowHours: BURN_WINDOW_HOURS,
  };
}
