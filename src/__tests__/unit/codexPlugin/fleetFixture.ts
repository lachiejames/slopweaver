/**
 * A synthetic fleet for the `codex plugin-sync` tests: a real git checkout declared main, a user home for the
 * personal marketplace, one registered Codex home and one ambient one — every path under a throwaway root, so
 * no case reads or writes a real Codex home. The fakes stand in for `codex plugin add` and the hook-trust pass
 * as plain functions, never mocks.
 */
import { cpSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { cachePaths } from "../../../cacheHome.js";
import { CodexPluginSyncErrors } from "../../../codexPlugin/errors.js";
import type { SyncPaths } from "../../../codexPlugin/fleetPlan.js";
import type { CodexPluginHome } from "../../../codexPlugin/homes.js";
import { pluginCacheDir } from "../../../codexPlugin/installState.js";
import type { SyncDeps, TrustHooks } from "../../../codexPlugin/sync.js";
import type { CodexAdd, CodexAddRun } from "../../../codexPlugin/syncEffects.js";
import { err, ok } from "../../../lib/result.js";
import { gitInTemp } from "../../tempGitRepo.js";

/** One throwaway fleet. */
export interface Fleet {
  readonly root: string;
  readonly paths: SyncPaths;
  readonly head: string;
  /** A Codex home the plan register names, created empty. */
  readonly registered: string;
  /** The ambient `$CODEX_HOME`, created empty. */
  readonly ambient: string;
}

/**
 * The seeded checkout every case copies, committed ONCE per test file: its `init`, `add`, `commit` and ref
 * writes were most of the old sync test's git spawns. A copy is the same repository, so `head` is the template's.
 */
let template: { readonly checkout: string; readonly head: string } | undefined;

/** Remove the seeded checkout; each test file calls this from its `afterAll`. */
export function disposeTemplate(): void {
  if (template !== undefined) {
    rmSync(template.checkout, { force: true, recursive: true });
    template = undefined;
  }
}

/** Commit the seeded checkout on the first call, with real git: a slopweaver manifest and one tracked file. */
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

/**
 * A fresh fleet; remove its `root` in an `afterEach`.
 *
 * @returns the throwaway root, its sync paths, the seeded head and the two empty Codex homes
 */
export function makeFleet(): Fleet {
  const root = mkdtempSync(join(tmpdir(), "codex-plugin-sync-"));
  const paths: SyncPaths = {
    checkout: join(root, "checkout"),
    exportRoot: cachePaths({ root: join(root, "cache") }).codexPlugin,
    userHome: join(root, "home"),
  };
  const seeded = seededCheckout();
  cpSync(seeded.checkout, paths.checkout, { recursive: true });
  writeFileSync(join(paths.checkout, "untracked.txt"), "never exported\n");
  mkdirSync(paths.userHome, { recursive: true });
  const registered = join(root, "codex-registered");
  const ambient = join(root, "codex-ambient");
  mkdirSync(registered);
  mkdirSync(ambient);
  return { ambient, head: seeded.head, paths, registered, root };
}

/**
 * The registered home, then the ambient one — the order `codexPluginHomes` gives.
 *
 * @returns both homes, each marked registered or not
 */
export function homesOf({ fleet }: { fleet: Fleet }): readonly CodexPluginHome[] {
  return [
    { codexHome: fleet.registered, registered: true },
    { codexHome: fleet.ambient, registered: false },
  ];
}

/**
 * Where the personal marketplace file lives under a user home.
 *
 * @returns the absolute path of `.agents/plugins/marketplace.json` beneath it
 */
export function marketplacePath({ userHome }: { userHome: string }): string {
  return join(userHome, ".agents", "plugins", "marketplace.json");
}

/** A marketplace document already carrying Slopweaver's local entry, under the `personal` name. */
export const MARKETPLACE_WITH_SLOPWEAVER = {
  name: "personal",
  plugins: [{ name: "slopweaver", source: { path: "./plugins/slopweaver", source: "local" } }],
} as const;

/** Write a personal marketplace file, as raw text so a case can write an unparseable one. */
export function writeMarketplace({ userHome, raw }: { userHome: string; raw: string }): void {
  mkdirSync(join(userHome, ".agents", "plugins"), { recursive: true });
  writeFileSync(marketplacePath({ userHome }), raw);
}

/**
 * The cache directory Codex installs Slopweaver into, for the `personal` marketplace unless one is named.
 *
 * @returns that directory inside the given Codex home
 */
export function cacheOf({ codexHome, marketplace = "personal" }: { codexHome: string; marketplace?: string }): string {
  return pluginCacheDir({ codexHome, marketplace });
}

/** Give one home an install stamped with `commit`, as an earlier add would have left it. */
export function stampInstall({ codexHome, commit }: { codexHome: string; commit: string }): void {
  mkdirSync(join(cacheOf({ codexHome }), ".codex-plugin"), { recursive: true });
  writeFileSync(join(cacheOf({ codexHome }), ".codex-plugin", "source.json"), JSON.stringify({ commit }));
}

/**
 * Make one marketplace directory's Slopweaver path a symlink to itself, so looking up the stamp below it fails with
 * `ELOOP` for any user, root included — the lookup failure that is neither "not there" nor a stamp. A recursive
 * `rmSync` of the root removes the link like any other entry.
 *
 * @returns the concrete stamp path whose lookup now fails
 */
export function loopInstallPath({
  codexHome,
  marketplace = "personal",
}: {
  codexHome: string;
  marketplace?: string;
}): string {
  const marketplaceDir = join(codexHome, "plugins", "cache", marketplace);
  mkdirSync(marketplaceDir, { recursive: true });
  symlinkSync("slopweaver", join(marketplaceDir, "slopweaver"));
  return join(cacheOf({ codexHome, marketplace }), ".codex-plugin", "source.json");
}

/**
 * A `codex plugin add` fake that copies the marketplace source into the cache of the home it was handed, the way
 * the real one does under `CODEX_HOME`, and answers `--json`. A home named in `failFor` answers a failed add.
 *
 * @returns the fake, which appends each home it is handed to `adds`
 */
export function copyingAdd({
  userHome,
  failFor = [],
  adds = [],
}: {
  userHome: string;
  failFor?: readonly string[];
  adds?: string[];
}): CodexAdd {
  return ({ codexHome, pluginId }): CodexAddRun => {
    adds.push(codexHome);
    if (failFor.includes(codexHome)) {
      return { status: 1, stderr: "error: marketplace not found\n", stdout: "" };
    }
    const cache = cacheOf({ codexHome, marketplace: pluginId.split("@")[1]! });
    rmSync(cache, { force: true, recursive: true });
    cpSync(join(userHome, "plugins", "slopweaver"), cache, { dereference: true, recursive: true });
    return { status: 0, stderr: "", stdout: JSON.stringify({ installedPath: cache, version: "local" }) };
  };
}

/**
 * A hook-trust fake: trusts `trusted` hooks in every home, fails each one named in `failFor`, records each call.
 *
 * @returns the fake, answering a trusted count or a `HOOK_TRUST_FAILED` error per home
 */
export function trusting({
  trusted = 2,
  failFor = [],
  calls = [],
}: {
  trusted?: number;
  failFor?: readonly string[];
  calls?: string[];
} = {}): TrustHooks {
  return ({ codexHome }) => {
    calls.push(codexHome);
    if (failFor.includes(codexHome)) {
      return err(CodexPluginSyncErrors.hookTrustFailed({ codexHome, detail: "1 hook still skipped" }));
    }
    return ok({ trusted });
  };
}

/**
 * The sync seams with a fixed clock.
 *
 * @returns the add and trust fakes, and a clock that always reads `nowMs`
 */
export function fleetDeps({
  codexAdd,
  trustHooks = trusting(),
  nowMs = 0,
}: {
  codexAdd: CodexAdd;
  trustHooks?: TrustHooks;
  nowMs?: number;
}): SyncDeps {
  return { codexAdd, nowMs: () => nowMs, trustHooks };
}
