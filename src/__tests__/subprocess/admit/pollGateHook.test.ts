/**
 * The poll gate as Claude Code actually invokes it: the SHIPPED shell shim, fed a real hook payload on
 * stdin, judged by its exit code. The unit tests cover the decision; this covers the WIRING — shim →
 * `resolve-root.sh` → tsx → hook entry point → the record file → exit code — which is the half that
 * silently does nothing when a path is wrong.
 */
import { spawnSync } from "node:child_process";
import { appendFileSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { pollGatePath, readPollRecord } from "../../../admit/pollGateStore.js";
import { seedProfileDelivered } from "../../profileDeliveredFixture.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const SHIM = join(repoRoot, "scripts", "pretooluse.sh");
const HOOK_TIMEOUT_MS = 60_000;
const SESSION = "poll-hook-wiring-session";
const LOG = "/private/tmp/claude-501/proj/0000/scratchpad/validate.log";

const homes: string[] = [];

afterEach(() => {
  for (const home of homes.splice(0)) {
    rmSync(home, { force: true, recursive: true });
  }
});

/** A fresh Slopweaver home, handed to the hook through `SLOPWEAVER_HOME`. */
function tempHome(): string {
  const home = mkdtempSync(join(tmpdir(), "slopweaver-poll-hook-"));
  homes.push(home);
  return home;
}

/** Run the shim with a payload on stdin, in an isolated home. */
function runHook({ payload, home }: { payload: unknown; home: string }): {
  status: number | null;
  stderr: string;
  stdout: string;
} {
  // The owner's profile is delivered to this session, so `profile-held` does not refuse before the gate under test.
  seedProfileDelivered({ home, sessionId: SESSION });
  const run = spawnSync(SHIM, {
    encoding: "utf8",
    // An empty config dir, so the shim runs THIS tree's guard rather than the installed plugin's.
    env: {
      CLAUDE_CONFIG_DIR: tempHome(),
      HOME: process.env["HOME"]!,
      PATH: process.env["PATH"]!,
      SLOPWEAVER_HOME: home,
    },
    input: JSON.stringify(payload),
    timeout: HOOK_TIMEOUT_MS,
  });
  return { status: run.status, stderr: run.stderr, stdout: run.stdout };
}

describe("the shipped poll-gate shim", { timeout: HOOK_TIMEOUT_MS }, () => {
  it("allows the first read, records it, and refuses the second within the window", () => {
    const home = tempHome();
    const call = { session_id: SESSION, tool_input: { command: `tail -c 400 ${LOG}` }, tool_name: "Bash" };
    const first = runHook({ home, payload: call });
    expect(first.status).toBe(0);
    expect(first.stderr).toBe("");
    const record = readPollRecord({ path: pollGatePath({ home, sessionId: SESSION }) });
    expect(record.has(LOG)).toBe(true);
    const second = runHook({ home, payload: call });
    expect(second.status).toBe(2);
    expect(second.stderr.startsWith(`poll-gate: refused a log read of ${LOG}`)).toBe(true);
    expect(second.stderr).toContain("slopweaver github checks --wait");
    // What Claude Code renders: the reason first, no hook command in front of it, the check named after it.
    const reason: unknown = JSON.parse(second.stdout).hookSpecificOutput.permissionDecisionReason;
    expect(String(reason).startsWith(`poll-gate: refused a log read of ${LOG}`)).toBe(true);
    expect(String(reason).endsWith("(refused by the slopweaver poll-gate check)")).toBe(true);
  });

  it("allows a second read of a file nothing wrote in between, and refuses one after it grew", () => {
    const home = tempHome();
    // Its real path, as the harness reports one: darwin's temp root runs through the `/var` link.
    const dir = realpathSync.native(tempHome());
    const file = join(dir, "run.log");
    writeFileSync(file, "a finished build\n", "utf8");
    const call = {
      cwd: dir,
      session_id: SESSION,
      tool_input: { command: "grep -n static run.log" },
      tool_name: "Bash",
    };
    expect(runHook({ home, payload: call }).status).toBe(0);
    const again = runHook({ home, payload: call });
    expect([again.status, again.stderr]).toEqual([0, ""]);
    appendFileSync(file, "a line a build just wrote\n", "utf8");
    expect(runHook({ home, payload: call }).status).toBe(2);
  });

  it("lets real work through untouched", () => {
    const home = tempHome();
    const { status, stderr } = runHook({
      home,
      payload: { session_id: SESSION, tool_input: { command: "yarn format" }, tool_name: "Bash" },
    });
    expect(status).toBe(0);
    expect(stderr).toBe("");
    expect(readPollRecord({ path: pollGatePath({ home, sessionId: SESSION }) }).size).toBe(0);
  });

  // Fail CLOSED, and this is a deliberate CHANGE from the poll gate's own entry, which exited 0 here. One
  // process cannot hold ten policies: the admit door shared this payload and always exited 2 on it, and the
  // harness took that refusal, so the folded shim keeps the answer a caller actually used to get.
  it("exits 2 on a payload it cannot read, and says the gate did not run", () => {
    const run = spawnSync(SHIM, {
      encoding: "utf8",
      env: {
        CLAUDE_CONFIG_DIR: tempHome(),
        HOME: process.env["HOME"]!,
        PATH: process.env["PATH"]!,
        SLOPWEAVER_HOME: tempHome(),
      },
      input: "{not json",
      timeout: HOOK_TIMEOUT_MS,
    });
    expect(run.status).toBe(2);
    expect(run.stderr).toContain("malformed PreToolUse JSON payload");
  });
});
