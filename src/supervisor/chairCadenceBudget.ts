/**
 * The plan-budget half of the chair's hand-off cadence: whether the plan a chair session spends is near its wall,
 * out of band against the plan routing picks, or invisible while a measured plan is the route. Split from
 * `./chairCadence.ts` when the bars it judges by moved into the plan register; that module carries the rulings.
 *
 * Both bars ride on the gauge (`ChairCadenceGauge`'s `thresholds`) and each reason carries the bar that produced
 * it, so the renderer (`./chairCadenceLines.ts`) prints the policy the verdict was judged under, never a constant.
 *
 * Pure: readings in, reasons out.
 */
import type { ChairCadenceGauge, ChairCadenceReason } from "./chairCadence.js";

/** The readable arm of the gauge, the only one a budget reason is judged off. */
type ReadGauge = Extract<ChairCadenceGauge, { kind: "read" }>;

/**
 * The plan-budget reasons for one session's resolved plan.
 *
 * A window under the routing bar while routing picks the chair's own plan is a NOTE: the successor would land on
 * the same plan. A window AT or past its spawn bar — the routing bar, or the owner's usage limit where that is lower
 * ({@link spawnBarOf}) — is a reason whatever routing picks, because a Fable seat is refused there
 * (`../claude/fableSeatBars.ts`'s `fableSeatThresholds`, the chair's Fable week included), so a route naming it is one this tick must not trust.
 * MEASURED: a tick's close printed `plan-two is at 95% of its seven-day week, but the next
 * Fable spawn routes to plan-two too … not a reason to hand off` while the plan was at 96%.
 *
 * A plan the gauge names LEVEL with the chair route ({@link levelWithRoute}) is judged as the route itself, its drift
 * against the route included: a successor there buys under a point of balance for a whole boot.
 *
 * A window under the spawn bar while a complete gauge routes to a DIFFERENT plan already at or past the alert bar on
 * either weekly window is a note too ({@link alertedRoute}): the successor would read the same reason at its first
 * close, so the hand-off buys a boot and no headroom.
 *
 * @param alias the plan the session spends
 * @param gauge the tick's readable gauge, carrying the bars it was judged under
 * @returns the reasons, and a note when the plan has no row in the gauge
 */
export function planReasons({ alias, gauge }: { alias: string; gauge: ReadGauge }): {
  reasons: readonly ChairCadenceReason[];
  notes: readonly string[];
} {
  const row = gauge.plans.find((entry) => entry.plan === alias);
  if (row === undefined) {
    return {
      notes: [`${alias}'s budget is UNMEASURED — it has no complete reading in this tick's gauge`],
      reasons: [...weekOnlyAtCap({ alias, gauge }), ...unmeasuredReasons({ alias, gauge })],
    };
  }
  const thresholdPercent = gauge.thresholds.alertAtPercent;
  const capPercent = spawnBarOf({ gauge, usageLimitPercent: row.usageLimitPercent });
  const near: Extract<ChairCadenceReason, { kind: "plan-window-near" }>[] = [];
  for (const [window, pct] of [
    ["seven-day", row.weekPct],
    ["seven-day Fable", row.fablePct],
  ] as const) {
    if (pct >= thresholdPercent) {
      near.push({ alias, kind: "plan-window-near", pct, thresholdPercent, window });
    } else if (pct >= capPercent) {
      near.push({ alias, kind: "plan-window-near", pct, thresholdPercent: capPercent, window });
    }
  }
  const level = levelWithRoute({ alias, gauge });
  const drift = driftAgainstRoute({ alias, fablePct: row.fablePct, gauge, level });
  const routesHere = gauge.gap === undefined && (gauge.nextChair === alias || level);
  if (routesHere) {
    const atCap = near
      .filter((reason) => reason.pct >= capPercent)
      .map((reason) => ({ ...reason, thresholdPercent: capPercent }));
    const sameRoute = near
      .filter((reason) => reason.pct < capPercent)
      .map((reason) => sameRouteNote({ alias, gauge, level, pct: reason.pct, window: reason.window }));
    return { notes: [...sameRoute, ...drift.notes], reasons: [...atCap, ...drift.reasons] };
  }
  const alerted = alertedRoute({ gauge });
  if (alerted === undefined) {
    return { notes: drift.notes, reasons: [...near, ...drift.reasons] };
  }
  const kept = near.filter((reason) => reason.pct >= capPercent);
  const alsoPast = near
    .filter((reason) => reason.pct < capPercent)
    .map((reason) => {
      const destination = alertedWindowOf({ preferred: reason.window, row: alerted, thresholdPercent });
      return `${alias} is at ${String(reason.pct)}% of its ${reason.window} week, but the chair's successor routes to ${alerted.plan}, itself at ${String(destination!.pct)}% of its ${destination!.window} week, so a successor would be just as far past the bar — not a reason to hand off until a plan under it is the route or ${alias} reaches its spawn bar`;
    });
  return { notes: [...alsoPast, ...drift.notes], reasons: [...kept, ...drift.reasons] };
}

