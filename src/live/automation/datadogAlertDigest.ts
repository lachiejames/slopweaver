/**
 * The `datadog-alert-digest` kind's EXECUTOR — the scheduled shape of the three daily alert postings.
 *
 * Those three (Knock, growth-ops, integrity-audit) ran out of the private work console, and
 * when the branch carrying its `yarn work-console` script stopped being checked out every one of them
 * went silent without anything saying so. This kind is how they run on slopweaver's
 * own scheduler, with no dependency on that repository at all.
 *
 * ## It is TWO shipped verbs, composed — the same construction `./alertSummary.ts` uses
 *
 * A run is `datadog alert-digest` (run each declared probe as a read-only aggregate, emit the digest form)
 * followed by `slack post --as bot --form <that form>` (the door-routed write). Neither the counting nor
 * the card is re-implemented here; this module only decides whether a row may run and what argv the two
 * legs get. A card composed anywhere else would drift from the one the schema gates.
 *
 * ## Why the probes live on the ROW and not in this repository
 *
 * A probe names this organisation's services, its log wording and its invariant keys. Shipping that set in
 * the source would put one install's estate in everyone's checkout, which the v2 work-console audit called
 * the hard gate on the whole migration. So the set is `params.probes`, in a definition file under
 * `$SLOPWEAVER_HOME` — the same place the row's channel id already has to live, and for the same reason
 * (`./definition.ts`'s header). What ships here is the SHAPE: three probe kinds, one severity rule, and a
 * refusal for anything else.
 *
 * ## Nothing here launches a model
 *
 * Every number on the card is a Datadog aggregate taken in this process, and every severity is arithmetic
 * over it (`datadog/alertProbe.ts`). The one authored sentence a card may carry is the row's own `lead`.
 * That is rule 2 by construction: there is no prompt to send.
 */
import { z } from "zod";

import { err, ok, type Result } from "../../lib/result.js";
import { introSchema } from "../../outbound/artifact/introAndRank.js";
import { scheduledCardPostArgv } from "./cardPostArgv.js";
import type { RecipeDefinition } from "./definition.js";
import type { RecipeDefinitionRun } from "./definitionRunStore.js";
import { firstFiringIntro, introFlagArgs } from "./firstFiring.js";
import type { RecipeEffect } from "./kinds.js";
import { recommendationsDocumentOf, recommendationsFlagArgs } from "./recommendationSet.js";

/** The kind this module executes. */
export const DATADOG_ALERT_DIGEST_KIND = "datadog-alert-digest";

/**
 * What a `datadog-alert-digest` row's `params` must hold.
 *
 * `probes` is deliberately `unknown` here: `datadog/alertProbe.ts` owns that schema, and a second copy of
 * it in this module would be a validation that agrees with the verb until one of the two is edited. The
 * verb parses it and refuses with the exact reason, which is where a probe-set author needs to read it.
 */
const datadogAlertDigestParamsSchema = z
  .object({
    /**
     * Where the card is ASKED to be posted. Unlike an alert summary there is nothing to read here, so it is
     * required — but it is a REQUEST rather than a destination: a value that is not
     * the owner's DM is refused unless the row carries the owner's recorded approval for it (`./postTarget.ts`).
     */
    channel: z.string().min(1),
    /** The card's subject, e.g. the monitored surface's own name. */
    label: z.string().min(1),
    /** The row's own day-one intro lines — see `./firstFiring.ts`, which derives them when absent. */
    intro: introSchema.optional(),
    /** The one editorial sentence the card may carry. */
    lead: z.string().min(1).optional(),
    /** The declared probe set, validated by the verb rather than here. */
    probes: z.unknown(),
    /**
     * Whether this row's card carries CAPTURES of the views its firing probes cite.
     * `true` is the only value, because the absent case is a row that posts text as it always has,
     * and a `false` would be a second way to spell the same thing.
     *
     * Setting it changes WHERE the row runs: a shots row is spawn-shaped (`./definitionShape.ts`), because
     * a capture is taken in the owner's own Chrome by a session that can see it, and no tick may drive a browser
     * unattended.
     */
    shots: z.literal(true).optional(),
    /**
     * The recommendation lane: the act that clears each firing probe (`clears` names a probe id) and the
     * opportunities nothing alerted on — an array, checked here and passed to the verb as one argv word.
     */
    recommendations: z.unknown().optional(),
    /** How far back every probe counts: `90m`, `24h`, `7d`, `2w`. */
    window: z.string().min(1).optional(),
  })
  .strict();

