/**
 * The ONLY filesystem edge in `src/memory`. Every read goes through `safeFs`, so a permissions failure or a
 * vanished file becomes a typed error rather than a throw. Reads only — no writes, no spawns, so this file
 * needs no admit-door seam.
 *
 * ## A missing directory is an ERROR here, unlike the handover board
 *
 * `handover/store.ts` treats `ENOENT` as an empty board, because "nobody has written a doc yet" is the normal
 * state on a fresh machine. The opposite is true here: `--dir` is supplied explicitly by a human or a hook
 * config, so a directory that is not there means the path is wrong. Reporting that as an empty, clean corpus
 * would be the precise failure that requiring `--dir` was meant to prevent.
 */
import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";

import type { IngestError } from "../lib/ingestError.js";
import { isGenuinelyAbsent } from "../lib/pathLinks.js";
import type { Result } from "../lib/result.js";
import { safeFs } from "../lib/safeBoundary.js";
import { buildMemoryCorpus, parseMemoryLeaf } from "./corpus.js";
import { type MemoryCorpus, type MemoryLeaf, type MemorySourceFile, ROOT_INDEX_FILE } from "./types.js";

/**
 * Every auto-memory corpus on this machine, sorted.
 *
 * A corpus is a `~/.claude/projects/<project>/memory` directory that actually holds a `MEMORY.md` —
 * `types.ts` says that is what makes a directory a corpus, and including one without it would report
 * `missing-root-index` against every project that simply has no memories yet.
 *
 * An absent projects root is an EMPTY list rather than an error, which is the opposite of
 * {@link readMemoryCorpus}’s contract above and for the opposite reason: nobody named this path, so “there
 * are none” is the honest answer on a fresh machine rather than evidence of a wrong argument.
 *
 * @param userHome the current user’s home directory
 * @returns the corpus directories, sorted, or a typed I/O error
 */
export function discoverMemoryCorpora({ userHome }: { userHome: string }): Result<readonly string[], IngestError> {
  return memoryCorporaUnder({ projectsDir: join(userHome, ".claude", "projects") });
}

/**
 * Every auto-memory corpus under one Claude Code projects directory, sorted — {@link discoverMemoryCorpora}
 * for a caller that was handed the directory rather than a user home, so a test never reaches the real one.
 *
 * @param projectsDir a `~/.claude/projects` directory
 * @returns the corpus directories, sorted, or a typed I/O error
 */
export function memoryCorporaUnder({ projectsDir }: { projectsDir: string }): Result<readonly string[], IngestError> {
  return safeFs({
    execute: (): readonly string[] => {
      if (!existsSync(projectsDir)) {
        return [];
      }
      return readdirSync(projectsDir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => join(projectsDir, entry.name, "memory"))
        .filter((dir) => existsSync(join(dir, ROOT_INDEX_FILE)))
        .toSorted();
    },
    operation: "memory.discoverCorpora",
    path: projectsDir,
  });
}

/** One `<project>/memory` candidate: a corpus, or one whose root index could not be told present or absent. */
export type MemoryCorpusCandidate =
  | { readonly kind: "corpus"; readonly dir: string }
  | { readonly kind: "unreadable"; readonly dir: string; readonly why: string };

/**
 * The root index's state under one project directory, `stat` failures kept apart by code and by link.
 *
 * @param projectDir a `~/.claude/projects/<project>` path, a link to one included
 * @returns the candidate, or `undefined` when no root index is there
 */
