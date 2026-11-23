/*
 * The watch slice the tick draft reads, and the row it rebuilds: the producer's host carried through, an empty name
 * read as the absent one its naming rule falls past, and a document off the producer's contract refused.
 */
import { describe, expect, it } from "vitest";

import { sessionWatchRowOf, watchSlice } from "../../../supervisor/tickDraftWatchShape.js";

/** One row as `session watch --json-report` prints it. */
const ROW = {
  cwd: "/w",
  host: "codex",
  lastEventName: "agent.hook.Stop",
  mapped: true,
  quietMinutes: 3,
  signal: "working",
  title: "",
  toolCalls: 2,
  workspaceId: "W1",
  workspaceRef: "workspace:1",
};

/** A whole report carrying `ROW`. */
const REPORT = { diagnostics: [], observedAtIso: "2026-10-08T09:00:00.000Z", rows: [ROW], suppressed: 0 };

describe("sessionWatchRowOf", () => {
  it("carries the host the row named, and reads an empty name as absent", () => {
    const parsed = watchSlice.parse(REPORT);
    expect(sessionWatchRowOf({ row: parsed.rows[0]! })).toEqual({
      attentionKind: undefined,
      cwd: "/w",
      host: "codex",
      lastActivityAtIso: undefined,
      lastEventName: "agent.hook.Stop",
      manager: undefined,
      mapped: true,
      openedAtIso: undefined,
      quietMinutes: 3,
      sessionId: undefined,
      sessionTitle: undefined,
      signal: "working",
      title: undefined,
      toolCalls: 2,
      workspaceId: "W1",
      workspaceRef: "workspace:1",
    });
  });

  it("reads a row from before the host field as naming none, and an empty host as none", () => {
    const { host: _dropped, ...older } = ROW;
    const rows = watchSlice.parse({ ...REPORT, rows: [older, { ...ROW, host: "" }] }).rows;
    expect(rows.map((row) => sessionWatchRowOf({ row }).host)).toEqual([undefined, undefined]);
  });

  it("carries the session id, activity instants and manager flag a newer row names", () => {
    const newer = {
      ...ROW,
      lastActivityAtIso: "2026-10-08T08:57:00.000Z",
      manager: true,
      openedAtIso: "2026-10-08T07:00:00.000Z",
      sessionId: "S-1",
      sessionTitle: "Orb palettes",
    };
    const row = sessionWatchRowOf({ row: watchSlice.parse({ ...REPORT, rows: [newer] }).rows[0]! });
    expect([row.sessionId, row.sessionTitle, row.lastActivityAtIso, row.openedAtIso, row.manager]).toEqual([
      "S-1",
      "Orb palettes",
      "2026-10-08T08:57:00.000Z",
      "2026-10-08T07:00:00.000Z",
      true,
    ]);
  });
});

describe("watchSlice", () => {
  it("refuses a report whose instant, signal or count is off the producer's contract", () => {
    expect([
      watchSlice.safeParse({ ...REPORT, observedAtIso: "yesterday" }).success,
      watchSlice.safeParse({ ...REPORT, rows: [{ ...ROW, signal: "busy" }] }).success,
      watchSlice.safeParse({ ...REPORT, rows: [{ ...ROW, quietMinutes: -1 }] }).success,
      watchSlice.safeParse(REPORT).success,
    ]).toEqual([false, false, false, true]);
  });
});
