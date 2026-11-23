/**
 * `cmux spawn`'s admission through the fleet-wide spawn backoff, over a temp home, plain fake
 * gauges that count their reads, and a clock that only moves when the wait sleeps. What is proven is the
 * shell's contract: a healthy machine pays no `top` and no window; a held reading defers and closes the door so
 * the next spawn reads no gauge at all; `--wait` is admitted when the window opens; the two hatches waive what
 * they name; and a state file that cannot be trusted refuses rather than reading as nothing held.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { acquireOperationLock } from "../../../../../admit/operationLock.js";
import {
  attemptSpawnAdmission,
  productionSpawnAdmissionDeps,
  type SpawnAdmissionDeps,
  spawnDeferralRefusal,
  waitForSpawnCapacity,
} from "../../../../../cli/commands/cmux/spawnCapacityWait.js";
import { EXIT_DEFERRED, EXIT_ERROR } from "../../../../../cli/exitCodes.js";
import { unwrap } from "../../../../../lib/result.js";
import type { ProcessElapsed } from "../../../../../live/machine/fleetLoad.js";
import type { ClaudeSession } from "../../../../../live/machine/sessionOwner.js";
import { writeSpawnBackoffState } from "../../../../../live/machine/spawnBackoffStore.js";
import { stateHomePaths } from "../../../../../stateHome.js";

const T0_MS = Date.parse("2026-10-22T09:00:00.000Z");
const HEALTHY_COMPRESSOR = "vm.compressor.segment.total: 182761\nvm.compressor.segment.limit: 1234946\n";
const HEALTHY_LOAD = "{ 6.08 6.37 7.76 }";
const OVER_LOAD = "{ 46.50 30.00 20.00 }";
const NO_WAIT = { timeoutSeconds: 540, wait: false } as const;
const SESSIONS: readonly ClaudeSession[] = [701, 702, 703, 704, 705, 706].map((pid) => ({
  cwd: `/wt/${String(pid)}`,
  pid,
  sessionId: `seat-${String(pid)}`,
}));
const SIX_YOUNG: readonly ProcessElapsed[] = SESSIONS.map((session, index) => ({
  pid: session.pid,
  seconds: 10 + index * 20,
}));

let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "spawn-backoff-"));
});

afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

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

/** A machine whose load reading follows `loads` read by read (the last repeating), counting every read. */
function machine({
  loads,
  idle = 3,
  booting = false,
  env = {},
  topSeconds = 0,
}: {
  loads: readonly string[];
  idle?: number;
  booting?: boolean;
  env?: Record<string, string>;
  /** How long one `top` sample takes on the clock. */
  topSeconds?: number;
}): { deps: SpawnAdmissionDeps; reads: { load: number; top: number } } {
  const reads = { load: 0, top: 0 };
  let nowMs = T0_MS;
  const deps: SpawnAdmissionDeps = {
    clock: {
      nowMs: () => nowMs - T0_MS,
      sleep: ({ ms }) => {
        nowMs += ms;
        return Promise.resolve();
      },
    },
    env,
    gauge: {
      compressorSysctl: () => HEALTHY_COMPRESSOR,
      cpuCount: () => 15,
      cpuSample: () => {
        reads.top += 1;
        nowMs += topSeconds * 1000;
        return cpuSample({ idle });
      },
      elapsed: () => (booting ? SIX_YOUNG : []),
      loadavg: () => {
        const load = loads[Math.min(reads.load, loads.length - 1)]!;
        reads.load += 1;
        return load;
      },
      processes: () => [],
      sessions: () => (booting ? SESSIONS : []),
      swapfileCount: () => 3,
    },
    home,
    nowIso: () => new Date(nowMs).toISOString(),
  };
  return { deps, reads };
}

/** Where a lock case's clock starts: nonzero, and not a whole number of retry gaps. */
const ORIGIN_MS = 4_321;

