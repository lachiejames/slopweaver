/**
 * `slopweaver machine dispatches` — read the anomalous-load finding register, and SETTLE a row with the
 * witness that closed it.
 *
 * The read half is what a session runs when `supervisor tick-record` refuses, or when the briefing's machine
 * line says an investigation is open: it prints each row's triggers, its culprit and the culprit's tree, and
 * what the fleet did about it. The tree lives HERE rather than in the briefing on purpose — rule 7, concise
 * above the fold, everything else behind something the reader chooses to open.
 *
 * The settle half is the only way a row stops being open, which is what makes it an obligation rather than a
 * log line: an unsettled signature keeps the gate refusing and keeps `../../../live/machine/backoff.ts`
 * doubling. `--witness` is mandatory and is a free-text observation — what you actually found — because a
 * settlement with no witness is the silent close this register exists to prevent.
 */
import { slopweaverHome } from "../../../config.js";
import { type Logger, logger } from "../../../lib/logger.js";
import { type DispatchRow, dispatchLine } from "../../../live/machine/dispatchRow.js";
import { appendDispatchRow, dispatchRegisterPath, readDispatchRows } from "../../../live/machine/dispatchStore.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_EXPECTED_EMPTY, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { type FlagSpec, parseFlags } from "../../parseFlags.js";

export const MACHINE_DISPATCHES_USAGE =
  "usage: slopweaver machine dispatches [--all] [--home <dir>] [--json]\n" +
  "       slopweaver machine dispatches settle <id> --witness <what you found> [--home <dir>]\n" +
  "  The anomalous-load finding register: one row per anomalous reading, carrying the triggers that fired,\n" +
  "  the culprit and its process tree, and the investigation it seated or the reason it seated none.\n" +
  "  Open rows only by default; --all includes settled ones. Exit 3 when there is nothing to show.\n" +
  "  `settle` is the ONLY way a row stops being open — an unsettled signature keeps `supervisor tick-record`\n" +
  "  refusing and keeps the seat backoff doubling. --witness is what you actually observed, and is required.";

const BOOLEAN_FLAGS = ["all", "json"] as const;
const STRING_FLAGS = ["home", "witness"] as const;

const FLAGS: FlagSpec = { boolean: [...BOOLEAN_FLAGS], string: [...STRING_FLAGS] };

/** `--`-prefixed, for the help-truth ratchet. */
export const MACHINE_DISPATCHES_FLAG_NAMES: readonly string[] = [...STRING_FLAGS, ...BOOLEAN_FLAGS]
  .map((name) => `--${name}`)
  .toSorted();

/**
 * Parse `machine dispatches`'s flags. Exported so the help-truth ratchet probes the REAL parser.
 *
 * @param rest the argv tail after the verb
 * @returns the parsed flags, or the parse errors
 */
export function parseMachineDispatchesArgs({ rest }: { rest: readonly string[] }): ReturnType<typeof parseFlags> {
  return parseFlags({ args: rest, spec: FLAGS });
}

/** Everything this verb touches outside itself, injected so a test drives it without a clock. */
export interface MachineDispatchesDeps {
  readonly now: () => string;
}

/** Print one row and, under the text rendering, its culprit tree beneath it. */
function printRow({ row, log, json }: { row: DispatchRow; log: Pick<Logger, "out">; json: boolean }): void {
  if (json) {
    return;
  }
  log.out({ line: `${row.id}  ${dispatchLine({ row })}` });
  for (const process of row.subject.tree) {
    log.out({ line: `    ${String(process.cpuPct).padStart(6)}%  ${process.label} (pid ${String(process.pid)})` });
  }
}

/** The `settle` subcommand: append the same row carrying a settlement. */
function settleRow({
  id,
  witness,
  home,
  deps,
  log,
}: {
  id: string;
  witness: string;
  home: string;
  deps: MachineDispatchesDeps;
  log: Pick<Logger, "error" | "out">;
}): number {
  const rows = readDispatchRows({ home });
  if (rows.isErr()) {
    for (const line of rows.error) {
      log.error({ msg: `machine dispatches: ${line}` });
    }
    return EXIT_ERROR;
  }
  const row = rows.value.find((candidate) => candidate.id === id);
  if (row === undefined) {
    log.error({ msg: `machine dispatches: no row carries the id ${id} — \`slopweaver machine dispatches --all\`` });
    return EXIT_USAGE;
  }
  if (row.settled !== undefined) {
    log.error({
      msg: `machine dispatches: ${id} was already settled at ${row.settled.atIso} — ${row.settled.witness}`,
    });
    return EXIT_USAGE;
  }
  const written = appendDispatchRow({ home, row: { ...row, settled: { atIso: deps.now(), witness } } });
  if (written.isErr()) {
    for (const line of written.error) {
      log.error({ msg: `machine dispatches: ${line}` });
    }
    return EXIT_ERROR;
  }
  log.out({ line: `machine dispatches: settled ${id} — ${witness}` });
  return EXIT_OK;
}

