/**
 * `slopweaver automation retire <recipeId> --anchor <a> --words <w> --why <why>` — take one declared standing row off
 * THIS install for good, on the owner's word, and `--undo` to give it back.
 *
 * A declared row the owner will never use on this computer is turned off, even removed, while the same build on
 * another machine may want it. Deleting a definition file is the defect `automation
 * due` shouts about and `register-standing` repairs, and an owner hold leaves the row on every page; so the decision
 * is recorded as install state the declaration subtracts (`live/automation/retirementStore.ts`).
 *
 * ## The order of the two writes is the safety property
 *
 * Under the definition hold lock — the one `register-standing` and every hold writer take — the registry is written
 * FIRST and the canonical `<recipeId>.json` removed SECOND. A crash between them leaves a retired row whose file
 * still stands: no reader resurrects it, and a repeat run converges by removing the file. The other order would
 * leave a deleted file and no retirement, which `register-standing` writes straight back.
 *
 * ## What it does not do
 *
 * It does not cancel a firing already running, delete run history, or settle a board finding the row filed — that is
 * the seat's to settle with its own witness. It clears the row's owed finding DEBT, because a debt is a retry
 * obligation for a row that no longer exists, and `automation run-due` skips a retired row's debt besides.
 */
import { rmSync } from "node:fs";
import { join } from "node:path";

import { logger } from "#lib/logger.js";
import { err, ok, type Result } from "#lib/result.js";
import { type RawWords, resolveRawWords } from "../../../handover/hisWordsResolve.js";
import { slopweaverHome } from "../../../homeDir.js";
import { errorMessage } from "../../../lib/errorMessage.js";
import { declaredStandingRows } from "../../../live/automation/declaredStandingRows.js";
import { loadRecipeDefinitions } from "../../../live/automation/definitionStore.js";
import { RECIPE_DEFINITION_HOLDS_LOCK_KEY } from "../../../live/automation/failureHoldStore.js";
import { clearFindingDebt, readFindingDebts } from "../../../live/automation/findingDebt.js";
import {
  AutomationRetirementRuleErrors,
  declaredForRetirement,
  retirementFromWords,
  retirementTarget,
} from "../../../live/automation/retirement.js";
import {
  type AutomationRetirement,
  addAutomationRetirement,
  readAutomationRetirements,
  removeAutomationRetirement,
  writeAutomationRetirements,
} from "../../../live/automation/retirementStore.js";
import { acquireWaitingLock } from "../../../live/automation/waitingLock.js";
import { stateHomePaths } from "../../../stateHome.js";
import { claudeHomeDir } from "../../../supervisor/chairRead.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { recipeCommandErrorLines } from "./errors.js";
import { parseRetireArgs, type RetireOptions } from "./retireArgs.js";
import { recipeTreeEscape } from "./retireHomeCheck.js";
import { RECIPE_RETIRE_USAGE } from "./retireUsage.js";

/** Where the flag tail starts: past the runtime, the script, the `automation` noun and the `retire` verb. */
const VERB_ARG_OFFSET = 4;

/** The injected edges, so the verb is tested over a real temporary home with plain fakes. */
export interface RetireDeps {
  readonly now: () => string;
  readonly writeOut: (line: string) => void;
  readonly writeDiagnostic: (line: string) => void;
  /** The owner's record's whole text at one anchor, or why it could not be read. */
  readonly readRecord: (options: { readonly anchor: string; readonly home: string }) => Result<string, string>;
}

/**
 * The owner's record text, only when it holds every word they said there: a record cut at either end, or one that does
 * not say whether it was, may hold the "no, keep it" beside the words a retirement quotes.
 *
 * @param raw the record as the shared resolver read it
 * @returns the whole text, or why the record cannot stand as the owner's word
 */
export function wholeRecordText({ raw }: { raw: RawWords }): Result<string, string> {
  const cut = raw.headLost || raw.tailLost;
  const unknown = !raw.headKnown || !raw.tailKnown;
  if (cut || unknown) {
    const why = cut ? "holds only part of what the owner said there" : "predates saying whether the words were cut";
    return err(`the record ${why} — name the call's own stretch instead`);
  }
  return ok(raw.text);
}

/**
 * The real edges.
 *
 * @returns the production dependencies
 * @internal
 */
