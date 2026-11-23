/**
 * Why routing stopped on one plan, when the reason is the owner's own usage limit, and the one press that raises it.
 * Pure.
 *
 * A usage limit set at a share of the plan turns the fleet off rather than exceed that share: if the cap is thirty percent the fleet turns off rather than exceed thirty percent. So a plan
 * the capacity reading calls `at-usage-limit` is stopped by the owner's setting, never by the provider, and the page says so in
 * those words — never "capped", which this repository spends on a provider's own exhaustion
 * (`src/plans/usageLimit.ts` § One concept, one name). Beside it sits one button, "raise the usage limit to 40% and
 * continue", which writes `plans set-usage-limit` one step up. Routing reads the register when it picks a plan, so a
 * raise lets the next spawn through at once; the row on this page moves only when the next capacity reading is taken.
 *
 * Where the current limit comes from: the plan's WEEKLY window's `available`, which `src/capacity/ceilings.ts` § Units
 * documents IS the usage limit (`seven-day` for Claude, `weekly` for Codex; Claude's Fable week must agree). A window missing, or an `available` that is
 * not one of the ten steps, is said rather than guessed at — a raise built off a guessed limit would be refused by the
 * verb's own `--from` anyway, but a button that can only be refused is not drawn.
 *
 * A plan whose allowance is a monthly spend is NOT MEASURED and is never routed autonomous work, whatever its limit:
 * raising it changes nothing, so it carries the reason and no button.
 */
import type { GlancePlan } from "./fleetGlancePlans";
import { aliasOf } from "./fleetGlancePlans";
import type { LiveState } from "./liveState";

/** The act row the raise presses (`./actVerbs.ts`). */
export const RAISE_USAGE_LIMIT_SLUG = "plans-raise-usage-limit";

/** The live channel the raise's press re-reads: the recorded capacity reading the plan rows are drawn from. */
export const RAISE_USAGE_LIMIT_READS = "capacity-reading";

/**
 * Every value a usage limit may take, smallest first — `src/plans/usageLimit.ts`'s `USAGE_LIMIT_PERCENTS`, which the
 * site cannot import; `site/__tests__/unit/planUsageLimit.test.ts` holds the two lists equal.
 */
export const USAGE_LIMIT_STEPS: readonly number[] = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];

/**
 * The sentence `src/plans/usageLimit.ts`'s `CODEX_MONTHLY_SPEND_NOT_MEASURED` puts on a Codex monthly-spend plan,
 * which nothing measures, as the capacity reading carries it in `reason`. A Claude monthly-spend plan with no fresh
 * spend reading carries that verdict's own reason instead, and draws as a failed read naming `claude spend`. Held
 * equal to the source by the same test.
 */
export const CODEX_MONTHLY_SPEND_NOT_MEASURED =
  "monthly spend is NOT MEASURED; nothing reads a ChatGPT plan's flexible credits, so this plan takes no autonomous work";

/**
 * What a Claude monthly-spend plan's exclusion reason opens with — `src/plans/usageLimit.ts`'s
 * `MONTHLY_SPEND_REASON_PREFIX`, held equal to it by the same test.
 */
export const MONTHLY_SPEND_REASON_PREFIX = "monthly spend: ";

/** The one window a Claude monthly-spend plan's ceiling carries: the share of its permitted spend used. */
const MONTHLY_SPEND_WINDOW = "monthly-spend";

/**
 * Whether a plan's allowance is a monthly spend rather than a weekly window — a Codex one nothing measures, or a
 * Claude one judged on its spend, open (it carries the spend window) or excluded (its reason opens with the prefix).
 * It has no week, so a week average sets it aside rather than reading it as a week that failed to read.
 *
 * @returns true for a monthly-spend plan
 */
export function isMonthlySpendPlan({ plan }: { plan: GlancePlan }): boolean {
  if (plan.windows.some((window) => window.window === MONTHLY_SPEND_WINDOW)) {
    return true;
  }
  if (plan.reason === undefined) {
    return false;
  }
  return plan.reason === CODEX_MONTHLY_SPEND_NOT_MEASURED || plan.reason.startsWith(MONTHLY_SPEND_REASON_PREFIX);
}

/** Each host's weekly window, the one a usage limit lowers. */
const LIMITED_WINDOW: Readonly<Record<"claude" | "codex", string>> = { claude: "seven-day", codex: "weekly" };

/**
 * Claude's Fable week, which the same limit lowers (`src/capacity/ceilings.ts`) but which routing reads only for a
 * Fable spawn (`src/claude/loadBalance.ts`'s `planExcludedBy`): a full Fable week stops Fable work, never the plan.
 */
const FABLE_WEEK = "fable-seven-day";

