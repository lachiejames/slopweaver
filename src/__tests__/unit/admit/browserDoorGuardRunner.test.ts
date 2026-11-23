/**
 * {@link runBrowserDoorPreToolUse} — the Claude-in-Chrome retirement as the hook runs it, exercised over a
 * real temp home.
 *
 * The whole transport is retired, so every `mcp__claude-in-chrome__*` call has
 * the same answer: refused, journalled, and waivable by nothing. The write-policy rails that once judged
 * those calls page by page are decided by `src/browser/action.ts` for the Playwright verbs that replaced the
 * extension, and proven in `src/__tests__/unit/browser/action.test.ts`.
 */
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { runBrowserDoorPreToolUse } from "../../../admit/browserDoorGuardRunner.js";
import { readBrowserVerdicts } from "../../../admit/browserVerdictJournal.js";
import { appendBrowserBreakGlassGrant, buildBrowserBreakGlassGrant } from "../../../browser/breakGlassStore.js";
import { stateHomePaths } from "../../../stateHome.js";

const SESSION = "f0bae6e5-0386-4bdc-9863-d25b38f0635e";
const INCIDENT_TAB = 2109107616;
const INCIDENT_URL = "https://app.slack.com/client/workspace/channel";

// Every temp home this file has minted, so `afterEach` can remove them.
const homes: string[] = [];

afterEach(() => {
  for (const home of homes.splice(0)) {
    rmSync(home, { force: true, recursive: true });
  }
});

/** A fresh, empty Slopweaver home for one test. */
function tempHome(): string {
  const home = mkdtempSync(join(tmpdir(), "slopweaver-browser-door-"));
  homes.push(home);
  return home;
}

/** Run the PreToolUse check over one payload, collecting whatever it wrote to stderr. */
async function pre({ payload, home }: { payload: unknown; home: string }): Promise<{ code: number; stderr: string }> {
  const lines: string[] = [];
  const code = await runBrowserDoorPreToolUse({
    home,
    readStdin: () => Promise.resolve(JSON.stringify(payload)),
    writeError: (line) => lines.push(line),
  });
  return { code, stderr: lines.join("") };
}

describe("the Claude-in-Chrome retirement", () => {
  it("refuses a computer call, says it is retired, and journals exactly one unwaived chrome-retired row", async () => {
    const home = tempHome();
    const { code, stderr } = await pre({
      home,
      payload: {
        session_id: SESSION,
        tool_input: { action: "left_click", coordinate: [10, 10], tabId: 7 },
        tool_name: "mcp__claude-in-chrome__computer",
      },
    });
    expect(code).toBe(2);
    expect(stderr).toContain("browser-door: computer is a Claude-in-Chrome call");
    expect(stderr).toContain("the Claude-in-Chrome extension is RETIRED");
    expect(
      readBrowserVerdicts({ home }).map((row) => ({
        reason: row.reason,
        sessionId: row.sessionId,
        toolName: row.toolName,
        verdict: row.verdict,
        waived: row.waived,
      })),
    ).toEqual([
      {
        reason: "chrome-retired",
        sessionId: SESSION,
        toolName: "mcp__claude-in-chrome__computer",
        verdict: "block",
        waived: undefined,
      },
    ]);
  });

  it("refuses the incident's own navigate, as it always did, but now for being the extension at all", async () => {
    const home = tempHome();
    const { code } = await pre({
      home,
      payload: {
        session_id: SESSION,
        tool_input: { tabId: INCIDENT_TAB, url: INCIDENT_URL },
        tool_name: "mcp__claude-in-chrome__navigate",
      },
    });
    expect(code).toBe(2);
  });

  it("refuses a plain READ, which the two categories always allowed under a grant", async () => {
    const home = tempHome();
    const { code } = await pre({
      home,
      payload: { session_id: SESSION, tool_input: { tabId: 7 }, tool_name: "mcp__claude-in-chrome__read_page" },
    });
    expect(code).toBe(2);
  });

  it("refuses a tool that names no page at all, which used to pass straight through", async () => {
    const home = tempHome();
    const { code } = await pre({
      home,
      payload: { session_id: SESSION, tool_input: {}, tool_name: "mcp__claude-in-chrome__tabs_context_mcp" },
    });
    expect(code).toBe(2);
  });

  it("hands the caller the verb that replaced it", async () => {
    const home = tempHome();
    const { stderr } = await pre({
      home,
      payload: { session_id: SESSION, tool_input: { tabId: 7 }, tool_name: "mcp__claude-in-chrome__computer" },
    });
    expect(stderr).toContain("slopweaver browser open --url");
  });

  it("is NOT waived by a live recorded break-glass", async () => {
    const home = tempHome();
    mkdirSync(dirname(stateHomePaths({ home }).ledgers), { recursive: true });
    appendBrowserBreakGlassGrant({
      grant: buildBrowserBreakGlassGrant({
        issuedAtIso: new Date().toISOString(),
        reason: "hand-driving the console",
        sessionId: SESSION,
      }),
      home,
    });
    const { code } = await pre({
      home,
      payload: { session_id: SESSION, tool_input: { tabId: 7 }, tool_name: "mcp__claude-in-chrome__computer" },
    });
    expect(code).toBe(2);
  });

  it("journals a payload with no session id under a fixed key rather than an empty one", async () => {
    const home = tempHome();
    await pre({ home, payload: { tool_input: {}, tool_name: "mcp__claude-in-chrome__computer" } });
    expect(readBrowserVerdicts({ home }).map((row) => row.sessionId)).toEqual(["unknown-session"]);
  });

  it("allows a tool it does not police", async () => {
    const home = tempHome();
    const { code } = await pre({ home, payload: { session_id: SESSION, tool_name: "Bash" } });
    expect(code).toBe(0);
  });

  it("journals nothing for a tool it does not police", async () => {
    const home = tempHome();
    await pre({ home, payload: { session_id: SESSION, tool_name: "Bash" } });
    expect(readBrowserVerdicts({ home }).length).toBe(0);
  });

  it("FAILS CLOSED on an unreadable payload, unlike its Bash-matched siblings", async () => {
    const home = tempHome();
    const lines: string[] = [];
    const code = await runBrowserDoorPreToolUse({
      home,
      readStdin: () => Promise.resolve("{ not json"),
      writeError: (line) => lines.push(line),
    });
    expect(code).toBe(2);
    expect(lines.join("")).toContain("browser-door: unreadable PreToolUse payload");
  });

  it("fails closed on a payload that is not an object", async () => {
    const home = tempHome();
    const { code, stderr } = await pre({ home, payload: "a string" });
    expect(code).toBe(2);
    expect(stderr).toContain("browser-door: PreToolUse payload is not an object");
  });
});
