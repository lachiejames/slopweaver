/**
 * Which tree a PreToolUse guard runs FROM, as Claude Code actually invokes it: the shipped admit shim, a
 * session booted `--plugin-dir` at this checkout, and a fake installed plugin recorded in a throwaway config
 * dir (`hooks/lib/guard-root.sh`).
 *
 * The installed guard is a stub that says where it ran, so a pass is falsifiable: this checkout's real guard
 * prints the Python refusal instead. MEASURED, the defect this holds down: 148 Python calls ran
 * after the gate landed, from sessions whose own branch predated it.
 */
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";
import { seedProfileDelivered } from "../../profileDeliveredFixture.js";
import { gitInTemp } from "../../tempGitRepo.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const SHIM = join(repoRoot, "scripts", "pretooluse.sh");
const HOOK_TIMEOUT_MS = 60_000;
const MARKETPLACE = "guard-root-test";
const INSTALLED_LINE = "guard ran from the installed plugin\n";
const SESSION_TREE_REFUSAL = "blocked because it runs a Python interpreter";
const PYTHON_CALL = JSON.stringify({
  session_id: "guard-root",
  tool_input: { command: "python3 -V" },
  tool_name: "Bash",
});
const BROWSER_CALL = JSON.stringify({
  session_id: "guard-root",
  tool_input: {},
  tool_name: "mcp__claude-in-chrome__navigate",
});
const GAVE_UP = "cannot run the browser-door guard";

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

/** A throwaway directory, removed after the test. */
function tempDir({ prefix }: { prefix: string }): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

/** A fake install: the repo's manifests, and optionally a stub admit guard that names where it ran. */
function makeInstall({ withEntry }: { withEntry: boolean }): string {
  const install = tempDir({ prefix: "sw-guard-install-" });
  copyFileSync(join(repoRoot, "package.json"), join(install, "package.json"));
  copyFileSync(join(repoRoot, "yarn.lock"), join(install, "yarn.lock"));
  mkdirSync(join(install, "hooks"));
  if (withEntry) {
    writeFileSync(
      join(install, "hooks", "pretooluse.ts"),
      `process.stderr.write(${JSON.stringify(INSTALLED_LINE)});\nprocess.exit(2);\n`,
    );
  }
  return install;
}

/** A Claude config dir whose `installed_plugins.json` records `install`, after another plugin's entry. */
function makeConfig({ install }: { install: string }): string {
  const config = tempDir({ prefix: "sw-guard-config-" });
  mkdirSync(join(config, "plugins"));
  const record = {
    plugins: {
      "other@elsewhere": [{ installPath: "/nowhere/other", scope: "user", version: "1.0.0" }],
      [`slopweaver@${MARKETPLACE}`]: [{ installPath: install, scope: "user", version: "abc123" }],
    },
    version: 2,
  };
  writeFileSync(join(config, "plugins", "installed_plugins.json"), `${JSON.stringify(record, null, 2)}\n`);
  return config;
}

/** The install's own data dir, holding manifests (the lockfile possibly stale) and this repo's deps. */
function makeDataDeps({ config, lockfile }: { config: string; lockfile: string }): string {
  const deps = join(config, "plugins", "data", `slopweaver-${MARKETPLACE}`, "cli-deps");
  mkdirSync(deps, { recursive: true });
  copyFileSync(join(repoRoot, "package.json"), join(deps, "package.json"));
  writeFileSync(join(deps, "yarn.lock"), lockfile);
  symlinkSync(join(repoRoot, "node_modules"), join(deps, "node_modules"));
  return deps;
}

/**
 * Run the shipped PreToolUse shim, as Claude Code invokes it.
 *
 * @param pluginRoot what the session froze as `CLAUDE_PLUGIN_ROOT` — its own checkout, unless a case is
 *   about a root that no longer carries the guard
 * @param shim which copy of `pretooluse.sh` to run, so a case can put it in a tree with no entry beside it
 * @param payload the hook stdin, which decides whether giving up fails open or closed
 * @param pluginData a `$PLUGIN_DATA` to pin, so a case can take away the data dir's own deps as a fallback
 */
