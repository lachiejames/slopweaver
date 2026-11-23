/**
 * The install's THRESHOLDS — every house number the fleet routes, alerts and grades against — read from the plan
 * register rather than fixed in code. Pure: one place decides which values are valid, what absence means, and how
 * an owner-facing percent becomes the fraction a gate compares with.
 *
 * ## Why they live in the register
 *
 * A limit fixed in code belongs in the store or the profile instead, and every steer the owner gives about
 * Claude also applies to Codex. The register is the store row every
 * routing gate already reads its destinations from (`./storePort.ts`), so a gate holds its plans and the bars it
 * judges them by from ONE compare-and-set read; the owner profile needs a store URL a routing gate must not.
 *
 * ## One concept, one name
 *
 * The owner's per-plan share is the usage LIMIT (`./usageLimit.ts`). These are the install's own bars, the same
 * for every plan of a provider, so they are THRESHOLDS everywhere — the key, the types and the verb
 * (`slopweaver plans set-thresholds`). A plan's effective ceiling is still the lower of the two (`claude/select.ts`).
 *
 * ## Absence decodes, presence is strict
 *
 * A register naming no `thresholds`, or naming only some fields, decodes the rest to {@link DEFAULT_THRESHOLDS},
 * and the decoded value is never written back: `adopt` and every unrelated change carry the raw document through.
 * A PRESENT value is held to the opposite standard, because of the direction of the failure: a malformed or
 * misspelt field read as "use the default" could widen what the fleet spends past what the owner wrote down. So an
 * unknown provider, an unknown field, a non-integer, a value out of range, and an ordering the gates cannot honour
 * (an alert at or past the routing bar, an acceptance bar the router can never earn) each refuse the whole register.
 */
import { isRecord } from "#lib/parsers.js";

import type { PlanProvider } from "./types.js";

/** Claude's raw threshold fields, as the register spells them: whole percents, and minutes for the lead time. */
export interface ClaudeThresholdFields {
  /** A plan's week at or past this raises the react-now card and the chair's near-the-wall flag. */
  readonly alertAtPercent: number;
  /** The owner's acceptance test: every plan at or past this on both weekly windows when a limit is hit. */
  readonly acceptanceAtPercent: number;
  /** The house routing bar: a window at or past this takes no new work, away from a weekly reset. */
  readonly routeAtPercent: number;
  /** The bar a weekly window is spent to inside its last {@link spendOutBeforeResetMinutes}. */
  readonly spendOutAtPercent: number;
  /** How long before a weekly window's own reset the spend-out bar replaces the routing bar. */
  readonly spendOutBeforeResetMinutes: number;
  /** A fleet whose plans sit at most this many points apart in one window is balanced. */
  readonly balancedSpreadPercent: number;
  /** Past this gap the fleet is out of band; between the two it is drifting, and the chair hands off. */
  readonly driftingSpreadPercent: number;
}

/** Codex's raw threshold fields, as the register spells them: whole percents of a window used. */
export interface CodexThresholdFields {
  /** A window at or past this raises the Codex react-now card. */
  readonly alertAtPercent: number;
  /** A window at or past this takes no new work — the routing bar, never a provider cap. */
  readonly pauseAtPercent: number;
}

/** Both providers' raw fields — the shape `plans set-thresholds` writes and `plans list` prints. */
export interface PlanThresholdFields {
  readonly claude: ClaudeThresholdFields;
  readonly codex: CodexThresholdFields;
}

/**
 * Claude's thresholds as a gate compares them: fractions of a window, 0..1 as the provider's header carries them,
 * and milliseconds for the lead time. `30 / 100` and a literal `0.3` are the same double, so a gate comparing with
 * `>=` on the raw reading needs no epsilon.
 */
export interface ClaudeThresholds {
  readonly alertAt: number;
  readonly acceptanceAt: number;
  readonly routeAt: number;
  readonly spendOutAt: number;
  readonly spendOutBeforeResetMs: number;
  readonly balancedSpread: number;
  readonly driftingSpread: number;
}

