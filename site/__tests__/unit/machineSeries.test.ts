/*
 * The machine charts' arithmetic: where a sample sits, a stretch nobody measured drawn as a gap, the ceilings, the
 * hold's marker, and one session's trace off the card's session id.
 */
import { describe, expect, it } from "vitest";

import {
  ageWordsOf,
  bandPath,
  clockLabel,
  cpuTopOf,
  endWordOf,
  frameOf,
  holdMarkerOf,
  IDLE_HOLD_FLOOR_PCT,
  joinWordsOf,
  linePath,
  loadHoldOf,
  loadTopOf,
  type MachineLoadHold,
  type MachineSample,
  type MachineSeries,
  runsOf,
  sampleHeld,
  startWordOf,
  xOf,
  yOf,
} from "../../lib/machineSeries";

/** A sample at an instant, with a load and an optional session's CPU. */
function sampleAt({
  iso,
  load1 = 10,
  sessionCpu,
  idlePct,
}: {
  iso: string;
  load1?: number;
  sessionCpu?: number;
  idlePct?: number;
}): MachineSample {
  const sessions = [];
  if (sessionCpu !== undefined) {
    sessions.push({ cpuPct: sessionCpu, memoryBytes: 1024 ** 3, processCount: 3, sessionId: "s1" });
  }
  return {
    cores: 15,
    cpu: { fleetPct: 300, otherPct: 200, ...(idlePct === undefined ? {} : { idlePct }) },
    load: { holdAt: 22, load1 },
    memory: { compressorSegmentsPct: 15, swapTotalGb: 3, swapUsedGb: 1, totalBytes: 48, usedBytes: 40 },
    observedAtIso: iso,
    sessions,
    topOtherCpu: [],
    topOtherMemory: [],
  };
}

/** A window over these samples, ending at the newest. */
function seriesOf({
  samples,
  hold = { kind: "clear" },
}: {
  samples: readonly MachineSample[];
  hold?: MachineLoadHold;
}): MachineSeries {
  return {
    currentLoadHold: hold,
    minimumSampleGapSeconds: 30,
    observedAtIso: samples.at(-1)!.observedAtIso,
    samples,
    windowSeconds: 3600,
  };
}

describe("frame and position", () => {
  const series = seriesOf({ samples: [sampleAt({ iso: "2026-10-17T21:00:00.000Z" })] });
  const frame = frameOf({ height: 100, series, width: 360 });

  it("spans the hour ending at the newest sample", () => {
    expect(xOf({ frame, iso: "2026-10-17T21:00:00.000Z" })).toBe(360);
    expect(xOf({ frame, iso: "2026-10-17T20:30:00.000Z" })).toBe(180);
    expect(xOf({ frame, iso: "2026-10-17T19:00:00.000Z" })).toBe(0);
  });

  it("puts zero on the floor and the ceiling at the top, clamped", () => {
    expect(yOf({ frame, top: 20, value: 0 })).toBe(100);
    expect(yOf({ frame, top: 20, value: 10 })).toBe(50);
    expect(yOf({ frame, top: 20, value: 40 })).toBe(0);
  });
});

describe("runsOf", () => {
  it("breaks the line where samples sit more than four gaps apart", () => {
    const series = seriesOf({
      samples: [
        sampleAt({ iso: "2026-10-17T20:00:00.000Z" }),
        sampleAt({ iso: "2026-10-17T20:02:00.000Z" }),
        sampleAt({ iso: "2026-10-17T20:04:01.000Z" }),
        sampleAt({ iso: "2026-10-17T20:04:40.000Z" }),
      ],
    });
    expect(runsOf({ series }).map((run) => run.length)).toEqual([2, 2]);
  });
});

describe("endWordOf", () => {
  const series = seriesOf({ samples: [sampleAt({ iso: "2026-10-17T21:04:00.000Z" })] });

  it("says now only while a sample stays under a minute old until the next clock read, and dates an older one", () => {
    const at = Date.parse("2026-10-17T21:04:00.000Z");
    expect(endWordOf({ nowMs: at + 49_999, series, timeZone: "Australia/Sydney" })).toBe("now");
    expect(endWordOf({ nowMs: at + 50_000, series, timeZone: "Australia/Sydney" })).toBe("at 08:04");
    expect(endWordOf({ nowMs: at + 2 * 3_600_000, series, timeZone: "Australia/Sydney" })).toBe("at 08:04");
  });

  it("dates a sample the wall clock has stepped back behind, by any amount", () => {
    const at = Date.parse("2026-10-17T21:04:00.000Z");
    expect(endWordOf({ nowMs: at, series, timeZone: "Australia/Sydney" })).toBe("now");
    expect(endWordOf({ nowMs: at - 1, series, timeZone: "Australia/Sydney" })).toBe("at 08:04");
    expect(endWordOf({ nowMs: at - 2 * 3_600_000, series, timeZone: "Australia/Sydney" })).toBe("at 08:04");
  });
});