function runAdmit({
  config,
  pluginRoot = repoRoot,
  shim = SHIM,
  payload = PYTHON_CALL,
  pluginData,
  delivered = true,
}: {
  config: string;
  pluginRoot?: string;
  shim?: string;
  payload?: string;
  pluginData?: string;
  delivered?: boolean;
}): { status: number | null; stderr: string } {
  const home = tempDir({ prefix: "sw-guard-home-" });
  // The owner's profile is delivered to this session, so `profile-held` does not refuse before the guard under test.
  if (delivered) {
    seedProfileDelivered({ home, sessionId: "guard-root" });
  } else {
    // The owner's profile was written here and never reached this session: an installed home, never a first boot — which on a
    // runner whose default homes are empty an unmarked temp home would read as.
    mkdirSync(join(home, "profile"), { recursive: true });
    writeFileSync(join(home, "profile", "owner-written"), "");
  }
  const run = spawnSync(shim, {
    encoding: "utf8",
    env: {
      CLAUDE_CONFIG_DIR: config,
      CLAUDE_PLUGIN_ROOT: pluginRoot,
      HOME: process.env["HOME"]!,
      PATH: process.env["PATH"]!,
      SLOPWEAVER_HOME: home,
      ...(pluginData === undefined ? {} : { PLUGIN_DATA: pluginData }),
    },
    input: payload,
    timeout: HOOK_TIMEOUT_MS,
  });
  return { status: run.status, stderr: run.stderr };
}

describe("a PreToolUse guard runs from the installed plugin", { timeout: HOOK_TIMEOUT_MS }, () => {
  it("runs the installed guard, not the session's own checkout, when the install carries it", () => {
    const install = makeInstall({ withEntry: true });
    symlinkSync(join(repoRoot, "node_modules"), join(install, "node_modules"));
    expect(runAdmit({ config: makeConfig({ install }) })).toEqual({ status: 2, stderr: INSTALLED_LINE });
  });

  it("links the install's data-dir deps into an install that has none, when both manifests match", () => {
    const install = makeInstall({ withEntry: true });
    const config = makeConfig({ install });
    const deps = makeDataDeps({ config, lockfile: readLockfile() });
    expect(runAdmit({ config })).toEqual({ status: 2, stderr: INSTALLED_LINE });
    expect(readlinkSync(join(install, "node_modules"))).toBe(join(deps, "node_modules"));
  });

  it("falls back to the session's checkout and links nothing when the data dir's lockfile differs", () => {
    const install = makeInstall({ withEntry: true });
    const config = makeConfig({ install });
    makeDataDeps({ config, lockfile: "# a lockfile this install was not built from\n" });
    const { status, stderr } = runAdmit({ config });
    expect(status).toBe(2);
    expect(stderr).toContain(SESSION_TREE_REFUSAL);
    expect(readdirSync(install).toSorted()).toEqual(["hooks", "package.json", "yarn.lock"]);
  });

  it("falls back rather than trust deps already in the install whose manifests do not match it", () => {
    const install = makeInstall({ withEntry: true });
    const stale = tempDir({ prefix: "sw-guard-stale-deps-" });
    copyFileSync(join(repoRoot, "package.json"), join(stale, "package.json"));
    writeFileSync(join(stale, "yarn.lock"), "# a lockfile this install was not built from\n");
    // A real tree, not a link to this repo's: the owner of the resolved path is what gets judged.
    mkdirSync(join(stale, "node_modules", ".bin"), { recursive: true });
    symlinkSync(join(repoRoot, "node_modules", ".bin", "tsx"), join(stale, "node_modules", ".bin", "tsx"));
    symlinkSync(join(stale, "node_modules"), join(install, "node_modules"));
    const { status, stderr } = runAdmit({ config: makeConfig({ install }) });
    expect(status).toBe(2);
    expect(stderr).toContain(SESSION_TREE_REFUSAL);
  });

  it("falls back to the session's checkout when the install predates the guard", () => {
    const install = makeInstall({ withEntry: false });
    symlinkSync(join(repoRoot, "node_modules"), join(install, "node_modules"));
    const { status, stderr } = runAdmit({ config: makeConfig({ install }) });
    expect(status).toBe(2);
    expect(stderr).toContain(SESSION_TREE_REFUSAL);
  });

  it("falls back to the session's checkout when no install is recorded", () => {
    const { status, stderr } = runAdmit({ config: tempDir({ prefix: "sw-guard-empty-config-" }) });
    expect(status).toBe(2);
    expect(stderr).toContain(SESSION_TREE_REFUSAL);
  });
});

