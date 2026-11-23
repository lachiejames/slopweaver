/**
 * The owner's usage limit applied to DOLLARS: one recorded spend reading (`./spendStore.ts`), its age, and the
 * plan's `usageLimitPercent` decide whether a `monthly-spend` plan has room. Pure.
 *
 * ## The arithmetic, and why it is a product rather than a quotient
 *
 * A plan is at its limit when `used × 100 ≥ limit × usageLimitPercent` — both sides in the provider's own minor
 * units, so no division rounds a plan one cent under its limit into "open". Equality is AT the limit: the owner said
 * _"you can have fifty percent and no more"_ (`../plans/usageLimit.ts`), so the fleet stops at it, not past it.
 *
 * ## Freshness
 *
 * A reading is evidence for {@link CLAUDE_SPEND_FRESH_MS} after it was observed, then NOT MEASURED. The bound is the
 * provider's own: the usage endpoint answered a first call `429` with `retry-after: 3600`,
 * so an hour is the most often it can be read, and an older reading is a plan
 * that could have spent anything since. A reading dated after `now` is a clock that cannot be trusted and is NOT
 * MEASURED too.
 */
import { parseIsoMs } from "#lib/date.js";

import type { UsageLimitPercent } from "../plans/usageLimit.js";
import { type ClaudeSpendValue, isSpendAmount, isSpendCurrency } from "./spendStatus.js";

/** How long a spend reading stays evidence — the provider's own one-hour throttle on the usage endpoint. */
export const CLAUDE_SPEND_FRESH_MS = 60 * 60 * 1000;

/** One spend reading as recorded: the provider's figures, which plan they are, and when they were true. */
export interface ClaudeSpendReading extends ClaudeSpendValue {
  readonly alias: string;
  readonly observedAtIso: string;
}

/**
 * What one plan's spend says about taking more work.
 *
 * - `open` — under the owner's limit, with the headroom left in minor units of `currency` and the share of the
 *   permitted spend already used, which orders the monthly routing lane (`./loadBalance.ts`);
 * - `usage-limit` — at or over it; no override crosses it;
 * - `provider-refused` — the provider says spend is disabled or its own limit is reached;
 * - `not-measured` — no reading, a stale or future one, or a plan that reports no limit or no spend.
 */
export type ClaudeSpendVerdict =
  | {
      readonly kind: "open";
      readonly headroomMinor: number;
      readonly currency: string;
      readonly usedFraction: number;
      readonly reason: string;
    }
  | { readonly kind: "usage-limit"; readonly reason: string }
  | { readonly kind: "provider-refused"; readonly reason: string }
  | { readonly kind: "not-measured"; readonly reason: string };

/**
 * An amount in minor units as the major-unit figure a person reads, such as `12.34 USD`.
 *
 * @param minor the amount in minor units
 * @param decimalPlaces minor units per major unit as a power of ten; `null` prints the minor figure as sent
 * @param currency the ISO currency code
 * @returns the amount as text
 */
export function formatSpend({
  currency,
  decimalPlaces,
  minor,
}: {
  minor: number;
  decimalPlaces: number | null;
  currency: string;
}): string {
  if (decimalPlaces === null) {
    return `${String(minor)} minor units of ${currency}`;
  }
  return `${(minor / 10 ** decimalPlaces).toFixed(decimalPlaces)} ${currency}`;
}

/**
 * Why a reading is not evidence at `nowIso`, or undefined when it is.
 *
 * @returns the NOT MEASURED reason, or undefined for a reading inside the freshness bound
 */
function staleness({ nowIso, reading }: { nowIso: string; reading: ClaudeSpendReading }): string | undefined {
  const observedMs = parseIsoMs({ tsIso: reading.observedAtIso });
  const nowMs = parseIsoMs({ tsIso: nowIso });
  if (observedMs === undefined || nowMs === undefined) {
    return `its spend reading's instant ${JSON.stringify(reading.observedAtIso)} does not parse`;
  }
  if (observedMs > nowMs) {
    return `its spend reading is dated ${reading.observedAtIso}, after now`;
  }
  if (nowMs - observedMs > CLAUDE_SPEND_FRESH_MS) {
    return `its spend reading from ${reading.observedAtIso} is over an hour old`;
  }
  return undefined;
}

/**
 * What one plan's spend reading says about taking more work at `nowIso`, under the owner's usage limit.
 *
 * @param alias the plan, which the no-reading reason names in the command that reads one
 * @param reading the plan's newest recorded reading, or undefined when none is recorded
 * @param usageLimitPercent the share of the month's limit the owner lets the fleet take
 * @param nowIso the instant the verdict is for — a reading's age is judged against it
 * @returns the verdict, with a reason that names the figures and never the plan — a caller prefixes the alias, the
 *   way a `ClaudeExclusion` reason is printed after its alias
 */
export function claudeSpendVerdict({
  alias,
  nowIso,
  reading,
  usageLimitPercent,
}: {
  alias: string;
  nowIso: string;
  reading: ClaudeSpendReading | undefined;
  usageLimitPercent: UsageLimitPercent;
}): ClaudeSpendVerdict {
  if (reading === undefined) {
    return {
      kind: "not-measured",
      reason: `no spend reading recorded — \`slopweaver claude spend --plan ${alias}\` reads one`,
    };
  }
  const stale = staleness({ nowIso, reading });
  if (stale !== undefined) {
    return { kind: "not-measured", reason: stale };
  }
  if (!reading.isEnabled) {
    return { kind: "provider-refused", reason: "the provider reports extra usage disabled" };
  }
  if (reading.spendLimitReached) {
    return { kind: "provider-refused", reason: "the provider reports its spend limit reached" };
  }
  const { currency, decimalPlaces, monthlyLimitMinor, usedMinor } = reading;
  const measurable = isSpendAmount(monthlyLimitMinor) && monthlyLimitMinor > 0 && isSpendAmount(usedMinor);
  if (!measurable || !isSpendCurrency(currency)) {
    return { kind: "not-measured", reason: "the provider reports no monthly limit and spend to measure" };
  }
  const spent = formatSpend({ currency, decimalPlaces, minor: usedMinor });
  const limit = formatSpend({ currency, decimalPlaces, minor: monthlyLimitMinor });
  const allowedMinor = (monthlyLimitMinor * usageLimitPercent) / 100;
  const allowed = formatSpend({ currency, decimalPlaces, minor: allowedMinor });
  const figures = `${spent} spent of ${limit} this month, usage limit ${String(usageLimitPercent)}% = ${allowed}`;
  if (usedMinor * 100 >= monthlyLimitMinor * usageLimitPercent) {
    return { kind: "usage-limit", reason: `${figures}, at its usage limit` };
  }
  const headroomMinor = allowedMinor - usedMinor;
  return {
    currency,
    headroomMinor,
    kind: "open",
    reason: `${figures}, ${formatSpend({ currency, decimalPlaces, minor: headroomMinor })} left`,
    usedFraction: (usedMinor * 100) / (monthlyLimitMinor * usageLimitPercent),
  };
}
