/**
 * The `alert-summary` kind's EXECUTOR — the second half of `./kinds.ts`'s registry to be written.
 *
 * `kinds.ts` has registered `alert-summary` ("investigate a monitored surface and post one card through the
 * door"), and nothing could run one: a row could select the kind, the store could
 * parse it, and `automation run-due` reported it as somebody else's to run. That is the same gap `verb-run` had
 * before its executor existed, and this closes it the same way — a pure planner, a typed refusal, and argv the tick
 * hands to code that already ships.
 *
 * ## It is TWO shipped verbs, composed — not a third implementation of either
 *
 * A run is `slack alert-summary` (read the monitored channel's window, tally it in pure code, emit the card's
 * form) followed by `slack post --as bot --form <that form>` (the door-routed write). Neither the tally nor
 * the card is re-implemented here; this module only decides whether a row may run and what argv the two
 * legs get. A card composed anywhere else would drift from the one the schema gates.
 *
 * ## The read and the write are reached differently, and the asymmetry is the door rather than convenience
 *
 * The write goes through `cli/main.ts`'s dispatcher, so a scheduled post is indistinguishable from a typed
 * one — same door request, same gate, same voice-rule check (rule 3, one door). The read does not: its own
 * manifest declares `external-read` and `alertSummaryRun.ts`'s header says why it routes no door request —
 * there is no effect to route. So the tick calls that verb's exported runner with its `writeOut` sink
 * swapped for a collector, which is the same code path with a different edge, and is how the form reaches
 * the write without a file, a pipe or a spawned shell.
 *
 * ## Nothing here launches a model
 *
 * Every number on the card comes from `live/slack/alertTally.ts`, in this process. The one editorial
 * sentence a card may carry is the row's own `lead`, composed by whoever wrote the row and validated
 * against the counted rows by `live/slack/alertLead.ts` — a sentence claiming a number the counts cannot
 * account for is dropped rather than posted. That is rule 2 by construction: there is no prompt to send.
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
export const ALERT_SUMMARY_KIND = "alert-summary";

/** What an `alert-summary` row's `params` must hold. */
const alertSummaryParamsSchema = z
  .object({
    /** The conversation id whose window is READ and tallied. */
    channel: z.string().min(1),
    /** The card's subject, e.g. the monitored channel's own name. */
    label: z.string().min(1).optional(),
    /** The row's own day-one intro lines — see `./firstFiring.ts`, which derives them when absent. */
    intro: introSchema.optional(),
    /** The one editorial sentence, validated against the counted rows before it is allowed onto the card. */
    lead: z.string().min(1).optional(),
    /**
     * The recommendation lane: the act that clears each alert that fired (`clears` names its stable name, as
     * `slack alert-summary --json` lists under `firedNames`) and opportunities — checked here, passed as one word.
     */
    recommendations: z.unknown().optional(),
    /**
     * Where the card is POSTED, when the row asks for somewhere other than the owner's DM.
     *
     * It never defaults to `channel` — the team channel being read — because that would let an alert-summary row
     * post into a team channel without anybody choosing it: absent means the owner's own bot DM, and a value
     * here is refused unless the row carries the owner's approval for it (`./postTarget.ts`).
     */
    postTo: z.string().min(1).optional(),
    /** How far back to read: `90m`, `24h`, `7d`, `2w`. */
    window: z.string().min(1).optional(),
  })
  .strict();