/**
 * A `$PLUGIN_ROOT` that exists and does NOT carry the guard's entry — a seat booted before the ten
 * `hooks/pretooluse-*.ts` were folded into `hooks/pretooluse.ts`, whose frozen root keeps naming a
 * worktree the fold has since moved past.
 *
 * MEASURED: `resolve_guard_root` entry-checked the INSTALL and returned
 * the fallback unchecked, so `tsx` was handed a file that is not there. Nine of ten live seats printed
 * `node:internal/modules/esm/resolve:272 … ERR_MODULE_NOT_FOUND` on EVERY Bash call and exited 1 —
 * non-blocking, so every PreToolUse guard was off for the rest of those seats' lives, and the fail-CLOSED
 * browser ending was skipped entirely because node died before the shim could reach it.
 */
describe("a plugin root that does not carry the guard", { timeout: HOOK_TIMEOUT_MS }, () => {
  it("still refuses, from the tree the shim itself was copied into", () => {
    const { status, stderr } = runAdmit({
      config: tempDir({ prefix: "sw-guard-empty-config-" }),
      pluginRoot: tempDir({ prefix: "sw-guard-stale-root-" }),
    });
    expect(status).toBe(2);
    expect(stderr).toContain(SESSION_TREE_REFUSAL);
  });

  it("never hands tsx a path that is not there", () => {
    const { stderr } = runAdmit({
      config: tempDir({ prefix: "sw-guard-empty-config-" }),
      pluginRoot: tempDir({ prefix: "sw-guard-stale-root-" }),
    });
    expect(stderr).not.toContain("ERR_MODULE_NOT_FOUND");
  });

  it("gives up on its own terms when no tree at all carries the entry, failing OPEN for a Bash call", () => {
    expect(
      runAdmit({
        config: tempDir({ prefix: "sw-guard-empty-config-" }),
        pluginRoot: tempDir({ prefix: "sw-guard-stale-root-" }),
        shim: entrylessShim(),
      }),
    ).toEqual({ status: 0, stderr: "" });
  });

  // The `profile-held` check the shim never reached would have held a context lacking the owner's profile, so a persistent
  // failure refuses it too (doing nothing beats acting misaligned).
  it("gives up failing CLOSED for a Bash call from a context holding no profile delivery marker", () => {
    const { status, stderr } = runAdmit({
      config: tempDir({ prefix: "sw-guard-empty-config-" }),
      delivered: false,
      pluginRoot: tempDir({ prefix: "sw-guard-stale-root-" }),
      shim: entrylessShim(),
    });
    expect(status).toBe(2);
    expect(stderr).toContain("this context holds no current delivery of the owner's profile — holding it");
  });

  it("gives up failing CLOSED for a browser call, which dying inside tsx skipped", () => {
    const { status, stderr } = runAdmit({
      config: tempDir({ prefix: "sw-guard-empty-config-" }),
      payload: BROWSER_CALL,
      pluginRoot: tempDir({ prefix: "sw-guard-stale-root-" }),
      shim: entrylessShim(),
    });
    expect(status).toBe(2);
    expect(stderr).toContain(GAVE_UP);
  });
});

