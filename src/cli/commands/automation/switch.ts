/**
 * `slopweaver automation enable|disable <recipeId> --anchor <a> --words <w> --why <why> [--dry-run]` — turn ONE
 * automation on or off, on the owner's word, without anyone editing the definition store by hand.
 *
 * `enabled` is one boolean on a definition, and `automation due` prints `OFF · disabled` for a row whose boolean is
 * false. The store is never edited by hand, so a switch is that one edit as a verb: the owner's words checked against
 * their record, the change PRINTED before it is written, ONE key written under the definition hold lock, and one
 * journal line naming who asked
 * (`live/automation/rowSwitchStore.ts`). The rules are `live/automation/rowSwitch.ts`.
 *
 * ## Order
 *
 * The owner's record is resolved BEFORE the lock, so a slow transcript read never holds every hold writer up. The row
 * is then judged WITHOUT the lock, because taking it writes lock state into the home: a refusal, a row already in that
 * state and a dry run end there having written nothing. Only a switch that will write takes the lock, and everything
 * the write depends on — the retirement registry, the store's view of the file, the file itself — is re-read under it. The definition is written FIRST and the journal appended SECOND: the definition is the state,
 * and a journal line for a write that never landed would be a false record. An append that fails after the write
 * exits 1 and says the switch landed unjournalled, so a reader is never left believing the journal is whole.
 *
 * ## What it does not do
 *
 * It does not lift a hold — enabling a held row is refused, because the hold outranks `enabled` and the row would stay
 * OFF. It does not cancel a firing already running, nor claim, seat or run the row. It does not touch the build's
 * DECLARATION: `register-standing` creates only into an empty path, and `register-resyncs` and `store backup register`
 * carry the stored `enabled` through every re-derived row (`live/resync/managedRowFields.ts#withOperatorFields`), so a
 * switched install row is left as it stands.
 */
import { join } from "node:path";

import { logger } from "#lib/logger.js";
import { err, type Result } from "#lib/result.js";
import { resolveRawWords } from "../../../handover/hisWordsResolve.js";
import { slopweaverHome } from "../../../homeDir.js";
import type { RecipeDefinition } from "../../../live/automation/definition.js";
import { loadRecipeDefinitions } from "../../../live/automation/definitionStore.js";
import { holdStands } from "../../../live/automation/failureHold.js";
import {
  RECIPE_DEFINITION_HOLDS_LOCK_KEY,
  recipeBoardOf,
  withFindingState,
} from "../../../live/automation/failureHoldStore.js";
import { readAutomationRetirements, retiredRecipeIds } from "../../../live/automation/retirementStore.js";
import {
  type AutomationSwitch,
  type AutomationSwitchRuleError,
  AutomationSwitchRuleErrors,
  planSwitch,
  type SwitchDirection,
  type SwitchPlan,
  switchFromWords,
  switchTarget,
} from "../../../live/automation/rowSwitch.js";
import {
  appendAutomationSwitch,
  readDefinitionForSwitch,
  writeDefinitionEnabled,
} from "../../../live/automation/rowSwitchStore.js";
import { acquireWaitingLock } from "../../../live/automation/waitingLock.js";
import { stateHomePaths } from "../../../stateHome.js";
import { claudeHomeDir } from "../../../supervisor/chairRead.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { recipeCommandErrorLines } from "./errors.js";
import { wholeRecordText } from "./retire.js";
import { recipeTreeEscape } from "./retireHomeCheck.js";
import { parseSwitchArgs, type SwitchOptions } from "./switchArgs.js";
import { RECIPE_DISABLE_USAGE, RECIPE_ENABLE_USAGE } from "./switchUsage.js";

/** Where the flag tail starts: past the runtime, the script, the `automation` noun and the verb. */
const VERB_ARG_OFFSET = 4;

/** The injected edges, so the verb is tested over a real temporary home with plain fakes. */
export interface SwitchDeps {
  readonly now: () => string;
  readonly writeOut: (line: string) => void;
  readonly writeDiagnostic: (line: string) => void;
  /** The owner's record's whole text at one anchor, or why it could not be read. */
  readonly readRecord: (options: { readonly anchor: string; readonly home: string }) => Result<string, string>;
}

/**
 * The real edges.
 *
 * @returns the production dependencies
 * @internal
 */
export function productionSwitchDeps(): SwitchDeps {
  return {
    now: () => new Date().toISOString(),
    readRecord: ({ anchor, home }) =>
      resolveRawWords({ anchor, home, projectsDir: join(claudeHomeDir(), "projects") })
        .mapErr((error) => error.message)
        .andThen((raw) => wholeRecordText({ raw })),
    writeDiagnostic: (line) => process.stderr.write(`${line}\n`),
    writeOut: (line) => {
      logger.out({ line });
    },
  };
}

