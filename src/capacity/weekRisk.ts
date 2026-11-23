/**
 * What one model host's plan week is projected to do before its resets: run dry for a measured spell, stay clear, or
 * not be projectable at all — the shape `../claude/weekRisk.ts` and `../codex/weekRisk.ts` both answer in, and
 * `../monitor/hostWeekRunsOut.ts` cards.
 *
 * ## Why a model host, and never one plan
 *
 * The owner's rule: a warning when
 * EITHER the Claude plans OR the Codex plans look like running out before the weekly reset, because either one alone is
 * impactful — and not when one of five plans quietly runs dry while the others take over. So a spell here is an
 * interval in which EVERY routable plan of one model host is projected at its effective ceiling with demand left
 * over, routed the way that host's production router routes. One plan capping early is never a spell.
 *
 * ## Why demand is guarded down before it decides anything
 *
 * A false positive trains the owner to ignore the warning, so it must be rare. The trailing burn moves about ±10% week to
 * week (`skills/supervisor/reference/plan-survival.md` § The model), so a spell that only exists at the full trailing
 * rate is a coin toss. Each model host's decisive run is at {@link WEEK_RISK_DEMAND_GUARD} of its trailing demand;
 * the full rate stays on the card as evidence, never as the trigger.
 *
 * Pure: types, constants and the card formatters.
 */
import { DETAIL_LINE_CAP } from "../hand/details.js";

/** The model hosts a plan week is projected for. */
type PlanWeekHost = "claude" | "codex";

/**
 * The share of trailing demand a model host's decisive run uses: 90%, the low edge of the ±10% the trailing burn
 * moved across the measured replay (`skills/supervisor/reference/plan-survival.md`), so a spell that ordinary
 * demand noise would erase never fires.
 */
export const WEEK_RISK_DEMAND_GUARD = 0.9;

/** How far ahead a model host's week is projected: one week, the longest any plan waits for its own reset. */
export const WEEK_RISK_HORIZON_HOURS = 7 * 24;

/**
 * What a projected spell must be to count: the share of trailing demand it is projected at, and its shortest length.
 * Two are used, so one marginal projection cannot flicker a card open and shut and open again: a card OPENS only on
 * the guarded run ({@link WEEK_RISK_DEMAND_GUARD}, the monitor's minimum hours), and an open card is HELD while any
 * spell remains at the full trailing rate.
 */
export interface WeekRiskCriterion {
  readonly demandShare: number;
  readonly minDryHours: number;
}

/** One model host's projected dry spell, carrying everything its card says. */
export interface HostDrySpell {
  readonly host: PlanWeekHost;
  /** The first projected hour with every routable plan at its ceiling and demand left over. */
  readonly startIso: string;
  /** Whole dry hours. */
  readonly hours: number;
  /** When a plan gains room again and ends the spell. */
  readonly endIso: string;
  /** The plan whose reset (or final-hours lift) ends the spell. */
  readonly endedById: string;
  /** One line naming the basis: the guarded and trailing demand, and what it was measured over. */
  readonly basis: string;
  /** One line per configured plan of this model host, paused and never-routed plans included. */
  readonly planLines: readonly string[];
  /**
   * What the card is ABOUT, as stable text: the model host and its routable plans, each with its effective ceiling.
   * Never a percentage, a demand or an instant, which drift every pass — so the card is held while the same
   * condition stands and re-cut only when the host's routable set or a limit changes.
   */
  readonly identity: readonly string[];
}

/**
 * What one model host's projection concluded. A clear host that was simulated carries the same basis and plan lines a
 * card would, so the maths can be read when nothing fires — the owner wants to see it before deciding.
 */
export type HostWeekProjection =
  | { readonly kind: "at-risk"; readonly spell: HostDrySpell }
  | { readonly kind: "clear"; readonly why: string; readonly lines?: readonly string[] | undefined }
  | { readonly kind: "unmeasurable"; readonly why: string };

const HOUR_MS = 3_600_000;

/**
 * A span as a card prints it, to the hour: `3d13h`, `13h`, `0h`.
 *
 * @param ms the span; a negative one reads as `0h`
 * @returns whole days and hours
 */
export function spanOf({ ms }: { ms: number }): string {
  const hours = Math.max(0, Math.round(ms / HOUR_MS));
  const days = Math.floor(hours / 24);
  if (days === 0) {
    return `${String(hours)}h`;
  }
  return `${String(days)}d${String(hours % 24)}h`;
}

/**
 * A paused plan's card line, its free-text reason clipped so the line fits one card detail: the register accepts a
 * reason of any length, and one over the cap would make `checkedDetails` refuse the whole card, turning an at-risk
 * week into an unmeasurable one.
 *
 * @param reason the pause reason as the register holds it
 * @returns `<alias>: paused, not routed — <reason>`, at most {@link DETAIL_LINE_CAP} characters
 */
export function pausedLineOf({ alias, reason }: { alias: string; reason: string }): string {
  const line = `${alias}: paused, not routed — ${reason}`;
  if (line.length <= DETAIL_LINE_CAP) {
    return line;
  }
  return `${line.slice(0, DETAIL_LINE_CAP - 1)}…`;
}

/**
 * A rate in plan-weeks an hour as a reader reads it: plan-weeks a day, to two decimals.
 *
 * @param planWeeksPerHour the rate
 * @returns e.g. `0.71 plan-weeks/day`
 */
export function perDay({ planWeeksPerHour }: { planWeeksPerHour: number }): string {
  return `${String(Math.round(planWeeksPerHour * 24 * 100) / 100)} plan-weeks/day`;
}
