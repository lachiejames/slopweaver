/**
 * The USAGE LIMIT — the share of one plan the owner lets Slopweaver take — and the ALLOWANCE shape that says
 * what that share is a share of. Pure: one place decides which values are valid and what absence means, so
 * neither the register, the Claude projection nor a routing gate restates it.
 *
 * ## Why it exists
 *
 * The fleet cannot just take a hundred percent of a plan: a user says it can have fifty percent and no more, and
 * without that the product is dead on arrival. A limit a user sets is respected even if it means taking the fleet
 * down. So the limit is a CEILING: a routing gate stops at it,
 * and no `--force` or escape hatch crosses it.
 *
 * ## One concept, one name
 *
 * The repository already says "cap" for two other things — a provider's own exhaustion (`Codex CAPPED`,
 * `codex/fleetCap.ts`) and the house routing bar (`claude/select.ts`'s `spendCapFor`). The owner's own number is
 * therefore the usage LIMIT everywhere, and "ceiling" is only ever the computed result of the limit and the
 * house bar together.
 *
 * ## The allowance shapes, read live
 *
 * - `weekly-window` — Claude Pro, Max, Ultra and Team, and ChatGPT Plus, Pro and Business: limits every five hours
 *   and every week (claude.com/pricing; learn.chatgpt.com/docs/pricing). The limit is a share of the WEEK.
 * - `monthly-spend` — Claude Enterprise, "Seat price + usage at API rates" under "user and org spend limits"
 *   an admin sets (a seat's limit is a dollar figure that resets monthly), and ChatGPT
 *   Enterprise on flexible credits. The limit is a share of the MONTH's spend limit. `slopweaver claude spend`
 *   reads and records a Claude plan's spend, `../claude/spendPolicy.ts` applies this limit to it in dollars, and
 *   every Claude routing gate reads the newest reading while it is an hour fresh (`../claude/spendBudgets.ts`) —
 *   the monthly lane behind every weekly plan. ChatGPT flexible credits have no reader at all, so a Codex
 *   monthly-spend plan is {@link CODEX_MONTHLY_SPEND_NOT_MEASURED} and is never routed autonomous work.
 */

/** A usage limit: a share of one plan's allowance, in steps of ten — the onboarding drop-down's own values. */
export type UsageLimitPercent = 10 | 20 | 30 | 40 | 50 | 60 | 70 | 80 | 90 | 100;

/** What a plan's allowance is measured in. A CLOSED union — see this module's header. */
export type PlanAllowanceKind = "weekly-window" | "monthly-spend";

/** The allowance shape a plan holds, recorded on its register row. */
export interface PlanAllowance {
  readonly kind: PlanAllowanceKind;
}

/** Every value a usage limit may take, smallest first. */
export const USAGE_LIMIT_PERCENTS: readonly UsageLimitPercent[] = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];

/** Every allowance kind, in the order a usage line names them. */
export const PLAN_ALLOWANCE_KINDS: readonly PlanAllowanceKind[] = ["weekly-window", "monthly-spend"];

/**
 * The usage limit a row that names none has. It is the whole plan, which is what every row written before
 * the limit existed has always been routed against.
 */
export const NO_USAGE_LIMIT: UsageLimitPercent = 100;

/** The allowance a row that names none holds: every row written before the field existed is a subscription. */
export const WEEKLY_WINDOW: PlanAllowance = { kind: "weekly-window" };

/**
 * Whether a decoded value is a usage limit this build accepts.
 *
 * @param value the candidate, as decoded from a row or a flag
 * @returns whether it is an integer from 10 through 100 in steps of ten
 */
export function isUsageLimitPercent(value: unknown): value is UsageLimitPercent {
  return typeof value === "number" && USAGE_LIMIT_PERCENTS.some((each) => each === value);
}

/**
 * Whether a decoded value is an allowance kind this build accepts.
 *
 * @param value the candidate, as decoded from a row or a flag
 * @returns whether it is `weekly-window` or `monthly-spend`
 */
function isPlanAllowanceKind(value: unknown): value is PlanAllowanceKind {
  return typeof value === "string" && PLAN_ALLOWANCE_KINDS.some((each) => each === value);
}