/** What `automation due` reads for the row once the switch lands. */
function afterLine({
  enabled,
  cadence,
  held,
}: {
  readonly enabled: boolean;
  readonly cadence: string;
  readonly held: boolean;
}): string {
  if (enabled) {
    return `\`automation due\` then reads it on its cadence \`${cadence}\``;
  }
  if (held) {
    return "`automation due` still reads it OFF · HELD, and it stays off once that hold lifts";
  }
  return "`automation due` then reads it OFF · disabled";
}

/** The canonical file to write, judged under the lock against the registry and the store. */
function lockedTarget({
  home,
  recipeId,
}: {
  readonly home: string;
  readonly recipeId: string;
}): Result<string, AutomationSwitchRuleError> {
  const retirements = readAutomationRetirements({ home });
  if (retirements.isErr()) {
    return err(AutomationSwitchRuleErrors.retirementsUnreadable({ detail: retirements.error.message }));
  }
  const store = loadRecipeDefinitions({ board: null, directory: stateHomePaths({ home }).live.recipe.definitionsDir });
  return switchTarget({
    definitionFiles: store.definitionFiles,
    definitionIds: store.definitions.map((definition) => definition.recipeId),
    recipeId,
    rejected: store.rejected.map((rejection) => ({ file: rejection.file, why: rejection.error.message })),
    retired: retiredRecipeIds({ retirements: retirements.value.retirements }).has(recipeId),
  }).map((file) => join(stateHomePaths({ home }).live.recipe.definitionsDir, file));
}

/** What an unlocked read answers when the switch WOULD write: take the lock and judge it all again under it. */
const WRITE_OWED = "write-owed";

/** Every read a switch's verdict depends on: the file, the object it holds, the row it parses to, and the plan. */
interface JudgedSwitch {
  readonly path: string;
  readonly raw: Record<string, unknown>;
  readonly definition: RecipeDefinition;
  readonly plan: SwitchPlan;
}

/** The file found, read and planned against, or the message of the first read or rule that refused it. */
function judgeSwitch({ options }: { readonly options: SwitchOptions }): Result<JudgedSwitch, string> {
  const { home, recipeId, direction } = options;
  return lockedTarget({ home, recipeId })
    .mapErr((error) => error.message)
    .andThen((path) =>
      readDefinitionForSwitch({ path, recipeId })
        .mapErr((error) => error.message)
        .andThen((read) => {
          // Lifted, so a failure hold whose fix has landed reads as no hold, exactly as `automation due` reads it.
          const definition = withFindingState({ board: recipeBoardOf({ home }), definition: read.definition });
          return planSwitch({ definition, direction })
            .mapErr((error) => error.message)
            .map((plan) => ({ definition, path, plan, raw: read.raw }));
        }),
    );
}

/** Print the change, then write it and journal it, or stop at the print on a dry run. */
function writeSwitch({
  deps,
  options,
  entry,
  judged,
  change,
}: {
  readonly deps: SwitchDeps;
  readonly options: SwitchOptions;
  readonly entry: AutomationSwitch;
  readonly judged: JudgedSwitch;
  readonly change: Extract<SwitchPlan, { readonly kind: "switch" }>;
}): number {
  const verb = `automation ${options.direction}`;
  const { hold, cadence } = judged.definition;
  const after = afterLine({ cadence, enabled: change.to, held: hold !== undefined && holdStands({ hold }) });
  const word = `on ${entry.anchor} ("${entry.words}") · ${entry.why}`;
  deps.writeOut(`${verb} · ${options.recipeId} · enabled: ${change.from} → ${change.to} · ${word}`);
  if (options.dryRun) {
    deps.writeOut(`${verb} · dry run: nothing written; once written, ${after}`);
    return EXIT_OK;
  }
  const written = writeDefinitionEnabled({ enabled: change.to, path: judged.path, raw: judged.raw });
  if (written.isErr()) {
    deps.writeDiagnostic(`${verb} · ${written.error.message}`);
    return EXIT_ERROR;
  }
  const journalled = appendAutomationSwitch({ entry, home: options.home });
  if (journalled.isErr()) {
    deps.writeDiagnostic(
      `${verb} · ${options.recipeId} IS switched, but the journal did not take its line: ${journalled.error.message}`,
    );
    return EXIT_ERROR;
  }
  deps.writeOut(`${verb} · ${change.to ? "ENABLED" : "DISABLED"} ${options.recipeId} · ${after}`);
  return EXIT_OK;
}

/**
 * One switch judged over the store. Unlocked, it settles every case that writes nothing — a refusal, a row already in
 * that state, a dry run — and answers {@link WRITE_OWED} for the rest; taking the lock writes lock state into the home,
 * so a switch that writes nothing must never take it. Locked, it re-reads everything and writes.
 */