/**
 * A versioned install that carries the entry FILE but not everything it imports — the only kind of root the
 * shim bundles, so the only kind whose failed build it reads as a verdict.
 *
 * MEASURED: Claude Code's own auto-update left an install with 61 of `src/`'s 106 entries,
 * `src/lib` among those missing. `guard-root.sh` saw `hooks/pretooluse.ts` there and accepted it, esbuild
 * failed silently, and `tsx` over the same tree died on `Cannot find module '…/src/lib/errorMessage.js'`
 * with exit 1 — every seat booted afterwards ran with no PreToolUse gate at all.
 */
describe("an install that cannot build the guard", { timeout: HOOK_TIMEOUT_MS }, () => {
  it("runs the bundled install when its whole import closure is there", () => {
    const config = realConfigDir();
    const install = makeCachedInstall({ config, entry: installedEntry({ withMissingImport: false }) });
    expect(runAdmit({ config: recordInstall({ config, install }) })).toEqual({
      status: 2,
      stderr: INSTALLED_LINE,
    });
    expect(readdirSync(join(install, ".hook-build"))).toEqual(["pretooluse.mjs"]);
  });

  it("still bundles the install when the config dir is reached through a symlink", () => {
    const config = join(tempDir({ prefix: "sw-guard-config-link-" }), "config");
    symlinkSync(realConfigDir(), config);
    const install = makeCachedInstall({ config, entry: installedEntry({ withMissingImport: false }) });
    expect(runAdmit({ config: recordInstall({ config, install }) })).toEqual({
      status: 2,
      stderr: INSTALLED_LINE,
    });
    expect(readdirSync(join(install, ".hook-build"))).toEqual(["pretooluse.mjs"]);
  });

  it("builds the install's bundle from the marketplace clone on the install's own commit", () => {
    const config = realConfigDir();
    const version = makeMarketplaceClone({ config }).slice(0, 12);
    const install = makeCachedInstall({ config, entry: installedEntry({ withMissingImport: true }), version });
    expect(runAdmit({ config: recordInstall({ config, install }), pluginRoot: install })).toEqual({
      status: 2,
      stderr: INSTALLED_LINE,
    });
    expect(readdirSync(join(install, ".hook-build"))).toEqual(["pretooluse.mjs"]);
  });

  it("runs a whole install on tsx, as before, when its deps carry tsx but no esbuild", () => {
    const config = realConfigDir();
    const install = makeCachedInstall({ config, entry: installedEntry({ withMissingImport: false }) });
    const deps = tempDir({ prefix: "sw-guard-tsx-only-" });
    copyFileSync(join(repoRoot, "package.json"), join(deps, "package.json"));
    copyFileSync(join(repoRoot, "yarn.lock"), join(deps, "yarn.lock"));
    mkdirSync(join(deps, "node_modules", ".bin"), { recursive: true });
    symlinkSync(join(repoRoot, "node_modules", ".bin", "tsx"), join(deps, "node_modules", ".bin", "tsx"));
    rmSync(join(install, "node_modules"));
    symlinkSync(join(deps, "node_modules"), join(install, "node_modules"));
    expect(
      runAdmit({
        config: recordInstall({ config, install }),
        pluginData: tempDir({ prefix: "sw-guard-empty-data-" }),
      }),
    ).toEqual({ status: 2, stderr: INSTALLED_LINE });
  });

  it("runs a whole install whose directory cannot be written, rather than judging it unbuildable", () => {
    const config = realConfigDir();
    const install = makeCachedInstall({ config, entry: installedEntry({ withMissingImport: false }) });
    chmodSync(install, 0o555);
    try {
      expect(runAdmit({ config: recordInstall({ config, install }), pluginRoot: install })).toEqual({
        status: 2,
        stderr: INSTALLED_LINE,
      });
    } finally {
      chmodSync(install, 0o755);
    }
  });

  it("rebuilds over an EMPTY bundle rather than running node over it for no verdict", () => {
    const config = realConfigDir();
    const install = makeCachedInstall({ config, entry: installedEntry({ withMissingImport: true }) });
    mkdirSync(join(install, ".hook-build"));
    writeFileSync(join(install, ".hook-build", "pretooluse.mjs"), "");
    const { status, stderr } = runAdmit({ config: recordInstall({ config, install }) });
    expect(status).toBe(2);
    expect(stderr).toContain(SESSION_TREE_REFUSAL);
  });

  it("runs a whole install on tsx when a DIRECTORY sits at the bundle's path, and drops nothing into it", () => {
    const config = realConfigDir();
    const install = makeCachedInstall({ config, entry: installedEntry({ withMissingImport: false }) });
    mkdirSync(join(install, ".hook-build", "pretooluse.mjs"), { recursive: true });
    expect(runAdmit({ config: recordInstall({ config, install }) })).toEqual({
      status: 2,
      stderr: INSTALLED_LINE,
    });
    expect(readdirSync(join(install, ".hook-build", "pretooluse.mjs"))).toEqual([]);
  });

  it("refuses from the session's own checkout when the clone has moved past the install's commit", () => {
    const config = realConfigDir();
    makeMarketplaceClone({ config });
    const install = makeCachedInstall({ config, entry: installedEntry({ withMissingImport: true }) });
    const { status, stderr } = runAdmit({ config: recordInstall({ config, install }) });
    expect(status).toBe(2);
    expect(stderr).toContain(SESSION_TREE_REFUSAL);
    expect(stderr).not.toContain("ERR_MODULE_NOT_FOUND");
    expect(readdirSync(join(install, ".hook-build"))).toEqual([]);
  });

  it("refuses from the shim's own tree when the session's root IS that broken install", () => {
    const config = realConfigDir();
    const install = makeCachedInstall({ config, entry: installedEntry({ withMissingImport: true }) });
    const { status, stderr } = runAdmit({ config: recordInstall({ config, install }), pluginRoot: install });
    expect(status).toBe(2);
    expect(stderr).toContain(SESSION_TREE_REFUSAL);
    expect(stderr).not.toContain("ERR_MODULE_NOT_FOUND");
  });
});

