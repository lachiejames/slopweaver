/**
 * Which windows a spawn has to clear, and the bar each one is judged at — the half of `./loadBalance.ts` that says
 * where a Fable seat, and the chair above all, may NOT go before any ranking asks where it should.
 *
 * ## Why a Fable seat's plan-wide week never takes the lift
 *
 * The lift (`./select.ts`'s `spendCapFor`) lets a weekly window take work to 100% in its last
 * five hours so the capacity does not strand. That suits a worker that ends before the wall. A Fable spawn is the
 * supervisor chair or a long seat, and it walls the moment the plan-wide week does. MEASURED: `cmux
 * spawn fresh-supervisor-handoff --driver claude --model fable` printed `claude routing: plan-two for a fable
 * spawn — fable-week 44%` while plan-two's all-models week read 95% (`claude gauge`) and 96% on the owner's screen,
 * 2h20m before its reset — inside the lift, so the 95% bar read 100% and the successor chair booted
 * onto a plan about to stop. The supervisor must never go down. Reproduce: `slopweaver claude gauge`
 * on a plan past 95% inside five hours of its reset printed `next fable spawn -> <that plan>` before this.
 *
 * ## Why the chair, and only the chair, loses the lift on its Fable week too
 *
 * The lift rules a Fable spawn onto a Fable week at 97% half an hour from its reset (`loadBalance.test.ts`), and a short
 * Fable seat keeps that. The chair's successor does not: a chair seated there walls within the hour it was seated
 * in. So the chair, and only the chair, is held to 95% on the Fable week too, the all-models week staying binding.
 * An all-models spawn keeps the lift on both weeks.
 */
import type { ClaudeThresholds } from "../plans/thresholds.js";
import type { ClaudeAccountGauge, ClaudeModelClass, ClaudeWindowReading } from "./contracts.js";
import type { ClaudeCapWindow } from "./select.js";

/**
 * The house bars with the last-five-hours lift taken away, so a window judged under them bars a seat at the routing
 * bar right up to its reset.
 *
 * @param thresholds the install's Claude thresholds, off the register
 * @returns the same thresholds with the spend-out bar held at the routing bar
 */
export function fableSeatThresholds({ thresholds }: { thresholds: ClaudeThresholds }): ClaudeThresholds {
  return { ...thresholds, spendOutAt: thresholds.routeAt };
}

/**
 * Every window a spawn of this class has to clear, in the order they are reported, each with the bars it is judged
 * under.
 *
 * The plan-wide pair comes first in every case, because a plan-wide refusal bars a Fable spawn too and a reason
 * naming the Fable window would send a reader to look at the wrong number. A Fable spawn's plan-wide week is judged
 * under {@link fableSeatThresholds}; so is the chair's Fable week. The five-hour window never lifts, so its bars are
 * the house bars whoever spawns.
 *
 * @param chair whether this spawn seats the supervisor chair
 * @param gauge the plan's reading
 * @param modelClass which budget the spawn will spend
 * @param thresholds the install's Claude thresholds, off the register
 * @returns each window with the label a reason uses for it and the bars it is judged under
 */
export function gatingWindows({
  chair,
  gauge,
  modelClass,
  thresholds,
}: {
  chair: boolean;
  gauge: ClaudeAccountGauge;
  modelClass: ClaudeModelClass;
  thresholds: ClaudeThresholds;
}): readonly { label: ClaudeCapWindow; thresholds: ClaudeThresholds; window: ClaudeWindowReading | undefined }[] {
  if (modelClass !== "fable") {
    return [
      { label: "five_hour", thresholds, window: gauge.fiveHour },
      { label: "seven_day", thresholds, window: gauge.sevenDay },
    ];
  }
  const seat = fableSeatThresholds({ thresholds });
  return [
    { label: "five_hour", thresholds, window: gauge.fiveHour },
    { label: "seven_day", thresholds: seat, window: gauge.sevenDay },
    { label: "seven_day_fable", thresholds: chair ? seat : thresholds, window: gauge.sevenDayFable },
  ];
}
