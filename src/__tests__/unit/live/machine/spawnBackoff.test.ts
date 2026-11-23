/**
 * The fleet-wide spawn backoff's pure half: the exponential held window, the recovery spacing
 * that halves per admission, the streak that resets after the load average's memory, and the cheap reading —
 * which never asks for `top` on a healthy machine and holds only where `./capacityHolds.ts` already would.
 */
import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../../lib/result.js";
import { parseSysctlLoadavg } from "../../../../live/machine/capacityParse.js";
import type { GradeReason } from "../../../../live/machine/capacityVerdict.js";
import {
  INITIAL_SPAWN_BACKOFF_STATE,
  parseSpawnBackoffState,
  type SpawnBackoffState,
  spawnAdmission,
  spawnBackoffLine,
  spawnBackoffSeconds,
  spawnBackoffStatus,
  spawnHoldReasons,
  spawnIdleSampleNeeded,
  spawnWindow,
} from "../../../../live/machine/spawnBackoff.js";

const T0 = "2026-10-22T09:00:00.000Z";
const CORES = 15;
const HEALTHY_COMPRESSOR = "vm.compressor.segment.total: 182761\nvm.compressor.segment.limit: 1234946\n";
const CPU_HOLD: readonly GradeReason[] = [{ subject: "cpu", text: "1-min load 46.5, hold at 45, 3% idle" }];
const BOOTS_HOLD: readonly GradeReason[] = [{ subject: "boots", text: "6 sessions booted in the last 3m" }];

/** An instant `seconds` after {@link T0}. */
function at({ seconds }: { seconds: number }): string {
  return new Date(Date.parse(T0) + seconds * 1000).toISOString();
}

/** A `top -l 2 -s 1` report whose final sample reads `idle` percent idle. */
function cpuSample({ idle }: { idle: number }): string {
  const sample = [
    "Processes: 1 total, 1 running, 0 sleeping, 10 threads ",
    `CPU usage: ${String(100 - idle)}% user, 0% sys, ${String(idle)}% idle `,
    "",
    "PID    %CPU",
    "100    50.0",
  ];
  return [...sample, ...sample, ""].join("\n");
}

/** The cheap reading over a healthy machine, with one gauge overridden. */
function reasonsWith(over: Partial<Parameters<typeof spawnHoldReasons>[0]>): readonly string[] {
  return spawnHoldReasons({
    compressorText: HEALTHY_COMPRESSOR,
    cores: CORES,
    cpuSampleText: undefined,
    elapsedRows: [],
    loadText: "{ 6.08 6.37 7.76 }",
    processes: [],
    sessions: [],
    swapfileCount: 3,
    ...over,
  }).map((reason) => `${reason.subject}: ${reason.text}`);
}

describe("spawnBackoffSeconds", () => {
  it("doubles from 10s per consecutive held reading and caps at the load average's 3τ", () => {
    expect([1, 2, 3, 4, 5, 6, 7].map((consecutiveHolds) => spawnBackoffSeconds({ consecutiveHolds }))).toStrictEqual([
      10, 20, 40, 80, 160, 180, 180,
    ]);
  });

  it("is zero with no held reading", () => {
    expect(spawnBackoffSeconds({ consecutiveHolds: 0 })).toBe(0);
  });
});

describe("spawnWindow", () => {
  it("is open on a fresh install", () => {
    expect(spawnWindow({ bootsBypassed: false, nowIso: T0, state: INITIAL_SPAWN_BACKOFF_STATE })).toStrictEqual({
      kind: "open",
    });
  });

  it("is closed inside a held window and open at its end", () => {
    const held = spawnAdmission({ nowIso: T0, reasons: CPU_HOLD, state: INITIAL_SPAWN_BACKOFF_STATE }).nextState;

    expect(spawnWindow({ bootsBypassed: false, nowIso: at({ seconds: 9 }), state: held })).toStrictEqual({
      holdSubjects: ["cpu"],
      kind: "closed",
      untilIso: at({ seconds: 10 }),
      why: "held",
    });
    expect(spawnWindow({ bootsBypassed: false, nowIso: at({ seconds: 10 }), state: held })).toStrictEqual({
      kind: "open",
    });
  });

  it("opens a window held on boots alone when the boot-burst hatch is set, and no other", () => {
    const boots = spawnAdmission({ nowIso: T0, reasons: BOOTS_HOLD, state: INITIAL_SPAWN_BACKOFF_STATE }).nextState;
    const both = spawnAdmission({
      nowIso: T0,
      reasons: [...BOOTS_HOLD, ...CPU_HOLD],
      state: INITIAL_SPAWN_BACKOFF_STATE,
    }).nextState;

    expect(spawnWindow({ bootsBypassed: true, nowIso: at({ seconds: 1 }), state: boots }).kind).toBe("open");
    expect(spawnWindow({ bootsBypassed: true, nowIso: at({ seconds: 1 }), state: both }).kind).toBe("closed");
  });

  it("spaces admissions after a hold by the recovery gap", () => {
    const state: SpawnBackoffState = { ...INITIAL_SPAWN_BACKOFF_STATE, admitGapSeconds: 90, lastAdmitIso: T0 };

    expect(spawnWindow({ bootsBypassed: false, nowIso: at({ seconds: 89 }), state })).toStrictEqual({
      holdSubjects: [],
      kind: "closed",
      untilIso: at({ seconds: 90 }),
      why: "recovery",
    });
    expect(spawnWindow({ bootsBypassed: false, nowIso: at({ seconds: 90 }), state }).kind).toBe("open");
  });
});

