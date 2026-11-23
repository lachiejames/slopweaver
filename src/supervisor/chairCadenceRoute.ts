/**
 * Which plan the tick's captured gauge says routing picks for the chair's successor — shared by the Claude chair's
 * cadence (`./chairCadence.ts`) and the Codex chair's (`./codexChairCadence.ts`), so both name the route one way.
 */
import type { ChairCadenceGauge, ChairCadenceRoute } from "./chairCadence.js";

/**
 * Which plan routing picks, never claimed off a gauge that is missing or PARTIAL.
 *
 * @param gauge the tick's captured plan gauge
 * @returns the pick, that there is none, or that this tick cannot say
 */
export function chairCadenceRouteOf({ gauge }: { gauge: ChairCadenceGauge }): ChairCadenceRoute {
  if (gauge.kind === "unmeasured" || gauge.gap !== undefined) {
    return { kind: "unmeasured" };
  }
  if (gauge.nextChair === null) {
    return { kind: "none" };
  }
  return { alias: gauge.nextChair, kind: "picks" };
}
