/**
 * The locked read-sample-rewrite of the `machine series` ring, over fixture seams and a temp home: a fresh ring
 * prints without `top`, a due one appends, and a failed read is named, never written as zeros.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../../lib/result.js";
import { type MachineSeriesError, MachineSeriesErrors } from "../../../../live/machine/seriesErrors.js";
import { refreshMachineSeries, takeMachineSeriesSample } from "../../../../live/machine/seriesRead.js";
import { readMachineSeries } from "../../../../live/machine/seriesStore.js";
import { fixtureDeps, TOTAL_MEMORY_BYTES, VM_STAT_USED_BYTES } from "./seriesFixtures.js";

let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "series-read-"));
});

afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

describe("takeMachineSeriesSample", () => {
  it("names each read that failed", () => {
    const { deps } = fixtureDeps();
    const nowIso = (): string => "2026-10-17T20:00:00.000Z";
    const failed = (over: Partial<typeof deps>): MachineSeriesError =>
      unwrapErr(takeMachineSeriesSample({ deps: { ...deps, ...over }, nowIso }));
    expect(failed({ top: () => undefined })).toEqual(MachineSeriesErrors.readFailed({ read: "top" }));
    expect(failed({ processes: () => undefined })).toEqual(MachineSeriesErrors.readFailed({ read: "ps" }));
    expect(failed({ comms: () => undefined })).toEqual(MachineSeriesErrors.readFailed({ read: "comm" }));
    expect(failed({ cores: () => undefined })).toEqual(MachineSeriesErrors.readFailed({ read: "cores" }));
    expect(failed({ compressorSysctl: () => "nothing" })).toEqual(
      MachineSeriesErrors.readFailed({ read: "compressor" }),
    );
    expect(failed({ swapUsage: () => undefined })).toEqual(MachineSeriesErrors.readFailed({ read: "swap" }));
    expect(failed({ vmStat: () => undefined })).toEqual(MachineSeriesErrors.readFailed({ read: "vm_stat" }));
    expect(failed({ vmStat: () => "Pages free: 1.\n" })).toEqual(
      MachineSeriesErrors.vmStatIncomplete({ field: "page size" }),
    );
    expect(failed({ totalMemory: () => undefined })).toEqual(MachineSeriesErrors.readFailed({ read: "memory" }));
    expect(failed({ top: () => "Processes: 1 total\n" })).toEqual(MachineSeriesErrors.topNoSecondSample());
  });

  it("stamps the sample with the clock read after its reads", () => {
    const { deps } = fixtureDeps();
    const sample = unwrap(takeMachineSeriesSample({ deps, nowIso: () => "2026-10-17T20:00:01.000Z" }));
    expect(sample.observedAtIso).toBe("2026-10-17T20:00:01.000Z");
    expect(sample.memory.compressorSegmentsPct).toBe(50);
    expect(sample.memory.swapUsedGb).toBe(1.5);
    expect(sample.memory.usedBytes).toBe(VM_STAT_USED_BYTES);
    expect(sample.memory.totalBytes).toBe(TOTAL_MEMORY_BYTES);
  });
});

describe("refreshMachineSeries", () => {
  it("samples an empty ring, reuses a fresh one, and appends once the gap has passed", async () => {
    const { deps, topCalls } = fixtureDeps();
    let now = "2026-10-17T20:00:00.000Z";
    const nowIso = (): string => now;

    const first = unwrap(await refreshMachineSeries({ deps, home, nowIso }));
    expect(first.samples.length).toBe(1);
    expect(topCalls()).toBe(1);

    now = "2026-10-17T20:00:29.000Z";
    const cached = unwrap(await refreshMachineSeries({ deps, home, nowIso }));
    expect(cached.observedAtIso).toBe("2026-10-17T20:00:00.000Z");
    expect(topCalls()).toBe(1);

    now = "2026-10-17T20:00:30.000Z";
    const due = unwrap(await refreshMachineSeries({ deps, home, nowIso }));
    expect(due.samples.map((sample) => sample.observedAtIso)).toEqual([
      "2026-10-17T20:00:00.000Z",
      "2026-10-17T20:00:30.000Z",
    ]);
    expect(topCalls()).toBe(2);
    expect(unwrap(readMachineSeries({ home })).length).toBe(2);
  });

  it("writes nothing when the sample failed", async () => {
    const { deps } = fixtureDeps();
    const result = await refreshMachineSeries({
      deps: { ...deps, top: () => undefined },
      home,
      nowIso: () => "2026-10-17T20:00:00.000Z",
    });
    expect(unwrapErr(result).code).toBe("SAMPLE_READ_FAILED");
    expect(unwrap(readMachineSeries({ home }))).toEqual([]);
  });

  it("costs one top for two concurrent callers", async () => {
    const { deps, topCalls } = fixtureDeps();
    const nowIso = (): string => "2026-10-17T20:00:00.000Z";
    const [a, b] = await Promise.all([
      refreshMachineSeries({ deps, home, nowIso }),
      refreshMachineSeries({ deps, home, nowIso }),
    ]);
    expect(unwrap(a).samples.length).toBe(1);
    expect(unwrap(b).samples.length).toBe(1);
    expect(topCalls()).toBe(1);
  });
});
