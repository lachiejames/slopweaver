/**
 * The one thing the supervisor's sweep has to say about budget every tick: which plan is about to close, and
 * which spawns to move off it BEFORE it does. Pure: takes readings, returns lines.
 *
 * ## Why an alert exists rather than a column
 *
 * The gauge column ({@link renderGaugeLines}) answers "how much is left" and a fleet can lock itself out of a plan
 * with it showing. A number in a table is not a signal — somebody has to look at it, decide the threshold,
 * and work out what to do about it, every tick, forever. MEASURED on one fleet: plan A reached a 100%
 * plan-wide week with 47% of its Fable week unspent and unspendable, plan B reached a 100% Fable week with a
 * third of its plan-wide week free, and the sweep that ran throughout said nothing about either.
 *
 * So this module does the deciding. It emits a fold line every tick, and a REACT-NOW line only when a window
 * has crossed the install's alert threshold — and that line names the spawns to move, not just the number.
 *
 * ## The threshold, and why its default is not 90
 *
 * The threshold is the plan register's `thresholds.claude.alertAtPercent` (`plans/thresholds.ts`), never a
 * constant here. The owner is carded BEFORE any plan crosses 90%. A card AT 90% is
 * a card about a decision that is already mostly made, so its default is 75, and the property that matters is
 * that it fires while moving a spawn is still the owner's choice rather than the router's. The register refuses an
 * alert at or past the acceptance bar, which sits below the routing bar, so that ordering is enforced where the
 * number is written rather than assumed here.
 *
 * **The card is NOT a rung under the routing cap.** It is not a ladder of 75 → 85 → 90 — notice, stop
 * routing, then the owner's number — because the routing bar's default is 95 rather than a lower bar that
 * strands 15 points of every paid week, and it lifts again to the spend-out bar in a weekly window's last hours (`select.ts`'s
 * `spendCapFor`), so routing spends a plan THROUGH 90% and, near a reset, to the wall itself. The card's
 * default moves with neither: it is anchored to the owner's rule about being carded early, not to the cap.
 *
 * ## On a plan with a usage limit, the card is a share of that limit
 *
 * The owner's usage limit stops routing on a weekly window at the limit itself, so an absolute 75% card would never
 * fire on a 50% plan. Where the limit binds a weekly window — the plan-wide week or the Fable week — the card fires
 * `alertAt` of the way to it (37.5% on a 50% plan by default), and the line says that arithmetic
 * ({@link claudeCardAlertPoint}). The five-hour window and every window of an unlimited plan keep the absolute bar.
 * The wall the merged line counts is the same effective ceiling routing stops at, so a 50% plan at 50% is at it.
 *
 * ## Once every plan is past 75%, the card is ONE line
 *
 * The budget alarm merges into one line once every plan has passed 75%, and that line says so clearly when
 * the owner needs to act and what happens otherwise, so the owner never has to drive the fleet to be driven.
 *
 * Balanced routing puts every plan past 75% together, when five per-window lines would carry one fact.
 * {@link mergedAlert} replaces them with one line naming the state, where the next spawn goes — the router's
 * own pick, since a plan past 75% still takes work up to its cap — what happens next, and when relief
 * arrives. The one fact a merge would otherwise drop is a plan the provider has already REFUSED,
 * which calls for a different reaction from a plan merely at 76%, so the line carries that count rather than
 * a second line reintroducing the list. Every plan's individual number is still in the fold line, unchanged,
 * so the tick loses nothing.
 *
 * **A merge is a claim about a FLEET, so it needs the whole fleet READ** — which is why
 * {@link fleetBudgetAlert} takes `configured` and not just the readings. `gauges` is built by dropping every
 * plan that did not answer, so a tick that reached two plans of four, both past 75%, would say "every plan
 * past 75%, nothing to move" about two plans it read and two it never saw, either of which might have had a
 * wholly open week. The per-window lines survive that case unharmed: each is a claim about ONE plan, and one
 * plan is exactly what was read.
 */
import type { ClaudeThresholds } from "../plans/thresholds.js";
import { weeklyUsageLimitOf } from "../plans/usageLimit.js";
import { claudeCardAlertPoint } from "./budgetAlertPoint.js";
import type { ClaudePlanGauge, ClaudeWindowReading } from "./contracts.js";
import { rankClaudePlans } from "./loadBalance.js";
import { type ClaudeCapWindow, claudeEffectiveUsageCeiling } from "./select.js";

