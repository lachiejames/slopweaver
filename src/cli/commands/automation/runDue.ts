/**
 * `slopweaver automation run-due` — the tick that runs the in-repo definition store's due rows.
 *
 * The store parses, `definitionDue.ts` decides, a KIND's own
 * planner resolves the row, `./rowRunners.ts` runs the plan, and this stamps what ran.
 *
 * A SPAWN-shaped row runs here too, and ONLY inside the session `automation seat` opened for it: `--claim-id`
 * carries that session's own claim token, and without it such a row is reported SEAT IT and left due. There
 * is no second dispatcher — no standing scheduler exists.
 *
 * The token names the SESSION, not one firing. A seat takes the firing its row is due for and leases it to
 * the row's own next firing, so a session opened minutes before that firing arrives holding an attempt the
 * schedule has already overtaken — MEASURED, a 114-second lease. `./seatedAdmission.ts#carrySeatForward`
 * gives that never-started attempt back and takes the firing the row is due for NOW under the same token; the
 * sibling case, a pass of twenty rows running past the next firing, is the same mechanism.
 *
 * ## Nothing here spawns a model, and that is rule 2 rather than a design choice
 *
 * Every kind runs slopweaver VERBS — `./rowRunners.ts` is where each one does: a generic row's verb in a child
 * of this same CLI (`./runDueVerbProcess.ts`), a collected leg in this process. No `claude` is launched,
 * visible or otherwise. The kinds exist precisely so a recurring job can be a reviewed, gated
 * verb instead of a prompt; `kinds.ts`'s header carries the ruling that made it so.
 *
 * ## `--dry-run` means something different per kind, on purpose
 *
 * A `verb-run` row prints its plan and runs nothing, because the verb it selects is arbitrary. The two
 * two-leg kinds run their READ for real — an `alert-summary` reads its channel, a `datadog-alert-digest`
 * counts its probes — and render the card through `slack post --dry-run`, so what a dry run prints is the
 * document the channel would have received rather than a description of one. Neither is stamped, so a dry
 * run never silences a row.
 *
 * ## One row's failure does not sink the tick
 *
 * Every due row is attempted, and a row that refuses its plan or exits non-zero is reported with its own
 * reason while the rest still run. The verb's exit code says whether ANY row failed, so a tick that half
 * worked is never reported as a success.
 *
 * ## A standing ruling can hold ONE row
 *
 * A gate on `automation run-due` scoped to a recipe id holds that row and no other: it is reported HELD with the owner's
 * words and the anchor, and is neither admitted, run nor stamped, so it is due again once the gate lifts. The
 * tick's argv names no row, so only this per-row check can match it (`./runDueRulingGate.ts`). A gate on a
 * verb a row runs is that verb's own to refuse, and it reads this tick's home as well as the environment's:
 * `withCallerGateHomes` in this process, handed to a verb child through `../../callerGateHomesEnv.ts`.
 *
 * ## `--recipe <id>` runs ONE named row, because `--limit` alone cannot reach it
 *
 * A tick takes the due rows in store order, so `--limit` is a PREFIX of that order and never a choice
 * within it. MEASURED on this install: 43 rows were due, `store-backup-daily` was the 43rd of
 * them, and the 42 `resync-*` rows ahead of it belong to the seated resync session — so a
 * supervisor tick could reach the backup only by draining rows that were not its to drain. `--recipe`
 * narrows the whole tick to the row it names, before the due judgement, and changes nothing else: a row
 * inside its cadence is still not run, a live claim still holds it, and a row that runs is still stamped.
 * It is deliberately NOT a force — `run-due` runs DUE rows, and a selector that fired an off-cadence row
 * would make the stamp a lie about the schedule it belongs to.
 */

import { resolve } from "node:path";

