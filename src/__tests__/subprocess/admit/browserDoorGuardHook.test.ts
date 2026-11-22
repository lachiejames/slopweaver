/**
 * The browser-door guard as Claude Code actually invokes it: the SHIPPED shell shim, fed a real hook
 * payload on stdin, judged by its exit code.
 *
 * The unit tests cover the refusal. This covers the WIRING — shim → `resolve-root.sh` → tsx → hook entry
 * point → exit code — which is the half a pure test cannot see and the half that silently does nothing when
 * a path is wrong. The shim is run from the repo checkout, the same way the plugin mirror runs it.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { accountSandboxChildEnv } from "../../accountHomeSandboxChild.js";
import { seedProfileDelivered } from "../../profileDeliveredFixture.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const PRE_SHIM = join(repoRoot, "scripts", "pretooluse.sh");
const HOOK_TIMEOUT_MS = 60_000;

const SESSION = "hook-wiring-session";
const INCIDENT_TAB = 2109107616;
const INCIDENT_URL = "https://app.slack.com/client/workspace/channel";

const homes: string[] = [];

afterEach(() => {
  for (const home of homes.splice(0)) {
    rmSync(home, { force: true, recursive: true });
  }
});

/** A fresh Slopweaver home, handed to the hook through `SLOPWEAVER_HOME`. */
function tempHome(): string {
  const home = mkdtempSync(join(tmpdir(), "slopweaver-browser-hook-"));
  homes.push(home);
  return home;
}

/** Run one shim with a payload on stdin, in an isolated home. */
function runHook({
  shim,
  payload,
  home,
  extraEnv = {},
}: {
  shim: string;
  payload: unknown;
  home: string;
  extraEnv?: Readonly<Record<string, string>>;
}): { status: number | null; stderr: string } {
  // The owner's profile is delivered to this session, so `profile-held` does not refuse before the guard under test.
  seedProfileDelivered({ home, sessionId: SESSION });
  const run = spawnSync(shim, {
    encoding: "utf8",
    env: {
      // An empty config dir, so the shim runs THIS tree's guard rather than the installed plugin's.
      CLAUDE_CONFIG_DIR: tempHome(),
      HOME: process.env["HOME"]!,
      PATH: process.env["PATH"]!,
      SLOPWEAVER_HOME: home,
      ...extraEnv,
      // The sandbox spreads LAST, so a caller's `extraEnv` can never drop the account-home preload.
      ...accountSandboxChildEnv(),
    },
    input: JSON.stringify(payload),
    timeout: HOOK_TIMEOUT_MS,
  });
  return { status: run.status, stderr: run.stderr };
}

describe("the shipped PreToolUse shim", { timeout: HOOK_TIMEOUT_MS }, () => {
  it("exits 2 on a Claude-in-Chrome navigate at a DOORED surface, naming the retirement and the verb that replaces it", () => {
    const { status, stderr } = runHook({
      home: tempHome(),
      payload: {
        session_id: SESSION,
        tool_input: { tabId: INCIDENT_TAB, url: INCIDENT_URL },
        tool_name: "mcp__claude-in-chrome__navigate",
      },
      shim: PRE_SHIM,
    });
    expect(status).toBe(2);
    expect(stderr).toContain("the Claude-in-Chrome extension is RETIRED");
    expect(stderr).toContain("slopweaver browser open --url <url>");
  });

  it("exits 2 navigating to a REGISTERED but DOORLESS surface too, because the retirement is categorical", () => {
    // The behaviour a read-before-write ruling changed, and the reason this case is here rather than deleted.
    // Datadog is in the register (read-before-write) and carries `door: null`, so before the
    // retirement this exact payload exited 0 and an ordinary capture went through the extension. It no
    // longer does: the refusal is decided on the TOOL being a Claude-in-Chrome call, before any surface
    // is consulted at all. `browser shot` is what photographs a page now.
    const { status, stderr } = runHook({
      home: tempHome(),
      payload: {
        session_id: SESSION,
        tool_input: { tabId: 7, url: "https://app.datadoghq.com/monitors/12345" },
        tool_name: "mcp__claude-in-chrome__navigate",
      },
      shim: PRE_SHIM,
    });
    expect(status).toBe(2);
    expect(stderr).toContain("the Claude-in-Chrome extension is RETIRED");
  });

  it("exits 2 with the retired door override still EXPORTED, so the one refusal with no hatch has none through the shipped wiring either", () => {
    const { status, stderr } = runHook({
      extraEnv: { SLOPWEAVER_ALLOW_BROWSER_DOORED: "1" },
      home: tempHome(),
      payload: {
        session_id: SESSION,
        tool_input: { action: "left_click", coordinate: [10, 10], tabId: 8 },
        tool_name: "mcp__claude-in-chrome__computer",
      },
      shim: PRE_SHIM,
    });
    expect(status).toBe(2);
    expect(stderr).toContain("There is no override");
  });
});
