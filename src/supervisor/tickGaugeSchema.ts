/**
 * The plan gauge's slice of the supervisor tick row schema (`./tickSchema.ts`). Split out when each window's own
 * reset and the gauge's PLAN lines joined it, so the row schema stays a file one reader can hold.
 */
import { z } from "zod";

/** An ISO instant a clock can parse, as `./tickSchema.ts` reads every instant. */
const isoInstant = z.iso.datetime({ offset: true });

/** A non-empty string, as `./tickSchema.ts` reads every label. */
const text = z.string().min(1);

/** The owner's usage limit on one plan, a whole percent (`src/plans/usageLimit.ts` holds the valid steps). */
const usageLimit = z.number().int().min(1).max(100);

/**
 * One plan's standing in the gauge. Each window carries its OWN reset: the Fable and five-hour resets are optional
 * because every row journalled before they existed carries none, and `.strict()` refuses nothing it never had.
 */
const gaugePlanFacts = z
  .object({
    fablePct: z.number(),
    fableResetsIso: isoInstant.optional(),
    fiveHourPct: z.number().optional(),
    fiveHourResetsIso: isoInstant.optional(),
    plan: text,
    resetsIso: isoInstant,
    usageLimitPercent: usageLimit.optional(),
    weekPct: z.number(),
  })
  .strict();

/** A whole number from 1 up, which every threshold field is (`src/plans/thresholds.ts` holds the ranges). */
const wholePositive = z.number().int().min(1);

/**
 * Claude's thresholds in the register's own spelling, as the gauge judged a reading under them — strict, since a
 * misspelt field read as absent would let a later judgement silently use other bars. The register is where a
 * value's range and ordering are refused; this only refuses a shape no gauge writes.
 */
export const claudeThresholdFieldsSchema = z
  .object({
    acceptanceAtPercent: wholePositive,
    alertAtPercent: wholePositive,
    balancedSpreadPercent: wholePositive,
    driftingSpreadPercent: wholePositive,
    routeAtPercent: wholePositive,
    spendOutAtPercent: wholePositive,
    spendOutBeforeResetMinutes: wholePositive,
  })
  .strict();

/**
 * The plan gauge. See `./tickGaugeTypes.ts`'s `GaugeFacts`; `planLines`, `thresholds` and `weekOnlyPlans` are optional
 * for the same history reason — a row journalled before the gauge carried them has none.
 */
export const gaugeFactsSchema = z
  .object({
    nextAllModels: text.nullable(),
    nextFable: text.nullable(),
    // Optional for a row captured before the gauge named the chair's own route.
    nextChair: text.nullable().optional(),
    // Optional: absent with no chair route, and on a row captured before the gauge carried it.
    chairLevelWith: z.array(text).optional(),
    planLines: z.array(text).optional(),
    plans: z.array(gaugePlanFacts),
    reactNowLines: z.array(text),
    thresholds: claudeThresholdFieldsSchema.optional(),
    weekOnlyPlans: z
      .array(z.object({ plan: text, usageLimitPercent: usageLimit.optional(), weekPct: z.number() }).strict())
      .optional(),
  })
  .strict();
