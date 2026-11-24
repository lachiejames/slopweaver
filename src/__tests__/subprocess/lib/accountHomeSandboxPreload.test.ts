/**
 * A spawned child resolves this test file's ACCOUNT-home sandbox, never the operator's real `~/.slopweaver`.
 *
 * `accountDefaultHome()` reads the password database, and `setup-ambient-home.ts` sandboxes it in a process slot that
 * cannot cross `exec`; `accountHomeSandboxPreload.ts`, carried on `NODE_OPTIONS`, is what fills the same slot in a
 * child. Each case spawns a REAL process tree — `tsx`'s wrapper and the child it starts, or the real `bin/slopweaver`
 * launcher exec'ing a built entry — and reads back what that tree answers. The control case strips the preload and
 * shows the same probe answering the real account home, so the others cannot pass for a reason unrelated to it.
 */

import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir, userInfo } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { accountDefaultHome } from "../../../homeDir.js";
import { accountHomeSandboxNodeOptions, accountSandboxChildEnv } from "../../accountHomeSandboxChild.js";
import { launcherNodeEnv, writeLauncherManifest } from "../launcherNode.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const TSX = join(repoRoot, "node_modules", ".bin", "tsx");
const PROBE = join(repoRoot, "src", "__tests__", "subprocess", "lib", "accountHomeProbe.entry.ts");
const LAUNCHER = join(repoRoot, "bin", "slopweaver");
const PRELOAD_URL = new URL("../../accountHomeSandboxPreload.ts", import.meta.url);

let scratch: string;

beforeEach(() => {
  scratch = realpathSync(mkdtempSync(join(tmpdir(), "acct-preload-")));
});
afterEach(() => {
  rmSync(scratch, { force: true, recursive: true });
});