/**
 * Whether the chair's plan is LEVEL with the chair route: a different plan the gauge counted within one point of
 * chair headroom of it (`../claude/loadBalance.ts`'s `chairLevelWith`). A successor there buys under a point of
 * balance for a whole boot, so the cadence judges the plan as if the route were its own. MEASURED, one
 * chair: routed to plan-one at 87%, told to hand off twelve minutes later when its own draw moved the route to
 * plan-three by under a point, about 167k of context for one pass. Reproduce:
 * `yarn vitest run --config config/vitest/unit.ts src/__tests__/unit/claude/chairHandOffLineRoute.test.ts`.
 *
 * @param alias the plan the session spends
 * @param gauge the tick's readable gauge; a partial one, or a row recorded before the gauge carried the level plans,
 *   counts no plan level
 * @returns true when the gauge names the plan level with the route
 */
function levelWithRoute({ alias, gauge }: { alias: string; gauge: ReadGauge }): boolean {
  if (gauge.gap !== undefined || gauge.chairLevelWith === undefined) {
    return false;
  }
  return gauge.chairLevelWith.includes(alias);
}

/**
 * The note for a window past the alert bar on a plan the chair's successor would take anyway, or one level with it.
 *
 * @param alias the plan the session spends
 * @param gauge the tick's readable gauge, naming the route
 * @param level whether the plan is level with a DIFFERENT route rather than the route itself
 * @param pct the window's percentage
 * @param window which weekly window it is
 * @returns the note
 */
function sameRouteNote({
  alias,
  gauge,
  level,
  pct,
  window,
}: {
  alias: string;
  gauge: ReadGauge;
  level: boolean;
  pct: number;
  window: WeekWindow;
}): string {
  const at = `${alias} is at ${String(pct)}% of its ${window} week`;
  if (level) {
    return `${at}, but the chair's successor routes to ${String(gauge.nextChair)}, level with ${alias} within one point of headroom, so a successor would buy no balance — not a reason to hand off until routing moves off it`;
  }
  return `${at}, but the chair's successor routes to ${alias} too, so a successor would land on the same plan — not a reason to hand off until routing moves off it`;
}

/** One plan's complete row in a read gauge. */
type PlanRow = ReadGauge["plans"][number];

/** The two weekly windows a `plan-window-near` reason names. */
type WeekWindow = Extract<ChairCadenceReason, { kind: "plan-window-near" }>["window"];

/**
 * The plan a complete gauge routes the next Fable spawn to, when that plan is ALREADY at or past the alert bar on
 * either weekly window — the destination a successor would be told to leave on its own first close. MEASURED:
 * with every routable plan past 75% of its week (`slopweaver claude gauge`: plan-one 87, plan-two 82,
 * plan-three 89, plan-four 78, plan-five held for the browser), three chairs in a row each closed one or two passes
 * and handed off to another plan past the bar, each boot spending about a third of the chair's context window.
 *
 * @param gauge the tick's readable gauge
 * @returns the routed plan's row, or nothing when the gauge is partial, the route is unmeasured or under the bar
 */
function alertedRoute({ gauge }: { gauge: ReadGauge }): PlanRow | undefined {
  if (gauge.gap !== undefined || gauge.nextChair === null) {
    return undefined;
  }
  const route = gauge.plans.find((entry) => entry.plan === gauge.nextChair);
  if (route === undefined) {
    return undefined;
  }
  const thresholdPercent = gauge.thresholds.alertAtPercent;
  if (route.weekPct < thresholdPercent && route.fablePct < thresholdPercent) {
    return undefined;
  }
  return route;
}

/**
 * Which of a routed plan's weekly windows is at or past the alert bar, the one the chair's own reason named first.
 *
 * @param preferred the window the chair's reason fired on, named when the destination is past the bar on it too
 * @param row the routed plan's row
 * @param thresholdPercent the alert bar
 * @returns the window and its percentage, or nothing when neither is past the bar
 */
function alertedWindowOf({
  preferred,
  row,
  thresholdPercent,
}: {
  preferred: WeekWindow;
  row: PlanRow;
  thresholdPercent: number;
}): { readonly pct: number; readonly window: WeekWindow } | undefined {
  const windows: readonly { readonly pct: number; readonly window: WeekWindow }[] = [
    { pct: row.weekPct, window: "seven-day" },
    { pct: row.fablePct, window: "seven-day Fable" },
  ];
  const ordered = [
    ...windows.filter((entry) => entry.window === preferred),
    ...windows.filter((entry) => entry.window !== preferred),
  ];
  return ordered.find((entry) => entry.pct >= thresholdPercent);
}