/**
 * The topology a seat on the INSTALLED plugin really has: its plugin root is the install, and the shim it runs
 * sits in a mirror copied from that install — so the mirror is exactly as partial as the install, at a
 * different path. A pre-mortem reproduced the incident's exit 1 here against a fallback
 * that compared paths rather than proving the tree builds.
 */
describe("a mirror copied from the same partial install", { timeout: HOOK_TIMEOUT_MS }, () => {
  it("blocks through the marketplace clone on the install's commit", () => {
    const config = realConfigDir();
    const version = makeMarketplaceClone({ config }).slice(0, 12);
    const install = makeCachedInstall({ config, entry: installedEntry({ withMissingImport: true }), version });
    expect(
      runAdmit({ config: recordInstall({ config, install }), pluginRoot: install, shim: mirrorOf({ install }) }),
    ).toEqual({ status: 2, stderr: INSTALLED_LINE });
  });

  it("gives up on its own terms when no tree here builds — the persistent class, OPEN for a Bash call", () => {
    const config = realConfigDir();
    const install = makeCachedInstall({ config, entry: installedEntry({ withMissingImport: true }) });
    expect(
      runAdmit({ config: recordInstall({ config, install }), pluginRoot: install, shim: mirrorOf({ install }) }),
    ).toEqual({ status: 0, stderr: "" });
  });

  it("does not take a session tree that builds but carries no deps of its own", () => {
    const config = realConfigDir();
    const install = makeCachedInstall({ config, entry: installedEntry({ withMissingImport: true }) });
    const bare = tempDir({ prefix: "sw-guard-no-deps-" });
    mkdirSync(join(bare, "hooks"));
    mkdirSync(join(bare, "src", "lib"), { recursive: true });
    writeFileSync(
      join(bare, "hooks", "pretooluse.ts"),
      `import "neverthrow";\n${installedEntry({ withMissingImport: true })}`,
    );
    writeFileSync(join(bare, "src", "lib", "errorMessage.ts"), `export const errorMessage = "present";\n`);
    expect(
      runAdmit({ config: recordInstall({ config, install }), pluginRoot: bare, shim: mirrorOf({ install }) }),
    ).toEqual({ status: 0, stderr: "" });
  });

  it("does not take a clone whose worktree is dirty, even on the install's commit", () => {
    const config = realConfigDir();
    const version = makeMarketplaceClone({ config }).slice(0, 12);
    writeFileSync(
      join(config, "plugins", "marketplaces", MARKETPLACE, "src", "lib", "errorMessage.ts"),
      `export const errorMessage = "edited";\n`,
    );
    const install = makeCachedInstall({ config, entry: installedEntry({ withMissingImport: true }), version });
    const { status, stderr } = runAdmit({ config: recordInstall({ config, install }) });
    expect(status).toBe(2);
    expect(stderr).toContain(SESSION_TREE_REFUSAL);
  });

  it("fails CLOSED for a browser call when no tree here builds", () => {
    const config = realConfigDir();
    const install = makeCachedInstall({ config, entry: installedEntry({ withMissingImport: true }) });
    const { status, stderr } = runAdmit({
      config: recordInstall({ config, install }),
      payload: BROWSER_CALL,
      pluginRoot: install,
      shim: mirrorOf({ install }),
    });
    expect(status).toBe(2);
    expect(stderr).toContain(GAVE_UP);
  });
});

