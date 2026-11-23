/**
 * `slopweaver automation claim` — take, or give back, ONE cadence firing of one row.
 *
 * **A lease is claimed on spawn and fails safe.** The supervisor
 * takes the firing as it seats the session that will run a row, so the row stops reading actionable in
 * `automation due`; the run settles the firing when it finishes and the lease goes with it. A spawn that never
 * happened is given back with `--release`.
 *
 * ## The lease and the receipt are ONE record
 *
 * Two records keyed by ROW cannot express "this FIRING ran" at all, which would let a failed run advance the
 * schedule and a crashed one re-run. `live/automation/slotLedger.ts` is the one record keyed by (row, firing), and this verb is one of its two
 * callers — `./runDue.ts` is the other, and `./seatClaims.ts` takes and drops a seat's firings in-process
 * through this verb's own lease rules. There is no second lease and there is deliberately none to add.
 *
 * The expiry is still not this verb's to choose: `live/automation/definitionClaim.ts#nextFiringAfter` derives it
 * from the row's own cadence, so there is no duration flag here and none to add.
 *
 * ## What `--release` means, and why the exit code changes it
 *
 * Without an exit code it is tidy-up after a spawn that never started: the firing is given back untouched,
 * no attempt is spent and nothing is stamped. With one it is a FINISH: the firing is settled, and the
 * watermark advances only if the firing is actually finished with — a failure leaves it open so the row
 * comes back for the same firing, which is what `live/automation/slotAttempt.ts` exists to make true.
 */
import { randomUUID } from "node:crypto";
import { slopweaverHome } from "../../../homeDir.js";
import { logger } from "../../../lib/logger.js";
import { err, ok, type Result } from "../../../lib/result.js";
import type { RecipeDefinition } from "../../../live/automation/definition.js";
import { RecipeClaimErrors } from "../../../live/automation/definitionClaim.js";
import { judgeRecipeDue, latestFiringAtOrBefore } from "../../../live/automation/definitionDue.js";
import { type RecipeDefinitionRun, readRecipeDefinitionRuns } from "../../../live/automation/definitionRunStore.js";
import { loadLiftedRecipeDefinitions } from "../../../live/automation/definitionStore.js";
import { type ProcessAlive, recipeHolderAlive } from "../../../live/automation/holderLiveness.js";
import type { RecipeSlotAttempt } from "../../../live/automation/slotAttempt.js";
import { releaseSlotAttempt } from "../../../live/automation/slotLedger.js";
import { findOpenSlotAttempt } from "../../../live/automation/slotLedgerScan.js";
import { settleSlotAttempt } from "../../../live/automation/slotSettlement.js";
import { stateHomePaths } from "../../../stateHome.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_DEFERRED, EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { parseRecipeClaimArgs, type RecipeClaimOptions } from "./claimArgs.js";
import { RECIPE_CLAIM_USAGE } from "./core.js";
import { recipeCommandErrorLines } from "./errors.js";
import { type FailureHoldDeps, failureFindingCheckout } from "./slotFailureHold.js";
import { type SlotRunDeps, settleSlot, takeSlot } from "./slotRun.js";

/** Where the flag tail starts: past the runtime, the script, the `recipe` noun and the `claim` verb. */
const VERB_ARG_OFFSET = 4;

/** The injected edges: a failed firing's hold edges (its finding's checkout, the clock, the register), and these. */
export interface RecipeClaimDeps extends FailureHoldDeps {
  /** Mints the lease token, injected so a test can pin it. */
  readonly mintClaimId: () => string;
  /** Whether a stored slot attempt's holder pid still runs — `recipeHolderAlive` in production. */
  readonly processAlive: ProcessAlive;
  readonly writeOut: (line: string) => void;
}

/**
 * The real edges.
 *
 * @returns the production dependencies
 * @internal
 */
export function productionRecipeClaimDeps(): RecipeClaimDeps {
  return {
    checkoutFor: failureFindingCheckout,
    mintClaimId: () => randomUUID(),
    now: () => new Date().toISOString(),
    processAlive: recipeHolderAlive,
    register: async ({ argv }) => {
      const { runHandoverRegister } = await import("../handover/askRowRun.js");
      return runHandoverRegister(["node", "slopweaver", "handover", "register", ...argv]);
    },
    writeDiagnostic: (line) => process.stderr.write(`${line}\n`),
    writeOut: (line) => {
      logger.out({ line });
    },
  };
}

/**
 * This verb's edges, as `./slotRun.ts` wants them. The seat's in-process claim (`./seatClaims.ts`) passes the
 * same ones.
 *
 * @returns the slot-run dependencies
 */
export function slotDepsOf({ deps }: { deps: RecipeClaimDeps }): SlotRunDeps {
  return {
    checkoutFor: deps.checkoutFor,
    mintId: deps.mintClaimId,
    now: deps.now,
    processAlive: deps.processAlive,
    register: deps.register,
    writeDiagnostic: deps.writeDiagnostic,
  };
}

