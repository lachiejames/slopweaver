/**
 * The pin-following intake scope when a chain line will not decode beside a valid, live Claude pin: the refused line
 * could be a newer Codex link, so the pin's Claude transcript is never read as the chair.
 */
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { writeSupervisorPin } from "../../../sessions/supervisorPinStore.js";
import { stateHomePaths } from "../../../stateHome.js";
import { SupervisorCoreErrors } from "../../../supervisor/errors.js";
import { resolveIntakeScope } from "../../../supervisor/intakeScope.js";

const CLAUDE_ID = "a0000013-0000-4000-8000-000000000014";
const PINNED_AT = "2026-11-05T01:00:00.000Z";

const scratch: string[] = [];

afterEach(() => {
  for (const dir of scratch.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

/** A throwaway directory, removed after each test. */
function scratchDir({ prefix }: { prefix: string }): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  scratch.push(dir);
  return dir;
}

/** A `~/.claude` whose registry holds {@link CLAUDE_ID} live, with a transcript for it. */
function liveClaudeHome(): string {
  const home = scratchDir({ prefix: "intake-scope-claude-" });
  mkdirSync(join(home, "projects", "-repo"), { recursive: true });
  writeFileSync(join(home, "projects", "-repo", `${CLAUDE_ID}.jsonl`), "", "utf8");
  mkdirSync(join(home, "sessions"), { recursive: true });
  writeFileSync(
    join(home, "sessions", "1.json"),
    JSON.stringify({ cwd: "/repo", pid: 1, sessionId: CLAUDE_ID, startedAt: 1 }),
    "utf8",
  );
  return home;
}

/** A state home holding a valid Claude pin for {@link CLAUDE_ID}. */
function pinnedHome(): string {
  const home = scratchDir({ prefix: "intake-scope-home-" });
  writeSupervisorPin({
    home,
    record: {
      pinnedAtIso: PINNED_AT,
      session: { host: "claude-code", id: CLAUDE_ID },
      workspaceId: "W",
      workspaceRef: "w:1",
    },
  });
  return home;
}

describe("resolveIntakeScope, following the pin", () => {
  it("refuses CHAIR_UNRESOLVED when a newer chain line carries both session shapes, never the pin's Claude session", () => {
    const home = pinnedHome();
    const mixed = {
      claudeSessionId: CLAUDE_ID,
      pinnedAtIso: "2026-11-05T04:00:00.000Z",
      session: { host: "codex", id: "019a1a98-9b15-7482-8000-000000000001" },
      source: "pin",
      workspaceId: "W",
      workspaceRef: "w:1",
    };
    const chainPath = stateHomePaths({ home }).supervisorChainJsonl;
    mkdirSync(dirname(chainPath), { recursive: true });
    appendFileSync(chainPath, `${JSON.stringify(mixed)}\n`, "utf8");

    const result = resolveIntakeScope({
      claudeHome: liveClaudeHome(),
      home,
      sessionId: undefined,
      sinceIso: undefined,
    });

    expect(result._unsafeUnwrapErr()).toStrictEqual(
      SupervisorCoreErrors.chairUnresolved({ why: "1 line(s) of the supervisor chain journal do not parse" }),
    );
    expect(result._unsafeUnwrapErr().message).toBe(
      "which session holds the chair could not be read (1 line(s) of the supervisor chain journal do not parse), so " +
        "the pin's Claude session is not read as the chair — repair the supervisor pin or chain journal, or name a " +
        "Claude session with `--session <id>`",
    );
  });

  it("follows the same live pin when every record reads", () => {
    const result = resolveIntakeScope({
      claudeHome: liveClaudeHome(),
      home: pinnedHome(),
      sessionId: undefined,
      sinceIso: undefined,
    });

    expect(result._unsafeUnwrap()).toStrictEqual({ sessionId: CLAUDE_ID, sinceIso: PINNED_AT, source: "pin" });
  });
});
