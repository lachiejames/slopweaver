/**
 * `slopweaver automation register-resyncs` — reconcile the definition store against the roster this build
 * derives, so every atlas and every corpus source is scheduled and none is scheduled by hand.
 *
 * A briefing card must never ask the owner whether a stale atlas should be re-synced: scheduled resyncs run
 * across all atlases and corpuses, so a stale one is fixed, not asked about.
 * Measured on an install with nothing registered: `automation due` read *"no definitions — nothing is scheduled on this install"* while
 * `atlas freshness` judged 36 of 36 atlases behind their own windows. The whole scheduling mechanism
 * shipped and nothing had ever been registered into it.
 *
 * ## Why this is a verb rather than a set of files somebody wrote once
 *
 * Reproduce the failure it prevents: add an atlas to `atlas/registry.ts` and register no row for it. With
 * hand-written definitions that atlas is silently unscheduled forever, and the only symptom is a number on
 * a page nobody is checking. Deriving the roster means an atlas joins the schedule by being registered,
 * which is the property the ruling is actually asking for.
 *
 * It is READ-ONLY about everything it does not own. A row somebody wrote by hand, a row somebody paused,
 * and a row wearing a managed id that no pass on this install recorded writing are each left exactly where
 * they are and reported — see `live/resync/registrationPlan.ts` for why each of those three is a refusal
 * rather than a correction.
 */
import { slopweaverHome } from "../../../homeDir.js";
import { logger } from "../../../lib/logger.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { safeJsonStringify } from "../../../lib/safeJson.js";
import { loadRecipeDefinitions } from "../../../live/automation/definitionStore.js";
import {
  aliasedRecipeIds,
  planResyncRegistration,
  type RegistrationPlan,
  registrationCounts,
} from "../../../live/resync/registrationPlan.js";
import {
  applyResyncRegistration,
  type RefusedWrite,
  readOwnedResyncIds,
} from "../../../live/resync/registrationStore.js";
import { readResyncRoster } from "../../../live/resync/roster.js";
import { stateHomePaths } from "../../../stateHome.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { parseFlags } from "../../parseFlags.js";
import { RECIPE_REGISTER_RESYNCS_FLAG_SPEC, RECIPE_REGISTER_RESYNCS_USAGE } from "./core.js";

/** Where the flag tail starts: past the runtime, the script, the `recipe` noun and the verb. */
const VERB_ARG_OFFSET = 4;

/** The resolved invocation. */
interface RegisterResyncsOptions {
  readonly dryRun: boolean;
  readonly json: boolean;
  readonly home: string;
}

/** The injected edges. */
export interface RegisterResyncsDeps {
  readonly writeOut: (line: string) => void;
  readonly writeDiagnostic: (line: string) => void;
}

/**
 * The real edges.
 *
 * @returns the production dependencies
 * @internal
 */
export function productionRegisterResyncsDeps(): RegisterResyncsDeps {
  return {
    writeDiagnostic: (line) => process.stderr.write(`${line}\n`),
    writeOut: (line) => {
      logger.out({ line });
    },
  };
}

/**
 * Parse this verb's own tail.
 *
 * @param rest the argv tail after `automation register-resyncs`
 * @param defaultHome the home to use when the caller named none
 * @returns the resolved options, or every reason the invocation was rejected
 */
export function parseRegisterResyncsArgs({
  rest,
  defaultHome,
}: {
  readonly rest: readonly string[];
  readonly defaultHome: string;
}): Result<RegisterResyncsOptions> {
  const parsed = parseFlags({
    args: rest,
    spec: {
      boolean: [...RECIPE_REGISTER_RESYNCS_FLAG_SPEC.boolean],
      string: [...RECIPE_REGISTER_RESYNCS_FLAG_SPEC.string],
    },
  });
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  const home = parsed.value.values["home"];
  return ok({
    dryRun: parsed.value.values["dry-run"] === true,
    home: typeof home === "string" ? home : defaultHome,
    json: parsed.value.values["json"] === true,
  });
}

/**
 * The lines one plan prints — one per row that is not already correct, then the tally.
 *
 * An `unchanged` row prints nothing individually and is counted, because 43 lines saying "still fine" is
 * the wall rule 7 refuses and would bury the two lines that matter.
 *
 * @param plan the plan just decided
 * @param dryRun whether the effects were withheld, so the verb says `would` rather than `did`
 * @param problems every target that could not get a policy at all
 * @returns the lines to print, in order
 */
export function registerResyncsLines({
  plan,
  dryRun,
  problems,
}: {
  readonly plan: RegistrationPlan;
  readonly dryRun: boolean;
  readonly problems: readonly string[];
}): readonly string[] {
  const verb = dryRun ? "would" : "did";
  const lines = plan.changes
    .filter((change) => change.action !== "unchanged")
    .map((change) => {
      const reason = change.reason === null ? "" : ` · ${change.reason}`;
      return `${change.recipeId} · ${verb} ${change.action}${reason}`;
    });
  const counts = registrationCounts({ plan });
  return [
    ...lines,
    ...problems.map((problem) => `roster problem · ${problem}`),
    `automation register-resyncs · ${String(counts.create)} created · ${String(counts.update)} updated · ` +
      `${String(counts.unchanged)} unchanged · ${String(counts.retire)} retired · ` +
      `${String(counts.conflict)} conflict(s)${dryRun ? " · DRY RUN, nothing written" : ""}`,
  ];
}

