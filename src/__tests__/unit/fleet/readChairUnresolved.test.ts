/**
 * `fleet health`'s chair evidence when a chain line will not decode beside a valid Claude pin: the refused line could
 * be a newer Codex link, so no Claude session is named as the chair (Codex r13-01).
 */
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { chairEvidenceOf } from "../../../fleet/readChair.js";
import type { CodexThreadObserver } from "../../../measurement/codexSessions.js";
import { supervisorPinPath } from "../../../sessions/supervisorPinStore.js";
import { stateHomePaths } from "../../../stateHome.js";

const homes: string[] = [];

afterEach(() => {
  for (const dir of homes.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

const CLAUDE_ID = "a0000013-0000-4000-8000-000000000014";

/** Every thread Codex was asked about across one test — unresolved records must ask about none. */
let asked: string[] = [];

/** An observer recording each question, so a test can say Codex was never consulted. */
const codexThread: CodexThreadObserver = ({ threadId }) => {
  asked.push(threadId);
  return { kind: "not-observed", why: "never consulted" };
};

beforeEach(() => {
  asked = [];
});

/** A throwaway home holding a valid Claude pin. */
function homeWithClaudePin(): string {
  const home = mkdtempSync(join(tmpdir(), "fleet-chair-"));
  homes.push(home);
  const path = supervisorPinPath({ home });
  mkdirSync(dirname(path), { recursive: true });
  const pin = {
    pinnedAtIso: "2026-11-05T01:00:00.000Z",
    session: { host: "claude-code", id: CLAUDE_ID },
    workspaceId: "W",
    workspaceRef: "workspace:1",
  };
  writeFileSync(path, JSON.stringify(pin), "utf8");
  return home;
}

describe("chairEvidenceOf", () => {
  it("names no Claude chair beside a valid Claude pin when a chain line carries both session shapes", () => {
    const home = homeWithClaudePin();
    const mixed = {
      claudeSessionId: CLAUDE_ID,
      pinnedAtIso: "2026-11-05T04:00:00.000Z",
      session: { host: "codex", id: "019a1a98-9b15-7482-8000-000000000001" },
      source: "pin",
      workspaceId: "W",
      workspaceRef: "workspace:1",
    };
    const chainPath = stateHomePaths({ home }).supervisorChainJsonl;
    mkdirSync(dirname(chainPath), { recursive: true });
    appendFileSync(chainPath, `${JSON.stringify(mixed)}\n`, "utf8");
    const problems: string[] = [];

    const evidence = chairEvidenceOf({ codexThread, home, problems });

    expect(evidence.chairSessionId).toBe(undefined);
    expect(evidence.chairCodex).toBe(undefined);
    expect(asked).toEqual([]);
    expect(evidence.chairUnresolved).toBe("1 line(s) of the supervisor chain journal do not parse");
    expect(problems).toStrictEqual([
      "which session holds the chair could not be read: 1 line(s) of the supervisor chain journal do not parse",
    ]);
  });

  it("names the pin's Claude session when every record reads", () => {
    const problems: string[] = [];

    const evidence = chairEvidenceOf({ codexThread, home: homeWithClaudePin(), problems });

    expect(evidence.chairSessionId).toBe(CLAUDE_ID);
    expect(evidence.chairUnresolved).toBe(undefined);
  });
});