/** What one spawned tree printed and how it ended. */
interface ChildRun {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

/**
 * Run the probe under `tsx`, so both the wrapper and the node child it starts see the environment.
 *
 * @param env the child's whole environment
 * @returns how it ended
 */
function probe({ env }: { env: NodeJS.ProcessEnv }): ChildRun {
  const run = spawnSync(TSX, [PROBE], { cwd: scratch, encoding: "utf8", env });
  return { status: run.status, stderr: run.stderr, stdout: run.stdout };
}

/**
 * A minimal environment, the shape most subprocess tests build: a PATH, a throwaway HOME and this file's temp root.
 *
 * @returns the environment, with no `NODE_OPTIONS`
 */
function minimalEnv(): NodeJS.ProcessEnv {
  return { HOME: scratch, PATH: process.env["PATH"]!, TMPDIR: process.env["TMPDIR"]! };
}

/** The account home the password database records, which the sandbox exists to keep every test away from. */
const realAccountHome = join(userInfo().homedir, ".slopweaver");

describe("a spawned child's account home", () => {
  it("is this file's sandbox when the child inherits the worker's environment", () => {
    const run = probe({ env: process.env });
    expect(run.stderr).toBe("");
    expect(run.stdout).toBe(`${accountDefaultHome()}\n`);
    expect(run.stdout === `${realAccountHome}\n`).toBe(false);
  });

  it("is this file's sandbox from a minimal environment that spreads accountSandboxChildEnv()", () => {
    const run = probe({ env: { ...minimalEnv(), ...accountSandboxChildEnv() } });
    expect(run.stderr).toBe("");
    expect(run.stdout).toBe(`${accountDefaultHome()}\n`);
  });

  it("is the REAL account home from a minimal environment that does not — the control the cases above need", () => {
    const run = probe({ env: minimalEnv() });
    expect(run.stderr).toBe("");
    expect(run.stdout).toBe(`${realAccountHome}\n`);
  });

  it("survives a path with a space, %, + and an earlier option, read back byte for byte", () => {
    const home = join(scratch, "acme dir 100% a+b");
    const NODE_OPTIONS = accountHomeSandboxNodeOptions({ home, inherited: "--enable-source-maps" });
    const run = probe({ env: { ...minimalEnv(), NODE_OPTIONS } });
    expect(run.stderr).toBe("");
    expect(run.stdout).toBe(`${home}\n`);
  });

  it("is the sandbox through the real bin/slopweaver launcher exec'ing a built entry", () => {
    const cli = join(scratch, "cli");
    mkdirSync(join(cli, "dist-cli", "cli"), { recursive: true });
    mkdirSync(join(cli, "node_modules", ".bin"), { recursive: true });
    writeLauncherManifest({ dir: cli });
    // Present so the launcher never reaches for an install; the built entry below runs instead of it.
    writeFileSync(join(cli, "node_modules", ".bin", "tsx"), "#!/bin/sh\necho 'tsx must not run' >&2\nexit 9\n");
    chmodSync(join(cli, "node_modules", ".bin", "tsx"), 0o755);
    writeFileSync(join(cli, "dist-cli", ".slopweaver-build.json"), "{}\n");
    writeFileSync(
      join(cli, "dist-cli", "cli", "index.js"),
      'process.stdout.write(`${String(process[Symbol.for("slopweaver.accountDefaultHome.sandbox")])}\\n`);\n',
    );
    const run = spawnSync("/bin/bash", [LAUNCHER, "catalog"], {
      cwd: scratch,
      encoding: "utf8",
      env: {
        ...process.env,
        ...launcherNodeEnv(),
        PLUGIN_DATA: join(scratch, "plugin-data"),
        SLOPWEAVER_CLI_DIR: cli,
        SLOPWEAVER_LAUNCHER_QUIET: "1",
        XDG_CONFIG_HOME: join(scratch, "config"),
      },
    });
    expect(run.stderr).toBe("");
    expect(run.status).toBe(0);
    expect(run.stdout).toBe(`${accountDefaultHome()}\n`);
  });
});

describe("the preload fails closed", () => {
  /**
   * Run the probe with the preload imported under one hand-built query.
   *
   * @param search the query string, `?` included, or empty for none
   * @returns how it ended
   */
  function withQuery({ search }: { search: string }): ChildRun {
    return probe({ env: { ...minimalEnv(), NODE_OPTIONS: `--import=${PRELOAD_URL.href}${search}` } });
  }

  it("refuses an import carrying no home", () => {
    const run = withQuery({ search: "" });
    expect(run.status === 0).toBe(false);
    expect(run.stdout).toBe("");
    expect(run.stderr).toContain("expected exactly one ?home=<dir> on its import URL and found 0");
  });

  it("refuses an import carrying two", () => {
    const run = withQuery({ search: "?home=%2Ftmp%2Fa&home=%2Ftmp%2Fb" });
    expect(run.status === 0).toBe(false);
    expect(run.stdout).toBe("");
    expect(run.stderr).toContain("expected exactly one ?home=<dir> on its import URL and found 2");
  });

  it("refuses a relative home", () => {
    const run = withQuery({ search: "?home=relative%2Fdir" });
    expect(run.status === 0).toBe(false);
    expect(run.stdout).toBe("");
    expect(run.stderr).toContain("is not an absolute path without a NUL");
  });

  /**
   * Run the probe with an earlier preload that put a do-nothing accessor on the slot before this one ran.
   *
   * @param configurable whether that accessor may be redefined
   * @returns how it ended
   */
  function afterAnAccessor({ configurable }: { configurable: boolean }): ChildRun {
    const earlier = join(scratch, "earlier.mjs");
    writeFileSync(
      earlier,
      `Object.defineProperty(process, Symbol.for("slopweaver.accountDefaultHome.sandbox"), { configurable: ${String(configurable)}, get: () => undefined, set: () => {} });\n`,
    );
    const ours = accountHomeSandboxNodeOptions({ home: join(scratch, "account"), inherited: undefined });
    return probe({ env: { ...minimalEnv(), NODE_OPTIONS: `--import=${pathToFileURL(earlier).href} ${ours}` } });
  }

  it("replaces a redefinable accessor an earlier preload left on the slot, so the sandbox still holds", () => {
    const run = afterAnAccessor({ configurable: true });
    expect(run.stderr).toBe("");
    expect(run.stdout).toBe(`${join(scratch, "account")}\n`);
  });

  it("refuses when an earlier preload made the slot impossible to redefine", () => {
    const run = afterAnAccessor({ configurable: false });
    expect(run.status === 0).toBe(false);
    expect(run.stdout).toBe("");
    expect(run.stderr).toContain("Cannot redefine property");
  });

  it("refuses a home carrying a NUL", () => {
    const run = withQuery({ search: "?home=%2Ftmp%2Fa%00b" });
    expect(run.status === 0).toBe(false);
    expect(run.stdout).toBe("");
    expect(run.stderr).toContain("is not an absolute path without a NUL");
  });
});
