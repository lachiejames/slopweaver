/**
 * The words the Fleet page's plan usage block speaks in (`./planMeters.ts`): spans, resets, token counts, an account's
 * hover, a clock instant and a plan's status. Pure.
 */
import type { GlancePlan } from "./fleetGlancePlans";
import { usageLimitStopOf } from "./planUsageLimit";

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/**
 * How long until an instant, as the owner reads it: `4h 35m`, `2d 3h`, `12m`. The Fleet page's parked waits say how long
 * until a clock wake in the same words (`./parkedWaits.ts`).
 *
 * @returns the phrase
 */
export function spanWords({ ms }: { ms: number }): string {
  if (ms >= DAY_MS) {
    return `${String(Math.floor(ms / DAY_MS))}d ${String(Math.floor((ms % DAY_MS) / HOUR_MS))}h`;
  }
  if (ms >= HOUR_MS) {
    return `${String(Math.floor(ms / HOUR_MS))}h ${String(Math.floor((ms % HOUR_MS) / MINUTE_MS))}m`;
  }
  return `${String(Math.max(1, Math.round(ms / MINUTE_MS)))}m`;
}

/**
 * A window's reset, measured from the reading's own instant so a replayed reading says what it said then. A reset is
 * an instant the provider named, not a forecast.
 *
 * @param resetAtIso when the window resets, `undefined` when the reading named no reset
 * @param nowMs the reading's instant
 * @returns the phrase
 */
export function resetWords({ resetAtIso, nowMs }: { resetAtIso: string | undefined; nowMs: number }): string {
  if (resetAtIso === undefined) {
    return "no reset named";
  }
  const resetMs = Date.parse(resetAtIso);
  if (Number.isNaN(resetMs) || Number.isNaN(nowMs)) {
    return "reset time unreadable";
  }
  if (resetMs <= nowMs) {
    return "had reset by this reading";
  }
  return `resets in ${spanWords({ ms: resetMs - nowMs })}`;
}

/**
 * A token count as the owner reads it: `812`, `12.4k`, `3.15M`, `51.1B` — three significant figures past a thousand.
 *
 * @returns the phrase
 */
export function tokenWords({ count }: { count: number }): string {
  const units: readonly { readonly at: number; readonly suffix: string }[] = [
    { at: 1e9, suffix: "B" },
    { at: 1e6, suffix: "M" },
    { at: 1e3, suffix: "k" },
  ];
  const unit = units.find((entry) => Math.abs(count) >= entry.at);
  if (unit === undefined) {
    return String(count);
  }
  const scaled = count / unit.at;
  let digits = 2;
  if (scaled >= 100) {
    digits = 0;
  } else if (scaled >= 10) {
    digits = 1;
  }
  return `${scaled.toFixed(digits)}${unit.suffix}`;
}

/**
 * A count and its noun, singular at one.
 *
 * @returns `1 plan`, `3 plans`
 */
export function counted({ n, noun }: { n: number; noun: string }): string {
  if (n === 1) {
    return `1 ${noun}`;
  }
  return `${String(n)} ${noun}s`;
}

/** The prefix `claude gauge`'s account cell puts on an address it took from the plan list rather than a probe. */
const CACHED_PREFIX = "CACHED ";

/**
 * The prefix `src/capacity/ceilings.ts` puts on a paused plan's reason, `paused: `, or the `paused — ` a reading taken
 * before it changed still carries. A pattern, so the old spelling is read as data and never printed.
 */
const PAUSED_PREFIX = /^paused(?::| —) /u;

/**
 * Who the plan is signed in as, for the hover: its email, or what the reading said of the account.
 *
 * @returns the hover text
 */
export function accountTitleOf({ plan }: { plan: GlancePlan }): string {
  if (plan.account === null) {
    return "the reading named no account for this plan";
  }
  if (plan.account === undefined) {
    return "account not recorded in this reading";
  }
  if (plan.account.startsWith(CACHED_PREFIX)) {
    return `${plan.account.slice(CACHED_PREFIX.length)} (from the plan list, not checked while paused)`;
  }
  return plan.account;
}

/**
 * An instant as the plan row and the fleet history print it: `hh:mmZ` on the reading's own day, `D Mon hh:mmZ`
 * before it.
 *
 * @param nowMs the reading's own instant, which decides whether the day is named
 * @returns the phrase, or `undefined` when the instant will not parse
 */
export function clockWords({ iso, nowMs }: { iso: string; nowMs: number }): string | undefined {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) {
    return undefined;
  }
  const clock = `${at.toISOString().slice(11, 16)}Z`;
  if (at.toISOString().slice(0, 10) === new Date(nowMs).toISOString().slice(0, 10)) {
    return clock;
  }
  const day = at.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
  return `${day} ${clock}`;
}

/**
 * What a plan's status means, in words: whether it takes new work, and if not, why and since when.
 *
 * @returns the status words
 */
export function statusWordsOf({ plan, nowMs }: { plan: GlancePlan; nowMs: number }): string {
  if (plan.status === "open") {
    return "taking new work";
  }
  let reason = "";
  if (plan.reason !== undefined) {
    reason = `: ${plan.reason}`;
  }
  if (plan.status === "paused") {
    if (plan.reason !== undefined && PAUSED_PREFIX.test(plan.reason)) {
      reason = `: ${plan.reason.replace(PAUSED_PREFIX, "")}`;
    }
    let since = "";
    if (plan.pause !== undefined) {
      const clock = clockWords({ iso: plan.pause.sinceIso, nowMs });
      if (clock !== undefined) {
        since = ` since ${clock}`;
      }
    }
    return `paused on purpose${since}${reason}`;
  }
  // The owner's own limit, or a plan nothing measures, is said as itself — never as a provider's cap, never as a failed read.
  const stop = usageLimitStopOf({ plan });
  if (stop !== undefined) {
    return `not taking new work: ${stop.words}`;
  }
  if (plan.status === "unreadable") {
    return `not read this time${reason}`;
  }
  return `not taking new work${reason}`;
}
