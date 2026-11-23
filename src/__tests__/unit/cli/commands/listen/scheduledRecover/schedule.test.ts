/**
 * `listen recover --scheduled`'s cycle — waiting for the due instant, and the deadline winning the race. Every
 * case waits a bounded few real milliseconds, still exercising the actual `waitChunked` timer path, just not for
 * long. A real temp home, plain fake Slack API + write transport, an injected clock; never a real network call.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { runScheduledRecover } from "../../../../../../cli/commands/listen/scheduledRecover.js";
import { EXIT_EXPECTED_EMPTY, EXIT_OK } from "../../../../../../cli/exitCodes.js";
import { writeRecoverySweepState } from "../../../../../../live/listen/recoverScheduleStore.js";
import { BASE_OPTIONS, fakeTransport, NOW_MS } from "../scheduledRecoverFakes.js";
import { emptyApi } from "./harness.js";

describe("runScheduledRecover", () => {
  let home: string;
  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "slop-scheduled-recover-"));
  });
  afterEach(() => {
    rmSync(home, { force: true, recursive: true });
  });

  it("waits for the due instant, then sweeps once it arrives", async () => {
    writeRecoverySweepState({
      home,
      state: { completedThroughTs: "1786600000.000000", nextDueAtIso: "2026-08-13T12:00:00.010Z", version: 1 },
    });
    let ticks = 0;

    const code = await runScheduledRecover({
      ...BASE_OPTIONS,
      api: emptyApi(),
      home,
      nowMs: () => NOW_MS + Math.min(ticks++ * 5, 10),
      transport: fakeTransport({ calls: [] }),
    });

    expect(code).toBe(EXIT_EXPECTED_EMPTY);
  });

  it("prints a clock-wake object and returns EXIT_OK when the deadline wins the race", async () => {
    writeRecoverySweepState({
      home,
      state: { completedThroughTs: "1786600000.000000", nextDueAtIso: "2026-08-13T12:10:00.000Z", version: 1 },
    });
    let ticks = 0;

    const code = await runScheduledRecover({
      ...BASE_OPTIONS,
      api: emptyApi(),
      deadlineMs: NOW_MS + 5,
      home,
      nowMs: () => NOW_MS + Math.min(ticks++ * 3, 6),
      transport: fakeTransport({ calls: [] }),
    });

    expect(code).toBe(EXIT_OK);
  });
});
