/**
 * Claude Code's auto-memory mirror — the effectful half: read each corpus and the mirror, apply
 * `./claudeMemoryMirror.ts`'s plan. A sanctioned local-state seam (`src/admit/sanctionedSeams.ts`): it copies
 * local files into the home and removes the mirror's own copies, and nothing here reaches a provider or writes
 * under `~/.claude`.
 *
 * A corpus changed inside {@link MIRROR_QUIET_MS} is left out of this pass rather than read: all worktrees of a
 * repository share one corpus, so another session can be part-way through a multi-file save, and a mirror of
 * half of it would record the other half deleted. Left out means its mirror is untouched until the next pass.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";

import { errorMessage } from "#lib/errorMessage.js";
import { isRecord } from "#lib/parsers.js";
import { err, ok, type Result } from "#lib/result.js";
import { writeFileAtomicBytes } from "#lib/writeAtomic.js";
import { userDefaultHome } from "../../homeDir.js";
import { memoryCorporaUnder, millisSinceLastChange } from "../../memory/store.js";
import { claudeProjectsDir } from "../../transcripts/source.js";

import {
  isMemoryFileName,
  MEMORY_ATTIC_DIRECTORY,
  type MemoryFileHashes,
  type MemoryMirrorPlan,
  planMemoryMirror,
} from "./claudeMemoryMirror.js";

/**
 * Claude Code's projects directory, when this home is the one that owns it — `~/.slopweaver` itself, never a
 * `--home` or `$SLOPWEAVER_HOME` pointing anywhere else, so a rehearsal or a test can neither read the
 * operator's corpora into a throwaway home nor write a store's memories into the real `~/.claude`.
 *
 * @param home the resolved state home a verb runs against
 * @returns `~/.claude/projects`, or `undefined` for any other home
 */
export function claudeProjectsForHome({ home }: { home: string }): string | undefined {
  if (resolve(home) !== userDefaultHome()) {
    return undefined;
  }
  return claudeProjectsDir();
}

/**
 * How long a corpus must have been still before a pass reads it. A nightly pass has no reason to race a
 * session's save, so the window is generous against `memory check`'s five seconds.
 */
export const MIRROR_QUIET_MS = 60_000;

/** What one pass over the corpora did, or would do. */
export interface MemoryMirrorOutcome {
  /** How many corpora were read. */
  readonly corpora: number;
  readonly plan: MemoryMirrorPlan;
  /** Whether the plan was applied — false on a dry run. */
  readonly applied: boolean;
  /** Each corpus left out because it changed inside {@link MIRROR_QUIET_MS}. */
  readonly recent: readonly string[];
  /** Each corpus or mirror directory that would not read, left untouched. */
  readonly unreadable: readonly { readonly locator: string; readonly why: string }[];
}

/**
 * Bring the mirror in line with every corpus, or on a dry run only plan it.
 *
 * @param projectsDir Claude Code's `~/.claude/projects`
 * @param mirrorRoot the home's `claude-memory` directory
 * @param apply whether to write — false plans only, so a dry-run import writes nothing
 * @param now the current epoch milliseconds
 * @returns the outcome, or why the projects directory would not list
 */
export function syncClaudeMemoryMirror({
  projectsDir,
  mirrorRoot,
  apply,
  now,
}: {
  projectsDir: string;
  mirrorRoot: string;
  apply: boolean;
  now: number;
}): Result<MemoryMirrorOutcome, string> {
  const corpora = memoryCorporaUnder({ projectsDir });
  if (corpora.isErr()) {
    return err(corpora.error.message);
  }
  const { recent, source, unreadable } = readCorpora({ corpora: corpora.value, now });
  const mirrored = mirroredProjects({ mirrorRoot, unreadable });
  if (mirrored.kind === "unreadable") {
    source.clear();
  }
  for (const project of mirrored.unreadableProjects) {
    source.delete(project);
  }
  const plan = planMemoryMirror({ mirror: mirrored.mirror, source });
  if (apply) {
    const applied = applyPlan({ mirrorRoot, plan, projectsDir });
    if (applied.isErr()) {
      return err(applied.error);
    }
  }
  return ok({ applied: apply, corpora: source.size, plan, recent, unreadable });
}

