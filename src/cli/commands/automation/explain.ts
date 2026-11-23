/**
 * `slopweaver automation explain <recipeId> --slot <iso> --attempt <n> --why "<sentence>"` — say, in one sentence the owner can read,
 * what went wrong with ONE failed firing and what would fix it.
 *
 * A run that exits with an error records why. The firing's own record is the
 * verb's stderr tail, which the Automations page keeps folded under Full message; no console-side model may turn it
 * into a sentence (AGENTS.md rule 2). So the visible session that ran the row, and watched it fail, writes the
 * sentence here, into `../../../live/automation/failureExplanation.ts`'s register, and the page leads the row with it.
 * A firing no session watched is explained by the next visible one to pick its card up: `./repair.ts` prints this
 * command for the row's unexplained last failure.
 *
 * **One firing, named exactly.** The sentence is filed under the firing's slot AND attempt, so a retry is never
 * described by its predecessor's words. A firing that succeeded, was deferred or is still open is refused: an
 * explanation of a failure that did not happen would read as one that did.
 */
import { logger } from "#lib/logger.js";
import { err, ok, type Result } from "#lib/result.js";
import { type FiringView, firingViewsOf } from "../../../automations/card.js";
import { readAllAttempts } from "../../../automations/readLedgers.js";
import { slopweaverHome } from "../../../homeDir.js";
import { recipeErrorLines } from "../../../live/automation/errors.js";
import { appendFailureExplanation, checkExplanationWords } from "../../../live/automation/failureExplanation.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { parseFlags } from "../../parseFlags.js";
import { str } from "./core.js";
import { type RecipeCommandError, RecipeCommandErrors, recipeCommandErrorLines } from "./errors.js";
import type { RecipeCommandExplainRefusedError } from "./explainErrors.js";
import { RECIPE_EXPLAIN_FLAG_SPEC, RECIPE_EXPLAIN_USAGE } from "./explainUsage.js";

/** Where the flag tail starts: past the runtime, the script, the `automation` noun and the `explain` verb. */
const VERB_ARG_OFFSET = 4;

/** The resolved invocation. */
export interface RecipeExplainOptions {
  readonly recipeId: string;
  /** The sentence, already checked fit to lead a row. */
  readonly why: string;
  /** The firing's scheduled time, as the session's own `run-due` printed it. */
  readonly slotIso: string;
  /** The attempt the session saw fail; a slot retried since is refused rather than described by these words. */
  readonly attempt: number;
  readonly home: string;
}

/** The injected edges. */
export interface RecipeExplainDeps {
  readonly now: () => string;
  readonly writeOut: (line: string) => void;
  readonly writeDiagnostic: (line: string) => void;
}

/**
 * The real edges.
 *
 * @returns the production dependencies
 * @internal
 */
export function productionRecipeExplainDeps(): RecipeExplainDeps {
  return {
    now: () => new Date().toISOString(),
    writeDiagnostic: (line) => process.stderr.write(`${line}\n`),
    writeOut: (line) => {
      logger.out({ line });
    },
  };
}

/**
 * Parse this verb's own tail, checking the sentence before anything is read.
 *
 * @param rest the argv tail after `automation explain`
 * @param defaultHome the home to use when the caller named none
 * @returns the resolved options, or the reason the invocation was rejected
 */
export function parseRecipeExplainArgs({
  rest,
  defaultHome,
}: {
  readonly rest: readonly string[];
  readonly defaultHome: string;
}): Result<RecipeExplainOptions, RecipeCommandError> {
  const parsed = parseFlags({
    allowPositionals: true,
    args: rest,
    spec: { boolean: [...RECIPE_EXPLAIN_FLAG_SPEC.boolean], string: [...RECIPE_EXPLAIN_FLAG_SPEC.string] },
  });
  if (parsed.isErr()) {
    return err(RecipeCommandErrors.flagsInvalid({ reasons: parsed.error }));
  }
  const recipeId = parsed.value.positionals[0];
  if (recipeId === undefined) {
    return err(RecipeCommandErrors.explainRecipeIdMissing());
  }
  const words = str({ key: "why", values: parsed.value.values });
  if (words === undefined) {
    return err(RecipeCommandErrors.explainWhyMissing());
  }
  const checked = checkExplanationWords({ why: words });
  if (checked.isErr()) {
    return err(RecipeCommandErrors.explainWhyRefused({ got: words, why: checked.error.message }));
  }
  const slotIso = str({ key: "slot", values: parsed.value.values });
  if (slotIso === undefined) {
    return err(RecipeCommandErrors.explainSlotMissing());
  }
  const attemptText = str({ key: "attempt", values: parsed.value.values });
  if (attemptText === undefined) {
    return err(RecipeCommandErrors.explainAttemptMissing());
  }
  if (!WHOLE_ATTEMPT.test(attemptText)) {
    return err(RecipeCommandErrors.explainAttemptNotWhole({ got: attemptText }));
  }
  const attempt = Number(attemptText);
  const home = str({ key: "home", values: parsed.value.values });
  if (home === undefined) {
    // No `--home` means the caller's default home, said here rather than by an operator.
    return ok({ attempt, home: defaultHome, recipeId, slotIso, why: checked.value });
  }
  return ok({ attempt, home, recipeId, slotIso, why: checked.value });
}