/**
 * A throwaway config dir named by its PHYSICAL path. The shim bundles only a root whose `pwd -P` sits under
 * `$CLAUDE_CONFIG_DIR/plugins/cache/`, and darwin's temp dir is `/var/…` reached through `/private/var/…`,
 * so a config dir named the short way would never bundle and these cases would test `tsx` instead.
 *
 * @returns the config dir's resolved path
 */
function realConfigDir(): string {
  return realpathSync(tempDir({ prefix: "sw-guard-config-" }));
}

/**
 * The stub guard an install carries, which names where it ran.
 *
 * @param withMissingImport import a module the install does not carry, the shape the broken install was in
 * @returns the entry's TypeScript source
 */
function installedEntry({ withMissingImport }: { withMissingImport: boolean }): string {
  const run = `process.stderr.write(${JSON.stringify(INSTALLED_LINE)});\nprocess.exit(2);\n`;
  if (withMissingImport) {
    return `import { errorMessage } from "../src/lib/errorMessage.js";\nvoid errorMessage;\n${run}`;
  }
  return run;
}

/**
 * An install where Claude Code puts one — under the config dir's plugin cache, the one place the shim bundles
 * — with this repo's manifests and deps beside it.
 *
 * @param entry the source written to `hooks/pretooluse.ts`
 * @param version the install directory's name — a commit prefix for a git marketplace; the default is no
 *   commit at all, so no clone can ever match it
 * @returns the install's path
 */
function makeCachedInstall({
  config,
  entry,
  version = "not-a-commit",
}: {
  config: string;
  entry: string;
  version?: string;
}): string {
  const install = join(config, "plugins", "cache", MARKETPLACE, "slopweaver", version);
  mkdirSync(join(install, "hooks"), { recursive: true });
  copyFileSync(join(repoRoot, "package.json"), join(install, "package.json"));
  copyFileSync(join(repoRoot, "yarn.lock"), join(install, "yarn.lock"));
  writeFileSync(join(install, "hooks", "pretooluse.ts"), entry);
  symlinkSync(join(repoRoot, "node_modules"), join(install, "node_modules"));
  return install;
}

