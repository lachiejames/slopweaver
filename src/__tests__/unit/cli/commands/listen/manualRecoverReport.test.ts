/**
 * The manual recovery pass's pure output and exit policy — a decision that was once wrong,
 * isolated so it can be asserted directly rather than inferred from a whole sweep.
 *
 * `src/__tests__/unit/cli/commands/listen/recover.test.ts` drives the same policy through the REAL verb over
 * a fake `SlackApi`; that is the wiring witness. This file is the truth table.
 */
import { describe, expect, it } from "vitest";

import {
  discoveryFailureOutput,
  manualRecoverExitCode,
  manualRecoverOutput,
  renderCoverage,
} from "../../../../../cli/commands/listen/manualRecoverReport.js";
import { EXIT_ERROR, EXIT_EXPECTED_EMPTY, EXIT_OK } from "../../../../../cli/exitCodes.js";
import type { RecoveryReport, RecoveryVerdict } from "../../../../../live/listen/recover.js";
import type { RecoverSlackAsksResult } from "../../../../../live/listen/recoverScan.js";
import type { RecoveryChannelExclusion, RecoveryCoverageFailure } from "../../../../../live/listen/recoverShared.js";

/** Every exclusion reason a report can carry, all zero — the shape `recoveryReport` always emits. */
const NO_EXCLUSIONS: RecoveryReport["excludedBy"] = {
  "already-answered": 0,
  "already-resolved": 0,
  "already-worked": 0,
  "answered-in-thread": 0,
  "blocked-on-human": 0,
  "deliberately-ignored": 0,
  "deliberately-ignored-conversation": 0,
  "in-flight": 0,
  "not-addressed": 0,
  "terminal-lifecycle": 0,
  "too-old": 0,
  "wrong-place": 0,
};

/** One survivor, carrying only what these assertions read. */
const SURVIVOR = { candidate: { messageTs: "1786400000.000300" } } as unknown as RecoveryVerdict;

/** A scan result with everything defaulted to a clean, complete single-channel pass. */
function scanResult({
  excludedChannels = [],
  failures = [],
  recoverable = [],
  requestedChannels = 1,
  scannedChannels = 1,
}: {
  excludedChannels?: readonly RecoveryChannelExclusion[];
  failures?: readonly RecoveryCoverageFailure[];
  recoverable?: readonly RecoveryVerdict[];
  requestedChannels?: number;
  scannedChannels?: number;
}): RecoverSlackAsksResult {
  return {
    excludedChannels,
    failures,
    report: { excludedBy: NO_EXCLUSIONS, recoverable, verdicts: [] },
    requestedChannels,
    scannedChannels,
  };
}

describe("manualRecoverOutput", () => {
  it("is complete only when every requested channel was read and nothing was skipped", () => {
    const output = manualRecoverOutput({ scan: scanResult({ requestedChannels: 3, scannedChannels: 3 }) });

    expect(output.completeness).toBe("complete");
    expect(output.requestedChannels).toBe(3);
    expect(output.scannedChannels).toBe(3);
  });

  it("is partial when it requested NOTHING, because zero of zero read is arithmetically a perfect pass", () => {
    const output = manualRecoverOutput({ scan: scanResult({ requestedChannels: 0, scannedChannels: 0 }) });

    expect(output.completeness).toBe("partial");
    expect(manualRecoverExitCode({ output })).toBe(EXIT_ERROR);
  });

  it("is partial when an exclusion left a requested channel unread", () => {
    const output = manualRecoverOutput({
      scan: scanResult({
        excludedChannels: [{ channel: "C_BAD", reason: "not-a-member" }],
        requestedChannels: 2,
        scannedChannels: 1,
      }),
    });

    expect(output.completeness).toBe("partial");
    expect(output.excludedChannels).toEqual([{ channel: "C_BAD", reason: "not-a-member" }]);
  });

  it("is partial when a retryable failure left a requested channel unread", () => {
    const output = manualRecoverOutput({
      scan: scanResult({
        failures: [{ channel: "C_SLOW", reason: "ratelimited", stage: "history" }],
        requestedChannels: 2,
        scannedChannels: 1,
      }),
    });

    expect(output.completeness).toBe("partial");
    expect(output.failures).toEqual([{ channel: "C_SLOW", reason: "ratelimited", stage: "history" }]);
  });

  it("carries the report's own excludedBy and recoverable through unchanged", () => {
    const output = manualRecoverOutput({ scan: scanResult({ recoverable: [SURVIVOR] }) });

    expect(output.excludedBy).toBe(NO_EXCLUSIONS);
    expect(output.recoverable).toEqual([SURVIVOR]);
  });
});