/**
 * How many plans a merged line needs, below which the per-window lines stand.
 *
 * Two, because merging one crossing into a sentence about "every plan" states a fleet where there is only a
 * plan, and because the merge saves nothing there — the per-window line it would replace already names which
 * window closed, which the merged line does not.
 */
const MERGEABLE_PLANS = 2;

/** One window of one plan, named the way an alert line refers to it. */
interface AlertWindow {
  /** Which window this is, which decides whether the plan's usage limit rebases its card. */
  readonly claim: ClaudeCapWindow;
  /** The plan the window belongs to, carrying the usage limit the card point is a share of. */
  readonly gauge: ClaudePlanGauge;
  readonly label: string;
  /** Which spawns this window's exhaustion stops, in the words the card uses. */
  readonly stops: string;
  readonly window: ClaudeWindowReading;
}

/**
 * Every window an alert may fire on, flattened across every plan.
 *
 * The five-hour window is included when the plan still has one (the Ultra plan lost it, `contracts.ts`) and
 * the Fable window when it was measured, because all three
 * stop DIFFERENT work: a spent five-hour window stops that plan for the hour, a spent plan-wide week stops it
 * entirely, and a spent Fable week stops only its Fable seats.
 *
 * @param gauges every plan's reading, each with its usage policy
 * @returns each window with the plan and the work it gates
 */
function alertWindows({ gauges }: { gauges: readonly ClaudePlanGauge[] }): readonly AlertWindow[] {
  return gauges.flatMap((gauge): readonly AlertWindow[] => [
    ...(gauge.fiveHour === undefined
      ? []
      : [
          {
            claim: "five_hour" as const,
            gauge,
            label: "5h",
            stops: "every spawn, until it resets",
            window: gauge.fiveHour,
          },
        ]),
    { claim: "seven_day", gauge, label: "week", stops: "every spawn", window: gauge.sevenDay },
    ...(gauge.sevenDayFable === undefined
      ? []
      : [
          {
            claim: "seven_day_fable" as const,
            gauge,
            label: "fable week",
            stops: "Fable spawns",
            window: gauge.sevenDayFable,
          },
        ]),
  ]);
}

/**
 * Where the card fires on one window ({@link claudeCardAlertPoint}), read off the window's own plan.
 *
 * @param entry the window, with its plan and claim
 * @param thresholds the install's Claude thresholds, whose alert bar is the share
 * @returns the card point, and whether the owner's usage limit set it
 */
function cardPointOf({
  entry,
  thresholds,
}: {
  entry: Pick<AlertWindow, "claim" | "gauge" | "window">;
  thresholds: ClaudeThresholds;
}): ReturnType<typeof claudeCardAlertPoint> {
  const { claim, gauge, window } = entry;
  const usageLimitPercent = weeklyUsageLimitOf(gauge);
  return claudeCardAlertPoint({ claim, observedAtIso: gauge.observedAtIso, thresholds, usageLimitPercent, window });
}

/**
 * How one card names a window's level. A plan with no binding limit reads as it always has; a limited one says the
 * arithmetic, so the owner never has to work out why a card fired at 38% — and a provider refusal BELOW the point
 * says so, rather than claiming the window passed a point it did not reach.
 *
 * @param entry the window, with its plan and claim
 * @param thresholds the install's Claude thresholds, whose alert bar is the share named
 * @returns the level clause, opening with the rounded percentage
 */
function levelOf({ entry, thresholds }: { entry: AlertWindow; thresholds: ClaudeThresholds }): string {
  const level = percentOf({ utilization: entry.window.utilization });
  const point = cardPointOf({ entry, thresholds });
  if (point.source === "routing-bar") {
    return level;
  }
  const limit = `your ${String(entry.gauge.usageLimitPercent)}% usage limit`;
  if (entry.window.utilization < point.utilization) {
    return `${level} (provider refused it before ${limit})`;
  }
  const share = percentOf({ utilization: thresholds.alertAt });
  return `${level}, past its ${percentOf({ utilization: point.utilization })} alert point (${share} of the way to ${limit})`;
}

/**
 * A fraction as the whole percentage every card prints.
 *
 * @param utilization the raw fraction
 * @returns the rounded percentage with its sign
 */
function percentOf({ utilization }: { utilization: number }): string {
  return `${String(Math.round(utilization * 100))}%`;
}

