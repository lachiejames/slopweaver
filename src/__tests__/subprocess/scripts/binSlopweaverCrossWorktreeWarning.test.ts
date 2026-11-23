/**
 * The cross-worktree warning in `bin/slopweaver`: standing in one worktree while the launcher resolves another
 * worktree of the same repo's code.
 *
 * The defect: the warning's remedy was `<this worktree>/bin/slopweaver`, which
 * is the command the caller had just run. The host exports `PLUGIN_ROOT` into every session and the launcher
 * prefers it, so re-running that path resolves the same foreign tree and prints the same warning. The remedy
 * that works is the explicit `SLOPWEAVER_CLI_DIR` override (`skills/github/reference/proof-gathering.md`).
 *
 * The fixture is a throwaway git repo with one linked worktree, and a stub `tsx` in each tree that prints which
 * tree it belongs to, so no test installs dependencies or runs the real CLI. Every run starts from an AMBIENT
 * `PLUGIN_ROOT` and no `SLOPWEAVER_CLI_DIR`, because setting the override first would bypass the very precedence
 * under test.
 */

import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { gitInTemp } from "../../tempGitRepo.js";
import { launcherNodeEnv, writeLauncherManifest } from "../launcherNode.js";

// register-class: code-under-proof-is-not-the-code-you-edited (docs/recurring-failure-register/bindings.md)

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const LAUNCHER = join(repoRoot, "bin", "slopweaver");

/** Variables that would redirect git, the launcher's tree choice or its advisory, scrubbed from every child. */
const SCRUBBED = new Set([
  "GIT_DIR",
  "GIT_WORK_TREE",
  "GIT_INDEX_FILE",
  "GIT_OBJECT_DIRECTORY",
  "GIT_COMMON_DIR",
  "PLUGIN_ROOT",
  "CLAUDE_PLUGIN_ROOT",
  "SLOPWEAVER_CLI_DIR",
  "SLOPWEAVER_LAUNCHER_QUIET",
]);

/** The scratch root holding both worktrees. */
let scratch: string;
/** The main checkout of the throwaway repo. */
let mainTree: string;
/** A linked worktree of the same throwaway repo. */
let linkedTree: string;

/**
 * Build an environment from the inherited one with the scrubbed variables removed, then the overrides added.
 *
 * @param over variables to set on top
 * @returns the child environment
 */
function childEnv({ over = {} }: { over?: Readonly<Record<string, string>> } = {}): NodeJS.ProcessEnv {
  const kept = Object.entries(process.env).filter(([key]) => !SCRUBBED.has(key));
  return { ...Object.fromEntries(kept), ...launcherNodeEnv(), ...over };
}

/**
 * Run git in a directory with a fixed identity, so the fixture needs no global config, through the one
 * sanctioned test door (it runs under a scrubbed git environment and refuses a path outside the temp dir).
 *
 * @param cwd the directory to run in
 * @param args git's arguments
 * @returns nothing; throws on a non-zero exit
 */
function git({ cwd, args }: { cwd: string; args: readonly string[] }): void {
  gitInTemp({ args: ["-c", "user.name=t", "-c", "user.email=t@example.invalid", ...args], cwd });
}

/**
 * Install a stub CLI in a tree: the launcher execs `node_modules/.bin/tsx src/cli/index.ts`.
 *
 * @param tree the tree to give a stub
 * @param marker what the stub prints, naming the tree
 * @returns nothing
 */
function installStub({ tree, marker }: { tree: string; marker: string }): void {
  const bin = join(tree, "node_modules", ".bin");
  mkdirSync(bin, { recursive: true });
  // The marker, then every argument the launcher passed, `|`-separated, so a quoting bug changes the output.
  writeFileSync(
    join(bin, "tsx"),
    `#!/bin/sh\nprintf '%s' ${marker}\nfor a in "$@"; do printf '|%s' "$a"; done\necho\n`,
  );
  chmodSync(join(bin, "tsx"), 0o755);
  writeLauncherManifest({ dir: tree });
}

beforeEach(() => {
  scratch = realpathSync(mkdtempSync(join(tmpdir(), "slop-xwt-")));
  mainTree = join(scratch, "main");
  linkedTree = join(scratch, "linked");
  mkdirSync(mainTree);
  git({ args: ["init", "-q"], cwd: mainTree });
  git({ args: ["commit", "-q", "--allow-empty", "-m", "init"], cwd: mainTree });
  git({ args: ["worktree", "add", "-q", linkedTree], cwd: mainTree });
  installStub({ marker: "stub-main", tree: mainTree });
  installStub({ marker: "stub-linked", tree: linkedTree });
  // The printed remedy names `<linked>/bin/slopweaver`; a real checkout has one, so the fixture links the real
  // launcher there (the launcher walks a symlink to its real home) and the printed line can be EXECUTED.
  symlinkSync(join(repoRoot, "bin"), join(linkedTree, "bin"));
});
afterEach(() => {
  rmSync(scratch, { force: true, recursive: true });
});

/**
 * Run the real launcher from `cwd`, with the given extra environment on top of a scrubbed one.
 *
 * @param cwd where to stand
 * @param args the launcher's arguments
 * @param env extra variables, such as the ambient `PLUGIN_ROOT` or the `SLOPWEAVER_CLI_DIR` override
 * @returns the exit status and both streams
 */