/** Codex's thresholds as a gate compares them: whole percents used, the unit Codex's own reading carries. */
export type CodexThresholds = CodexThresholdFields;

/**
 * One `plans set-thresholds` change: the fields of ONE provider it sets, and the ones it hands back to their
 * defaults. Coupled fields travel together so no invalid intermediate register is ever published.
 */
export type ThresholdMutation =
  | {
      readonly provider: "claude";
      readonly set: Readonly<Partial<ClaudeThresholdFields>>;
      readonly reset: readonly (keyof ClaudeThresholdFields)[];
    }
  | {
      readonly provider: "codex";
      readonly set: Readonly<Partial<CodexThresholdFields>>;
      readonly reset: readonly (keyof CodexThresholdFields)[];
    };

/** Every threshold a register decodes to, one value per provider. */
export interface PlanThresholds {
  readonly claude: ClaudeThresholds;
  readonly codex: CodexThresholds;
}

/**
 * The value every field takes when the register names none — the numbers each was fixed at in code before it
 * moved here, each with the ruling behind it in the module that reads it.
 */
export const DEFAULT_THRESHOLD_FIELDS: PlanThresholdFields = {
  claude: {
    acceptanceAtPercent: 90,
    alertAtPercent: 75,
    balancedSpreadPercent: 10,
    driftingSpreadPercent: 15,
    routeAtPercent: 95,
    spendOutAtPercent: 100,
    spendOutBeforeResetMinutes: 300,
  },
  codex: { alertAtPercent: 75, pauseAtPercent: 99 },
};

/** The register key these live under. */
export const THRESHOLDS_KEY = "thresholds";

/** Every Claude field, in the order a reader prints them. */
const CLAUDE_THRESHOLD_FIELDS: readonly (keyof ClaudeThresholdFields)[] = [
  "alertAtPercent",
  "acceptanceAtPercent",
  "routeAtPercent",
  "spendOutAtPercent",
  "spendOutBeforeResetMinutes",
  "balancedSpreadPercent",
  "driftingSpreadPercent",
];

/** Every Codex field, in the order a reader prints them. */
const CODEX_THRESHOLD_FIELDS: readonly (keyof CodexThresholdFields)[] = ["alertAtPercent", "pauseAtPercent"];

/** The longest spend-out lead time that means anything: a weekly window is a week long. */
const WEEK_MINUTES = 7 * 24 * 60;

/**
 * The fields one provider declares, so a decoder and a writer name the same set.
 *
 * @returns that provider's field names, in print order
 */
export function thresholdFieldsFor({ provider }: { provider: PlanProvider }): readonly string[] {
  if (provider === "claude") {
    return CLAUDE_THRESHOLD_FIELDS;
  }
  return CODEX_THRESHOLD_FIELDS;
}

/**
 * The raw object one provider's thresholds are stored under, or undefined when the register names none.
 *
 * @param document the raw register document, or any object carrying the key
 * @returns the provider's raw record when present and an object
 */
function rawProviderRecord({
  document,
  provider,
}: {
  document: Readonly<Record<string, unknown>>;
  provider: PlanProvider;
}): Readonly<Record<string, unknown>> | undefined {
  const all = document[THRESHOLDS_KEY];
  if (!isRecord(all)) {
    return undefined;
  }
  const one = all[provider];
  return isRecord(one) ? one : undefined;
}

/**
 * The fields of one provider the register actually names — what `plans list` marks `set` rather than `default`.
 *
 * @param document the raw register document
 * @returns the named field names, in print order
 */
export function thresholdFieldsSet({
  document,
  provider,
}: {
  document: Readonly<Record<string, unknown>>;
  provider: PlanProvider;
}): readonly string[] {
  const raw = rawProviderRecord({ document, provider });
  if (raw === undefined) {
    return [];
  }
  return thresholdFieldsFor({ provider }).filter((field) => raw[field] !== undefined);
}

/**
 * Whether one raw value is acceptable for its field: a whole number from 1 through 100, or for the lead time a
 * whole number of minutes from 1 through a week.
 *
 * @param field the field the value was stored under
 * @param value the value as decoded
 * @returns whether the value is in range for that field
 */
