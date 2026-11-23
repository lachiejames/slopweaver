/**
 * What `plans set-thresholds` was asked to change, read off its flags. Pure: argv in, one provider's change out.
 *
 * Each field has ONE flag, the register's own name in kebab case (`routeAtPercent` is `--route-at-percent`), and
 * `--reset <flag-name>` hands a field back to its default, repeatable so coupled fields reset in one write. What a
 * caller can get wrong ON THE COMMAND LINE is refused here, every problem at once: a field of the other provider,
 * text that is not a whole number, a field both set and reset, or nothing to change. A value's range and the order
 * the bars must keep are the register's own rules (`../../../plans/thresholds.ts`), judged on the merged result by
 * the write, so they are not copied here to drift.
 */
import { err, ok, type Result } from "#lib/result.js";

import type { ClaudeThresholdFields, CodexThresholdFields, ThresholdMutation } from "../../../plans/thresholds.js";
import type { PlanProvider } from "../../../plans/types.js";
import { repeatedFlagValues } from "../../parseFlags.js";

import { PlansArgsErrors, type PlansThresholdsUnreadableError } from "./argsErrors.js";

/** One threshold field and the flag that sets it. */
interface ThresholdFlag<F extends string> {
  readonly field: F;
  readonly flag: string;
}

/** Claude's fields and their flags, in the order `plans list` prints them. */
const CLAUDE_FLAGS: readonly ThresholdFlag<keyof ClaudeThresholdFields>[] = [
  { field: "alertAtPercent", flag: "alert-at-percent" },
  { field: "acceptanceAtPercent", flag: "acceptance-at-percent" },
  { field: "routeAtPercent", flag: "route-at-percent" },
  { field: "spendOutAtPercent", flag: "spend-out-at-percent" },
  { field: "spendOutBeforeResetMinutes", flag: "spend-out-before-reset-minutes" },
  { field: "balancedSpreadPercent", flag: "balanced-spread-percent" },
  { field: "driftingSpreadPercent", flag: "drifting-spread-percent" },
];

/** Codex's fields and their flags, in the order `plans list` prints them. */
const CODEX_FLAGS: readonly ThresholdFlag<keyof CodexThresholdFields>[] = [
  { field: "alertAtPercent", flag: "alert-at-percent" },
  { field: "pauseAtPercent", flag: "pause-at-percent" },
];

/** Every value flag either provider declares, so a flag of the other provider is named rather than ignored. */
const ALL_FLAGS: ReadonlySet<string> = new Set([...CLAUDE_FLAGS, ...CODEX_FLAGS].map((entry) => entry.flag));

/**
 * The flag that sets one field, for `plans list` and for a refusal naming it.
 *
 * @param provider whose field it is
 * @param field the register's own field name
 * @returns the flag name without its dashes
 */
export function thresholdFlagFor({ field, provider }: { field: string; provider: PlanProvider }): string {
  const table: readonly ThresholdFlag<string>[] = provider === "claude" ? CLAUDE_FLAGS : CODEX_FLAGS;
  return table.find((entry) => entry.field === field)!.flag;
}

/** One provider's change before it is tagged with that provider. */
interface ProviderChange<F extends string> {
  readonly set: Readonly<Partial<Record<F, number>>>;
  readonly reset: readonly F[];
}

/**
 * The values one provider's flags set, each a whole number; a malformed one is pushed onto `problems`.
 *
 * @param flags that provider's fields and flags
 * @param problems the running problem list this appends to
 * @param values the parsed flags
 * @returns each field a flag gave a whole number to
 */
function setOf<F extends string>({
  flags,
  problems,
  values,
}: {
  flags: readonly ThresholdFlag<F>[];
  problems: string[];
  values: Readonly<Record<string, string | boolean>>;
}): Partial<Record<F, number>> {
  const set: Partial<Record<F, number>> = {};
  for (const { field, flag } of flags) {
    const given = values[flag];
    if (typeof given !== "string") {
      continue;
    }
    if (!/^\d+$/.test(given)) {
      problems.push(`--${flag} must be a whole number; got ${given}`);
      continue;
    }
    set[field] = Number(given);
  }
  return set;
}

/**
 * The fields the repeatable `--reset` names; an unknown name, or one also set, is pushed onto `problems`.
 *
 * @param flags that provider's fields and flags
 * @param problems the running problem list this appends to
 * @param provider whose flags these are, for the refusal sentence
 * @param rest the argv tail carrying each `--reset`
 * @param set what the same command line sets, which a reset may not also name
 * @returns the fields to put back to their defaults
 */
function resetOf<F extends string>({
  flags,
  problems,
  provider,
  rest,
  set,
}: {
  flags: readonly ThresholdFlag<F>[];
  problems: string[];
  provider: PlanProvider;
  rest: readonly string[];
  set: Partial<Record<F, number>>;
}): F[] {
  const reset: F[] = [];
  for (const name of repeatedFlagValues({ name: "reset", rest })) {
    const entry = flags.find((candidate) => candidate.flag === name);
    if (entry === undefined) {
      problems.push(
        `--reset ${name} names no ${provider} threshold — one of ${flags.map((each) => each.flag).join(", ")}`,
      );
    } else if (set[entry.field] !== undefined) {
      problems.push(`--${name} is both set and reset`);
    } else {
      reset.push(entry.field);
    }
  }
  return reset;
}

/**
 * Read one provider's change against its own flag table.
 *
 * @param flags that provider's fields and flags
 * @param provider whose flags these are, for the refusal sentence
 * @param rest the argv tail, for the repeatable `--reset`
 * @param values the parsed flags
 * @returns the change, or every problem found
 */
function changeOf<F extends string>({
  flags,
  provider,
  rest,
  values,
}: {
  flags: readonly ThresholdFlag<F>[];
  provider: PlanProvider;
  rest: readonly string[];
  values: Readonly<Record<string, string | boolean>>;
}): Result<ProviderChange<F>> {
  const own = new Set(flags.map((entry) => entry.flag));
  const problems: string[] = [...ALL_FLAGS]
    .filter((flag) => !own.has(flag) && typeof values[flag] === "string")
    .map((flag) => `--${flag} is not a ${provider} threshold`);
  const set = setOf({ flags, problems, values });
  const reset = resetOf({ flags, problems, provider, rest, set });
  if (Object.keys(set).length === 0 && reset.length === 0 && problems.length === 0) {
    problems.push("set at least one threshold, or --reset one");
  }
  if (problems.length > 0) {
    return err(problems);
  }
  return ok({ reset, set });
}

/**
 * Read what `plans set-thresholds` records.
 *
 * @param provider the already-read `--provider`
 * @param rest the argv tail, for the repeatable `--reset`
 * @param values the parsed flags
 * @returns the change, or every reason the command line could not be read
 */
export function thresholdChange({
  provider,
  rest,
  values,
}: {
  provider: PlanProvider;
  rest: readonly string[];
  values: Readonly<Record<string, string | boolean>>;
}): Result<ThresholdMutation, PlansThresholdsUnreadableError> {
  if (provider === "claude") {
    return changeOf({ flags: CLAUDE_FLAGS, provider, rest, values })
      .map((change): ThresholdMutation => ({ provider, ...change }))
      .mapErr((problems) => PlansArgsErrors.thresholdsUnreadable({ problems }));
  }
  return changeOf({ flags: CODEX_FLAGS, provider, rest, values })
    .map((change): ThresholdMutation => ({ provider, ...change }))
    .mapErr((problems) => PlansArgsErrors.thresholdsUnreadable({ problems }));
}