export function productionRetireDeps(): RetireDeps {
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

/** Clear every owed finding debt of one recipe, answering the lines a reader should see for what did not clear. */
function clearDebtsOf({ home, recipeId }: { readonly home: string; readonly recipeId: string }): readonly string[] {
  return readFindingDebts({ home })
    .debts.filter((debt) => debt.recipeId === recipeId)
    .flatMap((debt) => {
      const cleared = clearFindingDebt({ finding: debt.finding, home });
      return cleared.isErr() ? [`owed finding ${debt.finding} did not clear: ${cleared.error.message}`] : [];
    });
}

/** Remove the canonical definition file, or say why it is still there. */
function removeDefinition({ home, file }: { readonly home: string; readonly file: string }): Result<void, string> {
  try {
    rmSync(join(stateHomePaths({ home }).live.recipe.definitionsDir, file));
    return ok(undefined);
  } catch (cause) {
    return err(errorMessage({ error: cause }));
  }
}

/** Every standing row the home declares, retired ones included — what a retirement may name. */
function declaredUniverse({ home }: { readonly home: string }): Result<readonly string[], string> {
  return declaredStandingRows({ home })
    .map((declared) => declared.universe.map((row) => row.definition.recipeId))
    .mapErr((error) => error.message);
}

/** The definition file a retirement removes, read under the lock — `null` when this install has none. */
function definitionTarget({
  home,
  recipeId,
}: {
  readonly home: string;
  readonly recipeId: string;
}): Result<string | null, string> {
  const store = loadRecipeDefinitions({ board: null, directory: stateHomePaths({ home }).live.recipe.definitionsDir });
  return retirementTarget({
    definitionFiles: store.definitionFiles,
    definitionIds: store.definitions.map((definition) => definition.recipeId),
    recipeId,
    rejected: store.rejected.map((rejection) => ({ file: rejection.file, why: rejection.error.message })),
  }).mapErr((error) => error.message);
}

/** The owner's retirement entry, checked against the declaration and composed off the owner's record — read BEFORE the lock. */
function composeRetirement({
  declaredIds,
  deps,
  options,
}: {
  readonly declaredIds: readonly string[];
  readonly deps: RetireDeps;
  readonly options: Extract<RetireOptions, { kind: "retire" }>;
}): Result<AutomationRetirement, string> {
  const declared = declaredForRetirement({ declaredIds, recipeId: options.recipeId });
  if (declared.isErr()) {
    return err(declared.error.message);
  }
  const record = deps.readRecord({ anchor: options.anchor, home: options.home });
  if (record.isErr()) {
    return err(`their record at ${options.anchor} did not read: ${record.error}`);
  }
  return retirementFromWords({
    anchor: options.anchor,
    recipeId: options.recipeId,
    recordText: record.value,
    retiredAtIso: deps.now(),
    why: options.why,
    words: options.words,
  }).mapErr((error) => error.message);
}

/** The retirement, the lock held. */
function retireLocked({
  deps,
  options,
  entry,
}: {
  readonly deps: RetireDeps;
  readonly options: Extract<RetireOptions, { kind: "retire" }>;
  readonly entry: AutomationRetirement;
}): number {
  const fail = ({ line }: { readonly line: string }): number => {
    deps.writeDiagnostic(`automation retire · ${line}`);
    return EXIT_ERROR;
  };
  const current = readAutomationRetirements({ home: options.home });
  if (current.isErr()) {
    return fail({ line: current.error.message });
  }
  const target = definitionTarget({ home: options.home, recipeId: options.recipeId });
  if (target.isErr()) {
    return fail({ line: target.error });
  }
  const added = addAutomationRetirement({ current: current.value.retirements, retirement: entry });
  if (added.added) {
    const written = writeAutomationRetirements({ home: options.home, retirements: added.retirements });
    if (written.isErr()) {
      return fail({ line: `${written.error.message} — nothing retired` });
    }
  }
  const debtLines = clearDebtsOf({ home: options.home, recipeId: options.recipeId });
  const removed = target.value === null ? ok(undefined) : removeDefinition({ file: target.value, home: options.home });
  const standing = added.retirements.find((retirement) => retirement.recipeId === options.recipeId)!;
  const head = added.added ? "RETIRED" : "ALREADY RETIRED";
  deps.writeOut(
    `automation retire · ${head} ${options.recipeId} on this install · on ${standing.anchor} ("${standing.words}") · ${standing.why}`,
  );
  if (removed.isErr()) {
    return fail({
      line:
        `${options.recipeId} is retired, but its definition ${String(target.value)} did not remove (${removed.error}) ` +
        "— every firing reader rejects it as retired; run this again to remove the file",
    });
  }
  deps.writeOut(
    target.value === null
      ? `automation retire · ${options.recipeId} had no definition file on this install`
      : `automation retire · removed ${target.value}; a firing already running is not cancelled`,
  );
  debtLines.forEach((line) => {
    deps.writeDiagnostic(`automation retire · ${line}`);
  });
  return debtLines.length > 0 ? EXIT_ERROR : EXIT_OK;
}

/** The undo, the lock held. */
function undoLocked({
  deps,
  options,
}: {
  readonly deps: RetireDeps;
  readonly options: Extract<RetireOptions, { kind: "undo" }>;
}): number {
  const fail = ({ line }: { readonly line: string }): number => {
    deps.writeDiagnostic(`automation retire --undo · ${line}`);
    return EXIT_ERROR;
  };
  const current = readAutomationRetirements({ home: options.home });
  if (current.isErr()) {
    return fail({ line: current.error.message });
  }
  const removed = removeAutomationRetirement({ current: current.value.retirements, recipeId: options.recipeId });
  if (removed.removed === null) {
    return fail({ line: AutomationRetirementRuleErrors.notRetired({ recipeId: options.recipeId }).message });
  }
  // Cleared BEFORE the entry goes, so an old failure cannot come back as fresh finding debt the moment it does.
  const debtLines = clearDebtsOf({ home: options.home, recipeId: options.recipeId });
  if (debtLines.length > 0) {
    return fail({ line: `${debtLines.join("; ")} — still retired` });
  }
  const written = writeAutomationRetirements({ home: options.home, retirements: removed.retirements });
  if (written.isErr()) {
    return fail({ line: `${written.error.message} — still retired` });
  }
  deps.writeOut(
    `automation retire --undo · UNRETIRED ${options.recipeId} · its definition stays absent until ` +
      "`slopweaver automation register-standing` writes the build's current row back",
  );
  return EXIT_OK;
}

/**
 * Retire one declared standing row on this install, or undo a retirement.
 *
 * The owner's record is resolved BEFORE the lock, so a slow read never holds every hold writer up; everything the write
 * depends on is re-read under it.
 *
 * @param deps the injected edges
 * @param options the resolved invocation
 * @returns the process exit code
 */
export function retireAutomation({
  deps,
  options,
}: {
  readonly deps: RetireDeps;
  readonly options: RetireOptions;
}): number {
  const escape = recipeTreeEscape({ home: options.home });
  if (escape !== null) {
    deps.writeDiagnostic(`automation retire · ${escape}`);
    return EXIT_ERROR;
  }
  const universe = declaredUniverse({ home: options.home });
  if (universe.isErr()) {
    deps.writeDiagnostic(`automation retire · ${universe.error}`);
    return EXIT_ERROR;
  }
  let entry: AutomationRetirement | undefined;
  if (options.kind === "retire") {
    const composed = composeRetirement({ declaredIds: universe.value, deps, options });
    if (composed.isErr()) {
      deps.writeDiagnostic(`automation retire · ${composed.error}`);
      return EXIT_ERROR;
    }
    entry = composed.value;
  }
  // Never taken over from a LIVE holder, however old: a `register-standing` pass paused past the lock's default
  // staleness still holds the declaration it read before this retirement, and would write the row straight back.
  // A dead holder is still reclaimed.
  const lock = acquireWaitingLock({
    home: options.home,
    key: RECIPE_DEFINITION_HOLDS_LOCK_KEY,
    nowIso: deps.now(),
    staleAfterMs: Number.POSITIVE_INFINITY,
  });
  if (lock.isErr()) {
    deps.writeDiagnostic(`automation retire · the definition hold lock is busy, nothing changed: ${lock.error}`);
    return EXIT_ERROR;
  }
  try {
    if (options.kind === "undo") {
      return undoLocked({ deps, options });
    }
    return retireLocked({ deps, entry: entry!, options });
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
export function runRecipeRetire({
  argv,
  deps = productionRetireDeps(),
}: {
  readonly argv: readonly string[];
  readonly deps?: RetireDeps;
}): number {
  const rest = argv.slice(VERB_ARG_OFFSET);
  if (rest.includes("--help") || rest.includes("-h")) {
    deps.writeOut(RECIPE_RETIRE_USAGE);
    return EXIT_OK;
  }
  const options = parseRetireArgs({ defaultHome: slopweaverHome(), rest });
  if (options.isErr()) {
    recipeCommandErrorLines({ error: options.error }).forEach((line) => {
      deps.writeDiagnostic(line);
    });
    deps.writeDiagnostic(RECIPE_RETIRE_USAGE);
    return EXIT_USAGE;
  }
  return retireAutomation({ deps, options: options.value });
}

export const recipeRetireCommand = defineCommand({
  run: (argv) => runRecipeRetire({ argv }),
});
