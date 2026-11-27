import { describe, expect, it } from "vitest";

import {
  CLAUDE_CODE_SESSION_ID_ENV,
  CODEX_HOME_ENV,
  CODEX_THREAD_ID_ENV,
  claudeSessionIdOf,
  detectSupervisorSession,
  dispatchedWorkerLabel,
  isRecordableCodexHome,
  parseSupervisorSessionLabel,
  parseVisibleSession,
  recordedSupervisorSession,
  sameSupervisorSession,
  supervisorModelLabel,
  supervisorSessionKey,
  supervisorSessionLabel,
  supervisorSessionProblem,
} from "../../../supervisor/session.js";

const CLAUDE = { host: "claude-code", id: "abc" } as const;
const CODEX = { host: "codex", id: "abc" } as const;

describe("session identity is host AND id", () => {
  it("never calls two hosts sharing an opaque id the same session", () => {
    expect(sameSupervisorSession({ left: CLAUDE, right: { host: "claude-code", id: "abc" } })).toBe(true);
    expect(sameSupervisorSession({ left: CLAUDE, right: CODEX })).toBe(false);
    expect(sameSupervisorSession({ left: CLAUDE, right: { host: "claude-code", id: "abd" } })).toBe(false);
  });

  it("keys by host and id, and prints a Claude session bare and a Codex thread with its host", () => {
    expect(supervisorSessionKey({ session: CODEX })).toBe("codex:abc");
    expect(supervisorSessionKey({ session: { host: "claude-code", id: "a:b" } })).toBe("claude-code:a:b");
    expect(supervisorSessionLabel({ session: CLAUDE })).toBe("abc");
    expect(supervisorSessionLabel({ session: CODEX })).toBe("codex:abc");
  });

  it("hands a Claude-only path the id of a Claude session alone", () => {
    expect(claudeSessionIdOf({ session: CLAUDE })).toBe("abc");
    expect(claudeSessionIdOf({ session: CODEX })).toBeUndefined();
    expect(claudeSessionIdOf({ session: undefined })).toBeUndefined();
  });

  it("narrows only a model-backed host with a non-blank id", () => {
    expect(parseVisibleSession({ value: { host: "codex", id: "t1" } })).toStrictEqual({ host: "codex", id: "t1" });
    expect(parseVisibleSession({ value: { host: "explicit", id: "t1" } })).toBeUndefined();
    expect(parseVisibleSession({ value: { host: "codex", id: " " } })).toBeUndefined();
    expect(parseVisibleSession({ value: "codex:t1" })).toBeUndefined();
  });

  it("refuses a recorded id a path could read as a separator or parent, so no reader joins it", () => {
    expect(parseVisibleSession({ value: { host: "claude-code", id: "../../escape" } })).toBeUndefined();
    expect(parseVisibleSession({ value: { host: "claude-code", id: ".." } })).toBeUndefined();
    expect(recordedSupervisorSession({ record: { claudeSessionId: "../../escape" } })).toBeUndefined();
    expect(recordedSupervisorSession({ record: { claudeSessionId: "a\\b" } })).toBeUndefined();
  });

  it("decodes a record's canonical session, a legacy `claudeSessionId` as Claude, and refuses both at once", () => {
    expect(recordedSupervisorSession({ record: { session: CODEX } })).toStrictEqual(CODEX);
    expect(recordedSupervisorSession({ record: { claudeSessionId: "abc" } })).toStrictEqual(CLAUDE);
    expect(recordedSupervisorSession({ record: { claudeSessionId: "abc", session: CODEX } })).toBeUndefined();
    expect(recordedSupervisorSession({ record: { claudeSessionId: "  " } })).toBeUndefined();
    expect(recordedSupervisorSession({ record: {} })).toBeUndefined();
  });
});

