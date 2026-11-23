/**
 * `slopweaver automation due` — which automations are due, for the supervisor's own tick.
 *
 * **There is no clock.** No cron, no launch agent, no headless Claude, nothing that
 * spins up sessions the supervisor does not control. An automation is run or spawned BY THE SUPERVISOR,
 * by judgement, at the decision point where it already spawns board rows — and that judgement is only as good
 * as the information the tick is given: which scheduled asks are now due. This verb is that information and
 * nothing else.
 *
 * **Read-only, and that is load-bearing rather than incidental.** It touches no network, launches no model,
 * claims nothing and writes nothing at all — so a tick can call it every time without it becoming a thing
 * that has effects. Its exit code is always `EXIT_OK`: it is a report, and a non-zero exit would make a tick
 * that ran it correctly look like a tick that failed.
 *
 * ## It is the reporting half of a decision that already existed
 *
 * `judgeRecipeDefinitions` decides due-ness, it already ships, and `automation run-due` already runs on it.
 * Nothing here judges anything new — the verb loads the store, asks that function, and composes what it
 * said with the run shape, the tolerance band and any live claim.
 */
import { slopweaverHome } from "../../../homeDir.js";
import { logger } from "../../../lib/logger.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { safeJsonStringify } from "../../../lib/safeJson.js";
import { loadAuditedRecipeDefinitions } from "../../../live/automation/auditedDefinitionStore.js";
import { declaredStandingRows } from "../../../live/automation/declaredStandingRows.js";
import type { RecipeDefinition } from "../../../live/automation/definition.js";
import type { RecipeDefinitionClaims } from "../../../live/automation/definitionClaim.js";
import { judgeRecipeDefinitions, type RecipeDueVerdict } from "../../../live/automation/definitionDue.js";
import {
  lastRecipeRun,
  type RecipeDefinitionRuns,
  readRecipeDefinitionRuns,
} from "../../../live/automation/definitionRunStore.js";
import { composeDueAskReport } from "../../../live/automation/dueReport.js";
import { briefDueAskLines, briefDueAskReport, dueAskLines } from "../../../live/automation/dueReportLines.js";
import { holderAliveFor, type ProcessAlive, recipeHolderAlive } from "../../../live/automation/holderLiveness.js";
import { unaskableInvestigateRows } from "../../../live/automation/investigate.js";
import { readAutomationRetirements } from "../../../live/automation/retirementStore.js";
import { readSlotAttempt } from "../../../live/automation/slotLedger.js";
import { originSlugOf } from "../../../live/checkout/checkoutForRepo.js";
import { tickResyncRecipeIds } from "../../../live/resync/roster.js";
import { stateHomePaths } from "../../../stateHome.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { parseFlags } from "../../parseFlags.js";
import { RECIPE_DUE_FLAG_SPEC, RECIPE_DUE_USAGE } from "./core.js";
import { compareDeclared, ownRepositoryState, retirementsState, teamRepositoriesState } from "./dueDeclared.js";

/** Where the flag tail starts: past the runtime, the script, the `recipe` noun and the `due` verb. */
const VERB_ARG_OFFSET = 4;

/** The resolved invocation. */
interface RecipeDueOptions {
  readonly json: boolean;
  /**
   * Only the rows a tick decides on, the quiet rest counted — `../../../live/automation/dueReportLines.ts`. The
   * parser always sets it; an in-process caller that omits it asks for the full report.
   */
  readonly brief?: boolean;
  readonly home: string;
}

/** The injected edges, so the read is testable with plain fakes. */
export interface RecipeDueDeps {
  readonly now: () => string;
  /** Whether a stored slot attempt's holder pid still runs — `recipeHolderAlive` in production. */
  readonly processAlive: ProcessAlive;
  readonly writeOut: (line: string) => void;
  readonly writeDiagnostic: (line: string) => void;
  /**
   * The managed resync rows this build runs in the chair's tick — `live/resync/roster.ts#tickResyncRecipeIds`
   * in production — so a compile-only atlas's `verb-run` row is not reported stranded.
   */
  readonly tickResyncIds: readonly string[];
  /** One declared checkout's own `origin` slug — `originSlugOf`, a git read, in production. */
  readonly originOf: (args: { cwd: string }) => string | undefined;
}

/**
 * The real edges.
 *
 * @param tickResyncIds the tick-run resync rows this build derives, read once by the async entry point
 * @returns the production dependencies
 * @internal
 */
