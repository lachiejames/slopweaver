/**
 * `slopweaver automation resync` — bring ONE atlas or corpus source current, and record whether it worked.
 *
 * This is the verb every scheduled row selects. A definition file says `automation resync --atlas trelica`
 * and nothing else; what that executes comes from `live/resync/policy.ts`'s roster, which is derived from
 * the atlas's own descriptor and lives in the repository. The definition directory is ungated
 * (`live/automation/definitionStore.ts` says so), so a row free to name arbitrary argv would put the choice of
 * what runs in a file nothing reviews — here a row may choose only WHICH target.
 *
 * ## It records a POSTCONDITION, which is the point rather than a nicety
 *
 * Measured on this installation: `atlas trelica refresh` exits 1 and publishes nothing;
 * `atlas vanta sync` exits 1 and publishes a usable generation with a handful of surfaces incomplete. And
 * a run stamp, which is all `automation run-due` writes, cannot tell either of those from a healthy run — a
 * row that has fired every four hours and failed every time carries the same stamp as one that works. So
 * this writes its own record (`live/resync/outcomeStore.ts`) carrying when the target last actually
 * SUCCEEDED, which is the number the briefing's freshness page reports.
 *
 * ## A demand-gated atlas asks the corpus first
 *
 * An atlas declaring `resyncDemand` (Aether) walks only when a person has named it since its last success
 * (`live/resync/demand.ts`). With no demand the verb runs no step, writes no record and exits
 * `EXIT_EXPECTED_EMPTY`, so the slot is stamped and no sign-in page is ever met; a check that cannot read exits
 * `EXIT_DEFERRED`. With demand it walks as any target does, and the attempt carries the mention.
 */
import { takeSignInWalls } from "../../../browser/signInWalls.js";
import { takeRelayRecoveries, takeWalkCollisions, takeWalkStops } from "../../../browser/walkStops.js";
import { type CorpusSource } from "../../../corpus/types.js";
import { slopweaverHome } from "../../../homeDir.js";
import { ALL_CORPUS_SOURCES } from "../../../integrations/corpusSources.js";
import { errorMessage } from "../../../lib/errorMessage.js";
import { logger } from "../../../lib/logger.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { safeJsonStringify } from "../../../lib/safeJson.js";
import { readResyncAsOf, readResyncClock } from "../../../live/resync/clock.js";
import type { ResyncDemandRead } from "../../../live/resync/demand.js";
import { readResyncDemand } from "../../../live/resync/demandRead.js";
import { type ResyncAttempt, resyncExitCode } from "../../../live/resync/outcome.js";
import { readResyncState, writeResyncState } from "../../../live/resync/outcomeStore.js";
import { findResyncPolicy, type ResyncPolicy } from "../../../live/resync/policy.js";
import { readResyncRoster } from "../../../live/resync/roster.js";
import { type ResyncRunDeps, runResync } from "../../../live/resync/run.js";
import { resyncStepLine } from "../../../live/resync/steps.js";
import { type ResyncTarget, resyncRecipeId, resyncTargetLabel } from "../../../live/resync/target.js";
import { stateHomePaths } from "../../../stateHome.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_DEFERRED, EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { main } from "../../main.js";
import { parseFlags } from "../../parseFlags.js";
import { RECIPE_RESYNC_FLAG_SPEC, RECIPE_RESYNC_USAGE } from "./core.js";
import { type RecipeCommandError, RecipeCommandErrors, recipeCommandErrorLines } from "./errors.js";
import { productionCorpusPropagationDeps, propagateCorpusSync, type SyncToPropagate } from "./propagateRun.js";
import { deferredWhy } from "./resyncDeferredWhy.js";
import { demandGate, lastSuccessOf } from "./resyncDemandGate.js";

/** Where the flag tail starts: past the runtime, the script, the `recipe` noun and the `resync` verb. */
const VERB_ARG_OFFSET = 4;

/** The resolved invocation — either one target to run, or the roster to print. */
interface ResyncOptions {
  readonly target: ResyncTarget | null;
  readonly list: boolean;
  readonly json: boolean;
  readonly home: string;
}

