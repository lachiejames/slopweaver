import { describe, expect, it } from "vitest";
import { buildMachineCapacityReport } from "../../../../../live/machine/capacity.js";
import { machineCapacityJson } from "../../../../../live/machine/capacityRender.js";
import {
  DEFAULT_SEGMENTS_HOLD_PCT,
  DEFAULT_SWAPFILE_HOLD_COUNT,
} from "../../../../../live/machine/capacityThresholds.js";
import { HEALTHY_GAUGES, NO_DISPATCH, SAMPLE_SWAP_TEXT } from "./fixtures.js";

describe("machineCapacityJson", () => {
  it("flattens swap and the hold gauge onto the top level, per the machine-readable contract", () => {
    const report = buildMachineCapacityReport({
      ...HEALTHY_GAUGES,
      comms: [],
      processes: [],
      swapText: SAMPLE_SWAP_TEXT,
      topText: "Load Avg: 1.0, 1.0, 1.0 \nPID    MEM  \n",
    });
    const json = machineCapacityJson({ dispatch: NO_DISPATCH, report });
    expect(json.swapUsedGb).toBe(6.2);
    expect(json.swapTotalGb).toBe(4);
    expect(json.segmentsUsed).toBe(182_761);
    expect(json.segmentsLimit).toBe(1_234_946);
    expect(json.segmentsPct).toBe(15);
    expect(json.compressedPagesPct).toBe(4);
    expect(json.swapfileCount).toBe(3);
    expect(json.hold).toBe(false);
    expect(json.segmentsHoldPct).toBe(DEFAULT_SEGMENTS_HOLD_PCT);
    expect(json.swapfileHoldCount).toBe(DEFAULT_SWAPFILE_HOLD_COUNT);
    expect([DEFAULT_SEGMENTS_HOLD_PCT, DEFAULT_SWAPFILE_HOLD_COUNT]).toEqual([40, 12]);
    expect(json.loadHold).toBe(45);
    expect(json.load).toEqual({ load1: 1, load15: 1, load5: 1 });
    expect(json.graded).toEqual(["memory", "cpu"]);
    expect(json.ungraded).toEqual([]);
    expect(json.holdSubjects).toEqual([]);
  });
});
