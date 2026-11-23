/**
 * The cadence's bars read off the tick row itself — a row is judged under the thresholds its gauge was, a row with
 * none under the pre-threshold values — and a non-default bar changes the chair's verdict on the very same gauge.
 */
import { describe, expect, it } from "vitest";

import { DEFAULT_THRESHOLD_FIELDS } from "../../../plans/thresholds.js";
import { judgeChairCadence } from "../../../supervisor/chairCadence.js";
import { cadenceThresholdsOf, PRE_THRESHOLD_ROW_CADENCE } from "../../../supervisor/chairCadenceThresholds.js";
import type { GaugeFacts } from "../../../supervisor/tickGaugeTypes.js";

import { CURRENT, gauge, NOW, session } from "./chairCadenceFixture.js";

/** A gauge row's facts, carrying these thresholds or none. */
function factsWith({ thresholds }: { thresholds: GaugeFacts["thresholds"] }): GaugeFacts {
  return { nextAllModels: null, nextFable: null, plans: [], reactNowLines: [], thresholds };
}

describe("cadenceThresholdsOf", () => {
  it("reads a row that carries thresholds as exactly the alert, drifting and routing bars it carries", () => {
    const bars = cadenceThresholdsOf({
      facts: factsWith({
        thresholds: {
          ...DEFAULT_THRESHOLD_FIELDS.claude,
          alertAtPercent: 60,
          driftingSpreadPercent: 30,
          routeAtPercent: 90,
        },
      }),
    });

    expect(bars).toStrictEqual({ alertAtPercent: 60, driftingSpreadPercent: 30, routeAtPercent: 90 });
  });

  it("reads a row journalled before the gauge carried thresholds as the values the cadence had fixed in code", () => {
    const bars = cadenceThresholdsOf({ facts: factsWith({ thresholds: undefined }) });

    expect(bars).toStrictEqual({ alertAtPercent: 75, driftingSpreadPercent: 15, routeAtPercent: 95 });
    expect(bars).toBe(PRE_THRESHOLD_ROW_CADENCE);
  });

  it("agrees with the register's defaults at the boundary, so a default-judged row reads the same either way", () => {
    const bars = cadenceThresholdsOf({ facts: factsWith({ thresholds: DEFAULT_THRESHOLD_FIELDS.claude }) });

    expect(bars).toStrictEqual(PRE_THRESHOLD_ROW_CADENCE);
  });
});

describe("judgeChairCadence under a non-default bar", () => {
  const verdictAt = ({ alertAtPercent }: { alertAtPercent: number }) =>
    judgeChairCadence({
      boots: CURRENT,
      gauge: gauge({
        nextChair: "plan-two",
        plans: [
          ["plan-one", 60, 20],
          ["plan-two", 20, 10],
        ],
        thresholds: { alertAtPercent, driftingSpreadPercent: 15, routeAtPercent: 95 },
      }),
      newestInstalled: CURRENT,
      nowIso: NOW,
      sessions: [session({ plan: "plan-one", version: "2.1.283" })],
    });

  it("stays at 60% of the week under the default 75% alert bar", () => {
    expect(verdictAt({ alertAtPercent: 75 }).kind).toBe("stay");
  });

  it("hands off at the same 60% once the register lowers the alert bar to 60, naming that bar", () => {
    expect(verdictAt({ alertAtPercent: 60 })).toMatchObject({
      kind: "hand-off",
      reasons: [{ alias: "plan-one", kind: "plan-window-near", pct: 60, thresholdPercent: 60, window: "seven-day" }],
    });
  });
});
