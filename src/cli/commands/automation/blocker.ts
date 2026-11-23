/**
 * `slopweaver automation blocker` — record that one scheduled target cannot resync unattended, with the exact
 * steps that clear it.
 *
 * **A card must never ask the owner whether to resync.** The corollary: where a sync genuinely cannot run
 * unattended, because it needs a consent or a token only the owner can mint, the exact blocker is registered as a
 * finding row with the clickops steps rather than asked about. This is the machine half of that: the blocker lands beside the
 * target's own resync record, so the briefing's freshness section shows it as BLOCKED with its steps
 * nested underneath, and nothing has to interrupt the owner to find out.
 *
 * ## It cannot go stale, because a success clears it
 *
 * `live/resync/outcome.ts`'s `nextResyncState` drops the blocker on any successful attempt. So a recorded
 * blocker outliving the problem it describes is not a thing a human has to remember to tidy — it is
 * impossible as long as the target ever succeeds again. That is the property that makes recording one safe
 * to do freely: the cost of a wrong blocker is one stale line until the next good pass, not a permanent
 * lie on a page the owner reads.
 *
 * The board finding is still worth filing beside it (`handover register --finding`), and `--finding`
 * carries that slug so the two are linked rather than two independent records of one problem.
 */
import { type CorpusSource } from "../../../corpus/types.js";
import { slopweaverHome } from "../../../homeDir.js";
import { ALL_CORPUS_SOURCES } from "../../../integrations/corpusSources.js";
import { logger } from "../../../lib/logger.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { safeJsonParse } from "../../../lib/safeJson.js";
import type { ResyncBlocker, ResyncState } from "../../../live/resync/outcome.js";
import { readResyncState, writeResyncState } from "../../../live/resync/outcomeStore.js";
import { type ResyncTarget, resyncRecipeId, resyncTargetLabel } from "../../../live/resync/target.js";
import { stateHomePaths } from "../../../stateHome.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { parseFlags } from "../../parseFlags.js";
import { RECIPE_BLOCKER_FLAG_SPEC, RECIPE_BLOCKER_USAGE } from "./core.js";
import { type RecipeCommandError, RecipeCommandErrors, recipeCommandErrorLines } from "./errors.js";

/** Where the flag tail starts: past the runtime, the script, the `recipe` noun and the `blocker` verb. */
const VERB_ARG_OFFSET = 4;

/** The resolved invocation: a target, and either the blocker to record or the instruction to drop one. */
export interface RecipeBlockerOptions {
  readonly target: ResyncTarget;
  /** The blocker to record, or `null` when `--clear` asked for the standing one to be dropped. */
  readonly blocker: ResyncBlocker | null;
  readonly home: string;
}

/** The injected edges. */
export interface RecipeBlockerDeps {
  readonly writeOut: (line: string) => void;
  readonly writeDiagnostic: (line: string) => void;
}

/**
 * The real edges.
 *
 * @returns the production dependencies
 * @internal
 */
export function productionRecipeBlockerDeps(): RecipeBlockerDeps {
  return {
    writeDiagnostic: (line) => process.stderr.write(`${line}\n`),
    writeOut: (line) => {
      logger.out({ line });
    },
  };
}

/**
 * The clickops steps one `--steps` value names.
 *
 * A JSON array rather than a repeated flag or a delimited string, and that is the shape rather than a
 * preference: a real clickops step contains commas and semicolons, so every delimiter that reads naturally
 * would eventually split one in half. A bare string is accepted as the single-step case, because quoting a
 * one-element JSON array to say one thing is ceremony.
 *
 * @param value the raw flag value
 * @returns the steps in order, or the one reason the value is not a step list
 */
export function parseBlockerSteps({
  value,
}: {
  readonly value: string;
}): Result<readonly string[], RecipeCommandError> {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return err(RecipeCommandErrors.stepsEmpty({ got: value }));
  }
  if (!trimmed.startsWith("[")) {
    return ok([trimmed]);
  }
  let decoded: unknown;
  try {
    decoded = safeJsonParse({ label: "--steps", text: trimmed });
  } catch (cause) {
    return err(RecipeCommandErrors.stepsNotJson({ cause, got: value }));
  }
  if (!Array.isArray(decoded) || decoded.length === 0) {
    return err(RecipeCommandErrors.stepsNotArray({ got: value }));
  }
  const steps = decoded.filter((step): step is string => typeof step === "string" && step.trim().length > 0);
  if (steps.length !== decoded.length) {
    return err(RecipeCommandErrors.stepEntryEmpty({ got: value }));
  }
  return ok(steps.map((step) => step.trim()));
}

/**
 * Parse this verb's own tail.
 *
 * @param rest the argv tail after `automation blocker`
 * @param defaultHome the home to use when the caller named none
 * @returns the resolved options, or every reason the invocation was rejected
 */