/**
 * The at-cap reason for a plan with no complete row: its all-models week read fresh, its Fable week did not, and
 * that week alone is at the routing bar. Without it a chair on such a plan read STAY whenever no other measured
 * plan was the Fable route.
 *
 * @param alias the plan the session spends, which has no complete row
 * @param gauge the tick's readable gauge
 * @returns the reason, or none when the week was not read or is under the routing bar
 */
function weekOnlyAtCap({ alias, gauge }: { alias: string; gauge: ReadGauge }): readonly ChairCadenceReason[] {
  const week = gauge.weekOnly?.find((entry) => entry.plan === alias);
  if (week === undefined) {
    return [];
  }
  const capPercent = spawnBarOf({ gauge, usageLimitPercent: week.usageLimitPercent });
  if (week.weekPct < capPercent) {
    return [];
  }
  return [{ alias, kind: "plan-window-near", pct: week.weekPct, thresholdPercent: capPercent, window: "seven-day" }];
}

/**
 * The bar a Fable seat is refused at on one plan: the routing bar, lowered to the owner's usage limit when they set
 * one below it, because routing refuses there too (`../claude/loadBalance.ts`'s `planExcludedBy`, through
 * `claudeWindowExclusion`). A usage limit is respected even if it means taking the fleet down
 * (`../plans/usageLimit.ts`). Without it a chair on a plan limited to 50% read STAY at 50%, the week routing had
 * already closed to its successor.
 *
 * @param gauge the tick's readable gauge, carrying the routing bar
 * @param usageLimitPercent the plan's usage limit, absent when its reading carried no usage policy
 * @returns the lower of the routing bar and the usage limit
 */
function spawnBarOf({ gauge, usageLimitPercent }: { gauge: ReadGauge; usageLimitPercent: number | undefined }): number {
  const routeAtPercent = gauge.thresholds.routeAtPercent;
  if (usageLimitPercent === undefined) {
    return routeAtPercent;
  }
  return Math.min(routeAtPercent, usageLimitPercent);
}

/**
 * The invisible-plan reason: the chair's plan has no complete reading while the plan routing picks for a Fable
 * spawn is a DIFFERENT plan that does. It fires on a PARTIAL gauge on purpose — a failed probe is what makes the
 * gauge partial, and that is the exact tick plan-five walled on. A whole-gauge outage has no measured alternative,
 * so it never fires; a one-plan transient costs one handoff, which the successor's live spawn gate re-measures.
 *
 * @param alias the plan the session spends, which has no row
 * @param gauge the tick's readable gauge
 * @returns the reason, or none when no different measured plan is the route
 */
function unmeasuredReasons({ alias, gauge }: { alias: string; gauge: ReadGauge }): readonly ChairCadenceReason[] {
  const routeAlias = gauge.nextChair;
  const routeMeasured = gauge.plans.some((entry) => entry.plan === routeAlias);
  if (routeAlias === null || routeAlias === alias || !routeMeasured) {
    return [];
  }
  return [{ alias, kind: "plan-unmeasured", routeAlias }];
}

/**
 * The drifting-band reason: the session's plan's Fable week against the plan routing picks for a Fable spawn.
 * A routed half with no reading is said out loud rather than read as a stay.
 *
 * @param alias the plan the session spends
 * @param fablePct that plan's seven-day Fable percentage
 * @param gauge the tick's readable gauge, whose drifting band is the limit
 * @param level whether the plan is level with the route, which judges it as the route itself
 * @returns the reason when the gap is past the band, or a note when the routed plan is UNMEASURED
 */
function driftAgainstRoute({
  alias,
  fablePct,
  gauge,
  level,
}: {
  alias: string;
  fablePct: number;
  gauge: ReadGauge;
  level: boolean;
}): {
  reasons: readonly ChairCadenceReason[];
  notes: readonly string[];
} {
  if (gauge.gap !== undefined) {
    return {
      notes: ["the drift band is UNMEASURED — a PARTIAL gauge cannot say which plan routing picks"],
      reasons: [],
    };
  }
  if (gauge.nextChair === null) {
    return {
      notes: ["no plan is eligible for a Fable spawn this tick, so the drift band had nothing to compare against"],
      reasons: [],
    };
  }
  const route = gauge.plans.find((entry) => entry.plan === gauge.nextChair);
  if (route === undefined) {
    return {
      notes: [
        `the routed plan ${gauge.nextChair}'s Fable week is UNMEASURED — it has no complete reading in this tick's gauge`,
      ],
      reasons: [],
    };
  }
  const thresholdPoints = gauge.thresholds.driftingSpreadPercent;
  if (route.plan === alias || level || fablePct - route.fablePct <= thresholdPoints) {
    return { notes: [], reasons: [] };
  }
  return {
    notes: [],
    reasons: [
      {
        alias,
        fablePct,
        kind: "plan-asymmetric",
        routeAlias: route.plan,
        routeFablePct: route.fablePct,
        thresholdPoints,
      },
    ],
  };
}
