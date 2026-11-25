/**
 * `cmux close app:<id> --harness app` for a session the app no longer hosts: the app's `SESSION_NOT_FOUND` ends the
 * ONE open app ledger row the operand names exactly, and nothing else does. Driven over the real ledger fold with
 * plain functions for the append and the clock — no mock, no file.
 */
import { describe, expect, it } from "vitest";

import {
  absentAppClose,
  absentAppCloseTarget,
  closeAbsentAppRow,
} from "../../../../../cli/commands/cmux/closeAbsentApp.js";
import { SessionHarnessErrors } from "../../../../../sessionHarness/errors.js";
import { foldSessions, type SessionEvent } from "../../../../../sessions/session.js";

const NOW = "2026-11-25T06:00:00.000Z";

/** An app row's `spawned` line, as the recording harness writes one. */
function appSpawned({ sessionId, sessionKey }: { sessionId: string; sessionKey: string }): SessionEvent {
  return {
    bootModel: { kind: "pinned", model: "sonnet" },
    branch: sessionKey,
    cwd: `/wt/${sessionKey}`,
    harness: "app",
    kind: "spawned",
    openedBy: "open",
    sessionId,
    sessionKey,
    slug: sessionKey,
    surfaceRef: `app:${sessionId}`,
    tsIso: "2026-11-25T05:00:00.000Z",
    workspaceId: sessionId,
    workspaceRef: `app:${sessionId}`,
  };
}

const CMUX_SPAWNED: SessionEvent = {
  bootModel: { kind: "inherited" },
  branch: "acme-cmux",
  cwd: "/wt/acme-cmux",
  harness: "cmux",
  kind: "spawned",
  openedBy: "open",
  sessionId: "ws-uuid-1",
  sessionKey: "acme-cmux",
  slug: "acme-cmux",
  surfaceRef: "surface:3",
  tsIso: "2026-11-25T05:00:00.000Z",
  workspaceId: "ws-uuid-1",
  workspaceRef: "workspace:3",
};

const NOT_FOUND = SessionHarnessErrors.sessionNotFound({ handle: "app:s-1", message: "no app session app:s-1" });
const UNREACHABLE = SessionHarnessErrors.unavailable({
  causeCode: "ECONNREFUSED",
  message: "the desktop app is not running",
  operation: "resolve",
});

/** A ledger held in memory: the events appended so far, folded fresh on every read, with a fixed clock. */
function ledgerOf({ events }: { events: readonly SessionEvent[] }): {
  appended: SessionEvent[];
  deps: Parameters<typeof closeAbsentAppRow>[0]["deps"];
} {
  const all = [...events];
  const appended: SessionEvent[] = [];
  return {
    appended,
    deps: {
      append: ({ event }) => {
        all.push(event);
        appended.push(event);
      },
      nowIso: () => NOW,
      rows: () => foldSessions({ events: all }),
    },
  };
}

