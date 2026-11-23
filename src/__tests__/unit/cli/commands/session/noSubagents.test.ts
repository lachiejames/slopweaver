import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { runSessionNoSubagentsWithDeps } from "../../../../../cli/commands/session/noSubagents.js";
import { liveAgentToolBan } from "../../../../../sessions/agentToolBan.js";
import { readAgentToolBans } from "../../../../../sessions/agentToolBanStore.js";

/** Every home this file mints, removed in `afterEach` — the file's own fixtures, never the ambient home. */
const homes: string[] = [];

/** A throwaway state home inside this test FILE's sandboxed `TMPDIR`. */
function newHome(): string {
  const home = mkdtempSync(join(tmpdir(), "no-subagents-"));
  homes.push(home);
  return home;
}

const SESSION_ID = "aaaa-1111-2222-3333";
const ENV = { CLAUDE_CODE_SESSION_ID: SESSION_ID } as const;
const NOW_MS = Date.parse("2026-09-18T08:00:00.000Z");

afterEach(() => {
  for (const home of homes.splice(0)) {
    rmSync(home, { force: true, recursive: true });
  }
});

describe("runSessionNoSubagentsWithDeps", () => {
  it("records a ban for THIS session, carrying the brief clause and an expiry", () => {
    const home = newHome();
    const code = runSessionNoSubagentsWithDeps({
      argv: ["node", "bin", "session", "no-subagents", "--why", "the fan-out is FLAT", "--home", home],
      env: ENV,
      nowMs: NOW_MS,
    });
    expect(code).toBe(0);
    const ban = liveAgentToolBan({
      claudeSessionId: SESSION_ID,
      file: readAgentToolBans({ home }),
      nowIso: "2026-09-18T09:00:00.000Z",
    })!;
    expect(ban.why).toBe("the fan-out is FLAT");
    expect(ban.recordedAtIso).toBe("2026-09-18T08:00:00.000Z");
    expect(ban.expiresAtIso).toBe("2026-09-18T20:00:00.000Z");
  });

  it("honours --hours for the window", () => {
    const home = newHome();
    runSessionNoSubagentsWithDeps({
      argv: ["node", "bin", "session", "no-subagents", "--why", "w", "--hours", "2", "--home", home],
      env: ENV,
      nowMs: NOW_MS,
    });
    expect(readAgentToolBans({ home }).bans[0]!.expiresAtIso).toBe("2026-09-18T10:00:00.000Z");
  });

  it("clears the ban again", () => {
    const home = newHome();
    const argv = ["node", "bin", "session", "no-subagents", "--why", "w", "--home", home];
    runSessionNoSubagentsWithDeps({ argv, env: ENV, nowMs: NOW_MS });
    const code = runSessionNoSubagentsWithDeps({
      argv: ["node", "bin", "session", "no-subagents", "--clear", "--home", home],
      env: ENV,
      nowMs: NOW_MS,
    });
    expect(code).toBe(0);
    expect(readAgentToolBans({ home }).bans).toEqual([]);
  });

  it("refuses with EXIT_USAGE when no --why names the clause that forbids it", () => {
    const home = newHome();
    const code = runSessionNoSubagentsWithDeps({
      argv: ["node", "bin", "session", "no-subagents", "--home", home],
      env: ENV,
      nowMs: NOW_MS,
    });
    expect(code).toBe(2);
    expect(readAgentToolBans({ home }).bans).toEqual([]);
  });

  it("refuses with EXIT_ERROR outside a visible Claude Code session, where there is no id to scope to", () => {
    const home = newHome();
    const code = runSessionNoSubagentsWithDeps({
      argv: ["node", "bin", "session", "no-subagents", "--why", "w", "--home", home],
      env: {},
      nowMs: NOW_MS,
    });
    expect(code).toBe(1);
    expect(readAgentToolBans({ home }).bans).toEqual([]);
  });
});