export function productionRecipeDueDeps({
  tickResyncIds,
}: {
  readonly tickResyncIds: readonly string[];
}): RecipeDueDeps {
  return {
    now: () => new Date().toISOString(),
    originOf: originSlugOf,
    processAlive: recipeHolderAlive,
    tickResyncIds,
    writeDiagnostic: (line) => process.stderr.write(`${line}\n`),
    writeOut: (line) => {
      logger.out({ line });
    },
  };
}

/**
 * Parse this verb's own tail.
 *
 * @param rest the argv tail after `automation due`
 * @param defaultHome the home to use when the caller named none
 * @returns the resolved options, or every reason the invocation was rejected
 */
export function parseRecipeDueArgs({
  rest,
  defaultHome,
}: {
  readonly rest: readonly string[];
  readonly defaultHome: string;
}): Result<RecipeDueOptions> {
  const parsed = parseFlags({
    args: rest,
    spec: { boolean: [...RECIPE_DUE_FLAG_SPEC.boolean], string: [...RECIPE_DUE_FLAG_SPEC.string] },
  });
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  const home = parsed.value.values["home"];
  return ok({
    brief: parsed.value.values["brief"] === true,
    home: typeof home === "string" ? home : defaultHome,
    json: parsed.value.values["json"] === true,
  });
}

/**
 * Read one home's definitions and report what is due.
 *
 * A claims file that is present and unreadable is REPORTED, the rows still print, and NOTHING is
 * actionable. Both halves of that matter. Refusing outright would take the whole schedule away from a tick
 * over one bad file, and a tick with no due information at all is the failure this verb exists to end; but
 * reading a corrupt claims file as "nothing is claimed" is exactly how two ticks spawn one investigation,
 * so the rows are shown and the tick is told it may not act on them.
 *
 * @param deps the injected edges
 * @param options the resolved invocation
 * @returns always `EXIT_OK` — this is a report
 */
export function reportDueAsks({
  deps,
  options,
}: {
  readonly deps: RecipeDueDeps;
  readonly options: RecipeDueOptions;
}): number {
  const paths = stateHomePaths({ home: options.home }).live.recipe;
  const roster = loadAuditedRecipeDefinitions({ home: options.home });
  // A row whose own question refuses at every firing is said on every tick, not discovered when its slot
  // fires: the rows are state, so this is the one place every registered row is read before it runs.
  unaskableInvestigateRows({ definitions: roster.definitions }).forEach((error) => {
    deps.writeDiagnostic(`automation due · UNASKABLE · ${error.message}`);
  });
  const runs = readRecipeDefinitionRunsOrEmpty({ deps, path: paths.definitionRunsJson });
  const nowIso = deps.now();
  const verdicts = judgeRecipeDefinitions({
    definitions: roster.definitions,
    nowIso,
    runFor: ({ recipeId }) => lastRecipeRun({ recipeId, runs }),
  });
  const held = openAttempts({
    definitions: roster.definitions,
    home: options.home,
    processAlive: deps.processAlive,
    verdicts,
    writeDiagnostic: (line) => {
      deps.writeDiagnostic(`automation due · ${line}`);
    },
  });
  const declared = declaredStandingRows({ home: options.home, originOf: deps.originOf });
  const retirements = readAutomationRetirements({ home: options.home });
  const comparison = compareDeclared({ declared, roster });
  const report = composeDueAskReport({
    claims: held.holders,
    claimsReadable: held.readable,
    definitions: roster.definitions,
    missing: comparison.missing,
    nowIso,
    ...ownRepositoryState({ declared, home: options.home, originOf: deps.originOf }),
    rejected: roster.rejected.map((rejection) => `${rejection.file} · REJECTED · ${rejection.error.message}`),
    repositoryDrift: comparison.repositoryDrift,
    retirements: retirementsState({ retirements }),
    superseded: comparison.superseded,
    ...teamRepositoriesState({ declared }),
    tickResyncIds: deps.tickResyncIds,
    verdicts,
  });
  writeDueReport({ deps, options, report });
  return EXIT_OK;
}

/** Print the composed report in the shape `--json` and `--brief` asked for. */
function writeDueReport({
  deps,
  options,
  report,
}: {
  readonly deps: RecipeDueDeps;
  readonly options: RecipeDueOptions;
  readonly report: ReturnType<typeof composeDueAskReport>;
}): void {
  if (options.json) {
    const value = options.brief === true ? briefDueAskReport({ report }) : report;
    deps.writeOut(safeJsonStringify({ label: "automation due", value }));
    return;
  }
  const lines = options.brief === true ? briefDueAskLines({ report }) : dueAskLines({ report });
  lines.forEach((line) => {
    deps.writeOut(line);
  });
}