/**
 * The `settle` arm: the two things the subcommand needs before it may write, then the settlement.
 *
 * A settlement with no witness is exactly the silent close this register exists to prevent, so a blank one
 * is refused here rather than stored.
 *
 * @param id the row id from the argv tail, which may be absent
 * @param witness what the settler observed, as the flag parser left it
 * @returns the exit code
 */
function settleFromArgs({
  deps,
  home,
  id,
  log,
  witness,
}: {
  deps: MachineDispatchesDeps;
  home: string;
  id: string | undefined;
  log: Pick<Logger, "error" | "out">;
  witness: string | boolean | undefined;
}): number {
  if (id === undefined || typeof witness !== "string" || witness.trim().length === 0) {
    log.error({ msg: "machine dispatches: `settle` needs an id and a --witness naming what you observed" });
    log.error({ msg: MACHINE_DISPATCHES_USAGE });
    return EXIT_USAGE;
  }
  return settleRow({ deps, home, id, log, witness });
}

/**
 * The listing arm: read the register and print what the flags selected.
 *
 * @param all whether settled rows are shown beside the open ones
 * @param json whether one machine-readable document is printed instead of the human listing
 * @returns the exit code — `EXIT_EXPECTED_EMPTY` for an empty selection, which is a status not a fault
 */
function listRows({
  all,
  home,
  json,
  log,
}: {
  all: boolean;
  home: string;
  json: boolean;
  log: Pick<Logger, "error" | "out">;
}): number {
  const rows = readDispatchRows({ home });
  if (rows.isErr()) {
    for (const line of rows.error) {
      log.error({ msg: `machine dispatches: ${line}` });
    }
    return EXIT_ERROR;
  }
  let shown = rows.value;
  if (!all) {
    shown = rows.value.filter((row) => row.settled === undefined);
  }
  if (json) {
    log.out({ line: JSON.stringify({ register: dispatchRegisterPath({ home }), rows: shown }) });
    return shown.length === 0 ? EXIT_EXPECTED_EMPTY : EXIT_OK;
  }
  if (shown.length === 0) {
    let scope = " open";
    if (all) {
      scope = "";
    }
    log.out({ line: `machine dispatches: no${scope} rows in ${dispatchRegisterPath({ home })}` });
    return EXIT_EXPECTED_EMPTY;
  }
  for (const row of shown) {
    printRow({ json, log, row });
  }
  return EXIT_OK;
}

/**
 * Run `machine dispatches` over injected seams — the testable shell.
 *
 * @param argv the full process argv (verb tail starts at index 4 — `machine dispatches <tail>`)
 * @param log the diagnostic + data sinks
 * @param deps the clock a settlement is stamped from
 * @returns `EXIT_OK`, `EXIT_EXPECTED_EMPTY` (3) when there is nothing to show — a legitimate status, not a
 *   fault — `EXIT_USAGE` on a bad flag or an unknown id, and `EXIT_ERROR` when the register cannot be read
 */
export function runMachineDispatchesWithDeps({
  argv,
  log,
  deps,
}: {
  argv: readonly string[];
  log: Pick<Logger, "error" | "out">;
  deps: MachineDispatchesDeps;
}): number {
  const rest = argv.slice(4);
  if (rest.includes("--help") || rest.includes("-h")) {
    log.out({ line: MACHINE_DISPATCHES_USAGE });
    return EXIT_OK;
  }
  const settling = rest[0] === "settle";
  const tail = settling ? rest.slice(2) : rest;
  const parsed = parseMachineDispatchesArgs({ rest: tail });
  if (parsed.isErr()) {
    [...parsed.error, MACHINE_DISPATCHES_USAGE].forEach((error) => {
      log.error({ msg: error });
    });
    return EXIT_USAGE;
  }
  const { values } = parsed.value;
  const home = typeof values["home"] === "string" ? values["home"] : slopweaverHome();
  if (settling) {
    return settleFromArgs({ deps, home, id: rest[1], log, witness: values["witness"] });
  }
  return listRows({ all: values["all"] === true, home, json: values["json"] === true, log });
}

/**
 * Run the `machine dispatches` verb.
 *
 * @param argv the full process argv (verb tail starts at index 4 — `machine dispatches <tail>`)
 * @returns the process exit code — see {@link runMachineDispatchesWithDeps}
 */
export function runMachineDispatches(argv: readonly string[]): number {
  return runMachineDispatchesWithDeps({ argv, deps: { now: () => new Date().toISOString() }, log: logger });
}

export const machineDispatchesCommand = defineCommand({ run: runMachineDispatches });
