/**
 * Claude Code's auto-memory, carried by the authored class through a mirror under the home — the pure half.
 *
 * Auto-memory lives at `~/.claude/projects/<project-dir>/memory/*.md`, outside `$SLOPWEAVER_HOME`, and every
 * backup leg is home-relative by contract (`src/__tests__/unit/stateHome.guard.test.ts`), so before this a new
 * Mac booted the supervisor with none of its memories ([new machine](../../../docs/store/new-machine.md)). The
 * authored leg of `store import-fleet` now copies each corpus into `$SLOPWEAVER_HOME/claude-memory/<project-dir>/`
 * before it walks, and everything the class already does — the secret scan, content addressing,
 * `authored_absent`, the nightly import ahead of the dump — applies unchanged. `store authored-restore` writes the
 * mirror back into `~/.claude/projects/<project-dir>/memory/`, never over a file already there.
 *
 * A mirror rather than a virtual path prefix pointing at `~/.claude`, because the authored class assumes a
 * home-relative path in six places (the `..` refusal, `homeRelativePath`, `authoredAbsolutePath`,
 * `resolveAuthoredRef`, the restore's inside-the-home check and the absent set), and a prefix would weaken each.
 *
 * ## The mirror never destroys bytes
 *
 * - **A corpus missing from `~/.claude/projects` keeps its whole mirror.** On a fresh machine before the
 *   restore-back, every corpus is missing; removing the mirror would have the same import record every memory
 *   deleted, and `authored-restore` then leaves deleted paths out for good. The residue: a corpus genuinely
 *   deleted stays in the mirror.
 * - **Every file the mirror would remove or overwrite is first kept in the project's attic**, at
 *   `claude-memory/<project-dir>/attic/<sha-prefix>-<file>`. The attic is authored like the rest, so the store and
 *   the backup carry it, and no pass ever deletes from it. That is what makes following the corpus exactly safe:
 *   no pass can tell a memory deleted or rewritten on purpose from a fresh corpus — Claude Code opened on a new
 *   machine before the restore-back writes its own `MEMORY.md` — and no verb reads an older stored version. Three
 *   count-based holds were tried against that ambiguity and each lost memories one way or another (released
 *   itself on the next pass, or never released and stopped backing up new ones). Content-addressed names mean
 *   an attic copy is written once per distinct version and never overwritten. `store authored-restore` restores
 *   the attic into the home with the rest and never into `~/.claude` (`memoryRestoreTarget`), so recovering an
 *   old copy is reading it there.
 */
import { join } from "node:path";

/** The authored directory the mirror lives in — `stateHomePaths().claudeMemory`'s last segment. */
const CLAUDE_MEMORY_DIRECTORY = "claude-memory";

/** The directory in each mirrored project that keeps every version the mirror replaced or removed. */
export const MEMORY_ATTIC_DIRECTORY = "attic";

/** A corpus's flat markdown files, each by name to its sha-256. */
export type MemoryFileHashes = ReadonlyMap<string, string>;

/**
 * One file of one project's corpus.
 *
 * @internal
 */
export interface MemoryMirrorEntry {
  readonly project: string;
  readonly file: string;
}

/** What syncing the mirror to the corpora will do. */
export interface MemoryMirrorPlan {
  /**
   * Mirror files about to be removed or overwritten — each copied into its project's attic first, and an attic
   * file already there counts only when it hashes to `sha256`, so a copy torn by a failed pass is redone.
   */
  readonly retire: readonly (MemoryMirrorEntry & { readonly attic: string; readonly sha256: string })[];
  /** New or changed in the corpus — copied into the mirror. */
  readonly write: readonly MemoryMirrorEntry[];
  /** Gone from a corpus that still exists — removed from the mirror. */
  readonly remove: readonly MemoryMirrorEntry[];
}

/**
 * Decide how the mirror follows the corpora.
 *
 * @param source each corpus present on disk, by project directory name — a corpus left out (absent, or changed
 *   too recently to read whole) leaves its mirror untouched
 * @param mirror each project directory the mirror holds, by name
 * @returns the attic copies, then the writes and the removals they make safe
 */
