/**
 * The plans' ceilings as `machine capacity` prints them, and the per-plan readers the Fleet page's glance
 * (`./fleetGlance.ts`) judges with: which plans are Claude's, a plan's alias, where its week stands, and whether its
 * five-hour window binds.
 */

/** A plan window's length the seven-day reading is measured over. */
const WEEK_MS = 7 * 24 * 60 * 60_000;

/** One window on a plan's ceiling, as `machine capacity` printed it. */
export interface GlanceWindow {
  readonly window: string;
  readonly used: number;
  readonly available: number;
  /** When the window resets; absent for a window with no reset (the machine's load). */
  readonly resetAtIso: string | undefined;
}

/** A ceiling's status, as `src/capacity/ceilings.ts` closes it. */
export type GlanceStatus = "open" | "held" | "paused" | "at-usage-limit" | "refusing" | "unreadable";

/** The statuses a reader admits — a word outside them is a shape that moved. */
export const GLANCE_STATUSES: readonly GlanceStatus[] = [
  "open",
  "held",
  "paused",
  "at-usage-limit",
  "refusing",
  "unreadable",
];

/**
 * A paused plan's week as the reading in force at its pause carried it, or why there was none. A paused plan is never
 * probed, so this is the only week the page can show for it.
 */
export type GlancePausedWeek =
  | {
      readonly kind: "read";
      readonly used: number;
      readonly available: number;
      readonly resetAtIso: string | undefined;
      /** When that earlier reading was taken. */
      readonly readAtIso: string;
    }
  | { readonly kind: "unavailable"; readonly why: string };

/** When a plan was paused, and its week at that moment. */
export interface GlancePause {
  readonly sinceIso: string;
  readonly weekAtPause: GlancePausedWeek;
}

/** One plan's ceiling, Claude or Codex, narrowed to what the glance and the plan meters read. */
export interface GlancePlan {
  /** `claude:<alias>` or `codex:<alias>`. */
  readonly id: string;
  readonly provider: "claude" | "codex";
  /** `open` takes new work; anything else does not. */
  readonly status: GlanceStatus;
  /** A paused Claude plan's pause; absent on every other plan, and on a capture from before the field. */
  readonly pause: GlancePause | undefined;
  /** Why a plan that is not open is not, in the verb's own words. */
  readonly reason: string | undefined;
  readonly windows: readonly GlanceWindow[];
  /**
   * Whose plan it is, as the provider's account cell renders it; `null` when the reading recorded none, `undefined`
   * on a capture from before the field.
   */
  readonly account: string | null | undefined;
  /**
   * Free usage-limit resets held unused; `null` when the reading says it did not read them, `undefined` on a
   * capture from before the field.
   */
  readonly freeResets: number | null | undefined;
}

/** The plans' ceilings: read, absent from a reading that predates them, or present and unreadable. */
export type GlancePlans =
  | {
      readonly kind: "read";
      readonly plans: readonly GlancePlan[];
      /** The ceiling the selected route is limited by — `machine` or a plan id — when the reading names one. */
      readonly lowest: string | undefined;
    }
  | { readonly kind: "absent" }
  | { readonly kind: "unreadable" };

/**
 * The Claude plans alone — every verdict here judges Claude's weeks, and a Codex plan beside them is shown, never
 * counted.
 *
 * @returns the Claude plans, in reading order
 */
export function claudePlansOf({ plans }: { plans: readonly GlancePlan[] }): readonly GlancePlan[] {
  return plans.filter((plan) => plan.provider === "claude");
}

/**
 * A plan's alias off its ceiling id: `claude:plan-two` → `plan-two`.
 *
 * @returns the alias
 */
export function aliasOf({ id }: { id: string }): string {
  const at = id.indexOf(":");
  if (at === -1) {
    return id;
  }
  return id.slice(at + 1);
}

/**
 * Where this plan's week stands against its own clock — less of the week used than of the week elapsed is behind.
 *
 * @returns `behind` or `ahead`, or `unread` when it carries no seven-day window with a reset and an allowance
 */
export function weekPaceOf({ plan, nowMs }: { plan: GlancePlan; nowMs: number }): "behind" | "ahead" | "unread" {
  const week = plan.windows.find((window) => window.window === "seven-day");
  if (week?.resetAtIso === undefined || week.available <= 0) {
    return "unread";
  }
  const resetMs = Date.parse(week.resetAtIso);
  if (Number.isNaN(resetMs)) {
    return "unread";
  }
  const elapsed = Math.min(1, Math.max(0, 1 - (resetMs - nowMs) / WEEK_MS));
  if (week.used / week.available < elapsed) {
    return "behind";
  }
  return "ahead";
}

/**
 * Is any plan that is not open stopped by its five-hour window rather than its week?
 *
 * @returns true when a closed plan's five-hour window reads at its cap
 */
export function fiveHourBinds({ plans }: { plans: readonly GlancePlan[] }): boolean {
  return plans.some(
    (plan) =>
      plan.status !== "open" &&
      plan.windows.some((window) => window.window === "five-hour" && window.used >= window.available),
  );
}
