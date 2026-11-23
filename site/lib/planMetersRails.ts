/**
 * One plan's row on the Fleet page's plan usage block (`./planMeters.ts`): its bars (week, a five-hour session only
 * when the reading carries one, free reset), its status and its tone, read off the plan's ceiling. Pure.
 */
import { aliasOf, type GlancePlan, type GlanceStatus, type GlanceWindow } from "./fleetGlancePlans";
import { accountTitleOf, counted, resetWords, statusWordsOf } from "./planMetersWords";
import { type UsageLimitStop, usageLimitStopOf } from "./planUsageLimit";

/** Whether a plan takes new work, in three tones the rails colour. */
export type PlanTone = "open" | "stopped" | "unread";

/** One of a plan's bars. */
export interface PlanRail {
  readonly key: "week" | "session" | "reset";
  /** `week`, `5-hour session` (drawn only when the reading carries that window), `free reset`. */
  readonly label: string;
  /** What the bar reads as: `44% left`, `1 available`, `none held`, `not read`. */
  readonly figure: string;
  /** The fill, 0..100: the share left for a window, full or empty for the reset. */
  readonly barPercent: number;
  /** False when the bar stands empty because nothing was read, so it draws as missing rather than as spent. */
  readonly measured: boolean;
  /** The rest, for the open row: the used share and the reset, or what the reading knows of the free resets. */
  readonly detail: string;
}

/** One plan, as its host's open line lists it. */
export interface PlanRow {
  /** The ceiling id, for keys only — never shown. */
  readonly id: string;
  /** The plan's alias, `plan-two` — the name the row shows. */
  readonly alias: string;
  /** The signed-in account, for the hover: its email, or what the reading said of it. */
  readonly accountTitle: string;
  /** What the status means: `taking new work`, `paused on purpose since hh:mmZ — never hit a limit`. */
  readonly status: string;
  readonly tone: PlanTone;
  /** The week, then the five-hour session only when the reading carries one, then the free reset. */
  readonly rails: readonly PlanRail[];
  /** Claude's Fable week as one line, shown beside the bars and never counted; `undefined` when none was read. */
  readonly fable: string | undefined;
  /**
   * Set when the plan's own read failed this time: the row is a staleness mark naming the plan and why, in place of its
   * status and bars, since every figure it would draw is one the failed read did not give.
   */
  readonly unread: { readonly subject: string; readonly why: string } | undefined;
  /**
   * Set when the plan takes no new work because of the usage limit, or because nothing here measures its monthly
   * spend (`./planUsageLimit.ts`): the raise button's press when one is offered. `undefined` on every other plan.
   */
  readonly usageLimit: UsageLimitStop | undefined;
}

/** Each host's weekly window, the one its average is taken over. */
export const WEEK_WINDOW: Readonly<Record<"claude" | "codex", string>> = { claude: "seven-day", codex: "weekly" };

/** The session window both hosts name. */
const SESSION_WINDOW = "five-hour";

/**
 * The share of a window left, 0..100, or `undefined` when the window carries no allowance to measure against.
 *
 * @returns the share left
 */
export function leftOf({ window }: { window: GlanceWindow }): number | undefined {
  if (window.available <= 0) {
    return undefined;
  }
  // Multiplied first, so a window already in percent reads back exactly: 56 * 100 / 100 is 56, 0.56 * 100 is not.
  const used = (window.used * 100) / window.available;
  return Math.min(100, Math.max(0, 100 - used));
}

/**
 * A window's bar: its share left, its used share and its reset — or, for a window the reading lacks, that it lacks it.
 *
 * @returns the rail
 */
function windowRail({
  key,
  label,
  window,
  nowMs,
}: {
  key: "week" | "session";
  label: string;
  window: GlanceWindow | undefined;
  nowMs: number;
}): PlanRail {
  if (window === undefined) {
    return {
      barPercent: 0,
      detail: `this reading carried no ${label} window for the plan`,
      figure: "not in this reading",
      key,
      label,
      measured: false,
    };
  }
  const reset = resetWords({ nowMs, resetAtIso: window.resetAtIso });
  const left = leftOf({ window });
  if (left === undefined) {
    return {
      barPercent: 0,
      detail: `no allowance to measure against · ${reset}`,
      figure: "not measured",
      key,
      label,
      measured: false,
    };
  }
  const used = (window.used * 100) / window.available;
  return {
    barPercent: left,
    detail: `${String(Math.round(used))}% used · ${reset}`,
    figure: `${String(Math.round(left))}% left`,
    key,
    label,
    measured: true,
  };
}

/**
 * The free-reset bar: full with one or more held, empty with none, and drawn as missing when the reading did not read.
 *
 * @returns the rail
 */
