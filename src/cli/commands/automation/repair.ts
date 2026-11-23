/**
 * `slopweaver automation repair <recipeId> --row <slug>` — say which seat has taken a stopped recipe's repair.
 *
 * A stop being fixed reaches the owner as a floating note naming the recipe
 * and the seat — never a choice, never a queue card, never blocked on them. The seat taking a failed row is the next
 * visible session to pick its card up, so the take also prints the failure its finding names when no session put it
 * in plain words, with the `automation explain` command that does. This verb is the one way a stop becomes
 * TAKEN: it appends to `../../../live/automation/repairTake.ts`'s register, which `recipe-stopped` and
 * `recipe-repairing` both read. It refuses a take that could not hold — an undefined recipe, or a row that is
 * finished or whose run is closed — because a take naming a dead seat would read as fixed while nothing is.
 */
import { errorMessage } from "#lib/errorMessage.js";
import { logger } from "#lib/logger.js";
import { printableOneLine } from "#lib/oneLineSummary.js";
import { err, ok, type Result } from "#lib/result.js";
import { firingViewsOf } from "../../../automations/card.js";
import { explanationsOf } from "../../../automations/cardExplanations.js";
import { readAllAttempts } from "../../../automations/readLedgers.js";
import { unexplainedFailureLines } from "../../../automations/unexplainedFailure.js";
import { slopweaverHome } from "../../../homeDir.js";
import { loadRecipeDefinitions } from "../../../live/automation/definitionStore.js";
import { recipeErrorLines } from "../../../live/automation/errors.js";
import { explanationsByRecipe, readFailureExplanations } from "../../../live/automation/failureExplanation.js";
import { recipeBoardOf } from "../../../live/automation/failureHoldStore.js";
import { appendRepairTake, type RepairTake, repairRowLiveness } from "../../../live/automation/repairTake.js";
import { stateHomePaths } from "../../../stateHome.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { parseFlags } from "../../parseFlags.js";
import { RECIPE_REPAIR_FLAG_SPEC, RECIPE_REPAIR_USAGE, str } from "./core.js";
import { type RecipeCommandError, RecipeCommandErrors, recipeCommandErrorLines } from "./errors.js";

/** Where the flag tail starts: past the runtime, the script, the `recipe` noun and the `repair` verb. */
const VERB_ARG_OFFSET = 4;

/** The resolved invocation. */
export interface RecipeRepairOptions {
  readonly recipeId: string;
  readonly row: string;
  readonly home: string;
}

