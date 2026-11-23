import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";

import { ownProcessStart } from "../../../admit/lockHolder.js";
import { STEP_TIMEOUT_MS } from "../../../codexPlugin/checkout.js";
import {
  type CodexAddRun,
  performSync,
  resolveSyncTarget,
  type SyncDeps,
  type SyncPaths,
  type SyncTarget,
} from "../../../codexPlugin/sync.js";
import { syncLockPath } from "../../../codexPlugin/syncLock.js";
import { unwrap } from "../../../lib/result.js";
import { gitInTemp } from "../../tempGitRepo.js";

let root: string;
let paths: SyncPaths;
let head: string;

/**
 * The seeded checkout every case starts from, committed ONCE per file and only ever copied, never written: its
 * `init`, `add`, `commit` and ref writes were most of this file's git spawns. A copy is the same repository, so `head`
 * is the template's commit.
 */
let template: { readonly checkout: string; readonly head: string } | undefined;

afterAll(() => {
  if (template !== undefined) {
    rmSync(template.checkout, { force: true, recursive: true });
  }
});

/** Commit the seeded checkout {@link template} describes, with real git, on the first call. */
function seededCheckout(): { readonly checkout: string; readonly head: string } {
  if (template === undefined) {
    const checkout = mkdtempSync(join(tmpdir(), "codex-plugin-sync-template-"));
    mkdirSync(join(checkout, ".codex-plugin"), { recursive: true });
    writeFileSync(join(checkout, ".codex-plugin", "plugin.json"), JSON.stringify({ name: "slopweaver" }));
    writeFileSync(join(checkout, "README.md"), "tracked\n");
    gitInTemp({ args: ["init", "-q", "-b", "main"], cwd: checkout });
    gitInTemp({ args: ["add", "-A"], cwd: checkout });
    gitInTemp({ args: ["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "seed"], cwd: checkout });
    const seeded = gitInTemp({ args: ["rev-parse", "HEAD"], cwd: checkout });
    gitInTemp({ args: ["update-ref", "refs/remotes/origin/main", seeded], cwd: checkout });
    gitInTemp({ args: ["symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main"], cwd: checkout });
    template = { checkout, head: seeded };
  }
  return template;
}

/** The cache directory Codex would install into for the `personal` marketplace. */
function cacheDir(): string {
  return join(paths.codexHome, "plugins", "cache", "personal", "slopweaver", "local");
}

/** A `codex plugin add` fake that copies the marketplace source the way the real one does, and answers --json. */
function copyingAdd({ status = 0 }: { status?: number } = {}): SyncDeps["codexAdd"] {
  return (): CodexAddRun => {
    if (status !== 0) {
      return { status, stderr: "error: marketplace not found\n", stdout: "" };
    }
    rmSync(cacheDir(), { force: true, recursive: true });
    cpSync(join(paths.userHome, "plugins", "slopweaver"), cacheDir(), { dereference: true, recursive: true });
    return { status: 0, stderr: "", stdout: JSON.stringify({ installedPath: cacheDir(), version: "local" }) };
  };
}

/** Write the personal marketplace pointing slopweaver at `./plugins/slopweaver`. */
function writeMarketplace(): void {
  mkdirSync(join(paths.userHome, ".agents", "plugins"), { recursive: true });
  writeFileSync(
    join(paths.userHome, ".agents", "plugins", "marketplace.json"),
    JSON.stringify({
      name: "personal",
      plugins: [{ name: "slopweaver", source: { path: "./plugins/slopweaver", source: "local" } }],
    }),
  );
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "codex-plugin-sync-"));
  paths = {
    checkout: join(root, "checkout"),
    codexHome: join(root, "codex-home"),
    exportRoot: join(root, "sw-home", "codex-plugin"),
    userHome: join(root, "home"),
  };
  const seeded = seededCheckout();
  cpSync(seeded.checkout, paths.checkout, { recursive: true });
  head = seeded.head;
  writeFileSync(join(paths.checkout, "untracked.txt"), "never exported\n");
  mkdirSync(join(paths.userHome, "plugins"), { recursive: true });
});

afterEach(() => {
  rmSync(root, { force: true, recursive: true });
});

const deps = ({ codexAdd }: { codexAdd: SyncDeps["codexAdd"] }): SyncDeps => ({ codexAdd, nowMs: () => 0 });

/** When a fixture's earlier-build `sync.lock` was made, pinned by `utimesSync`, in seconds and in milliseconds. */
const PLACED_S = 1_700_000_000;
const PLACED_MS = PLACED_S * 1000;
/** The bound an earlier build broke its `sync.lock` at: four step timeouts. */
const DIRECTORY_LOCK_BOUND_MS = 4 * STEP_TIMEOUT_MS;
/** When a fixture holder took the operation lock. */
const HELD_ISO = "2026-11-01T00:00:00.000Z";
const HELD_MS = Date.parse(HELD_ISO);