/** One `datadog-alert-digest` row's resolved plan. */
export interface DatadogAlertDigestPlan {
  readonly recipeId: string;
  /**
   * The conversation the ROW ASKED the card to go to. Where it actually lands is `./postTarget.ts`'s
   * answer against the owner's DM and the row's recorded approvals, which this pure planner cannot see.
   */
  readonly channel: string;
  /** The card's subject. */
  readonly label: string;
  /**
   * The row's own window and sentence, each undefined when the row omitted it.
   *
   * Deliberately NOT defaulted here, for the reason `./alertSummary.ts` gives: `datadog alert-digest` owns
   * its own defaults, and a second copy of them would be a value that agrees with the verb until one of
   * the two is edited. An omitted field omits its flag and the verb decides.
   */
  readonly window: string | undefined;
  readonly lead: string | undefined;
  /** The row's cron expression, which a derived day-one intro states in words. */
  readonly cadence: string;
  /** The row's own day-one intro lines, when it wrote them. */
  readonly intro: readonly string[] | undefined;
  /** The probe set, passed through as one argv word for the verb to parse and refuse. */
  readonly probesDocument: string;
  /** Whether this row's card carries captures of the views its firing probes cite. */
  readonly shots: boolean;
  /** The recommendation set as one argv word, undefined when the row does not turn the lane on. */
  readonly recommendationsDocument: string | undefined;
  /** Why a declared lane is not being passed — reported on the row's outcome line, never a refusal. */
  readonly recommendationsProblem: string | undefined;
}

/** The row's `params` are not a `datadog-alert-digest` configuration at all.
 *
 * @internal
 */
export interface DatadogAlertDigestParamsInvalidError {
  readonly code: "PARAMS_INVALID";
  readonly message: string;
  readonly recipeId: string;
  readonly issues: readonly string[];
}

/** The row declares itself read-only while running it would post a card.
 *
 * @internal
 */
export interface DatadogAlertDigestEffectTooNarrowError {
  readonly code: "EFFECT_TOO_NARROW";
  readonly message: string;
  readonly recipeId: string;
  readonly declared: RecipeEffect;
}

/** Every way one `datadog-alert-digest` row can fail to become a runnable plan. */
export type DatadogAlertDigestPlanError = DatadogAlertDigestParamsInvalidError | DatadogAlertDigestEffectTooNarrowError;

/**
 * Construct one {@link DatadogAlertDigestPlanError}. Tests build fixtures through these, never a hand-built
 * literal.
 *
 * @internal
 */
export const DatadogAlertDigestPlanErrors = {
  effectTooNarrow: ({
    recipeId,
    declared,
  }: {
    readonly recipeId: string;
    readonly declared: RecipeEffect;
  }): DatadogAlertDigestEffectTooNarrowError => ({
    code: "EFFECT_TOO_NARROW",
    declared,
    message:
      `recipe '${recipeId}' declares effect '${declared}', and an alert-digest run POSTS the card it ` +
      "builds — declare 'write' or 'read-write', or park the row rather than letting it send unannounced",
    recipeId,
  }),
  paramsInvalid: ({
    recipeId,
    issues,
  }: {
    readonly recipeId: string;
    readonly issues: readonly string[];
  }): DatadogAlertDigestParamsInvalidError => ({
    code: "PARAMS_INVALID",
    issues,
    message: `recipe '${recipeId}' is not a runnable datadog-alert-digest row: ${issues.join("; ")}`,
    recipeId,
  }),
} as const;

/** The declared effects that cover posting a card. A `read` row is the one this kind must refuse. */
const EFFECTS_THAT_MAY_POST: ReadonlySet<RecipeEffect> = new Set(["write", "read-write"]);

/**
 * Turn one `datadog-alert-digest` row into a runnable plan, or say exactly why it is not one.
 *
 * Pure: it reads the row and nothing else, and runs nothing.
 *
 * The effect check is the mirror of `./alertSummary.ts`'s, and bites in the same direction: `kinds.ts`
 * already refuses a row claiming more than `read-write`, which is toothless here because every digest run
 * posts. What matters is the other way round — a row that declared itself read-only would otherwise send a
 * card on a clock while its own file said it could not.
 *
 * @param definition the parsed row, already known to select the `datadog-alert-digest` kind
 * @returns the plan, or the one reason this row may not run
 */
