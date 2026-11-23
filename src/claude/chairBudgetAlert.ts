/**
 * Say, before it happens, that the supervisor chair's OWN plan is nearing its wall. Pure: readings in, lines out.
 *
 * The supervisor must never go dead, because a dead supervisor is a dead fleet. `fleetBudgetAlert` already
 * prints a react-now line per closing window, but it names a PLAN, and nothing in it says that plan is the one
 * the chair is sitting on — so the reader had to join two lines in their head to learn the chair was about to stop. This module makes that join once, from the plans the live chair
 * sessions' boot credentials name (`seatBoot.ts`) — each of them when a split chair names more than one — and
 * never from a guess.
 *
 * ## The trigger is the provider's word or our own cap, never a new number
 *
 * A window warns when the provider grades it `allowed_warning` or `rejected`, or when it has reached the install's
 * routing bar (`thresholds.claude.routeAtPercent`), the cap routing spends to away from a reset. MEASURED: a plan's
 * Fable week read `allowed_warning` at 85% with `7d_oi-surpassed-threshold: 0.75`, which is the provider saying
 * "approaching" well before the wall. No percentage is invented here.
 *
 * It is the UN-lifted cap on purpose, never `select.ts`'s `spendCapFor`. In a weekly window's last five hours routing
 * lifts its cap to the wall itself, so an alert keyed on that cap first fires at 100% or `rejected` — after
 * the chair is capped, never before. Routing may still spend that plan to the wall; the chair is told first.
 *
 * On a weekly window the owner's usage limit binds, the same bar is a SHARE of that limit: the chair hears at
 * `routeAt` of the way to it (47.5% on a 50% plan by default, {@link claudeChairAlertPoint}), because routing stops
 * at the limit and a warning at the absolute 95% would never come. The line then names the limit. The five-hour
 * window and an unlimited plan keep the un-lifted bar.
 *
 * ## A paused chair plan is judged by its OWN usage limit
 *
 * The paused plan's reading is paired with its configured account's allowance and usage limit
 * ({@link chairProbeOf}), decoded exactly as the register decodes it (`claudePlanGauge`): an account naming neither is
 * a weekly window at 100%, as every router reads it, so the chair warns where main did. The probe's own reading never
 * stands in for the account's policy — a reading judged against 100% on a 50% plan is a chair warned too late.
 *
 * The chair is a Fable seat, so the place to move it is the plan the router would send the next FABLE spawn
 * to with the chair's own plan set aside — the same ranking every spawn uses, so the line never names a plan
 * a spawn would not go to.
 */
import type { ClaudeThresholds } from "../plans/thresholds.js";
import { weeklyUsageLimitOf } from "../plans/usageLimit.js";
import { type ClaudeAlertPoint, claudeChairAlertPoint } from "./budgetAlertPoint.js";
import { type ClaudeAccount, type ClaudePlanGauge, type ClaudeWindowReading, claudePlanGauge } from "./contracts.js";
import type { ClaudeGaugeOutcome } from "./gaugeRender.js";
import { rankClaudePlans } from "./loadBalance.js";
import type { ClaudeCapWindow } from "./select.js";

/**
 * What every chair line opens with. Exported so the status-line digest keeps these lines beside `REACT NOW`
 * ones by the same string, rather than a copy that could drift and silently drop the chair's warning.
 */
export const CHAIR_LINE_PREFIX = "CHAIR —";

/** A chair's paused plan whose probe beside the sweep failed: which plan, and why it has no reading. */
export interface ChairUnread {
  readonly alias: string;
  readonly problem: string;
}

/**
 * What probing a PAUSED chair plan beside a sweep returned — a reading, or why there is none. Both absent means
 * no such probe ran: the chair sits on a swept plan, is unread, or the sweep was narrowed.
 */
export interface ChairProbe {
  readonly chairReading?: ClaudePlanGauge;
  readonly chairUnread?: ChairUnread;
}

