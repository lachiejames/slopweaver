import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { diagnoseClientFailure, readClientFailureFacts } from "../../../browser/clientKill.js";
import { BrowserTransportErrors } from "../../../browser/pageTransport.js";
import { clientFailure } from "../../../browser/relaySession.js";
import {
  noteRelayRecovery,
  relayRecoveryCount,
  takeRelayRecoveries,
  takeWalkStops,
  withWalkStopNoted,
} from "../../../browser/walkStops.js";
import { err, ok } from "../../../lib/result.js";

/**
 * The register is process-scoped by construction, and the unit lane reuses one worker across files
 * (`isolate: false`), so each case STARTS from an empty register as well as leaving one. MEASURED:
 * draining only afterwards, the first case failed three runs of `--shard=1/12` and `--shard=1/24` on five stops
 * an earlier file's relay-lease tests had noted and never taken.
 */
function drainRegisters(): void {
  takeWalkStops();
  takeRelayRecoveries();
}

beforeEach(drainRegisters);
afterEach(drainRegisters);

describe("withWalkStopNoted", () => {
  it("notes a lost session and hands the same failure back unchanged", () => {
    const failure = err(BrowserTransportErrors.sessionLost({ reason: "Target page has been closed" }));
    const passed = withWalkStopNoted({ result: failure });
    expect(passed).toBe(failure);
    expect(takeWalkStops()).toEqual([
      "the browser session driving this walk is no longer usable: Target page has been closed",
    ]);
  });

  it("notes a detached transport, which is how a walk that lost the relay lease reaches zero pages", () => {
    withWalkStopNoted({
      result: err(BrowserTransportErrors.unavailable({ reason: "another walk holds the relay lease" })),
    });
    expect(takeWalkStops()).toEqual(["no browser transport is attached: another walk holds the relay lease"]);
  });

  it("notes an off-lease address, because that walk stops rather than asking for the next page", () => {
    withWalkStopNoted({
      result: err(
        BrowserTransportErrors.offLeaseOrigin({
          reason: "the hex walk may only address app.hex.tech",
          url: "https://linear.app/x",
        }),
      ),
    });
    expect(takeWalkStops().length).toBe(1);
  });

  it("ignores a navigation that failed, which costs one page and is the walk's own to record", () => {
    withWalkStopNoted({
      result: err(
        BrowserTransportErrors.navigationFailed({
          because: "the fake reported this page unreachable",
          reason: "HTTP 404",
          url: "https://app.hex.tech/x",
        }),
      ),
    });
    expect(takeWalkStops()).toEqual([]);
  });

  // The whole chain the finding `the-chrome-browser-walk-toolchain-is-version-skewed` escaped, composed out
  // of the real functions: what `playwright-core` throws -> the facts read off it -> the diagnosis -> the
  // grade -> this register, which is what `live/resync/outcome.ts` drains to fail an attempt. Asserting the
  // grade alone would have passed too; only this end says the resync judge SEES it.
  it("notes a version-skewed client, which a whole linear resync once reported as SUCCEEDED", () => {
    const thrown = {
      status: 1,
      stderr:
        "Error: Client is v1.62.1, session 'chrome' is v1.63.0. Run\n\n  playwright-cli -s=chrome open\n\nto restart the browser session.",
      stdout: "",
    };
    const graded = clientFailure({
      diagnosis: diagnoseClientFailure({
        boundMs: 80_000,
        elapsedMs: 1_200,
        facts: readClientFailureFacts({ error: thrown }),
      }),
      reason: "Command failed: node /var/folders/2g/T/slopweaver-page-walk-xk3f/client.cjs -s=chrome run-code",
      url: "https://linear.app/settings/members",
    });

    withWalkStopNoted({ result: err(graded) });

    expect(graded.code).toBe("SESSION_LOST");
    expect(takeWalkStops()).toEqual([
      "the browser session driving this walk is no longer usable: the browser client exited with status 1 " +
        "after 1.2s, after printing 124 byte(s); it said the client is older than the relay daemon it was " +
        "asked to drive, which that daemon refuses for every call until the session is restarted",
    ]);
  });

  it("notes nothing for a visit that worked", () => {
    const capture = ok("a capture");
    expect(withWalkStopNoted({ result: capture })).toBe(capture);
    expect(takeWalkStops()).toEqual([]);
  });
});