/** Why one plan takes no new work when the reason is the usage limit, and what may be done about it. */
export type UsageLimitStop =
  /** At the owner's limit below the whole week: the raise is offered. */
  | {
      readonly kind: "raise";
      readonly words: string;
      readonly limitPercent: number;
      readonly nextPercent: number;
      readonly label: string;
      readonly slots: Readonly<Record<string, string>>;
    }
  /** At the owner's limit, but the limit is already the whole week, or the limit could not be read: no button, and why. */
  | { readonly kind: "no-raise"; readonly words: string }
  /** A monthly-spend plan nothing here measures: never routed, and raising would not change that. */
  | { readonly kind: "not-measured"; readonly words: string };

/**
 * Why the raise holds, when it does: a fixture page acts on nothing, and a capacity reading kept over a failed read
 * or handed over while its replacement is on its way is not one the page may act from. `--from` would refuse a press
 * off a limit the row no longer holds anyway; this keeps the button from being one that can only be refused.
 *
 * @param fixture the fixture name when the page is frozen
 * @param state the capacity reading the plan rows are drawn from
 * @returns why the raise holds, or `undefined` when it may be pressed
 */
export function raiseHeldOf({
  fixture,
  state,
}: {
  fixture: string | undefined;
  state: LiveState<unknown>;
}): string | undefined {
  if (fixture !== undefined) {
    return `a fixture (${fixture}), so the raise is off`;
  }
  if (state.phase !== "ready") {
    return "the capacity reading has not answered, so the raise waits for it";
  }
  // The reading's own mark, not only the page's: a frozen reading is still held for a render after the page leaves
  // its fixture, and a row drawn from it must not be pressable.
  if (state.fixture !== undefined) {
    return `a fixture (${state.fixture}), so the raise is off`;
  }
  if (state.stale !== undefined) {
    return "an earlier capacity reading, so the raise waits for a fresh one";
  }
  if (state.refreshing === true) {
    return "the capacity reading is being re-read, so the raise waits for it";
  }
  return undefined;
}

/**
 * Why the raise holds after this page pressed it. The row it was drawn from is the recorded capacity reading, which
 * still shows the old limit until the next one is taken — so a button re-armed when the press answered would offer
 * the same raise again off a row the press itself made stale. It stays held until a reading with a different limit
 * replaces the row, which draws a fresh button.
 *
 * @param phase where this button's own press stands
 * @returns why the raise holds, or `undefined` before any press
 */
export function raisePressedHeldOf({
  phase,
}: {
  phase: "idle" | "sending" | "done" | "refused" | "unknown";
}): string | undefined {
  if (phase === "idle") {
    return undefined;
  }
  if (phase === "sending") {
    return "the raise is being written";
  }
  if (phase === "done") {
    return "raised, so the button waits for the next capacity reading to show the new limit";
  }
  return "this press did not land as asked, so the button waits for the next capacity reading";
}

/**
 * The capacity readings this page pressed a raise from, held ABOVE the plan rows. ONE raise per reading: a press
 * re-reads the capacity channel, and while that re-read is in flight the reading stays drawn as current
 * (`components/live/useLive.ts` § `dropProvisional`), so every other row's raise would still look pressable off a
 * reading being re-read. The re-read then answers with the same recorded reading, old limit and all, until the tick
 * records the next one. Held here rather than in a button, because a handed-over reading goes back to loading on a
 * press and unmounts the rows, and a remounted button has no press of its own. A NEWER reading re-arms every raise:
 * one showing the new limit draws a new button, and one still showing the old limit was taken after the press and is
 * a fair one to press from.
 */
export interface RaiseRecord {
  /** The instant of the capacity reading the rows are drawn from, or `undefined` before one answers. */
  readonly readAtIso: string | undefined;
  /** The instant of every capacity reading this page pressed a raise from. */
  readonly pressedFrom: ReadonlySet<string>;
  /** Remembers that a raise was pressed from the reading taken at this instant. */
  readonly onRaised: (readAtIso: string) => void;
}

/**
 * Why every raise holds once one was pressed from the very reading the rows are drawn from.
 *
 * @param pressedFrom the instant of every reading this page pressed a raise from
 * @param readAtIso the instant of the reading the rows are drawn from, or `undefined` when none has answered
 * @returns why the raise holds, or `undefined` when nothing was pressed from this reading
 */
export function raiseRecordedHeldOf({
  pressedFrom,
  readAtIso,
}: {
  pressedFrom: ReadonlySet<string>;
  readAtIso: string | undefined;
}): string | undefined {
  if (readAtIso === undefined || !pressedFrom.has(readAtIso)) {
    return undefined;
  }
  return "a raise was already pressed from this capacity reading, so every raise waits for the next one";
}

/**
 * Why one row's raise holds: its own press first, for that phase's words; then the page's record, which holds every
 * OTHER row's raise off the same reading, and this one again once a press demotes the reading to loading and
 * remounts it.
 *
 * @param phase where this button's own press stands
 * @param pressedFrom the instant of every reading this page pressed a raise from
 * @param readAtIso the instant of the reading the rows are drawn from, or `undefined` when none has answered
 * @returns why the raise holds, or `undefined` when it is pressable
 */