function validFieldValue({ field, value }: { field: string; value: unknown }): boolean {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    return false;
  }
  if (field === "spendOutBeforeResetMinutes") {
    return value <= WEEK_MINUTES;
  }
  return value <= 100;
}

/**
 * The range sentence a refusal names for one field.
 *
 * @returns the accepted range, in words
 */
function rangeFor({ field }: { field: string }): string {
  if (field === "spendOutBeforeResetMinutes") {
    return `a whole number of minutes from 1 through ${String(WEEK_MINUTES)}`;
  }
  return "a whole percent from 1 through 100";
}

/**
 * Every problem with one provider's raw object — unknown fields and out-of-range values. Ordering is judged after
 * the merge, by {@link orderingProblems}.
 *
 * @param raw the provider's raw object
 * @returns every problem found
 */
function providerFieldProblems({
  provider,
  raw,
}: {
  provider: PlanProvider;
  raw: Readonly<Record<string, unknown>>;
}): readonly string[] {
  const known = thresholdFieldsFor({ provider });
  return Object.entries(raw).flatMap(([field, value]) => {
    if (!known.includes(field)) {
      return [`\`thresholds.${provider}.${field}\` is not a threshold this build reads — known: ${known.join(", ")}`];
    }
    if (!validFieldValue({ field, value })) {
      return [`\`thresholds.${provider}.${field}\` must be ${rangeFor({ field })}`];
    }
    return [];
  });
}

/**
 * Merge one provider's present raw fields over the defaults, for a register already found free of field problems.
 *
 * @param defaults the provider's default fields
 * @param raw the provider's raw object, or undefined when the register names none
 * @returns the merged fields
 */
function mergeFields<T extends object>({
  defaults,
  raw,
}: {
  defaults: T;
  raw: Readonly<Record<string, unknown>> | undefined;
}): T {
  if (raw === undefined) {
    return defaults;
  }
  return { ...defaults, ...raw };
}

/**
 * Both providers' merged raw fields, for a register already found free of field problems.
 *
 * @param document the raw register document
 * @returns every field, present ones over defaults
 */
export function thresholdFields({ document }: { document: Readonly<Record<string, unknown>> }): PlanThresholdFields {
  return {
    claude: mergeFields({
      defaults: DEFAULT_THRESHOLD_FIELDS.claude,
      raw: rawProviderRecord({ document, provider: "claude" }),
    }),
    codex: mergeFields({
      defaults: DEFAULT_THRESHOLD_FIELDS.codex,
      raw: rawProviderRecord({ document, provider: "codex" }),
    }),
  };
}

/**
 * Every ordering the gates rely on that the merged fields break.
 *
 * - The alert sits below the acceptance bar, which sits below the routing bar: an alert at the wall arrives too
 *   late to act on, and an acceptance bar at or past the routing bar is one the router can never earn
 *   (`claude/loadBalance.ts`, `acceptanceShortfall`).
 * - The routing bar never exceeds the spend-out bar: spend-out LIFTS the bar near a reset, never lowers it.
 * - The balanced spread sits below the drifting spread, or there is no drifting band between them.
 * - Codex's alert sits below its pause bar, for the same reason Claude's sits below its routing bar.
 *
 * @param fields the merged fields
 * @returns every ordering problem, empty when all hold
 */
function orderingProblems({ fields }: { fields: PlanThresholdFields }): readonly string[] {
  const { claude, codex } = fields;
  const problems: string[] = [];
  if (!(claude.alertAtPercent < claude.acceptanceAtPercent)) {
    problems.push("`thresholds.claude.alertAtPercent` must sit below `acceptanceAtPercent`");
  }
  if (!(claude.acceptanceAtPercent < claude.routeAtPercent)) {
    problems.push(
      "`thresholds.claude.acceptanceAtPercent` must sit below `routeAtPercent`, or the router can never earn it",
    );
  }
  if (!(claude.routeAtPercent <= claude.spendOutAtPercent)) {
    problems.push("`thresholds.claude.routeAtPercent` must not exceed `spendOutAtPercent`");
  }
  if (!(claude.balancedSpreadPercent < claude.driftingSpreadPercent)) {
    problems.push("`thresholds.claude.balancedSpreadPercent` must sit below `driftingSpreadPercent`");
  }
  if (!(codex.alertAtPercent < codex.pauseAtPercent)) {
    problems.push("`thresholds.codex.alertAtPercent` must sit below `pauseAtPercent`");
  }
  return problems;
}