/**
 * Split the paused chair plan's probe outcome into its reading — paired with the paused account's own allowance and
 * usage limit — or its failure, so a failed probe is carried and warned about rather than dropped: a chair whose plan
 * cannot be read is exactly the chair that must be told. The policy is decoded by {@link claudePlanGauge}, the one
 * decoder every gauge goes through, so an account naming none reads as the register reads it: a weekly window at 100%.
 *
 * @param account the exact paused plan the probe read, whose usage policy the reading is judged by
 * @param outcome the probe's outcome
 * @returns the policy-bearing reading when one was taken, else the failure naming the plan
 */
export function chairProbeOf({
  account,
  outcome,
}: {
  account: Pick<ClaudeAccount, "allowance" | "usageLimitPercent">;
  outcome: ClaudeGaugeOutcome;
}): ChairProbe {
  if (outcome.gauge !== undefined) {
    return { chairReading: claudePlanGauge({ account, gauge: outcome.gauge }) };
  }
  if (outcome.problem !== undefined) {
    return { chairUnread: { alias: outcome.alias, problem: outcome.problem } };
  }
  return { chairUnread: { alias: outcome.alias, problem: "the probe returned neither a reading nor a reason" } };
}

/**
 * Every swept plan whose probe returned no reading, with why, so a chair seated on one is warned rather than
 * left with no line at all once the failed plan drops out of the readable gauges.
 *
 * @param outcomes each swept plan's probe outcome
 * @returns the unread plans, each naming its reason
 */
export function sweptUnreadOf({
  outcomes,
}: {
  outcomes: readonly Pick<ClaudeGaugeOutcome, "alias" | "gauge" | "problem">[];
}): readonly ChairUnread[] {
  return outcomes.flatMap((outcome): readonly ChairUnread[] => {
    if (outcome.gauge !== undefined) {
      return [];
    }
    if (outcome.problem !== undefined) {
      return [{ alias: outcome.alias, problem: outcome.problem }];
    }
    return [{ alias: outcome.alias, problem: "the probe returned neither a reading nor a reason" }];
  });
}

/** One of the chair plan's windows, labelled as a line names it. */
interface ChairWindow {
  /** Which window this is, which decides whether the plan's usage limit rebases its warning. */
  readonly claim: ClaudeCapWindow;
  readonly label: string;
  readonly window: ClaudeWindowReading;
}

/**
 * Every window the chair's plan carries. The five-hour window is absent on the Ultra shape (`contracts.ts`),
 * and the Fable week when the probe did not ask for it; neither absence is a warning.
 *
 * @param gauge the chair plan's reading
 * @returns each present window
 */
function chairWindows({ gauge }: { gauge: ClaudePlanGauge }): readonly ChairWindow[] {
  return [
    ...(gauge.fiveHour === undefined ? [] : [{ claim: "five_hour" as const, label: "5h", window: gauge.fiveHour }]),
    { claim: "seven_day", label: "week", window: gauge.sevenDay },
    ...(gauge.sevenDayFable === undefined
      ? []
      : [{ claim: "seven_day_fable" as const, label: "Fable week", window: gauge.sevenDayFable }]),
  ];
}

/**
 * Whether one window is close enough to its wall that the chair must be told now.
 *
 * @param point the chair's point on this window, from {@link claudeChairAlertPoint}
 * @param window the reading
 * @returns true when the provider warns or refuses, or the chair's point is reached
 */
function nearing({ point, window }: { point: ClaudeAlertPoint; window: ClaudeWindowReading }): boolean {
  if (window.status !== "allowed") {
    return true;
  }
  return window.utilization >= point.utilization;
}

/**
 * What a chair line adds when the owner's usage limit set the point it crossed: that limit, so the reader is never
 * left wondering why the chair is warned at 48%. Empty for a provider refusal — CAPPED is the provider's word, never
 * the owner's limit — and for a window the limit does not bind or that warned below the point.
 *
 * @param point the chair's point on this window
 * @param usageLimitPercent the plan's usage limit
 * @param window the reading
 * @returns the clause, opening with a comma, or the empty string
 */
