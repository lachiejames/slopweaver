/*
 * Rule 2 in the app harness: a session's worker may start only once its card is on screen, loaded, and showing THIS
 * session — each condition refused on its own.
 */
import { describe, expect, it } from "vitest";

import type { WorkerLaunchConfig } from "../../src/sessionWorker/workerWire";
import { type LeaseWindow, mintVisibleLease, visibleWorkerArgv } from "../../src/visibleSessionLease";

const CARD = "data:text/html,card";
const CONFIG: WorkerLaunchConfig = {
  adapterEntry: "/app/codex-acp.js",
  codexHome: "/home/codex-plan-1",
  codexPath: "/app/codex",
  directory: "/work/acme",
  sessionId: "0b5e",
  vendor: "codex",
};

function window(
  over: Partial<{ visible: boolean; loading: boolean; destroyed: boolean; url: string; sessionId: string }>,
): LeaseWindow {
  const state = { destroyed: false, loading: false, sessionId: CONFIG.sessionId, url: CARD, visible: true, ...over };
  return {
    isDestroyed: () => state.destroyed,
    isLoading: () => state.loading,
    isVisible: () => state.visible,
    sessionId: state.sessionId,
    shownUrl: () => state.url,
  };
}

function mint(over: Parameters<typeof window>[0]) {
  return mintVisibleLease({ cardUrl: CARD, config: CONFIG, window: window(over), workerEntry: "/app/worker.js" });
}

describe("mintVisibleLease", () => {
  it("leases a visible, loaded card showing this session, and the worker's argv is its entry alone", () => {
    const lease = mint({});
    expect(lease.isOk()).toBe(true);
    expect(visibleWorkerArgv({ lease: lease._unsafeUnwrap() })).toEqual(["/app/worker.js"]);
  });

  it("starts one worker per lease: a spent lease is refused", () => {
    const lease = mint({})._unsafeUnwrap();
    visibleWorkerArgv({ lease });
    expect(() => visibleWorkerArgv({ lease })).toThrow(
      "refused a worker launch: its lease was never minted from a visible card, or was already spent",
    );
  });

  it("refuses a lease built without minting, whatever its shape", () => {
    const forged = { config: CONFIG, workerEntry: "/app/worker.js" } as unknown as Parameters<
      typeof visibleWorkerArgv
    >[0]["lease"];
    expect(() => visibleWorkerArgv({ lease: forged })).toThrow(
      "refused a worker launch: its lease was never minted from a visible card, or was already spent",
    );
  });

  it("refuses a closed card", () => {
    expect(mint({ destroyed: true })._unsafeUnwrapErr()).toBe(
      "the session's card was closed before its worker could start",
    );
  });

  it("refuses a card that is not on screen", () => {
    expect(mint({ visible: false })._unsafeUnwrapErr()).toBe(
      "the session's card is not on screen, so its worker may not start",
    );
  });

  it("refuses a card still loading, or showing another page", () => {
    const why = "the session's card has not finished loading, so its Stop control is not shown yet";
    expect(mint({ loading: true })._unsafeUnwrapErr()).toBe(why);
    expect(mint({ url: "data:text/html,another" })._unsafeUnwrapErr()).toBe(why);
  });

  it("refuses another session's card, however visible and loaded", () => {
    expect(mint({ sessionId: "a11c" })._unsafeUnwrapErr()).toBe("the card on screen is session a11c's, not 0b5e's");
  });
});