/** The injected edges. */
export interface RecipeResyncDeps {
  readonly now: () => string;
  /**
   * What a SUCCESSFUL corpus sync does last (`./propagateRun.ts`). It never throws and never answers a verdict:
   * the resync's own outcome is written before it runs and is the only thing the exit code reflects.
   */
  readonly propagateCorpus: (sync: SyncToPropagate) => Promise<void>;
  /**
   * Whether a demand-gated atlas has a reason to walk since its last success — `live/resync/demandRead.ts` in
   * production. Asked before any step runs; `ungated` for every target that declares no gate.
   */
  readonly readDemand: (args: {
    readonly home: string;
    readonly target: ResyncTarget;
    readonly sinceIso: string | null;
  }) => Promise<ResyncDemandRead>;
  readonly runVerb: (argv: readonly string[]) => Promise<number>;
  readonly writeOut: (line: string) => void;
  readonly writeDiagnostic: (line: string) => void;
}

/**
 * The real edges.
 *
 * @returns the production dependencies, dispatching through the CLI's own router
 * @internal
 */
export function productionRecipeResyncDeps(): RecipeResyncDeps {
  return {
    now: () => new Date().toISOString(),
    propagateCorpus: async (sync) => {
      await propagateCorpusSync({ deps: productionCorpusPropagationDeps(), sync });
    },
    readDemand: (args) => readResyncDemand(args),
    runVerb: (argv) => main(argv),
    writeDiagnostic: (line) => process.stderr.write(`${line}\n`),
    writeOut: (line) => {
      logger.out({ line });
    },
  };
}

/**
 * Parse this verb's own tail.
 *
 * @param rest the argv tail after `automation resync`
 * @param defaultHome the home to use when the caller named none
 * @returns the resolved options, or every reason the invocation was rejected
 */
export function parseRecipeResyncArgs({
  rest,
  defaultHome,
}: {
  readonly rest: readonly string[];
  readonly defaultHome: string;
}): Result<ResyncOptions, RecipeCommandError> {
  const parsed = parseFlags({
    args: rest,
    spec: { boolean: [...RECIPE_RESYNC_FLAG_SPEC.boolean], string: [...RECIPE_RESYNC_FLAG_SPEC.string] },
  });
  if (parsed.isErr()) {
    return err(RecipeCommandErrors.flagsInvalid({ reasons: parsed.error }));
  }
  const values = parsed.value.values;
  const home = values["home"];
  const list = values["list"] === true;
  const platform = typeof values["atlas"] === "string" ? values["atlas"] : undefined;
  const source = typeof values["source"] === "string" ? values["source"] : undefined;
  const resolvedHome = typeof home === "string" ? home : defaultHome;

  if (list) {
    if (platform !== undefined || source !== undefined) {
      return err(RecipeCommandErrors.listWithTarget());
    }
    return ok({ home: resolvedHome, json: values["json"] === true, list: true, target: null });
  }
  if (platform !== undefined && source !== undefined) {
    return err(RecipeCommandErrors.targetsAmbiguous());
  }
  if (platform !== undefined) {
    return ok({
      home: resolvedHome,
      json: false,
      list: false,
      target: { kind: "atlas", platform },
    });
  }
  if (source === undefined) {
    return err(RecipeCommandErrors.targetMissing());
  }
  const named = namedCorpusSource({ value: source });
  if (named === undefined) {
    return err(RecipeCommandErrors.corpusSourceUnknown({ choices: ALL_CORPUS_SOURCES, source }));
  }
  return ok({ home: resolvedHome, json: false, list: false, target: { kind: "corpus", source: named } });
}

/**
 * The source a typed word names, when it names one.
 *
 * A lookup rather than a type predicate because a predicate cannot destructure its parameter (TS1230), and
 * a positional signature for one word is the transposition this repository's named-object rule exists to
 * prevent. The lookup narrows just as well and keeps the boundary named.
 */
function namedCorpusSource({ value }: { readonly value: string }): CorpusSource | undefined {
  return ALL_CORPUS_SOURCES.find((source) => source === value);
}

/**
 * The line one policy prints in the roster listing.
 *
 * @param policy the target's resolved schedule
 * @returns the line, naming the cadence and every step
 */