/**
 * Where the work a closing plan is about to stop should go instead: the plan the router would pick with the
 * closing one set aside, so the alert never names a plan the next spawn would not go to.
 *
 * Every other plan is offered to `rankClaudePlans` whatever its level. Filtering them at this alert's own 75%
 * first, as the level rule once did, named a 10% plan resetting in six days over an 80% one losing 15 points
 * tomorrow — the plan the router was filling. The ranking still
 * excludes a plan the same spawns cannot boot on: for a Fable window, one whose plan-wide week is refused, as
 * a Fable spawn there is refused outright (measured). A plan whose Fable week was not read stays
 * in, ranked after every read one exactly as the router ranks it.
 * A window that stops EVERY spawn also names where a Fable seat goes when that differs, because a Fable seat
 * is refused at the routing bar on a plan-wide week a worker may still spend out.
 *
 * @param alias the plan that is closing
 * @param gauges every plan's reading
 * @param label which window is closing
 * @param thresholds the install's Claude thresholds, which the ranking judges every plan by
 * @returns the clause naming where to move, or one saying nothing else can take it
 */
function moveTo({
  alias,
  gauges,
  label,
  thresholds,
}: {
  alias: string;
  gauges: readonly ClaudePlanGauge[];
  label: string;
  thresholds: ClaudeThresholds;
}): string {
  const others = gauges.filter((gauge) => gauge.alias !== alias);
  const fable = rankClaudePlans({ gauges: others, modelClass: "fable", thresholds }).ranked[0];
  if (label === "fable week") {
    return fable === undefined ? "and no other plan can take them" : `move them to ${fable.alias}`;
  }
  const best = rankClaudePlans({ gauges: others, modelClass: "all-models", thresholds }).ranked[0];
  if (best === undefined) {
    return "and no other plan can take them";
  }
  if (fable === undefined) {
    return `move them to ${best.alias} (no other plan can take a Fable seat)`;
  }
  if (fable.alias !== best.alias) {
    return `move them to ${best.alias} (a Fable seat to ${fable.alias})`;
  }
  return `move them to ${best.alias}`;
}

/**
 * Whether one window has crossed its card point. A REFUSED window counts as crossed: the provider saying no is past
 * every number, and a plan that reads 74% on a refused window is not a destination.
 *
 * @param entry the window, with its plan and claim
 * @param thresholds the install's Claude thresholds, whose alert bar is the card
 * @returns true when the window is at or past its card point, or refused
 */
function pastCard({
  entry,
  thresholds,
}: {
  entry: Pick<AlertWindow, "claim" | "gauge" | "window">;
  thresholds: ClaudeThresholds;
}): boolean {
  return (
    entry.window.status === "rejected" || entry.window.utilization >= cardPointOf({ entry, thresholds }).utilization
  );
}

/**
 * Whether this plan's week can still take a spawn at all, judged by the same effective ceiling routing uses — the
 * owner's usage limit when it binds, never lifted — so the count this feeds cannot disagree with what `cmux spawn`
 * will actually do.
 *
 * @param gauge the plan's reading, with its usage limit
 * @param thresholds the install's Claude thresholds, the same ones routing reads
 * @returns true when routing would refuse this plan's plan-wide week
 */
function weekAtWall({ gauge, thresholds }: { gauge: ClaudePlanGauge; thresholds: ClaudeThresholds }): boolean {
  const { observedAtIso, sevenDay } = gauge;
  const usageLimitPercent = weeklyUsageLimitOf(gauge);
  if (sevenDay.status === "rejected") {
    return true;
  }
  const ceiling = claudeEffectiveUsageCeiling({
    claim: "seven_day",
    observedAtIso,
    resetAtIso: sevenDay.resetAtIso,
    thresholds,
    usageLimitPercent,
  });
  return sevenDay.utilization >= ceiling.utilization;
}

/**
 * The ONE line that replaces the per-window list once every plan is past the card threshold.
 *
 * It carries three things and stops, because the fold line above it already holds every plan's number: the
 * state, what happens if nothing changes, and when relief arrives. The wall count is included only when it
 * is non-zero — "0 of 4 already at the wall" is a sentence that makes a reader do arithmetic to learn
 * nothing.
 *
 * Each plan is past its OWN card point, so once any plan carries a usage limit the line names the share rather than
 * one absolute percentage no limited plan was judged by.
 *
 * @param gauges every plan's reading, every one of them already past the card
 * @param thresholds the install's Claude thresholds, which name the card and judge the wall
 * @returns the single react-now line
 */
