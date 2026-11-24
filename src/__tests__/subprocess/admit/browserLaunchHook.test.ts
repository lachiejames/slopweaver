/**
 * The browser-launch refusal as Claude Code actually invokes it: the SHIPPED shim, fed a real PreToolUse payload on
 * stdin, judged by its exit code and stderr. Nothing in a payload is ever run — the shim only judges it.
 *
 * MEASURED before this walk existed: each of the four shapes below exited 0 through the installed
 * shim, or (the AppleScript one) met only the raw-bash gate, which `SLOPWEAVER_ALLOW_BASH=1` opens. So every case
 * here opens that hatch and `SLOPWEAVER_ALLOW_RAW`: an exit 2 is this walk's, never another gate's.
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
const SHIM = join(repoRoot, "scripts", "pretooluse.sh");
const HOOK_TIMEOUT_MS = 60_000;
const SESSION = "browser-launch-hook-session";

// Assembled from fragments: `no-private-browser-profile` refuses either spelled whole inside a quoted literal.
const PORT_FLAG = ["--remote-debugging", "port"].join("-");
const CHROME_BIN = ["/Applications/Google Chrome.app", "Contents", "MacOS", "Google Chrome"].join("/");

/** The other gates' hatches, open, so an exit 2 can only be the browser-launch walk's. */
const OTHER_HATCHES_OPEN = { SLOPWEAVER_ALLOW_BASH: "1", SLOPWEAVER_ALLOW_RAW: "1" };

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

/** Run the shipped shim over one payload, in an isolated home. */
function runHook({ command, extraEnv = {} }: { command: string; extraEnv?: Readonly<Record<string, string>> }): {
  status: number | null;
  stderr: string;
} {
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
      ...OTHER_HATCHES_OPEN,
      ...extraEnv,
      // The sandbox spreads LAST, so a caller's `extraEnv` can never drop the account-home preload.
      ...accountSandboxChildEnv(),
    },
    input: JSON.stringify({ session_id: SESSION, tool_input: { command }, tool_name: "Bash" }),
    timeout: HOOK_TIMEOUT_MS,
  });
  return { status: run.status, stderr: run.stderr };
}

const MEASURED_SHAPES = [
  "npx @playwright/cli open --extension https://example.test",
  "open -a 'Google Chrome' https://example.test",
  `'${CHROME_BIN}' ${PORT_FLAG}=9222`,
  `osascript -e 'tell application "Google Chrome" to open location "https://example.test"'`,
] as const;

describe("the shipped PreToolUse shim — a raw browser launch", () => {
  it.each(MEASURED_SHAPES)("refuses %s with exit 2, naming the browser verbs and its own hatch", (command) => {
    const { status, stderr } = runHook({ command });
    expect(status).toBe(2);
    expect(stderr).toContain("blocked because it launches or drives a browser outside the slopweaver browser verbs");
    expect(stderr).toContain("`slopweaver browser open --url <url>`");
    expect(stderr).toContain("SLOPWEAVER_ALLOW_BROWSER_LAUNCH=1");
  });

  it("admits a launch under its own ambient hatch in the environment the shim inherits", () => {
    expect(
      runHook({
        command: "open -a 'Google Chrome' https://example.test",
        extraEnv: { SLOPWEAVER_ALLOW_BROWSER_LAUNCH: "1" },
      }),
    ).toEqual({ status: 0, stderr: "" });
  });

  it("admits the browser verbs that ARE the door", () => {
    expect(runHook({ command: "slopweaver browser open --url https://example.test" })).toEqual({
      status: 0,
      stderr: "",
    });
  });
});
