/**
 * The shared harness for `readConsoleBuild`'s test files: the fixed SHAs and clock, the fake world and its seams, the
 * one-commit-behind checkout every case starts from, and the per-case throwaway checkout and cache roots.
 *
 * `useConsoleBuildRoots()` mints both roots in a `beforeEach` and removes them in the `afterEach` it registers, so read
 * `root`, `stem` and `claims` only inside a case. A filesystem round-trip into `mkdtempSync` directories, nothing else.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach } from "vitest";

import { cachePaths } from "../../../../cacheHome.js";
import {
  type ConsoleBuildReport,
  consoleRecordKey,
  fetchClaimsDirName,
  LOG_FIELD,
  MAINLINE_FORMAT,
  MAINLINE_LIMIT,
  UPSTREAM_FORMAT,
} from "../../../../checkouts/consoleBuild.js";
import { type ConsoleBuildDeps } from "../../../../checkouts/consoleBuildDeps.js";
import { readConsoleBuild } from "../../../../checkouts/consoleBuildRead.js";
import { type InstalledPlistRead } from "../../../../checkouts/installedApp.js";
import { CONSOLE_PATHSPEC, pathChangeLogArgs, SHELL_PATHSPEC } from "../../../../checkouts/shellChanges.js";

export const SHA_A = "a".repeat(40);
export const SHA_B = "b".repeat(40);
export const NOW_MS = Date.parse("2026-09-28T07:00:30Z");
export const STARTED = "2026-09-28T06:00:00Z";
export const UPSTREAM_READ = `for-each-ref --format=${UPSTREAM_FORMAT} refs/heads/main`;
/** Which of the (uncut, two-commit) window's commits change the desktop app. */
export const SHELL_LOG = pathChangeLogArgs({
  limit: MAINLINE_LIMIT,
  pathspec: SHELL_PATHSPEC,
  sha: SHA_A,
  truncated: false,
}).join(" ");
/** Which of them change the console or its voice. */
export const CONSOLE_LOG = pathChangeLogArgs({
  limit: MAINLINE_LIMIT,
  pathspec: CONSOLE_PATHSPEC,
  sha: SHA_A,
  truncated: false,
}).join(" ");

/** A world the fake seams read and write: files with their mtimes, git answers by argv, and live processes. */
export interface World {
  readonly files: Map<string, { text: string; mtimeMs: number }>;
  readonly git: Map<string, string>;
  readonly processes: Map<number, string>;
  fetchFailure: string | undefined;
  fetches: number;
  fetched: string[];
  claimRefused: boolean;
  plist: InstalledPlistRead;
}

/**
 * Plain fake seams over a {@link World} — injected functions, not mocks.
 *
 * @returns the deps a reading runs against
 */
function fakeDeps({ world }: { world: World }): ConsoleBuildDeps {
  return {
    claim: ({ path }) => {
      if (world.claimRefused || world.files.has(path)) {
        return false;
      }
      world.files.set(path, { mtimeMs: NOW_MS, text: "" });
      return true;
    },
    fetch: ({ remote, refspec }) => {
      world.fetches += 1;
      world.fetched.push(`${remote} ${refspec}`);
      return world.fetchFailure;
    },
    git: ({ args }) => world.git.get(args.join(" ")),
    installedPlist: () => world.plist,
    markClaim: ({ path, decision }) => {
      world.files.set(path, { mtimeMs: NOW_MS, text: decision });
    },
    mtimeMs: ({ path }) => world.files.get(path)?.mtimeMs,
    processArgs: ({ pid }) => world.processes.get(pid),
    readText: ({ path }) => world.files.get(path)?.text,
    stampFetched: ({ path, upstream }) => {
      world.files.set(path, { mtimeMs: NOW_MS, text: upstream });
    },
    sweepClaims: () => undefined,
  };
}

/** The case's throwaway checkout root; a live binding, assigned before each case and read only inside one. */
export let root: string;
let cacheRoot: string;
/** The case's console record stem under the cache root; a live binding, read only inside a case. */
export let stem: string;
/** The case's fetch-claims directory under the cache root; a live binding, read only inside a case. */
export let claims: string;

/**
 * Register the hooks that give every case its own throwaway checkout and cache roots, and remove them after. Call it
 * once, at the top of a test file whose cases read {@link root}, {@link stem} or {@link claims}.
 */
export function useConsoleBuildRoots(): void {
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "console-root-"));
    cacheRoot = mkdtempSync(join(tmpdir(), "console-cache-"));
    stem = join(cachePaths({ root: cacheRoot }).docsSite, consoleRecordKey({ root }));
    claims = join(cachePaths({ root: cacheRoot }).docsSite, fetchClaimsDirName({ root }));
  });

  afterEach(() => {
    rmSync(root, { force: true, recursive: true });
    rmSync(cacheRoot, { force: true, recursive: true });
  });
}

/**
 * A checkout at SHA_B tracking origin/main at SHA_A, one commit behind, with a live production console on :3000.
 *
 * @returns the world, ready for a test to vary
 */
export function worldAt(): World {
  const log = [
    [SHA_A, "2026-09-28T06:59:00+00:00", "Newest (#2)"].join(LOG_FIELD),
    [SHA_B, "2026-09-28T06:00:00+00:00", "Served (#1)"].join(LOG_FIELD),
  ].join("\n");
  const record = { mode: "production", pid: 700, port: 3000, sha: SHA_B, slot: ".next-serve-a", startedIso: STARTED };
  return {
    claimRefused: false,
    fetchFailure: undefined,
    fetched: [],
    fetches: 0,
    files: new Map([[`${stem}.json`, { mtimeMs: 0, text: JSON.stringify({ ...record, worktree: root }) }]]),
    plist: { kind: "absent" },
    git: new Map([
      ["rev-parse HEAD", SHA_B],
      ["symbolic-ref --quiet HEAD", "refs/heads/main"],
      [UPSTREAM_READ, "refs/remotes/origin/main\torigin/main\torigin\trefs/heads/main"],
      ["rev-parse refs/remotes/origin/main", SHA_A],
      // A tag of the tracking ref's SHORT name, at another commit: the reading must never resolve it.
      ["rev-parse origin/main", SHA_B],
      [`rev-list --left-right --count ${SHA_A}...HEAD`, "1\t0"],
      ["remote get-url origin", "git@github.com:lachiejames/slopweaver.git"],
      [`log --first-parent -n ${String(MAINLINE_LIMIT + 1)} --format=${MAINLINE_FORMAT} ${SHA_A}`, log],
      [SHELL_LOG, SHA_A],
      [CONSOLE_LOG, SHA_B],
    ]),
    processes: new Map([[700, "node next start --port 3000"]]),
  };
}

export const homeDocsSite = "/legacy-home/docs-site";

/**
 * Read the console build over a {@link World}'s fake seams, at the fixed clock, from the case's roots.
 *
 * @returns the report the reading produced
 */
export const read = ({ world }: { world: World }): ConsoleBuildReport =>
  readConsoleBuild({ cacheRoot, cwd: root, deps: fakeDeps({ world }), homeDocsSite, nowMs: NOW_MS });
