/**
 * Closing a DISPATCHED session's ledger entry — the one workspace the caller tore down, never every round of
 * the same review that happens to share its key.
 *
 * A filesystem round-trip through a temp home rather than a mock: the whole point is what `foldSessions`
 * reads back out of the real JSONL the real appender wrote.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { planDrawdownInvestigation } from "../../../../cmux/plan.js";
import { closeDispatchedSession, registerDispatchedSession } from "../../../../live/turn/sessionLedger.js";
import { foldSessions, parseSessionLog, type SessionItem } from "../../../../sessions/session.js";
import { appendSessionEvent, readSessionLogText } from "../../../../sessions/sessionStore.js";

const KEY = "review-C0AAA-1789046247.801199";

const homes: string[] = [];

afterEach(() => {
  homes.splice(0).forEach((home) => {
    rmSync(home, { force: true, recursive: true });
  });
});

/** A temp home carrying one `spawned` row per given workspace ref, all under one dispatch key. */
function homeWithRounds({ refs }: { refs: readonly string[] }): string {
  const home = mkdtempSync(join(tmpdir(), "slopweaver-ledger-"));
  homes.push(home);
  refs.forEach((workspaceRef, index) => {
    appendSessionEvent({
      event: {
        branch: "live-loop",
        cwd: "/w/.claude/worktrees/live-loop",
        kind: "spawned",
        sessionKey: KEY,
        surfaceRef: `surface:${String(index)}`,
        tsIso: `2026-09-10T13:${String(index).padStart(2, "0")}:00.000Z`,
        workspaceRef,
      },
      home,
    });
  });
  return home;
}

/** Every folded row for the dispatch key. `foldSessions` returns them most-recent-first. */
function rowsOf({ home }: { home: string }): readonly SessionItem[] {
  const { events } = parseSessionLog({ text: readSessionLogText({ home }) });
  return foldSessions({ events }).filter((row) => row.sessionKey === KEY);
}

describe("closeDispatchedSession", () => {
  it("closes only the round whose workspace it tore down", () => {
    const home = homeWithRounds({ refs: ["workspace:71", "workspace:72", "workspace:76", "workspace:77"] });
    closeDispatchedSession({ home, sessionKey: KEY, tsIso: "2026-09-10T15:32:15.376Z", workspaceRef: "workspace:77" });
    const rows = rowsOf({ home });
    expect(rows.map((row) => [row.workspaceRef, row.status])).toEqual([
      ["workspace:77", "closed"],
      ["workspace:76", "open"],
      ["workspace:72", "open"],
      ["workspace:71", "open"],
    ]);
  });

  it("writes a ref onto the event, which is what stops the fold retiring every sibling", () => {
    const home = homeWithRounds({ refs: ["workspace:71", "workspace:72"] });
    closeDispatchedSession({ home, sessionKey: KEY, tsIso: "2026-09-10T15:32:15.376Z", workspaceRef: "workspace:72" });
    const { events } = parseSessionLog({ text: readSessionLogText({ home }) });
    const closed = events.filter((event) => event.kind === "closed");
    expect(closed).toEqual([
      { kind: "closed", sessionKey: KEY, tsIso: "2026-09-10T15:32:15.376Z", workspaceRef: "workspace:72" },
    ]);
  });
});

describe("registerDispatchedSession", () => {
  const plan = planDrawdownInvestigation({
    branch: "main",
    incidentId: "ep-1",
    model: "opus",
    pickupCommand: "look into it",
    repoRoot: "/w/main",
    spawnedAt: "2026-11-09T01:00:00.000Z",
  });
  const booted = { surfaceRef: "surface:9", workspaceId: "ws-id-9", workspaceRef: "workspace:9" };

  /** A fresh, empty temp home. */
  function emptyHome(): string {
    const home = mkdtempSync(join(tmpdir(), "slopweaver-ledger-"));
    homes.push(home);
    return home;
  }

  it("writes the row through the seam's recorder, carrying the harness, the act and the workspace id", () => {
    const home = emptyHome();
    registerDispatchedSession({ home, plan, ...booted });
    const { events } = parseSessionLog({ text: readSessionLogText({ home }) });
    expect(events.map((event) => ({ ...event, tsIso: "<now>" }))).toEqual([
      {
        bootModel: { kind: "pinned", model: "opus" },
        branch: "main",
        cwd: "/w/main",
        harness: "cmux",
        kind: "spawned",
        openedBy: "open",
        sessionId: "ws-id-9",
        sessionKey: "drawdown-ep-1",
        surfaceRef: "surface:9",
        tsIso: "<now>",
        workspaceId: "ws-id-9",
        workspaceRef: "workspace:9",
      },
    ]);
  });

  it("is closed by the dispatched close's ref, though the row now carries an id the close does not", () => {
    const home = emptyHome();
    registerDispatchedSession({ home, plan, ...booted });
    closeDispatchedSession({
      home,
      sessionKey: "drawdown-ep-1",
      tsIso: "2026-11-09T02:00:00.000Z",
      workspaceRef: "workspace:9",
    });
    const { events } = parseSessionLog({ text: readSessionLogText({ home }) });
    expect(foldSessions({ events }).map((row) => [row.sessionKey, row.workspaceRef, row.status])).toEqual([
      ["drawdown-ep-1", "workspace:9", "closed"],
    ]);
  });

  it("writes nothing for a plan that names no session", () => {
    const home = emptyHome();
    registerDispatchedSession({ home, plan: { ...plan, sessionName: undefined }, ...booted });
    expect(readSessionLogText({ home })).toBe("");
  });
});
