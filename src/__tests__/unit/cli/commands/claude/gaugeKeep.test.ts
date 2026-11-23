/**
 * What `claude gauge` keeps of a sweep, over a real temporary home: the chair's own reading is kept as a usage
 * snapshot beside the plans', because a paused plan the chair still spends is judged by the running-seat gate too.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { readClaudePlanUsageSnapshot } from "../../../../../claude/planUsageSnapshotStore.js";
import { keepSweepReadings } from "../../../../../cli/commands/claude/gaugeKeep.js";
import { unwrap } from "../../../../../lib/result.js";
import { WEEKLY_WINDOW } from "../../../../../plans/usageLimit.js";

const NOW = "2026-11-05T12:00:00.000Z";
const WEEK = { resetAtIso: "2026-11-08T12:00:00.000Z", status: "allowed", utilization: 0.42 } as const;

let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "sw-gauge-keep-"));
});

afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

describe("keepSweepReadings", () => {
  it("keeps the chair's own reading as that plan's usage snapshot", async () => {
    const chairReading = {
      alias: "chair-plan",
      allowance: WEEKLY_WINDOW,
      observedAtIso: NOW,
      sevenDay: WEEK,
      usageLimitPercent: 50,
    } as const;
    await keepSweepReadings({
      chairProbe: { chairReading },
      configured: [],
      gauges: [],
      home,
      nowIso: NOW,
      probes: [],
    });
    // The snapshot keeps the READING; the plan's policy is the register's, read beside it, never frozen here.
    expect(unwrap(readClaudePlanUsageSnapshot({ alias: "chair-plan", home }))).toStrictEqual({
      alias: "chair-plan",
      observedAtIso: NOW,
      sevenDay: WEEK,
    });
  });

  it("writes no snapshot when the sweep read nothing", async () => {
    await keepSweepReadings({ chairProbe: {}, configured: [], gauges: [], home, nowIso: NOW, probes: [] });
    expect(unwrap(readClaudePlanUsageSnapshot({ alias: "chair-plan", home }))).toBeUndefined();
  });
});
