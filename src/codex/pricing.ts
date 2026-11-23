/**
 * Putting a price beside a Codex pass — from a rate card the installation supplies, never one guessed here.
 *
 * ## There is no tariff in this repository, and that is deliberate
 *
 * `src/sessions/sessionCost.ts` declines to report dollars for exactly this reason, and `src/audit/costEstimate.ts`
 * is a distil estimator rather than a Codex tariff. A price invented from the owner's approximate monthly
 * figure would be a number with a decimal point and no provenance, which reads as a measurement and is not
 * one. So every number comes from a card passed in with `--rates <path>`, the card names its own source and
 * effective period, and everything this module cannot price comes back as `unpriced` WITH A REASON rather
 * than as zero.
 *
 * ## What a price here IS, stated so nothing over-reads it
 *
 * A token-based estimate at the REQUESTED model's published rate. Three things it is not:
 *
 *  - **Not an invoice.** Codex here runs on a subscription; a pass's marginal cash cost is not its token
 *    price, and only the provider's own billing can say what was charged.
 *  - **Not a claim about which model ran.** `CodexArtifactRecord` carries `requestedModel` and nothing else
 *    (`./types.ts` says why), so the rate is the one for the model that was ASKED for.
 *  - **Not a total across overlapping counters.** Which of the five SDK counters sit inside their parents is
 *    a property of the SDK version, so a card must DECLARE that mapping and say who verified it. A card
 *    whose mapping is unverified prices nothing — an unverified mapping is precisely how the same tokens get
 *    billed twice.
 *
 * Pure: the card and the reading are both supplied. `./pricingStore.ts` is the half that reads a file.
 */

import { parseIsoMs } from "#lib/date.js";
import { err, ok, type Result } from "#lib/result.js";
import { type CodexPricingError, CodexPricingErrors } from "./pricingErrors.js";
import type { CodexUsage, UsageMeasurement } from "./types.js";

/**
 * Dollars (or whatever the card's currency is) per million tokens, one rate per counter.
 *
 * @internal a field of the exported card, never imported by name.
 */
export interface CodexTokenRates {
  readonly input: number;
  readonly cachedInput: number;
  readonly cacheWriteInput: number;
  readonly output: number;
}

/**
 * One model's rates.
 *
 * @internal a field of the exported card, never imported by name.
 */
export interface CodexModelRate {
  readonly model: string;
  readonly perMillionTokens: CodexTokenRates;
}

/**
 * How the card says the SDK's five counters relate to each other.
 *
 * Declared rather than assumed, because getting it wrong bills the same tokens twice and the error is
 * invisible in the output — a plausible number, wrong by a factor. `verifiedBy` is a sentence naming who
 * established it against which SDK version; a card that cannot fill it in prices nothing.
 *
 * @internal a field of the exported card, never imported by name.
 */
export interface CodexCounterMapping {
  /** `cached_input_tokens` are a SUBSET of `input_tokens` rather than a figure beside it. */
  readonly cachedInputIncludedInInput: boolean;
  /** `cache_write_input_tokens` are a subset of `input_tokens`. */
  readonly cacheWriteIncludedInInput: boolean;
  /** `reasoning_output_tokens` are a subset of `output_tokens`. */
  readonly reasoningIncludedInOutput: boolean;
  /** Who established this, against what. Empty means unverified, and an unverified mapping prices nothing. */
  readonly verifiedBy: string;
}

/** An installation's rate card. Versioned, sourced and dated, so a stale one is visible rather than silent. */
export interface CodexRateCard {
  readonly schemaVersion: 1;
  /** ISO-4217 or whatever the source publishes in — printed verbatim, never converted. */
  readonly currency: string;
  /** Where the numbers came from, in the card author's own words. */
  readonly source: string;
  readonly effectiveFromIso: string;
  /** The end of the card's validity, or undefined when the author declared none. */
  readonly effectiveToIso: string | undefined;
  readonly counterMapping: CodexCounterMapping;
  readonly models: readonly CodexModelRate[];
}

/** A price, or a stated reason there is none. Never a zero standing in for either. */
export type CodexPriceEstimate =
  | {
      readonly kind: "priced";
      readonly currency: string;
      readonly amount: number;
      readonly model: string;
      /** What was multiplied by what, so a reader can check the arithmetic rather than trust it. */
      readonly basis: string;
    }
  | { readonly kind: "unpriced"; readonly reason: string };

/** Tokens per unit of a `perMillionTokens` rate. */
const TOKENS_PER_RATE_UNIT = 1_000_000;