/**
 * The firing a lease on this row takes: the firing its due verdict chose, or — for a row that is not due,
 * which a claim is allowed to take — one whose stamp cannot advance anything.
 *
 * For a row that has run, that is its own watermark. It is NOT the latest firing: a DISABLED row reads not
 * due while slots are still owed, so leasing the latest firing would let a finish step a backfilling row
 * past every slot it never ran. Only a row that has never run leases the latest firing, which is the firing
 * a due verdict for it would have chosen.
 *
 * @param definition the row being claimed
 * @param runsPath the runs file its watermark is read from
 * @param nowIso the reference instant
 * @returns the firing, or every reason it could not be decided
 */
export function slotToLease({
  definition,
  runsPath,
  nowIso,
}: {
  readonly definition: RecipeDefinition;
  readonly runsPath: string;
  readonly nowIso: string;
}): Result<string> {
  const runs = readRecipeDefinitionRuns({ path: runsPath });
  if (runs.isErr()) {
    return err(runs.error);
  }
  const stored = runs.value[definition.recipeId];
  let run: RecipeDefinitionRun | null = null;
  if (stored !== undefined) {
    run = stored;
  }
  const verdict = judgeRecipeDue({ definition, nowIso, run });
  if (verdict.slotIso !== null) {
    return ok(verdict.slotIso);
  }
  if (run !== null) {
    return ok(run.watermarkIso);
  }
  const latest = latestFiringAtOrBefore({ cadence: definition.cadence, nowIso });
  if (typeof latest !== "string") {
    // Forwarded from the domain's own factory rather than authored here: a message written into an `err`
    // at this site would be a new plain shape in a directory whose `error-shape-threshold` debt list only
    // shrinks, and the union already says this exact thing.
    return err([
      RecipeClaimErrors.cadenceUnschedulable({
        cadence: definition.cadence,
        reason: latest.error,
        recipeId: definition.recipeId,
      }).message,
    ]);
  }
  return ok(latest);
}

/**
 * Look one row up in the definition store, reporting an absent one as a DIAGNOSTIC.
 *
 * It writes rather than returning a failure, and that is deliberate: `src/cli/commands/automation` sits on the
 * `error-shape-threshold` debt list, which only shrinks, so a sentence authored into an `err` here would be
 * a new plain shape in a directory that may not grow one. A missing row is a fact the operator reads, not a
 * value any caller branches on.
 */
function definitionFor({
  deps,
  home,
  recipeId,
}: {
  deps: RecipeClaimDeps;
  home: string;
  recipeId: string;
}): RecipeDefinition | undefined {
  const definitionsDir = stateHomePaths({ home }).live.recipe.definitionsDir;
  const roster = loadLiftedRecipeDefinitions({ home });
  const definition = roster.definitions.find((row) => row.recipeId === recipeId);
  if (definition === undefined) {
    deps.writeDiagnostic(`recipe ${recipeId} · no such definition in ${definitionsDir}`);
  }
  return definition;
}

/**
 * The line a taken firing prints, so the seat and the verb say the same thing about the same act.
 *
 * @param attempt the attempt just opened
 * @returns the line to print
 */
export function claimTakenLine({ attempt }: { readonly attempt: RecipeSlotAttempt }): string {
  return (
    `recipe ${attempt.recipeId} · CLAIMED by ${attempt.holder} for slot ${attempt.slotIso} until its next ` +
    `firing at ${attempt.leaseExpiresIso} · attempt ${String(attempt.attempt)} · claim-id ${attempt.holderToken}`
  );
}

/**
 * Take or give back one firing against one home.
 *
 * @param deps the injected edges
 * @param options the resolved invocation
 * @returns the process exit code
 */
export async function runClaim({
  deps,
  options,
}: {
  readonly deps: RecipeClaimDeps;
  readonly options: RecipeClaimOptions;
}): Promise<number> {
  const definition = definitionFor({ deps, home: options.home, recipeId: options.recipeId });
  if (definition === undefined) {
    return EXIT_ERROR;
  }
  if (options.kind === "claim") {
    return takeOne({ definition, deps, options });
  }
  return releaseOne({ definition, deps, options });
}

/** The claim half: lease this row's current firing, and print the token the runner will quote back. */
async function takeOne({
  definition,
  deps,
  options,
}: {
  definition: RecipeDefinition;
  deps: RecipeClaimDeps;
  options: Extract<RecipeClaimOptions, { kind: "claim" }>;
}): Promise<number> {
  const nowIso = deps.now();
  const runsPath = stateHomePaths({ home: options.home }).live.recipe.definitionRunsJson;
  const slot = slotToLease({ definition, nowIso, runsPath });
  if (slot.isErr()) {
    slot.error.forEach((line) => {
      deps.writeDiagnostic(line);
    });
    return EXIT_ERROR;
  }
  const taken = await takeSlot({
    definition,
    deps: slotDepsOf({ deps }),
    holder: options.claimedBy,
    holderPid: null,
    home: options.home,
    slotIso: slot.value,
  });
  if (taken.kind === "refused") {
    deps.writeDiagnostic(taken.line);
    return EXIT_ERROR;
  }
  deps.writeOut(claimTakenLine({ attempt: taken.attempt }));
  return EXIT_OK;
}