/**
 * Record `install` in an EXISTING config dir's `installed_plugins.json`, as `makeConfig` does in a fresh one.
 *
 * @returns that config dir
 */
function recordInstall({ config, install }: { config: string; install: string }): string {
  const record = {
    plugins: { [`slopweaver@${MARKETPLACE}`]: [{ installPath: install, scope: "user", version: basename(install) }] },
    version: 2,
  };
  writeFileSync(join(config, "plugins", "installed_plugins.json"), `${JSON.stringify(record, null, 2)}\n`);
  return config;
}

/**
 * The marketplace clone Claude Code copies an install from: a git checkout carrying the WHOLE closure of the
 * entry `installedEntry({ withMissingImport: true })` writes, committed once.
 *
 * @returns the clone's HEAD commit, whose prefix names an install copied from it
 */
function makeMarketplaceClone({ config }: { config: string }): string {
  const clone = join(config, "plugins", "marketplaces", MARKETPLACE);
  mkdirSync(join(clone, "hooks"), { recursive: true });
  mkdirSync(join(clone, "src", "lib"), { recursive: true });
  writeFileSync(join(clone, "hooks", "pretooluse.ts"), installedEntry({ withMissingImport: true }));
  writeFileSync(join(clone, "src", "lib", "errorMessage.ts"), `export const errorMessage = "present";\n`);
  for (const args of [
    ["init", "-q"],
    ["add", "-A"],
    ["-c", "user.name=guard-root", "-c", "user.email=guard-root@example.com", "commit", "-q", "-m", "clone"],
  ]) {
    gitInTemp({ args, cwd: clone });
  }
  return gitInTemp({ args: ["rev-parse", "HEAD"], cwd: clone });
}

/**
 * A copy of the shipped shim in a tree mirrored from `install` — its shell libraries beside it, and the
 * install's own `hooks/pretooluse.ts`, partial exactly as the install is.
 *
 * @returns the path of that copy, to run in place of `scripts/pretooluse.sh`
 */
function mirrorOf({ install }: { install: string }): string {
  const shim = entrylessShim();
  copyFileSync(join(install, "hooks", "pretooluse.ts"), join(dirname(dirname(shim)), "hooks", "pretooluse.ts"));
  return shim;
}

/**
 * A copy of the shipped shim in a tree carrying its shell libraries and NO `hooks/pretooluse.ts`.
 *
 * This is the only shape that reaches `give_up` through the new check, because the shim's own tree is
 * otherwise the last rung that saves it. Copied rather than stubbed, so what is under test is the shipped
 * script.
 *
 * @returns the path of that copy, to run in place of `scripts/pretooluse.sh`
 */
function entrylessShim(): string {
  const root = tempDir({ prefix: "sw-guard-entryless-" });
  mkdirSync(join(root, "scripts"));
  mkdirSync(join(root, "hooks", "lib"), { recursive: true });
  copyFileSync(SHIM, join(root, "scripts", "pretooluse.sh"));
  chmodSync(join(root, "scripts", "pretooluse.sh"), 0o755);
  // EVERY lib, not the two the shim sources today: a lib added later is sourced by a shim this copies
  // verbatim, and a missing one leaves its helpers undefined rather than failing loudly, so the case would
  // start proving something else while still passing.
  for (const lib of readdirSync(join(repoRoot, "hooks", "lib"))) {
    copyFileSync(join(repoRoot, "hooks", "lib", lib), join(root, "hooks", "lib", lib));
  }
  return join(root, "scripts", "pretooluse.sh");
}

/** This repo's lockfile, which the fake install carries, so a data dir built from it matches. */
function readLockfile(): string {
  return readFileSync(join(repoRoot, "yarn.lock"), "utf8");
}