describe("startWordOf", () => {
  it("dates the window's start on the owner's clock, an hour before the newest sample", () => {
    const series = seriesOf({ samples: [sampleAt({ iso: "2026-10-17T20:00:00.000Z" })] });
    expect(startWordOf({ series, timeZone: "UTC" })).toBe("from 19:00");
    expect(startWordOf({ series, timeZone: "Australia/Sydney" })).toBe("from 06:00");
  });
});

describe("ageWordsOf", () => {
  const series = seriesOf({ samples: [sampleAt({ iso: "2026-10-17T21:04:00.000Z" })] });
  const at = Date.parse("2026-10-17T21:04:00.000Z");
  it("words a past sample's age off the clock it is given, and dates one any amount ahead of it", () => {
    expect(ageWordsOf({ iso: series.observedAtIso, nowMs: at + 14_000, timeZone: "UTC" })).toBe("14s ago");
    expect(ageWordsOf({ iso: series.observedAtIso, nowMs: at + 2 * 3_600_000, timeZone: "UTC" })).toBe("2.0h ago");
    expect(ageWordsOf({ iso: series.observedAtIso, nowMs: at, timeZone: "UTC" })).toBe("just now");
    expect(ageWordsOf({ iso: series.observedAtIso, nowMs: at - 1, timeZone: "UTC" })).toBe(
      "stamped 21:04, ahead of this clock",
    );
    expect(ageWordsOf({ iso: series.observedAtIso, nowMs: at - 29_999, timeZone: "UTC" })).toBe(
      "stamped 21:04, ahead of this clock",
    );
  });
});

describe("joinWordsOf", () => {
  const base = seriesOf({ samples: [sampleAt({ iso: "2026-10-17T21:00:00.000Z" })] });

  it("says the longest stretch still drawn as a line, the bound runsOf splits on", () => {
    expect(joinWordsOf({ series: base })).toBe("two minutes");
    expect(joinWordsOf({ series: { ...base, minimumSampleGapSeconds: 15 } })).toBe("a minute");
    expect(joinWordsOf({ series: { ...base, minimumSampleGapSeconds: 45 } })).toBe("3 minutes");
    expect(joinWordsOf({ series: { ...base, minimumSampleGapSeconds: 20 } })).toBe("80 seconds");
  });
});

describe("paths", () => {
  it("draws a lone sample as a short dash rather than nothing", () => {
    expect(linePath({ points: [{ x: 10, y: 5 }] })).toBe("M9,5L11,5");
    expect(linePath({ points: [] })).toBe("");
  });

  it("closes a band back along its lower edge", () => {
    const d = bandPath({
      lower: [
        { x: 0, y: 10 },
        { x: 5, y: 10 },
      ],
      upper: [
        { x: 0, y: 2 },
        { x: 5, y: 4 },
      ],
    });
    expect(d).toBe("M0,2L5,4L5,10L0,10Z");
  });
});

describe("ceilings", () => {
  it("draws CPU against the cores, or more when the sums ran past them", () => {
    const series = seriesOf({ samples: [sampleAt({ iso: "2026-10-17T21:00:00.000Z" })] });
    expect(cpuTopOf({ series })).toBe(15);
    const busy = { ...sampleAt({ iso: "2026-10-17T21:00:00.000Z" }), cpu: { fleetPct: 1200, otherPct: 500 } };
    expect(cpuTopOf({ series: seriesOf({ samples: [busy] }) })).toBe(17);
  });

  it("draws load with headroom over the hold, or up to the highest load", () => {
    expect(loadTopOf({ series: seriesOf({ samples: [sampleAt({ iso: "2026-10-17T21:00:00.000Z" })] }) })).toBe(28);
    const high = sampleAt({ iso: "2026-10-17T21:00:00.000Z", load1: 40.2 });
    expect(loadTopOf({ series: seriesOf({ samples: [high] }) })).toBe(41);
  });
});

