/**
 * `slopweaver automation repoint <recipeId> [--dry-run] [--json]` — correct ONE own-repository row the store holds as
 * REPOSITORY DRIFT, in place: its one `--repo` moves to the declared repository and every other field stays. What it
 * writes, and why never a removal, is `../../../live/automation/standingRowRepositoryRepoint.ts`'s header.
 *
 * ## The order of the two writes is `register-standing`'s
 *
 * Under the definition hold lock, the new address is recorded in the own-repository history FIRST and the row written
 * SECOND, as `./registerStandingPass.ts` does, so a crash between them leaves an address the next pass still
 * recognises, never a row whose provenance is forgotten. The earlier slug is never recorded: no pass wrote it.
 *
 * ## Never taken over from a live holder
 *
 * The lock waits on a live holder however old, as `./retire.ts`'s does: a `register-standing` pass paused past the
 * default staleness still holds what it read, and would write over the repoint. The reverse is not in this verb's
 * gift — that pass keeps the default staleness, so it may take the lock from a repoint paused past it — so each write
 * asks the handle whether this run's token still stands, and stops if not. A dry run takes no lock at all,
 * because taking one is a write; it is a preview of the store as it stood, and a real run plans again under the lock.
 */
import { lstatSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { errorMessage } from "#lib/errorMessage.js";
import { logger } from "#lib/logger.js";
import { err, ok, type Result } from "#lib/result.js";
import { safeJsonStringify } from "#lib/safeJson.js";
import { writeFileAtomic } from "#lib/writeAtomic.js";
import { slopweaverHome } from "../../../homeDir.js";
import { declaredStandingRows } from "../../../live/automation/declaredStandingRows.js";
import { loadRecipeDefinitions } from "../../../live/automation/definitionStore.js";
import { RECIPE_DEFINITION_HOLDS_LOCK_KEY } from "../../../live/automation/failureHoldStore.js";
import { ownRepositoryStateOf, ownRepositoryUnresolvedLine } from "../../../live/automation/ownRepository.js";
import { recordOwnRepository } from "../../../live/automation/ownRepositoryStore.js";
import { planRepoint, type RepointPlan, repointLine } from "../../../live/automation/standingRowRepositoryRepoint.js";
import { acquireWaitingLock } from "../../../live/automation/waitingLock.js";
import { originSlugOf } from "../../../live/checkout/checkoutForRepo.js";
import { stateHomePaths } from "../../../stateHome.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { recipeCommandErrorLines } from "./errors.js";
import { parseRepointArgs, type RepointOptions } from "./repointArgs.js";
import { type RepointRunError, RepointRunErrors } from "./repointRunErrors.js";
import { RECIPE_REPOINT_USAGE } from "./repointUsage.js";
import { recipeTreeEscape } from "./retireHomeCheck.js";

/** Where the flag tail starts: past the runtime, the script, the `automation` noun and the `repoint` verb. */
const VERB_ARG_OFFSET = 4;

/** The injected edges, so the verb is tested over a real temporary home with plain fakes. */
export interface RepointDeps {
  readonly now: () => string;
  /** One declared checkout's own `origin` slug — `originSlugOf`, a git read, in production. */
  readonly originOf: (args: { cwd: string }) => string | undefined;
  readonly writeOut: (line: string) => void;
  readonly writeDiagnostic: (line: string) => void;
}

/**
 * The real edges.
 *
 * @returns the production dependencies
 * @internal
 */
export function productionRepointDeps(): RepointDeps {
  return {
    now: () => new Date().toISOString(),
    originOf: originSlugOf,
    writeDiagnostic: (line) => process.stderr.write(`${line}\n`),
    writeOut: (line) => {
      logger.out({ line });
    },
  };
}

/** The canonical file's text, `""` when it is absent, or why it is not an ordinary file this verb may replace. */
function canonicalText({ path }: { readonly path: string }): Result<string, RepointRunError> {
  try {
    if (!lstatSync(path).isFile()) {
      return err(RepointRunErrors.notRegularFile({ path }));
    }
    return ok(readFileSync(path, "utf8"));
  } catch (cause) {
    if (cause instanceof Error && "code" in cause && cause.code === "ENOENT") {
      return ok("");
    }
    return err(RepointRunErrors.fileUnreadable({ cause: errorMessage({ error: cause }), path }));
  }
}

/** Compose the declaration, read the store and plan the repoint — the whole read half, run under the lock for a write. */
function planIn({
  deps,
  options,
}: {
  readonly deps: RepointDeps;
  readonly options: RepointOptions;
}): Result<RepointPlan, RepointRunError> {
  const declared = declaredStandingRows({ home: options.home, originOf: deps.originOf });
  if (declared.isErr()) {
    return err(RepointRunErrors.declarationUnreadable({ cause: declared.error.message }));
  }
  const state = ownRepositoryStateOf({ ownRepository: declared.value.ownRepository });
  if (state.kind === "unresolved") {
    return err(RepointRunErrors.ownRepositoryUnresolved({ line: ownRepositoryUnresolvedLine({ state }) }));
  }
  const directory = stateHomePaths({ home: options.home }).live.recipe.definitionsDir;
  const roster = loadRecipeDefinitions({ board: null, directory });
  if (roster.directoryError !== null) {
    return err(RepointRunErrors.definitionsUnlisted({ cause: roster.directoryError }));
  }
  const text = canonicalText({ path: join(directory, `${options.recipeId}.json`) });
  if (text.isErr()) {
    return err(text.error);
  }
  return planRepoint({
    declared: declared.value.ownRepositoryRows,
    definitionFiles: roster.definitionFiles,
    definitions: roster.definitions,
    rawText: text.value,
    recipeId: options.recipeId,
  }).mapErr((refusal) => RepointRunErrors.planRefused({ refusal }));
}

/**
 * Record the new address, then write the row — each step only while this run's own token still stands in the lock.
 * A live holder older than another pass's staleness can be taken over (a `register-standing` pass keeps the default),
 * so the takeover is detected here rather than written through.
 *
 * @param stillHeld the lock handle's own check that this run's token still stands
 * @returns nothing on a write, or why the store was left as it stood
 * @internal
 */
export function writePlan({
  home,
  plan,
  stillHeld,
}: {
  readonly home: string;
  readonly plan: RepointPlan;
  readonly stillHeld: () => boolean;
}): Result<void, RepointRunError> {
  if (!stillHeld()) {
    return err(RepointRunErrors.lockLostBeforeHistory());
  }
  const recorded = recordOwnRepository({ home, repository: plan.afterRepository });
  if (recorded.isErr()) {
    return err(RepointRunErrors.historyUnwritten({ cause: recorded.error.message }));
  }
  const path = join(stateHomePaths({ home }).live.recipe.definitionsDir, plan.file);
  if (!stillHeld()) {
    return err(RepointRunErrors.lockLostBeforeRow({ repository: plan.afterRepository }));
  }
  try {
    writeFileAtomic({ contents: plan.contents, path });
  } catch (cause) {
    return err(
      RepointRunErrors.rowUnwritten({
        cause: errorMessage({ error: cause }),
        file: plan.file,
        repository: plan.afterRepository,
      }),
    );
  }
  return ok(undefined);
}

/** Say what moved, as a line or one JSON object. */
function report({
  deps,
  options,
  plan,
}: {
  readonly deps: RepointDeps;
  readonly options: RepointOptions;
  readonly plan: RepointPlan;
}): void {
  if (options.json) {
    const { afterRepository, beforeRepository, file, recipeId } = plan;
    const value = { afterRepository, beforeRepository, dryRun: options.dryRun, file, recipeId };
    deps.writeOut(safeJsonStringify({ label: "automation repoint", value }));
    return;
  }
  deps.writeOut(repointLine({ dryRun: options.dryRun, plan }));
}

/**
 * Report a repoint already written. The row and the history are on disk by now, so a report that cannot print (stdout
 * closed) is said on stderr and the run still exits 0: an exit 1 would tell the caller the store stood unchanged.
 */
function reportWritten({
  deps,
  options,
  plan,
}: {
  readonly deps: RepointDeps;
  readonly options: RepointOptions;
  readonly plan: RepointPlan;
}): number {
  try {
    report({ deps, options, plan });
  } catch (cause) {
    try {
      deps.writeDiagnostic(
        `${repointLine({ dryRun: false, plan })} — the report did not print on stdout (${errorMessage({ error: cause })})`,
      );
    } catch {
      // Both channels are closed. The write stands, so the exit code is the one thing left to say it.
    }
  }
  return EXIT_OK;
}

/**
 * Repoint one drifted own-repository row, or preview it.
 *
 * @param deps the injected edges
 * @param options the resolved invocation
 * @returns the process exit code
 */
export function repointAutomation({
  deps,
  options,
}: {
  readonly deps: RepointDeps;
  readonly options: RepointOptions;
}): number {
  const fail = ({ line }: { readonly line: string }): number => {
    deps.writeDiagnostic(`automation repoint · ${line}`);
    return EXIT_ERROR;
  };
  const escape = recipeTreeEscape({ home: options.home });
  if (escape !== null) {
    return fail({ line: escape });
  }
  if (options.dryRun) {
    const plan = planIn({ deps, options });
    if (plan.isErr()) {
      return fail({ line: plan.error.message });
    }
    report({ deps, options, plan: plan.value });
    return EXIT_OK;
  }
  const lock = acquireWaitingLock({
    home: options.home,
    key: RECIPE_DEFINITION_HOLDS_LOCK_KEY,
    nowIso: deps.now(),
    staleAfterMs: Number.POSITIVE_INFINITY,
  });
  if (lock.isErr()) {
    return fail({ line: `the definition hold lock is busy, nothing changed: ${lock.error}` });
  }
  try {
    const plan = planIn({ deps, options });
    if (plan.isErr()) {
      return fail({ line: plan.error.message });
    }
    const written = writePlan({ home: options.home, plan: plan.value, stillHeld: lock.value.stillHeld });
    if (written.isErr()) {
      return fail({ line: written.error.message });
    }
    return reportWritten({ deps, options, plan: plan.value });
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
export function runRecipeRepoint({
  argv,
  deps = productionRepointDeps(),
}: {
  readonly argv: readonly string[];
  readonly deps?: RepointDeps;
}): number {
  const rest = argv.slice(VERB_ARG_OFFSET);
  if (rest.includes("--help") || rest.includes("-h")) {
    deps.writeOut(RECIPE_REPOINT_USAGE);
    return EXIT_OK;
  }
  const options = parseRepointArgs({ defaultHome: slopweaverHome(), rest });
  if (options.isErr()) {
    recipeCommandErrorLines({ error: options.error }).forEach((line) => {
      deps.writeDiagnostic(line);
    });
    deps.writeDiagnostic(RECIPE_REPOINT_USAGE);
    return EXIT_USAGE;
  }
  return repointAutomation({ deps, options: options.value });
}

export const recipeRepointCommand = defineCommand({
  run: (argv) => runRecipeRepoint({ argv }),
});
