/**
 * `slopweaver automation propagate` — read, seat and close the ONE judgement pass every successful corpus resync
 * joins.
 *
 * The resync does the joining and, when no pass is open, the seating (`./propagateRun.ts`, `./propagateSeat.ts`). This verb is the
 * seated session's half: `--status` says which syncs the pass covers and what each already re-derived, and
 * `--done --batch <id> --through-revision <n>` confirms the pass through the revision it READ, so a sync that joined while it
 * worked is never acknowledged by a snapshot that did not see it. `--seat` opens the session by hand, for a
 * resync that ran outside a visible session or against another home.
 */
import { slopweaverHome } from "../../../homeDir.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { safeJsonStringify } from "../../../lib/safeJson.js";
import {
  completeThrough,
  type PropagationBatch,
  type PropagationRecord,
  pendingSyncs,
} from "../../../live/resync/propagationBatch.js";
import {
  readActiveBatch,
  readPropagationRecord,
  retireActiveBatch,
  writeActiveBatch,
} from "../../../live/resync/propagationStore.js";
import { stateHomePaths } from "../../../stateHome.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_DEFERRED, EXIT_ERROR, EXIT_EXPECTED_EMPTY, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { parseFlags } from "../../parseFlags.js";
import { RECIPE_PROPAGATE_FLAG_SPEC, RECIPE_PROPAGATE_USAGE } from "./core.js";
import { type RecipeCommandError, RecipeCommandErrors, recipeCommandErrorLines } from "./errors.js";
import { type CorpusPropagationDeps, productionCorpusPropagationDeps, surfaceLine } from "./propagateRun.js";
import { seatIfNeeded } from "./propagateSeat.js";

/** Where the flag tail starts: past the runtime, the script, the `recipe` noun and the `propagate` verb. */
const VERB_ARG_OFFSET = 4;

/** What one invocation asks for. */
export type PropagateAction =
  | { readonly kind: "status"; readonly json: boolean }
  | { readonly kind: "done"; readonly batchId: string; readonly through: number }
  | { readonly kind: "seat" };

/** The resolved invocation. */
export interface PropagateOptions {
  readonly action: PropagateAction;
  readonly home: string;
}

/** The injected edges: the propagation edges plus a diagnostic channel. */
export interface RecipePropagateDeps {
  readonly propagation: CorpusPropagationDeps;
  readonly writeDiagnostic: (line: string) => void;
}

/**
 * Parse this verb's own tail.
 *
 * @param rest the argv tail after `automation propagate`
 * @param defaultHome the home to use when the caller named none
 * @returns the resolved options, or every reason the invocation was rejected
 */
export function parseRecipePropagateArgs({
  rest,
  defaultHome,
}: {
  readonly rest: readonly string[];
  readonly defaultHome: string;
}): Result<PropagateOptions, RecipeCommandError> {
  const parsed = parseFlags({
    args: rest,
    spec: { boolean: [...RECIPE_PROPAGATE_FLAG_SPEC.boolean], string: [...RECIPE_PROPAGATE_FLAG_SPEC.string] },
  });
  if (parsed.isErr()) {
    return err(RecipeCommandErrors.flagsInvalid({ reasons: parsed.error }));
  }
  const values = parsed.value.values;
  const home = typeof values["home"] === "string" ? values["home"] : defaultHome;
  const chosen = (["status", "done", "seat"] as const).filter((name) => values[name] === true);
  const [only] = chosen;
  if (chosen.length !== 1 || only === undefined) {
    return err(RecipeCommandErrors.propagateModeMissing());
  }
  const json = values["json"] === true;
  const through = values["through-revision"];
  const batchId = values["batch"];
  if (only !== "status" && json) {
    return err(RecipeCommandErrors.propagateJsonWithoutStatus());
  }
  if (only !== "done" && (through !== undefined || batchId !== undefined)) {
    return err(RecipeCommandErrors.propagateRevisionWithoutDone());
  }
  if (only === "status") {
    return ok({ action: { json, kind: "status" }, home });
  }
  if (only === "seat") {
    return ok({ action: { kind: "seat" }, home });
  }
  if (typeof through !== "string" || !/^\d+$/.test(through)) {
    return err(RecipeCommandErrors.propagateRevisionMissing({ got: String(through) }));
  }
  if (typeof batchId !== "string" || batchId === "") {
    return err(RecipeCommandErrors.propagateBatchMissing());
  }
  return ok({ action: { batchId, kind: "done", through: Number(through) }, home });
}

