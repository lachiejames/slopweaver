/**
 * The `metrics-push` kind's EXECUTOR — push one install-declared metrics producer's points to Datadog on a
 * schedule, one UTC day per firing, backfilling a hole a day at a time.
 *
 * The kind is a generic function for pushing custom metrics to Datadog, backfill included, useful regardless of
 * what the actual metrics are. So the kind names no metric:
 * a row says which PRODUCER (`profile.json` `datadog.metricsProducers.<name>`, `../../datadog/metricsProducer.ts`
 * carries the contract), and the profile says what that producer runs.
 *
 * ## It is TWO shipped verbs, composed — the construction `./alertSummary.ts` and `./datadogAlertDigest.ts` use
 *
 * A run is `datadog produce --producer <name> --day <the slot's UTC day>` (run the declared producer and write the
 * payload file) followed by `datadog submit --series <that file> --allow-late` (the door-routed write). Neither the
 * numbers nor the door are re-implemented here; this module only decides whether a row may run and what argv the
 * two legs get. `cli/commands/datadog/submitRun.ts` carries why the write is the one it is.
 *
 * ## A row names a producer, never a command
 *
 * `params` is exactly `{ producer }`. The command and the checkout it runs in are an executable trust root, so they
 * live in the profile, where `datadog produce` reads them, and nowhere a definition file can name them.
 *
 * ## `--allow-late` is stated by construction, and that is a decision
 *
 * A slot's day is stamped at its UTC midnight, which is in the past by the time any tick runs — even today's slot,
 * whose midnight point is hours old. So every run of this kind submits backdated points and the door's late-point
 * refusal would fire on every one. The flag is in the argv this module builds rather than in the row, so a
 * definition file cannot turn it off and then wonder why its row never lands; what the flag PROMISES — that
 * Historical Metrics Ingestion covers the producer's metrics — is a Datadog setting `datadog hmi` reads and
 * switches on, never something this code proves.
 *
 * ## One slot per run, by the kind's own declaration
 *
 * `kinds.ts` declares this kind `perSlot: true`, so `definitionDue.ts` hands a `backfill` row its OLDEST owed slot
 * and the tick walks the hole one day at a time. A hole is equally fillable by hand, one `datadog produce` and one
 * `datadog submit` per day, for an install whose producer is too slow to wait on ticks.
 *
 * ## The payload is a FILE under the state home, on purpose
 *
 * `runVerb` dispatches in-process, so `--series -` would read the tick's own stdin. The file at
 * {@link metricsPushPayloadPath} is what the door read, kept, so "what did that run submit" is answerable from disk
 * after the fact — the door's ledger records the decision and the days, never the points.
 */
import { join } from "node:path";

import { z } from "zod";

import { err, ok, type Result } from "#lib/result.js";

import { stateHomePaths } from "../../stateHome.js";
import type { RecipeDefinition } from "./definition.js";
import type { RecipeEffect } from "./kinds.js";

/** The kind this module executes. */
export const METRICS_PUSH_KIND = "metrics-push";

/** What a `metrics-push` row's `params` must hold. */
const metricsPushParamsSchema = z
  .object({
    /** The producer this row pushes — a key of the selected home's `profile.json` `datadog.metricsProducers`. */
    producer: z.string().min(1),
  })
  .strict();

/** One `metrics-push` row's resolved plan. */
export interface MetricsPushPlan {
  readonly recipeId: string;
  readonly producer: string;
}

/** The row's `params` are not a `metrics-push` configuration at all.
 * @internal
 */
export interface MetricsPushParamsInvalidError {
  readonly code: "PARAMS_INVALID";
  readonly message: string;
  readonly recipeId: string;
  readonly issues: readonly string[];
}

/** The row declares itself read-only while running it would submit metric points.
 * @internal
 */
export interface MetricsPushEffectTooNarrowError {
  readonly code: "EFFECT_TOO_NARROW";
  readonly message: string;
  readonly recipeId: string;
  readonly declared: RecipeEffect;
}

/** Every way one `metrics-push` row can fail to become a runnable plan. */
export type MetricsPushPlanError = MetricsPushParamsInvalidError | MetricsPushEffectTooNarrowError;

/**
 * Construct one {@link MetricsPushPlanError}. Tests build fixtures through these, never a hand-built literal.
 * @internal
 */
export const MetricsPushPlanErrors = {
  effectTooNarrow: ({
    recipeId,
    declared,
  }: {
    readonly recipeId: string;
    readonly declared: RecipeEffect;
  }): MetricsPushEffectTooNarrowError => ({
    code: "EFFECT_TOO_NARROW",
    declared,
    message:
      `recipe '${recipeId}' declares effect '${declared}', and a metrics-push run SUBMITS the points it ` +
      "computes — declare 'write' or 'read-write', or park the row rather than letting it write unannounced",
    recipeId,
  }),
  paramsInvalid: ({
    recipeId,
    issues,
  }: {
    readonly recipeId: string;
    readonly issues: readonly string[];
  }): MetricsPushParamsInvalidError => ({
    code: "PARAMS_INVALID",
    issues,
    message: `recipe '${recipeId}' is not a runnable metrics-push row: ${issues.join("; ")}`,
    recipeId,
  }),
} as const;

