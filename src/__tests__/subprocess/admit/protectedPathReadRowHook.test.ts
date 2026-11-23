/**
 * The read side of the protected-path guard as Claude Code invokes it: the SHIPPED `pretooluse-protected-paths.sh`
 * shim, and the `pretooluse.sh` dispatcher it hands a read to, fed a real `Read` payload and judged by exit code.
 *
 * The unit tests cover the decision. This covers the shell around it, where a Codex review found the read row ending
 * with 1 before any check ran: `pretooluse.sh` read a bare `$HOME` under `set -u`, so a call arriving with `HOME`
 * unset never reached the guard. Every case here runs with `HOME` unset, the registry only in a throwaway
 * `$SLOPWEAVER_HOME`.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { renderProtectedPaths } from "../../../protectedPaths/registry.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const READ_SHIM = join(repoRoot, "scripts", "pretooluse-protected-paths.sh");
const DISPATCHER = join(repoRoot, "scripts", "pretooluse.sh");
const HOOK_TIMEOUT_MS = 60_000;

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { force: true, recursive: true });
  }
});

/** A throwaway state home whose registry protects one throwaway directory `no-access`. */
function protectedWorld(): { home: string; secret: string; open: string; configDir: string } {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "sw-readrow-")));
  roots.push(root);
  const home = join(root, "state");
  const kept = join(root, "private");
  const configDir = join(root, "config");
  mkdirSync(home);
  mkdirSync(kept);
  mkdirSync(configDir);
  const registry = renderProtectedPaths({
    registry: {
      paths: [{ addedIso: "2026-01-01T00:00:00.000Z", mode: "no-access", path: kept, why: "throwaway proof" }],
      schemaVersion: 1,
    },
  });
  writeFileSync(join(home, "protected-paths.json"), registry);
  return { configDir, home, open: join(root, "open.txt"), secret: join(kept, "secret.txt") };
}

/** Run one script on a `Read` of `filePath`, with `HOME` absent from its environment. */
function readWithoutHome({
  script,
  filePath,
  world,
  extraEnv = {},
}: {
  script: string;
  filePath: string;
  world: { home: string; configDir: string };
  extraEnv?: Readonly<Record<string, string>>;
}): { status: number | null; stdout: string; stderr: string } {
  const run = spawnSync(script, ["--only", "protected-path-guard"], {
    encoding: "utf8",
    env: {
      // An empty config dir, so the script runs THIS tree's guard rather than the installed plugin's.
      CLAUDE_CONFIG_DIR: world.configDir,
      PATH: process.env["PATH"]!,
      SLOPWEAVER_HOME: world.home,
      ...extraEnv,
    },
    input: JSON.stringify({
      hook_event_name: "PreToolUse",
      session_id: "read-row-session",
      tool_input: { file_path: filePath },
      tool_name: "Read",
    }),
    timeout: HOOK_TIMEOUT_MS,
  });
  return { status: run.status, stderr: run.stderr, stdout: run.stdout };
}

describe("the read-side protected-path row, with HOME unset", { timeout: HOOK_TIMEOUT_MS }, () => {
  it("the dispatcher itself judges the read, and refuses a no-access path, instead of ending 1 on an unbound HOME", () => {
    const world = protectedWorld();
    const run = readWithoutHome({
      extraEnv: { SLOPWEAVER_PRETOOLUSE_READ_ROW: "1" },
      filePath: world.secret,
      script: DISPATCHER,
      world,
    });
    expect(run.stderr).not.toContain("unbound variable");
    expect(run.status).toBe(2);
    expect(run.stdout).toContain("refused by the slopweaver protected-path-guard check");
  });

  it("the shipped shim starts the guard from the configured home's registry, and the guard refuses", () => {
    const world = protectedWorld();
    const run = readWithoutHome({ filePath: world.secret, script: READ_SHIM, world });
    expect(run.status).toBe(2);
    expect(run.stdout).toContain("refused by the slopweaver protected-path-guard check");
  });

  it("the shipped shim lets a read outside every protected path through", () => {
    const world = protectedWorld();
    const run = readWithoutHome({ filePath: world.open, script: READ_SHIM, world });
    expect(run.status).toBe(0);
    expect(run.stdout).toBe("");
  });
});
