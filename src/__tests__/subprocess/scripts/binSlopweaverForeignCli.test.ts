/**
 * The `foreign-cli` refusal in `bin/slopweaver`: a `dev` verb must not report a verdict about one
 * checkout while running a different checkout's code.
 *
 * The measured instance, standing in a worktree of this repo and invoking the `~/.local/bin`
 * symlink rather than the worktree's own launcher: the plugin mirror answered, printed
 * `hygiene: not a git checkout (git ls-files failed)`, and named a `baseline.recall.json` inside a tree
 * the caller had never edited. It did not fail. It succeeded and described nothing.
 *
 * The pre-existing worktree warning immediately above the gate cannot catch this: it compares two git
 * roots, and the mirror has no `.git` at all, so it fails open by design. That is the hole this closes.
 */

import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { launcherNodeEnv, writeLauncherManifest } from "../launcherNode.js";

// register-class: code-under-proof-is-not-the-code-you-edited (docs/recurring-failure-register/bindings.md)

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const LAUNCHER = join(repoRoot, "bin", "slopweaver");

/** What the foreign tree's stub entrypoint prints, so a test can see the foreign code really ran. */
const FOREIGN_RAN = "foreign tree ran:";

/** A stand-in for another checkout's BUILT tree, so no test ever runs the real mirror. */
let foreignDir: string;
/** A directory that is not a git checkout at all — the ordinary user standing anywhere. */
let plainDir: string;
/** An empty plugin-data dir, so no run here can read or install into the real `cli-deps` tree. */
let pluginData: string;

/**
 * Make `dir` look like another checkout that has been built: a `tsx` on its own `node_modules/.bin`, and a
 * built entrypoint with its manifest, which the launcher `exec`s.
 *
 * An EMPTY dir is not a stand-in for that, and it cost this lane a minute and a half a lap. With no `tsx` in
 * `$DIR` the launcher runs `scripts/plugin-install-deps.sh`, a real `yarn install` into
 * `$PLUGIN_DATA/cli-deps`. On a seat that tree already exists, so nobody saw it; on a fresh CI runner the
 * hatch test timed out at the lane's 60s budget and passed on its retry, every lap. MEASURED on main push
 * runs 41511378830, 41511126611 and 41504504039: that one test 94.4s, 94.6s and 95.7s, each `(retry x1)`.
 * Read it again with `slopweaver github run-log <run-id> --job subprocess --lines 400`.
 *
 * @param dir the directory to fill
 */
function makeBuiltForeignTree({ dir }: { dir: string }): void {
  const bin = join(dir, "node_modules", ".bin");
  mkdirSync(bin, { recursive: true });
  // Its presence skips the install; running it means the launcher fell back to source, which fails loudly.
  writeFileSync(join(bin, "tsx"), "#!/bin/sh\necho 'unexpected source fallback' >&2\nexit 97\n");
  chmodSync(join(bin, "tsx"), 0o755);
  writeLauncherManifest({ dir });
  const cli = join(dir, "dist-cli", "cli");
  mkdirSync(cli, { recursive: true });
  writeFileSync(join(dir, "dist-cli", ".slopweaver-build.json"), "{}\n");
  writeFileSync(
    join(cli, "index.js"),
    `process.stdout.write(${JSON.stringify(FOREIGN_RAN)} + " " + process.argv.slice(2).join(" ") + "\\n");\n`,
  );
}

beforeEach(() => {
  // realpath, not the raw mkdtemp path: on macOS `/var` is a symlink to `/private/var`, and the launcher
  // reports `pwd -P`. Without resolving here, an assertion on the raw path passes only because
  // `/private/var/…` happens to CONTAIN `/var/…` as a substring — an accident, not a check.
  foreignDir = realpathSync(mkdtempSync(join(tmpdir(), "slop-foreign-cli-dir-")));
  plainDir = realpathSync(mkdtempSync(join(tmpdir(), "slop-foreign-cli-plain-")));
  pluginData = realpathSync(mkdtempSync(join(tmpdir(), "slop-foreign-cli-data-")));
  makeBuiltForeignTree({ dir: foreignDir });
});
afterEach(() => {
  rmSync(foreignDir, { force: true, recursive: true });
  rmSync(plainDir, { force: true, recursive: true });
  rmSync(pluginData, { force: true, recursive: true });
});

/**
 * Run the launcher and capture stderr plus the exit code, never throwing on a non-zero exit.
 *
 * @param cwd where to stand
 * @param args the launcher's arguments
 * @param env extra environment on top of the inherited one
 * @returns the combined output and the exit code
 */
function runLauncher({
  cwd,
  args,
  env = {},
}: {
  cwd: string;
  args: readonly string[];
  env?: Readonly<Record<string, string>>;
}): { readonly output: string; readonly code: number } {
  // Both streams on EVERY exit: the hatch's advisory goes to stderr ahead of a run that succeeds.
  const result = spawnSync(LAUNCHER, [...args], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, ...launcherNodeEnv(), ...env, PLUGIN_DATA: pluginData },
    stdio: ["ignore", "pipe", "pipe"],
  });
  // A spawn that never ran, or one killed by a signal, is a different failure entirely (the launcher
  // missing, say) and should surface rather than read as an empty output.
  if (result.error !== undefined) {
    throw result.error;
  }
  if (result.status === null) {
    throw new Error(`launcher ended on signal ${String(result.signal)}`);
  }
  return { code: result.status, output: `${result.stdout}${result.stderr}` };
}

