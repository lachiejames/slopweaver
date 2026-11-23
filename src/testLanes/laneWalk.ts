/**
 * Prove the unit lane's own directories are wholly readable before the merge trusts Vitest's list of them.
 *
 * Vitest walks the include with tinyglobby, which skips a directory it cannot read and says nothing, so every
 * shard and `vitest list` agree on the same SHORT lane and the merge calls it exact. Checking that list against
 * git's listing catches a TRACKED file the walk missed, but git lists nothing under an ignored untracked
 * directory either (a `chmod 000` directory under `site/__tests__/unit/` named in `.gitignore`). So
 * this walks each lane root the way Vitest does — into dot directories, through a symlink to a directory, never
 * into `node_modules` or `.git`, which its default exclude drops — and names every directory it cannot read.
 */
import { type Dirent, readdirSync, realpathSync, statSync } from "node:fs";
import { join } from "node:path";

/** The directory names Vitest 4's default `test.exclude` drops, so a walk of the lane never enters them. */
const PRUNED = new Set(["node_modules", ".git"]);

/**
 * The error code a filesystem call threw, when it carries one.
 *
 * @param error what the call threw
 * @returns the code, or undefined when the thrown value carries none
 */
function errorCode({ error }: { error: unknown }): string | undefined {
  if (error instanceof Error && "code" in error && typeof error.code === "string") {
    return error.code;
  }
  return undefined;
}

/**
 * Whether a directory entry is one the walk descends into: a directory, or a symlink whose target is one. A
 * dangling link is skipped, as Vitest's globber skips it; a link whose target cannot be checked is not.
 *
 * @param entry the directory entry
 * @param path its full path
 * @returns whether to descend, skip, or report the line naming why the target could not be checked
 */
function entryVerdict({ entry, path }: { entry: Dirent; path: string }): EntryVerdict {
  if (entry.isDirectory()) {
    return { kind: "descend" };
  }
  if (!entry.isSymbolicLink()) {
    return { kind: "skip" };
  }
  try {
    return statSync(path).isDirectory() ? { kind: "descend" } : { kind: "skip" };
  } catch (error: unknown) {
    const code = errorCode({ error });
    if (code === "ENOENT" || code === "ELOOP") {
      return { kind: "skip" };
    }
    return { kind: "unreadable", line: `${path}: ${String(error)}` };
  }
}

/** What the walk does with one directory entry. */
type EntryVerdict = { kind: "descend" } | { kind: "skip" } | { kind: "unreadable"; line: string };

/**
 * Walk one directory and everything under it, collecting each directory that could not be read.
 *
 * @param dir the directory to read
 * @param seen real paths already walked, so a symlink cycle ends
 * @param out where each unreadable directory's line is appended
 */
function walk({ dir, seen, out }: { dir: string; seen: Set<string>; out: string[] }): void {
  let entries: Dirent[];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch (error: unknown) {
    out.push(`${dir}: ${String(error)}`);
    return;
  }
  for (const entry of entries) {
    if (PRUNED.has(entry.name)) {
      continue;
    }
    const path = join(dir, entry.name);
    const verdict = entryVerdict({ entry, path });
    if (verdict.kind === "unreadable") {
      out.push(verdict.line);
    }
    if (verdict.kind !== "descend") {
      continue;
    }
    const real = realpathSync(path);
    if (seen.has(real)) {
      continue;
    }
    seen.add(real);
    walk({ dir: path, out, seen });
  }
}

/**
 * Every directory under the lane's roots that could not be read. A root that does not exist holds no test and
 * is not one; a root that exists and cannot be read is.
 *
 * @param cwd the repository root
 * @param roots the lane's root directories, repo-relative
 * @returns one line per directory the walk could not read; empty means the whole lane was readable
 */
export function unreadableLaneDirectories({
  cwd,
  roots,
}: {
  cwd: string;
  roots: readonly string[];
}): readonly string[] {
  const out: string[] = [];
  for (const root of roots) {
    const dir = join(cwd, root);
    let real: string;
    try {
      real = realpathSync(dir);
    } catch (error: unknown) {
      if (errorCode({ error }) !== "ENOENT") {
        out.push(`${dir}: ${String(error)}`);
      }
      continue;
    }
    walk({ dir, out, seen: new Set([real]) });
  }
  return out;
}
