/*
 * `judgeColdSeat`: a reopened tab is cold only when it is positively a bare shell with no live session and a saved
 * session whose transcript is on disk — and the pin outranks cmux's binding for which session that is.
 */
import { describe, expect, it } from "vitest";

import type { CmuxProcess } from "../../../../cmux/client.js";
import { judgeColdSeat } from "../../../../sessions/coldSeat.js";
import type { SessionRecord } from "../../../../sessions/liveSessions.js";
import { ALL_ON_DISK, BARE_SHELL, BOUND, binding, RUNNING_CLAUDE } from "./harness.js";

const PINNED = "a0000049-0000-4000-8000-000000000052";

/** A live registry record at a pid. */
function live({ pid }: { pid: number }): SessionRecord {
  return {
    cwd: "/wt/seat",
    entrypoint: "cli",
    kind: "interactive",
    name: "s",
    pid,
    sessionId: BOUND,
    startedAtMs: 0,
    status: "idle",
  };
}

describe("judgeColdSeat", () => {
  it("reads a bare shell with a bound session as cold, carrying cmux's saved argv and cwd", () => {
    const verdict = judgeColdSeat({
      binding: binding(),
      liveRecords: [],
      pinnedSessionId: undefined,
      transcriptExists: ALL_ON_DISK,
      tree: BARE_SHELL,
      workspaceCwd: "/wt/seat",
    });

    expect(verdict).toEqual({
      argv: `--model opus --resume ${BOUND}`,
      cwd: "/wt/seat",
      kind: "cold",
      mismatch: undefined,
      sessionId: BOUND,
    });
  });

  it("resumes the PIN over a different binding, drops the binding's argv, and names the mismatch", () => {
    const verdict = judgeColdSeat({
      binding: binding(),
      liveRecords: [],
      pinnedSessionId: PINNED,
      transcriptExists: ALL_ON_DISK,
      tree: BARE_SHELL,
      workspaceCwd: "/wt/chair",
    });

    expect(verdict).toEqual({
      argv: "",
      cwd: "/wt/chair",
      kind: "cold",
      mismatch: { bound: BOUND, pinned: PINNED },
      sessionId: PINNED,
    });
  });

  it("checks the transcript only under the tab's own directory, where the typed line runs", () => {
    const verdict = judgeColdSeat({
      binding: binding(),
      liveRecords: [],
      pinnedSessionId: undefined,
      transcriptExists: ({ cwd }) => cwd === "/wt/seat",
      tree: BARE_SHELL,
      workspaceCwd: "/wt/tab",
    });

    expect(verdict).toEqual({ cwd: "/wt/tab", kind: "unresumable", sessionId: BOUND });
  });

  it("reads one childless unknown process holding a saved session as an unrecognised prompt, never cold", () => {
    const tree: readonly CmuxProcess[] = [{ children: [], name: "/usr/bin/powershell", pid: 10 }];
    const common = {
      liveRecords: [],
      pinnedSessionId: undefined,
      transcriptExists: ALL_ON_DISK,
      tree,
      workspaceCwd: "/wt/seat",
    };

    expect([
      judgeColdSeat({ ...common, binding: binding() }),
      judgeColdSeat({ ...common, binding: undefined }),
      judgeColdSeat({ ...common, binding: binding(), liveRecords: [live({ pid: 777 })] }),
    ]).toEqual([
      { kind: "not-cold", why: "unrecognised-prompt" },
      { kind: "not-cold", why: "not-a-bare-shell" },
      { kind: "not-cold", why: "live-elsewhere" },
    ]);
  });

  it("never resumes a session already live in another tab", () => {
    const verdict = judgeColdSeat({
      binding: binding(),
      liveRecords: [live({ pid: 777 })],
      pinnedSessionId: undefined,
      transcriptExists: ALL_ON_DISK,
      tree: BARE_SHELL,
      workspaceCwd: "/wt/seat",
    });

    expect(verdict).toEqual({ kind: "not-cold", why: "live-elsewhere" });
  });

  it("is unresumable when the tab's directory holds no transcript", () => {
    const verdict = judgeColdSeat({
      binding: undefined,
      liveRecords: [],
      pinnedSessionId: PINNED,
      transcriptExists: () => false,
      tree: BARE_SHELL,
      workspaceCwd: "/wt/chair",
    });

    expect(verdict).toEqual({ cwd: "/wt/chair", kind: "unresumable", sessionId: PINNED });
  });

  it("leaves a tab with a live session to the live pass", () => {
    const verdict = judgeColdSeat({
      binding: binding(),
      liveRecords: [live({ pid: 393 })],
      pinnedSessionId: undefined,
      transcriptExists: ALL_ON_DISK,
      tree: RUNNING_CLAUDE,
      workspaceCwd: "/wt/seat",
    });

    expect(verdict).toEqual({ kind: "not-cold", why: "live-session" });
  });

  it("types into nothing that is not positively a bare shell, and tells an empty tree from a running one", () => {
    const running = judgeColdSeat({
      binding: binding(),
      liveRecords: [],
      pinnedSessionId: undefined,
      transcriptExists: ALL_ON_DISK,
      tree: RUNNING_CLAUDE,
      workspaceCwd: "/wt/seat",
    });
    const empty = judgeColdSeat({
      binding: binding(),
      liveRecords: [],
      pinnedSessionId: undefined,
      transcriptExists: ALL_ON_DISK,
      tree: [],
      workspaceCwd: "/wt/seat",
    });

    expect(running).toEqual({ kind: "not-cold", why: "not-a-bare-shell" });
    expect(empty).toEqual({ kind: "not-cold", why: "no-process" });
  });

  it("is no-saved-session for a bare shell with neither a pin nor a binding", () => {
    const verdict = judgeColdSeat({
      binding: undefined,
      liveRecords: [],
      pinnedSessionId: undefined,
      transcriptExists: ALL_ON_DISK,
      tree: BARE_SHELL,
      workspaceCwd: "/wt/seat",
    });

    expect(verdict).toEqual({ kind: "not-cold", why: "no-saved-session" });
  });
});