describe("detectSupervisorSession", () => {
  it("detects and trims a Claude Code session", () => {
    expect(detectSupervisorSession({ env: { [CLAUDE_CODE_SESSION_ID_ENV]: " claude-1\n" } })).toEqual({
      kind: "active",
      session: { host: "claude-code", id: "claude-1" },
    });
  });

  it("detects and trims a Codex thread", () => {
    expect(detectSupervisorSession({ env: { [CODEX_THREAD_ID_ENV]: " codex-1\n" } })).toEqual({
      kind: "active",
      session: { host: "codex", id: "codex-1" },
    });
  });

  it("carries a Codex thread's absolute CODEX_HOME, and drops a relative or blank one rather than guessing", () => {
    expect(detectSupervisorSession({ env: { [CODEX_HOME_ENV]: "/h/.codex", [CODEX_THREAD_ID_ENV]: "t1" } })).toEqual({
      codexHome: "/h/.codex",
      kind: "active",
      session: { host: "codex", id: "t1" },
    });
    expect(
      [".codex", "  "].map((home) =>
        detectSupervisorSession({ env: { [CODEX_HOME_ENV]: home, [CODEX_THREAD_ID_ENV]: "t1" } }),
      ),
    ).toEqual([
      { kind: "active", session: { host: "codex", id: "t1" } },
      { kind: "active", session: { host: "codex", id: "t1" } },
    ]);
    expect(
      detectSupervisorSession({ env: { [CLAUDE_CODE_SESSION_ID_ENV]: "c1", [CODEX_HOME_ENV]: "/h/.codex" } }),
    ).toEqual({
      kind: "active",
      session: { host: "claude-code", id: "c1" },
    });
  });

  it("knows a recordable home: a trimmed, non-empty absolute string", () => {
    expect(["/h/.codex", " /h ", ".codex", "", 7].map((value) => isRecordableCodexHome({ value }))).toEqual([
      true,
      false,
      false,
      false,
      false,
    ]);
  });

  it("reports a missing visible supervisor", () => {
    const detection = detectSupervisorSession({ env: { [CODEX_THREAD_ID_ENV]: "   " } });
    expect(detection).toEqual({ kind: "missing" });
    if (detection.kind !== "active") {
      expect(supervisorSessionProblem({ detection })).toContain("neither CLAUDE_CODE_SESSION_ID nor CODEX_THREAD_ID");
    }
  });

  it("refuses to choose when both hosts are present", () => {
    const detection = detectSupervisorSession({
      env: { [CLAUDE_CODE_SESSION_ID_ENV]: "claude-1", [CODEX_THREAD_ID_ENV]: "codex-1" },
    });
    expect(detection.kind).toBe("ambiguous");
    if (detection.kind !== "active") {
      expect(supervisorSessionProblem({ detection })).toContain("visible supervisor is ambiguous");
    }
  });
});

describe("parseSupervisorSessionLabel", () => {
  it("reads a bare id as Claude Code and a host-qualified one as that host, as a chain line prints it", () => {
    expect(["abc", "codex:abc", "claude-code:abc"].map((text) => parseSupervisorSessionLabel({ text }))).toStrictEqual([
      CLAUDE,
      CODEX,
      CLAUDE,
    ]);
  });

  it("refuses an unknown host, a blank id and a path-shaped one", () => {
    expect(
      ["explicit:abc", "codex:", "codex:../x", "../x", ""].map((text) => parseSupervisorSessionLabel({ text })),
    ).toStrictEqual([undefined, undefined, undefined, undefined, undefined]);
  });
});

describe("supervisorModelLabel", () => {
  it("names the host that actually owns the visible turn", () => {
    expect(supervisorModelLabel({ session: { host: "claude-code", id: "c" } })).toContain("Claude Code");
    expect(supervisorModelLabel({ session: { host: "codex", id: "x" } })).toContain("Codex");
    expect(supervisorModelLabel({ session: { host: "explicit", id: "legacy" } })).toContain("explicit");
  });
});

describe("dispatchedWorkerLabel", () => {
  it("names the worker's own workspace, so the card's provenance is checkable", () => {
    expect(dispatchedWorkerLabel({ host: "claude-code", workspaceRef: "workspace:218" })).toBe(
      "the dispatched worker in workspace:218 (Claude Code, in-turn)",
    );
  });

  it("names the Codex host when that is what the worker was booted onto", () => {
    expect(dispatchedWorkerLabel({ host: "codex", workspaceRef: "workspace:219" })).toBe(
      "the dispatched worker in workspace:219 (Codex, in-turn)",
    );
  });

  it("never reads as the supervisor session, which is the mislabel it replaces", () => {
    const worker = dispatchedWorkerLabel({ host: "claude-code", workspaceRef: "workspace:218" });

    expect(worker).not.toBe(supervisorModelLabel({ session: { host: "claude-code", id: "c" } }));
    expect(worker.includes("supervisor")).toBe(false);
  });
});