function resetRail({ plan }: { plan: GlancePlan }): PlanRail {
  const label = "free reset";
  if (plan.freeResets === undefined) {
    return {
      barPercent: 0,
      detail: "free resets not recorded in this reading",
      figure: "not read",
      key: "reset",
      label,
      measured: false,
    };
  }
  if (plan.freeResets === null) {
    let detail = "free resets not read";
    if (plan.provider === "claude") {
      // The offer shares the probe's 429 budget, so the tick never reads it (`src/claude/resetStatus.ts`).
      detail = "not read by the tick; slopweaver claude reset --plan reads it";
    }
    return { barPercent: 0, detail, figure: "not read", key: "reset", label, measured: false };
  }
  if (plan.freeResets === 0) {
    return { barPercent: 0, detail: "no free reset held", figure: "none held", key: "reset", label, measured: true };
  }
  return {
    barPercent: 100,
    detail: `${counted({ n: plan.freeResets, noun: "free reset" })} unused`,
    figure: `${String(plan.freeResets)} available`,
    key: "reset",
    label,
    measured: true,
  };
}

/**
 * A status as one of three tones.
 *
 * @returns the tone
 */
function toneOf({ status }: { status: GlanceStatus }): PlanTone {
  if (status === "open") {
    return "open";
  }
  if (status === "unreadable") {
    return "unread";
  }
  return "stopped";
}

/**
 * A paused Claude plan's week: what was left when it was paused and when that week resets, read off the capacity
 * reading in force at the pause — a paused Claude plan is never probed, so there is no newer figure.
 *
 * @returns the rail
 */
function pausedWeekRail({ plan, nowMs }: { plan: GlancePlan; nowMs: number }): PlanRail {
  const label = "week";
  if (plan.pause === undefined) {
    return {
      barPercent: 0,
      detail: "this reading predates the week a plan carries at its pause",
      figure: "not read while paused",
      key: "week",
      label,
      measured: false,
    };
  }
  const week = plan.pause.weekAtPause;
  if (week.kind === "unavailable") {
    return {
      barPercent: 0,
      detail: `not read while paused: ${week.why}`,
      figure: "not read while paused",
      key: "week",
      label,
      measured: false,
    };
  }
  const rail = windowRail({
    key: "week",
    label,
    nowMs,
    window: { available: week.available, resetAtIso: week.resetAtIso, used: week.used, window: "seven-day" },
  });
  if (!rail.measured) {
    return rail;
  }
  return { ...rail, figure: `${rail.figure} when paused` };
}

/**
 * One plan's row.
 *
 * @returns the row
 */
export function planRowOf({ plan, nowMs }: { plan: GlancePlan; nowMs: number }): PlanRow {
  const windowNamed = (name: string): GlanceWindow | undefined => plan.windows.find((window) => window.window === name);
  let fable: string | undefined;
  const fableWeek = windowNamed("fable-seven-day");
  if (fableWeek !== undefined) {
    const left = leftOf({ window: fableWeek });
    let figure = "not measured";
    if (left !== undefined) {
      figure = `${String(Math.round(left))}% left`;
    }
    fable = `Fable week ${figure} · ${resetWords({ nowMs, resetAtIso: fableWeek.resetAtIso })} (shown, never counted)`;
  }
  const paused = plan.status === "paused";
  let week = windowRail({ key: "week", label: "week", nowMs, window: windowNamed(WEEK_WINDOW[plan.provider]) });
  // The session bar is drawn only for a plan whose reading carries a five-hour window. Measured, none does: every
  // Claude probe answers the weekly trios alone and Codex writes its weekly window alone (`slopweaver claude gauge`,
  // `slopweaver codex gauge`), so a standing bar would draw a limit that no longer exists, as "no limit" or "not read".
  const sessionWindow = windowNamed(SESSION_WINDOW);
  let session: readonly PlanRail[] = [];
  if (sessionWindow !== undefined) {
    session = [windowRail({ key: "session", label: "5-hour session", nowMs, window: sessionWindow })];
  }
  // Only a paused CLAUDE plan goes unread. A paused weekly Codex row is still read for its sign-in and limits
  // (`src/codex/fleetRead.ts`), so its ceiling carries this reading's windows and they are drawn as read. A paused
  // Claude plan is never probed, so it draws no session bar either: its week at the pause is all there is.
  if (paused && plan.provider === "claude") {
    week = pausedWeekRail({ nowMs, plan });
    session = [];
  }
  const alias = aliasOf({ id: plan.id });
  const usageLimit = usageLimitStopOf({ plan });
  let unread: PlanRow["unread"];
  // A plan nothing measures is unreadable BY DESIGN, not a failed read, so it keeps its row and says why.
  if (plan.status === "unreadable" && usageLimit === undefined) {
    let why = "its probe failed and the reading gave no reason";
    if (plan.reason !== undefined) {
      why = plan.reason;
    }
    unread = { subject: `${alias}'s usage`, why };
  }
  return {
    accountTitle: accountTitleOf({ plan }),
    alias,
    fable,
    id: plan.id,
    rails: [week, ...session, resetRail({ plan })],
    status: statusWordsOf({ nowMs, plan }),
    tone: toneOf({ status: plan.status }),
    unread,
    usageLimit,
  };
}