describe("spawnAdmission", () => {
  it("admits a clear reading on a healthy machine without spacing the next spawn at all", () => {
    const decision = spawnAdmission({ nowIso: T0, reasons: [], state: INITIAL_SPAWN_BACKOFF_STATE });

    expect(decision).toStrictEqual({
      kind: "admit",
      nextState: { admitGapSeconds: 0, consecutiveHolds: 0, holdSubjects: [], lastAdmitIso: T0, retryAtIso: undefined },
    });
    expect(spawnWindow({ bootsBypassed: false, nowIso: T0, state: decision.nextState }).kind).toBe("open");
  });

  it("escalates each held reading taken at the end of the last window", () => {
    let state = INITIAL_SPAWN_BACKOFF_STATE;
    let now = T0;
    const windows: number[] = [];
    for (let reading = 0; reading < 7; reading += 1) {
      const decision = spawnAdmission({ nowIso: now, reasons: CPU_HOLD, state });
      expect(decision.kind).toBe("held");
      state = decision.nextState;
      windows.push(state.admitGapSeconds);
      now = state.retryAtIso!; // a held state always carries its retry instant
    }

    expect(windows).toStrictEqual([10, 20, 40, 80, 160, 180, 180]);
    expect(state.consecutiveHolds).toBe(7);
  });

  it("starts again at the base when the last held window ended more than 180s ago", () => {
    const first = spawnAdmission({ nowIso: T0, reasons: CPU_HOLD, state: INITIAL_SPAWN_BACKOFF_STATE }).nextState;
    const stillOn = spawnAdmission({ nowIso: at({ seconds: 10 + 180 }), reasons: CPU_HOLD, state: first });
    const fresh = spawnAdmission({ nowIso: at({ seconds: 10 + 181 }), reasons: CPU_HOLD, state: first });

    expect(stillOn.nextState.consecutiveHolds).toBe(2);
    expect(fresh.nextState.consecutiveHolds).toBe(1);
    expect(fresh.nextState.admitGapSeconds).toBe(10);
  });

  it("halves the recovery gap per admission after a long hold, to zero under the base", () => {
    let state: SpawnBackoffState = {
      admitGapSeconds: 180,
      consecutiveHolds: 6,
      holdSubjects: ["cpu"],
      lastAdmitIso: undefined,
      retryAtIso: T0,
    };
    const gaps: number[] = [];
    for (let admission = 0; admission < 5; admission += 1) {
      state = spawnAdmission({ nowIso: T0, reasons: [], state }).nextState;
      gaps.push(state.admitGapSeconds);
    }

    expect(gaps).toStrictEqual([90, 45, 22, 11, 0]);
  });

  it("names each held subject once", () => {
    const decision = spawnAdmission({
      nowIso: T0,
      reasons: [...CPU_HOLD, ...CPU_HOLD, ...BOOTS_HOLD],
      state: INITIAL_SPAWN_BACKOFF_STATE,
    });

    expect(decision.nextState.holdSubjects).toStrictEqual(["cpu", "boots"]);
  });
});