/** The injected edges. */
export interface RecipeRepairDeps {
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
export function productionRecipeRepairDeps(): RecipeRepairDeps {
  return {
    now: () => new Date().toISOString(),
    writeDiagnostic: (line) => process.stderr.write(`${line}\n`),
    writeOut: (line) => {
      logger.out({ line });
    },
  };
}

/**
 * Parse this verb's own tail.
 *
 * @param rest the argv tail after `automation repair`
 * @param defaultHome the home to use when the caller named none
 * @returns the resolved options, or the reason the invocation was rejected
 */
export function parseRecipeRepairArgs({
  rest,
  defaultHome,
}: {
  readonly rest: readonly string[];
  readonly defaultHome: string;
}): Result<RecipeRepairOptions, RecipeCommandError> {
  const parsed = parseFlags({
    allowPositionals: true,
    args: rest,
    spec: { boolean: [...RECIPE_REPAIR_FLAG_SPEC.boolean], string: [...RECIPE_REPAIR_FLAG_SPEC.string] },
  });
  if (parsed.isErr()) {
    return err(RecipeCommandErrors.flagsInvalid({ reasons: parsed.error }));
  }
  const recipeId = parsed.value.positionals[0];
  if (recipeId === undefined) {
    return err(RecipeCommandErrors.repairRecipeIdMissing());
  }
  const row = str({ key: "row", values: parsed.value.values });
  if (row === undefined) {
    return err(RecipeCommandErrors.repairRowMissing());
  }
  const home = str({ key: "home", values: parsed.value.values });
  if (home === undefined) {
    // No `--home` means the caller's default home, said here rather than by an operator.
    return ok({ home: defaultHome, recipeId, row });
  }
  return ok({ home, recipeId, row });
}

/**
 * Check a take can hold before it is written: the recipe is defined here, and the row is live.
 *
 * @param options the resolved invocation
 * @returns ok, or the refusal naming what failed
 */
function admitTake({ options }: { options: RecipeRepairOptions }): Result<void, RecipeCommandError> {
  const { home, recipeId, row } = options;
  const roster = loadRecipeDefinitions({
    board: recipeBoardOf({ home }),
    directory: stateHomePaths({ home }).live.recipe.definitionsDir,
  });
  if (!roster.definitions.some((definition) => definition.recipeId === recipeId)) {
    return err(RecipeCommandErrors.repairRefused({ recipeId, row, why: "no recipe definition carries that id" }));
  }
  const live = repairRowLiveness({ home, slug: row });
  if (live.isOk()) {
    return ok(undefined);
  }
  const refusal = live.error;
  if (refusal.kind === "terminal") {
    const why = `the row is ${refusal.status}, so no seat is working it — register a row and \`handover start\` it`;
    return err(RecipeCommandErrors.repairRefused({ recipeId, row, why }));
  }
  if (refusal.kind === "run-not-started") {
    const why = "no seat has started the row — `handover start` it from the seat doing the repair";
    return err(RecipeCommandErrors.repairRefused({ recipeId, row, why }));
  }
  if (refusal.kind === "run-not-open") {
    const why = `the row's run is ${refusal.phase} — \`handover start\` it from the seat doing the repair`;
    return err(RecipeCommandErrors.repairRefused({ recipeId, row, why }));
  }
  return err(RecipeCommandErrors.repairRefused({ recipeId, row, why: refusal.why }));
}

/**
 * Run the verb.
 *
 * @param argv the whole process argv, as the CLI received it
 * @param deps the injected edges; omitted takes the production ones
 * @returns the process exit code
 */
export function runRecipeRepair({
  argv,
  deps = productionRecipeRepairDeps(),
}: {
  readonly argv: readonly string[];
  readonly deps?: RecipeRepairDeps;
}): number {
  const rest = argv.slice(VERB_ARG_OFFSET);
  // Every line a value reaches is folded, a refusal or a failed write included, so an id, row or home carrying a newline
  // or control byte never prints raw. Only the fixed usage text spans lines.
  if (rest.includes("--help") || rest.includes("-h")) {
    deps.writeOut(RECIPE_REPAIR_USAGE);
    return EXIT_OK;
  }
  const options = parseRecipeRepairArgs({ defaultHome: slopweaverHome(), rest });
  if (options.isErr()) {
    recipeCommandErrorLines({ error: options.error }).forEach((line) => {
      deps.writeDiagnostic(printableOneLine({ text: line }));
    });
    deps.writeDiagnostic(RECIPE_REPAIR_USAGE);
    return EXIT_USAGE;
  }
  const admitted = admitTake({ options: options.value });
  if (admitted.isErr()) {
    deps.writeDiagnostic(printableOneLine({ text: admitted.error.message }));
    return EXIT_ERROR;
  }
  const { home, recipeId, row } = options.value;
  const take: RepairTake = { recipeId, row, takenIso: deps.now() };
  const written = appendRepairTake({ home, take });
  if (written.isErr()) {
    recipeErrorLines({ error: written.error }).forEach((line) => {
      deps.writeDiagnostic(`automation repair · ${printableOneLine({ text: line })}`);
    });
    return EXIT_ERROR;
  }
  try {
    // Every value is folded, so a newline or control byte in an id never prints raw.
    deps.writeOut(
      `automation repair · ${printableOneLine({ text: recipeId })} · taken by ${printableOneLine({ text: row })} — the owner sees a note, not a card, until that row is done`,
    );
    failurePickupLines({ home, recipeId, row }).forEach((line) => {
      deps.writeOut(line);
    });
  } catch (error: unknown) {
    // The take is written, and that is the act: an output that failed around it is no failure of the take.
    // `failurePickupLines` turns its own throws into a printed line, so only a stdout write lands here — and it is
    // said on stderr, never swallowed, so a seat that lost the pickup lines knows to re-read them.
    try {
      deps.writeDiagnostic(
        `automation repair · the take is recorded, but stdout failed before everything printed (${printableOneLine({ text: errorMessage({ error }) })})`,
      );
    } catch {
      // stderr is gone too; the take still stands, and there is nowhere left to say so.
    }
  }
  return EXIT_OK;
}

/**
 * What the taking seat is told about the failure its row names — the next visible session to pick the card up is the
 * one that explains it (`../../../automations/unexplainedFailure.ts`). A ledger or register that did not read WHOLE
 * names no failure as unexplained, since the file it skipped may be that firing or its sentence; it says so instead.
 * The take already stands, so nothing here, a throw included, moves the exit code.
 *
 * @returns the lines to print
 */
function failurePickupLines({
  home,
  recipeId,
  row,
}: {
  home: string;
  recipeId: string;
  row: string;
}): readonly string[] {
  const unread = ({ what }: { what: string }): readonly string[] => [
    `automation repair · ${printableOneLine({ text: recipeId })} · ${printableOneLine({ text: what })}, so no failure is named here — read it and explain the one that broke`,
  ];
  try {
    const ledger = readAllAttempts({ home, issues: [] });
    if (ledger.gap !== null) {
      return unread({ what: ledger.gap });
    }
    const register = readFailureExplanations({ home });
    if (register.isErr()) {
      return unread({ what: register.error.message });
    }
    if (register.value.unparsed.length > 0) {
      return unread({
        what: `the failure explanations register has unreadable line(s) ${register.value.unparsed.join(", ")}`,
      });
    }
    const attempts = ledger.byRecipe.get(recipeId);
    // A clean ledger with no rows for the row means it has fired nothing, so it has no failure to explain.
    const firings = attempts === undefined ? [] : firingViewsOf({ attempts });
    const explanations = explanationsOf({
      explanations: explanationsByRecipe({ explanations: register.value.explanations }),
      recipeId,
    });
    return unexplainedFailureLines({ explanations, firings, home, recipeId, row });
  } catch (error: unknown) {
    return unread({ what: `its firing history would not read (${errorMessage({ error })})` });
  }
}

/** `slopweaver automation repair`. */
export const recipeRepairCommand = defineCommand({ run: (argv) => runRecipeRepair({ argv }) });