/**
 * Every problem with a register's `thresholds`, empty when it is absent or valid.
 *
 * @param document the raw register document
 * @returns every problem found
 */
export function thresholdProblems({ document }: { document: Readonly<Record<string, unknown>> }): readonly string[] {
  const all = document[THRESHOLDS_KEY];
  if (all === undefined) {
    return [];
  }
  if (!isRecord(all)) {
    return ["`thresholds`, when present, must be an object keyed by provider"];
  }
  const fieldProblems = Object.entries(all).flatMap(([provider, raw]) => {
    if (provider !== "claude" && provider !== "codex") {
      return [`\`thresholds.${provider}\` names no provider this build serves — \`claude\` or \`codex\``];
    }
    if (!isRecord(raw)) {
      return [`\`thresholds.${provider}\` must be an object of fields`];
    }
    return providerFieldProblems({ provider, raw });
  });
  if (fieldProblems.length > 0) {
    return fieldProblems;
  }
  return orderingProblems({ fields: thresholdFields({ document }) });
}

/**
 * Claude's merged fields as a gate compares them.
 *
 * @param fields Claude's merged raw fields
 * @returns the fractions and milliseconds
 */
export function claudeThresholdsFrom({ fields }: { fields: ClaudeThresholdFields }): ClaudeThresholds {
  return {
    acceptanceAt: fields.acceptanceAtPercent / 100,
    alertAt: fields.alertAtPercent / 100,
    balancedSpread: fields.balancedSpreadPercent / 100,
    driftingSpread: fields.driftingSpreadPercent / 100,
    routeAt: fields.routeAtPercent / 100,
    spendOutAt: fields.spendOutAtPercent / 100,
    spendOutBeforeResetMs: fields.spendOutBeforeResetMinutes * 60_000,
  };
}

/**
 * Claude's thresholds back in the register's own spelling — what a reading's evidence (`claude gauge --json`, the
 * tick ledger) records, so the bars a verdict was judged under read in the units the owner set them in. Exact for every
 * value {@link claudeThresholdsFrom} can produce, since each field is a whole number.
 *
 * @param thresholds the fractions and milliseconds a gate compared with
 * @returns the whole percents and minutes
 */
export function claudeThresholdFieldsOf({ thresholds }: { thresholds: ClaudeThresholds }): ClaudeThresholdFields {
  return {
    acceptanceAtPercent: Math.round(thresholds.acceptanceAt * 100),
    alertAtPercent: Math.round(thresholds.alertAt * 100),
    balancedSpreadPercent: Math.round(thresholds.balancedSpread * 100),
    driftingSpreadPercent: Math.round(thresholds.driftingSpread * 100),
    routeAtPercent: Math.round(thresholds.routeAt * 100),
    spendOutAtPercent: Math.round(thresholds.spendOutAt * 100),
    spendOutBeforeResetMinutes: Math.round(thresholds.spendOutBeforeResetMs / 60_000),
  };
}

/**
 * Decode a register's thresholds, after {@link thresholdProblems} found none.
 *
 * @param document the raw register document
 * @returns both providers' thresholds, present fields over defaults
 */
export function decodePlanThresholds({ document }: { document: Readonly<Record<string, unknown>> }): PlanThresholds {
  const fields = thresholdFields({ document });
  return { claude: claudeThresholdsFrom({ fields: fields.claude }), codex: fields.codex };
}

/** The thresholds a register naming none decodes to — what a test or a registerless reader passes explicitly. */
export const DEFAULT_THRESHOLDS: PlanThresholds = {
  claude: claudeThresholdsFrom({ fields: DEFAULT_THRESHOLD_FIELDS.claude }),
  codex: DEFAULT_THRESHOLD_FIELDS.codex,
};
