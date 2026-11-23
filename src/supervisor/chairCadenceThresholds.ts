/**
 * The bars the chair's cadence judges a tick's gauge by, read off the tick row itself rather than the register as
 * it stands now: a row is judged under the thresholds its gauge judged under, so a hand-off reason and the gauge's
 * own REACT NOW line on the same row can never disagree (`src/plans/thresholds.ts`).
 *
 * One explicit branch for a row with none. Every row journalled before the gauge carried its thresholds was judged
 * under the values the cadence had fixed in code before the gauge carried thresholds, which are the register's defaults — the only
 * ones that could have applied — so those are what it reads as, named here, never a fallback spelled at a read.
 * They are read off `DEFAULT_THRESHOLD_FIELDS` rather than restated, so no bar is spelled outside the register.
 */
import { type ClaudeThresholdFields, DEFAULT_THRESHOLD_FIELDS } from "../plans/thresholds.js";
import type { GaugeFacts } from "./tickGaugeTypes.js";

/**
 * The three bars the cadence reads, in the register's own spelling: the alert bar, the drifting band, and the
 * routing bar a Fable seat is refused at (`../claude/fableSeatBars.ts`'s `fableSeatThresholds`).
 */
export type ChairCadenceThresholds = Pick<
  ClaudeThresholdFields,
  "alertAtPercent" | "driftingSpreadPercent" | "routeAtPercent"
>;

/** What a row journalled before the gauge carried thresholds was judged under: the register's Claude defaults. */
export const PRE_THRESHOLD_ROW_CADENCE: ChairCadenceThresholds = {
  alertAtPercent: DEFAULT_THRESHOLD_FIELDS.claude.alertAtPercent,
  driftingSpreadPercent: DEFAULT_THRESHOLD_FIELDS.claude.driftingSpreadPercent,
  routeAtPercent: DEFAULT_THRESHOLD_FIELDS.claude.routeAtPercent,
};

/**
 * The cadence bars one tick row's gauge was judged under.
 *
 * @param facts the row's gauge facts
 * @returns the row's own alert and drifting bars, or the pre-threshold values for a row that carries none
 */
export function cadenceThresholdsOf({ facts }: { facts: GaugeFacts }): ChairCadenceThresholds {
  if (facts.thresholds === undefined) {
    return PRE_THRESHOLD_ROW_CADENCE;
  }
  return {
    alertAtPercent: facts.thresholds.alertAtPercent,
    driftingSpreadPercent: facts.thresholds.driftingSpreadPercent,
    routeAtPercent: facts.thresholds.routeAtPercent,
  };
}