export function resyncRosterLine({ policy }: { readonly policy: ResyncPolicy }): string {
  const steps = policy.steps.map((step) => resyncStepLine({ step })).join(" && ");
  const note = policy.note === null ? "" : ` · ${policy.note}`;
  return `${policy.recipeId} · ${policy.cadence} · ${steps}${note}`;
}

/**
 * Run the verb.
 *
 * @param argv the whole process argv, as the CLI received it
 * @param deps the injected edges; omitted takes the production ones
 * @returns the process exit code
 */
export async function runRecipeResync({
  argv,
  deps = productionRecipeResyncDeps(),
}: {
  readonly argv: readonly string[];
  readonly deps?: RecipeResyncDeps;
}): Promise<number> {
  const rest = argv.slice(VERB_ARG_OFFSET);
  if (rest.includes("--help") || rest.includes("-h")) {
    deps.writeOut(RECIPE_RESYNC_USAGE);
    return EXIT_OK;
  }
  const options = parseRecipeResyncArgs({ defaultHome: slopweaverHome(), rest });
  if (options.isErr()) {
    recipeCommandErrorLines({ error: options.error }).forEach((line) => {
      deps.writeDiagnostic(line);
    });
    deps.writeDiagnostic(RECIPE_RESYNC_USAGE);
    return EXIT_USAGE;
  }

  const roster = await readResyncRoster({ home: options.value.home });
  roster.problems.forEach((problem) => {
    deps.writeDiagnostic(`roster problem · ${problem}`);
  });

  if (options.value.list) {
    return listRoster({ deps, json: options.value.json, roster });
  }
  // Safe: the parse returns a target on every branch that is not `--list`.
  const target = options.value.target!;
  const policy = findResyncPolicy({ policies: roster.policies, recipeId: resyncRecipeId({ target }) });
  if (policy === undefined) {
    deps.writeDiagnostic(
      `this build schedules no ${resyncTargetLabel({ target })} — \`automation resync --list\` has the roster`,
    );
    return EXIT_USAGE;
  }
  return resyncOneTarget({ deps, home: options.value.home, policy, target });
}

/**
 * Print the whole roster and run nothing.
 *
 * @param roster every target this build schedules, with any problem building one
 * @param json whether to emit the machine-readable document instead of the lines
 * @param deps the injected edges
 * @returns the process exit code — non-zero only when a target could not get a policy at all
 */
function listRoster({
  roster,
  json,
  deps,
}: {
  readonly roster: Awaited<ReturnType<typeof readResyncRoster>>;
  readonly json: boolean;
  readonly deps: RecipeResyncDeps;
}): number {
  if (json) {
    deps.writeOut(safeJsonStringify({ label: "automation resync --list", value: roster }));
  } else {
    roster.policies.forEach((policy) => {
      deps.writeOut(resyncRosterLine({ policy }));
    });
    deps.writeOut(`${String(roster.policies.length)} target(s) scheduled`);
  }
  return roster.problems.length > 0 ? EXIT_ERROR : EXIT_OK;
}

/**
 * Run one target's steps, record the outcome, and report it.
 *
 * A stored record that is there but corrupt refuses the target before any step runs. A state write that
 * fails is reported and still returns non-zero even on a successful sync, because a resync nothing recorded
 * is one the freshness page cannot see — and an invisible success is the failure this record exists to end.
 *
 * @param policy the target's reviewed schedule
 * @param target what is being resynced
 * @param home the state home to resync into
 * @param deps the injected edges
 * @returns the process exit code
 */