function limitClause({
  point,
  usageLimitPercent,
  window,
}: {
  point: ClaudeAlertPoint;
  usageLimitPercent: number;
  window: ClaudeWindowReading;
}): string {
  if (point.source !== "usage-limit" || window.status === "rejected" || window.utilization < point.utilization) {
    return "";
  }
  const relation = window.utilization >= usageLimitPercent / 100 ? "at" : "nearing";
  return `, ${relation} your ${String(usageLimitPercent)}% usage limit`;
}

/**
 * One `CHAIR —` line per window of the chair's plan that is nearing its wall.
 *
 * @param alias the plan
 * @param gauge the plan's policy-bearing reading
 * @param move the hand-off clause every line ends on
 * @param thresholds the install's Claude thresholds, whose un-lifted routing bar is the chair's share
 * @returns the lines, empty when no window is nearing
 */
function nearingLines({
  alias,
  gauge,
  move,
  thresholds,
}: {
  alias: string;
  gauge: ClaudePlanGauge;
  move: string;
  thresholds: ClaudeThresholds;
}): readonly string[] {
  const { observedAtIso } = gauge;
  const usageLimitPercent = weeklyUsageLimitOf(gauge);
  return chairWindows({ gauge }).flatMap(({ claim, label, window }) => {
    const point = claudeChairAlertPoint({ claim, observedAtIso, thresholds, usageLimitPercent, window });
    if (!nearing({ point, window })) {
      return [];
    }
    const percent = `${String(Math.round(window.utilization * 100))}%`;
    const verdict = window.status === "rejected" ? "is CAPPED" : `is at ${percent} (${window.status})`;
    const limit = limitClause({ point, usageLimitPercent, window });
    return [
      `${CHAIR_LINE_PREFIX} the supervisor chair spends ${alias}, whose ${label} ${verdict}${limit}, resets ${window.resetAtIso}: ${move}`,
    ];
  });
}

/**
 * Every plan a live chair session spends, each once, in session order. A chair split across two plans — a
 * hand-off mid-flight, two tabs — has no unanimous `active`, yet each of its plans can still wall a live chair
 * session, so the warning reads this list rather than the `*` mark.
 *
 * @param sessions each live chair session's boot plan; one with no alias (unread, off-plan) names no plan
 * @returns the distinct plans named
 */
export function chairPlansOf({ sessions }: { sessions: readonly { readonly plan: object }[] }): readonly string[] {
  // `object`, not `{ alias?: string }`: a boot plan is a union whose off-plan arm has no alias at all, and the
  // gauge document's parsed slice types the alias `string | undefined` — both have to be accepted as they are.
  return [
    ...new Set(sessions.flatMap(({ plan }) => ("alias" in plan && typeof plan.alias === "string" ? [plan.alias] : []))),
  ];
}

/**
 * The lines that say a plan the chair spends is nearing a wall, empty when none is or when the chair is unread.
 * A split chair is warned about each of its plans, never none of them.
 *
 * @param chair every plan a live chair session spends, from {@link chairPlansOf}
 * @param chairReading the chair's plan read outside the routed set — a PAUSED plan a chair is still seated on,
 *   which a fleet-wide sweep never probes — so the chair is warned about it without it ever routing a spawn
 * @param chairUnread the chair's paused plan whose probe FAILED, which warns on its own: how near a wall an
 *   unread chair plan is cannot be known, and silence would read as "not nearing"
 * @param gauges every readable plan's reading, the set a hand-off target is ranked from
 * @param sweptUnread every SWEPT plan whose probe failed — a chair on an unpaused plan whose read failed is as
 *   unknown as a paused one, and dropping it from `gauges` alone would leave the chair with no line at all
 * @param thresholds the install's Claude thresholds — the routing bar, as a share of a binding weekly usage limit,
 *   triggers a line, and the ranking names the hand-off
 * @returns one `CHAIR —` line per nearing window, or one saying the chair's plan could not be read
 */
