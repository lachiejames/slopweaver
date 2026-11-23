/**
 * `scripts/plugin-install-deps.sh` installs the plugin's RUNTIME tree only, and never weakens the guard that
 * keeps that tree tied to the manifests the plugin ships.
 *
 * The real script runs against a throwaway plugin root and plugin-data dir, with a fake `yarn` first on
 * `PATH` that records its arguments and working directory. So this proves the script's orchestration — which
 * command it runs, when it runs none, and what it does when an install misbehaves — and not Yarn's own
 * pruning, which was measured separately (the MEASURED block in the script carries the numbers and the repro).
 */

import { spawnSync } from "node:child_process";
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const SCRIPT = join(repoRoot, "scripts", "plugin-install-deps.sh");

/** The manifests the throwaway plugin root ships. */
const PACKAGE_JSON = '{ "name": "acme-plugin", "dependencies": { "tsx": "4.23.15" } }\n';
const YARN_LOCK = "# acme lockfile\n";

/**
 * A `yarn` that logs `<cwd>|<args>` and then behaves as `FAKE_YARN_MODE` says: `ok` installs a `tsx`,
 * `fail` exits 1, `rewrite-lock` installs and then appends to the lockfile it was handed.
 */
const FAKE_YARN = [
  "#!/bin/sh",
  'printf \'%s|%s\\n\' "$PWD" "$*" >> "$FAKE_YARN_LOG"',
  'if [ "$FAKE_YARN_MODE" = fail ]; then exit 1; fi',
  'if [ "$FAKE_YARN_MODE" = rewrite-lock ]; then printf "# rewritten\\n" >> yarn.lock; fi',
  "mkdir -p node_modules/.bin",
  "printf '#!/bin/sh\\n' > node_modules/.bin/tsx",
  "chmod +x node_modules/.bin/tsx",
  "",
].join("\n");

let scratch: string;
let root: string;
let data: string;
let bin: string;
let yarnLog: string;

beforeEach(() => {
  scratch = realpathSync(mkdtempSync(join(tmpdir(), "slop-install-deps-")));
  root = join(scratch, "root");
  data = join(scratch, "data");
  bin = join(scratch, "bin");
  yarnLog = join(scratch, "yarn.log");
  mkdirSync(join(root, "stubs", "sharp"), { recursive: true });
  writeFileSync(join(root, "package.json"), PACKAGE_JSON);
  writeFileSync(join(root, "yarn.lock"), YARN_LOCK);
  writeFileSync(join(root, ".yarnrc.yml"), "nodeLinker: node-modules\n");
  writeFileSync(join(root, "stubs", "sharp", "package.json"), '{ "name": "sharp" }\n');
  mkdirSync(bin);
  writeFileSync(join(bin, "yarn"), FAKE_YARN);
  // A no-op corepack, so `corepack enable` can never put a real shim ahead of the fake yarn.
  writeFileSync(join(bin, "corepack"), "#!/bin/sh\nexit 0\n");
  chmodSync(join(bin, "yarn"), 0o755);
  chmodSync(join(bin, "corepack"), 0o755);
});

afterEach(() => {
  rmSync(scratch, { force: true, recursive: true });
});

/**
 * Run the real install script against the throwaway root and data dir.
 *
 * @param mode how the fake yarn behaves
 * @returns the exit status and stderr
 */
function runInstall({ mode }: { mode: "ok" | "fail" | "rewrite-lock" }): { status: number | null; stderr: string } {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    FAKE_YARN_LOG: yarnLog,
    FAKE_YARN_MODE: mode,
    PATH: `${bin}:${process.env["PATH"]!}`,
    PLUGIN_DATA: data,
    PLUGIN_ROOT: root,
  };
  delete env["CLAUDE_PLUGIN_ROOT"];
  delete env["CLAUDE_PLUGIN_DATA"];
  const run = spawnSync("bash", [SCRIPT], { encoding: "utf8", env });
  return { status: run.status, stderr: run.stderr };
}

/** Lay down an already-installed mirror matching the root's manifests. */
function seedInstalledMirror(): void {
  cpSync(join(root, "package.json"), join(data, "cli-deps", "package.json"));
  mkdirSync(join(data, "cli-deps", "node_modules", ".bin"), { recursive: true });
  writeFileSync(join(data, "cli-deps", "yarn.lock"), YARN_LOCK);
  writeFileSync(join(data, "cli-deps", "node_modules", ".bin", "tsx"), "#!/bin/sh\n");
  chmodSync(join(data, "cli-deps", "node_modules", ".bin", "tsx"), 0o755);
}

describe("plugin-install-deps.sh", () => {
  it("installs a fresh mirror with a production-only focus, run inside cli-deps", () => {
    const run = runInstall({ mode: "ok" });

    expect(run.status).toBe(0);
    expect(readFileSync(yarnLog, "utf8")).toBe(`${join(data, "cli-deps")}|workspaces focus --production\n`);
    expect(readFileSync(join(data, "cli-deps", "package.json"), "utf8")).toBe(PACKAGE_JSON);
    expect(readFileSync(join(data, "cli-deps", "yarn.lock"), "utf8")).toBe(YARN_LOCK);
    expect(existsSync(join(data, "cli-deps", "stubs", "sharp", "package.json"))).toBe(true);
  });

  it("runs no install at all when tsx is installed and both manifests match", () => {
    seedInstalledMirror();

    const run = runInstall({ mode: "ok" });

    expect(run.status).toBe(0);
    expect(existsSync(yarnLog)).toBe(false);
  });

  it("reinstalls when only the lockfile moved, since a transitive bump changes yarn.lock alone", () => {
    seedInstalledMirror();
    writeFileSync(join(data, "cli-deps", "yarn.lock"), "# an older acme lockfile\n");

    const run = runInstall({ mode: "ok" });

    expect(run.status).toBe(0);
    expect(readFileSync(yarnLog, "utf8")).toBe(`${join(data, "cli-deps")}|workspaces focus --production\n`);
    expect(readFileSync(join(data, "cli-deps", "yarn.lock"), "utf8")).toBe(YARN_LOCK);
  });

  it("refuses an install that rewrote the lockfile, clearing both markers so the next session retries", () => {
    const run = runInstall({ mode: "rewrite-lock" });

    expect(run.status).toBe(1);
    expect(run.stderr).toContain("rewrote package.json or yarn.lock");
    expect(existsSync(join(data, "cli-deps", "package.json"))).toBe(false);
    expect(existsSync(join(data, "cli-deps", "yarn.lock"))).toBe(false);
  });

  it("clears both markers when the install itself fails", () => {
    const run = runInstall({ mode: "fail" });

    expect(run.status).toBe(1);
    expect(run.stderr).toContain("dependency install failed");
    expect(existsSync(join(data, "cli-deps", "package.json"))).toBe(false);
    expect(existsSync(join(data, "cli-deps", "yarn.lock"))).toBe(false);
  });
});