function mergedAlert({
  gauges,
  thresholds,
}: {
  gauges: readonly ClaudePlanGauge[];
  thresholds: ClaudeThresholds;
}): string {
  const atWall = gauges.filter((gauge) => weekAtWall({ gauge, thresholds })).length;
  const soonest = gauges.toSorted((left, right) => (left.sevenDay.resetAtIso < right.sevenDay.resetAtIso ? -1 : 1))[0]!;
  const consequence =
    atWall === 0
      ? "the fleet stalls at the first plan to fill"
      : `${String(atWall)} of ${String(gauges.length)} already at the wall`;
  const next = rankClaudePlans({ gauges, modelClass: "all-models", thresholds }).ranked[0];
  const fable = rankClaudePlans({ gauges, modelClass: "fable", thresholds }).ranked[0];
  let where = "nothing to move";
  if (next !== undefined) {
    where = `spawns go to ${next.alias}`;
    if (fable === undefined) {
      where = `${where} (no plan can take a Fable seat)`;
    } else if (fable.alias !== next.alias) {
      where = `${where} (a Fable seat to ${fable.alias})`;
    }
  }
  const share = percentOf({ utilization: thresholds.alertAt });
  const limited = gauges.some((gauge) => weeklyUsageLimitOf(gauge) < 100);
  const past = limited ? `${share} of the way to its owner-set usage limit` : share;
  return (
    `REACT NOW — every plan past ${past}, ${where}; ` +
    `${consequence}, next reset ${soonest.alias} ${soonest.sevenDay.resetAtIso}`
  );
}

/**
 * The budget lines a sweep tick publishes: one fold line always, and a react-now line per closing window —
 * or, once every plan's week is past the card, {@link mergedAlert}'s single line in place of the list.
 *
 * **`configured` is what makes the merge honest, and it is REQUIRED rather than optional.** `gauges` holds
 * only the plans that ANSWERED — `claude gauge` builds it by dropping every outcome with no reading — so a
 * tick that could read two plans of four, both past 75%, would otherwise print "every plan past 75%,
 * nothing to move" about two plans it read and two it never saw, when one of those two may have a wholly
 * open week. That is the same lie `gaugeDocument` refuses to tell when it keeps an unreadable plan in the
 * document with its reason. The merge therefore fires only when every configured plan was read, which also
 * rules out a sweep narrowed with `--plan <alias>`, whose `gauges` is a subset by request rather than by
 * failure. A caller that cannot say how many plans exist should not be merging.
 *
 * @param configured how many plans are configured, readable or not
 * @param gauges every READABLE plan's reading, in configured order
 * @param thresholds the install's Claude thresholds — the alert bar is the card, the routing bars judge the wall
 * @returns the fold line and, when a window has crossed the card threshold, the react-now lines
 */
export function fleetBudgetAlert({
  configured,
  gauges,
  thresholds,
}: {
  configured: number;
  gauges: readonly ClaudePlanGauge[];
  thresholds: ClaudeThresholds;
}): {
  readonly fold: string;
  readonly reactNow: readonly string[];
} {
  const percent = (window: ClaudeWindowReading): string => percentOf({ utilization: window.utilization });
  const fold =
    gauges.length === 0
      ? "claude budget: no plan was readable this tick"
      : `claude budget: ${gauges
          .map(
            (gauge) =>
              `${gauge.alias} ${percent(gauge.sevenDay)} week / ${gauge.sevenDayFable === undefined ? "unread" : percent(gauge.sevenDayFable)} fable`,
          )
          .join(", ")}`;
  const wholeFleetRead = gauges.length === configured && gauges.length >= MERGEABLE_PLANS;
  const weekPastCard = (gauge: ClaudePlanGauge): boolean =>
    pastCard({ entry: { claim: "seven_day", gauge, window: gauge.sevenDay }, thresholds });
  if (wholeFleetRead && gauges.every(weekPastCard)) {
    return { fold, reactNow: [mergedAlert({ gauges, thresholds })] };
  }
  const reactNow = alertWindows({ gauges })
    .filter((entry) => pastCard({ entry, thresholds }))
    .map(
      (entry) =>
        `REACT NOW — ${entry.gauge.alias} ${entry.label} at ${levelOf({ entry, thresholds })}, resets ${entry.window.resetAtIso}: ` +
        `it stops ${entry.stops}; ${moveTo({ alias: entry.gauge.alias, gauges, label: entry.label, thresholds })}`,
    );
  return { fold, reactNow };
}
