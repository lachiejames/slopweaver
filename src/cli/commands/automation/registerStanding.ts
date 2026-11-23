/**
 * `slopweaver automation register-standing` — write back the rows this install declares that the store no longer
 * holds, after first registering a team repository when `--repo` names one.
 *
 * The companion to `automation due`'s absent-row line: that report is how a vanished standing row becomes
 * visible at the next supervisor pass, and this is the one command that answers it. Neither is a scheduler
 * — there is no clock here, and this verb writes the team repository registry and
 * definition files and nothing else.
 *
 * **What is declared is resolved from the home** (`live/automation/declaredStandingRows.ts`): the generic rows
 * every install carries, plus the two rows on the declared `slopweaver` checkout's `origin`, plus each registered
 * team repository's rows, minus each row `automation retire` retired on this install — so a retired row is never
 * written back. A pass writing either of the two appends that `origin` to `live/recipe/own-repositories.json`, so a
 * later move still recognises what it wrote. `--repo <owner/name>` adds one registration to
 * `$SLOPWEAVER_HOME/live/recipe/team-repositories.json` first, so no team repository is compiled into this build.
 * The registry is written
 * BEFORE the definitions: a crash between the two leaves loud missing rows a repeat run converges on, never
 * team definitions whose declaration is gone.
 *
 * **It creates into an empty path, and writes over an occupied one only when that file is still exactly an
 * earlier build's declaration** (`StandingRow.supersedes`, re-read at the moment of writing). Why that is the
 * whole contract, rather than a stage a reconciler has not reached, is in `live/automation/standingRowStore.ts`'s
 * header: the roster is closed and short, so the general update, retire and adopt paths that
 * `live/resync/registrationStore.ts` needs — and that three Codex passes each caught overwriting somebody's
 * file — have nothing to do here.
 *
 * The exit code is non-zero when a declared row is neither present nor written, the registry cannot be read
 * or extended, or no single `slopweaver` checkout resolves, because a pass that reported a missing schedule and
 * exited clean is the tick lying about its own coverage. The pass itself is `./registerStandingPass.ts`.
 */
import { slopweaverHome } from "../../../homeDir.js";
import { logger } from "../../../lib/logger.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { RECIPE_DEFINITION_HOLDS_LOCK_KEY } from "../../../live/automation/failureHoldStore.js";
import { parseTeamRepositoryRegistration } from "../../../live/automation/teamRepositoryStore.js";
import { acquireWaitingLock } from "../../../live/automation/waitingLock.js";
import { originSlugOf } from "../../../live/checkout/checkoutForRepo.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { parseFlags } from "../../parseFlags.js";
import { RECIPE_REGISTER_STANDING_FLAG_SPEC, RECIPE_REGISTER_STANDING_USAGE } from "./core.js";
import { type RegisterStandingDeps, type RegisterStandingOptions, registerPass } from "./registerStandingPass.js";

/** Where the flag tail starts: past the runtime, the script, the `recipe` noun and the verb. */
const VERB_ARG_OFFSET = 4;

/**
 * The real edges.
 *
 * @returns the production dependencies
 * @internal
 */
export function productionRegisterStandingDeps(): RegisterStandingDeps {
  return {
    originOf: originSlugOf,
    writeDiagnostic: (line) => process.stderr.write(`${line}\n`),
    writeOut: (line) => {
      logger.out({ line });
    },
  };
}

/** A string flag's value, or `undefined` when it was not passed. */
function stringFlag({
  values,
  name,
}: {
  readonly values: Readonly<Record<string, unknown>>;
  readonly name: string;
}): string | undefined {
  const value = values[name];
  return typeof value === "string" ? value : undefined;
}

/**
 * Parse this verb's own tail.
 *
 * @param rest the argv tail after `automation register-standing`
 * @param defaultHome the home to use when the caller named none
 * @returns the resolved options, or every reason the invocation was rejected
 */
export function parseRegisterStandingArgs({
  rest,
  defaultHome,
}: {
  readonly rest: readonly string[];
  readonly defaultHome: string;
}): Result<RegisterStandingOptions> {
  const parsed = parseFlags({
    args: rest,
    spec: {
      boolean: [...RECIPE_REGISTER_STANDING_FLAG_SPEC.boolean],
      string: [...RECIPE_REGISTER_STANDING_FLAG_SPEC.string],
    },
  });
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  const values = parsed.value.values;
  const home = values["home"];
  const base = {
    dryRun: values["dry-run"] === true,
    home: typeof home === "string" ? home : defaultHome,
    json: values["json"] === true,
  };
  const repository = stringFlag({ name: "repo", values });
  if (repository === undefined) {
    return ok(base);
  }
  const registration = parseTeamRepositoryRegistration({ registration: { repository } });
  if (registration.isErr()) {
    return err(registration.error);
  }
  return ok({ ...base, registration: registration.value });
}

/**
 * Read the registry, extend it with the requested registration, and register then write what is missing.
 *
 * A dry run takes no lock and writes nothing — neither the registry nor a definition. A real pass holds the
 * definition hold lock across both writes, and re-reads the registry under it.
 *
 * @param deps the injected edges
 * @param options the resolved invocation
 * @returns the process exit code
 */
export function registerStandingRows({
  deps,
  options,
}: {
  readonly deps: RegisterStandingDeps;
  readonly options: RegisterStandingOptions;
}): number {
  if (options.dryRun) {
    return registerPass({ deps, options });
  }
  // Under the hold lock: a bring-forward writes a row whole, so a failure hold placed between its re-read and
  // its rename would otherwise be lost (`live/automation/failureHoldStore.ts` § One lock for every writer), and
  // two registrations racing would each extend the registry they read and lose the other's.
  const lock = acquireWaitingLock({
    home: options.home,
    key: RECIPE_DEFINITION_HOLDS_LOCK_KEY,
    nowIso: new Date().toISOString(),
  });
  if (lock.isErr()) {
    deps.writeDiagnostic(
      `automation register-standing · the definition hold lock is busy, nothing written: ${lock.error}`,
    );
    return EXIT_ERROR;
  }
  try {
    return registerPass({ deps, options });
  } finally {
    lock.value.release();
  }
}

/**
 * The verb entry point.
 *
 * @param argv the whole process argv
 * @param deps the injected edges; omitted takes the production ones
 * @returns the process exit code
 */
export function runRecipeRegisterStanding({
  argv,
  deps = productionRegisterStandingDeps(),
}: {
  readonly argv: readonly string[];
  readonly deps?: RegisterStandingDeps;
}): number {
  const rest = argv.slice(VERB_ARG_OFFSET);
  if (rest.includes("--help") || rest.includes("-h")) {
    deps.writeOut(RECIPE_REGISTER_STANDING_USAGE);
    return EXIT_OK;
  }
  const options = parseRegisterStandingArgs({ defaultHome: slopweaverHome(), rest });
  if (options.isErr()) {
    options.error.forEach((line) => {
      deps.writeDiagnostic(line);
    });
    deps.writeDiagnostic(RECIPE_REGISTER_STANDING_USAGE);
    return EXIT_USAGE;
  }
  return registerStandingRows({ deps, options: options.value });
}

export const recipeRegisterStandingCommand = defineCommand({
  run: (argv) => runRecipeRegisterStanding({ argv }),
});