describe("takeWalkStops", () => {
  it("deduplicates the same stop, which a sticky session answers once per remaining page", () => {
    const failure = err(BrowserTransportErrors.sessionLost({ reason: "Session closed" }));
    withWalkStopNoted({ result: failure });
    withWalkStopNoted({ result: failure });
    withWalkStopNoted({ result: failure });
    expect(takeWalkStops()).toEqual(["the browser session driving this walk is no longer usable: Session closed"]);
  });

  it("forgets what it handed over, so the next attempt is not charged for this one", () => {
    withWalkStopNoted({ result: err(BrowserTransportErrors.sessionLost({ reason: "Session closed" })) });
    expect(takeWalkStops().length).toBe(1);
    expect(takeWalkStops()).toEqual([]);
  });

  it("keeps two different stops, in the order they were first seen", () => {
    withWalkStopNoted({ result: err(BrowserTransportErrors.sessionLost({ reason: "Session closed" })) });
    withWalkStopNoted({ result: err(BrowserTransportErrors.unavailable({ reason: "no lease" })) });
    expect(takeWalkStops()).toEqual([
      "the browser session driving this walk is no longer usable: Session closed",
      "no browser transport is attached: no lease",
    ]);
  });
});

/**
 * The recovered-drop register, and the one property that makes it a second register rather than a flag.
 *
 * A stop FAILS a resync attempt (`live/resync/outcome.ts`); a recovery must not, or the reconnect that let a
 * 251-page walk finish would still report it as a walk that stopped part way. So the two never leak into
 * each other, and the case below is the falsifiable witness of that: both are noted, both are taken, and
 * each register is asserted to hold only its own.
 */
describe("noteRelayRecovery", () => {
  it("keeps a recovery out of the stop register, which is what stops a completed walk failing its resync", () => {
    noteRelayRecovery({ reason: "the relay dropped the call while it was in flight" });
    withWalkStopNoted({ result: err(BrowserTransportErrors.sessionLost({ reason: "Session closed" })) });

    expect(takeRelayRecoveries()).toEqual(["the relay dropped the call while it was in flight"]);
    expect(takeWalkStops()).toEqual(["the browser session driving this walk is no longer usable: Session closed"]);
  });

  it("deduplicates the same drop, and forgets what it handed over", () => {
    noteRelayRecovery({ reason: "the relay detached from the browser" });
    noteRelayRecovery({ reason: "the relay detached from the browser" });

    expect(takeRelayRecoveries()).toEqual(["the relay detached from the browser"]);
    expect(takeRelayRecoveries()).toEqual([]);
  });

  it("keeps two different drops in the order they were first seen", () => {
    noteRelayRecovery({ reason: "the relay dropped the call while it was in flight" });
    noteRelayRecovery({ reason: "the relay detached from the browser" });

    expect(takeRelayRecoveries()).toEqual([
      "the relay dropped the call while it was in flight",
      "the relay detached from the browser",
    ]);
  });
});

describe("relayRecoveryCount", () => {
  it("counts what is outstanding without draining it, so a walk's progress line cannot rob the runner", () => {
    expect(relayRecoveryCount()).toBe(0);
    noteRelayRecovery({ reason: "the relay dropped the call while it was in flight" });

    expect(relayRecoveryCount()).toBe(1);
    expect(relayRecoveryCount()).toBe(1);
    expect(takeRelayRecoveries()).toEqual(["the relay dropped the call while it was in flight"]);
    expect(relayRecoveryCount()).toBe(0);
  });

  it("counts REBUILDS, not distinct messages — the measured drop prints the same diagnosis every time", () => {
    noteRelayRecovery({ reason: "Error: Session closed" });
    noteRelayRecovery({ reason: "Error: Session closed" });
    noteRelayRecovery({ reason: "Error: Session closed" });

    expect(relayRecoveryCount()).toBe(3);
    expect(takeRelayRecoveries()).toEqual(["Error: Session closed"]);
    expect(relayRecoveryCount()).toBe(0);
  });
});