function switchRow({
  deps,
  options,
  entry,
  locked,
}: {
  readonly deps: SwitchDeps;
  readonly options: SwitchOptions;
  readonly entry: AutomationSwitch;
  readonly locked: boolean;
}): number | typeof WRITE_OWED {
  const verb = `automation ${options.direction}`;
  const judged = judgeSwitch({ options });
  if (judged.isErr()) {
    deps.writeDiagnostic(`${verb} · ${judged.error}`);
    return EXIT_ERROR;
  }
  const { plan } = judged.value;
  if (plan.kind === "already") {
    deps.writeOut(
      `${verb} · ALREADY ${plan.enabled ? "ENABLED" : "DISABLED"} ${options.recipeId} · nothing written, ` +
        "nothing journalled",
    );
    return EXIT_OK;
  }
  if (!locked && !options.dryRun) {
    return WRITE_OWED;
  }
  return writeSwitch({ change: plan, deps, entry, judged: judged.value, options });
}

/**
 * Switch one automation on or off.
 *
 * @param deps the injected edges
 * @param options the resolved invocation
 * @returns the process exit code
 */
export function switchAutomation({
  deps,
  options,
}: {
  readonly deps: SwitchDeps;
  readonly options: SwitchOptions;
}): number {
  const verb = `automation ${options.direction}`;
  const escape = recipeTreeEscape({ home: options.home });
  if (escape !== null) {
    deps.writeDiagnostic(`${verb} · ${escape}`);
    return EXIT_ERROR;
  }
  const record = deps.readRecord({ anchor: options.anchor, home: options.home });
  if (record.isErr()) {
    deps.writeDiagnostic(`${verb} · their record at ${options.anchor} did not read: ${record.error}`);
    return EXIT_ERROR;
  }
  const entry = switchFromWords({
    anchor: options.anchor,
    enabled: options.direction === "enable",
    recipeId: options.recipeId,
    recordText: record.value,
    switchedAtIso: deps.now(),
    why: options.why,
    words: options.words,
  });
  if (entry.isErr()) {
    deps.writeDiagnostic(`${verb} · ${entry.error.message}`);
    return EXIT_ERROR;
  }
  // Unlocked first, so a refusal, a row already in that state and a dry run never take the lock that writes state.
  const unlocked = switchRow({ deps, entry: entry.value, locked: false, options });
  if (unlocked !== WRITE_OWED) {
    return unlocked;
  }
  // Never taken over from a LIVE holder, however old, exactly as `automation retire` takes it: a registrar paused
  // past the lock's default staleness still holds the file it read. A dead holder is still reclaimed.
  const lock = acquireWaitingLock({
    home: options.home,
    key: RECIPE_DEFINITION_HOLDS_LOCK_KEY,
    nowIso: deps.now(),
    staleAfterMs: Number.POSITIVE_INFINITY,
  });
  if (lock.isErr()) {
    deps.writeDiagnostic(`${verb} · the definition hold lock is busy, nothing changed: ${lock.error}`);
    return EXIT_ERROR;
  }
  try {
    const outcome = switchRow({ deps, entry: entry.value, locked: true, options });
    // Locked, the row always reaches its write or its refusal; `WRITE_OWED` is an unlocked answer only.
    return outcome === WRITE_OWED ? EXIT_ERROR : outcome;
  } finally {
    lock.value.release();
  }
}

/**
 * One direction's entry point.
 *
 * @param argv the whole process argv
 * @param direction which verb was typed
 * @param deps the injected edges; omitted takes the production ones
 * @returns the process exit code
 */
export function runRecipeSwitch({
  argv,
  direction,
  deps = productionSwitchDeps(),
}: {
  readonly argv: readonly string[];
  readonly direction: SwitchDirection;
  readonly deps?: SwitchDeps;
}): number {
  const usage = direction === "enable" ? RECIPE_ENABLE_USAGE : RECIPE_DISABLE_USAGE;
  const rest = argv.slice(VERB_ARG_OFFSET);
  if (rest.includes("--help") || rest.includes("-h")) {
    deps.writeOut(usage);
    return EXIT_OK;
  }
  const options = parseSwitchArgs({ defaultHome: slopweaverHome(), direction, rest });
  if (options.isErr()) {
    recipeCommandErrorLines({ error: options.error }).forEach((line) => {
      deps.writeDiagnostic(line);
    });
    deps.writeDiagnostic(usage);
    return EXIT_USAGE;
  }
  return switchAutomation({ deps, options: options.value });
}

export const recipeEnableCommand = defineCommand({
  run: (argv) => runRecipeSwitch({ argv, direction: "enable" }),
});

export const recipeDisableCommand = defineCommand({
  run: (argv) => runRecipeSwitch({ argv, direction: "disable" }),
});