/**
 * Every problem with one row's usage-limit and allowance fields, empty when both are absent or valid.
 *
 * A malformed value is a problem rather than something read as "no limit", because of the DIRECTION of the
 * failure: an ignored 30 would let the fleet spend the whole plan.
 *
 * @param at how to name the offending row in a message
 * @param usageLimitPercent the row's `usageLimitPercent`, as decoded
 * @param allowance the row's `allowance`, as decoded
 * @returns every problem found
 */
export function usageLimitProblems({
  allowance,
  at,
  usageLimitPercent,
}: {
  at: string;
  usageLimitPercent: unknown;
  allowance: unknown;
}): readonly string[] {
  const problems: string[] = [];
  if (usageLimitPercent !== undefined && !isUsageLimitPercent(usageLimitPercent)) {
    problems.push(
      `${at}'s \`usageLimitPercent\`, when present, must be an integer from 10 through 100 in increments of 10`,
    );
  }
  const kind = typeof allowance === "object" && allowance !== null ? Reflect.get(allowance, "kind") : undefined;
  if (allowance !== undefined && !isPlanAllowanceKind(kind)) {
    problems.push(`${at}'s \`allowance\`, when present, must be an object with a \`kind\` of ${allowanceKindList()}`);
  }
  return problems;
}

/**
 * The usage limit one row carries, after {@link usageLimitProblems} reported any malformed value.
 *
 * @param usageLimitPercent the row's `usageLimitPercent`, as decoded
 * @returns the limit, or {@link NO_USAGE_LIMIT} when the row names none
 */
export function decodeUsageLimitPercent({ usageLimitPercent }: { usageLimitPercent: unknown }): UsageLimitPercent {
  if (isUsageLimitPercent(usageLimitPercent)) {
    return usageLimitPercent;
  }
  return NO_USAGE_LIMIT;
}

/**
 * The allowance one row holds, after {@link usageLimitProblems} reported any malformed value.
 *
 * @param allowance the row's `allowance`, as decoded
 * @returns the allowance, or {@link WEEKLY_WINDOW} when the row names none
 */
export function decodePlanAllowance({ allowance }: { allowance: unknown }): PlanAllowance {
  const kind = typeof allowance === "object" && allowance !== null ? Reflect.get(allowance, "kind") : undefined;
  if (isPlanAllowanceKind(kind)) {
    return { kind };
  }
  return WEEKLY_WINDOW;
}

/**
 * The share of its WEEK a plan's usage limit sets: the limit itself on a `weekly-window` plan, and the whole week
 * on a `monthly-spend` one, whose limit is a share of the month's spend and says nothing about its weekly window.
 *
 * @param allowance what the plan's limit is a share of
 * @param usageLimitPercent the plan's own usage limit
 * @returns the limit to hold a weekly window against
 */
export function weeklyUsageLimitOf({
  allowance,
  usageLimitPercent,
}: {
  allowance: PlanAllowance;
  usageLimitPercent: UsageLimitPercent;
}): UsageLimitPercent {
  if (allowance.kind === "weekly-window") {
    return usageLimitPercent;
  }
  return NO_USAGE_LIMIT;
}

/**
 * The allowance kinds as a usage line or a refusal names them.
 *
 * @returns `\`weekly-window\` or \`monthly-spend\``
 */
function allowanceKindList(): string {
  return PLAN_ALLOWANCE_KINDS.map((kind) => `\`${kind}\``).join(" or ");
}

/**
 * The sentence every surface prints for a Codex monthly-spend plan: nothing reads a ChatGPT plan's flexible credits,
 * so its usage limit cannot be applied and it takes no autonomous work. A Claude monthly-spend plan is judged on its
 * own spend reading instead (`../claude/spendBudgets.ts`), with a reason of its own.
 */
export const CODEX_MONTHLY_SPEND_NOT_MEASURED =
  "monthly spend is NOT MEASURED; nothing reads a ChatGPT plan's flexible credits, so this plan takes no autonomous work";

/**
 * What every Claude monthly-spend exclusion's reason opens with (`../claude/select.ts`), so a reader of a ceiling or
 * a refusal can tell a plan judged on its spend from one judged on its windows without a second field
 * (`../capacity/admission.ts`). Here, beside the Codex sentence, because this leaf is the one the site can import.
 */
export const MONTHLY_SPEND_REASON_PREFIX = "monthly spend: ";