/**
 * Run the verb.
 *
 * The exit code is non-zero when the roster could not be built or a write failed, and ALSO when any row is
 * a conflict: a conflict is a row that is not scheduled the way this build says it should be, and a
 * scheduled pass that reported it and exited clean would be the tick lying about its own coverage.
 *
 * @param argv the whole process argv, as the CLI received it
 * @param deps the injected edges; omitted takes the production ones
 * @returns the process exit code
 */
export async function runRegisterResyncs({
  argv,
  deps = productionRegisterResyncsDeps(),
}: {
  readonly argv: readonly string[];
  readonly deps?: RegisterResyncsDeps;
}): Promise<number> {
  const rest = argv.slice(VERB_ARG_OFFSET);
  if (rest.includes("--help") || rest.includes("-h")) {
    deps.writeOut(RECIPE_REGISTER_RESYNCS_USAGE);
    return EXIT_OK;
  }
  const options = parseRegisterResyncsArgs({ defaultHome: slopweaverHome(), rest });
  if (options.isErr()) {
    options.error.forEach((line) => {
      deps.writeDiagnostic(line);
    });
    deps.writeDiagnostic(RECIPE_REGISTER_RESYNCS_USAGE);
    return EXIT_USAGE;
  }

  const { dryRun, home, json } = options.value;
  const paths = stateHomePaths({ home }).live.recipe;
  const roster = await readResyncRoster({ home });
  const owned = readOwnedResyncIds({ ownedPath: paths.resyncOwnedJson });
  const store = loadRecipeDefinitions({ board: null, directory: paths.definitionsDir });
  const plan = planResyncRegistration({
    existing: store.definitions,
    owned,
    policies: roster.policies,
    aliased: aliasedRecipeIds({ definitionFiles: store.definitionFiles, definitions: store.definitions }),
    unreadable: store.rejected.map((rejection) => rejection.file),
  });

  let refused: readonly RefusedWrite[] = [];
  if (!dryRun) {
    const applied = applyResyncRegistration({
      definitionsDir: paths.definitionsDir,
      home,
      nowIso: new Date().toISOString(),
      owned,
      ownedPath: paths.resyncOwnedJson,
      plan,
    });
    if (applied.isErr()) {
      applied.error.forEach((line) => {
        deps.writeDiagnostic(line);
      });
      return EXIT_ERROR;
    }
    refused = applied.value.refused;
  }
  const planned = reportPlan({ deps, dryRun, json, plan, problems: roster.problems });
  return reportRefusals({ deps, planned, refused });
}

/**
 * Print every row the writer declined to touch, and fold that into the exit code.
 *
 * A write-time refusal means the file on disk contradicted the plan — the registrar would otherwise have
 * overwritten or deleted something it could not see. The pass kept going for every other row, which is
 * right, but it must not exit clean: the schedule is not what this build says it should be.
 *
 * @param refused the rows the writer refused
 * @param planned the exit code the plan's own report produced
 * @param deps the injected edges
 * @returns the process exit code
 */
function reportRefusals({
  refused,
  planned,
  deps,
}: {
  readonly refused: readonly RefusedWrite[];
  readonly planned: number;
  readonly deps: RegisterResyncsDeps;
}): number {
  refused.forEach((row) => {
    deps.writeDiagnostic(`${row.recipeId} · REFUSED at write · ${row.reason}`);
  });
  return refused.length > 0 ? EXIT_ERROR : planned;
}

/**
 * Print what the pass decided, and answer with the exit code that says whether the schedule is right.
 *
 * @param plan the plan just decided
 * @param problems every target that could not get a policy at all
 * @param dryRun whether the effects were withheld
 * @param json whether to emit the machine-readable document instead of the lines
 * @param deps the injected edges
 * @returns the process exit code
 */
function reportPlan({
  plan,
  problems,
  dryRun,
  json,
  deps,
}: {
  readonly plan: RegistrationPlan;
  readonly problems: readonly string[];
  readonly dryRun: boolean;
  readonly json: boolean;
  readonly deps: RegisterResyncsDeps;
}): number {
  const counts = registrationCounts({ plan });
  if (json) {
    deps.writeOut(
      safeJsonStringify({
        label: "automation register-resyncs",
        value: { changes: plan.changes, counts, dryRun, problems },
      }),
    );
  } else {
    registerResyncsLines({ dryRun, plan, problems }).forEach((line) => {
      deps.writeOut(line);
    });
  }
  if (counts.conflict > 0 || problems.length > 0) {
    return EXIT_ERROR;
  }
  return EXIT_OK;
}

export const recipeRegisterResyncsCommand = defineCommand({ run: (argv) => runRegisterResyncs({ argv }) });
