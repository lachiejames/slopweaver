/**
 * The CPU load hold: the per-core load a spawn holds at, the idle floor that clears it, and the one predicate
 * every surface grades it with. A leaf with no imports on purpose, so `site/__tests__/unit/idleHoldFloorMirror.test.ts`
 * can bind the site's copy to it without dragging the rest of `src/` into the site's typecheck.
 * `./capacityHolds.ts` re-exports all of it beside the other hold clauses.
 */

/*
 * The CPU hold, doubled and graded on idle as well as load. The fleet page said "holding, the machine is busy"
 * while the owner's Activity Monitor showed forty to sixty percent idle CPU and thirteen GB of unused memory, so
 * the thresholds are doubled, the exception being a burst of steers or one really big ask. So the per-core load
 * hold is 3, and a load at or over it holds only while `top`'s own `CPU usage:` header — the figure Activity
 * Monitor's CPU Load panel shows the owner — reads under {@link IDLE_HOLD_FLOOR_PCT} idle. The 1-minute load
 * counts runnable threads over a damped minute, so a high load and plenty of idle CPU coexist, and the idle
 * figure is the one the owner checks. An idle figure that could not be read leaves the load to judge alone, never a silent pass.
 * Reproduce both inputs: `sysctl -n hw.ncpu vm.loadavg` and `top -l 2 -s 1 -n 0 | grep "CPU usage"`.
 */

/** The 1-minute load a spawn holds at, per core — 3, floored against the core count. */
const LOAD_HOLD_PER_CORE = 3;

/** The load hold used when the core count could not be read: 3 x the 15 cores this device reports. */
export const DEFAULT_LOAD_HOLD = 45;

/**
 * The idle percentage below which a load at or over its hold holds. A JUDGEMENT, not a measurement: one core
 * in five free is spare capacity the owner can see, and forty-to-sixty-percent readings clear it by a wide
 * margin, while a burst drives `top`'s idle to single figures (1.55% at load 28.4).
 */
export const IDLE_HOLD_FLOOR_PCT = 20;

/**
 * Whether the 1-minute load holds a spawn: measured, at or over its hold, AND the machine is not visibly idle
 * — `top`'s idle percentage under {@link IDLE_HOLD_FLOOR_PCT}, or unread, in which case load judges alone.
 *
 * @param idlePct `top`'s final-sample `CPU usage:` idle percentage, or `undefined` when it could not be read
 * @param load1 the 1-minute load average, or `undefined` when it could not be read
 * @param loadHold the load at or above which a spawn holds, already sized to the core count
 * @returns true when the load holds
 */
export function cpuLoadHolding({
  idlePct,
  load1,
  loadHold,
}: {
  idlePct: number | undefined;
  load1: number | undefined;
  loadHold: number;
}): boolean {
  if (load1 === undefined || load1 < loadHold) {
    return false;
  }
  return idlePct === undefined || idlePct < IDLE_HOLD_FLOOR_PCT;
}

/**
 * The 1-minute load average at or above which a spawn HOLDs, for a machine with this many cores —
 * `./capacity.ts`'s CPU-half comment carries the measurement that made it a hold.
 *
 * @param cores the machine's core count (`sysctl -n hw.ncpu`), or `undefined` when it could not be read
 * @returns the hold threshold — `floor(3 x cores)`, or {@link DEFAULT_LOAD_HOLD} with no core count
 */
export function loadHoldFor({ cores }: { cores: number | undefined }): number {
  return cores === undefined || cores <= 0 ? DEFAULT_LOAD_HOLD : Math.floor(cores * LOAD_HOLD_PER_CORE);
}