describe("parseSpawnBackoffState", () => {
  it("round-trips a written state", () => {
    const state: SpawnBackoffState = {
      admitGapSeconds: 40,
      consecutiveHolds: 3,
      holdSubjects: ["memory"],
      lastAdmitIso: T0,
      retryAtIso: at({ seconds: 40 }),
    };

    expect(unwrap(parseSpawnBackoffState({ value: JSON.parse(JSON.stringify(state)) }))).toStrictEqual(state);
  });

  it("refuses a malformed document rather than reading it as nothing held", () => {
    const parsed = parseSpawnBackoffState({ value: { admitGapSeconds: -1, consecutiveHolds: 0, holdSubjects: [] } });

    expect(unwrapErr(parsed)).toStrictEqual(["admitGapSeconds: Too small: expected number to be >=0"]);
  });

  it("refuses a held streak with no retry instant, which would otherwise read as an open door", () => {
    const parsed = parseSpawnBackoffState({
      value: { admitGapSeconds: 0, consecutiveHolds: 1, holdSubjects: ["cpu"] },
    });

    expect(unwrapErr(parsed)).toStrictEqual([
      ": a held streak, its retryAtIso and its holdSubjects must be present together or absent together",
    ]);
  });

  it("refuses a recovery gap with no admission to measure it from, which would otherwise read as no spacing", () => {
    const parsed = parseSpawnBackoffState({ value: { admitGapSeconds: 180, consecutiveHolds: 0, holdSubjects: [] } });

    expect(unwrapErr(parsed)).toStrictEqual([
      ": a recovery gap with no held streak must carry the lastAdmitIso it is measured from",
    ]);
  });

  it("refuses an unknown key", () => {
    const parsed = parseSpawnBackoffState({ value: { ...INITIAL_SPAWN_BACKOFF_STATE, window: 10 } });

    expect(unwrapErr(parsed)).toStrictEqual([': Unrecognized key: "window"']);
  });
});

describe("parseSysctlLoadavg", () => {
  it("reads the real `sysctl -n vm.loadavg` shape", () => {
    expect(parseSysctlLoadavg({ text: "{ 6.08 6.37 7.76 }\n" })).toStrictEqual({
      load1: 6.08,
      load15: 7.76,
      load5: 6.37,
    });
  });

  it("answers undefined for anything else", () => {
    expect(parseSysctlLoadavg({ text: "6.08 6.37 7.76" })).toBeUndefined();
  });
});

describe("spawnIdleSampleNeeded", () => {
  it("takes no `top` sample under the load hold", () => {
    expect(spawnIdleSampleNeeded({ cores: CORES, loadText: "{ 44.99 30.00 20.00 }" })).toBe(false);
  });

  it("takes one at the load hold, where idle can still clear it", () => {
    expect(spawnIdleSampleNeeded({ cores: CORES, loadText: "{ 45.00 30.00 20.00 }" })).toBe(true);
  });

  it("takes none when the load could not be read", () => {
    expect(spawnIdleSampleNeeded({ cores: CORES, loadText: undefined })).toBe(false);
  });
});

describe("spawnHoldReasons", () => {
  it("is clear on a healthy machine", () => {
    expect(reasonsWith({})).toStrictEqual([]);
  });

  it("holds on load over the hold with idle under its floor", () => {
    expect(reasonsWith({ cpuSampleText: cpuSample({ idle: 3 }), loadText: "{ 46.50 30.00 20.00 }" })).toStrictEqual([
      "cpu: 1-min load 46.5, hold at 45, 3% idle, under the 20% floor",
    ]);
  });

  it("does not hold on the same load with idle over its floor — the busy-but-healthy box", () => {
    expect(reasonsWith({ cpuSampleText: cpuSample({ idle: 40 }), loadText: "{ 46.50 30.00 20.00 }" })).toStrictEqual(
      [],
    );
  });

  it("holds on the swapfile count, never on the disk", () => {
    expect(reasonsWith({ swapfileCount: 12 })).toStrictEqual(["memory: 12 swapfiles, hold at 12"]);
  });
});

describe("spawnBackoffLine", () => {
  it("prints nothing while the door is open", () => {
    expect(spawnBackoffLine({ report: spawnBackoffStatus({ nowIso: T0, state: INITIAL_SPAWN_BACKOFF_STATE }) })).toBe(
      undefined,
    );
  });

  it("names the subject, the streak and the instant while held", () => {
    const held = spawnAdmission({ nowIso: T0, reasons: CPU_HOLD, state: INITIAL_SPAWN_BACKOFF_STATE }).nextState;

    expect(spawnBackoffLine({ report: spawnBackoffStatus({ nowIso: at({ seconds: 1 }), state: held }) })).toBe(
      `spawn backoff: HELD on cpu — held reading 1 in a row, no spawn reads the gauge before ${at({ seconds: 10 })}`,
    );
  });

  it("says when the next spawn is admitted during recovery", () => {
    const state: SpawnBackoffState = { ...INITIAL_SPAWN_BACKOFF_STATE, admitGapSeconds: 45, lastAdmitIso: T0 };

    expect(spawnBackoffLine({ report: spawnBackoffStatus({ nowIso: at({ seconds: 1 }), state }) })).toBe(
      `spawn backoff: RECOVERY — one spawn admitted at a time after a hold, the next at ${at({ seconds: 45 })}`,
    );
  });

  it("prints an unreadable state rather than hiding it", () => {
    expect(spawnBackoffLine({ report: { message: "not JSON", phase: "unreadable" } })).toBe(
      "spawn backoff: UNREADABLE — every spawn refuses until it is fixed: not JSON",
    );
  });
});