import { unexpiredGates } from "../../../handover/rulingGate.js";
import { homeBeforeScopes, runUnderHome, slopweaverHome } from "../../../homeDir.js";
import { judgeRecipeDefinitions, type RecipeDueVerdict } from "../../../live/automation/definitionDue.js";
import { lastRecipeRun, readRecipeDefinitionRuns } from "../../../live/automation/definitionRunStore.js";
import { loadLiftedRecipeDefinitions } from "../../../live/automation/definitionStore.js";
import { stateHomePaths } from "../../../stateHome.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { callerGateHomes, readGatesForHomes, withCallerGateHomes } from "../../rulingGateDoor.js";
import { RECIPE_RUN_DUE_USAGE } from "./core.js";
import { recipeCommandErrorLines } from "./errors.js";
import { openingOutcomes, retryWithoutVerdicts } from "./findingDebtRetry.js";
import { productionRecipeRunDueDeps, type RecipeRunDueDeps, type RowOutcome } from "./rowRunners.js";
import { parseRecipeRunDueArgs } from "./runDueArgs.js";
import { type DueRowsOutcome, runDueRow } from "./runDueAttempt.js";
import { dueFirings, type RecipeRowSelection, selectRecipeRows } from "./runDueSelection.js";
import { productionRunDueSignalTrap, type RunDueSignalTrap } from "./runDueSignal.js";
import type { SlotRunDeps } from "./slotRun.js";

/** Where the flag tail starts: past the runtime, the script, the `recipe` noun and the `run-due` verb. */
const VERB_ARG_OFFSET = 4;

/**
 * Run every due row in order: take its firing, run it, and settle what happened.
 *
 * The three acts are one sequence per row and the ORDER is the whole guarantee — take before the effect,
 * settle after it, and never stamp except as a consequence of settling. `./slotRun.ts` owns all three.
 */
async function runDueRows({
  claimId,
  deps,
  dryRun,
  gateHomes,
  home,
  limit,
  media,
  nowIso,
  selection,
  signalTrap,
  slotDeps,
  verdicts,
}: {
  claimId: string | null;
  deps: RecipeRunDueDeps;
  dryRun: boolean;
  /** Every home whose standing rulings judge a row: the one the environment named before the tick, and its own. */
  gateHomes: readonly string[];
  home: string;
  limit: number | null;
  media: readonly string[];
  nowIso: string;
  selection: RecipeRowSelection;
  signalTrap: RunDueSignalTrap;
  slotDeps: SlotRunDeps;
  verdicts: readonly RecipeDueVerdict[];
}): Promise<DueRowsOutcome> {
  const { definitions, roster } = selection;
  const due = dueFirings({ definitions, verdicts });
  // Read once per tick, at the instant the rows were judged due. The environment's home is named by the caller,
  // never read here: inside the tick `$SLOPWEAVER_HOME` names the tick's own home (`runRecipeRunDue`).
  const gates = unexpiredGates({ gates: readGatesForHomes({ homes: gateHomes }), nowIso });
  const outcomes = await openingOutcomes({ claimId, definitions, deps: slotDeps, dryRun, home, roster, verdicts });
  let stampFailed = false;
  let started = 0;
  // No accumulator here, deliberately. This loop used to carry the tick's start-of-run map forward and hand
  // it to every write, which is what erased a concurrent tick's stamps; the store now merges against the
  // file itself, so one row's stamp is visible to the next row's write without anything being carried.
  for (const { definition, slotIso } of due) {
    const step = await runDueRow({
      claimId,
      definition,
      deps,
      dryRun,
      gates,
      home,
      limit,
      media,
      signalTrap,
      slotDeps,
      slotIso,
      started,
    });
    outcomes.push(...step.outcomes);
    stampFailed = stampFailed || step.stampFailed;
    started += step.started ? 1 : 0;
  }
  return { outcomes, stampFailed };
}

/**
 * Run the verb.
 *
 * @param argv the whole process argv, as the CLI received it
 * @param deps the injected edges; omitted takes the production ones
 * @param signalTrap what a run-here effect is armed under — required: its handlers never come down, so only the verb
 *   process may open one over Node's own
 * @returns the process exit code
 */
