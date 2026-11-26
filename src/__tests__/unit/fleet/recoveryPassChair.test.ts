/**
 * The chair half of one whole Recovery pass, over the scripted app and a scripted chair: a down supervisor is
 * restarted on the first plan that answers, a chair that never opened or ended first falls back to the next plan and
 * then the next vendor with its reason kept, and a chair running, starting or unreadable is left alone.
 */
import { describe, expect, it } from "vitest";
import type { RecoveryChairReading } from "../../../fleet/recoveryChair.js";
import { RECOVERY_PASS_MS } from "../../../fleet/recoveryCheck.js";
import { runRecoveryPass } from "../../../fleet/recoveryPass.js";
import type { RecoveryPassDeps } from "../../../fleet/recoveryPassDeps.js";
import { CLAUDE, CODEX, fakeApp, fakeChair, fakeScratch, passDeps } from "./recoveryPassFixture.js";

const DOWN: RecoveryChairReading = {
  kind: "down",
  predecessor: { label: "app:old-chair", slug: "fresh-supervisor-handoff-9040" },
  why: "the desktop app no longer runs the supervisor on app:old-chair",
};

const ALL_ANSWER = { "claude-1": "answers", "claude-2": "answers", "codex-1": "answers" } as const;

describe("runRecoveryPass, the chair", () => {
  it("restarts a down supervisor on the first plan that answers, and opens no second chair", async () => {
    const app = fakeApp({ behaviours: ALL_ANSWER });
    const { scratch } = fakeScratch();
    const chair = fakeChair({ app, opens: { "claude-1": "takes-pin" }, reading: DOWN });
    const result = await runRecoveryPass({ deps: passDeps({ app, chair: chair.chair, scratch }), runId: "run" });
    expect(result.chair).toEqual({
      outcome: "restarted",
      reason: "the supervisor restarted on Claude plan claude-1",
      restarts: [
        {
          alias: "claude-1",
          outcome: "restarted",
          reason: "it took the supervisor pin",
          sessionId: "chair-1",
          slug: "fresh-supervisor-handoff-9041",
          vendor: "claude",
        },
      ],
    });
    expect(chair.opened).toEqual(["claude-1"]);
    expect(chair.retired).toEqual([]);
    expect(app.opened).toEqual(["fleet-recovery:run:claude:claude-1", "fleet-recovery:run:codex:codex-1"]);
    expect(result.status).toBe("passed");
  });

  it("opens no chair beside a supervisor that came up while the plans were being checked", async () => {
    const app = fakeApp({ behaviours: ALL_ANSWER });
    const { scratch } = fakeScratch();
    const later = { kind: "live", label: "app:the-chair" } as const;
    const chair = fakeChair({ app, later, opens: { "claude-1": "takes-pin" }, reading: DOWN });
    const result = await runRecoveryPass({ deps: passDeps({ app, chair: chair.chair, scratch }), runId: "run" });
    expect(result.chair).toEqual({
      outcome: "live",
      reason: "the supervisor is running on app:the-chair, so nothing was restarted",
      restarts: [],
    });
    expect(chair.opened).toEqual([]);
  });

  it("falls back to the next plan when the spawn is refused, closing the refused doc's row", async () => {
    const app = fakeApp({ behaviours: ALL_ANSWER });
    const { scratch } = fakeScratch();
    const chair = fakeChair({ app, opens: { "claude-1": "refused", "claude-2": "takes-pin" }, reading: DOWN });
    const result = await runRecoveryPass({ deps: passDeps({ app, chair: chair.chair, scratch }), runId: "run" });
    expect(result.chair.restarts).toEqual([
      {
        alias: "claude-1",
        outcome: "spawn-refused",
        reason: "the spawn refused claude-1",
        slug: "fresh-supervisor-handoff-9041",
        vendor: "claude",
      },
      {
        alias: "claude-2",
        outcome: "restarted",
        reason: "it took the supervisor pin",
        sessionId: "chair-2",
        slug: "fresh-supervisor-handoff-9042",
        vendor: "claude",
      },
    ]);
    expect(chair.retired).toEqual(["fresh-supervisor-handoff-9041: the spawn refused claude-1"]);
    expect(result.chair.outcome).toBe("restarted");
    expect(app.opened.length).toBe(3);
  });

  it("falls back to the next vendor when every chair on the first ends before it takes the pin", async () => {
    const app = fakeApp({ behaviours: ALL_ANSWER });
    const { scratch } = fakeScratch();
    const opens = { "claude-1": "ends", "claude-2": "ends", "codex-1": "takes-pin" } as const;
    const chair = fakeChair({ app, opens, reading: DOWN });
    const result = await runRecoveryPass({ deps: passDeps({ app, chair: chair.chair, scratch }), runId: "run" });
    expect(result.chair.restarts.map((attempt) => `${attempt.alias} ${attempt.outcome}`)).toEqual([
      "claude-1 ended",
      "claude-2 ended",
      "codex-1 restarted",
    ]);
    expect(result.chair.restarts[0]!.reason).toBe("the new chair was failed before it took the pin");
    expect(chair.retired).toEqual([
      "fresh-supervisor-handoff-9041: the new chair was failed before it took the pin",
      "fresh-supervisor-handoff-9042: the new chair was failed before it took the pin",
    ]);
    expect(result.chair.reason).toBe("the supervisor restarted on Codex plan codex-1");
  });

  it("leaves a chair that took the pin and then ended lost: its row kept, no chair opened after it", async () => {
    const app = fakeApp({ behaviours: ALL_ANSWER });
    const { scratch } = fakeScratch();
    const opens = { "claude-1": "takes-pin-then-ends", "claude-2": "takes-pin", "codex-1": "takes-pin" } as const;
    const chair = fakeChair({ app, opens, reading: DOWN });
    const result = await runRecoveryPass({ deps: passDeps({ app, chair: chair.chair, scratch }), runId: "run" });
    expect(result.chair).toEqual({
      outcome: "not-restarted",
      reason:
        "the desktop app no longer runs the supervisor on app:old-chair; the last chair tried, on Claude plan claude-1, the new chair took the pin, then was failed",
      restarts: [
        {
          alias: "claude-1",
          outcome: "lost",
          reason: "the new chair took the pin, then was failed",
          sessionId: "chair-1",
          slug: "fresh-supervisor-handoff-9041",
          vendor: "claude",
        },
      ],
    });
    expect(chair.opened).toEqual(["claude-1"]);
    expect(chair.retired).toEqual([]);
  });

  it("calls a chair lost when it took the pin and then failed while Codex was still being checked", async () => {
    const app = fakeApp({ behaviours: ALL_ANSWER });
    const { scratch } = fakeScratch();
    const chair = fakeChair({ app, opens: { "claude-1": "takes-pin" }, reading: DOWN });
    const evidence: RecoveryPassDeps["evidence"] = async ({ vendor }) => {
      if (vendor === "claude") {
        return CLAUDE;
      }
      const index = app.sessions.findIndex((session) => session.sessionId === "chair-1");
      app.sessions[index] = { ...app.sessions[index]!, state: "failed" };
      return CODEX;
    };
    const deps = passDeps({ app, chair: chair.chair, evidence, scratch });
    const result = await runRecoveryPass({ deps, runId: "run" });
    expect(result.chair.restarts.map((attempt) => `${attempt.outcome}: ${attempt.reason}`)).toEqual([
      "lost: the new chair took the pin, then was failed",
    ]);
    expect(result.chair.outcome).toBe("not-restarted");
    expect(chair.opened).toEqual(["claude-1"]);
    expect(chair.retired).toEqual([]);
  });

  it("leaves a chair still running at the deadline starting, and opens nothing beside it", async () => {
    const app = fakeApp({ behaviours: ALL_ANSWER });
    const { scratch } = fakeScratch();
    const chair = fakeChair({ app, opens: { "claude-1": "silent" }, reading: DOWN });
    const result = await runRecoveryPass({ deps: passDeps({ app, chair: chair.chair, scratch }), runId: "run" });
    expect(result.chair.outcome).toBe("starting");
    expect(result.chair.reason).toBe(
      "a new supervisor is starting on Claude plan claude-1: the new chair is running and has not taken the pin yet",
    );
    expect(chair.opened).toEqual(["claude-1"]);
    expect(chair.retired).toEqual([]);
    expect(app.opened).toEqual(["fleet-recovery:run:claude:claude-1"]);
    expect(result.attempts[1]!.reason).toBe("not tried: the check ran out of time");
  });

  it("opens no chair when too little of the pass is left for one to start", async () => {
    const app = fakeApp({ behaviours: ALL_ANSWER });
    const { scratch } = fakeScratch();
    const chair = fakeChair({ app, opens: { "claude-1": "takes-pin" }, reading: DOWN });
    const evidence: RecoveryPassDeps["evidence"] = async ({ vendor }) => {
      if (vendor === "claude") {
        app.clock.ms += RECOVERY_PASS_MS - 250_000;
        return CLAUDE;
      }
      return CODEX;
    };
    const deps = passDeps({ app, chair: chair.chair, evidence, scratch });
    const result = await runRecoveryPass({ deps, runId: "run" });
    expect(result.chair.restarts).toEqual([
      {
        alias: "claude-1",
        outcome: "deadline",
        reason: "not tried: too little time was left for a chair to start",
        vendor: "claude",
      },
    ]);
    expect(result.chair.outcome).toBe("not-restarted");
    expect(chair.opened).toEqual([]);
  });

  it("opens no chair when no plan answers, and says the supervisor stayed down", async () => {
    const app = fakeApp({ behaviours: { "claude-1": "wrong", "claude-2": "wrong", "codex-1": "wrong" } });
    const { scratch } = fakeScratch();
    const chair = fakeChair({ app, reading: DOWN });
    const result = await runRecoveryPass({ deps: passDeps({ app, chair: chair.chair, scratch }), runId: "run" });
    expect(result.chair).toEqual({
      outcome: "not-restarted",
      reason:
        "the desktop app no longer runs the supervisor on app:old-chair, and no plan passed the check, so no chair was opened",
      restarts: [],
    });
    expect(chair.opened).toEqual([]);
  });

  it("opens no second chair while one is already starting", async () => {
    const app = fakeApp({ behaviours: ALL_ANSWER });
    const { scratch } = fakeScratch();
    const reading: RecoveryChairReading = {
      kind: "booting",
      label: "app:chair-9",
      slug: "fresh-supervisor-handoff-9044",
    };
    const chair = fakeChair({ app, reading });
    const result = await runRecoveryPass({ deps: passDeps({ app, chair: chair.chair, scratch }), runId: "run" });
    expect(result.chair).toEqual({
      outcome: "starting",
      reason:
        "a supervisor is already starting on app:chair-9 (fresh-supervisor-handoff-9044), so no second one was opened",
      restarts: [],
    });
    expect(chair.opened).toEqual([]);
  });

  it("restarts nothing when the supervisor could not be read, and says why", async () => {
    const app = fakeApp({ behaviours: ALL_ANSWER });
    const { scratch } = fakeScratch();
    const why = "the supervisor pin could not be read: its file is not JSON";
    const chair = fakeChair({ app, reading: { kind: "unknown", why } });
    const result = await runRecoveryPass({ deps: passDeps({ app, chair: chair.chair, scratch }), runId: "run" });
    expect(result.chair).toEqual({ outcome: "not-restarted", reason: why, restarts: [] });
    expect(chair.opened).toEqual([]);
    expect(result.status).toBe("passed");
  });
});