/**
 * Run the verb.
 *
 * @param argv the whole process argv, as the CLI received it
 * @param deps the injected edges; omitted takes the production ones
 * @returns the process exit code
 */
export async function runRecipePropagate({
  argv,
  deps = {
    propagation: productionCorpusPropagationDeps(),
    writeDiagnostic: (line) => process.stderr.write(`${line}\n`),
  },
}: {
  readonly argv: readonly string[];
  readonly deps?: RecipePropagateDeps;
}): Promise<number> {
  const rest = argv.slice(VERB_ARG_OFFSET);
  if (rest.includes("--help") || rest.includes("-h")) {
    deps.propagation.writeOut(RECIPE_PROPAGATE_USAGE);
    return EXIT_OK;
  }
  const options = parseRecipePropagateArgs({ defaultHome: slopweaverHome(), rest });
  if (options.isErr()) {
    recipeCommandErrorLines({ error: options.error }).forEach((line) => {
      deps.writeDiagnostic(line);
    });
    deps.writeDiagnostic(RECIPE_PROPAGATE_USAGE);
    return EXIT_USAGE;
  }
  const { action, home } = options.value;
  if (action.kind === "status") {
    return printStatus({ deps, home, json: action.json });
  }
  const outcome = await deps.propagation.withBatchLock({
    home,
    run: () =>
      action.kind === "done"
        ? Promise.resolve(confirmPass({ batchId: action.batchId, home, through: action.through }))
        : seatPass({ deps, home }),
  });
  if (outcome.isErr()) {
    deps.writeDiagnostic(`automation propagate: the batch lock was not taken — ${outcome.error}`);
    return EXIT_ERROR;
  }
  const [first, ...lines] = outcome.value;
  lines.forEach((line) => {
    deps.propagation.writeOut(line);
  });
  return exitOfLead({ lead: first });
}

/** The first line of a locked run carries its exit code, so the lock's report type stays a plain line list. */
const LEAD_EXIT: Readonly<Record<string, number>> = {
  deferred: EXIT_DEFERRED,
  empty: EXIT_EXPECTED_EMPTY,
  error: EXIT_ERROR,
  ok: EXIT_OK,
};

/**
 * The exit code a locked run's lead line names.
 *
 * @param lead the first line, one of {@link LEAD_EXIT}'s keys
 * @returns the exit code
 */
function exitOfLead({ lead }: { readonly lead: string | undefined }): number {
  if (lead === undefined) {
    return EXIT_ERROR;
  }
  const code = LEAD_EXIT[lead];
  if (code === undefined) {
    return EXIT_ERROR;
  }
  return code;
}

/**
 * Confirm the open pass through one revision, retiring it when nothing is left pending. Holds the batch lock.
 *
 * @param home the state home
 * @param batchId the batch the pass read
 * @param through the revision the pass read
 * @returns the lead line, then the lines to print
 */
function confirmPass({
  home,
  batchId,
  through,
}: {
  readonly home: string;
  readonly batchId: string;
  readonly through: number;
}): string[] {
  const dir = stateHomePaths({ home }).live.recipe.propagationDir;
  const active = readActiveBatch({ dir });
  if (active.isErr()) {
    return ["error", active.error.message];
  }
  if (active.value === null) {
    return ["empty", "automation propagate · no pass is open, so there is nothing to confirm"];
  }
  const completed = completeThrough({ batch: active.value, batchId, through });
  if (completed.isErr()) {
    return ["error", completed.error.message];
  }
  const { batch, remaining } = completed.value;
  if (remaining.length === 0) {
    const retired = retireActiveBatch({ batch, dir });
    if (retired.isErr()) {
      return ["error", retired.error.message];
    }
    return [
      "ok",
      `automation propagate · ${batch.seat.slug} confirmed through revision ${String(through)}, nothing pending — retired to ${retired.value}`,
    ];
  }
  const saved = writeActiveBatch({ batch, dir });
  if (saved.isErr()) {
    return ["error", saved.error.message];
  }
  return [
    "ok",
    `automation propagate · ${batch.seat.slug} confirmed through revision ${String(through)}, but ${String(remaining.length)} sync(s) joined after it — read \`automation propagate --status\` and cover them too`,
    ...remaining.map((sync) => `  r${String(sync.revision)} ${sync.recipeId} synced ${sync.syncFinishedAtIso}`),
  ];
}

/**
 * Open the pass's session by hand. Holds the batch lock.
 *
 * @param home the state home
 * @param deps the injected edges
 * @returns the lead line, then the lines to print
 */