export async function runRecipeRunDue({
  argv,
  deps = productionRecipeRunDueDeps(),
  signalTrap,
}: {
  argv: readonly string[];
  deps?: RecipeRunDueDeps;
  signalTrap: RunDueSignalTrap;
}): Promise<number> {
  const rest = argv.slice(VERB_ARG_OFFSET);
  if (rest.includes("--help") || rest.includes("-h")) {
    deps.writeOut(RECIPE_RUN_DUE_USAGE);
    return EXIT_OK;
  }
  const options = parseRecipeRunDueArgs({ defaultHome: slopweaverHome(), rest });
  if (options.isErr()) {
    recipeCommandErrorLines({ error: options.error }).forEach((line) => {
      deps.writeDiagnostic(line);
    });
    deps.writeDiagnostic(RECIPE_RUN_DUE_USAGE);
    return EXIT_USAGE;
  }

  const { claimId, dryRun, limit, media, recipeId } = options.value;
  // Absolute from here on: the tick hands this home to verbs and children by environment, and a child launched in
  // another cwd (a metrics producer runs in its checkout) would re-resolve a relative one somewhere else.
  const home = resolve(options.value.home);
  // The environment's ORIGINAL home, read before the switch below and kept as a gate home: a ruling standing there
  // still judges every row and every verb this tick runs, exactly as it did while the variable named it. Read past
  // any scope already open, which a concurrent same-home tick would otherwise hand us as "original".
  // The CURRENT value is kept too: work inside that open scope may have moved the variable, and a gate home only ever
  // adds rulings, so keeping both can hold more but never less.
  const ambientHomes = [homeBeforeScopes(), slopweaverHome()];
  // And every home a CALLER above this tick added: a nested tick's own environment already names its parent's tick
  // home, so the parent's original home reaches it only through the hand-down.
  const inherited = callerGateHomes();
  if (inherited.isErr()) {
    inherited.error.forEach((line) => {
      deps.writeDiagnostic(line);
    });
    return EXIT_ERROR;
  }
  // The tick ADDS only its own two to the store; the inherited ones already reach a verb child through it.
  const addedHomes = [...new Set([...ambientHomes, home])];
  const gateHomes = [...inherited.value, ...addedHomes];
  // Every verb a row runs judges its own gate against both homes, even when the words it is handed carry no
  // `--home` (`datadog alert-digest` takes none); a verb child reads them from `../../callerGateHomesEnv.ts`.
  // And every verb RESOLVES this tick's home: a `verb-run` row's argv is arbitrary words with no `--home`, so under
  // the ambient variable a `--home <dir>` tick read `<dir>`'s rows and ran their verbs against the real install
  // (`runUnderHome` carries the measurement). Its child inherits the variable with the rest of this environment.
  // `runUnderHome` is the OUTER scope because it refuses an overlapping one naming another home before any work runs.
  return runUnderHome({
    home,
    run: () =>
      withCallerGateHomes({
        homes: addedHomes,
        run: () => tickOnce({ claimId, deps, dryRun, gateHomes, home, limit, media, recipeId, signalTrap }),
      }),
  });
}

/**
 * Say that `--recipe` named an id the store does not carry, and point at the verb that lists the ids.
 *
 * A failure of FACT rather than a policy refusal, so it is a plain usage error with no escape hatch: the
 * store simply has no such row, and there is nothing to override. It is a REFUSAL rather than a quiet
 * nothing-to-run because the two are indistinguishable on a typo — `--recipe store-backup-dialy` exiting 0
 * saying nothing was due is exactly how a chair concludes a row ran when it never existed.
 *
 * It takes the unmatched id as a plain `string` rather than the selection it came from, so the type system
 * carries the narrowing the caller already did — a `string | null` here would stringify to `null` on a
 * mistake and print a refusal naming the wrong thing.
 *
 * @param definitionsDir the store that was read, named so the caller can go and look
 * @param deps the injected edges
 * @param parsed how many rows the store did parse, so an empty store reads differently from a typo
 * @param unknownRecipeId the id no row carried
 */
function refuseUnknownRecipe({
  definitionsDir,
  deps,
  parsed,
  unknownRecipeId,
}: {
  definitionsDir: string;
  deps: RecipeRunDueDeps;
  parsed: number;
  unknownRecipeId: string;
}): void {
  deps.writeDiagnostic(
    `--recipe \`${unknownRecipeId}\`: no row in ${definitionsDir} carries that recipeId ` +
      `(${String(parsed)} row(s) parsed) — \`slopweaver automation due\` lists every one`,
  );
  deps.writeDiagnostic(RECIPE_RUN_DUE_USAGE);
}