/** The declared effects that cover submitting points. A `read` row is the one this kind must refuse. */
const EFFECTS_THAT_MAY_SUBMIT: ReadonlySet<RecipeEffect> = new Set(["write", "read-write"]);

/**
 * Turn one `metrics-push` row into a runnable plan, or say exactly why it is not one.
 *
 * Pure: it reads the row and nothing else, and runs nothing — whether the producer is declared is `datadog
 * produce`'s question, answered against the profile at run time. The effect check bites the same way the two card
 * kinds' does: `kinds.ts` refuses a row claiming MORE than `read-write`, which is toothless here because every run
 * writes; what matters is a row that declared itself read-only, which would otherwise stamp a namespace on a clock
 * while its own file said it could not.
 *
 * @param definition the parsed row, already known to select the `metrics-push` kind
 * @returns the plan, or the one reason this row may not run
 */
export function planMetricsPush({
  definition,
}: {
  definition: RecipeDefinition;
}): Result<MetricsPushPlan, MetricsPushPlanError> {
  const parsed = metricsPushParamsSchema.safeParse(definition.params);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => {
      const path = issue.path.join(".");
      if (path.length === 0) {
        return `params: ${issue.message}`;
      }
      return `${path}: ${issue.message}`;
    });
    return err(MetricsPushPlanErrors.paramsInvalid({ issues, recipeId: definition.recipeId }));
  }
  if (!EFFECTS_THAT_MAY_SUBMIT.has(definition.effect)) {
    return err(MetricsPushPlanErrors.effectTooNarrow({ declared: definition.effect, recipeId: definition.recipeId }));
  }
  return ok({ producer: parsed.data.producer, recipeId: definition.recipeId });
}

/**
 * The UTC day a cadence firing covers — the calendar day its instant falls on, in UTC.
 *
 * A cadence is written in the installation's local time, so a `0 13 * * *` row in Melbourne fires in the early
 * hours UTC and covers that UTC day; a producer stamps the day's midnight, so "the slot's day" is the only mapping that puts one
 * point per UTC day on the chart.
 *
 * @param slotIso the firing instant
 * @returns the `YYYY-MM-DD` it falls on
 */
export function slotUtcDay({ slotIso }: { readonly slotIso: string }): string {
  return new Date(Date.parse(slotIso)).toISOString().slice(0, 10);
}

/**
 * Where one firing's payload is written, under the state home.
 *
 * @param home the state home this tick is running over
 * @param recipeId the row
 * @param slotIso the firing
 * @returns the payload path
 */
export function metricsPushPayloadPath({
  home,
  recipeId,
  slotIso,
}: {
  readonly home: string;
  readonly recipeId: string;
  readonly slotIso: string;
}): string {
  return join(stateHomePaths({ home }).live.recipe.metricsPushDir, recipeId, `${slotUtcDay({ slotIso })}.json`);
}

/**
 * The full process argv the PRODUCE leg runs with — `datadog produce` for the row's producer and the slot's day.
 *
 * `cli/main.ts` reads the noun at index 2 and the verb at index 3, so the two leading words are the runtime and the
 * script a real invocation would carry — the same shape every other kind's argv builder makes.
 *
 * @param plan the resolved plan
 * @param slotIso the firing this run covers
 * @param home the state home this tick is running over
 * @returns the argv to hand the dispatcher
 */
export function metricsPushProduceArgv({
  plan,
  slotIso,
  home,
}: {
  readonly plan: MetricsPushPlan;
  readonly slotIso: string;
  readonly home: string;
}): readonly string[] {
  return [
    "node",
    "slopweaver",
    "datadog",
    "produce",
    "--producer",
    plan.producer,
    "--day",
    slotUtcDay({ slotIso }),
    "--out",
    metricsPushPayloadPath({ home, recipeId: plan.recipeId, slotIso }),
    "--home",
    home,
  ];
}

/**
 * The full process argv the WRITE leg runs with — `datadog submit --allow-late` over the produced file.
 *
 * @param plan the resolved plan
 * @param slotIso the firing this run covers
 * @param home the state home this tick is running over
 * @param dryRun whether to plan the submission and withhold the network call
 * @returns the argv to hand the dispatcher
 */
export function metricsPushSubmitArgv({
  plan,
  slotIso,
  home,
  dryRun,
}: {
  readonly plan: MetricsPushPlan;
  readonly slotIso: string;
  readonly home: string;
  readonly dryRun: boolean;
}): readonly string[] {
  return [
    "node",
    "slopweaver",
    "datadog",
    "submit",
    "--series",
    metricsPushPayloadPath({ home, recipeId: plan.recipeId, slotIso }),
    "--allow-late",
    "--home",
    home,
    ...(dryRun ? ["--dry-run"] : []),
  ];
}
