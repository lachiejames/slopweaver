/**
 * The console check's decision: one slow answer is not a dead console, two failed reads in a row are, and a console
 * answering at another address is taken as it is.
 */
import { describe, expect, it } from "vitest";

import { CONSOLE_FAILURES_BEFORE_RECOVERY, decideConsoleCheck } from "../../src/consoleHealth";

const expectedEndpoint = "http://localhost:3000";

describe("decideConsoleCheck", () => {
  it("does nothing when the console answers where it is held", () => {
    const decision = decideConsoleCheck({
      consecutiveFailures: 0,
      expectedEndpoint,
      observation: { endpoint: expectedEndpoint, kind: "answered" },
    });
    expect(decision).toEqual({ action: { kind: "none" }, consecutiveFailures: 0 });
  });

  it("waits out the first failed read rather than recovering a console that is serving", () => {
    const decision = decideConsoleCheck({ consecutiveFailures: 0, expectedEndpoint, observation: { kind: "failed" } });
    expect(decision).toEqual({ action: { kind: "none" }, consecutiveFailures: 1 });
  });

  it("recovers on the second failed read in a row, and starts a fresh run", () => {
    const decision = decideConsoleCheck({ consecutiveFailures: 1, expectedEndpoint, observation: { kind: "failed" } });
    expect(decision).toEqual({ action: { kind: "recover" }, consecutiveFailures: 0 });
    expect(CONSOLE_FAILURES_BEFORE_RECOVERY).toBe(2);
  });

  it("takes a failed read after a recovery as the first of a new run", () => {
    const recovered = decideConsoleCheck({ consecutiveFailures: 1, expectedEndpoint, observation: { kind: "failed" } });
    const next = decideConsoleCheck({
      consecutiveFailures: recovered.consecutiveFailures,
      expectedEndpoint,
      observation: { kind: "failed" },
    });
    expect(next).toEqual({ action: { kind: "none" }, consecutiveFailures: 1 });
  });

  it("forgets a failed read once the console answers again", () => {
    const decision = decideConsoleCheck({
      consecutiveFailures: 1,
      expectedEndpoint,
      observation: { endpoint: expectedEndpoint, kind: "answered" },
    });
    expect(decision).toEqual({ action: { kind: "none" }, consecutiveFailures: 0 });
  });

  it("adopts a console answering at another address instead of recovering it", () => {
    const decision = decideConsoleCheck({
      consecutiveFailures: 1,
      expectedEndpoint,
      observation: { endpoint: "http://localhost:3001", kind: "answered" },
    });
    expect(decision).toEqual({
      action: { endpoint: "http://localhost:3001", kind: "adopt" },
      consecutiveFailures: 0,
    });
  });
});