async function resyncOneTarget({
  policy,
  target,
  home,
  deps,
}: {
  readonly policy: ResyncPolicy;
  readonly target: ResyncTarget;
  readonly home: string;
  readonly deps: RecipeResyncDeps;
}): Promise<number> {
  const stateDir = stateHomePaths({ home }).live.recipe.resyncStateDir;
  // A record that is there but corrupt refuses BEFORE any step runs: read as absent, it would be overwritten
  // by this attempt and the target's last success erased with it.
  const previous = readResyncState({ recipeId: policy.recipeId, stateDir });
  if (previous.isErr()) {
    deps.writeDiagnostic(`automation resync: ${previous.error.message}`);
    return EXIT_ERROR;
  }
  deps.writeOut(`automation resync · ${resyncTargetLabel({ target })}`);
  const demand = await deps.readDemand({ home, sinceIso: lastSuccessOf({ state: previous.value }), target });
  const gate = demandGate({ demand });
  if (gate.line !== undefined) {
    deps.writeOut(`automation resync · ${resyncTargetLabel({ target })} · ${gate.line}`);
  }
  if (gate.exitCode !== undefined) {
    return gate.exitCode;
  }
  const result = await runResync({
    blocker: null,
    deps: resyncRunDeps({ deps, home, target }),
    home,
    policy,
    previous: previous.value,
    ...(demand.kind === "wanted" ? { demand: demand.record } : {}),
  });

  const written = writeResyncState({ state: result.state, stateDir });
  if (written.isErr()) {
    written.error.forEach((line) => {
      deps.writeDiagnostic(line);
    });
  }
  result.attempt.problems.forEach((problem) => {
    deps.writeDiagnostic(`  ${problem}`);
  });
  deps.writeOut(
    `automation resync · ${resyncTargetLabel({ target })} · ${result.attempt.outcome} · ` +
      `clock ${String(result.attempt.beforeClock)} → ${String(result.attempt.afterClock)}`,
  );
  await propagateRecordedSync({
    deps,
    sync: corpusSyncToPropagate({ attempt: result.attempt, home, recorded: written.isOk(), target }),
  });
  const exitCode = resyncExitCode({ attempt: result.attempt, recorded: written.isOk() });
  if (exitCode === EXIT_DEFERRED) {
    deps.writeOut(`automation resync · ${resyncTargetLabel({ target })} · ${deferredWhy({ attempt: result.attempt })}`);
  }
  return exitCode;
}

/**
 * Every corpus sync ENDS with propagation. It runs only once the verdict is written, and
 * cannot change it — a landing read or a seat that fails is on the propagation record, never a failed sync.
 */
async function propagateRecordedSync({
  deps,
  sync,
}: {
  readonly deps: RecipeResyncDeps;
  readonly sync: ReturnType<typeof corpusSyncToPropagate>;
}): Promise<void> {
  if (sync === null) {
    return;
  }
  try {
    await deps.propagateCorpus(sync);
  } catch (cause) {
    deps.writeDiagnostic(`  propagation · threw, and the sync's own outcome stands: ${errorMessage({ error: cause })}`);
  }
}

/**
 * The sync a finished attempt hands to propagation — only a corpus target, only one that SUCCEEDED, and only
 * once its verdict is RECORDED. An atlas feeds no corpus surface (`docs/propagation-map.md`), a failed sync
 * changed nothing worth a pass, and an unrecorded one exits 1, so a pass seated for it would outrun the
 * resync state every reader trusts.
 *
 * @param attempt the attempt just judged
 * @param target what was resynced
 * @param home the state home it resynced into
 * @param recorded whether the attempt's verdict reached resync-state
 * @returns the sync to propagate, or null when there is none
 */
export function corpusSyncToPropagate({
  attempt,
  target,
  home,
  recorded,
}: {
  readonly attempt: Pick<ResyncAttempt, "outcome" | "recipeId" | "finishedAtIso">;
  readonly target: ResyncTarget;
  readonly home: string;
  readonly recorded: boolean;
}): SyncToPropagate | null {
  if (target.kind !== "corpus" || attempt.outcome !== "succeeded" || !recorded) {
    return null;
  }
  return { home, recipeId: attempt.recipeId, source: target.source, syncFinishedAtIso: attempt.finishedAtIso };
}

/** The runner's edges, with the clock read bound to this invocation's own target and home. */
function resyncRunDeps({
  deps,
  target,
  home,
}: {
  readonly deps: RecipeResyncDeps;
  readonly target: ResyncTarget;
  readonly home: string;
}): ResyncRunDeps {
  return {
    now: deps.now,
    readAsOf: () => readResyncAsOf({ home, target }),
    readClock: () => readResyncClock({ home, target }),
    runVerb: deps.runVerb,
    takeRelayRecoveries,
    takeSignInWalls,
    takeWalkCollisions,
    takeWalkStops,
    writeOut: deps.writeOut,
  };
}

export const recipeResyncCommand = defineCommand({ run: (argv) => runRecipeResync({ argv }) });
