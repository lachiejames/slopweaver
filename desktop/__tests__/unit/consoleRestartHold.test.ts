/**
 * The restart hold: a console that stopped answering is waited out as an update's restart for one window from the
 * first failed read, and raised past it — never held for a checkout problem no update can fix.
 */
import { describe, expect, it } from "vitest";

import { consoleOutageEntry, outageStart, RESTART_HOLD_MS, restartHoldVerdict } from "../../src/consoleRestartHold";
import { CheckoutErrors, ConsoleErrors } from "../../src/errors";

const unreachable = ConsoleErrors.unreachable({
  detail: "The operation was aborted due to timeout",
  endpoint: "http://localhost:3000",
});
const since = 1_000_000;

describe("outageStart", () => {
  it("starts an outage now when none is recorded", () => {
    expect(outageStart({ nowMs: since + 5, outageSinceMs: undefined })).toBe(since + 5);
  });

  it("keeps the first sign of trouble once one is recorded", () => {
    expect(outageStart({ nowMs: since + RESTART_HOLD_MS, outageSinceMs: since })).toBe(since);
  });

  it("keeps a recorded start of zero rather than treating it as absent", () => {
    expect(outageStart({ nowMs: since, outageSinceMs: 0 })).toBe(0);
  });
});

describe("restartHoldVerdict", () => {
  it("holds a console that stopped answering a moment ago", () => {
    expect(restartHoldVerdict({ failure: unreachable, nowMs: since, outageSinceMs: since })).toBe("hold");
  });

  it("holds until one millisecond before the window ends", () => {
    const nowMs = since + RESTART_HOLD_MS - 1;
    expect(restartHoldVerdict({ failure: unreachable, nowMs, outageSinceMs: since })).toBe("hold");
  });

  it("raises exactly at the window's end, and after it", () => {
    expect(restartHoldVerdict({ failure: unreachable, nowMs: since + RESTART_HOLD_MS, outageSinceMs: since })).toBe(
      "raise",
    );
    expect(restartHoldVerdict({ failure: unreachable, nowMs: since + RESTART_HOLD_MS * 2, outageSinceMs: since })).toBe(
      "raise",
    );
  });

  it("raises a missing or invalid checkout at once, since no update brings one back", () => {
    expect(restartHoldVerdict({ failure: CheckoutErrors.unset(), nowMs: since, outageSinceMs: since })).toBe("raise");
    expect(
      restartHoldVerdict({ failure: CheckoutErrors.invalid({ path: "/tmp/x" }), nowMs: since, outageSinceMs: since }),
    ).toBe("raise");
  });

  it("holds a script failure inside the window, since --serve during a swap fails the same way", () => {
    const failure = ConsoleErrors.noEndpoint({ output: "docs-site: the production console on :3000 is DOWN" });
    expect(restartHoldVerdict({ failure, nowMs: since + 1_000, outageSinceMs: since })).toBe("hold");
  });
});

describe("consoleOutageEntry", () => {
  const atMs = Date.parse("2026-11-01T05:40:06.500Z");

  it("measures a held outage from its first failed read, naming why", () => {
    expect(
      consoleOutageEntry({
        atMs,
        nowMs: since + 6_500,
        outageSinceMs: since,
        outcome: "held",
        problem: unreachable.message,
      }),
    ).toEqual({
      atIso: "2026-11-01T05:40:06.500Z",
      downMs: 6_500,
      kind: "console-outage",
      outcome: "held",
      problem: "http://localhost:3000 did not answer: The operation was aborted due to timeout",
    });
  });

  it("stamps the wall clock while measuring the outage on the monotonic one", () => {
    const entry = consoleOutageEntry({ atMs, nowMs: 42_000, outageSinceMs: 30_000, outcome: "back" });
    expect(entry.atIso).toBe("2026-11-01T05:40:06.500Z");
    expect(entry.downMs).toBe(12_000);
  });

  it("carries no problem once the console is back", () => {
    const entry = consoleOutageEntry({ atMs, nowMs: since + 19_000, outageSinceMs: since, outcome: "back" });
    expect(entry.problem).toBe(null);
    expect(entry.downMs).toBe(19_000);
  });

  it("never reports a negative outage", () => {
    expect(consoleOutageEntry({ atMs, nowMs: since - 5, outageSinceMs: since, outcome: "raised" }).downMs).toBe(0);
  });
});
