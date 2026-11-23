/**
 * Which plan the tick's captured gauge says routing picks for the chair's successor — never claimed off a gauge that
 * is missing or partial (`src/supervisor/chairCadenceRoute.ts`).
 */
import { describe, expect, it } from "vitest";

import type { ChairCadenceGauge } from "../../../supervisor/chairCadence.js";
import { chairCadenceRouteOf } from "../../../supervisor/chairCadenceRoute.js";
import { DEFAULT_CADENCE_THRESHOLDS } from "./chairCadenceFixture.js";

/** A whole gauge read, routing to `nextChair`. */
function readGauge({ nextChair }: { nextChair: string | null }): ChairCadenceGauge {
  return { kind: "read", nextChair, plans: [], thresholds: DEFAULT_CADENCE_THRESHOLDS };
}

describe("chairCadenceRouteOf", () => {
  it("names the plan a whole gauge routes to", () => {
    expect(chairCadenceRouteOf({ gauge: readGauge({ nextChair: "plan-b" }) })).toStrictEqual({
      alias: "plan-b",
      kind: "picks",
    });
  });

  it("says routing picks none when the whole gauge names no plan", () => {
    expect(chairCadenceRouteOf({ gauge: readGauge({ nextChair: null }) })).toStrictEqual({ kind: "none" });
  });

  it("claims no pick off a partial gauge, even one naming a plan", () => {
    const gauge = { ...readGauge({ nextChair: "plan-b" }), gap: "one plan's usage was not read" };

    expect(chairCadenceRouteOf({ gauge })).toStrictEqual({ kind: "unmeasured" });
  });

  it("claims no pick when the tick captured no gauge", () => {
    const gauge: ChairCadenceGauge = { kind: "unmeasured", why: "the gauge timed out" };

    expect(chairCadenceRouteOf({ gauge })).toStrictEqual({ kind: "unmeasured" });
  });
});