/**
 * Say out loud that a tick attempted nothing, in the words of whichever reason it was.
 *
 * A tick that selected nothing and a tick that ran everything both print no outcome line, so the absence of
 * one has to be narrated or the two are indistinguishable — the same reason `judgeRecipeDefinitions` emits a
 * verdict for a parked row. `--recipe` adds a third reason to tell apart: the named row exists and is simply
 * inside its own cadence, which is a different fact from "every row is", and a chair who typed one id wants
 * that one answered rather than a sweep's summary.
 *
 * @param definitionsDir the store this tick read, named so an empty one can be found
 * @param deps the injected edges
 * @param outcomes what the tick attempted
 * @param recipeId the id `--recipe` named, or `null` for the whole store
 * @param selection the rows this tick judged
 */
function reportEmptyTick({
  definitionsDir,
  deps,
  outcomes,
  recipeId,
  selection,
}: {
  definitionsDir: string;
  deps: RecipeRunDueDeps;
  outcomes: readonly RowOutcome[];
  recipeId: string | null;
  selection: RecipeRowSelection;
}): void {
  if (selection.definitions.length === 0) {
    deps.writeOut(`automation run-due · no definitions in ${definitionsDir} — nothing to run`);
    return;
  }
  if (outcomes.length > 0) {
    return;
  }
  if (recipeId === null) {
    deps.writeOut("automation run-due · every row is inside its cadence — nothing to run");
    return;
  }
  deps.writeOut(`automation run-due · ${recipeId} is not due — nothing to run`);
}

/**
 * One whole tick over one home: load the store, narrow it, and hand the survivors to {@link runSelection}.
 *
 * @param deps the injected edges
 * @param dryRun whether to plan every due row and run none of them
 * @param gateHomes every home whose standing rulings judge a row, the environment's original one included
 * @param home the state home whose definitions to run
 * @param limit at most this many rows, or `null` for every due one
 * @param media the graded captures a seated session took for a shots row, empty on an ordinary tick
 * @param recipeId the single row to judge and run, or `null` for the whole store
 * @param signalTrap the trap each run-here effect of this tick is armed under
 * @returns the process exit code
 */
async function tickOnce({
  claimId,
  deps,
  dryRun,
  gateHomes,
  home,
  limit,
  media,
  recipeId,
  signalTrap,
}: {
  claimId: string | null;
  deps: RecipeRunDueDeps;
  dryRun: boolean;
  gateHomes: readonly string[];
  home: string;
  limit: number | null;
  media: readonly string[];
  recipeId: string | null;
  signalTrap: RunDueSignalTrap;
}): Promise<number> {
  const paths = stateHomePaths({ home }).live.recipe;
  const roster = loadLiftedRecipeDefinitions({ home });
  roster.rejected.forEach((rejection) => {
    deps.writeDiagnostic(`recipe ${rejection.file} · REJECTED · ${rejection.error.message}`);
  });

  const selection = selectRecipeRows({ definitions: roster.definitions, recipeId });
  const unknownRecipeId = selection.unknownRecipeId;
  if (unknownRecipeId !== null) {
    refuseUnknownRecipe({
      definitionsDir: paths.definitionsDir,
      deps,
      parsed: roster.definitions.length,
      unknownRecipeId,
    });
    return EXIT_USAGE;
  }

  // A rejected file fails the tick whether or not `--recipe` narrowed it, and an earlier draft of this
  // change had it fail only the unnarrowed one. That exemption was wrong on its own code path: a rejection
  // is computed after the roster load and only ever reaches the EXIT CODE, never the dispatch, so a broken
  // sibling has never blocked a named row and exempting it bought nothing — it only stopped
  // `run-due --recipe <id> || alert` firing on a store that will not parse.
  return runSelection({
    claimId,
    deps,
    dryRun,
    gateHomes,
    home,
    limit,
    media,
    recipeId,
    rosterFailed: roster.rejected.length > 0,
    selection,
    signalTrap,
  });
}