export function planDatadogAlertDigest({
  definition,
}: {
  definition: RecipeDefinition;
}): Result<DatadogAlertDigestPlan, DatadogAlertDigestPlanError> {
  const parsed = datadogAlertDigestParamsSchema.safeParse(definition.params);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => {
      const path = issue.path.join(".");
      // Named rather than defaulted with `||`: a root-level issue has an EMPTY path, and an operator
      // substituting a word for it is the silent-fallback shape the gate refuses.
      if (path.length === 0) {
        return `params: ${issue.message}`;
      }
      return `${path}: ${issue.message}`;
    });
    return err(DatadogAlertDigestPlanErrors.paramsInvalid({ issues, recipeId: definition.recipeId }));
  }
  if (!EFFECTS_THAT_MAY_POST.has(definition.effect)) {
    return err(
      DatadogAlertDigestPlanErrors.effectTooNarrow({ declared: definition.effect, recipeId: definition.recipeId }),
    );
  }
  const params = parsed.data;
  if (params.probes === undefined) {
    return err(
      DatadogAlertDigestPlanErrors.paramsInvalid({
        issues: ["probes: required — the declared probe set this posting runs"],
        recipeId: definition.recipeId,
      }),
    );
  }
  const recommendations = recommendationsDocumentOf({ value: params.recommendations });
  return ok({
    cadence: definition.cadence,
    channel: params.channel,
    intro: params.intro,
    label: params.label,
    lead: params.lead,
    probesDocument: JSON.stringify({ probes: params.probes }),
    recommendationsDocument: recommendations.document,
    recommendationsProblem: recommendations.problem,
    recipeId: definition.recipeId,
    shots: params.shots === true,
    window: params.window,
  });
}

/**
 * The argv TAIL `datadog alert-digest` is run with — what the verb calls its `rest`, not a process argv.
 *
 * `--form` is what makes the read's stdout the exact document the write consumes; anything else emitted
 * there would have to be stripped, and stripping is where a card starts differing from what was counted.
 *
 * The probe set travels as ONE argv word rather than a file, so the two legs cannot disagree about which
 * set ran: there is no path on disk for something else to have rewritten between them.
 *
 * A flag the row did not configure is OMITTED rather than defaulted, so `datadog alert-digest` remains the
 * one place its own defaults are written down.
 *
 * A row's FIRST firing adds `--intro` (`./firstFiring.ts`), so the day-one lines are part of the form the read
 * emits rather than something spliced into it between the legs.
 *
 * @param plan the resolved plan
 * @param priorRun the row's run record, absent when no firing of it has ever settled
 * @returns the flag tail to hand `runDatadogAlertDigestWith`
 */
export function datadogAlertDigestReadRest({
  plan,
  priorRun,
}: {
  plan: DatadogAlertDigestPlan;
  priorRun: RecipeDefinitionRun | undefined;
}): readonly string[] {
  const intro = firstFiringIntro({ cadence: plan.cadence, intro: plan.intro, priorRun });
  const optional = (
    [
      ["--window", plan.window],
      ["--lead", plan.lead],
    ] as const
  ).flatMap(([flag, value]) => (value === undefined ? [] : [flag, value]));
  return [
    "--probes",
    plan.probesDocument,
    "--label",
    plan.label,
    ...optional,
    ...introFlagArgs({ intro }),
    ...recommendationsFlagArgs({ document: plan.recommendationsDocument }),
    "--form",
  ];
}

/**
 * The full process argv the card is POSTED with.
 *
 * `cli/main.ts` reads the noun at index 2 and the verb at index 3, so the two leading words are the runtime
 * and the script a real invocation would carry — the same shape `alertSummaryPostArgv` builds, and for the
 * same reason: a plan built one way and run another is drift this function removes.
 *
 * Note the name: this takes `postTo`, while the row's own field is `params.channel`. The two differ because
 * one is a request and the other is what `./postTarget.ts` admitted.
 *
 * @param form the form document the read leg emitted, passed whole as one argv word
 * @param home the state home this tick is running over
 * @param dryRun whether to render the card and withhold the network call
 * @param media every graded capture to attach, which the seated session took of this card's own firing
 *   probes; empty posts the card exactly as it posted before shots existed
 * @returns the argv to hand the dispatcher
 */
export function datadogAlertDigestPostArgv({
  form,
  home,
  dryRun,
  idempotencyKey,
  media,
  postTo,
}: {
  form: string;
  home: string;
  dryRun: boolean;
  /** The firing's own delivery id — see the note above {@link datadogAlertDigestPostArgv}'s `--idempotency-key` leg. */
  idempotencyKey: string;
  media: readonly string[];
  /** What `refuseVerbRunPostTargets`' sibling `resolveScheduledPostTarget` handed back for this row. */
  postTo: string;
}): readonly string[] {
  return scheduledCardPostArgv({
    dmPurpose: "investigation-finding",
    dryRun,
    form,
    home,
    idempotencyKey,
    media,
    postTo,
  });
}
