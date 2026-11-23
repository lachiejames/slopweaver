/**
 * `session standing`'s chair read: the pinned chat's pids reach the reader exactly as the one listing reported them,
 * an absent chat never reaches it at all, and a reader that could not bind the sessions is reported as-is.
 */
import { describe, expect, it } from "vitest";

import { type StandingChairReader, standingChairRead } from "../../../../../cli/commands/session/standingChair.js";
import type { ChairSessionReading } from "../../../../../supervisor/chairGate.js";
import { CODEX_PIN_HAS_NO_CLAUDE_CHAIR } from "../../../../../supervisor/chairRead.js";
import { UNMEASURED_CHAIR_HOST, UNRESOLVED_CHAIR_RECORD } from "../../../../../supervisor/recordedChairHost.js";

const CHAIR_SESSION: ChairSessionReading = {
  pid: 19_207,
  sessionId: "a0000075-0000-4000-8000-000000000081",
  verdict: { atIso: "2026-11-04T10:10:00.000Z", kind: "on-fable", model: "claude-fable-5-1" },
};

describe("standingChairRead", () => {
  it("hands the reader every pid the listing reported and resolves the pinned chat's sessions", () => {
    const seen: (readonly number[])[] = [];
    const readChair: StandingChairReader = ({ pids }) => {
      seen.push(pids);
      return { kind: "resolved", sessions: [CHAIR_SESSION] };
    };
    const read = standingChairRead({
      pinHost: "claude-code",
      readChair,
      workspaces: {
        supervisorCwd: "/work/chair",
        supervisorPids: [19_207, 19_300],
        supervisorWorkspaceId: "workspace:1",
      },
    });
    expect(seen).toEqual([[19_207, 19_300]]);
    expect(read).toEqual({
      kind: "resolved",
      sessions: [CHAIR_SESSION],
      workspaceCwd: "/work/chair",
      workspaceId: "workspace:1",
    });
  });

  it("reports no chair, without reading, when no pinned chat is open", () => {
    const seen: (readonly number[])[] = [];
    const readChair: StandingChairReader = ({ pids }) => {
      seen.push(pids);
      return { kind: "resolved", sessions: [] };
    };
    const read = standingChairRead({
      pinHost: "claude-code",
      readChair,
      workspaces: { supervisorCwd: undefined, supervisorPids: [], supervisorWorkspaceId: undefined },
    });
    expect(seen).toEqual([]);
    expect(read).toEqual({ cause: "no-chair", kind: "unresolved", why: "no pinned supervisor chat is open" });
  });

  it("passes an unread process table through as the chair read's cause", () => {
    const readChair: StandingChairReader = () => ({
      cause: "process-table-unread",
      kind: "unresolved",
      why: "ps exited 1",
    });
    const read = standingChairRead({
      pinHost: "claude-code",
      readChair,
      workspaces: { supervisorCwd: "/work/chair", supervisorPids: [19_207], supervisorWorkspaceId: "workspace:1" },
    });
    expect(read).toEqual({ cause: "process-table-unread", kind: "unresolved", why: "ps exited 1" });
  });

  it("reports an empty workspace id rather than guessing one the listing did not carry", () => {
    const readChair: StandingChairReader = () => ({ kind: "resolved", sessions: [CHAIR_SESSION] });
    const read = standingChairRead({
      pinHost: "claude-code",
      readChair,
      workspaces: { supervisorCwd: "/work/chair", supervisorPids: [19_207], supervisorWorkspaceId: undefined },
    });
    expect(read).toEqual({
      kind: "resolved",
      sessions: [CHAIR_SESSION],
      workspaceCwd: "/work/chair",
      workspaceId: "",
    });
  });

  it("reads a Codex-held pin as unresolved, never judging a Claude tab beside it", () => {
    const seen: (readonly number[])[] = [];
    const readChair: StandingChairReader = ({ pids }) => {
      seen.push(pids);
      return { kind: "resolved", sessions: [CHAIR_SESSION] };
    };
    const read = standingChairRead({
      pinHost: "codex",
      readChair,
      workspaces: { supervisorCwd: "/work/chair", supervisorPids: [19_207], supervisorWorkspaceId: "workspace:1" },
    });
    expect(seen).toEqual([]);
    expect(read).toEqual({ cause: "codex-chair", kind: "unresolved", why: CODEX_PIN_HAS_NO_CLAUDE_CHAIR });
  });

  it("reads damaged chair records as unresolved, never judging a Claude tab as the chair", () => {
    const seen: (readonly number[])[] = [];
    const readChair: StandingChairReader = ({ pids }) => {
      seen.push(pids);
      return { kind: "resolved", sessions: [CHAIR_SESSION] };
    };
    const read = standingChairRead({
      pinHost: "unresolved",
      readChair,
      workspaces: { supervisorCwd: "/work/chair", supervisorPids: [19_207], supervisorWorkspaceId: "workspace:1" },
    });
    expect(seen).toEqual([]);
    expect(read).toEqual({ cause: "chair-record-unread", kind: "unresolved", why: UNRESOLVED_CHAIR_RECORD });
  });

  it("reads no recorded chair as UNMEASURED, never judging a Claude tab in the pinned chat", () => {
    const seen: (readonly number[])[] = [];
    const readChair: StandingChairReader = ({ pids }) => {
      seen.push(pids);
      return { kind: "resolved", sessions: [CHAIR_SESSION] };
    };
    const read = standingChairRead({
      pinHost: undefined,
      readChair,
      workspaces: { supervisorCwd: "/work/chair", supervisorPids: [19_207], supervisorWorkspaceId: "workspace:1" },
    });
    expect(seen).toEqual([]);
    expect(read).toEqual({ cause: "chair-host-unmeasured", kind: "unresolved", why: UNMEASURED_CHAIR_HOST });
    expect(UNMEASURED_CHAIR_HOST).toBe(
      "no supervisor pin record or chain link names the chair, so which session holds it is UNMEASURED and no " +
        "session in the pinned workspace is judged as the chair",
    );
  });
});
