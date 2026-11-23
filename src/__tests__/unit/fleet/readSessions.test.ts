/**
 * `liveSessionsOf` over a home with no ledger and no board: what each live record becomes when nothing names its
 * row and no plan register could be read. Filesystem use is one empty `mkdtempSync` home, read and never written.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { liveSessionsOf } from "../../../fleet/readSessions.js";
import type { SessionRecord } from "../../../sessions/liveSessions.js";

const homes: string[] = [];

afterEach(() => {
  for (const home of homes.splice(0)) {
    rmSync(home, { force: true, recursive: true });
  }
});

/** A fresh, empty state home. */
function emptyHome(): string {
  const home = mkdtempSync(join(tmpdir(), "slopweaver-read-sessions-"));
  homes.push(home);
  return home;
}

/** One live registry record, its process start optional. */
function record({ procStart }: { procStart?: string }): SessionRecord {
  return {
    cwd: "/repo/worktree",
    entrypoint: "cli",
    kind: "interactive",
    name: "worktree",
    pid: 4242,
    sessionId: "session-1",
    startedAtMs: 1,
    status: "idle",
    ...(procStart === undefined ? {} : { procStart }),
  };
}

describe("liveSessionsOf", () => {
  it("answers nothing for no live records", () => {
    expect(liveSessionsOf({ accounts: undefined, home: emptyHome(), liveRecords: [] })).toEqual([]);
  });

  it("names an unreadable plan register as the boot, no row, and the verified process start", () => {
    const sessions = liveSessionsOf({
      accounts: undefined,
      home: emptyHome(),
      liveRecords: [record({ procStart: "Tue Nov 10 12:00:00 2026" })],
    });

    expect(sessions).toEqual([
      {
        boot: { kind: "unresolved", why: "no plan register is readable" },
        cwd: "/repo/worktree",
        row: undefined,
        sessionId: "session-1",
        startedAtMs: Date.parse("2026-11-10T12:00:00.000Z"),
        workspaceRef: undefined,
      },
    ]);
  });

  it("reads a record with no process start as an unknown start, never the registry's own startedAtMs", () => {
    const [session] = liveSessionsOf({ accounts: undefined, home: emptyHome(), liveRecords: [record({})] });

    expect(session!.startedAtMs).toBe(0);
  });
});
