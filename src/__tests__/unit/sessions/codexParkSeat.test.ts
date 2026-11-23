/**
 * Which Codex thread a parking seat is (`src/sessions/codexParkSeat.ts`): bound only by positive evidence — Codex's
 * own idle composer and a process inside the seat's tree holding one thread its run's current cycle names.
 */
import { describe, expect, it } from "vitest";

import type { RunEvent } from "../../../handover/ledger.js";
import type { CodexThreadObservation, CodexThreadObserver } from "../../../measurement/codexSessions.js";
import { codexThreadsOf, readCodexParkSeat } from "../../../sessions/codexParkSeat.js";
import { CODEX_IDLE_AFTER_TURNS, CODEX_QUEUED, CODEX_RUNNING } from "../../fixtures/codexTui.js";

const AT = "2026-11-05T09:00:00.000Z";
const STARTED: RunEvent = { atIso: AT, branch: "b", docHash: "h", kind: "started" };
const PROC_START = "Thu Nov  5 08:00:00 2026";

/** A Codex launch of `threadId` into the run, from `pid`. */
function codexLaunch({ threadId, pid = 5151 }: { threadId: string; pid?: number }): RunEvent {
  return { atIso: AT, host: "codex", kind: "launched", pid, sessionId: threadId, worktree: "/wt/doc" };
}

/** An observer answering from a fixed table, recording every thread it was asked about. */
function observer({ held }: { held: Readonly<Record<string, CodexThreadObservation>> }): {
  readonly observe: CodexThreadObserver;
  readonly asked: string[];
} {
  const asked: string[] = [];
  return {
    asked,
    observe: ({ threadId }) => {
      asked.push(threadId);
      const seen = held[threadId];
      if (seen === undefined) {
        return { kind: "not-observed", why: "no Codex process holds it" };
      }
      return seen;
    },
  };
}

const LIVE_5151: CodexThreadObservation = { kind: "live", path: "/c/sessions/rollout-t1.jsonl", pid: 5151 };

describe("codexThreadsOf", () => {
  it("names each Codex launch or claim of the current cycle once, and never a Claude or hostless one", () => {
    const events: RunEvent[] = [
      { ...STARTED },
      codexLaunch({ threadId: "old" }),
      { ...STARTED },
      { atIso: AT, kind: "launched", pid: 1, sessionId: "hostless", worktree: "/wt/doc" },
      { atIso: AT, host: "claude-code", kind: "launched", pid: 2, sessionId: "claude-1", worktree: "/wt/doc" },
      codexLaunch({ threadId: "t1" }),
      { atIso: AT, host: "codex", kind: "claimed", pid: 3, sessionId: "t2", why: "took it", worktree: "/wt/doc" },
      codexLaunch({ threadId: "t1" }),
    ];

    expect(codexThreadsOf({ events })).toStrictEqual(["t1", "t2"]);
  });

  it("names nothing before any cycle has started", () => {
    expect(codexThreadsOf({ events: [codexLaunch({ threadId: "t1" })] })).toStrictEqual([]);
  });
});

describe("readCodexParkSeat", () => {
  const events = [STARTED, codexLaunch({ threadId: "t1" })];
  const starts = new Map([[5151, PROC_START]]);

  it("binds the one thread held inside the tree to its process, idle", () => {
    const { observe } = observer({ held: { t1: LIVE_5151 } });

    expect(
      readCodexParkSeat({
        events,
        observeThread: observe,
        screen: CODEX_IDLE_AFTER_TURNS,
        starts,
        treePids: [5100, 5151],
      }),
    ).toStrictEqual({
      identity: {
        host: "codex",
        kind: "identified",
        pid: 5151,
        sessionId: "t1",
        startedIso: "2026-11-05T08:00:00.000Z",
        status: "idle",
      },
      kind: "identified",
    });
  });

  it("reads a running or queued Codex turn as working, and asks Codex nothing", () => {
    const { asked, observe } = observer({ held: { t1: LIVE_5151 } });
    const read = ({ screen }: { screen: string }): unknown =>
      readCodexParkSeat({ events, observeThread: observe, screen, starts, treePids: [5151] });

    expect(read({ screen: CODEX_RUNNING })).toStrictEqual({ kind: "working", state: "running" });
    expect(read({ screen: CODEX_QUEUED })).toStrictEqual({ kind: "working", state: "queued" });
    expect(asked).toStrictEqual([]);
  });

  it("proves nothing off a screen with no Codex composer at rest", () => {
    const { observe } = observer({ held: { t1: LIVE_5151 } });

    expect(readCodexParkSeat({ events, observeThread: observe, screen: "$ ", starts, treePids: [5151] })).toStrictEqual(
      { kind: "unmeasured", why: "its screen shows no Codex composer at rest" },
    );
  });

  it("is UNMEASURED when the run's cycle names no Codex thread", () => {
    const { asked, observe } = observer({ held: {} });

    expect(
      readCodexParkSeat({
        events: [STARTED],
        observeThread: observe,
        screen: CODEX_IDLE_AFTER_TURNS,
        starts,
        treePids: [5151],
      }),
    ).toStrictEqual({ kind: "unmeasured", why: "its run's current cycle names no Codex thread" });
    expect(asked).toStrictEqual([]);
  });

  it("never reads a thread no process holds as idle, nor one held outside the tree", () => {
    const twoThreads = [...events, codexLaunch({ threadId: "t2" })];
    const { observe } = observer({ held: { t2: { kind: "live", path: "/c/rollout-t2.jsonl", pid: 9999 } } });

    expect(
      readCodexParkSeat({
        events: twoThreads,
        observeThread: observe,
        screen: CODEX_IDLE_AFTER_TURNS,
        starts,
        treePids: [5151],
      }),
    ).toStrictEqual({
      kind: "unmeasured",
      why: "no Codex thread of its run is held in its process tree (t1: no Codex process holds it; t2: held by pid 9999, outside its process tree)",
    });
  });

  it("names no seat when two threads of its run are held in its tree", () => {
    const twoThreads = [...events, codexLaunch({ threadId: "t2" })];
    const held = { t1: LIVE_5151, t2: { kind: "live", path: "/c/rollout-t2.jsonl", pid: 5252 } } as const;
    const { observe } = observer({ held });

    expect(
      readCodexParkSeat({
        events: twoThreads,
        observeThread: observe,
        screen: CODEX_IDLE_AFTER_TURNS,
        starts,
        treePids: [5151, 5252],
      }),
    ).toStrictEqual({
      kind: "unmeasured",
      why: "2 Codex threads of its run are held in its tree (t1 pid 5151, t2 pid 5252)",
    });
  });

  it("is UNMEASURED when the holder's process start does not read", () => {
    const { observe } = observer({ held: { t1: LIVE_5151 } });

    expect(
      readCodexParkSeat({
        events,
        observeThread: observe,
        screen: CODEX_IDLE_AFTER_TURNS,
        starts: new Map(),
        treePids: [5151],
      }),
    ).toStrictEqual({ kind: "unmeasured", why: "the start of pid 5151, holding t1, does not read" });
  });
});