export function raiseButtonHeldOf({
  phase,
  pressedFrom,
  readAtIso,
}: {
  phase: "idle" | "sending" | "done" | "refused" | "unknown";
  pressedFrom: ReadonlySet<string>;
  readAtIso: string | undefined;
}): string | undefined {
  const own = raisePressedHeldOf({ phase });
  if (own !== undefined) {
    return own;
  }
  return raiseRecordedHeldOf({ pressedFrom, readAtIso });
}

/**
 * The step above a limit, or `undefined` at the whole week or off the steps.
 *
 * @returns the next step
 */
export function nextUsageLimitStep({ percent }: { percent: number }): number | undefined {
  const at = USAGE_LIMIT_STEPS.indexOf(percent);
  if (at === -1) {
    return undefined;
  }
  return USAGE_LIMIT_STEPS[at + 1];
}

/**
 * Why routing stopped on this plan, when the usage limit is why — or `undefined` when it is open, paused, refusing for
 * a provider's reason, or unreadable for any reason but the not-measured one.
 *
 * @returns the stop, or `undefined`
 */
export function usageLimitStopOf({ plan }: { plan: GlancePlan }): UsageLimitStop | undefined {
  if (plan.status === "unreadable" && plan.reason === CODEX_MONTHLY_SPEND_NOT_MEASURED) {
    return {
      kind: "not-measured",
      words:
        "not measured: its allowance is a monthly spend, which nothing here reads yet, so routing never sends it " +
        "autonomous work; raising its usage limit would not change that",
    };
  }
  if (plan.status !== "at-usage-limit") {
    return undefined;
  }
  // Every window the reading names as the weekly one, not the first: a Codex row can carry more than one, and routing
  // stops the plan on whichever is fullest.
  const weeks = plan.windows.filter((window) => window.window === LIMITED_WINDOW[plan.provider]);
  const week = weeks.at(0);
  if (week === undefined) {
    return {
      kind: "no-raise",
      words:
        "stopped at your usage limit (your own setting, not the provider's), but this reading carried no weekly " +
        "window to say which limit, so there is no raise to offer from here",
    };
  }
  const fable = plan.windows.filter((window) => plan.provider === "claude" && window.window === FABLE_WEEK);
  if ([...weeks, ...fable].some((each) => each.available !== week.available)) {
    return {
      kind: "no-raise",
      words:
        "stopped at your usage limit (your own setting, not the provider's), but this reading carried weekly " +
        "windows at different limits, so there is no one limit to raise from here",
    };
  }
  const limitPercent = week.available;
  const used = Math.max(...weeks.map((each) => each.used));
  const nextPercent = nextUsageLimitStep({ percent: limitPercent });
  const stopped = `stopped at your usage limit of ${String(limitPercent)}% of its week (your own setting, not the provider's)`;
  if (!USAGE_LIMIT_STEPS.includes(limitPercent)) {
    return {
      kind: "no-raise",
      words: `${stopped}; ${String(limitPercent)}% is not one of the limits the register records, so there is no raise to offer from here`,
    };
  }
  if (nextPercent === undefined) {
    return { kind: "no-raise", words: `${stopped}; it is already the whole week, so there is nothing to raise` };
  }
  // Routing stops a plan once its week's use reaches the limit (`src/claude/select.ts`'s `atCeiling`), so a raise
  // that leaves the use at or past the new limit would write a change and let nothing continue.
  if (used >= nextPercent) {
    return {
      kind: "no-raise",
      words:
        `${stopped}; it has already used ${String(used)}% of its week, so one step up to ` +
        `${String(nextPercent)}% would not let it continue`,
    };
  }
  // The Fable week past the next step still stops Fable work after the raise; the rest continues, so the raise stays
  // and says what it will not reach.
  const fableUsed = Math.max(...fable.map((each) => each.used));
  const fableStays =
    fableUsed >= nextPercent
      ? `; its Fable week has already used ${String(fableUsed)}%, so Fable work stays stopped at ${String(nextPercent)}%`
      : "";
  // A five-hour window at its cap bars the plan whatever the week (`fleetGlancePlans.ts`'s `fiveHourBinds` reads it
  // the same way). It clears on its own reset within hours, and the raise is still the step needed after it, so the
  // raise stays and says it waits on that reset.
  const fiveHourFull = plan.windows.some((window) => window.window === "five-hour" && window.used >= window.available);
  const fiveHourWaits = fiveHourFull ? "; its five-hour window is full too, so it continues once that resets" : "";
  return {
    kind: "raise",
    label: `Raise the usage limit to ${String(nextPercent)}% and continue`,
    limitPercent,
    nextPercent,
    slots: {
      from: String(limitPercent),
      percent: String(nextPercent),
      plan: aliasOf({ id: plan.id }),
      provider: plan.provider,
    },
    words: `${stopped}${fableStays}${fiveHourWaits}`,
  };
}