export function parseRecipeBlockerArgs({
  rest,
  defaultHome,
}: {
  readonly rest: readonly string[];
  readonly defaultHome: string;
}): Result<RecipeBlockerOptions, RecipeCommandError> {
  const parsed = parseFlags({
    args: rest,
    spec: { boolean: [...RECIPE_BLOCKER_FLAG_SPEC.boolean], string: [...RECIPE_BLOCKER_FLAG_SPEC.string] },
  });
  if (parsed.isErr()) {
    return err(RecipeCommandErrors.flagsInvalid({ reasons: parsed.error }));
  }
  const values = parsed.value.values;
  const home = typeof values["home"] === "string" ? values["home"] : defaultHome;
  const target = parseBlockerTarget({ values });
  if (target.isErr()) {
    return err(target.error);
  }
  if (values["clear"] === true) {
    return ok({ blocker: null, home, target: target.value });
  }
  const reason = values["reason"];
  const steps = values["steps"];
  if (typeof reason !== "string" || reason.trim().length === 0) {
    return err(RecipeCommandErrors.reasonMissing());
  }
  if (typeof steps !== "string") {
    return err(RecipeCommandErrors.stepsMissing());
  }
  const parsedSteps = parseBlockerSteps({ value: steps });
  if (parsedSteps.isErr()) {
    return err(parsedSteps.error);
  }
  const finding = values["finding"];
  return ok({
    blocker: {
      findingSlug: typeof finding === "string" && finding.length > 0 ? finding : null,
      key: blockerKey({ reason: reason.trim() }),
      reason: reason.trim(),
      steps: parsedSteps.value,
    },
    home,
    target: target.value,
  });
}

/**
 * The target one invocation names.
 *
 * @param values the parsed flag values
 * @returns the target, or the one reason none was resolved
 */
function parseBlockerTarget({
  values,
}: {
  readonly values: Readonly<Record<string, string | boolean>>;
}): Result<ResyncTarget, RecipeCommandError> {
  const platform = typeof values["atlas"] === "string" ? values["atlas"] : undefined;
  const source = typeof values["source"] === "string" ? values["source"] : undefined;
  if (platform !== undefined && source !== undefined) {
    return err(RecipeCommandErrors.targetsAmbiguous());
  }
  if (platform !== undefined) {
    return ok({ kind: "atlas", platform });
  }
  if (source === undefined) {
    return err(RecipeCommandErrors.targetMissing());
  }
  const named = ALL_CORPUS_SOURCES.find((candidate) => candidate === source);
  if (named === undefined) {
    return err(RecipeCommandErrors.corpusSourceUnknown({ choices: ALL_CORPUS_SOURCES, source }));
  }
  return ok({ kind: "corpus", source: named satisfies CorpusSource });
}

/**
 * A stable key for one blocker, so re-recording the same observation updates rather than reads as new.
 *
 * Derived from the reason's own words rather than from a timestamp, which is the point: two passes that
 * observe the same failure produce the same key, and a genuinely different failure produces a different
 * one without anybody choosing.
 *
 * @param reason the observed failure
 * @returns the key
 */
export function blockerKey({ reason }: { readonly reason: string }): string {
  return reason
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-|-$/gu, "")
    .slice(0, 60);
}

/**
 * The attempt history a newly recorded blocker carries forward from the target's previous state, so recording
 * or clearing a blocker never erases when the target last ran or last worked. A target with no previous state
 * — ordinarily the first blocker ever recorded for it — has no history to carry, and that is not a failure.
 *
 * @internal exported for its own tests; the verb below is its one caller.
 * @param previous the target's state before this blocker, `null` when `readResyncState` found no record
 * @returns the last attempt and last success to write back, both `null` for a target with no previous state
 */
export function carriedHistory({
  previous,
}: {
  readonly previous: ResyncState | null;
}): Pick<ResyncState, "lastAttempt" | "lastSuccessAtIso"> {
  if (previous === null) {
    // No previous state for this target: nothing has run or succeeded on record yet.
    return { lastAttempt: null, lastSuccessAtIso: null };
  }
  return { lastAttempt: previous.lastAttempt, lastSuccessAtIso: previous.lastSuccessAtIso };
}

/**
 * Run the verb.
 *
 * @param argv the whole process argv, as the CLI received it
 * @param deps the injected edges; omitted takes the production ones
 * @returns the process exit code
 */
export function runRecipeBlocker({
  argv,
  deps = productionRecipeBlockerDeps(),
}: {
  readonly argv: readonly string[];
  readonly deps?: RecipeBlockerDeps;
}): number {
  const rest = argv.slice(VERB_ARG_OFFSET);
  if (rest.includes("--help") || rest.includes("-h")) {
    deps.writeOut(RECIPE_BLOCKER_USAGE);
    return EXIT_OK;
  }
  const options = parseRecipeBlockerArgs({ defaultHome: slopweaverHome(), rest });
  if (options.isErr()) {
    recipeCommandErrorLines({ error: options.error }).forEach((line) => {
      deps.writeDiagnostic(line);
    });
    deps.writeDiagnostic(RECIPE_BLOCKER_USAGE);
    return EXIT_USAGE;
  }

  const { target, blocker, home } = options.value;
  const recipeId = resyncRecipeId({ target });
  const stateDir = stateHomePaths({ home }).live.recipe.resyncStateDir;
  const previous = readResyncState({ recipeId, stateDir });
  if (previous.isErr()) {
    deps.writeDiagnostic(`automation blocker: ${previous.error.message}`);
    return EXIT_ERROR;
  }
  const written = writeResyncState({
    state: {
      blocker,
      ...carriedHistory({ previous: previous.value }),
      recipeId,
    },
    stateDir,
  });
  if (written.isErr()) {
    written.error.forEach((line) => {
      deps.writeDiagnostic(line);
    });
    return EXIT_ERROR;
  }
  const label = resyncTargetLabel({ target });
  if (blocker === null) {
    deps.writeOut(`automation blocker · ${label} · cleared`);
    return EXIT_OK;
  }
  deps.writeOut(
    `automation blocker · ${label} · recorded \`${blocker.key}\` with ${String(blocker.steps.length)} step(s)`,
  );
  return EXIT_OK;
}

export const recipeBlockerCommand = defineCommand({ run: (argv) => runRecipeBlocker({ argv }) });