/** Each corpus quiet long enough to read whole, by project, and each left out and why. */
function readCorpora({ corpora, now }: { corpora: readonly string[]; now: number }): {
  recent: string[];
  source: Map<string, MemoryFileHashes>;
  unreadable: { locator: string; why: string }[];
} {
  const unreadable: { locator: string; why: string }[] = [];
  const recent: string[] = [];
  const source = new Map<string, MemoryFileHashes>();
  for (const dir of corpora) {
    const project = basename(dirname(dir));
    const age = millisSinceLastChange({ dir, now });
    if (age.isErr()) {
      unreadable.push({ locator: dir, why: age.error.message });
      continue;
    }
    if (age.value !== null && age.value < MIRROR_QUIET_MS) {
      recent.push(project);
      continue;
    }
    const hashes = hashesIn({ directory: dir });
    if (hashes.isErr()) {
      unreadable.push({ locator: dir, why: hashes.error });
      continue;
    }
    source.set(project, hashes.value);
  }
  return { recent, source, unreadable };
}

/** Every markdown file directly in a directory, by name to its sha-256 — a symbolic link is never read. */
function hashesIn({ directory }: { directory: string }): Result<MemoryFileHashes, string> {
  try {
    const hashes = new Map<string, string>();
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.isFile() && isMemoryFileName({ name: entry.name })) {
        hashes.set(
          entry.name,
          createHash("sha256")
            .update(readFileSync(join(directory, entry.name)))
            .digest("hex"),
        );
      }
    }
    return ok(hashes);
  } catch (cause) {
    return err(errorMessage({ error: cause }));
  }
}

/**
 * Every project directory the mirror holds. An absent mirror is a first run, never a failure. A mirror, or a
 * project directory in it, that would not read is recorded and named, and the caller leaves its corpus out of
 * the pass: planned against a mirror that looked empty, every file of it would be overwritten.
 */
function mirroredProjects({
  mirrorRoot,
  unreadable,
}: {
  mirrorRoot: string;
  unreadable: { locator: string; why: string }[];
}): {
  kind: "read" | "unreadable";
  mirror: ReadonlyMap<string, MemoryFileHashes>;
  unreadableProjects: readonly string[];
} {
  const mirror = new Map<string, MemoryFileHashes>();
  const unreadableProjects: string[] = [];
  let projects: readonly string[];
  try {
    projects = readdirSync(mirrorRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch (cause) {
    if (isRecord(cause) && cause["code"] === "ENOENT") {
      return { kind: "read", mirror, unreadableProjects };
    }
    unreadable.push({ locator: mirrorRoot, why: errorMessage({ error: cause }) });
    return { kind: "unreadable", mirror, unreadableProjects };
  }
  for (const project of projects) {
    const hashes = hashesIn({ directory: join(mirrorRoot, project) });
    if (hashes.isErr()) {
      unreadable.push({ locator: join(mirrorRoot, project), why: hashes.error });
      unreadableProjects.push(project);
      continue;
    }
    mirror.set(project, hashes.value);
  }
  return { kind: "read", mirror, unreadableProjects };
}

/** The sha-256 of a file, or `undefined` when nothing is there to read. */
function sha256Of({ path }: { path: string }): string | undefined {
  if (!existsSync(path)) {
    return undefined;
  }
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

/**
 * Keep every retired version in its project's attic — written whole or not at all, and re-hashed — then copy every planned write with its source's mtime, then
 * remove every planned removal — in that order, so a pass that fails part-way has lost nothing.
 */
function applyPlan({
  plan,
  projectsDir,
  mirrorRoot,
}: {
  plan: MemoryMirrorPlan;
  projectsDir: string;
  mirrorRoot: string;
}): Result<void, string> {
  try {
    for (const { project, file, attic, sha256 } of plan.retire) {
      const kept = join(mirrorRoot, project, MEMORY_ATTIC_DIRECTORY, attic);
      if (sha256Of({ path: kept }) !== sha256) {
        const from = join(mirrorRoot, project, file);
        const modified = statSync(from).mtime;
        writeFileAtomicBytes({ bytes: readFileSync(from), path: kept });
        utimesSync(kept, modified, modified);
        if (sha256Of({ path: kept }) !== sha256) {
          return err(`${kept} does not hash to the version it keeps, so ${file} was left in the mirror`);
        }
      }
    }
    for (const { project, file } of plan.write) {
      const from = join(projectsDir, project, "memory", file);
      const to = join(mirrorRoot, project, file);
      const modified = statSync(from).mtime;
      mkdirSync(dirname(to), { recursive: true });
      writeFileSync(to, readFileSync(from));
      utimesSync(to, modified, modified);
    }
    for (const { project, file } of plan.remove) {
      rmSync(join(mirrorRoot, project, file), { force: true });
    }
    return ok(undefined);
  } catch (cause) {
    return err(errorMessage({ error: cause }));
  }
}
