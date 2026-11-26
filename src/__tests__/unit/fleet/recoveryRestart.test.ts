/**
 * One chair restart, over the scripted app: a spawn that reports no chair is checked against what the app runs before
 * it counts as refused, and the last look still calls a chair restarted only while the pin names it and the app runs
 * it — never when the app cannot be asked.
 */
import { describe, expect, it } from "vitest";

import { type RecoveryRestartAttempt, restartFallsBack } from "../../../fleet/recoveryChair.js";
import { reconfirmLastRestart, restartChair } from "../../../fleet/recoveryRestart.js";
import { CLAUDE, type FakeApp, fakeApp, fakeChair, fakeScratch, passDeps } from "./recoveryPassFixture.js";

const RESTARTED: RecoveryRestartAttempt = {
  alias: "claude-1",
  outcome: "restarted",
  reason: "it took the supervisor pin",
  sessionId: "chair-1",
  vendor: "claude",
};

/** Deps over the app whose supervisor pin names `chair-1`. */
function depsWith({ app }: { app: FakeApp }): ReturnType<typeof passDeps> {
  const { chair } = fakeChair({ app, reading: { kind: "down", why: "no supervisor is pinned" } });
  return passDeps({
    app,
    chair: { ...chair, pin: () => ({ appSessionId: "chair-1", kind: "app" }) },
    scratch: fakeScratch().scratch,
  });
}

/** The app's listing of the chair. */
function chairListed({ state }: { state: "running" | "failed" }): FakeApp["sessions"][number] {
  return {
    directory: "/repo",
    handle: "app:chair-1",
    ledgerKey: "fresh-supervisor-handoff-9041",
    openedAtIso: "2026-11-25T10:01:00.000Z",
    sessionId: "chair-1",
    state,
    title: "Supervisor",
    vendor: "claude",
  };
}

describe("reconfirmLastRestart", () => {
  it("keeps a chair the pin still names and the app still runs restarted", async () => {
    const app = fakeApp({ behaviours: {}, standing: [chairListed({ state: "running" })] });
    const restarts = [RESTARTED];
    await reconfirmLastRestart({ deps: depsWith({ app }), restarts });
    expect(restarts).toEqual([RESTARTED]);
  });

  it("calls a chair that has failed since it took the pin lost", async () => {
    const app = fakeApp({ behaviours: {}, standing: [chairListed({ state: "failed" })] });
    const restarts = [RESTARTED];
    await reconfirmLastRestart({ deps: depsWith({ app }), restarts });
    expect(restarts).toEqual([
      { ...RESTARTED, outcome: "lost", reason: "the new chair took the pin, then was failed" },
    ]);
  });

  it("never reports a chair it could not re-check as restarted", async () => {
    const app = fakeApp({ behaviours: {}, listFails: true });
    const restarts = [RESTARTED];
    await reconfirmLastRestart({ deps: depsWith({ app }), restarts });
    expect(restarts).toEqual([
      {
        ...RESTARTED,
        outcome: "starting",
        reason:
          "it took the supervisor pin, but the app could not be asked again as the check ended: the desktop app is not running",
      },
    ]);
  });
});

describe("restartChair, a spawn that reports no chair", () => {
  /** One restart on claude-1 whose chair behaves as `behaviour`. */
  async function restartWith({
    behaviour,
  }: {
    behaviour: "unrecorded" | "unrecorded-app-gone";
  }): Promise<{ done: Awaited<ReturnType<typeof restartChair>>; retired: string[] }> {
    const app = fakeApp({ behaviours: {} });
    const chair = fakeChair({ app, opens: { "claude-1": behaviour }, reading: { kind: "down", why: "down" } });
    const deps = passDeps({ app, chair: chair.chair, scratch: fakeScratch().scratch });
    const done = await restartChair({
      candidate: CLAUDE.candidates[0]!,
      deps,
      predecessor: undefined,
      startedMs: app.clock.ms,
    });
    return { done, retired: chair.retired };
  }

  it("watches the chair the app runs under the doc's slug, and never closes its row", async () => {
    const { done, retired } = await restartWith({ behaviour: "unrecorded" });
    expect(done).toEqual({
      attempt: {
        alias: "claude-1",
        outcome: "restarted",
        reason: "it took the supervisor pin",
        sessionId: "chair-1",
        slug: "fresh-supervisor-handoff-9041",
        vendor: "claude",
      },
    });
    expect(retired).toEqual([]);
  });

  it("opens nothing more, and closes no row, when the app cannot be asked whether a chair opened", async () => {
    const { done, retired } = await restartWith({ behaviour: "unrecorded-app-gone" });
    expect(done).toEqual({
      attempt: {
        alias: "claude-1",
        outcome: "starting",
        reason:
          "the spawn reported no chair (the spawn exited 0 and the ledger names no open app session for fresh-supervisor-handoff-9041), and the app could not be asked whether one opened (the desktop app is not running), so nothing more was opened",
        slug: "fresh-supervisor-handoff-9041",
        vendor: "claude",
      },
    });
    expect(restartFallsBack({ attempt: done.attempt })).toBe(false);
    expect(retired).toEqual([]);
  });
});
