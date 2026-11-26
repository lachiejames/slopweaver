/**
 * The last look a Recovery pass takes at a chair it restarted, over the scripted app: still restarted only while the
 * pin names it and the app runs it, and left as it was when the app cannot be asked.
 */
import { describe, expect, it } from "vitest";

import type { RecoveryRestartAttempt } from "../../../fleet/recoveryChair.js";
import { reconfirmLastRestart } from "../../../fleet/recoveryRestart.js";
import { type FakeApp, fakeApp, fakeChair, fakeScratch, passDeps } from "./recoveryPassFixture.js";

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

  it("leaves the restart as it was when the app cannot be asked", async () => {
    const app = fakeApp({ behaviours: {}, listFails: true });
    const restarts = [RESTARTED];
    await reconfirmLastRestart({ deps: depsWith({ app }), restarts });
    expect(restarts).toEqual([RESTARTED]);
  });
});