/** A whole attempt number, at least 1. */
const WHOLE_ATTEMPT = /^[1-9]\d*$/u;

/** Whether a firing ended in a failure an explanation may describe. */
function failed({ firing }: { firing: FiringView }): boolean {
  return firing.outcome === "failed" || firing.outcome === "dead";
}

/**
 * The firing an explanation describes, named exactly by the slot AND attempt the session saw fail. Never "the newest
 * failure": another firing can settle between the session seeing its own fail and writing, and a retry overwrites its
 * slot, so either would file true words against another run. A slot whose ledger has since moved
 * to another attempt is refused for the same reason.
 *
 * @param recipeId the row the firings belong to, named in a refusal
 * @param firings every firing the ledger holds for the row
 * @param slotIso the scheduled time the session's `run-due` printed
 * @param attempt the attempt number it printed for the failure
 * @returns the firing, or why none may be explained
 */
export function firingToExplain({
  recipeId,
  firings,
  slotIso,
  attempt,
}: {
  recipeId: string;
  firings: readonly FiringView[];
  slotIso: string;
  attempt: number;
}): Result<FiringView, RecipeCommandExplainRefusedError> {
  const named = firings.find((firing) => firing.slotIso === slotIso);
  if (named === undefined) {
    return err(RecipeCommandErrors.explainSlotUnrecorded({ recipeId, slotIso }));
  }
  if (named.attempt !== attempt) {
    return err(RecipeCommandErrors.explainAttemptMoved({ attempt, recipeId, recorded: named.attempt, slotIso }));
  }
  if (!failed({ firing: named })) {
    return err(RecipeCommandErrors.explainSlotNotFailed({ outcome: named.outcome, recipeId, slotIso }));
  }
  return ok(named);
}

/**
 * Run the verb.
 *
 * @param argv the whole process argv, as the CLI received it
 * @param deps the injected edges; omitted takes the production ones
 * @returns the process exit code
 */
export function runRecipeExplain({
  argv,
  deps = productionRecipeExplainDeps(),
}: {
  readonly argv: readonly string[];
  readonly deps?: RecipeExplainDeps;
}): number {
  const rest = argv.slice(VERB_ARG_OFFSET);
  if (rest.includes("--help") || rest.includes("-h")) {
    deps.writeOut(RECIPE_EXPLAIN_USAGE);
    return EXIT_OK;
  }
  const options = parseRecipeExplainArgs({ defaultHome: slopweaverHome(), rest });
  if (options.isErr()) {
    recipeCommandErrorLines({ error: options.error }).forEach((line) => {
      deps.writeDiagnostic(line);
    });
    deps.writeDiagnostic(RECIPE_EXPLAIN_USAGE);
    return EXIT_USAGE;
  }
  const { attempt, home, recipeId, slotIso, why } = options.value;
  const issues: string[] = [];
  const attempts = readAllAttempts({ home, issues }).byRecipe.get(recipeId);
  // A recipe with no ledger rows has fired nothing, so it has no firing to explain.
  const firings = attempts === undefined ? [] : firingViewsOf({ attempts });
  const firing = firingToExplain({ attempt, firings, recipeId, slotIso });
  if (firing.isErr()) {
    deps.writeDiagnostic(firing.error.message);
    issues.forEach((issue) => {
      deps.writeDiagnostic(`automation explain · ${issue}`);
    });
    return EXIT_ERROR;
  }
  const written = appendFailureExplanation({
    explanation: { attempt, recipeId, recordedIso: deps.now(), slotIso: firing.value.slotIso, why },
    home,
  });
  if (written.isErr()) {
    recipeErrorLines({ error: written.error }).forEach((line) => {
      deps.writeDiagnostic(`automation explain · ${line}`);
    });
    return EXIT_ERROR;
  }
  deps.writeOut(
    `automation explain · ${recipeId} · firing ${firing.value.slotIso} attempt ${String(attempt)} · ` +
      `recorded: ${why} — the Automations page leads that row with it only while this firing is the run that ` +
      "finished last and its history reads whole",
  );
  return EXIT_OK;
}

/** `slopweaver automation explain`. */
export const recipeExplainCommand = defineCommand({ run: (argv) => runRecipeExplain({ argv }) });
