/**
 * One whole Recovery pass over a scripted app: plain functions stand in for the desktop app, the scratch and the clock,
 * so what is under test is the order things happen in — leftovers closed first, one session at a time, a plan's
 * fallback, and the stop when a session cannot be proven gone. The supervisor runs throughout; its restart is
 * `recoveryPassChair.test.ts`.
 */
import { describe, expect, it } from "vitest";
import { RECOVERY_PASS_MS } from "../../../fleet/recoveryCheck.js";
import { runRecoveryPass } from "../../../fleet/recoveryPass.js";
import type { RecoveryPassDeps } from "../../../fleet/recoveryPassDeps.js";
import type { AppSessionSnapshot } from "../../../sessionHarness/appProtocol.js";
import { CLAUDE, CODEX, fakeApp, fakeScratch, passDeps, SCRATCH } from "./recoveryPassFixture.js";

describe("runRecoveryPass", () => {
  it("passes both vendors on their first plan, one session at a time, each closed and the scratch cleared", async () => {
    const app = fakeApp({ behaviours: { "claude-1": "answers", "codex-1": "answers" } });
    const { clears, made, scratch } = fakeScratch();
    const result = await runRecoveryPass({ deps: passDeps({ app, scratch }), runId: "run" });
    expect(result.status).toBe("passed");
    expect(result.vendors.map((vendor) => vendor.alias)).toEqual(["claude-1", "codex-1"]);
    expect(app.opened).toEqual(["fleet-recovery:run:claude:claude-1", "fleet-recovery:run:codex:codex-1"]);
    expect(app.closed).toEqual(["s-1", "s-2"]);
    expect(made).toEqual(["run-1", "run-2"]);
    expect(clears.count).toBe(2);
    expect(result.startedAtIso).toBe("2026-11-25T10:00:00.000Z");
    expect(result.chair).toEqual({
      outcome: "live",
      reason: "the supervisor is running on app:the-chair, so nothing was restarted",
      restarts: [],
    });
  });

  it("falls back to the next plan when one answers wrong, and records why the first did not pass", async () => {
    const app = fakeApp({ behaviours: { "claude-1": "wrong", "claude-2": "answers", "codex-1": "answers" } });
    const { scratch } = fakeScratch();
    const result = await runRecoveryPass({ deps: passDeps({ app, scratch }), runId: "run" });
    expect(result.attempts.map((attempt) => attempt.outcome)).toEqual(["failed", "passed", "passed"]);
    expect(result.attempts[0]!.reason).toBe("its turn ended with another answer: API Error: 401");
    expect(result.vendors[0]!.alias).toBe("claude-2");
    expect(app.closed).toEqual(["s-1", "s-2", "s-3"]);
    expect(result.status).toBe("passed");
  });

  it("records a refused launch with the launch's own reason and no session", async () => {
    const app = fakeApp({ behaviours: { "claude-1": "refused", "claude-2": "answers", "codex-1": "answers" } });
    const { scratch } = fakeScratch();
    const result = await runRecoveryPass({ deps: passDeps({ app, scratch }), runId: "run" });
    expect(result.attempts[0]).toEqual({
      alias: "claude-1",
      attemptId: "run-1",
      outcome: "launch-refused",
      reason: "the credential gate refused claude-1: its week is spent",
      vendor: "claude",
    });
    expect(app.opened.length).toBe(3);
    expect(result.status).toBe("passed");
  });

  it("stops at a launch the app never answered, opening nothing beside a card that may still appear", async () => {
    const app = fakeApp({ behaviours: { "claude-1": "unanswered", "claude-2": "answers", "codex-1": "answers" } });
    const { clears, scratch } = fakeScratch();
    const result = await runRecoveryPass({ deps: passDeps({ app, scratch }), runId: "run" });
    expect(result.status).toBe("infrastructure-failed");
    expect(result.infrastructure).toBe(
      "the app never answered the launch on claude-1, so its card may still open; the check stopped rather than open another beside it",
    );
    expect(result.attempts).toEqual([
      {
        alias: "claude-1",
        attemptId: "run-1",
        outcome: "launch-refused",
        reason: "the desktop app did not answer launch.prepare within 180s",
        vendor: "claude",
      },
    ]);
    expect(app.opened).toEqual(["fleet-recovery:run:claude:claude-1"]);
    expect(clears.count).toBe(1);
  });

  it("after a refused launch, leaves a session under the attempt's key that runs outside this home's scratch", async () => {
    const app = fakeApp({
      behaviours: { "claude-1": "refused", "claude-2": "answers", "codex-1": "answers" },
      standing: [
        {
          directory: "/work/project",
          handle: "app:s-elsewhere",
          ledgerKey: "fleet-recovery:run:claude:claude-1",
          openedAtIso: "2026-11-25T09:00:00.000Z",
          sessionId: "s-elsewhere",
          state: "running",
          title: "Recovery check",
          vendor: "claude",
        },
      ],
    });
    const { scratch } = fakeScratch();
    const result = await runRecoveryPass({ deps: passDeps({ app, scratch }), runId: "run" });
    expect(app.closed).toEqual(["s-2", "s-3"]);
    expect(result.status).toBe("passed");
  });

  it("calls a session still running two minutes on a deadline, closes it and tries the next plan", async () => {
    const app = fakeApp({ behaviours: { "claude-1": "hangs", "claude-2": "answers", "codex-1": "answers" } });
    const { scratch } = fakeScratch();
    const result = await runRecoveryPass({ deps: passDeps({ app, scratch }), runId: "run" });
    expect(result.attempts[0]).toEqual({
      alias: "claude-1",
      attemptId: "run-1",
      outcome: "deadline",
      reason: "it was still running when its time ran out",
      sessionId: "s-1",
      vendor: "claude",
    });
    expect(app.closed).toEqual(["s-1", "s-2", "s-3"]);
  });

  it("opens nothing once too little of the pass is left, naming each plan it did not try", async () => {
    const app = fakeApp({ behaviours: { "claude-1": "answers", "codex-1": "answers" } });
    const { scratch } = fakeScratch();
    const evidence: RecoveryPassDeps["evidence"] = async ({ vendor }) => {
      if (vendor === "codex") {
        app.clock.ms += RECOVERY_PASS_MS;
        return CODEX;
      }
      return CLAUDE;
    };
    const result = await runRecoveryPass({ deps: passDeps({ app, evidence, scratch }), runId: "run" });
    expect(result.attempts[1]).toEqual({
      alias: "codex-1",
      attemptId: "run-2",
      outcome: "deadline",
      reason: "not tried: the check ran out of time",
      vendor: "codex",
    });
    expect(app.opened).toEqual(["fleet-recovery:run:claude:claude-1"]);
    expect(result.status).toBe("partial");
  });

  it("closes an earlier pass's sessions and open rows first, and nothing outside this home's scratch", async () => {
    const earlier = {
      directory: `${SCRATCH}/old-1/fleet-recovery`,
      handle: "app:s-old",
      ledgerKey: "fleet-recovery:old:claude:claude-1",
      openedAtIso: "2026-11-25T09:00:00.000Z",
      sessionId: "s-old",
      title: "Recovery check",
      vendor: "claude",
    } satisfies Omit<AppSessionSnapshot, "state">;
    const app = fakeApp({
      behaviours: { "claude-1": "answers", "codex-1": "answers" },
      leftOpen: [{ handle: "app:s-row", sessionId: "s-row" }],
      standing: [
        { ...earlier, state: "running" },
        { ...earlier, directory: "/another-home/fleet-recovery", sessionId: "s-other", state: "running" },
        { ...earlier, ledgerKey: "seat:someone", sessionId: "s-seat", state: "idle" },
        { ...earlier, sessionId: "s-gone", state: "closed" },
      ],
    });
    const { scratch } = fakeScratch();
    const result = await runRecoveryPass({ deps: passDeps({ app, scratch }), runId: "run" });
    expect(app.closed).toEqual(["s-old", "s-row", "s-1", "s-2"]);
    expect(result.status).toBe("passed");
  });

  it("stops, clearing nothing, when a session cannot be proven closed", async () => {
    const app = fakeApp({ behaviours: { "claude-1": "close-fails", "codex-1": "answers" } });
    const { clears, scratch } = fakeScratch();
    const result = await runRecoveryPass({ deps: passDeps({ app, scratch }), runId: "run" });
    expect(result.status).toBe("infrastructure-failed");
    expect(result.infrastructure).toBe(
      "the throwaway session app:s-1 could not be closed: the app did not answer close",
    );
    expect(app.opened).toEqual(["fleet-recovery:run:claude:claude-1"]);
    expect(clears.count).toBe(1);
  });

  it("reports the app unreachable as the check failing, and the supervisor unread", async () => {
    const app = fakeApp({ behaviours: {}, listFails: true });
    const { scratch } = fakeScratch();
    const result = await runRecoveryPass({ deps: passDeps({ app, scratch }), runId: "run" });
    expect(result.status).toBe("infrastructure-failed");
    expect(result.infrastructure).toBe("the desktop app is not running");
    expect(result.attempts).toEqual([]);
    expect(app.opened).toEqual([]);
    expect(result.chair).toEqual({
      outcome: "not-restarted",
      reason: "the check stopped before the supervisor was read, so nothing was restarted",
      restarts: [],
    });
  });

  it("opens nothing more once another check holds the lock", async () => {
    const app = fakeApp({ behaviours: { "claude-1": "answers", "codex-1": "answers" } });
    const { scratch } = fakeScratch();
    const result = await runRecoveryPass({ deps: passDeps({ app, lockHeld: () => false, scratch }), runId: "run" });
    expect(result.infrastructure).toBe("another Recovery check took over");
    expect(app.opened).toEqual([]);
  });

  it("turns a throw from an effect into why the check could not run", async () => {
    const app = fakeApp({ behaviours: {} });
    const { scratch } = fakeScratch();
    const evidence: RecoveryPassDeps["evidence"] = async () => {
      throw new Error("the plan register is locked");
    };
    const result = await runRecoveryPass({ deps: passDeps({ app, evidence, scratch }), runId: "run" });
    expect(result.status).toBe("infrastructure-failed");
    expect(result.infrastructure).toBe("the plan register is locked");
  });
});
