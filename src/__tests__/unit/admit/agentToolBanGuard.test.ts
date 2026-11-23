import { describe, expect, it } from "vitest";

import { agentToolRefusal, isSubagentTool } from "../../../admit/agentToolBanGuard.js";
import { runAgentToolBanGuard } from "../../../admit/agentToolBanGuardRunner.js";
import type { AgentToolBanFile, AgentToolBanRecord } from "../../../sessions/agentToolBan.js";

const NOW = "2026-09-18T08:00:00.000Z";

const BAN: AgentToolBanRecord = {
  claudeSessionId: "aaaa-1111",
  expiresAtIso: "2026-09-19T00:00:00.000Z",
  recordedAtIso: "2026-09-18T06:00:00.000Z",
  why: "this loop must never block on a native subagent call",
};

const FILE: AgentToolBanFile = { bans: [BAN] };

describe("isSubagentTool", () => {
  it("names both spellings of a native sub-agent dispatch, and nothing else", () => {
    expect(isSubagentTool({ toolName: "Agent" })).toBe(true);
    expect(isSubagentTool({ toolName: "Task" })).toBe(true);
    expect(isSubagentTool({ toolName: "Bash" })).toBe(false);
  });
});

describe("agentToolRefusal", () => {
  it("refuses a banned session in the four-line shape, quoting the brief clause back", () => {
    const refusal = agentToolRefusal({
      claudeSessionId: "aaaa-1111",
      file: FILE,
      hatchOpen: false,
      nowIso: NOW,
      toolName: "Agent",
    })!;
    const lines = refusal.split("\n");
    expect(lines.length).toBe(4);
    expect(lines[0]).toContain("this session's brief says: this loop must never block on a native subagent call");
    expect(lines[1]).toContain("Legitimate exceptions may include");
    expect(lines[2]).toContain("SLOPWEAVER_ALLOW_SUBAGENT=1");
    expect(lines[3]).toContain("Use good judgement");
  });

  it("allows a session that declared no ban", () => {
    expect(
      agentToolRefusal({ claudeSessionId: "zzzz-9999", file: FILE, hatchOpen: false, nowIso: NOW, toolName: "Agent" }),
    ).toBeUndefined();
  });

  it("allows every other tool in a banned session", () => {
    expect(
      agentToolRefusal({ claudeSessionId: "aaaa-1111", file: FILE, hatchOpen: false, nowIso: NOW, toolName: "Bash" }),
    ).toBeUndefined();
  });

  it("allows the call when the escape hatch is open", () => {
    expect(
      agentToolRefusal({ claudeSessionId: "aaaa-1111", file: FILE, hatchOpen: true, nowIso: NOW, toolName: "Agent" }),
    ).toBeUndefined();
  });

  it("allows a call whose ban has lapsed", () => {
    const lapsed: AgentToolBanFile = { bans: [{ ...BAN, expiresAtIso: "2026-09-17T00:00:00.000Z" }] };
    expect(
      agentToolRefusal({
        claudeSessionId: "aaaa-1111",
        file: lapsed,
        hatchOpen: false,
        nowIso: NOW,
        toolName: "Agent",
      }),
    ).toBeUndefined();
  });
});

describe("runAgentToolBanGuard", () => {
  /** Run the guard over one payload, collecting whatever it wrote to stderr. */
  const run = async ({ payload, env }: { payload: string; env: Record<string, string | undefined> }) => {
    const written: string[] = [];
    const code = await runAgentToolBanGuard({
      env,
      nowIso: NOW,
      readBans: () => FILE,
      readStdin: () => Promise.resolve(payload),
      writeError: (line) => {
        written.push(line);
      },
    });
    return { code, written };
  };

  it("blocks with exit 2 and writes the refusal", async () => {
    const { code, written } = await run({
      env: {},
      payload: JSON.stringify({ session_id: "aaaa-1111", tool_name: "Agent" }),
    });
    expect(code).toBe(2);
    expect(written[0]).toContain("SLOPWEAVER_ALLOW_SUBAGENT=1");
  });

  it("allows with exit 0 and writes nothing when the hatch is open", async () => {
    const { code, written } = await run({
      env: { SLOPWEAVER_ALLOW_SUBAGENT: "1" },
      payload: JSON.stringify({ session_id: "aaaa-1111", tool_name: "Agent" }),
    });
    expect(code).toBe(0);
    expect(written).toEqual([]);
  });

  it("FAILS OPEN on a malformed payload rather than wedging the Agent tool fleet-wide", async () => {
    expect((await run({ env: {}, payload: "{{{" })).code).toBe(0);
  });

  it("FAILS OPEN on a payload carrying no session id", async () => {
    expect((await run({ env: {}, payload: JSON.stringify({ tool_name: "Agent" }) })).code).toBe(0);
  });
});
