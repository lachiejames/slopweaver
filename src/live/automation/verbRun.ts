/**
 * The `verb-run` kind's EXECUTOR — the half of `./kinds.ts`'s registry that runs a row.
 *
 * `kinds.ts` registers `verb-run` ("run one slopweaver verb named in params, on a schedule"); without an
 * executor a row could select it and the store could parse it, but no code path could run it. This is that
 * path, because the atlas rolling window is exactly a `verb-run` row — `atlas freshness` on a cadence.
 *
 * ## Two checks, and neither is a formality
 *
 * **The verb must ROUTE.** A row names a noun and a verb, and this resolves them against the same registry
 * `slopweaver <noun> <verb>` does. A row naming something that is not a verb is refused rather than passed
 * to a shell, so the definition store — which sits outside code review, and which `definitionStore.ts`'s
 * own header says nothing gates — can never turn a typo into an arbitrary command.
 *
 * **The row's declared effect must cover the verb's.** `kinds.ts` already refuses a row claiming more than
 * its KIND can do; that check is toothless for `verb-run` on its own, because the kind is `read-write` and
 * so covers everything. The check that bites is against the VERB: a row declaring `effect: "read"` may not
 * run a verb whose manifest declares `external-write`. That is the owner's own reason for the field —
 * *"certain recipes do both and some should only read"* — applied where it is actually decidable, and it
 * is one-directional exactly as the kind check is: declaring less than the verb needs is refused, declaring
 * more than it needs is a row kept deliberately narrow and always safe.
 *
 * ## It runs the verb through the CLI's own dispatcher, never a shell
 *
 * In a child of the same CLI tier (`cli/commands/automation/runDueVerbProcess.ts` says why a child and what
 * it is): the same node, exec arguments and entry script, so `cli/main.ts`'s own `main` dispatches it with the
 * row's argv words as separate arguments and no shell, binary lookup or command line in between. Its door,
 * ledger and ruling gate are the ones a typed invocation meets, which keeps a scheduled verb indistinguishable
 * from a typed one: what rule 3 means by one door.
 */
import { z } from "zod";

import type { DoorEffect } from "../../admit/types.js";
import { verbsOfNoun } from "../../cli/nounGroups.js";
import { err, ok, type Result } from "../../lib/result.js";
import type { RecipeDefinition } from "./definition.js";
import type { RecipeEffect } from "./kinds.js";

/** The kind this module executes. */
export const VERB_RUN_KIND = "verb-run";

/** What a `verb-run` row's `params` must hold. */
const verbRunParamsSchema = z
  .object({
    /** The verb and its flags, as argv words — `["atlas", "freshness", "--behind-only"]`. */
    argv: z.array(z.string().min(1)).min(2),
  })
  .strict();

/** One `verb-run` row's resolved plan: the argv to run, and what running it will do. */
export interface VerbRunPlan {
  readonly recipeId: string;
  readonly argv: readonly string[];
  /** The noun and verb the argv resolved to, so a line can name what was actually selected. */
  readonly noun: string;
  readonly verb: string;
  /** What the verb's own manifest says it does to the world. */
  readonly verbEffect: DoorEffect;
}

/** The row's `params` are not a `verb-run` configuration at all.
 *
 * @internal
 */
export interface VerbRunParamsInvalidError {
  readonly code: "PARAMS_INVALID";
  readonly message: string;
  readonly recipeId: string;
  readonly issues: readonly string[];
}

/** The argv names something this build does not route as a verb.
 *
 * @internal
 */
export interface VerbRunUnknownVerbError {
  readonly code: "UNKNOWN_VERB";
  readonly message: string;
  readonly recipeId: string;
  readonly argv: readonly string[];
}

/** The row declares a narrower effect than the verb it selects actually has.
 *
 * @internal
 */
export interface VerbRunEffectExceedsRowError {
  readonly code: "EFFECT_EXCEEDS_ROW";
  readonly message: string;
  readonly recipeId: string;
  readonly declared: RecipeEffect;
  readonly verbEffect: DoorEffect;
}

/** Every way one `verb-run` row can fail to become a runnable plan. */
export type VerbRunPlanError = VerbRunParamsInvalidError | VerbRunUnknownVerbError | VerbRunEffectExceedsRowError;

/**
 * Construct one {@link VerbRunPlanError}. Tests build fixtures through these, never a hand-built literal.
 *
 * @internal
 */