describe("holdMarkerOf", () => {
  const samples = [sampleAt({ iso: "2026-10-17T20:30:00.000Z" }), sampleAt({ iso: "2026-10-17T21:00:00.000Z" })];

  it("marks nothing when the load is under the hold", () => {
    const series = seriesOf({ samples });
    const frame = frameOf({ height: 100, series, width: 360 });
    expect(holdMarkerOf({ frame, series, timeZone: "UTC" })).toBe(undefined);
  });

  it("marks where a hold inside the window began, on the owner's clock", () => {
    const series = seriesOf({ hold: { kind: "since", startedAtIso: "2026-10-17T20:30:00.000Z" }, samples });
    const frame = frameOf({ height: 100, series, width: 360 });
    expect(holdMarkerOf({ frame, series, timeZone: "UTC" })).toEqual({ words: "held since 20:30", x: 180 });
  });

  it("draws no line when every sample kept is held, and claims no start before the oldest", () => {
    const series = seriesOf({
      hold: { kind: "before-window", oldestObservedAtIso: "2026-10-17T20:30:00.000Z" },
      samples,
    });
    const frame = frameOf({ height: 100, series, width: 360 });
    expect(holdMarkerOf({ frame, series, timeZone: "UTC" })).toEqual({
      words: "held since at least 20:30, the oldest sample kept",
      x: undefined,
    });
  });

  it("marks where a hold was first seen after a gap, and claims no earlier start", () => {
    const series = seriesOf({ hold: { earliestHeldIso: "2026-10-17T20:30:00.000Z", kind: "after-gap" }, samples });
    const frame = frameOf({ height: 100, series, width: 360 });
    expect(holdMarkerOf({ frame, series, timeZone: "UTC" })).toEqual({
      words: "held since at least 20:30, unsampled before it",
      x: 180,
    });
  });
});

describe("sampleHeld", () => {
  const held = ({ idlePct, load1 }: { idlePct?: number; load1: number }): boolean =>
    sampleHeld({
      sample: sampleAt({ ...(idlePct === undefined ? {} : { idlePct }), iso: "2026-10-17T21:00:00.000Z", load1 }),
    });

  it("opens with the same 20% floor the verb holds on", () => {
    expect(IDLE_HOLD_FLOOR_PCT).toBe(20);
  });

  it("holds on a load at its hold of 22 with idle unread, which is how an older sample is judged", () => {
    expect(held({ load1: 22 })).toBe(true);
    expect(held({ load1: 21.99 })).toBe(false);
  });

  it("clears a load over its hold at 20% idle or more, and holds it under the floor", () => {
    expect(held({ idlePct: 50, load1: 30 })).toBe(false);
    expect(held({ idlePct: 20, load1: 30 })).toBe(false);
    expect(held({ idlePct: 19.9, load1: 30 })).toBe(true);
  });

  it("never holds a load under its hold, however busy the CPU reads", () => {
    expect(held({ idlePct: 1, load1: 21.99 })).toBe(false);
  });
});

describe("loadHoldOf", () => {
  const at = (iso: string): string => `2026-10-17T${iso}.000Z`;

  it("is clear for a newest sample over its hold at 50% idle", () => {
    const samples = [
      sampleAt({ idlePct: 5, iso: at("20:59:30"), load1: 30 }),
      sampleAt({ idlePct: 50, iso: at("21:00:00"), load1: 30 }),
    ];
    expect(loadHoldOf({ minimumSampleGapSeconds: 30, samples })).toEqual({ kind: "clear" });
  });

  it("dates a hold from the first sample under the idle floor, not from the first load over the hold", () => {
    const samples = [
      sampleAt({ idlePct: 50, iso: at("20:59:00"), load1: 30 }),
      sampleAt({ idlePct: 10, iso: at("20:59:30"), load1: 30 }),
      sampleAt({ idlePct: 10, iso: at("21:00:00"), load1: 30 }),
    ];
    expect(loadHoldOf({ minimumSampleGapSeconds: 30, samples })).toEqual({
      kind: "since",
      startedAtIso: at("20:59:30"),
    });
  });

  it("holds on load alone for samples that carry no idle,", () => {
    const samples = [sampleAt({ iso: at("21:00:00"), load1: 30 })];
    expect(loadHoldOf({ minimumSampleGapSeconds: 30, samples })).toEqual({
      kind: "before-window",
      oldestObservedAtIso: at("21:00:00"),
    });
  });
});

describe("clockLabel", () => {
  it("prints the instant on the zone it is given", () => {
    expect(clockLabel({ iso: "2026-10-17T20:44:30.000Z", timeZone: "UTC" })).toBe("20:44");
    expect(clockLabel({ iso: "2026-10-17T20:44:30.000Z", timeZone: "Australia/Sydney" })).toBe("07:44");
  });
});