/**
 * The release half: give the firing back, or settle it when the caller carries an exit code.
 *
 * A DEFERRED verb has not done its work, so it settles nothing and the firing is simply given back — the
 * same rule `./rowRunners.ts` applies on the `run-due` path, spelled here too because the two settling
 * sites are reached by different callers and a row that agreed with only one of them would be silenced by
 * whichever one it missed. `../../exitCodes.ts` § `EXIT_DEFERRED`.
 */
async function releaseOne({
  definition,
  deps,
  options,
}: {
  definition: RecipeDefinition;
  deps: RecipeClaimDeps;
  options: Extract<RecipeClaimOptions, { kind: "release" }>;
}): Promise<number> {
  const nowIso = deps.now();
  // The attempt is found by ROW rather than by deriving its firing from the clock: a run claimed for the
  // 12:00 firing that finishes at 13:00:05 is released while 13:00 is the row's currently-due firing, and
  // deriving one would release nothing while reporting success.
  const held = findOpenSlotAttempt({ home: options.home, recipeId: options.recipeId });
  if (held === null) {
    deps.writeOut(`recipe ${options.recipeId} · nothing held — no open attempt to release`);
    return EXIT_OK;
  }
  const settles = options.exitCode !== null && options.exitCode !== EXIT_DEFERRED;
  if (!settles) {
    return giveBack({ attempt: held, deps, exitCode: options.exitCode, home: options.home, nowIso, options });
  }
  if (held.holderToken !== options.claimId) {
    deps.writeDiagnostic(
      `recipe ${options.recipeId} · slot ${held.slotIso} is held by ${held.holder} under a different ` +
        "token — nothing was settled and nothing was stamped",
    );
    return EXIT_ERROR;
  }
  const settlement = await settleSlot({
    attempt: held,
    definition,
    deps: slotDepsOf({ deps }),
    detail: `released with exit ${String(options.exitCode)}`,
    exitCode: options.exitCode,
    home: options.home,
  });
  deps.writeOut(settlement.line);
  return settlement.failed ? EXIT_ERROR : EXIT_OK;
}

/**
 * Give one firing back untouched, printing why nothing was settled.
 *
 * Two different acts wear one name here, and the difference is whether anything RAN. An external dispatcher
 * releasing a firing it never started has nothing to record, so its row is removed and the firing reads
 * `open` at attempt 1 again. A dispatcher reporting `EXIT_DEFERRED` ran the verb and was told "not yet", and
 * that is a fact about the firing: it is settled with a `deferred` outcome, which gives the attempt back
 * exactly as a removal did while leaving the reason on disk for
 * `../../../live/automation/silentRows.ts` to report. `slotRun.ts`'s own settle carries the verb's diagnostic as
 * the detail; this path is handed an exit code and nothing else, so it says so rather than inventing one.
 */
function giveBack({
  attempt,
  deps,
  exitCode,
  home,
  nowIso,
  options,
}: {
  attempt: RecipeSlotAttempt;
  deps: RecipeClaimDeps;
  exitCode: number | null;
  home: string;
  nowIso: string;
  options: Extract<RecipeClaimOptions, { kind: "release" }>;
}): number {
  if (exitCode === EXIT_DEFERRED) {
    const deferred = settleSlotAttempt({
      holderToken: attempt.holderToken,
      home,
      nowIso,
      outcome: {
        detail: "released through `automation claim --exit-code 4`, which carries no reason of its own",
        kind: "deferred",
        settledAtIso: nowIso,
      },
      recipeId: options.recipeId,
      slotIso: attempt.slotIso,
    });
    if (deferred.isErr()) {
      deps.writeDiagnostic(deferred.error.message);
      return EXIT_ERROR;
    }
    deps.writeOut(
      `recipe ${options.recipeId} · slot ${attempt.slotIso} RELEASED · DEFERRED, nothing settled, still due`,
    );
    return EXIT_OK;
  }
  const released = releaseSlotAttempt({
    holderToken: attempt.holderToken,
    home,
    nowIso,
    recipeId: options.recipeId,
    slotIso: attempt.slotIso,
  });
  if (released.isErr()) {
    deps.writeDiagnostic(released.error.message);
    return EXIT_ERROR;
  }
  deps.writeOut(`recipe ${options.recipeId} · slot ${attempt.slotIso} RELEASED · nothing settled`);
  return EXIT_OK;
}

/**
 * The verb entry point.
 *
 * @param argv the whole process argv
 * @returns the process exit code
 */
export async function runRecipeClaim({ argv }: { readonly argv: readonly string[] }): Promise<number> {
  const options = parseRecipeClaimArgs({ defaultHome: slopweaverHome(), rest: argv.slice(VERB_ARG_OFFSET) });
  if (options.isErr()) {
    recipeCommandErrorLines({ error: options.error }).forEach((line) => process.stderr.write(`${line}\n`));
    process.stderr.write(`${RECIPE_CLAIM_USAGE}\n`);
    return EXIT_USAGE;
  }
  return runClaim({ deps: productionRecipeClaimDeps(), options: options.value });
}

export const recipeClaimCommand = defineCommand({
  run: (argv) => runRecipeClaim({ argv }),
});