describe("manualRecoverExitCode", () => {
  it("exits OK for a complete pass with survivors", () => {
    const output = manualRecoverOutput({ scan: scanResult({ recoverable: [SURVIVOR] }) });

    expect(manualRecoverExitCode({ output })).toBe(EXIT_OK);
  });

  it("exits EXPECTED_EMPTY for a complete pass that proved there is nothing to recover", () => {
    const output = manualRecoverOutput({ scan: scanResult({}) });

    expect(manualRecoverExitCode({ output })).toBe(EXIT_EXPECTED_EMPTY);
  });

  it("exits ERROR for a partial pass with nothing found — the case that used to read as all clear", () => {
    const output = manualRecoverOutput({
      scan: scanResult({
        excludedChannels: [{ channel: "C_BAD", reason: "not-a-member" }],
        requestedChannels: 2,
        scannedChannels: 1,
      }),
    });

    expect(manualRecoverExitCode({ output })).toBe(EXIT_ERROR);
  });

  it("exits ERROR for a partial pass even when it DID find survivors — coverage outranks findings", () => {
    const output = manualRecoverOutput({
      scan: scanResult({
        excludedChannels: [{ channel: "C_BAD", reason: "gone" }],
        recoverable: [SURVIVOR],
        requestedChannels: 2,
        scannedChannels: 1,
      }),
    });

    expect(manualRecoverExitCode({ output })).toBe(EXIT_ERROR);
    expect(output.recoverable).toEqual([SURVIVOR]);
  });
});

describe("renderCoverage", () => {
  it("leads with the counts and says nothing more when the pass was complete", () => {
    const output = manualRecoverOutput({ scan: scanResult({ requestedChannels: 4, scannedChannels: 4 }) });

    expect(renderCoverage({ output })).toEqual(["complete: read 4 of 4 requested channel(s)"]);
  });

  it("tells a reader a re-run cannot fix a membership exclusion, and CAN fix a failure", () => {
    const output = manualRecoverOutput({
      scan: scanResult({
        excludedChannels: [{ channel: "C_BAD", reason: "not-a-member" }],
        failures: [{ channel: "C_SLOW", reason: "ratelimited", stage: "history" }],
        requestedChannels: 3,
        scannedChannels: 1,
      }),
    });

    expect(renderCoverage({ output })).toEqual([
      "partial: read 1 of 3 requested channel(s)",
      "  NOT READ C_BAD (not-a-member) — invite the bot, or drop it from --channels; a re-run alone changes nothing",
      "  NOT READ C_SLOW (history) — ratelimited; a re-run may well read it",
    ]);
  });

  it("names the thread a thread-stage failure was reading", () => {
    const output = manualRecoverOutput({
      scan: scanResult({
        failures: [{ channel: "C1", messageTs: "1786400000.000100", reason: "ratelimited", stage: "thread" }],
        requestedChannels: 1,
        scannedChannels: 0,
      }),
    });

    expect(renderCoverage({ output })[1]).toBe(
      "  NOT READ C1 thread 1786400000.000100 (thread) — ratelimited; a re-run may well read it",
    );
  });

  it("says which channel is gone rather than claiming it was deleted", () => {
    const output = manualRecoverOutput({
      scan: scanResult({ excludedChannels: [{ channel: "C_GONE", reason: "gone" }], scannedChannels: 0 }),
    });

    expect(renderCoverage({ output })[1]).toBe(
      "  NOT READ C_GONE (gone) — the channel is gone or invisible to this token — check the id, or drop it from --channels; a re-run alone changes nothing",
    );
  });
});

describe("discoveryFailureOutput", () => {
  const WALK_FAILED = "listing conversations failed: ratelimited";

  it("is partial with nothing requested and nothing read, so no count can read as a clean sweep", () => {
    const output = discoveryFailureOutput({ reason: WALK_FAILED });

    expect(output.completeness).toBe("partial");
    expect(output.requestedChannels).toBe(0);
    expect(output.scannedChannels).toBe(0);
    expect(output.recoverable).toEqual([]);
    expect(output.excludedChannels).toEqual([]);
  });

  it("names the DISCOVERY stage, so a reader learns which read was lost rather than only that one was", () => {
    expect(discoveryFailureOutput({ reason: WALK_FAILED }).failures).toEqual([
      { reason: WALK_FAILED, stage: "discovery" },
    ]);
  });

  it("carries every exclusion at zero rather than an empty tally a consumer would have to guess at", () => {
    const { excludedBy } = discoveryFailureOutput({ reason: WALK_FAILED });

    expect(excludedBy["wrong-place"]).toBe(0);
    expect(Object.values(excludedBy).filter((count) => count !== 0)).toEqual([]);
    expect(Object.keys(excludedBy).length).toBeGreaterThan(0);
  });

  it("exits 1 and renders through the same coverage lines any other partial pass does", () => {
    const output = discoveryFailureOutput({ reason: WALK_FAILED });

    expect(manualRecoverExitCode({ output })).toBe(EXIT_ERROR);
    expect(renderCoverage({ output })).toEqual([
      "partial: read 0 of 0 requested channel(s)",
      `  NOT READ the workspace (discovery) — ${WALK_FAILED}; a re-run may well read it`,
    ]);
  });
});