export function planMemoryMirror({
  source,
  mirror,
}: {
  source: ReadonlyMap<string, MemoryFileHashes>;
  mirror: ReadonlyMap<string, MemoryFileHashes>;
}): MemoryMirrorPlan {
  const projects = [...source]
    .toSorted(([left], [right]) => left.localeCompare(right))
    .map(([project, files]) => planProject({ files, mirrored: mirror.get(project), project }));
  return {
    remove: projects.flatMap((planned) => planned.remove),
    retire: projects.flatMap((planned) => planned.retire),
    write: projects.flatMap((planned) => planned.write),
  };
}

/** One project's share of {@link planMemoryMirror}: a corpus against what its mirror holds, if anything. */
function planProject({
  project,
  files,
  mirrored,
}: {
  project: string;
  files: MemoryFileHashes;
  mirrored: MemoryFileHashes | undefined;
}): MemoryMirrorPlan {
  const retire: (MemoryMirrorEntry & { attic: string; sha256: string })[] = [];
  const write: MemoryMirrorEntry[] = [];
  const remove: MemoryMirrorEntry[] = [];
  for (const [file, sha256] of byName({ hashes: files })) {
    const current = mirrored?.get(file);
    if (current === sha256) {
      continue;
    }
    if (current !== undefined) {
      retire.push({ attic: memoryAtticName({ file, sha256: current }), file, project, sha256: current });
    }
    write.push({ file, project });
  }
  const gone = mirrored === undefined ? [] : byName({ hashes: mirrored }).filter(([file]) => !files.has(file));
  for (const [file, sha256] of gone) {
    retire.push({ attic: memoryAtticName({ file, sha256 }), file, project, sha256 });
    remove.push({ file, project });
  }
  return { remove, retire, write };
}

/** A corpus's files sorted by name, so a plan is the same on every machine. */
function byName({ hashes }: { hashes: MemoryFileHashes }): (readonly [string, string])[] {
  return [...hashes].toSorted(([left], [right]) => left.localeCompare(right));
}

/**
 * The attic file name one version of a memory is kept under: content-addressed, so the same bytes land on the
 * same name and a different version never overwrites it.
 *
 * @param file the memory's file name
 * @param sha256 the version's sha-256, hex
 * @returns `<first 12 hex>-<file>`
 */
function memoryAtticName({ file, sha256 }: { file: string; sha256: string }): string {
  return `${sha256.slice(0, 12)}-${file}`;
}

/**
 * Whether a bare file name is a corpus file — flat markdown, as `src/memory/store.ts` reads a corpus.
 *
 * @param name a directory entry's name
 * @returns true for a `.md` file
 */
export function isMemoryFileName({ name }: { name: string }): boolean {
  return name.endsWith(".md");
}

/**
 * Where a stored mirror path is written back to under Claude Code's projects directory.
 *
 * Only `claude-memory/<project-dir>/<file>.md` has a target: exactly three segments, a markdown leaf, no `.` or
 * `..` segment — so an attic copy, one level deeper, never has one. The project directory's name is used as
 * stored, never rebuilt from a path — reconstructing Claude Code's name mangling is the guess
 * `src/transcripts/source.ts` refuses — so on a machine whose home differs the corpus lands under the old name
 * and says so in `docs/store/new-machine.md`.
 *
 * @param relativePath a stored authored path, `/`-separated
 * @param projectsDir Claude Code's `~/.claude/projects`
 * @returns the target's directory and file, or `undefined` for a path that is not a mirrored memory file
 */
export function memoryRestoreTarget({
  relativePath,
  projectsDir,
}: {
  relativePath: string;
  projectsDir: string;
}): { readonly directory: string; readonly path: string } | undefined {
  const segments = relativePath.split("/");
  if (segments.length !== 3 || segments[0] !== CLAUDE_MEMORY_DIRECTORY) {
    return undefined;
  }
  const project = segments[1]!;
  const file = segments[2]!;
  const unsafe = [project, file].some((segment) => segment === "" || segment === "." || segment === "..");
  if (unsafe || !isMemoryFileName({ name: file })) {
    return undefined;
  }
  const directory = join(projectsDir, project, "memory");
  return { directory, path: join(directory, file) };
}