/** Whether a value is a finite, non-negative number — every rate and counter must be one. */
function isRate(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

/** Whether a value is a non-empty string. */
function isText(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

/** A record, for the shape walk below. */
function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Validate the four per-counter rates of one model entry, collecting every problem.
 *
 * @param at a path prefix for the messages, so a reader knows which model failed
 * @returns the rates, or every reason they were refused
 */
function parseTokenRates({ at, value }: { at: string; value: unknown }): Result<CodexTokenRates, CodexPricingError> {
  if (!isObject(value)) {
    return err(CodexPricingErrors.invalid({ problems: [`${at}.perMillionTokens must be an object of four rates`] }));
  }
  const problems: string[] = [];
  // Each field is read into a LOCAL that the guard narrows, rather than checked by name and then asserted.
  // An assertion after a check is a second, unchecked claim that both looked at the same key — a typo in
  // either string compiles and reads `undefined` as a number. `no-unsafe-type-assertion` refuses it, rightly.
  const input = value["input"];
  const cachedInput = value["cachedInput"];
  const cacheWriteInput = value["cacheWriteInput"];
  const output = value["output"];
  for (const [field, rate] of [
    ["input", input],
    ["cachedInput", cachedInput],
    ["cacheWriteInput", cacheWriteInput],
    ["output", output],
  ] as const) {
    if (!isRate(rate)) {
      problems.push(`${at}.perMillionTokens.${field} must be a finite number at or above zero`);
    }
  }
  if (problems.length > 0 || !isRate(input) || !isRate(cachedInput) || !isRate(cacheWriteInput) || !isRate(output)) {
    return err(CodexPricingErrors.invalid({ problems }));
  }
  return ok({ cacheWriteInput, cachedInput, input, output });
}

/**
 * Validate the counter mapping.
 *
 * @returns the mapping, or every reason it was refused
 */
function parseCounterMapping({ value }: { value: unknown }): Result<CodexCounterMapping, CodexPricingError> {
  if (!isObject(value)) {
    return err(CodexPricingErrors.invalid({ problems: ["counterMapping must be an object"] }));
  }
  const problems: string[] = [];
  const cachedInputIncludedInInput = value["cachedInputIncludedInInput"];
  const cacheWriteIncludedInInput = value["cacheWriteIncludedInInput"];
  const reasoningIncludedInOutput = value["reasoningIncludedInOutput"];
  const verifiedBy = value["verifiedBy"];
  for (const [field, flag] of [
    ["cachedInputIncludedInInput", cachedInputIncludedInInput],
    ["cacheWriteIncludedInInput", cacheWriteIncludedInInput],
    ["reasoningIncludedInOutput", reasoningIncludedInOutput],
  ] as const) {
    if (typeof flag !== "boolean") {
      problems.push(`counterMapping.${field} must be a boolean — which counters overlap is not guessable`);
    }
  }
  if (typeof verifiedBy !== "string") {
    problems.push("counterMapping.verifiedBy must be a string naming who established the mapping (empty = unverified)");
  }
  if (
    problems.length > 0 ||
    typeof cachedInputIncludedInInput !== "boolean" ||
    typeof cacheWriteIncludedInInput !== "boolean" ||
    typeof reasoningIncludedInOutput !== "boolean" ||
    typeof verifiedBy !== "string"
  ) {
    return err(CodexPricingErrors.invalid({ problems }));
  }
  return ok({ cacheWriteIncludedInInput, cachedInputIncludedInInput, reasoningIncludedInOutput, verifiedBy });
}

/**
 * Validate a parsed rate-card document.
 *
 * Reports EVERY problem rather than the first, because a card is hand-written and fixing one field at a time
 * across four runs is the experience this list exists to avoid. That multiplicity survives the typed union:
 * {@link CodexPricingErrors.invalid} carries the whole list in `problems`, so nothing is collapsed to a
 * single message (`.claude/rules/error-handling.md` § When NOT to introduce a union, read from the other
 * side — the domain declares a union, and the union keeps the list).
 *
 * @param value the already-parsed JSON document
 * @returns the card, or every reason it was refused
 */
export function parseCodexRateCard({ value }: { value: unknown }): Result<CodexRateCard, CodexPricingError> {
  if (!isObject(value)) {
    return err(CodexPricingErrors.invalid({ problems: ["a rate card must be a JSON object"] }));
  }
  const scalars = parseCardScalars({ value });
  const mapping = parseCounterMapping({ value: value["counterMapping"] });
  const models = parseModelRates({ value: value["models"] });
  const problems = [
    ...(scalars.isErr() ? scalars.error.problems : []),
    ...(mapping.isErr() ? mapping.error.problems : []),
    ...(models.isErr() ? models.error.problems : []),
  ];
  if (problems.length > 0 || scalars.isErr() || mapping.isErr() || models.isErr()) {
    return err(CodexPricingErrors.invalid({ problems }));
  }
  return ok({ ...scalars.value, counterMapping: mapping.value, models: models.value, schemaVersion: 1 });
}

/**
 * The card's flat fields — currency, source and its effective period.
 *
 * Split out so {@link parseCodexRateCard} reads as three validations and a join rather than one long list of
 * branches. The period is checked HERE and not where a price is computed, because a card whose own dates do
 * not parse is a broken card, while a pass outside a valid card's period is an ordinary `unpriced`.
 *
 * @param value the whole card document, already known to be an object
 * @returns the flat fields, or every reason one was refused
 */
function parseCardScalars({
  value,
}: {
  value: Record<string, unknown>;
}): Result<Pick<CodexRateCard, "currency" | "source" | "effectiveFromIso" | "effectiveToIso">, CodexPricingError> {
  const problems: string[] = [];
  const currency = value["currency"];
  const source = value["source"];
  const effectiveFromIso = value["effectiveFromIso"];
  const to = value["effectiveToIso"];
  if (value["schemaVersion"] !== 1) {
    problems.push("schemaVersion must be 1");
  }
  for (const [field, text] of [
    ["currency", currency],
    ["source", source],
    ["effectiveFromIso", effectiveFromIso],
  ] as const) {
    if (!isText(text)) {
      problems.push(`${field} must be a non-empty string`);
    }
  }
  if (isText(effectiveFromIso) && parseIsoMs({ tsIso: effectiveFromIso }) === undefined) {
    problems.push("effectiveFromIso must be an ISO-8601 instant");
  }
  if (to != null && (!isText(to) || parseIsoMs({ tsIso: to }) === undefined)) {
    problems.push("effectiveToIso must be an ISO-8601 instant when present");
  }
  if (problems.length > 0 || !isText(currency) || !isText(source) || !isText(effectiveFromIso)) {
    return err(CodexPricingErrors.invalid({ problems }));
  }
  return ok({ currency, effectiveFromIso, effectiveToIso: isText(to) ? to : undefined, source });
}

/**
 * Whether an instant falls inside a card's declared effective period.
 *
 * An instant that will not parse is OUTSIDE it: a pass whose start time cannot be read cannot be shown to
 * have happened while the card was valid, and pricing it anyway would date a number to nothing.
 *
 * @param startedAtIso when the attempt began
 * @param card the card being applied
 * @returns true only when the instant parses and sits within the declared period
 */
function withinPeriod({ startedAtIso, card }: { startedAtIso: string; card: CodexRateCard }): boolean {
  const at = parseIsoMs({ tsIso: startedAtIso });
  const from = parseIsoMs({ tsIso: card.effectiveFromIso });
  if (at === undefined || from === undefined || at < from) {
    return false;
  }
  if (card.effectiveToIso === undefined) {
    return true;
  }
  const to = parseIsoMs({ tsIso: card.effectiveToIso });
  return to !== undefined && at <= to;
}

/**
 * Price one attempt's measured usage against a card.
 *
 * The overlap arithmetic is the part worth reading. Each counter the card declares as a SUBSET is subtracted
 * from its parent before the parent is billed, so no token is charged twice; a subtraction that would go
 * negative means the card's mapping does not fit the reading, and that returns `unpriced` rather than a
 * clamped figure — a clamp would silently price a reading the card cannot explain.
 *
 * @param usage the attempt's usage, measured or not
 * @param requestedModel the model the pass ASKED for (never an observation of what ran)
 * @param startedAtIso when the attempt began, judged against the card's effective period
 * @param rateCard the installation's card
 * @returns a priced estimate, or the reason there is none
 */
export function priceCodexAttempt({
  usage,
  requestedModel,
  startedAtIso,
  rateCard,
}: {
  usage: UsageMeasurement;
  requestedModel: string;
  startedAtIso: string;
  rateCard: CodexRateCard;
}): CodexPriceEstimate {
  if (usage.kind !== "measured") {
    return { kind: "unpriced", reason: `the attempt reported no usage (${usage.reason})` };
  }
  if (rateCard.counterMapping.verifiedBy.length === 0) {
    return {
      kind: "unpriced",
      reason: "the card's counter mapping names nobody who verified it, and an unverified mapping double-bills",
    };
  }
  const rate = rateCard.models.find((entry) => entry.model === requestedModel);
  if (rate === undefined) {
    return { kind: "unpriced", reason: `the card names no rate for the requested model ${requestedModel}` };
  }
  if (!withinPeriod({ card: rateCard, startedAtIso })) {
    return {
      kind: "unpriced",
      reason: `the attempt started ${startedAtIso}, outside the card's period from ${rateCard.effectiveFromIso}`,
    };
  }
  const billable = billableCounters({ counters: usage.usage, mapping: rateCard.counterMapping });
  if (billable === undefined) {
    return {
      kind: "unpriced",
      reason:
        "the card's counter mapping does not fit this reading — subtracting the counters it calls subsets " +
        "leaves a negative parent, so which counters overlap is not what the card says",
    };
  }
  const perMillion = rate.perMillionTokens;
  const amount =
    (billable.input * perMillion.input +
      billable.cachedInput * perMillion.cachedInput +
      billable.cacheWriteInput * perMillion.cacheWriteInput +
      billable.output * perMillion.output) /
    TOKENS_PER_RATE_UNIT;
  return {
    amount,
    basis:
      `${String(billable.input)} input + ${String(billable.cachedInput)} cached + ` +
      `${String(billable.cacheWriteInput)} cache-write + ` +
      `${String(billable.output)} output tokens at ${rateCard.source}`,
    currency: rateCard.currency,
    kind: "priced",
    model: requestedModel,
  };
}

/**
 * The four counter totals to bill, with every declared subset removed from its parent exactly once.
 *
 * This is the arithmetic the whole module exists to get right. Each counter the card calls a SUBSET is
 * subtracted from its parent before the parent is billed, so no token is charged twice — and a subtraction
 * that would go negative means the card's mapping does not describe this reading, which is `undefined` here
 * rather than a clamp. A clamp would silently price a reading the card cannot explain.
 *
 * @param counters the attempt's five measured counters
 * @param mapping what the card says overlaps what
 * @returns the four billable totals, or `undefined` when the mapping does not fit
 */
function billableCounters({
  counters,
  mapping,
}: {
  counters: CodexUsage;
  mapping: CodexCounterMapping;
}): CodexTokenRates | undefined {
  const cachedInInput = mapping.cachedInputIncludedInInput ? counters.cached_input_tokens : 0;
  const writeInInput = mapping.cacheWriteIncludedInInput ? counters.cache_write_input_tokens : 0;
  const input = counters.input_tokens - cachedInInput - writeInInput;
  const reasoningInOutput = mapping.reasoningIncludedInOutput ? counters.reasoning_output_tokens : 0;
  const plainOutput = counters.output_tokens - reasoningInOutput;
  if (input < 0 || plainOutput < 0) {
    return undefined;
  }
  return {
    cacheWriteInput: counters.cache_write_input_tokens,
    cachedInput: counters.cached_input_tokens,
    input,
    // Reasoning output is billed at the OUTPUT rate, whether or not the card calls it a subset: subtracting it
    // above and adding it back here is what makes both mappings produce the same total for the same tokens.
    output: plainOutput + counters.reasoning_output_tokens,
  };
}

/**
 * Validate the card's `models` array — every entry, reporting every problem.
 *
 * Split out of {@link parseCodexRateCard} so that function stays a readable list of field checks; a card is
 * hand-written and its failure list is the whole user interface, so both halves collect rather than return
 * early (`.claude/rules/error-handling.md` § When NOT to introduce a union).
 *
 * @param value the card's `models` field
 * @returns every model's rates, or every reason one was refused
 */
function parseModelRates({ value }: { value: unknown }): Result<readonly CodexModelRate[], CodexPricingError> {
  if (!Array.isArray(value) || value.length === 0) {
    return err(CodexPricingErrors.invalid({ problems: ["models must be a non-empty array"] }));
  }
  const problems: string[] = [];
  const models: CodexModelRate[] = [];
  value.forEach((entry: unknown, index) => {
    const at = `models[${String(index)}]`;
    const model = isObject(entry) ? entry["model"] : undefined;
    if (!isObject(entry) || !isText(model)) {
      problems.push(`${at}.model must be a non-empty string`);
      return;
    }
    const rates = parseTokenRates({ at, value: entry["perMillionTokens"] });
    if (rates.isErr()) {
      for (const problem of rates.error.problems) {
        problems.push(problem);
      }
      return;
    }
    models.push({ model, perMillionTokens: rates.value });
  });
  return problems.length > 0 ? err(CodexPricingErrors.invalid({ problems })) : ok(models);
}
