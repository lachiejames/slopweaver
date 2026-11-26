/**
 * The pure chair half of `fleet recover`: one look at a restarted chair, and the line the result carries.
 */
import { describe, expect, it } from "vitest";

import {
  judgeRecoveryChair,
  type RecoveryRestartAttempt,
  reconfirmedRestart,
  recoveryChairResultOf,
  restartFallsBack,
} from "../../../fleet/recoveryChair.js";

const DOWN = { kind: "down", why: "no supervisor is pinned" } as const;

describe("judgeRecoveryChair", () => {
  const mine = { appSessionId: "chair-1", kind: "app" } as const;

  it("calls the chair restarted only once the pin names it and the app still runs it", () => {
    expect(
      judgeRecoveryChair({ deadlinePassed: false, pin: mine, sessionId: "chair-1", snapshot: { state: "running" } }),
    ).toEqual({ kind: "restarted" });
    expect(
      judgeRecoveryChair({
        deadlinePassed: false,
        pin: { appSessionId: "someone-else", kind: "app" },
        sessionId: "chair-1",
        snapshot: { state: "running" },
      }),
    ).toEqual({ kind: "waiting" });
  });

  it("calls a chair that ended, or that the app no longer lists, ended when it never took the pin", () => {
    const none = { kind: "none" } as const;
    expect(
      judgeRecoveryChair({ deadlinePassed: false, pin: none, sessionId: "chair-1", snapshot: { state: "stopping" } }),
    ).toEqual({ kind: "ended", reason: "the new chair was stopping before it took the pin" });
    expect(judgeRecoveryChair({ deadlinePassed: false, pin: none, sessionId: "chair-1", snapshot: undefined })).toEqual(
      { kind: "ended", reason: "the new chair left the app's list before it took the pin" },
    );
  });

  it("calls a chair that took the pin and then ended lost, never restarted and never ended", () => {
    expect(
      judgeRecoveryChair({ deadlinePassed: false, pin: mine, sessionId: "chair-1", snapshot: { state: "stopping" } }),
    ).toEqual({ kind: "lost", reason: "the new chair took the pin, then was stopping" });
    expect(judgeRecoveryChair({ deadlinePassed: false, pin: mine, sessionId: "chair-1", snapshot: undefined })).toEqual(
      { kind: "lost", reason: "the new chair took the pin, then left the app's list" },
    );
  });

  it("calls a chair still running at the deadline starting, saying when the pin could not be read", () => {
    const running = { state: "running" } as const;
    expect(
      judgeRecoveryChair({ deadlinePassed: true, pin: { kind: "none" }, sessionId: "chair-1", snapshot: running }),
    ).toEqual({ kind: "starting", reason: "the new chair is running and has not taken the pin yet" });
    expect(
      judgeRecoveryChair({
        deadlinePassed: true,
        pin: { kind: "unreadable", why: "not JSON" },
        sessionId: "chair-1",
        snapshot: running,
      }),
    ).toEqual({ kind: "starting", reason: "the new chair is running, and the pin could not be read: not JSON" });
  });
});

describe("recoveryChairResultOf", () => {
  const refused: RecoveryRestartAttempt = {
    alias: "claude-1",
    outcome: "spawn-refused",
    reason: "the spawn refused claude-1",
    vendor: "claude",
  };

  it("says why a down chair stayed down, naming the last plan tried", () => {
    expect(recoveryChairResultOf({ reading: DOWN, restarts: [refused] })).toEqual({
      outcome: "not-restarted",
      reason: "no supervisor is pinned; the last chair tried, on Claude plan claude-1, the spawn refused claude-1",
      restarts: [refused],
    });
  });

  it("names the plan a starting chair runs on", () => {
    const starting: RecoveryRestartAttempt = {
      alias: "codex-1",
      outcome: "starting",
      reason: "the new chair is running and has not taken the pin yet",
      vendor: "codex",
    };
    expect(recoveryChairResultOf({ reading: DOWN, restarts: [refused, starting] }).reason).toBe(
      "a new supervisor is starting on Codex plan codex-1: the new chair is running and has not taken the pin yet",
    );
  });
});

describe("reconfirmedRestart", () => {
  const restarted: RecoveryRestartAttempt = {
    alias: "claude-1",
    outcome: "restarted",
    reason: "it took the supervisor pin",
    sessionId: "chair-1",
    vendor: "claude",
  };
  const mine = { appSessionId: "chair-1", kind: "app" } as const;

  it("keeps a restarted chair restarted only while the pin names it and the app runs it", () => {
    expect(reconfirmedRestart({ attempt: restarted, pin: mine, snapshot: { state: "running" } })).toEqual(restarted);
  });

  it("calls a restarted chair lost once it ended, left the list, or the pin moved off it", () => {
    const elsewhere = { appSessionId: "chair-9", kind: "app" } as const;
    const looks = [
      reconfirmedRestart({ attempt: restarted, pin: mine, snapshot: { state: "failed" } }),
      reconfirmedRestart({ attempt: restarted, pin: mine, snapshot: undefined }),
      reconfirmedRestart({ attempt: restarted, pin: elsewhere, snapshot: { state: "running" } }),
    ];
    expect(looks.map((look) => `${look.outcome}: ${look.reason}`)).toEqual([
      "lost: the new chair took the pin, then was failed",
      "lost: the new chair took the pin, then left the app's list",
      "lost: the new chair took the pin, then the pin moved off it",
    ]);
  });

  it("leaves an attempt that was not restarted as it was", () => {
    const starting: RecoveryRestartAttempt = { ...restarted, outcome: "starting", reason: "still starting" };
    expect(reconfirmedRestart({ attempt: starting, pin: { kind: "none" }, snapshot: undefined })).toEqual(starting);
  });
});

describe("restartFallsBack", () => {
  it("falls back only from a chair that left nothing running", () => {
    const outcomes = ["restarted", "starting", "spawn-refused", "ended", "lost", "deadline"] as const;
    expect(
      outcomes.map((outcome) => restartFallsBack({ attempt: { alias: "a", outcome, reason: "r", vendor: "claude" } })),
    ).toEqual([false, false, true, true, false, false]);
  });
});
