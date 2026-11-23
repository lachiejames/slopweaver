/**
 * The temp-root sandbox, wired into every test lane's `setupFiles` ahead of the ambient-home guard.
 *
 * Vitest imports a setup file once per TEST FILE, before that file's own module body runs, so every test
 * file gets its own throwaway temp root and `process.env.TMPDIR` points at it for the whole file. Node's
 * `os.tmpdir()` reads that variable on every call rather than caching it, and a spawned child inherits it,
 * so `mkdtempSync(join(tmpdir(), ...))` lands inside this root whether the caller is the test, a helper, the
 * shipped `bin/slopweaver` the subprocess lane spawns, or a `git` it shells. One `rmSync` in `afterAll` then
 * removes everything that file made — including the fixtures of a test that threw before its own cleanup ran,
 * which is the case no per-call-site `afterEach` can reach. `global-temp-root.ts` sweeps the two cases even
 * an `afterAll` cannot: a file whose tests are all skipped, and a worker that dies mid-file.
 *
 * ## The failure this closes
 *
 * MEASURED once: the machine's shared temp directory held **1,409,874** entries, one `os.scandir` over
 * it taking **309.9 seconds**, essentially all of them leaked `mkdtempSync` fixture directories from this
 * repo's own suites (`sw-readthread` 31,302; `slopweaver-recipe-scheduler` 26,231; `slopweaver-linear-run`
 * 25,836; `pr51-shell` 23,873; ~200 more prefixes — every one of them a unit-lane test file). That is past
 * the point where the repo's own gate can pass: `codex/snapshot.test.ts` and two cases in
 * `github/stackSquash.test.ts` timed out at 30s and blocked `slopweaver github push` outright, while the
 * same files against a clean `TMPDIR` passed in 19.33s. Reproduce the count on this machine with:
 *
 *   python3 -c 'import os,time;t=time.time();n=sum(1 for _ in os.scandir(os.environ["TMPDIR"]));print(n,time.time()-t)'
 *
 * ## Why the redirect rather than a cleanup per call site
 *
 * `grep -rc "mkdtempSync" src --include="*.ts" | grep __tests__` reports the scale — hundreds of test files,
 * over a thousand calls — and `.claude/rules/testing.md` already asked each of them to clean up. That rule is
 * what produced the backlog — a convention every new fixture has to remember is not a mechanism, and it
 * cannot cover the failure path where a test throws before reaching its own `rmSync`. One redirect covers
 * every existing call site, every future one, and every path through them.
 *
 * ## Why the root stays under the OS temp directory
 *
 * Pointing the lanes at the repo's own ignored scratch was considered and rejected: a Unix socket path is
 * capped at 104 bytes on darwin, `subprocess/cmux/fakeCmuxServer.ts` binds one under `tmpdir()`, and this
 * checkout's path alone is longer than the OS temp directory it would replace. Staying under `tmpdir()` with
 * SHORT names keeps that socket path inside the cap, which `unit/tempRootSandbox.test.ts` asserts rather
 * than trusts. The whole leak class becomes one directory per run, removed when that run ends, instead of
 * thousands that outlive it.
 */
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll } from "vitest";
import { CACHE_HOME_VAR } from "../cacheHome.js";
import { RUNTIME_ROOT_VAR } from "../stateRuntime.js";
import { DELETE_LEASE_ROOT_VAR } from "../worktree/deleteLease.js";
import {
  BROWSER_SNIFF_GLOBALS,
  restoreEnvironment,
  restoreGlobals,
  workerBaseline,
  workerGlobalsBaseline,
} from "./envSnapshot.js";
import { TEMP_ROOT_PARENT_VAR } from "./global-temp-root.js";

/**
 * The prefix every per-file root carries inside the run's parent. Two characters, because the whole path
 * budget it consumes comes off the 104-byte socket cap the header describes.
 */
export const TEMP_ROOT_PREFIX = "f-";

/**
 * Where this file's root is minted. `global-temp-root.ts` publishes the run's parent before any worker is
 * forked; a lane run without that global setup publishes none, and the root is minted in the shared temp
 * directory instead, so the redirect still works and only the run-level sweep is missing.
 *
 * @returns the published run parent, or the OS temp directory when no global setup published one
 */
function testTempParent(): string {
  const published = process.env[TEMP_ROOT_PARENT_VAR];
  if (published === undefined) {
    return tmpdir();
  }
  return published;
}

// Every key this file moves, as the WORKER first saw it — restored in `afterAll`, because the unit lane reuses a
// fork across files and the next one must not start inside a root this one has removed. The worker's baseline
// rather than this file's, so a skipped file that never reaches `afterAll` cannot become it (`envSnapshot.ts`).
const owned = workerBaseline({
  key: "temp-root",
  names: ["TMPDIR", DELETE_LEASE_ROOT_VAR, CACHE_HOME_VAR, RUNTIME_ROOT_VAR],
});

// The browser-sniff globals, held at the worker's baseline for the same reason: a dependency that defines one
// (`envSnapshot.ts` names the measured case) must not change how the next file's libraries load.
const ownedGlobals = workerGlobalsBaseline({ names: BROWSER_SNIFF_GLOBALS });

// Restored HERE as well as in `afterAll`: a previous file whose tests all skipped never reached its `afterAll`, so
// this file's module scope — and the test module evaluated after it — would otherwise start with its leftovers.
// Before `testTempParent`, whose fallback reads `TMPDIR` and would otherwise name that file's removed root.
restoreEnvironment({ snapshot: owned });
restoreGlobals({ snapshot: ownedGlobals });

const parent = testTempParent();

mkdirSync(parent, { recursive: true });

/** This test file's temp root — minted at module scope, so a module-level fixture already lands inside it. */
const root = mkdtempSync(join(parent, TEMP_ROOT_PREFIX));

// Set before any test module is imported. `os.tmpdir()` prefers TMPDIR on POSIX and re-reads it per call,
// and every spawned child inherits it, so this one assignment moves the whole lane.
process.env["TMPDIR"] = root;

// The machine-wide delete lease lives at a fixed path, outside `TMPDIR` on purpose (`worktree/deleteLease.ts`), so a
// test reaching a real delete would otherwise queue behind the operator's own prune. Here it is this file's alone.
process.env[DELETE_LEASE_ROOT_VAR] = join(root, "delete-lease");

// The cache root sits outside both `$SLOPWEAVER_HOME` and `TMPDIR` by default (`src/cacheHome.ts`), so a test
// reaching the exec store, the console's records or the Codex export would otherwise write the operator's own.
process.env[CACHE_HOME_VAR] = join(root, "cache");

// A home's runtime directory — its locks and cmux stamps — lives under one fixed `/tmp` root for the same reason
// (`stateRuntime.ts`), so a test's would otherwise outlive the file and contend with the operator's. Here, the file's.
process.env[RUNTIME_ROOT_VAR] = join(root, "runtime");

afterAll(() => {
  rmSync(root, { force: true, recursive: true });
  restoreEnvironment({ snapshot: owned });
  restoreGlobals({ snapshot: ownedGlobals });
});