describe("closeAbsentAppRow", () => {
  it("closes the exact open app row the app proved gone, with one closed event naming its id and handle", () => {
    const { appended, deps } = ledgerOf({ events: [appSpawned({ sessionId: "s-1", sessionKey: "acme-row" })] });
    expect(closeAbsentAppRow({ deps, error: NOT_FOUND, handle: "app:s-1", harness: "app" })).toBe(
      "cmux close: app:s-1 is already gone; closed its ledger row",
    );
    expect(appended).toEqual([
      { kind: "closed", sessionId: "s-1", sessionKey: "acme-row", tsIso: NOW, workspaceRef: "app:s-1" },
    ]);
    expect(deps.rows().map((row) => row.status)).toEqual(["closed"]);
  });

  it("accepts the bare session id the app itself accepts", () => {
    const { appended, deps } = ledgerOf({ events: [appSpawned({ sessionId: "s-1", sessionKey: "acme-row" })] });
    expect(closeAbsentAppRow({ deps, error: NOT_FOUND, handle: "s-1", harness: "app" })).toBe(
      "cmux close: app:s-1 is already gone; closed its ledger row",
    );
    expect(appended).toEqual([
      { kind: "closed", sessionId: "s-1", sessionKey: "acme-row", tsIso: NOW, workspaceRef: "app:s-1" },
    ]);
  });

  it("refuses a second close of the same session rather than appending a duplicate", () => {
    const { appended, deps } = ledgerOf({ events: [appSpawned({ sessionId: "s-1", sessionKey: "acme-row" })] });
    closeAbsentAppRow({ deps, error: NOT_FOUND, handle: "app:s-1", harness: "app" });
    expect(closeAbsentAppRow({ deps, error: NOT_FOUND, handle: "app:s-1", harness: "app" })).toBeUndefined();
    expect(appended).toEqual([
      { kind: "closed", sessionId: "s-1", sessionKey: "acme-row", tsIso: NOW, workspaceRef: "app:s-1" },
    ]);
  });

  it("writes nothing when the app could not be reached, since that proves nothing about the session", () => {
    const { appended, deps } = ledgerOf({ events: [appSpawned({ sessionId: "s-1", sessionKey: "acme-row" })] });
    expect(closeAbsentAppRow({ deps, error: UNREACHABLE, handle: "app:s-1", harness: "app" })).toBeUndefined();
    expect(appended).toEqual([]);
  });

  it("writes nothing for a typo that names no open row", () => {
    const { appended, deps } = ledgerOf({ events: [appSpawned({ sessionId: "s-1", sessionKey: "acme-row" })] });
    expect(closeAbsentAppRow({ deps, error: NOT_FOUND, handle: "app:s-2", harness: "app" })).toBeUndefined();
    expect(appended).toEqual([]);
  });

  it("writes nothing under the cmux harness, whose not-found keeps today's error", () => {
    const { appended, deps } = ledgerOf({ events: [appSpawned({ sessionId: "s-1", sessionKey: "acme-row" })] });
    expect(closeAbsentAppRow({ deps, error: NOT_FOUND, handle: "app:s-1", harness: "cmux" })).toBeUndefined();
    expect(appended).toEqual([]);
  });
});

describe("absentAppCloseTarget", () => {
  const rows = foldSessions({
    events: [appSpawned({ sessionId: "s-1", sessionKey: "acme-row" }), CMUX_SPAWNED],
  });

  it("chooses the one open app row by its handle", () => {
    expect(absentAppCloseTarget({ error: NOT_FOUND, handle: "app:s-1", harness: "app", rows })!.sessionKey).toBe(
      "acme-row",
    );
  });

  it("never selects by the row's slug", () => {
    expect(absentAppCloseTarget({ error: NOT_FOUND, handle: "acme-row", harness: "app", rows })).toBeUndefined();
  });

  it("never reaches a cmux row, even one whose handle the operand names", () => {
    expect(absentAppCloseTarget({ error: NOT_FOUND, handle: "workspace:3", harness: "app", rows })).toBeUndefined();
  });

  it("closes neither of two open app rows carrying the same session id", () => {
    const twice = foldSessions({
      events: [
        appSpawned({ sessionId: "s-1", sessionKey: "acme-row" }),
        appSpawned({ sessionId: "s-1", sessionKey: "acme-other" }),
      ],
    });
    expect(absentAppCloseTarget({ error: NOT_FOUND, handle: "app:s-1", harness: "app", rows: twice })).toBeUndefined();
  });

  it("keeps an operation failure's error, which is not proof the session is gone", () => {
    const failed = SessionHarnessErrors.operationFailed({
      causeCode: "OPERATION_FAILED",
      message: "the app refused",
      operation: "resolve",
    });
    expect(absentAppCloseTarget({ error: failed, handle: "app:s-1", harness: "app", rows })).toBeUndefined();
  });
});

describe("absentAppClose", () => {
  it("names the row's app handle in the line even when the row recorded only a handle", () => {
    const [row] = foldSessions({
      events: [
        {
          branch: "acme-legacy",
          cwd: "/wt/acme-legacy",
          harness: "app",
          kind: "spawned",
          sessionKey: "acme-legacy",
          surfaceRef: "app:legacy",
          tsIso: "2026-11-25T05:00:00.000Z",
          workspaceRef: "app:legacy",
        },
      ],
    });
    expect(absentAppClose({ row: row!, tsIso: NOW })).toEqual({
      event: { kind: "closed", sessionKey: "acme-legacy", tsIso: NOW, workspaceRef: "app:legacy" },
      line: "cmux close: app:legacy is already gone; closed its ledger row",
    });
  });
});