/** The empty `sync.lock` directory an earlier build took, made at {@link PLACED_S}. */
function directoryLock(): void {
  const lock = join(paths.exportRoot, "sync.lock");
  mkdirSync(lock, { recursive: true });
  utimesSync(lock, PLACED_S, PLACED_S);
}

/** A holder's record in the plugin-sync operation lock, taken at {@link HELD_ISO}. */
function holderRecord({ pid, start }: { pid: number; start: string }): void {
  mkdirSync(syncLockPath({ paths }), { recursive: true });
  writeFileSync(
    join(syncLockPath({ paths }), `${String(pid)}-fixture`),
    JSON.stringify({ acquiredAtIso: HELD_ISO, pid, start }),
  );
}

/** Resolve the fixture checkout's target, throwing when it resolved to a skip — every caller expects one. */
function readyTarget(): SyncTarget {
  const target = unwrap(resolveSyncTarget({ mainCheckouts: [paths.checkout], paths }));
  if ("skip" in target) {
    throw new Error(`expected a target, got a skip: ${target.skip}`);
  }
  return target;
}

describe("codex plugin-sync", () => {
  it("exports HEAD's tracked files, repoints a dangling source, re-adds, and is then current", () => {
    writeMarketplace();
    symlinkSync(join(root, "a-deleted-worktree"), join(paths.userHome, "plugins", "slopweaver"));

    const outcome = performSync({ deps: deps({ codexAdd: copyingAdd() }), paths, target: readyTarget() });

    expect(outcome).toEqual({
      did: "refreshed",
      installedPath: cacheDir(),
      why: `the Codex install carries no source stamp; HEAD is ${head.slice(0, 12)}`,
    });
    expect(readlinkSync(join(paths.userHome, "plugins", "slopweaver"))).toBe(join(paths.exportRoot, "slopweaver"));
    expect(readFileSync(join(cacheDir(), "README.md"), "utf8")).toBe("tracked\n");
    expect(existsSync(join(cacheDir(), "untracked.txt"))).toBe(false);
    expect(existsSync(join(cacheDir(), ".git"))).toBe(false);
    expect(existsSync(syncLockPath({ paths }))).toBe(false);

    const again = unwrap(resolveSyncTarget({ mainCheckouts: [paths.checkout], paths }));
    expect(again).toMatchObject({
      decision: { refresh: false, why: `the Codex install is already ${head.slice(0, 12)}` },
    });
  });

  it("skips a checkout that is not a declared main checkout", () => {
    writeMarketplace();
    const target = unwrap(resolveSyncTarget({ mainCheckouts: [join(root, "elsewhere")], paths }));
    expect(target).toEqual({
      skip: `${paths.checkout} is not a declared main checkout, and only one publishes the Codex install`,
    });
  });

  it("skips a machine with no personal Codex marketplace", () => {
    const target = unwrap(resolveSyncTarget({ mainCheckouts: [paths.checkout], paths }));
    expect(target).toEqual({
      skip: `no personal Codex marketplace at ${join(paths.userHome, ".agents", "plugins", "marketplace.json")}`,
    });
  });

  it("skips a main checkout sitting on a branch other than origin's default", () => {
    writeMarketplace();
    gitInTemp({ args: ["checkout", "-qb", "feature"], cwd: paths.checkout });
    const target = unwrap(resolveSyncTarget({ mainCheckouts: [paths.checkout], paths }));
    expect(target).toEqual({
      skip: `${paths.checkout} is on feature, not main, and only the default branch publishes`,
    });
  });

  it("skips a checkout whose origin/HEAD is unset, naming the command that sets it", () => {
    writeMarketplace();
    gitInTemp({ args: ["symbolic-ref", "--delete", "refs/remotes/origin/HEAD"], cwd: paths.checkout });
    const target = unwrap(resolveSyncTarget({ mainCheckouts: [paths.checkout], paths }));
    expect(target).toEqual({
      skip: `${paths.checkout} has no origin/HEAD, so its default branch is unknown — run \`git remote set-head origin --auto\``,
    });
  });

  // Removing it could remove the live lock an earlier build had just re-taken by breaking the stale one.
  it("ignores an earlier build's sync.lock older than that build's bound, leaves it in place, and refreshes", () => {
    writeMarketplace();
    directoryLock();
    const outcome = performSync({
      deps: { codexAdd: copyingAdd(), nowMs: () => PLACED_MS + DIRECTORY_LOCK_BOUND_MS + 1 },
      paths,
      target: readyTarget(),
    });
    expect([outcome.did, existsSync(join(paths.exportRoot, "sync.lock"))]).toEqual(["refreshed", true]);
  });

  it("stands down while an earlier build's sync.lock is within that build's bound", () => {
    writeMarketplace();
    directoryLock();
    const outcome = performSync({
      deps: { codexAdd: copyingAdd(), nowMs: () => PLACED_MS + DIRECTORY_LOCK_BOUND_MS },
      paths,
      target: readyTarget(),
    });
    expect(outcome).toEqual({
      did: "busy",
      why: `an earlier build's plugin-sync holds ${join(paths.exportRoot, "sync.lock")}`,
    });
  });

  // A lock dated after now was no run's fresh take, so waiting on it would wait as long as the clock lags.
  it("ignores an earlier build's sync.lock dated in the future, leaves it in place, and refreshes", () => {
    writeMarketplace();
    directoryLock();
    const outcome = performSync({
      deps: { codexAdd: copyingAdd(), nowMs: () => PLACED_MS - 1 },
      paths,
      target: readyTarget(),
    });
    expect([outcome.did, existsSync(join(paths.exportRoot, "sync.lock"))]).toEqual(["refreshed", true]);
  });

  it("refuses, removing nothing, a sync.lock that is not the directory an earlier build made", () => {
    writeMarketplace();
    mkdirSync(paths.exportRoot, { recursive: true });
    writeFileSync(join(paths.exportRoot, "sync.lock"), "someone's file\n");
    const outcome = performSync({ deps: deps({ codexAdd: copyingAdd() }), paths, target: readyTarget() });
    expect(outcome).toMatchObject({ did: "failed", error: { code: "SYNC_LOCK_UNAVAILABLE" } });
    expect(readFileSync(join(paths.exportRoot, "sync.lock"), "utf8")).toBe("someone's file\n");
  });

  // That build's lock was always an empty directory, so a full one is somebody else's, not a holder.
  it("refuses, removing nothing, a recent sync.lock directory that is not empty", () => {
    writeMarketplace();
    directoryLock();
    writeFileSync(join(paths.exportRoot, "sync.lock", "sentinel.txt"), "kept\n");
    utimesSync(join(paths.exportRoot, "sync.lock"), PLACED_S, PLACED_S);
    const outcome = performSync({
      deps: { codexAdd: copyingAdd(), nowMs: () => PLACED_MS },
      paths,
      target: readyTarget(),
    });
    expect(outcome).toMatchObject({ did: "failed", error: { code: "SYNC_LOCK_UNAVAILABLE" } });
    expect(readFileSync(join(paths.exportRoot, "sync.lock", "sentinel.txt"), "utf8")).toBe("kept\n");
  });

  it("takes over at once, at any age, a lock whose holder is no longer running", () => {
    writeMarketplace();
    holderRecord({ pid: 2_147_483_646, start: "Thu Jan  1 00:00:00 1970" });
    const outcome = performSync({
      deps: { codexAdd: copyingAdd(), nowMs: () => HELD_MS + 1 },
      paths,
      target: readyTarget(),
    });
    expect([outcome.did, existsSync(syncLockPath({ paths }))]).toEqual(["refreshed", false]);
  });

  // The old lock broke a live run past four step timeouts; this one never ages a holder the kernel still answers for.
  it("stands down for a live holder however long it has held the lock", () => {
    writeMarketplace();
    holderRecord({ pid: process.pid, start: ownProcessStart()! });
    let added = 0;
    const outcome = performSync({
      deps: {
        codexAdd: () => {
          added += 1;
          return copyingAdd()({ pluginId: "unused" });
        },
        nowMs: () => HELD_MS + 100 * DIRECTORY_LOCK_BOUND_MS,
      },
      paths,
      target: readyTarget(),
    });
    expect([outcome.did, added, existsSync(syncLockPath({ paths }))]).toEqual(["busy", 0, true]);
  });

  it("reports a lock it cannot read as a failure, never as another run being busy", () => {
    writeMarketplace();
    mkdirSync(syncLockPath({ paths }), { recursive: true });
    writeFileSync(join(syncLockPath({ paths }), "not-a-record"), "{");
    const outcome = performSync({ deps: deps({ codexAdd: copyingAdd() }), paths, target: readyTarget() });
    expect(outcome).toMatchObject({ did: "failed", error: { code: "SYNC_LOCK_UNAVAILABLE" } });
  });

  it("refuses to replace a real directory at the marketplace's source path", () => {
    writeMarketplace();
    mkdirSync(join(paths.userHome, "plugins", "slopweaver"));
    const outcome = performSync({ deps: deps({ codexAdd: copyingAdd() }), paths, target: readyTarget() });
    expect(outcome).toMatchObject({ did: "failed", error: { code: "SOURCE_NOT_SYMLINK" } });
  });

  it("reports a failed add by its first stderr line", () => {
    writeMarketplace();
    const outcome = performSync({ deps: deps({ codexAdd: copyingAdd({ status: 1 }) }), paths, target: readyTarget() });
    expect(outcome).toMatchObject({
      did: "failed",
      error: { code: "ADD_FAILED", message: "codex plugin add failed: error: marketplace not found" },
    });
  });
});