async function seatPass({
  home,
  deps,
}: {
  readonly home: string;
  readonly deps: RecipePropagateDeps;
}): Promise<string[]> {
  const dir = stateHomePaths({ home }).live.recipe.propagationDir;
  const active = readActiveBatch({ dir });
  if (active.isErr()) {
    return ["error", active.error.message];
  }
  if (active.value === null) {
    return ["empty", "automation propagate · no pass is open, so there is nothing to seat"];
  }
  const report = await seatIfNeeded({
    batch: active.value,
    deps: deps.propagation,
    dir,
    home,
    nowIso: deps.propagation.now(),
  });
  const reported = report.lines.map((line) => `automation propagate · ${line}`);
  // A spawn the fleet-wide backoff deferred is NOT YET, whether or not its marker saved: the batch stays unseated
  // and the next attempt seats it.
  if (report.deferred) {
    return ["deferred", ...reported];
  }
  // The batch as written after the attempt is the verdict, never the wording of the lines reporting it.
  const after = readActiveBatch({ dir });
  const written = after.isOk() ? after.value : null;
  if (written !== null && written.seat.seatedAtIso !== null) {
    return ["ok", ...reported];
  }
  return ["error", ...reported];
}

/**
 * Print the open pass, read-only.
 *
 * @param home the state home
 * @param json whether to emit one document instead of lines
 * @param deps the injected edges
 * @returns the exit code — 3 when no pass is open
 */
function printStatus({
  home,
  json,
  deps,
}: {
  readonly home: string;
  readonly json: boolean;
  readonly deps: RecipePropagateDeps;
}): number {
  const dir = stateHomePaths({ home }).live.recipe.propagationDir;
  const active = readActiveBatch({ dir });
  if (active.isErr()) {
    deps.writeDiagnostic(active.error.message);
    return EXIT_ERROR;
  }
  const batch = active.value;
  if (batch === null) {
    if (json) {
      deps.propagation.writeOut(safeJsonStringify({ label: "propagate status", value: { batch: null, records: [] } }));
    } else {
      deps.propagation.writeOut("automation propagate · no pass is open");
    }
    return EXIT_EXPECTED_EMPTY;
  }
  const records: PropagationRecord[] = [];
  for (const sync of batch.covered) {
    const read = readPropagationRecord({ dir, propagationId: sync.propagationId });
    if (read.isErr()) {
      deps.writeDiagnostic(read.error.message);
      continue;
    }
    records.push(read.value);
  }
  if (json) {
    deps.propagation.writeOut(safeJsonStringify({ label: "propagate status", value: { batch, records } }));
    return EXIT_OK;
  }
  statusLines({ batch, records }).forEach((line) => {
    deps.propagation.writeOut(line);
  });
  return EXIT_OK;
}

/**
 * The open pass as lines: its seat, its revision, and each covered sync with what it re-derived.
 *
 * @param batch the open batch
 * @param records the covered syncs' records that could be read
 * @returns the lines
 */
export function statusLines({
  batch,
  records,
}: {
  readonly batch: PropagationBatch;
  readonly records: readonly PropagationRecord[];
}): readonly string[] {
  let seat = `seated ${String(batch.seat.seatedAtIso)}`;
  if (batch.seat.seatedAtIso === null) {
    seat = batch.seat.lastProblem === null ? "NOT seated" : `NOT seated (${batch.seat.lastProblem})`;
  }
  const pending = pendingSyncs({ batch });
  const lines = [
    `automation propagate · pass ${batch.seat.slug} · revision ${String(batch.revision)}, confirmed through ${String(batch.doneThrough)} · ${seat}`,
    `  ${String(pending.length)} sync(s) pending — confirm with \`slopweaver automation propagate --done --batch ${batch.batchId} --through-revision ${String(batch.revision)}\``,
  ];
  for (const sync of pending) {
    lines.push(`  r${String(sync.revision)} ${sync.recipeId} · synced ${sync.syncFinishedAtIso}`);
    const record = records.find((candidate) => candidate.propagationId === sync.propagationId);
    if (record === undefined) {
      lines.push("    its propagation record could not be read");
      continue;
    }
    record.surfaces.forEach((outcome) => {
      lines.push(`    ${surfaceLine({ outcome })}`);
    });
  }
  return lines;
}

export const recipePropagateCommand = defineCommand({ run: (argv) => runRecipePropagate({ argv }) });