/**
 * One fake sleep that COMPLETES on a later macrotask: `onComplete` (a lock release), the clock's advance and the
 * promise settling all run in ONE synchronous callback. So a lock attempt that sees the release is, by
 * construction, after the sleep completed — however many microtasks the caller yields first. A loop attempting
 * before its sleep completes meets the held lock. `setImmediate` reads no clock.
 */
function sleepCompletingLater({
  deps,
  ms,
  onComplete,
}: {
  deps: SpawnAdmissionDeps;
  ms: number;
  onComplete: () => void;
}): Promise<void> {
  return new Promise((resolve) => {
    setImmediate(() => {
      onComplete();
      void deps.clock.sleep({ ms });
      resolve();
    });
  });
}

/** The state file the shell wrote, decoded. */
function writtenState(): unknown {
  return JSON.parse(readFileSync(stateHomePaths({ home }).live.machine.spawnBackoffJson, "utf8"));
}

describe("an unwaited spawn", () => {
  it("is admitted on a healthy machine without a `top` sample", async () => {
    const { deps, reads } = machine({ loads: [HEALTHY_LOAD] });

    expect(await waitForSpawnCapacity({ deps, wait: NO_WAIT })).toBeUndefined();
    expect(reads).toStrictEqual({ load: 1, top: 0 });
    expect(writtenState()).toStrictEqual({
      admitGapSeconds: 0,
      consecutiveHolds: 0,
      holdSubjects: [],
      lastAdmitIso: "2026-10-22T09:00:00.000Z",
    });
  });

  it("is admitted twice in a row on a healthy machine — no window, no spacing", async () => {
    const { deps } = machine({ loads: [HEALTHY_LOAD] });

    expect(await waitForSpawnCapacity({ deps, wait: NO_WAIT })).toBeUndefined();
    expect(await waitForSpawnCapacity({ deps, wait: NO_WAIT })).toBeUndefined();
  });

  it("defers on a held reading, and the next spawn inside the window reads no gauge", async () => {
    const { deps, reads } = machine({ loads: [OVER_LOAD] });

    expect(await waitForSpawnCapacity({ deps, wait: NO_WAIT })).toBe(EXIT_DEFERRED);
    expect(await waitForSpawnCapacity({ deps, wait: NO_WAIT })).toBe(EXIT_DEFERRED);
    expect(reads).toStrictEqual({ load: 1, top: 1 });
    expect(writtenState()).toStrictEqual({
      admitGapSeconds: 10,
      consecutiveHolds: 1,
      holdSubjects: ["cpu"],
      retryAtIso: "2026-10-22T09:00:10.000Z",
    });
  });

  it("is admitted over a loaded box whose idle is over the floor", async () => {
    const { deps, reads } = machine({ idle: 40, loads: [OVER_LOAD] });

    expect(await waitForSpawnCapacity({ deps, wait: NO_WAIT })).toBeUndefined();
    expect(reads).toStrictEqual({ load: 1, top: 1 });
  });

  it("refuses naming the spawn-backoff hatch on a held reading", () => {
    const { deps } = machine({ loads: [OVER_LOAD] });
    const attempt = attemptSpawnAdmission({ bootsBypassed: false, deps });

    expect(attempt.kind).toBe("held");
    expect(spawnDeferralRefusal({ attempt })).toContain(
      "To override use the designated escape hatch SLOPWEAVER_ALLOW_SPAWN_BACKOFF=1 slopweaver cmux spawn.",
    );
  });

  it("refuses naming the boot-burst hatch on a hold of boots alone", () => {
    const { deps } = machine({ booting: true, loads: [HEALTHY_LOAD] });
    const attempt = attemptSpawnAdmission({ bootsBypassed: false, deps });

    expect(attempt.kind).toBe("held");
    expect(spawnDeferralRefusal({ attempt })).toContain(
      "To override use the designated escape hatch SLOPWEAVER_ALLOW_BOOT_BURST=1 slopweaver cmux spawn.",
    );
  });

  it("is admitted over a boots-only hold with SLOPWEAVER_ALLOW_BOOT_BURST=1", async () => {
    const { deps } = machine({ booting: true, env: { SLOPWEAVER_ALLOW_BOOT_BURST: "1" }, loads: [HEALTHY_LOAD] });

    expect(await waitForSpawnCapacity({ deps, wait: NO_WAIT })).toBeUndefined();
  });

  it("is still deferred on load with SLOPWEAVER_ALLOW_BOOT_BURST=1", async () => {
    const { deps } = machine({ booting: true, env: { SLOPWEAVER_ALLOW_BOOT_BURST: "1" }, loads: [OVER_LOAD] });

    expect(await waitForSpawnCapacity({ deps, wait: NO_WAIT })).toBe(EXIT_DEFERRED);
  });

  it("takes no reading and writes no state with SLOPWEAVER_ALLOW_SPAWN_BACKOFF=1", async () => {
    const { deps, reads } = machine({ env: { SLOPWEAVER_ALLOW_SPAWN_BACKOFF: "1" }, loads: [OVER_LOAD] });

    expect(await waitForSpawnCapacity({ deps, wait: NO_WAIT })).toBeUndefined();
    expect(reads).toStrictEqual({ load: 0, top: 0 });
    expect(() => writtenState()).toThrow("ENOENT");
  });

  it("refuses with EXIT_ERROR on a state file that does not parse, never reading it as nothing held", async () => {
    const { deps, reads } = machine({ loads: [HEALTHY_LOAD] });
    const path = stateHomePaths({ home }).live.machine.spawnBackoffJson;
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, "{ torn");

    expect(await waitForSpawnCapacity({ deps, wait: NO_WAIT })).toBe(EXIT_ERROR);
    expect(reads).toStrictEqual({ load: 0, top: 0 });
  });

  it("waits out another spawn's admission on a healthy machine and is admitted, never deferred on contention", async () => {
    const { deps, reads } = machine({ loads: [HEALTHY_LOAD] });
    const held = unwrap(acquireOperationLock({ home, key: "machine-spawn-admission", nowIso: deps.nowIso() }));
    const releasing: SpawnAdmissionDeps = {
      ...deps,
      clock: {
        nowMs: deps.clock.nowMs,
        sleep: async ({ ms }) => {
          held.release();
          await deps.clock.sleep({ ms });
        },
      },
    };

    expect(await waitForSpawnCapacity({ deps: releasing, wait: NO_WAIT })).toBeUndefined();
    expect(reads).toStrictEqual({ load: 1, top: 0 });
  });

  // The shell retries a held lock every 100ms of its clock for 90s of patience, and every retry is a real lock
  // attempt on disk: a clock stepped 100ms at a time made that 900 attempts, 12.6s of one unit shard alone and
  // 21.8s under coverage and load, past the lane's 20s timeout. This clock records each requested sleep and
  // moves by a scripted step instead, landing one step a millisecond short of the patience and the next exactly
  // on it. Two schedules reach that boundary in different numbers of sleeps, so only a loop judging ELAPSED
  // patience defers at 90,000ms under both — a fixed retry count matches one of them at most — and a patience
  // a millisecond shorter or longer, or a retry gap other than 100ms, fails. Every lock case starts its clock at
  // ORIGIN_MS, not zero, so a loop judging the clock's absolute value against the patience — never retrying on a
  // real `Date.now()` — fails too.
  // Repro: yarn vitest run --config config/vitest/unit.ts src/__tests__/unit/cli/commands/cmux/spawnCapacityWait.test.ts
  it.each([
    { name: "two sleeps", steps: [89_999, 1] },
    { name: "four sleeps", steps: [100, 100, 89_799, 1] },
  ])(
    "defers with EXIT_DEFERRED when another spawn holds the admission lock past its patience ($name)",
    async ({ steps }) => {
      const { deps, reads } = machine({ loads: [HEALTHY_LOAD] });
      await deps.clock.sleep({ ms: ORIGIN_MS });
      const held = unwrap(acquireOperationLock({ home, key: "machine-spawn-admission", nowIso: deps.nowIso() }));
      const requested: number[] = [];
      const scripted: SpawnAdmissionDeps = {
        ...deps,
        clock: {
          nowMs: deps.clock.nowMs,
          sleep: ({ ms }) => {
            // A sleep past the script is a regression the `requested` assertion names; NaN stops the loop first.
            const step = steps[requested.length]!;
            requested.push(ms);
            return deps.clock.sleep({ ms: step });
          },
        },
      };

      expect(await waitForSpawnCapacity({ deps: scripted, wait: NO_WAIT })).toBe(EXIT_DEFERRED);
      // Six gauge-read caps of 10s plus 30s, waited out in full — never a deferral on first contention.
      expect(deps.clock.nowMs()).toBe(ORIGIN_MS + 90_000);
      expect(requested).toStrictEqual(steps.map(() => 100));
      expect(reads).toStrictEqual({ load: 0, top: 0 });
      held.release();
    },
  );

  // The deferral cases above see each sleep's REQUEST, never the lock attempt after it, so a loop that slept
  // 100ms but retried only every second sleep would pass them. Releasing the lock during one chosen sleep and
  // asserting admission at that sleep's own instant proves a real attempt follows THAT sleep: an attempt
  // skipped after sleep k admits a sleep later, at (k + 1) × 100ms, or defers. What is
  // covered is the first three sleeps and, below, the final sleep landing exactly on the patience — the edge an
  // off-by-one in the loop condition would cut. A loop special-casing some other sleep count is out of reach of
  // any finite case list; closing that would take a seam counting real lock attempts, which the shell lacks.
  // Both clocks release, advance and settle together on a later macrotask (`sleepCompletingLater`), so an attempt
  // made before a sleep completes — after any number of yielded microtasks — still meets the held lock and fails
  // the case.
  it.each([
    { name: "two sleeps", steps: [89_999, 1] },
    { name: "four sleeps", steps: [100, 100, 89_799, 1] },
  ])(
    "makes one last attempt when its final sleep lands exactly on the patience, and is admitted then ($name)",
    async ({ steps }) => {
      const { deps, reads } = machine({ loads: [HEALTHY_LOAD] });
      await deps.clock.sleep({ ms: ORIGIN_MS });
      const held = unwrap(acquireOperationLock({ home, key: "machine-spawn-admission", nowIso: deps.nowIso() }));
      const requested: number[] = [];
      const scripted: SpawnAdmissionDeps = {
        ...deps,
        clock: {
          nowMs: deps.clock.nowMs,
          sleep: ({ ms }) => {
            const step = steps[requested.length]!;
            requested.push(ms);
            const last = requested.length === steps.length;
            return sleepCompletingLater({
              deps,
              ms: step,
              onComplete: () => {
                if (last) held.release();
              },
            });
          },
        },
      };

      expect(await waitForSpawnCapacity({ deps: scripted, wait: NO_WAIT })).toBeUndefined();
      expect(deps.clock.nowMs()).toBe(ORIGIN_MS + 90_000);
      expect(requested).toStrictEqual(steps.map(() => 100));
      expect(reads).toStrictEqual({ load: 1, top: 0 });
    },
  );

  it.each([1, 2, 3])(
    "retries the held admission lock right after every sleep — released during sleep %i, admitted at its instant",
    async (releaseAt) => {
      const { deps, reads } = machine({ loads: [HEALTHY_LOAD] });
      await deps.clock.sleep({ ms: ORIGIN_MS });
      const held = unwrap(acquireOperationLock({ home, key: "machine-spawn-admission", nowIso: deps.nowIso() }));
      let sleeps = 0;
      const releasing: SpawnAdmissionDeps = {
        ...deps,
        clock: {
          nowMs: deps.clock.nowMs,
          sleep: ({ ms }) => {
            sleeps += 1;
            const releasesHere = sleeps === releaseAt;
            return sleepCompletingLater({
              deps,
              ms,
              onComplete: () => {
                if (releasesHere) held.release();
              },
            });
          },
        },
      };

      expect(await waitForSpawnCapacity({ deps: releasing, wait: NO_WAIT })).toBeUndefined();
      expect(deps.clock.nowMs()).toBe(ORIGIN_MS + releaseAt * 100);
      expect(sleeps).toBe(releaseAt);
      expect(reads).toStrictEqual({ load: 1, top: 0 });
    },
  );
});

