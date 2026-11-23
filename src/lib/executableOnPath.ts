/**
 * Find an executable the way `spawnSync` would: a bare name walked over `PATH`, entry by entry, first
 * executable FILE wins.
 *
 * One resolver, two callers. `src/route/commandReadings.ts` grades a capability row's executable with it, and
 * `doctor`'s environment probes (`src/environment/`) ask whether a dependency is installed with it. Neither
 * shells out to `which`: the route grading sits on a live turn's path and must not spawn a process per row,
 * and `doctor`'s free probes may not spawn one at all.
 *
 * What a miss MEANS is the caller's to decide, because it depends on who will run the name. `PATH` is the
 * complete answer for `execFileSync`/`spawnSync` and a `#!/usr/bin/env` shebang, none of which sees a shell
 * function or alias; it is not the complete answer for a command line a host's interactive shell will run.
 */
import { accessSync, constants, lstatSync, readlinkSync, statSync } from "node:fs";
import { join } from "node:path";

import { safeFs } from "./safeBoundary.js";

/**
 * The `PATH` entries to walk, as the host declares them.
 *
 * @param env the environment to read `PATH` from; the process's own when omitted
 * @returns the non-empty entries, in order
 */
export function hostPathEntries({
  env = process.env,
}: { env?: Readonly<Record<string, string | undefined>> } = {}): readonly string[] {
  const declared = env["PATH"];
  if (declared === undefined || declared.length === 0) {
    return [];
  }
  return declared.split(":").filter((entry) => entry.length > 0);
}

/**
 * Whether a path names a FILE this process may execute.
 *
 * The file check is not belt-and-braces: `access(dir, X_OK)` succeeds for any directory the process may
 * traverse, so without it a `PATH` entry containing a directory called `rg` would grade as ripgrep. Both
 * calls follow symlinks, so a link whose target is gone is not executable — which is exactly the dangling
 * `~/.local/bin/slopweaver` shim this has to catch.
 *
 * @param path the candidate, already absolute or relative to this process's own cwd
 * @returns true when it is a regular file with the executable bit set for this process
 */
export function isExecutableFile({ path }: { path: string }): boolean {
  return safeFs({
    execute: () => {
      accessSync(path, constants.X_OK);
      return statSync(path).isFile();
    },
    operation: "lib.isExecutableFile",
    path,
  }).unwrapOr(false);
}

/**
 * The first `PATH` entry holding an executable file of this name, joined into its absolute path.
 *
 * @param name a bare command name, never a path
 * @param pathEntries the directories to walk, in order
 * @returns the path `spawnSync` would run, or null when no entry holds one
 */
export function resolveOnPath({ name, pathEntries }: { name: string; pathEntries: readonly string[] }): string | null {
  const found = pathEntries.find((entry) => isExecutableFile({ path: join(entry, name) }));
  if (found === undefined) {
    return null;
  }
  return join(found, name);
}

/** A `PATH` entry that holds a symlink of the asked-for name whose target does not resolve. */
export interface DanglingLink {
  /** Where the link itself sits. */
  readonly link: string;
  /** What it points at, exactly as written in the link. */
  readonly target: string;
}

/**
 * The first `PATH` entry holding a SYMLINK of this name that does not resolve to an executable file.
 *
 * This is what turns "not on PATH" into the true sentence when the name is in fact sitting there: a link
 * was installed, and what it points at is gone. Measured on the owner's own machine, where
 * `~/.local/bin/slopweaver` had been dangling unnoticed.
 *
 * @param name a bare command name, never a path
 * @param pathEntries the directories to walk, in order
 * @returns the first broken link, or null when none is there
 */
export function danglingLinkOnPath({
  name,
  pathEntries,
}: {
  name: string;
  pathEntries: readonly string[];
}): DanglingLink | null {
  for (const entry of pathEntries) {
    const link = join(entry, name);
    const target = safeFs({
      execute: () => (lstatSync(link).isSymbolicLink() ? readlinkSync(link) : null),
      operation: "lib.danglingLinkOnPath",
      path: link,
    }).unwrapOr(null);
    if (target !== null && !isExecutableFile({ path: link })) {
      return { link, target };
    }
  }
  return null;
}
