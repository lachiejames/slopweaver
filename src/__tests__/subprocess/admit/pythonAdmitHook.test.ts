/**
 * The Python refusal as Claude Code actually invokes it: the SHIPPED shim, fed a real PreToolUse payload on
 * stdin, judged by its exit code and stderr.
 *
 * The unit tests cover the decision. This covers the WIRING — shim → `resolve-root.sh` → tsx → hook entry →
 * exit code — plus the one thing a pure test cannot see: that the ambient hatch is read from the PROCESS
 * environment the shim inherits.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { seedProfileDelivered } from "../../profileDeliveredFixture.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const SHIM = join(repoRoot, "scripts", "pretooluse.sh");
const HOOK_TIMEOUT_MS = 60_000;
const SESSION = "python-hook-session";

const homes: string[] = [];

afterEach(() => {
  for (const home of homes.splice(0)) {
    rmSync(home, { force: true, recursive: true });
  }
});

/** A fresh Slopweaver home, handed to the hook through `SLOPWEAVER_HOME`. */
function tempHome(): string {
  const home = mkdtempSync(join(tmpdir(), "slopweaver-python-hook-"));
  homes.push(home);
  return home;
}

/** Run the shipped shim over one payload, in an isolated home. */
function runHook({
  command,
  tool = "Bash",
  extraEnv = {},
}: {
  command: string;
  tool?: string;
  extraEnv?: Readonly<Record<string, string>>;
}): { status: number | null; stderr: string } {
  const home = tempHome();
  // The owner's profile is delivered to this session, so `profile-held` does not refuse before the guard under test.
  seedProfileDelivered({ home, sessionId: SESSION });
  const run = spawnSync(SHIM, {
    encoding: "utf8",
    env: {
      // An empty config dir, so the shim runs THIS tree's guard rather than the installed plugin's.
      CLAUDE_CONFIG_DIR: tempHome(),
      HOME: process.env["HOME"]!,
      PATH: process.env["PATH"]!,
      SLOPWEAVER_HOME: home,
      ...extraEnv,
    },
    input: JSON.stringify({ session_id: SESSION, tool_input: { command }, tool_name: tool }),
    timeout: HOOK_TIMEOUT_MS,
  });
  return { status: run.status, stderr: run.stderr };
}

describe("the shipped PreToolUse shim — Python", () => {
  it("refuses a Python invocation with exit 2 and the four-line refusal", () => {
    const { status, stderr } = runHook({ command: "python3 -c 'print(1)'" });
    expect(status).toBe(2);
    expect(stderr).toContain("blocked because it runs a Python interpreter");
    expect(stderr).toContain("SLOPWEAVER_ALLOW_PYTHON=1");
    expect(stderr).toContain("Use good judgement");
  });

  it("refuses one armed through Monitor, the other tool the matcher covers", () => {
    expect(runHook({ command: "python3 watch.py", tool: "Monitor" }).status).toBe(2);
  });

  it("admits it under the per-segment inline hatch, typed into the command itself", () => {
    expect(runHook({ command: "SLOPWEAVER_ALLOW_PYTHON=1 python3 -V" })).toEqual({ status: 0, stderr: "" });
  });

  it("admits it under the ambient hatch in the environment the shim inherits", () => {
    expect(runHook({ command: "python3 -V", extraEnv: { SLOPWEAVER_ALLOW_PYTHON: "1" } })).toEqual({
      status: 0,
      stderr: "",
    });
  });

  it("admits a heredoc that WRITES the same text as data", () => {
    // The raw-Bash gate refuses the write itself (the Write tool's job), so its hatch is open: this case is the
    // Python gate reading the body as data.
    const extraEnv = { SLOPWEAVER_ALLOW_BASH: "1" };
    expect(runHook({ command: "cat > notes.md <<'EOF'\npython3 -V\nEOF", extraEnv })).toEqual({
      status: 0,
      stderr: "",
    });
  });

  it("admits ordinary work untouched", () => {
    expect(runHook({ command: "yarn format" })).toEqual({ status: 0, stderr: "" });
  });
});
