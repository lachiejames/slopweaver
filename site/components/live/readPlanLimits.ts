/**
 * The reader for `plans list --json`: every connected plan and the usage limit it carries, for Settings → Models' one
 * drop-down per plan (`../console/PlanLimits.tsx`).
 *
 * Strict in `./read.ts`'s sense: a payload that does not read is `undefined`, which the page names as not measured. A
 * plan row that does not read refuses the whole reading rather than being dropped, because a dropped row would draw as
 * a plan that is not connected — and a limit drawn at the wrong value would invite a press that sets the wrong one.
 */

import { type Bag, bags, isBag, num, str, sub } from "../../lib/bag";

/**
 * Every value a usage limit may take, restated from `src/plans/usageLimit.ts`'s `USAGE_LIMIT_PERCENTS` because the
 * console keeps its own copy of what it validates; `readPlanLimits.test.ts` binds the two. They are the drop-down's
 * options, smallest first.
 */
export const USAGE_LIMIT_CHOICES: readonly number[] = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];

/** Every allowance kind, restated from `src/plans/usageLimit.ts`'s `PLAN_ALLOWANCE_KINDS`; the same test binds them. */
export const ALLOWANCE_KINDS: readonly string[] = ["weekly-window", "monthly-spend"];

/** Both providers, restated from `src/plans/types.ts`'s `PlanProvider`. */
const PROVIDERS: ReadonlySet<string> = new Set(["claude", "codex"]);

/** One connected plan as its drop-down needs it. */
export interface PlanLimit {
  readonly provider: string;
  readonly alias: string;
  /** The account the plan is signed into, as the register caches it; ABSENT when nothing has recorded one. */
  readonly email: string | undefined;
  /** What the limit is a share of. Carried through unchanged on a press: the drop-down picks only the percent. */
  readonly allowance: string;
  /** The limit the row holds, which the drop-down is pre-selected at. The verb decodes an absent limit to 100. */
  readonly percent: number;
}

/** The whole reading. */
export interface PlanLimitsView {
  /**
   * Why nothing here can be changed yet, in the verb's own words — present only on an install that has adopted no
   * register, where `plans set-usage-limit` refuses every row until `plans adopt` writes the picture down.
   */
  readonly unadoptedWhy: string | undefined;
  readonly plans: readonly PlanLimit[];
}

/**
 * One plan row, or `undefined` when any field the drop-down needs does not read.
 *
 * @returns the plan
 */
function planOf({ row }: { row: Bag }): PlanLimit | undefined {
  const provider = str({ bag: row, key: "provider" });
  const alias = str({ bag: row, key: "alias" });
  const percent = num({ bag: row, key: "usageLimitPercent" });
  const allowanceBag = sub({ bag: row, key: "allowance" });
  if (provider === undefined || !PROVIDERS.has(provider) || alias === undefined || alias.length === 0) {
    return undefined;
  }
  if (percent === undefined || !USAGE_LIMIT_CHOICES.includes(percent) || allowanceBag === undefined) {
    return undefined;
  }
  const allowance = str({ bag: allowanceBag, key: "kind" });
  if (allowance === undefined || !ALLOWANCE_KINDS.includes(allowance)) {
    return undefined;
  }
  const email = str({ bag: row, key: "email" });
  if (email === undefined && Object.hasOwn(row, "email")) {
    return undefined;
  }
  return { alias, allowance, email, percent, provider };
}

/**
 * The `DERIVED_REGISTER` diagnostics a reading carries — the one the verb attaches to every derived read — or
 * `undefined` when any diagnostic does not read, so a malformed one is never silently passed over.
 *
 * @returns each such diagnostic's message
 */
function derivedMessagesOf({ payload }: { payload: Bag }): readonly string[] | undefined {
  const diagnostics = bags({ bag: payload, key: "diagnostics" });
  if (diagnostics === undefined) {
    return undefined;
  }
  const derived: string[] = [];
  for (const one of diagnostics) {
    const code = str({ bag: one, key: "code" });
    const message = str({ bag: one, key: "message" });
    if (code === undefined || message === undefined || message.length === 0) {
      return undefined;
    }
    if (code === "DERIVED_REGISTER") {
      derived.push(message);
    }
  }
  return derived;
}

/** Whether the payload is the live runner's answer for a register holding no plan (`../../lib/liveVerbsPlans.ts`). */
function isNoPlans({ payload }: { payload: Bag }): boolean {
  return str({ bag: payload, key: "kind" }) === "expected-empty" && str({ bag: payload, key: "code" }) === "NO_PLANS";
}

/**
 * Project `plans list --json`.
 *
 * @returns the reading, or `undefined` when the payload, its source, a diagnostic or any plan row in it does not read,
 *   when one provider names an alias twice, or when the source and the `DERIVED_REGISTER` diagnostic disagree
 */
export function readPlanLimits(payload: unknown): PlanLimitsView | undefined {
  if (!isBag(payload)) {
    return undefined;
  }
  if (isNoPlans({ payload })) {
    return { plans: [], unadoptedWhy: undefined };
  }
  const source = str({ bag: payload, key: "source" });
  const rows = bags({ bag: payload, key: "plans" });
  const derived = derivedMessagesOf({ payload });
  if ((source !== "registered" && source !== "derived") || rows === undefined || derived === undefined) {
    return undefined;
  }
  const plans: PlanLimit[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const plan = planOf({ row });
    if (plan === undefined) {
      return undefined;
    }
    const key = `${plan.provider}:${plan.alias}`;
    if (seen.has(key)) {
      return undefined;
    }
    seen.add(key);
    plans.push(plan);
  }
  if (source === "registered") {
    if (derived.length > 0) {
      return undefined;
    }
    return { plans, unadoptedWhy: undefined };
  }
  if (derived.length !== 1) {
    return undefined;
  }
  return { plans, unadoptedWhy: derived[0] };
}