describe("a waited spawn", () => {
  it("is admitted once the held window opens and the machine has cleared, reading the gauge twice", async () => {
    const { deps, reads } = machine({ loads: [OVER_LOAD, HEALTHY_LOAD] });

    expect(await waitForSpawnCapacity({ deps, wait: { timeoutSeconds: 60, wait: true } })).toBeUndefined();
    expect(reads.load).toBe(2);
  });

  it("is deferred when the hold outlasts its timeout", async () => {
    const { deps } = machine({ loads: [OVER_LOAD] });

    expect(await waitForSpawnCapacity({ deps, wait: { timeoutSeconds: 30, wait: true } })).toBe(EXIT_DEFERRED);
  });
});

describe("recovery after a hold", () => {
  it("admits one spawn and closes the door to the next for half the last window", async () => {
    const { deps } = machine({ loads: [OVER_LOAD, OVER_LOAD, HEALTHY_LOAD] });

    expect(await waitForSpawnCapacity({ deps, wait: { timeoutSeconds: 120, wait: true } })).toBeUndefined();
    const next = attemptSpawnAdmission({ bootsBypassed: false, deps });

    expect(next).toMatchObject({ kind: "closed", why: "recovery" });
  });

  it("times the recovery gap from after a slow `top` sample, so its latency never counts as spacing", () => {
    const { deps } = machine({ idle: 40, loads: [OVER_LOAD], topSeconds: 10 });
    unwrap(
      writeSpawnBackoffState({
        home,
        state: {
          admitGapSeconds: 20,
          consecutiveHolds: 2,
          holdSubjects: ["cpu"],
          lastAdmitIso: undefined,
          retryAtIso: "2026-10-22T09:00:00.000Z",
        },
      }),
    );

    expect(attemptSpawnAdmission({ bootsBypassed: false, deps })).toStrictEqual({ kind: "admit" });
    expect(writtenState()).toStrictEqual({
      admitGapSeconds: 10,
      consecutiveHolds: 0,
      holdSubjects: [],
      lastAdmitIso: "2026-10-22T09:00:10.000Z",
    });
    expect(attemptSpawnAdmission({ bootsBypassed: false, deps })).toMatchObject({ kind: "closed", why: "recovery" });
  });

  it("never admits a second spawn in one gap when another admission wrote while this one read the gauge", async () => {
    const { deps } = machine({ loads: [HEALTHY_LOAD] });
    const recovering = {
      admitGapSeconds: 90,
      consecutiveHolds: 0,
      holdSubjects: [],
      lastAdmitIso: "2026-10-22T08:58:00.000Z",
      retryAtIso: undefined,
    };
    const rival = { ...recovering, admitGapSeconds: 45, lastAdmitIso: "2026-10-22T08:59:59.000Z" };
    unwrap(writeSpawnBackoffState({ home, state: recovering }));
    let rivalWrote = false;
    const slowGauge: SpawnAdmissionDeps = {
      ...deps,
      gauge: {
        ...deps.gauge,
        loadavg: () => {
          if (!rivalWrote) {
            rivalWrote = true;
            unwrap(writeSpawnBackoffState({ home, state: rival }));
          }
          return deps.gauge.loadavg();
        },
      },
    };

    expect(await waitForSpawnCapacity({ deps: slowGauge, wait: NO_WAIT })).toBe(EXIT_DEFERRED);
    // The file on disk carries no key for an unset instant.
    expect(writtenState()).toStrictEqual({
      admitGapSeconds: 45,
      consecutiveHolds: 0,
      holdSubjects: [],
      lastAdmitIso: "2026-10-22T08:59:59.000Z",
    });
  });
});

describe("the production admission", () => {
  it("judges and writes the spawn's own state home, never the ambient one", () => {
    expect(productionSpawnAdmissionDeps({ home: "/state/B" }).home).toBe("/state/B");
  });
});
