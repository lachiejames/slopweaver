/**
 * The READ half of `slopweaver claude spend`: the `extra_usage` block of Claude's `GET /api/oauth/usage` answer,
 * read strictly into this repository's vocabulary. Pure.
 *
 * ## The source, and why this block
 *
 * Claude Code 2.1.317 documents `extra_usage` as _"Extra-usage (overage) spend for the billing period, when the
 * plan has it. Amounts are in minor units of `currency` (cents for USD); is_enabled is false while extra usage
 * cannot cover sends"_ — reproduce with `strings ~/.local/share/claude/versions/2.1.317 | grep -F "minor units"`.
 * A Claude Enterprise seat ("seat price + usage at API rates", under an admin-set user spend limit) is billed in
 * exactly those terms, so this is the block a `monthly-spend` plan's allowance is read from.
 *
 * MEASURED on a Max subscription: the block carries the twelve keys
 * below, every amount `null` and `is_enabled: false`. **An Enterprise seat's answer is UNMEASURED** — whether its
 * admin limit is `monthly_limit`, and whether `used_credits` is the seat's spend or its organisation's, is owed to
 * the first read on a registered Enterprise seat. That is why the read is strict: an Enterprise answer of any other
 * shape refuses naming the field, rather than reading as a plan with nothing spent.
 *
 * ## Absence is never zero
 *
 * A missing block is {@link ClaudeSpendErrors.blockAbsent}. A block that says spend can cover sends but sends its
 * limit, spend or currency as `null` is {@link ClaudeSpendErrors.amountAbsent}, so it is never recorded. Only a block
 * where the provider itself refuses (`is_enabled: false`, or `spend_limit_reached`) parses with `null` amounts: its
 * verdict is that refusal, read before any amount (`./spendPolicy.ts`). Nothing here turns an amount the provider did not send into
 * a number, because a plan read as "nothing spent" is a plan the fleet would spend.
 */
import { z } from "zod";

import { defineBoundary } from "#lib/boundary.js";
import { err, ok, type Result } from "#lib/result.js";

import { type ClaudeSpendError, ClaudeSpendErrors } from "./spendErrors.js";
import { USAGE_SIBLINGS, unread } from "./usageWire.js";

/** Where the spend is read — the usage answer WITHOUT `skip_spend=1`, which is what carries the spend. */
export const SPEND_STATUS_URL = "https://api.anthropic.com/api/oauth/usage";

/** An amount in minor units of the block's currency, or `null` when the plan carries none. */
const minorAmountWire = z.number().nonnegative().nullable();

const extraUsageWire = z.strictObject({
  credits_ever_enabled: unread,
  currency: z.string().min(1).nullable(),
  daily: unread,
  decimal_places: z.number().int().nonnegative().nullable(),
  disabled_reason: unread,
  is_enabled: z.boolean(),
  monthly_limit: minorAmountWire,
  spend_limit_reached: z.boolean(),
  used_credits: minorAmountWire,
  user_disabled: unread,
  utilization: unread,
  weekly: unread,
});

const usageWire = z.strictObject({
  ...USAGE_SIBLINGS,
  cedar_ember: unread,
  extra_usage: extraUsageWire.nullable().optional(),
});

const USAGE_SPEND = defineBoundary({ endpoint: "GET /api/oauth/usage", schema: usageWire });

/** One plan's monthly spend as the provider reported it. Every amount is in minor units of {@link currency}. */
export interface ClaudeSpendValue {
  /** False while extra usage cannot cover sends. */
  readonly isEnabled: boolean;
  /** The provider's own word that the spend limit is reached. */
  readonly spendLimitReached: boolean;
  /** The month's spend limit, or `null` when the plan carries none. */
  readonly monthlyLimitMinor: number | null;
  /** What the month has spent so far, or `null` when the plan carries no figure. */
  readonly usedMinor: number | null;
  /** The ISO currency code the amounts are in, or `null` when the plan carries none. */
  readonly currency: string | null;
  /** How many minor units make one major unit, as a power of ten — 2 for USD — or `null` when not sent. */
  readonly decimalPlaces: number | null;
}

/**
 * Read one plan's monthly spend out of a usage answer's body.
 *
 * @param bodyText the answer's body, as text
 * @returns the spend, or why there is none this version can read — a drifted field named, or the block absent
 */
export function parseClaudeSpendStatus({ bodyText }: { bodyText: string }): Result<ClaudeSpendValue, ClaudeSpendError> {
  const parsed = USAGE_SPEND.parseJson({ text: bodyText });
  if (parsed.isErr()) {
    return err(ClaudeSpendErrors.statusUnreadable({ detail: parsed.error.message }));
  }
  const block = parsed.value.extra_usage;
  if (block === undefined || block === null) {
    return err(ClaudeSpendErrors.blockAbsent());
  }
  const value: ClaudeSpendValue = {
    currency: block.currency,
    decimalPlaces: block.decimal_places,
    isEnabled: block.is_enabled,
    monthlyLimitMinor: block.monthly_limit,
    spendLimitReached: block.spend_limit_reached,
    usedMinor: block.used_credits,
  };
  const missing = missingSpendFigures({ value });
  if (missing.length > 0) {
    return err(ClaudeSpendErrors.amountAbsent({ fields: missing }));
  }
  return ok(value);
}

/**
 * The figures a spend value lacks that a verdict needs — the ONE place the rule "a block that can cover sends carries
 * its limit, spend and currency" lives, so the parser, the recorder and the reader-back all apply the same test. A
 * value where the provider itself refuses (`isEnabled` false, or `spendLimitReached`) lacks nothing: its verdict is
 * that refusal, read before any amount.
 *
 * @param value the spend as read or as recorded
 * @returns the wire names of the missing figures, empty when the value is complete or the provider refuses
 */
export function missingSpendFigures({ value }: { value: ClaudeSpendValue }): readonly string[] {
  if (!value.isEnabled || value.spendLimitReached) {
    return [];
  }
  return [
    ...(isSpendAmount(value.monthlyLimitMinor) ? [] : ["monthly_limit"]),
    ...(isSpendAmount(value.usedMinor) ? [] : ["used_credits"]),
    ...(isSpendCurrency(value.currency) ? [] : ["currency"]),
  ];
}

/**
 * Whether a currency is one a verdict may name: a code with something in it. `null`, an empty string and a
 * whitespace-only one are all NOT a currency, in a value read off the wire or back off the ledger alike.
 *
 * @param currency the currency as read or recorded
 * @returns true only for a string with a non-whitespace character
 */
export function isSpendCurrency(currency: string | null): currency is string {
  return currency !== null && currency.trim() !== "";
}

/**
 * Whether an amount is one a verdict may do arithmetic on: a finite, non-negative number. `null`, `NaN`, an infinity
 * and a negative are all NOT a figure — `NaN` in particular compares false against any limit and so would read as
 * headroom, and serialises as `null`.
 *
 * @param amount a minor-unit amount as read or recorded
 * @returns true only for a finite, non-negative number
 */
export function isSpendAmount(amount: number | null): amount is number {
  return amount !== null && Number.isFinite(amount) && amount >= 0;
}