/** One `alert-summary` row's resolved plan: what to read, what to call it, and where the card lands. */
export interface AlertSummaryPlan {
  readonly recipeId: string;
  /** The conversation whose window is read. */
  readonly channel: string;
  /**
   * The conversation the ROW ASKED the card to go to, `undefined` when it named none.
   *
   * Deliberately NOT resolved here, and the `undefined` is load-bearing: where a scheduled card may land is
   * decided by `./postTarget.ts` against the owner's DM and the row's recorded approvals, which this pure planner
   * cannot see. Resolving it here would mean this module holding a second opinion about the one thing owner
   * turn 291-8x made non-negotiable.
   */
  readonly postTo: string | undefined;
  /**
   * The row's own window, label and sentence, each undefined when the row omitted it.
   *
   * Deliberately NOT defaulted here. `slack alert-summary` owns its own defaults, and a second copy of them
   * in this module would be a value that agrees with the verb until one of the two is edited — so an omitted
   * field omits its flag and the verb decides, which keeps one authority rather than two.
   */
  readonly window: string | undefined;
  readonly label: string | undefined;
  readonly lead: string | undefined;
  /** The row's cron expression, which a derived day-one intro states in words. */
  readonly cadence: string;
  /** The row's own day-one intro lines, when it wrote them. */
  readonly intro: readonly string[] | undefined;
  /** The recommendation set as one argv word, undefined when the row does not turn the lane on. */
  readonly recommendationsDocument: string | undefined;
  /** Why a declared lane is not being passed — reported on the row's outcome line, never a refusal. */
  readonly recommendationsProblem: string | undefined;
}

/** The row's `params` are not an `alert-summary` configuration at all.
 *
 * @internal
 */
export interface AlertSummaryParamsInvalidError {
  readonly code: "PARAMS_INVALID";
  readonly message: string;
  readonly recipeId: string;
  readonly issues: readonly string[];
}

/** The row declares itself read-only while running it would post a card.
 *
 * @internal
 */
export interface AlertSummaryEffectTooNarrowError {
  readonly code: "EFFECT_TOO_NARROW";
  readonly message: string;
  readonly recipeId: string;
  readonly declared: RecipeEffect;
}

/** Every way one `alert-summary` row can fail to become a runnable plan. */
export type AlertSummaryPlanError = AlertSummaryParamsInvalidError | AlertSummaryEffectTooNarrowError;

/**
 * Construct one {@link AlertSummaryPlanError}. Tests build fixtures through these, never a hand-built literal.
 *
 * @internal
 */
export const AlertSummaryPlanErrors = {
  effectTooNarrow: ({
    recipeId,
    declared,
  }: {
    readonly recipeId: string;
    readonly declared: RecipeEffect;
  }): AlertSummaryEffectTooNarrowError => ({
    code: "EFFECT_TOO_NARROW",
    declared,
    message:
      `recipe '${recipeId}' declares effect '${declared}', and an alert-summary run POSTS the card it ` +
      "builds — declare 'write' or 'read-write', or park the row rather than letting it send unannounced",
    recipeId,
  }),
  paramsInvalid: ({
    recipeId,
    issues,
  }: {
    readonly recipeId: string;
    readonly issues: readonly string[];
  }): AlertSummaryParamsInvalidError => ({
    code: "PARAMS_INVALID",
    issues,
    message: `recipe '${recipeId}' is not a runnable alert-summary row: ${issues.join("; ")}`,
    recipeId,
  }),
} as const;

/** The declared effects that cover posting a card. A `read` row is the one this kind must refuse. */
const EFFECTS_THAT_MAY_POST: ReadonlySet<RecipeEffect> = new Set(["write", "read-write"]);

/**
 * Where in the row's `params` one schema issue sits. An issue about `params` as a whole — not an object, say —
 * has an empty path, and that one is named `params` rather than printed as a bare colon.
 */
function paramsIssueAt({ path }: { path: readonly PropertyKey[] }): string {
  const joined = path.join(".");
  return joined === "" ? "params" : joined;
}

/**
 * Turn one `alert-summary` row into a runnable plan, or say exactly why it is not one.
 *
 * Pure: it reads the row and nothing else, and runs nothing.
 *
 * The effect check is the mirror of `verbRun.ts`'s, decided against what this kind DOES rather than against
 * what the kind registry permits: `kinds.ts` already refuses a row claiming more than `read-write`, which is
 * toothless here because every alert-summary run posts. What bites is the other direction — a row that
 * declared itself read-only would otherwise send a card on a clock while its own file said it could not.
 *
 * @param definition the parsed row, already known to select the `alert-summary` kind
 * @returns the plan, or the one reason this row may not run
 */