describe("bin/slopweaver foreign-cli refusal", () => {
  it("REFUSES a dev verb that would run another checkout's code, naming both paths", () => {
    const result = runLauncher({
      args: ["dev", "gate"],
      cwd: repoRoot,
      env: { SLOPWEAVER_CLI_DIR: foreignDir },
    });
    expect(result.code).toBe(1);
    expect(result.output).toContain("REFUSED [foreign-cli]");
    expect(result.output).toContain(repoRoot);
    expect(result.output).toContain(foreignDir);
  });

  it("names this checkout's own launcher as the real path, so the refusal is actionable", () => {
    const result = runLauncher({
      args: ["dev", "gate"],
      cwd: repoRoot,
      env: { SLOPWEAVER_CLI_DIR: foreignDir },
    });
    expect(result.output).toContain(`${repoRoot}/bin/slopweaver dev gate`);
    expect(result.output).toContain("SLOPWEAVER_ALLOW_FOREIGN_CLI=1");
  });

  it("passes through when the escape hatch is set, so a deliberate comparison stays possible", () => {
    const result = runLauncher({
      args: ["dev", "gate"],
      cwd: repoRoot,
      env: { SLOPWEAVER_ALLOW_FOREIGN_CLI: "1", SLOPWEAVER_CLI_DIR: foreignDir },
    });
    expect(result.code).toBe(0);
    expect(result.output).not.toContain("REFUSED [foreign-cli]");
    expect(result.output).toContain(`${FOREIGN_RAN} dev gate`);
  });

  it("STATES the measured tree when overridden, so the hatch does not restore the invisibility", () => {
    const result = runLauncher({
      args: ["dev", "gate"],
      cwd: repoRoot,
      env: { SLOPWEAVER_ALLOW_FOREIGN_CLI: "1", SLOPWEAVER_CLI_DIR: foreignDir },
    });
    expect(result.code).toBe(0);
    expect(result.output).toContain(`${FOREIGN_RAN} dev gate`);
    expect(result.output).toContain(`[foreign-cli] override in force — this verdict is computed over ${foreignDir}`);
    expect(result.output).toContain("which is NOT the tree being measured");
  });

  it("says nothing when standing outside any checkout, which is the ordinary install", () => {
    const result = runLauncher({
      args: ["dev", "--help"],
      cwd: plainDir,
      env: { SLOPWEAVER_CLI_DIR: foreignDir },
    });
    expect(result.output).not.toContain("REFUSED [foreign-cli]");
    expect(result.output).toContain(`${FOREIGN_RAN} dev --help`);
  });

  it("leaves every non-dev verb alone, because only dev reports a verdict about a checkout", () => {
    const result = runLauncher({
      args: ["catalog", "--help"],
      cwd: repoRoot,
      env: { SLOPWEAVER_CLI_DIR: foreignDir },
    });
    expect(result.output).not.toContain("REFUSED [foreign-cli]");
    expect(result.output).toContain(`${FOREIGN_RAN} catalog --help`);
  });

  it("allows a dev verb run through this checkout's own launcher", () => {
    const result = runLauncher({ args: ["dev", "--help"], cwd: repoRoot });
    expect(result.output).not.toContain("REFUSED [foreign-cli]");
  });

  it("prefers its own checkout over an ambient PLUGIN_ROOT, rather than refusing a path the caller typed", () => {
    // The host exports PLUGIN_ROOT into every session, and `resolve_plugin_root` prefers it — so typing this
    // checkout's own launcher ran the plugin mirror instead. Refusing that was the first shape of this gate
    // and it was the weaker one: correct, and still leaving the caller unable to do the obvious right thing.
    // An explicitly typed path outranks an inherited variable.
    const result = runLauncher({
      args: ["dev", "--help"],
      cwd: repoRoot,
      env: { PLUGIN_ROOT: foreignDir },
    });
    expect(result.output).not.toContain("REFUSED [foreign-cli]");
    expect(result.output).toContain("slopweaver dev <verb>");
  });

  it("lets an EXPLICIT SLOPWEAVER_CLI_DIR outrank that preference, keeping the refusal reachable", () => {
    // Getting this backwards made the refusal unreachable: the one deliberate way to name another tree was
    // being silently overwritten by the tree the launcher sits in.
    const result = runLauncher({
      args: ["dev", "gate"],
      cwd: repoRoot,
      env: { SLOPWEAVER_CLI_DIR: foreignDir },
    });
    expect(result.code).toBe(1);
    expect(result.output).toContain("REFUSED [foreign-cli]");
  });

  it("still allows it under an ambient GIT_DIR, which is what a git hook exports", () => {
    // The regression this pins: the gate resolved which tree is which with a plain `git rev-parse`, and
    // `GIT_DIR` overrides which repository that reads. Under `pre-push` it therefore answered about a
    // different repository and refused a correct invocation — this launcher's own refusal misfiring inside
    // its own validate, which is the very class it exists to prevent. `src/lib/gitRepo.ts`'s header records
    // the same defect making the TypeScript gates inert in the hook that runs them.
    const result = runLauncher({
      args: ["dev", "--help"],
      cwd: repoRoot,
      env: { GIT_DIR: join(repoRoot, ".git") },
    });
    expect(result.output).not.toContain("REFUSED [foreign-cli]");
  });
});
