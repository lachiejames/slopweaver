/**
 * What a Recovery pass closes so no throwaway session outlives it, over the scripted app: only a session carrying a
 * Recovery key AND running in this home's scratch is the pass's own to close.
 */
import { describe, expect, it } from "vitest";

import { RECOVERY_KEY_PREFIX } from "../../../fleet/recoveryCheck.js";
import { settleLeftovers, settleRefusedLaunch } from "../../../fleet/recoveryLeftovers.js";
import type { AppSessionSnapshot } from "../../../sessionHarness/appProtocol.js";
import { fakeApp, fakeScratch, passDeps, SCRATCH } from "./recoveryPassFixture.js";

/** A session the app already runs. */
function standing({
  sessionId,
  ledgerKey,
  directory,
}: {
  sessionId: string;
  ledgerKey: string;
  directory: string;
}): AppSessionSnapshot {
  return {
    directory,
    handle: `app:${sessionId}`,
    ledgerKey,
    openedAtIso: "2026-11-25T09:00:00.000Z",
    sessionId,
    state: "running",
    title: "Recovery check",
    vendor: "claude",
  };
}

describe("settleLeftovers", () => {
  it("closes an earlier pass's session in this home's scratch, never one elsewhere, then clears the scratch", async () => {
    const app = fakeApp({
      behaviours: {},
      standing: [
        standing({ directory: `${SCRATCH}/a-1/x`, ledgerKey: `${RECOVERY_KEY_PREFIX}old`, sessionId: "mine" }),
        standing({ directory: "/elsewhere/a-1/x", ledgerKey: `${RECOVERY_KEY_PREFIX}old`, sessionId: "another-home" }),
        standing({ directory: `${SCRATCH}/a-2/x`, ledgerKey: "seat:work", sessionId: "a-seat" }),
      ],
    });
    const { scratch, clears } = fakeScratch();
    expect(await settleLeftovers({ deps: passDeps({ app, scratch }) })).toBe(undefined);
    expect(app.closed).toEqual(["mine"]);
    expect(clears.count).toBe(1);
  });

  it("says why when the app cannot be asked what it runs, and clears nothing", async () => {
    const app = fakeApp({ behaviours: {}, listFails: true });
    const { scratch, clears } = fakeScratch();
    expect(await settleLeftovers({ deps: passDeps({ app, scratch }) })).toBe("the desktop app is not running");
    expect(clears.count).toBe(0);
  });
});

describe("settleRefusedLaunch", () => {
  const base = { alias: "claude-1", attemptId: "run-1", vendor: "claude" } as const;

  it("records the refusal, and stops the pass when the app never answered the launch", async () => {
    const app = fakeApp({ behaviours: {} });
    const { scratch } = fakeScratch();
    const done = await settleRefusedLaunch({
      base,
      deps: passDeps({ app, scratch }),
      failure: { message: "the app did not answer launch.prepare within 180s", unanswered: true },
      ledgerKey: `${RECOVERY_KEY_PREFIX}run:claude:claude-1`,
    });
    expect(done).toEqual({
      attempt: { ...base, outcome: "launch-refused", reason: "the app did not answer launch.prepare within 180s" },
      infrastructure:
        "the app never answered the launch on claude-1, so its card may still open; the check stopped rather than open another beside it",
    });
  });

  it("closes a card a refused launch nonetheless opened under its own key", async () => {
    const ledgerKey = `${RECOVERY_KEY_PREFIX}run:claude:claude-1`;
    const app = fakeApp({
      behaviours: {},
      standing: [standing({ directory: `${SCRATCH}/run-1/x`, ledgerKey, sessionId: "straggler" })],
    });
    const { scratch } = fakeScratch();
    const done = await settleRefusedLaunch({
      base,
      deps: passDeps({ app, scratch }),
      failure: { message: "the credential gate refused claude-1" },
      ledgerKey,
    });
    expect(done).toEqual({
      attempt: { ...base, outcome: "launch-refused", reason: "the credential gate refused claude-1" },
    });
    expect(app.closed).toEqual(["straggler"]);
  });
});