export function planAlertSummary({
  definition,
}: {
  definition: RecipeDefinition;
}): Result<AlertSummaryPlan, AlertSummaryPlanError> {
  const parsed = alertSummaryParamsSchema.safeParse(definition.params);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => `${paramsIssueAt({ path: issue.path })}: ${issue.message}`);
    return err(AlertSummaryPlanErrors.paramsInvalid({ issues, recipeId: definition.recipeId }));
  }
  if (!EFFECTS_THAT_MAY_POST.has(definition.effect)) {
    return err(AlertSummaryPlanErrors.effectTooNarrow({ declared: definition.effect, recipeId: definition.recipeId }));
  }
  const params = parsed.data;
  const recommendations = recommendationsDocumentOf({ value: params.recommendations });
  return ok({
    cadence: definition.cadence,
    channel: params.channel,
    intro: params.intro,
    label: params.label,
    lead: params.lead,
    postTo: params.postTo,
    recommendationsDocument: recommendations.document,
    recommendationsProblem: recommendations.problem,
    recipeId: definition.recipeId,
    window: params.window,
  });
}

/**
 * The argv TAIL `slack alert-summary` is run with — what the verb calls its `rest`, not a process argv.
 *
 * `--form` is what makes the read's stdout the exact document the write consumes; anything else emitted
 * there would have to be stripped, and stripping is where a card starts differing from what was counted.
 *
 * A flag the row did not configure is OMITTED rather than defaulted, so `slack alert-summary` remains the
 * one place its own defaults are written down. `--home` is always passed: both legs must resolve their
 * token, their voice rules and their ledger from the SAME install the tick is running over.
 *
 * A row's FIRST firing adds `--intro` (`./firstFiring.ts`), so the day-one lines are part of the form the read
 * emits rather than something spliced into it between the legs.
 *
 * @param plan the resolved plan
 * @param home the state home this tick is running over, passed on so both legs read one install
 * @param priorRun the row's run record, absent when no firing of it has ever settled
 * @returns the flag tail to hand `runSlackAlertSummary`
 */
export function alertSummaryReadRest({
  plan,
  home,
  priorRun,
}: {
  plan: AlertSummaryPlan;
  home: string;
  priorRun: RecipeDefinitionRun | undefined;
}): readonly string[] {
  const intro = firstFiringIntro({ cadence: plan.cadence, intro: plan.intro, priorRun });
  const optional = (
    [
      ["--window", plan.window],
      ["--label", plan.label],
      ["--lead", plan.lead],
    ] as const
  ).flatMap(([flag, value]) => (value === undefined ? [] : [flag, value]));
  return [
    "--channel",
    plan.channel,
    ...optional,
    ...introFlagArgs({ intro }),
    ...recommendationsFlagArgs({ document: plan.recommendationsDocument }),
    "--home",
    home,
    "--form",
  ];
}

/**
 * The full process argv the card is POSTED with.
 *
 * `cli/main.ts` reads the noun at index 2 and the verb at index 3, so the two leading words are the runtime
 * and the script a real invocation would carry — the same shape `verbRunArgv` builds, and for the same
 * reason: a plan built one way and run another is drift this function removes.
 *
 * Its destination arrives as an ARGUMENT, not off the plan: see `./postTarget.ts` § "The DEFAULT was the
 * defect" for why no field here may hold one.
 *
 * @param form the form document the read leg emitted, passed whole as one argv word
 * @param home the state home this tick is running over
 * @param dryRun whether to render the card and withhold the network call
 * @returns the argv to hand the dispatcher
 */
export function alertSummaryPostArgv({
  form,
  home,
  dryRun,
  idempotencyKey,
  postTo,
}: {
  form: string;
  home: string;
  dryRun: boolean;
  /** The firing's own delivery id — see the note above {@link alertSummaryPostArgv}'s `--idempotency-key` leg. */
  idempotencyKey: string;
  /** Already admitted by `resolveScheduledPostTarget` — the owner's DM, or a channel this row records. */
  postTo: string;
}): readonly string[] {
  return scheduledCardPostArgv({
    dmPurpose: "investigation-finding",
    dryRun,
    form,
    home,
    idempotencyKey,
    media: [],
    postTo,
  });
}