export function chairBudgetLines({
  chair,
  chairReading,
  chairUnread,
  gauges,
  sweptUnread = [],
  thresholds,
}: {
  chair: { readonly plans: readonly string[] };
  chairReading?: ClaudePlanGauge | undefined;
  chairUnread?: ChairUnread | undefined;
  gauges: readonly ClaudePlanGauge[];
  sweptUnread?: readonly ChairUnread[];
  thresholds: ClaudeThresholds;
}): readonly string[] {
  return chair.plans.flatMap((alias) =>
    planLines({ alias, chairReading, chairUnread, gauges, sweptUnread, thresholds }),
  );
}

/**
 * The chair lines for ONE plan a chair session spends.
 *
 * @param alias the plan
 * @param chairReading the chair's paused plan's reading, when one was taken
 * @param chairUnread the chair's paused plan's failed probe, when it failed
 * @param gauges every readable plan's reading
 * @param sweptUnread every swept plan whose probe failed
 * @param thresholds the install's Claude thresholds
 * @returns one `CHAIR —` line per nearing window, or one saying the plan could not be read
 */
function planLines({
  alias,
  chairReading,
  chairUnread,
  gauges,
  sweptUnread,
  thresholds,
}: {
  alias: string;
  chairReading: ClaudePlanGauge | undefined;
  chairUnread: ChairUnread | undefined;
  gauges: readonly ClaudePlanGauge[];
  sweptUnread: readonly ChairUnread[];
  thresholds: ClaudeThresholds;
}): readonly string[] {
  const others = gauges.filter((candidate) => candidate.alias !== alias);
  const next = rankClaudePlans({ gauges: others, modelClass: "fable", thresholds }).ranked[0];
  const move =
    next === undefined
      ? "no other plan can take a Fable chair, so it rides this plan to the wall"
      : `hand the chair to ${next.alias} before it walls`;
  const unknown = ({ where, problem }: { where: string; problem: string }): readonly string[] => [
    `${CHAIR_LINE_PREFIX} the supervisor chair spends ${alias}, ${where}whose reading failed (${problem}), so how near its wall it is is UNKNOWN: ${move}`,
  ];
  if (chairUnread?.alias === alias) {
    return unknown({ problem: chairUnread.problem, where: "PAUSED for routing, " });
  }
  const swept = sweptUnread.find((candidate) => candidate.alias === alias);
  if (swept !== undefined) {
    return unknown({ problem: swept.problem, where: "" });
  }
  const gauge = [...gauges, ...(chairReading === undefined ? [] : [chairReading])].find(
    (candidate) => candidate.alias === alias,
  );
  // A chair plan this sweep took no reading of — a second paused plan of a split chair, or one a narrowed sweep
  // skipped — is as unknown as a failed one: silence would read as "not nearing".
  if (gauge === undefined) {
    return unknown({ problem: "this sweep took no reading of it", where: "" });
  }
  return nearingLines({ alias, gauge, move, thresholds });
}

/**
 * The reading of a PAUSED plan the chair still spends, as one line. The gauge table draws only the plans the
 * sweep routes, so without this a healthy paused chair plan would be read and then shown nowhere.
 *
 * @param chairReading the chair's paused plan, read beside the sweep
 * @returns the line naming each window it carries
 */
export function chairReadingLine({ chairReading }: { chairReading: ClaudePlanGauge }): string {
  const windows = chairWindows({ gauge: chairReading }).map(
    ({ label, window }) => `${label} ${String(Math.round(window.utilization * 100))}% (${window.status})`,
  );
  return `chair: ${chairReading.alias} is PAUSED for routing and read for the chair alone — ${windows.join(", ")}, week resets ${chairReading.sevenDay.resetAtIso}`;
}
