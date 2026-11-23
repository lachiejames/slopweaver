import { describe, expect, it } from "vitest";

import type { LiveMachineReading, LiveSessionUse } from "../../lib/liveMachine";
import { liveMachineViewOf, machineHoldsOf, sessionRowsOf } from "../../lib/liveMachineView";

const GIB = 1024 ** 3;
const AT = "2026-11-09T10:00:00.000Z";
const AT_MS = Date.parse(AT);

/** A machine with room: fifteen cores, load 20, 30 of 48 GB in use, Chrome the heaviest outsider. */
const READING: LiveMachineReading = {
  cores: 15,
  cpu: { busyCores: 6.04, fleetCores: 1.6, idlePct: 59.73, otherCores: 4.44 },
  diagnostics: [],
  load1: 20,
  memory: {
    compressorSegmentsPct: 12,
    fleetBytes: 12 * GIB,
    swapfileCount: 2,
    totalBytes: 48 * GIB,
    usedBytes: 30 * GIB,
  },
  observedAtIso: AT,
  sessions: [],
  topOtherCpu: { cpuCores: 2, label: "Google Chrome", memoryBytes: 3 * GIB },
  topOtherMemory: { cpuCores: 2, label: "Google Chrome", memoryBytes: 3 * GIB },
};

/** The view two seconds after the reading. */
const viewOf = ({ reading }: { reading: LiveMachineReading }) =>
  liveMachineViewOf({ held: { opening: false, reading, why: undefined }, nowMs: AT_MS + 2_000 });

describe("liveMachineViewOf", () => {
  it("draws nothing before a reading is held", () => {
    expect(liveMachineViewOf({ held: { opening: true, reading: undefined, why: undefined }, nowMs: AT_MS })).toBe(
      undefined,
    );
  });

  it("draws every meter out of its total, naming an outsider only where it outweighs the fleet", () => {
    const view = viewOf({ reading: READING })!;
    expect(view.freshness).toEqual({ tone: "live", words: "read 2s ago · every 2s" });
    expect(view.meters).toEqual([
      {
        detail: "fleet 1.6 · everything else 4.4 · free 9.0 · Google Chrome 2.0 cores, more than the whole fleet",
        label: "CPU",
        of: "of 15 cores busy",
        segments: [
          { pct: 10.7, tone: "fleet" },
          { pct: 29.3, tone: "other" },
        ],
        value: "6.0",
      },
      {
        detail: "fleet 12.0 GB · free 18.0 GB",
        label: "Memory",
        of: "of 48.0 GB used",
        segments: [
          { pct: 25, tone: "fleet" },
          { pct: 37.5, tone: "other" },
        ],
        value: "30.0",
      },
      {
        detail: "Work running or waiting for a core. It only holds when the CPU is also under 20% idle.",
        label: "Load",
        of: "holds new sessions at 45",
        segments: [{ pct: 44.4, tone: "fleet" }],
        value: "20.0",
      },
      {
        detail: "Counted from the processes themselves, so the count does not depend on cmux.",
        label: "Live sessions",
        of: "running now",
        segments: [],
        value: "0",
      },
    ]);
    expect(view.verdict).toEqual({
      tone: "room",
      words: "Room for more sessions on this machine: load 20.0 against the hold at 45, and 18.0 GB of memory free.",
    });
  });

  it("says CPU is still being measured on the first read", () => {
    const first: LiveMachineReading = {
      ...READING,
      cpu: { busyCores: undefined, fleetCores: undefined, idlePct: undefined, otherCores: undefined },
    };
    const cpu = viewOf({ reading: first })!.meters.at(0)!;
    expect(cpu.value).toBe("measuring");
    expect(cpu.segments).toEqual([]);
  });
});

describe("machineHoldsOf", () => {
  it("holds on load only when the CPU is also under its idle floor", () => {
    const busy = { ...READING, cpu: { ...READING.cpu, idlePct: 10 }, load1: 50 };
    expect(machineHoldsOf({ reading: busy })).toEqual(["load 50.0 at or over the hold at 45, with 10% idle CPU"]);
    expect(machineHoldsOf({ reading: { ...busy, cpu: { ...READING.cpu, idlePct: 40 } } })).toEqual([]);
  });

  it("holds on compressor segments and swapfiles at the supervisor's lines", () => {
    const pressed = { ...READING, memory: { ...READING.memory, compressorSegmentsPct: 40, swapfileCount: 12 } };
    expect(machineHoldsOf({ reading: pressed })).toEqual([
      "compressor at 40% of its segments limit, hold at 40%",
      "12 swapfiles, hold at 12",
    ]);
  });

  it("is unread when neither memory gauge read, and the verdict says so", () => {
    const unread = {
      ...READING,
      memory: { ...READING.memory, compressorSegmentsPct: undefined, swapfileCount: undefined },
    };
    expect(machineHoldsOf({ reading: unread })).toBe("unread");
    expect(viewOf({ reading: unread })!.verdict).toEqual({
      tone: "unread",
      words: "Whether this machine has room is not measured: neither memory pressure gauge read.",
    });
  });

  it("words a held verdict with every reason", () => {
    const held = {
      ...READING,
      cpu: { ...READING.cpu, idlePct: 10 },
      load1: 50,
      memory: { ...READING.memory, compressorSegmentsPct: 45 },
    };
    expect(viewOf({ reading: held })!.verdict).toEqual({
      tone: "held",
      words:
        "This machine holds new sessions: load 50.0 at or over the hold at 45, with 10% idle CPU; compressor at 45% of its segments limit, hold at 40%.",
    });
  });
});

describe("sessionRowsOf", () => {
  const session = ({ id, cpu, gb }: { id: string; cpu: number | undefined; gb: number }): LiveSessionUse => ({
    cpuCores: cpu,
    memoryBytes: gb * GIB,
    processCount: 1,
    sessionId: id,
  });

  it("shows the five heaviest by CPU, unmeasured last, then counts the rest", () => {
    const { rows, more } = sessionRowsOf({
      sessions: [
        session({ cpu: 0.1, gb: 1, id: "a" }),
        session({ cpu: undefined, gb: 9, id: "b" }),
        session({ cpu: 2.5, gb: 1, id: "c" }),
        session({ cpu: 0.1, gb: 2, id: "d" }),
        session({ cpu: 0, gb: 1, id: "e" }),
        session({ cpu: 0.95, gb: 1, id: "f" }),
        session({ cpu: 0, gb: 1, id: "g" }),
      ],
    });
    expect(rows).toEqual([
      { cpu: "2.50 cores", memory: "1.0 GB", sessionId: "c" },
      { cpu: "0.95 cores", memory: "1.0 GB", sessionId: "f" },
      { cpu: "0.10 cores", memory: "2.0 GB", sessionId: "d" },
      { cpu: "0.10 cores", memory: "1.0 GB", sessionId: "a" },
      { cpu: "0.00 cores", memory: "1.0 GB", sessionId: "e" },
    ]);
    expect(more).toBe(2);
  });

  it("is empty with no sessions", () => {
    expect(sessionRowsOf({ sessions: [] })).toEqual({ more: 0, rows: [] });
  });
});
