/**
 * One whole Recovery pass over a scripted app: plain functions stand in for the desktop app, the scratch and the clock,
 * so what is under test is the order things happen in — leftovers closed first, one session at a time, a plan's
 * fallback, and the stop when a session cannot be proven gone.
 */
import { describe, expect, it } from "vitest";
import { RECOVERY_PASS_MS, type RecoveryEvidence, type RecoveryVendor } from "../../../fleet/recoveryCheck.js";
import { runRecoveryPass } from "../../../fleet/recoveryPass.js";
import type {
  RecoveryHost,
  RecoveryPassDeps,
  RecoveryScratch,
  RecoverySession,
} from "../../../fleet/recoveryPassDeps.js";
import { err, ok } from "../../../lib/result.js";
import type { AppSessionSnapshot } from "../../../sessionHarness/appProtocol.js";

const START_MS = Date.parse("2026-11-25T10:00:00.000Z");
const SCRATCH = "/home/sessions/recovery-scratch";

/** What a scripted plan does once its session opens. */
type Behaviour = "answers" | "wrong" | "hangs" | "refused" | "unanswered" | "close-fails";

/** The scripted app and what it saw. */
interface FakeApp {
  readonly host: RecoveryHost;
  /** The ledger key of every launch, in order. */
  readonly opened: string[];
  /** The id of every session closed, in order. */
  readonly closed: string[];
  readonly clock: { ms: number };
}

/** The answer a prompt asks for: its bracketed halves, joined. */
function joinedHalves({ prompt }: { prompt: string }): string {
  return [...prompt.matchAll(/\[([0-9a-f]+)\]/gu)].map((match) => match[1]!).join("");
}

/** A session as the app would list it once its turn is over, or still running for a plan that hangs. */
function snapshotOf({
  behaviour,
  directory,
  ledgerKey,
  openedAtIso,
  prompt,
  sessionId,
  vendor,
}: {
  behaviour: Behaviour;
  directory: string;
  ledgerKey: string;
  openedAtIso: string;
  prompt: string;
  sessionId: string;
  vendor: RecoveryVendor;
}): AppSessionSnapshot {
  const base = {
    directory,
    handle: `app:${sessionId}`,
    lastSubmittedText: prompt,
    ledgerKey,
    openedAtIso,
    sessionId,
    title: "Recovery check",
    vendor,
  };
  if (behaviour === "hangs") {
    return { ...base, state: "running" };
  }
  if (behaviour === "wrong") {
    return { ...base, lastAgentText: "API Error: 401", state: "idle" };
  }
  return { ...base, lastAgentText: joinedHalves({ prompt }), state: "idle" };
}

/** An app whose plans behave as scripted, already holding `standing`, its ledger holding `leftOpen` open. */
function fakeApp({
  behaviours,
  leftOpen = [],
  listFails = false,
  standing = [],
}: {
  behaviours: Readonly<Record<string, Behaviour>>;
  leftOpen?: readonly RecoverySession[];
  listFails?: boolean;
  standing?: readonly AppSessionSnapshot[];
}): FakeApp {
  const clock = { ms: START_MS };
  const sessions: AppSessionSnapshot[] = [...standing];
  const aliases = new Map<string, string>();
  const opened: string[] = [];
  const closed: string[] = [];
  const host: RecoveryHost = {
    close: async ({ session }) => {
      const alias = aliases.get(session.sessionId);
      if (alias !== undefined && behaviours[alias] === "close-fails") {
        return err("the app did not answer close");
      }
      closed.push(session.sessionId);
      const index = sessions.findIndex((snapshot) => snapshot.sessionId === session.sessionId);
      if (index >= 0) {
        sessions[index] = { ...sessions[index]!, state: "closed" };
      }
      return ok(undefined);
    },
    leftOpen: () => ok(leftOpen),
    list: async () => {
      if (listFails) {
        return err("the desktop app is not running");
      }
      return ok([...sessions]);
    },
    open: async ({ candidate, directory, ledgerKey, openedAtIso, prompt }) => {
      opened.push(ledgerKey);
      const behaviour = behaviours[candidate.alias]!;
      if (behaviour === "refused") {
        return err({ message: `the credential gate refused ${candidate.alias}: its week is spent` });
      }
      if (behaviour === "unanswered") {
        return err({ message: "the desktop app did not answer launch.prepare within 180s", unanswered: true });
      }
      const sessionId = `s-${String(opened.length)}`;
      aliases.set(sessionId, candidate.alias);
      sessions.push(
        snapshotOf({ behaviour, directory, ledgerKey, openedAtIso, prompt, sessionId, vendor: candidate.vendor }),
      );
      return ok({ handle: `app:${sessionId}`, sessionId });
    },
  };
  return { clock, closed, host, opened };
}

/** A scratch that records what it made and how often it was cleared. */
function fakeScratch(): { scratch: RecoveryScratch; made: string[]; clears: { count: number } } {
  const made: string[] = [];
  const clears = { count: 0 };
  const scratch: RecoveryScratch = {
    clear: () => {
      clears.count += 1;
      return ok(undefined);
    },
    holds: ({ directory }) => directory.startsWith(`${SCRATCH}/`),
    make: ({ attemptId }) => {
      made.push(attemptId);
      return ok(`${SCRATCH}/${attemptId}/fleet-recovery`);
    },
  };
  return { clears, made, scratch };
}

const CLAUDE: RecoveryEvidence = {
  candidates: [
    { alias: "claude-1", storeDir: "/s/one", vendor: "claude" },
    { alias: "claude-2", storeDir: "/s/two", vendor: "claude" },
  ],
  excluded: [],
  vendor: "claude",
};

const CODEX: RecoveryEvidence = {
  candidates: [{ alias: "codex-1", codexHome: "/c/one", vendor: "codex" }],
  excluded: [],
  vendor: "codex",
};

/** A byte source whose every call is a new fill byte, as `randomBytes` would differ. */
function countingBytes(): (size: number) => Buffer {
  let call = 0;
  return (size) => {
    call += 1;
    return Buffer.alloc(size, call);
  };
}

/** The pass's deps over a fake app, each moment between looks one second on its clock. */
function passDeps({
  app,
  evidence = async ({ vendor }) => (vendor === "claude" ? CLAUDE : CODEX),
  lockHeld = () => true,
  scratch,
}: {
  app: FakeApp;
  evidence?: RecoveryPassDeps["evidence"];
  lockHeld?: () => boolean;
  scratch: RecoveryScratch;
}): RecoveryPassDeps {
  return {
    evidence,
    host: app.host,
    lockHeld,
    nowMs: () => app.clock.ms,
    pause: async () => {
      app.clock.ms += 1000;
    },
    randomBytes: countingBytes(),
    scratch,
  };
}

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

  it("reports the app unreachable as the check failing, not as either vendor failing", async () => {
    const app = fakeApp({ behaviours: {}, listFails: true });
    const { scratch } = fakeScratch();
    const result = await runRecoveryPass({ deps: passDeps({ app, scratch }), runId: "run" });
    expect(result.status).toBe("infrastructure-failed");
    expect(result.infrastructure).toBe("the desktop app is not running");
    expect(result.attempts).toEqual([]);
    expect(app.opened).toEqual([]);
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
