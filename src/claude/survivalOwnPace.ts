/**
 * Each plan-window at its own pace this cycle — the question the provider's own "runs out" banner answers, asked
 * against the owner's ceiling instead of the provider's: at the rate it has drawn since its week opened, would it
 * reach its usage limit before it resets, and when. A plan with no limit set walls at 100%, as the banner does. The
 * wall is the HARD stop, never the house bar: routing lifts that bar in a week's last hours, so a plan can reach
 * 100%, while it never lifts a limit — a 90% plan walls at 90% even under an 80% house bar. Pure:
 * a plan state and an instant in, one line per window out. It is a historical pace run forward, never a prediction.
 * The fleet-level trend, with demand routed across every plan, is `./survivalSimulate.ts`; `./survivalForecast.ts`
 * runs both.
 */
import type { SurvivalPlanState } from "./survivalPlanState.js";

const HOUR_MS = 3_600_000;
const WEEK_MS = 7 * 24 * HOUR_MS;

/** One plan-window at its own current pace. */
export interface OwnPace {
  readonly alias: string;
  readonly window: "seven-day" | "fable-seven-day";
  readonly utilization: number;
  readonly resetAtIso: string;
  /**
   * When the window would reach the plan's usage limit (100% when none is set) at this cycle's average rate, or
   * `undefined` when nothing was drawn yet.
   */
  readonly wallAtIso: string | undefined;
  readonly capsBeforeReset: boolean;
}

/**
 * Each plan-window at its own pace this cycle: the rate it has drawn since its week opened, run forward to the
 * plan's usage limit. The Fable week walls at the same limit, because the register states the limit as a share of
 * the weekly allowance.
 *
 * @param state the plan's starting state, its usage limit included
 * @param nowIso the instant to project from
 * @returns the seven-day line, and the Fable line when the Fable week was read
 */
export function ownPaceProjection({ state, nowIso }: { state: SurvivalPlanState; nowIso: string }): readonly OwnPace[] {
  const wall = state.usageLimitPercent / 100;
  const lines = [
    paceOf({
      alias: state.alias,
      nowIso,
      resetAtIso: state.resetAtIso,
      utilization: state.utilization,
      wall,
      window: "seven-day",
    }),
  ];
  if (state.fableUtilization !== undefined && state.fableResetAtIso !== undefined) {
    lines.push(
      paceOf({
        alias: state.alias,
        nowIso,
        resetAtIso: state.fableResetAtIso,
        utilization: state.fableUtilization,
        wall,
        window: "fable-seven-day",
      }),
    );
  }
  return lines;
}

/** One window's own-pace line, walling at `wall`, the fraction of the week the plan may reach. */
function paceOf({
  alias,
  window,
  utilization,
  resetAtIso,
  nowIso,
  wall,
}: {
  alias: string;
  window: OwnPace["window"];
  utilization: number;
  resetAtIso: string;
  nowIso: string;
  wall: number;
}): OwnPace {
  const nowMs = Date.parse(nowIso);
  const resetMs = Date.parse(resetAtIso);
  const elapsedHours = (nowMs - (resetMs - WEEK_MS)) / HOUR_MS;
  const base = { alias, resetAtIso, utilization, window };
  if (utilization >= wall) {
    return { ...base, capsBeforeReset: true, wallAtIso: nowIso };
  }
  if (utilization <= 0 || elapsedHours <= 0) {
    return { ...base, capsBeforeReset: false, wallAtIso: undefined };
  }
  const wallMs = nowMs + (((wall - utilization) * elapsedHours) / utilization) * HOUR_MS;
  return { ...base, capsBeforeReset: wallMs < resetMs, wallAtIso: new Date(wallMs).toISOString() };
}