export const VerbRunPlanErrors = {
  effectExceedsRow: ({
    recipeId,
    declared,
    verbEffect,
    noun,
    verb,
  }: {
    readonly recipeId: string;
    readonly declared: RecipeEffect;
    readonly verbEffect: DoorEffect;
    readonly noun: string;
    readonly verb: string;
  }): VerbRunEffectExceedsRowError => ({
    code: "EFFECT_EXCEEDS_ROW",
    declared,
    message:
      `recipe '${recipeId}' declares effect '${declared}' and selects \`${noun} ${verb}\`, whose own ` +
      `manifest declares '${verbEffect}' — a row may declare the same or more than the verb it runs, ` +
      "never less",
    recipeId,
    verbEffect,
  }),
  paramsInvalid: ({
    recipeId,
    issues,
  }: {
    readonly recipeId: string;
    readonly issues: readonly string[];
  }): VerbRunParamsInvalidError => ({
    code: "PARAMS_INVALID",
    issues,
    message: `recipe '${recipeId}' is not a runnable verb-run row: ${issues.join("; ")}`,
    recipeId,
  }),
  unknownVerb: ({
    recipeId,
    argv,
  }: {
    readonly recipeId: string;
    readonly argv: readonly string[];
  }): VerbRunUnknownVerbError => ({
    argv: [...argv],
    code: "UNKNOWN_VERB",
    message:
      `recipe '${recipeId}' names \`${argv.join(" ")}\`, which this build does not route as a slopweaver ` +
      "verb — a row may only select a verb that ships in the repository",
    recipeId,
  }),
} as const;

/** What each declared effect covers, so "declares at least as much" is one lookup rather than a chain. */
const EFFECT_COVERS: Readonly<Record<RecipeEffect, readonly DoorEffect[]>> = {
  read: ["none", "local-state", "external-read"],
  "read-write": ["none", "local-state", "external-read", "external-write"],
  write: ["none", "local-state", "external-read", "external-write"],
};

/**
 * The effect one routed verb's own manifest declares.
 *
 * A noun/verb pair this build does not route answers `undefined` rather than a guess: the caller turns that
 * into the unknown-verb refusal, because a verb whose effect cannot be read is a verb whose declared effect
 * cannot be checked, and running it unchecked is the thing the check exists for.
 *
 * @param noun the noun the row named
 * @param verb the verb the row named
 * @returns the verb's declared effect, or `undefined` when this build routes no such verb
 */
function routedVerbEffect({ noun, verb }: { noun: string; verb: string }): DoorEffect | undefined {
  return verbsOfNoun({ noun })?.[verb]?.meta.effect;
}

/**
 * Where in the row's `params` one schema issue sits. An issue about `params` as a whole — not an object, say —
 * has an empty path, and that one is named `params` rather than printed as a bare colon.
 */
function paramsIssueAt({ path }: { path: readonly PropertyKey[] }): string {
  const joined = path.join(".");
  return joined === "" ? "params" : joined;
}

/**
 * Turn one `verb-run` row into a runnable plan, or say exactly why it is not one.
 *
 * Pure: it reads the row and the verb registry, and runs nothing.
 *
 * @param definition the parsed row, already known to select the `verb-run` kind
 * @returns the plan, or the one reason this row may not run
 */
export function planVerbRun({ definition }: { definition: RecipeDefinition }): Result<VerbRunPlan, VerbRunPlanError> {
  const parsed = verbRunParamsSchema.safeParse(definition.params);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => `${paramsIssueAt({ path: issue.path })}: ${issue.message}`);
    return err(VerbRunPlanErrors.paramsInvalid({ issues, recipeId: definition.recipeId }));
  }
  const argv = parsed.data.argv;
  // Safe: the schema already refused an argv shorter than two words.
  const noun = argv[0]!;
  const verb = argv[1]!;
  const verbEffect = routedVerbEffect({ noun, verb });
  if (verbEffect === undefined) {
    return err(VerbRunPlanErrors.unknownVerb({ argv, recipeId: definition.recipeId }));
  }
  if (!EFFECT_COVERS[definition.effect].includes(verbEffect)) {
    return err(
      VerbRunPlanErrors.effectExceedsRow({
        declared: definition.effect,
        noun,
        recipeId: definition.recipeId,
        verb,
        verbEffect,
      }),
    );
  }
  return ok({ argv, noun, recipeId: definition.recipeId, verb, verbEffect });
}

/**
 * The full process argv one plan is run with.
 *
 * `cli/main.ts` reads the noun at index 2 and the verb at index 3, so the two leading words are the
 * runtime and the script that a real invocation would carry. Spelled here rather than at the call site
 * because a plan built one way and run another is the drift this function removes.
 *
 * @param plan the resolved plan
 * @returns the argv to hand the dispatcher
 */
export function verbRunArgv({ plan }: { plan: VerbRunPlan }): readonly string[] {
  return ["node", "slopweaver", ...plan.argv];
}
