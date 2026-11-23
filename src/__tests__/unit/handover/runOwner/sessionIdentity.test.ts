/*
 * Which session this process is: the id a host sets in the environment, and the id a hook payload names. It moved
 * here when `runOwner.test.ts` was split by behaviour.
 */
import { describe, expect, it } from "vitest";

import { currentSessionId, currentSessionIds, sessionIdFromPayload } from "../../../../handover/runOwner.js";
import { CLAUDE_CODE_SESSION_ID_ENV, CODEX_THREAD_ID_ENV } from "../../../../supervisor/session.js";
import { MINE, THEIRS } from "./harness.js";

describe("currentSessionId", () => {
  it("reads the session id Claude Code sets", () => {
    expect(currentSessionId({ env: { [CLAUDE_CODE_SESSION_ID_ENV]: MINE } })).toBe(MINE);
  });

  it("reads the thread id Codex sets", () => {
    expect(currentSessionId({ env: { [CODEX_THREAD_ID_ENV]: MINE } })).toBe(MINE);
  });

  it("claims nothing when both hosts are present", () => {
    expect(
      currentSessionId({ env: { [CODEX_THREAD_ID_ENV]: MINE, [CLAUDE_CODE_SESSION_ID_ENV]: THEIRS } }),
    ).toBeUndefined();
  });

  /**
   * The half `currentSessionId` cannot serve. A self-guard asking "is this writer me?" over `undefined` protects
   * nobody, and a settle run with a stale Codex thread id beside a live Claude one orphaned its own run.
   */
  it("currentSessionIds keeps BOTH ids when the environment is ambiguous", () => {
    expect(currentSessionIds({ env: { [CODEX_THREAD_ID_ENV]: MINE, [CLAUDE_CODE_SESSION_ID_ENV]: THEIRS } })).toEqual([
      THEIRS,
      MINE,
    ]);
  });

  it("currentSessionIds is the single id when only one host is present", () => {
    expect(currentSessionIds({ env: { [CLAUDE_CODE_SESSION_ID_ENV]: MINE } })).toEqual([MINE]);
    expect(currentSessionIds({ env: { [CODEX_THREAD_ID_ENV]: MINE } })).toEqual([MINE]);
  });

  it("currentSessionIds is empty when the environment names no session at all", () => {
    expect(currentSessionIds({ env: {} })).toEqual([]);
  });

  it("is undefined when the variable is absent, so nothing can be claimed on its strength", () => {
    expect(currentSessionId({ env: {} })).toBeUndefined();
  });

  it("treats a blank value as absent rather than as an identity that matches nothing", () => {
    expect(currentSessionId({ env: { [CLAUDE_CODE_SESSION_ID_ENV]: "   " } })).toBeUndefined();
  });

  it("trims a value, so a trailing newline from a wrapper does not make a session a stranger", () => {
    expect(currentSessionId({ env: { [CLAUDE_CODE_SESSION_ID_ENV]: `${MINE}\n` } })).toBe(MINE);
  });
});

describe("sessionIdFromPayload", () => {
  it("reads the session the harness names in the hook payload", () => {
    expect(sessionIdFromPayload({ payload: { hook_event_name: "Stop", session_id: MINE } })).toBe(MINE);
  });

  it("is undefined for a payload that is not an object at all", () => {
    expect(sessionIdFromPayload({ payload: "nonsense" })).toBeUndefined();
  });

  it("is undefined when the field is absent or the wrong type", () => {
    expect(sessionIdFromPayload({ payload: { hook_event_name: "Stop" } })).toBeUndefined();
    expect(sessionIdFromPayload({ payload: { session_id: 7 } })).toBeUndefined();
  });
});