/**
 * Which due rows have an OPEN attempt on the firing they are due for, in the shape the report already
 * consumes.
 *
 * The lease and the receipt are one record now (`live/automation/slotLedger.ts`), so this reads the ledger
 * rather than `definition-claims.json`. An unreadable row is the same fail-safe the claims file had and for
 * the identical reason: reading a corrupt record as "nothing holds it" is exactly how two dispatchers run
 * one firing, so the rows still print and NOTHING is reported actionable.
 *
 * Shared with `./seat.ts`, which plans from the same report: a seat reading the retired claims file while
 * `automation due` read the ledger would plan rows the ledger already holds.
 *
 * @param definitions every parsed row
 * @param writeDiagnostic where an unreadable record is reported
 * @param home the state home the ledger lives under
 * @param processAlive probes an open attempt's holder pid, so a dead in-process holder is not reported held
 * @param verdicts the due verdicts, index-aligned with `definitions`
 * @returns the holders by recipe id, and whether every record read
 */
export function openAttempts({
  definitions,
  writeDiagnostic,
  home,
  processAlive,
  verdicts,
}: {
  readonly definitions: readonly RecipeDefinition[];
  readonly writeDiagnostic: (line: string) => void;
  readonly home: string;
  readonly processAlive: ProcessAlive;
  readonly verdicts: readonly RecipeDueVerdict[];
}): { readonly holders: RecipeDefinitionClaims; readonly readable: boolean } {
  const holders: Record<string, RecipeDefinitionClaims[string]> = {};
  let readable = true;
  definitions.forEach((definition, index) => {
    const slotIso = verdicts[index]!.slotIso;
    if (slotIso === null) {
      return;
    }
    const stored = readSlotAttempt({ home, recipeId: definition.recipeId, slotIso });
    if (stored.isErr()) {
      readable = false;
      writeDiagnostic(`${stored.error.message} — NOTHING is actionable until that record reads`);
      return;
    }
    const attempt = stored.value;
    if (attempt?.outcome !== null) {
      return;
    }
    // An attempt whose in-process holder is GONE holds nothing: reporting it claimed would keep the row off
    // every tick until its lease ran out, which is silence over a dead run. `run-due` then judges it
    // under the ledger lock and routes it through the abandoned-attempt policy.
    if (holderAliveFor({ processAlive, stored: attempt }) === false) {
      return;
    }
    holders[definition.recipeId] = {
      claimId: attempt.holderToken,
      claimedAtIso: attempt.startedAtIso,
      claimedBy: attempt.holder,
      expiresAtIso: attempt.leaseExpiresIso,
      slotIso: attempt.slotIso,
    };
  });
  return { holders, readable };
}

/** The stored runs, or an empty map with the reason reported — the same fail-open as the ledger. */
function readRecipeDefinitionRunsOrEmpty({
  deps,
  path,
}: {
  readonly deps: RecipeDueDeps;
  readonly path: string;
}): RecipeDefinitionRuns {
  const runs = readRecipeDefinitionRuns({ path });
  if (runs.isErr()) {
    runs.error.forEach((line) => {
      deps.writeDiagnostic(`automation due · ${line} — every row is reported as never run`);
    });
    return {};
  }
  return runs.value;
}

/**
 * The verb entry point.
 *
 * @param argv the whole process argv
 * @returns the process exit code
 */
export async function runRecipeDue({ argv }: { readonly argv: readonly string[] }): Promise<number> {
  const options = parseRecipeDueArgs({
    defaultHome: slopweaverHome(),
    rest: argv.slice(VERB_ARG_OFFSET),
  });
  if (options.isErr()) {
    options.error.forEach((line) => process.stderr.write(`${line}\n`));
    process.stderr.write(`${RECIPE_DUE_USAGE}\n`);
    return EXIT_USAGE;
  }
  const tickResyncIds = await tickResyncRecipeIds();
  return reportDueAsks({ deps: productionRecipeDueDeps({ tickResyncIds }), options: options.value });
}

export const recipeDueCommand = defineCommand({
  run: (argv) => runRecipeDue({ argv }),
});
