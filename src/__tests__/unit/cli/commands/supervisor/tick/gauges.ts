/**
 * The `claude gauge --json` captures the chair's hand-off cadence cases feed `supervisor tick open`. Pure data.
 */
import { DEFAULT_THRESHOLD_FIELDS } from "../../../../../../plans/thresholds.js";
import { NOW } from "../tickFixtures.js";

/** Every captured window's reset instant. */
const GAUGE_RESET = "2026-10-08T19:00:00.000Z";

/**
 * One plan's reading as `claude gauge --json` carries it, read at the tick's instant.
 *
 * @param alias the plan
 * @param week its seven-day utilisation, 0..1
 * @param fable its seven-day Fable utilisation, 0..1
 * @returns the plan's entry
 */
function gaugePlan({ alias, week, fable }: { alias: string; week: number; fable: number }): Record<string, unknown> {
  const window = ({ used }: { used: number }) => ({ resetAtIso: GAUGE_RESET, status: "allowed", utilization: used });
  return {
    alias,
    gauge: {
      alias,
      allowance: { kind: "weekly-window" },
      fiveHour: window({ used: 0.01 }),
      observedAtIso: NOW,
      sevenDay: window({ used: week }),
      sevenDayFable: window({ used: fable }),
      usageLimitPercent: 100,
    },
  };
}

/** What every captured gauge below shares: a subscription credential, read at {@link NOW}, printing no PLAN line. */
const GAUGE_FRAME = {
  ambient: { kind: "subscription", reason: "a setup token" },
  observedAtIso: NOW,
  planLines: [],
  thresholds: DEFAULT_THRESHOLD_FIELDS.claude,
};

/**
 * A captured gauge reading at the wall: the chair's plan-one at 97% of its Fable week
 * while plan-three sat at 2% and routing picked it for the next Fable spawn.
 */
export const GAUGE_AT_THE_WALL = JSON.stringify({
  ...GAUGE_FRAME,
  balance: { nextAllModels: "plan-three", nextChair: "plan-three", nextFable: "plan-three" },
  plans: [
    gaugePlan({ alias: "plan-one", fable: 0.97, week: 0.49 }),
    gaugePlan({ alias: "plan-three", fable: 0.02, week: 0.1 }),
  ],
});

/**
 * A captured first-tick gauge reading: the chair's plan-five at 76% of its week while routing still picked it for
 * the next Fable spawn, so a hand-off would have seated the successor on plan-five again.
 */
export const GAUGE_ON_ITS_OWN_ROUTE = JSON.stringify({
  ...GAUGE_FRAME,
  balance: { nextAllModels: "plan-four", nextChair: "plan-five", nextFable: "plan-five" },
  plans: [
    gaugePlan({ alias: "plan-four", fable: 0, week: 0.18 }),
    gaugePlan({ alias: "plan-five", fable: 0.57, week: 0.76 }),
  ],
});