/**
 * This tick's edges, as `./slotRun.ts` wants them.
 *
 * A projection rather than a second dependency bag: every take and settle edge is already one of the tick's
 * own, and a separate set would let the two drift into disagreeing about the clock — which is the class of
 * defect this whole lane exists to close.
 *
 * @param deps the tick's injected edges
 * @returns the subset the take/settle path reaches
 */
function slotDepsOf({ deps }: { deps: RecipeRunDueDeps }): SlotRunDeps {
  const { checkoutFor, mintId, now, processAlive, register, writeDiagnostic } = deps;
  return { checkoutFor, mintId, now, processAlive, register, writeDiagnostic };
}

/**
 * Judge, run and report the rows a tick selected — everything past the narrowing.
 *
 * @param deps the injected edges
 * @param dryRun whether to plan every due row and run none of them
 * @param gateHomes every home whose standing rulings judge a row, the environment's original one included
 * @param home the state home whose definitions to run
 * @param limit at most this many rows, or `null` for every due one
 * @param media the graded captures a seated session took for a shots row, empty on an ordinary tick
 * @param recipeId the single row this tick was narrowed to, or `null` for the whole store
 * @param rosterFailed whether an unreadable definition file should fail this tick
 * @param selection the rows to judge and run
 * @param signalTrap the trap each run-here effect of this tick is armed under
 * @returns the process exit code
 */
async function runSelection({
  claimId,
  deps,
  dryRun,
  gateHomes,
  home,
  limit,
  media,
  recipeId,
  rosterFailed,
  selection,
  signalTrap,
}: {
  claimId: string | null;
  deps: RecipeRunDueDeps;
  dryRun: boolean;
  gateHomes: readonly string[];
  home: string;
  limit: number | null;
  media: readonly string[];
  recipeId: string | null;
  rosterFailed: boolean;
  selection: RecipeRowSelection;
  signalTrap: RunDueSignalTrap;
}): Promise<number> {
  const paths = stateHomePaths({ home }).live.recipe;
  const runs = readRecipeDefinitionRuns({ path: paths.definitionRunsJson });
  if (runs.isErr()) {
    await retryWithoutVerdicts({ deps, dryRun, home, roster: selection.roster, why: runs.error });
    return EXIT_ERROR;
  }
  const nowIso = deps.now();
  const verdicts = judgeRecipeDefinitions({
    definitions: selection.definitions,
    nowIso,
    runFor: ({ recipeId: judged }) => lastRecipeRun({ recipeId: judged, runs: runs.value }),
  });
  for (const { line } of verdicts) {
    deps.writeOut(line);
  }
  const { outcomes, stampFailed } = await runDueRows({
    claimId,
    deps,
    dryRun,
    gateHomes,
    home,
    limit,
    media,
    nowIso,
    selection,
    signalTrap,
    slotDeps: slotDepsOf({ deps }),
    verdicts,
  });
  reportOutcomes({ deps, outcomes });
  reportEmptyTick({ definitionsDir: paths.definitionsDir, deps, outcomes, recipeId, selection });
  const anythingFailed = outcomes.some((outcome) => outcome.failed) || rosterFailed || stampFailed;
  return anythingFailed ? EXIT_ERROR : EXIT_OK;
}

/**
 * Print what each row did, and the lines a row has for a reader UNDER its own summary.
 *
 * A digest row that carries pictures is the only kind with detail today, and it is where the seated session
 * reads the capture commands out of, so the two must print together rather than one being a `--json`-only
 * field nobody looks at.
 *
 * @param deps the injected edges
 * @param outcomes what each row did, in the order it was run
 */
function reportOutcomes({ deps, outcomes }: { deps: RecipeRunDueDeps; outcomes: readonly RowOutcome[] }): void {
  outcomes.forEach(({ line, detail }) => {
    deps.writeOut(line);
    detail.forEach((extra) => {
      deps.writeOut(extra);
    });
  });
}

export const recipeRunDueCommand = defineCommand({
  run: (argv) => runRecipeRunDue({ argv, signalTrap: productionRunDueSignalTrap() }),
});