function candidateOf({ projectDir }: { projectDir: string }): MemoryCorpusCandidate | undefined {
  const dir = join(projectDir, "memory");
  const index = join(dir, ROOT_INDEX_FILE);
  try {
    if (!statSync(index).isFile()) {
      return { dir, kind: "unreadable", why: `${index} is not a file, so the corpus it indexes cannot be read` };
    }
    return { dir, kind: "corpus" };
  } catch (error) {
    if (isGenuinelyAbsent({ path: index })) {
      return undefined;
    }
    return { dir, kind: "unreadable", why: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Every auto-memory corpus under one projects directory, AND every candidate whose root index would not stat —
 * {@link memoryCorporaUnder} without the `existsSync` that folds a permission failure into absence. A caller that
 * must not read an unreadable corpus as "no memories" (a Queue card's steers half) reads this instead.
 *
 * @param projectsDir a `~/.claude/projects` directory; absent is an empty list, as for {@link memoryCorporaUnder}
 * @returns the candidates, sorted by directory, or a typed I/O error when the root itself would not list
 */
export function memoryCorpusCandidatesUnder({
  projectsDir,
}: {
  projectsDir: string;
}): Result<readonly MemoryCorpusCandidate[], IngestError> {
  return safeFs({
    execute: (): readonly MemoryCorpusCandidate[] => {
      try {
        statSync(projectsDir);
      } catch (error) {
        // Absent only when genuinely not there: a dangling link on or above it is a root that would not read.
        if (isGenuinelyAbsent({ path: projectsDir })) {
          return [];
        }
        throw error;
      }
      // Only a REGULAR file is skipped: it holds no memory folder, and naming it would fail every card on a machine whose
      // root carries a `.DS_Store` (measured: `find ~/.claude/projects -maxdepth 1 -not -type d`). Anything
      // else goes on — a link is a project, and a FIFO or socket where a project stands reads as unreadable, never as
      // nothing.
      return readdirSync(projectsDir, { withFileTypes: true })
        .filter((entry) => !entry.isFile())
        .map((entry) => join(projectsDir, entry.name))
        .toSorted()
        .map((projectDir) => candidateOf({ projectDir }))
        .filter((candidate) => candidate !== undefined);
    },
    operation: "memory.discoverCorpusCandidates",
    path: projectsDir,
  });
}

/** Markdown files directly in the directory, sorted. Subdirectories and other extensions are not corpus. */
function markdownNames({ dir }: { dir: string }): readonly string[] {
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
    .map((entry) => entry.name)
    .toSorted();
}

/**
 * Read and classify a whole corpus.
 *
 * @param dir the corpus directory
 * @returns the classified corpus, or a typed I/O error
 */
export function readMemoryCorpus({ dir }: { dir: string }): Result<MemoryCorpus, IngestError> {
  return safeFs({
    execute: (): MemoryCorpus => {
      const files: MemorySourceFile[] = [];
      for (const file of markdownNames({ dir })) {
        // mtime is read HERE, in the one filesystem edge, rather than by the sweep — a second module stat'ing
        // the same directory is a second reader, and two readers of one corpus is the drift this module's
        // whole shape is arranged to prevent.
        files.push({ file, mtimeMs: statSync(join(dir, file)).mtimeMs, text: readFileSync(join(dir, file), "utf8") });
      }
      // Resolved ONCE, and resolved through symlinks — see `outsidePointerResolves` for why that matters.
      const base = resolveRealPath({ path: dir });
      return buildMemoryCorpus({ files, resolvesOutside: ({ target }) => outsidePointerResolves({ base, target }) });
    },
    operation: "memory.readCorpus",
    path: dir,
  });
}

/**
 * Whether a pointer leaving the corpus directory names something that exists.
 *
 * Existence-checked only, never read: the corpus decides which paths get stat'd, and each is only tested for
 * presence, so this stays honest about a link the corpus declares without becoming something that reads
 * arbitrary files.
 *
 * `base` must ALREADY be symlink-resolved, and that is the whole substance of this function. The documented
 * memory directory `~/.claude/projects/<project>/memory` is frequently a symlink to somewhere else, and a
 * relative link inside it is written against where the files really live. Resolving `../../../x` from the
 * symlink path lands somewhere that does not exist, so the same corpus reported clean via one spelling of
 * `--dir` and two dead pointers via the other — false positives decided entirely by how you spelled the path,
 * and the spelling Claude Code itself uses was the failing one. Found by running this against a real corpus,
 * not by a test.
 */
function outsidePointerResolves({ base, target }: { base: string; target: string }): boolean {
  return existsSync(isAbsolute(target) ? target : resolve(base, target));
}

/**
 * Read and parse ONE leaf — the write-triggered hook's whole job, so it never pays for the rest of the corpus.
 *
 * @param dir the corpus directory
 * @param basename the leaf's filename
 * @returns the parsed leaf, or a typed I/O error
 */
export function readMemoryLeafFile({
  dir,
  basename,
}: {
  dir: string;
  basename: string;
}): Result<MemoryLeaf, IngestError> {
  return safeFs({
    execute: (): MemoryLeaf => parseMemoryLeaf({ file: basename, text: readFileSync(join(dir, basename), "utf8") }),
    operation: "memory.readLeaf",
    path: join(dir, basename),
  });
}

/**
 * Milliseconds since the most recently modified file in the corpus.
 *
 * This is the guard on the whole-corpus pass. All worktrees of one repository share a single auto-memory
 * directory, so another session can be part-way through a multi-file save when this one starts — and the graph
 * would then be read mid-write, reporting an orphan or a double-route that the other session is about to
 * resolve. When the corpus was touched recently we say nothing instead.
 *
 * It shrinks the window rather than closing it: a restructure that pauses longer than the threshold between
 * writes can still be observed half-done. A lock would close it properly and is not worth the complexity for a
 * read-only advisory check — but a missed check is safe, and a false finding is not.
 *
 * @param dir the corpus directory
 * @param now the current epoch milliseconds, injected so this is testable
 * @returns age of the newest change, or `null` for an empty directory
 */
export function millisSinceLastChange({ dir, now }: { dir: string; now: number }): Result<number | null, IngestError> {
  return safeFs({
    execute: (): number | null => {
      let newest: number | null = null;
      for (const file of markdownNames({ dir })) {
        const modified = statSync(join(dir, file)).mtimeMs;
        newest = newest === null || modified > newest ? modified : newest;
      }
      return newest === null ? null : now - newest;
    },
    operation: "memory.lastChange",
    path: dir,
  });
}

/**
 * Resolve a path's symlinks, or return it unchanged when it cannot be resolved.
 *
 * Falling back to the input is deliberate: this is only ever used to compare two names for the same directory,
 * and an unresolvable path simply will not match — which is the same outcome as a genuine mismatch, and much
 * better than a throw inside a hook whose contract is to stay silent.
 *
 * @param path the path to resolve
 * @returns the resolved path, or the original
 */
export function resolveRealPath({ path }: { path: string }): string {
  const resolved = safeFs({ execute: (): string => realpathSync(path), operation: "memory.realpath", path });
  return resolved.isOk() ? resolved.value : path;
}
