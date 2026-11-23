/**
 * Shared fixtures for the `scripts/plugin-mirror-sync.sh` subprocess tests: a plugin root with a mirrorable
 * surface, the hook run exactly as a session start runs it, and the readers that measure what `current` names.
 */

import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readlinkSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach } from "vitest";

import { stripGitEnv } from "../../../../codex/gitRun.js";
import { statFlavourShimDir } from "../../../statFlavourShim.js";
import { gitInTemp } from "../../../tempGitRepo.js";

export const SCRIPT = new URL("../../../../../scripts/plugin-mirror-sync.sh", import.meta.url).pathname;

/**
 * How many files the fixture puts in each of its two mirrored directories. This is the size that reproduced
 * the defect — 11 of 18 concurrent runs failed at it — and a build of it costs ~0.63s, which is the window
 * the contention witness needs in order to fire at all. Repro:
 * `PLUGIN_ROOT=<fixture> PLUGIN_DATA=$(mktemp -d) BIN_DIR=$(mktemp -d) /usr/bin/time -p bash scripts/plugin-mirror-sync.sh`
 */
export const FILES_PER_DIR = 400;

/** An mtime no live holder could have — the fixed clock both the real and the shimmed stale cases use. */
export const LONG_DEAD = new Date("2026-09-16T00:00:00Z");

/**
 * An mtime past `MIRROR_KEEP_SECONDS` (7 days in `plugin-mirror-sync.sh`), for the per-root prune.
 *
 * Deliberately NOT `LONG_DEAD`: that one is three days back, which is long dead for a 120s LOCK and very
 * much alive for a seven-day mirror. Reusing it read correctly and asserted nothing.
 */
export const LAST_BOOTED_A_MONTH_AGO = new Date("2026-08-16T00:00:00Z");
const LONG_DEAD_EPOCH_SECONDS = Math.floor(LONG_DEAD.getTime() / 1000);

// Every fixture directory this file has minted, so `afterEach` can remove them.
export const fixtureDirs: string[] = [];

/** Register the `afterEach` that removes every fixture directory the calling test file has minted. */
export function useFixtureCleanup(): void {
  afterEach(() => {
    for (const dir of fixtureDirs.splice(0)) {
      rmSync(dir, { force: true, recursive: true });
    }
  });
}

/**
 * A plugin root with a mirrorable surface in it, and an empty plugin-data root beside it.
 *
 * @param under a directory to mint the root INSIDE, rather than in a fresh temp base — the real worktree
 *   shape, where a seat's plugin root is `<checkout>/.claude/worktrees.noindex/<branch>` and its mirror
 *   therefore lands inside the `<checkout>` root's own mirror directory
 * @returns the root, and the data and bin directories a SessionStart would hand it
 */