function runLauncher({
  cwd,
  args,
  env = {},
}: {
  cwd: string;
  args: readonly string[];
  env?: Readonly<Record<string, string>>;
}): { readonly status: number | null; readonly stdout: string; readonly stderr: string } {
  const result = spawnSync(LAUNCHER, [...args], {
    cwd,
    encoding: "utf8",
    env: childEnv({ over: { PLUGIN_DATA: join(scratch, "data"), ...env } }),
  });
  return { status: result.status, stderr: result.stderr, stdout: result.stdout };
}

/**
 * Paste the remedy line a warning printed into a shell, standing in the linked worktree under the SAME ambient
 * `PLUGIN_ROOT`, which is exactly what a caller copying it does.
 *
 * @param stderr the advisory text containing the remedy line
 * @returns the pasted command's exit status and both streams
 */
function pasteRemedy({ stderr }: { stderr: string }): {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
} {
  const line = /^slopweaver: {5}(SLOPWEAVER_CLI_DIR=.*)$/m.exec(stderr)![1]!;
  const result = spawnSync("bash", ["-c", line], {
    cwd: linkedTree,
    encoding: "utf8",
    env: childEnv({ over: { PLUGIN_DATA: join(scratch, "data"), PLUGIN_ROOT: mainTree } }),
  });
  return { status: result.status, stderr: result.stderr, stdout: result.stdout };
}

describe("bin/slopweaver cross-worktree warning", () => {
  it("fires under an ambient PLUGIN_ROOT naming the other tree, and the launcher runs that tree", () => {
    const result = runLauncher({ args: ["catalog"], cwd: linkedTree, env: { PLUGIN_ROOT: mainTree } });
    expect(result.status).toBe(0);
    expect(result.stdout).toBe(`stub-main|${mainTree}/src/cli/index.ts|catalog\n`);
    expect(result.stderr).toContain(`running ${mainTree}'s code, but you're standing in ${linkedTree}`);
  });

  it("prints the SLOPWEAVER_CLI_DIR form to re-run with, naming this worktree and the original arguments", () => {
    const result = runLauncher({
      args: ["catalog", "trees"],
      cwd: linkedTree,
      env: { PLUGIN_ROOT: mainTree },
    });
    expect(result.stderr).toContain(
      `slopweaver:     SLOPWEAVER_CLI_DIR=${linkedTree} ${linkedTree}/bin/slopweaver catalog trees\n`,
    );
  });

  it("keeps an argument with a space or a shell metacharacter intact in the printed command", () => {
    const result = runLauncher({
      args: ["ask", "two words", "", "a;b"],
      cwd: linkedTree,
      env: { PLUGIN_ROOT: mainTree },
    });
    expect(result.stderr).toContain(
      `slopweaver:     SLOPWEAVER_CLI_DIR=${linkedTree} ${linkedTree}/bin/slopweaver ask two\\ words '' a\\;b\n`,
    );
  });

  it("pasting the printed command runs the standing worktree with every argument intact and no warning", () => {
    const warned = runLauncher({
      args: ["ask", "two words", "", "a;b"],
      cwd: linkedTree,
      env: { PLUGIN_ROOT: mainTree },
    });
    const pasted = pasteRemedy({ stderr: warned.stderr });
    expect(pasted.status).toBe(0);
    expect(pasted.stdout).toBe(`stub-linked|${linkedTree}/src/cli/index.ts|ask|two words||a;b\n`);
    expect(pasted.stderr).not.toContain("WARNING");
  });

  it("pasting the printed command works with no arguments at all, under set -u", () => {
    const warned = runLauncher({ args: [], cwd: linkedTree, env: { PLUGIN_ROOT: mainTree } });
    expect(warned.status).toBe(0);
    expect(warned.stderr).toContain(`slopweaver:     SLOPWEAVER_CLI_DIR=${linkedTree} ${linkedTree}/bin/slopweaver\n`);
    const pasted = pasteRemedy({ stderr: warned.stderr });
    expect(pasted.stdout).toBe(`stub-linked|${linkedTree}/src/cli/index.ts\n`);
  });

  it("says why the bare launcher path is not the remedy, instead of offering it as one", () => {
    const result = runLauncher({ args: ["catalog"], cwd: linkedTree, env: { PLUGIN_ROOT: mainTree } });
    expect(result.stderr).toContain(
      "alone does not change that: the host's PLUGIN_ROOT outranks the launcher's own path.",
    );
    expect(result.stderr).not.toContain("to run THIS worktree's code instead, use");
  });

  it("stays silent when standing in the tree the launcher runs", () => {
    const result = runLauncher({ args: ["catalog"], cwd: mainTree, env: { PLUGIN_ROOT: mainTree } });
    expect(result.status).toBe(0);
    expect(result.stderr).not.toContain("WARNING");
  });

  it("stays silent under SLOPWEAVER_LAUNCHER_QUIET, which a console tile and a command probe set", () => {
    const result = runLauncher({
      args: ["catalog"],
      cwd: linkedTree,
      env: { PLUGIN_ROOT: mainTree, SLOPWEAVER_LAUNCHER_QUIET: "1" },
    });
    expect(result.status).toBe(0);
    expect(result.stderr).not.toContain("WARNING");
  });
});
