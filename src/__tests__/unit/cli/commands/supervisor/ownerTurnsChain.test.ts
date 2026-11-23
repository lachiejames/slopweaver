/**
 * The owner-turn window reads the supervisor chain STRICTLY: a newer line that will not decode could be the link that
 * closed an older Claude tenure, so it refuses the window rather than reading that Claude transcript past its tenure
 * and calling the window clean.
 */
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { ownerSideUnreadOf } from "../../../../../cli/commands/talk/historyRun.js";
import { supervisorPinPath } from "../../../../../sessions/supervisorPinStore.js";
import { stateHomePaths } from "../../../../../stateHome.js";
import { appendSupervisorLink } from "../../../../../supervisor/chainStore.js";
import { readOwnerTurnWindow } from "../../../../../supervisor/ownerTurnWindow.js";
import { TranscriptSourceErrors } from "../../../../../transcripts/errors.js";

const homes: string[] = [];

afterEach(() => {
  for (const dir of homes.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

const NOW_ISO = "2026-11-05T12:00:00.000Z";
const CLAUDE_ID = "a0000013-0000-4000-8000-000000000014";

/** A throwaway Claude Code directory with an empty `projects`, so no chair transcript is found in it. */
function emptyClaudeHome(): string {
  const claude = mkdtempSync(join(tmpdir(), "owner-turns-claude-"));
  homes.push(claude);
  mkdirSync(join(claude, "projects"));
  return claude;
}

/** A throwaway state home holding one older Claude chain link. */
function homeWithClaudeLink(): string {
  const home = mkdtempSync(join(tmpdir(), "owner-turns-chain-"));
  homes.push(home);
  appendSupervisorLink({
    home,
    link: {
      pinnedAtIso: "2026-11-05T01:00:00.000Z",
      session: { host: "claude-code", id: CLAUDE_ID },
      source: "pin",
      workspaceId: "W",
      workspaceRef: "workspace:1",
    },
  });
  return home;
}

describe("readOwnerTurnWindow over the chain journal", () => {
  it("refuses the window when a newer chain line carries both session shapes", () => {
    const home = homeWithClaudeLink();
    const mixed = {
      claudeSessionId: CLAUDE_ID,
      pinnedAtIso: "2026-11-05T04:00:00.000Z",
      session: { host: "codex", id: "019a1a98-9b15-7482-8000-000000000001" },
      source: "pin",
      workspaceId: "W",
      workspaceRef: "workspace:1",
    };
    appendFileSync(stateHomePaths({ home }).supervisorChainJsonl, `${JSON.stringify(mixed)}\n`, "utf8");

    const window = readOwnerTurnWindow({ claudeHome: emptyClaudeHome(), days: 7, home, nowIso: NOW_ISO });

    expect(window.unreadable).toContain("the supervisor chain journal would not read cleanly: ");
  });

  it("refuses the window when the pin carries both session shapes beside an older Claude link", () => {
    const home = homeWithClaudeLink();
    const path = supervisorPinPath({ home });
    mkdirSync(dirname(path), { recursive: true });
    const mixedPin = {
      claudeSessionId: CLAUDE_ID,
      pinnedAtIso: "2026-11-05T04:00:00.000Z",
      session: { host: "codex", id: "019a1a98-9b15-7482-8000-000000000001" },
      workspaceId: "W",
      workspaceRef: "workspace:1",
    };
    writeFileSync(path, JSON.stringify(mixedPin), "utf8");

    const window = readOwnerTurnWindow({ claudeHome: emptyClaudeHome(), days: 7, home, nowIso: NOW_ISO });

    expect(window.unreadable).toContain("supervisor pin: ");
  });

  it("names no chain problem when every line decodes", () => {
    const window = readOwnerTurnWindow({
      claudeHome: emptyClaudeHome(),
      days: 7,
      home: homeWithClaudeLink(),
      nowIso: NOW_ISO,
    });

    expect(window.unreadable).toBe(undefined);
  });

  it("names a Claude chair whose transcript is gone for a reader, leaving the gate's field unset", () => {
    // A quarter-day window floors at 06:00, after the link's 01:00 pin, so the chain reaches it.
    const window = readOwnerTurnWindow({
      claudeHome: emptyClaudeHome(),
      days: 0.25,
      home: homeWithClaudeLink(),
      nowIso: NOW_ISO,
    });

    expect(window.readerGaps).toEqual([
      `chair ${CLAUDE_ID}: ${TranscriptSourceErrors.sessionNotFound({ sessionId: CLAUDE_ID }).message}`,
    ]);
    expect(window.unreadable).toBe(undefined);
  });

  it("names a chain that starts after the floor first, for a reader, leaving the gate's field unset", () => {
    const window = readOwnerTurnWindow({
      claudeHome: emptyClaudeHome(),
      days: 7,
      home: homeWithClaudeLink(),
      nowIso: NOW_ISO,
    });

    expect(window.readerGaps[0]).toBe(
      "the supervisor chain starts at 2026-11-05T01:00:00.000Z, after the floor 2026-10-29T12:00:00.000Z, so an owner turn before it was not read",
    );
    expect(window.readerGaps.length).toBe(2);
    expect(window.unreadable).toBe(undefined);
  });

  it("names an empty chain as nothing read", () => {
    const home = mkdtempSync(join(tmpdir(), "owner-turns-empty-"));
    homes.push(home);

    const window = readOwnerTurnWindow({ claudeHome: emptyClaudeHome(), days: 7, home, nowIso: NOW_ISO });

    expect(window.readerGaps).toEqual([
      "no supervisor chain is recorded, so no owner turn since 2026-10-29T12:00:00.000Z was read",
    ]);
  });
});

describe("ownerSideUnreadOf", () => {
  it("puts a chair it could not read in the answer's unread list, which makes the coverage partial", () => {
    expect(ownerSideUnreadOf({ window: { readerGaps: ["chair a: gone"], unreadable: undefined } })).toEqual([
      "the owner's turns: chair a: gone",
    ]);
  });

  it("carries the gate's gap first, then each chair", () => {
    expect(ownerSideUnreadOf({ window: { readerGaps: ["chair a: gone"], unreadable: "pin: torn" } })).toEqual([
      "the owner's turns: pin: torn",
      "the owner's turns: chair a: gone",
    ]);
  });

  it("lists three gaps, clips a long one, and counts the rest in one line, so the list stays inside the cap", () => {
    const long = `chair a: ${"x".repeat(400)}`;
    const lines = ownerSideUnreadOf({
      window: {
        readerGaps: [long, "chair b: gone", "chair c: gone", "chair d: gone", "chair e: gone"],
        unreadable: undefined,
      },
    });

    expect(lines).toEqual([
      `${Array.from(`the owner's turns: ${long}`).slice(0, 300).join("")} …`,
      "the owner's turns: chair b: gone",
      "the owner's turns: chair c: gone",
      "the owner's turns: 2 more gap(s) not listed, each one a place a turn may be missing",
    ]);
  });

  it("reports nothing when the whole window read", () => {
    expect(ownerSideUnreadOf({ window: { readerGaps: [], unreadable: undefined } })).toEqual([]);
  });
});