export function fixture({ under }: { under?: string } = {}): { root: string; data: string; bin: string } {
  let base = under;
  if (base === undefined) {
    base = mkdtempSync(join(tmpdir(), "sw-mirror-"));
    fixtureDirs.push(base);
  }
  const root = join(base, "root");
  mkdirSync(join(root, "bin"), { recursive: true });
  mkdirSync(join(root, "scripts"), { recursive: true });
  mkdirSync(join(root, "src", "sub"), { recursive: true });
  mkdirSync(join(root, "templates"), { recursive: true });
  writeFileSync(join(root, "bin", "slopweaver"), "#!/bin/sh\necho MIRRORED\n", { mode: 0o755 });
  // The file EVERY `hooks/hooks.json` command is, so "does this root resolve its hooks" is a question this
  // fixture can actually be asked. Without it the seed case below would assert a path the fixture never
  // carried, and would go on passing after the seed stopped working.
  writeFileSync(join(root, "scripts", "hook.sh"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  writeFileSync(join(root, "package.json"), "{}\n");
  for (let i = 0; i < FILES_PER_DIR; i += 1) {
    writeFileSync(join(root, "src", "sub", `s${String(i)}.ts`), "x".repeat(200));
    writeFileSync(join(root, "templates", `t${String(i)}.json`), "y".repeat(200));
  }
  return { bin: join(base, "bin"), data: join(base, "data"), root };
}

/**
 * The environment a SessionStart hook would run this script under, pointed at a throwaway mirror.
 *
 * @returns the ambient environment minus git's own variables, with the three plugin paths layered over it
 */
export function envFor({ root, data, bin }: { root: string; data: string; bin: string }): Record<string, string> {
  return { ...stripGitEnv({ env: process.env }), BIN_DIR: bin, PLUGIN_DATA: data, PLUGIN_ROOT: root };
}

/**
 * Run the hook once, exactly as a session start does.
 *
 * @param statFlavour a `stat` to put ahead of the real one on PATH, so the OTHER platform's is exercised
 * @param extraEnv variables layered over the hook's own, for the script's one test seam
 * @returns everything it wrote to stderr, which is where both of its decisions announce themselves
 */
export function runOnce({
  root,
  data,
  bin,
  statFlavour,
  extraEnv = {},
}: {
  root: string;
  data: string;
  bin: string;
  statFlavour?: "gnu" | "bsd";
  extraEnv?: Record<string, string>;
}): string {
  const env = { ...envFor({ bin, data, root }), ...extraEnv };
  if (statFlavour !== undefined) {
    // An mtime two days before the fixture was cut, so the shimmed run is unambiguously past the 120s break.
    const shim = statFlavourShimDir({ flavour: statFlavour, mtimeSeconds: LONG_DEAD_EPOCH_SECONDS });
    fixtureDirs.push(shim.dir);
    Object.assign(env, shim.env);
    env["PATH"] = `${shim.dir}:${env["PATH"]!}`;
  }
  return execFileSync("bash", ["-c", `"$0" 2>&1 1>/dev/null`, SCRIPT], { encoding: "utf8", env });
}

/**
 * How many files sit under a directory, at any depth.
 *
 * @returns the count of regular files, directories themselves excluded
 */
export function fileCount({ dir }: { dir: string }): number {
  return readdirSync(dir, { recursive: true, withFileTypes: true }).filter((e) => e.isFile()).length;
}

/**
 * The mirror belonging to ONE plugin root — the per-root layout, where there used to be a single
 * `mirror/` every seat on the machine shared and overwrote.
 *
 * The key is the plugin root path appended whole, so this mirrors `plugin-mirror-sync.sh`'s own
 * `by-root$MIRROR_KEY` rather than re-deriving it: a test that computed the key a second way would agree
 * with itself while disagreeing with the script.
 *
 * @param root the plugin root whose mirror is wanted
 * @returns the absolute path of that root's own mirror directory
 */
export function mirrorRoot({ data, root }: { data: string; root: string }): string {
  return join(data, "mirror", `by-root${root}`);
}

/**
 * The completeness of whatever this root's `current` names — the measurement the old script failed, which
 * reported 199 for a source of 400.
 *
 * @returns a file count per mirrored directory, plus the slot `current` resolves to
 */
export function currentTree({ data, root }: { data: string; root: string }): {
  slot: string;
  templates: number;
  src: number;
} {
  const current = join(mirrorRoot({ data, root }), "current");
  return {
    slot: readlinkSync(current),
    src: fileCount({ dir: join(current, "src") }),
    templates: fileCount({ dir: join(current, "templates") }),
  };
}

/** The lock a booting session takes before it touches a slot — this root's own, never the machine's. */
function lockPath({ data, root }: { data: string; root: string }): string {
  return join(mirrorRoot({ data, root }), ".sync.lock");
}

/**
 * Hold the mirror lock the way a live holder does, without running anything.
 *
 * @returns the lock directory now standing, so a case can backdate or watch it
 */
export function holdLock({ data, root }: { data: string; root: string }): string {
  const lock = lockPath({ data, root });
  mkdirSync(lock, { recursive: true });
  return lock;
}

/**
 * A hook a seat can actually run — the permission bits of whatever `current/scripts/hook.sh` resolves to.
 *
 * `statSync` FOLLOWS the symlink, which is the point: a `current` left dangling satisfies "exists" and is
 * the exact shape of the failure being held down here, so a dangling one throws ENOENT and reddens rather
 * than reading as a pass.
 *
 * @returns the three execute bits as an octal string, so the assertion is exact rather than a truthiness
 */
export function hookExecuteBits({ path }: { path: string }): string {
  return (statSync(path).mode & 0o111).toString(8);
}

/**
 * Commit everything in a fixture root, making it the git checkout every seat's worktree is.
 *
 * @param message the commit subject, so two commits of one fixture differ even when their trees would not
 * @returns the commit the root now sits at
 */
export function commitAll({ root, message }: { root: string; message: string }): string {
  if (!existsSync(join(root, ".git"))) {
    gitInTemp({ args: ["init", "-q"], cwd: root });
  }
  gitInTemp({ args: ["add", "-A"], cwd: root });
  gitInTemp({
    args: ["-c", "user.name=fixture", "-c", "user.email=fixture@example.invalid", "-c", "commit.gpgsign=false"].concat([
      "commit",
      "-q",
      "-m",
      message,
    ]),
    cwd: root,
  });
  return gitInTemp({ args: ["rev-parse", "HEAD"], cwd: root });
}

/**
 * Where a built slot records the commit it was copied from.
 *
 * @returns the path of that slot's `.source-commit` stamp file
 */
export function stampOf({ data, root, slot }: { data: string; root: string; slot: string }): string {
  return join(mirrorRoot({ data, root }), slot, ".source-commit");
}

/** The line a boot prints when it copies nothing — the positive witness every skip case asserts. */
export const MATCH_LINE = "plugin mirror already matches";
