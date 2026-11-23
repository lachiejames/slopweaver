/**
 * `slopweaver fleet history` — the fleet's recent states as the supervisor's ticks recorded them: per tick, the
 * machine's hold and load, the plans' ceilings, the working count and how many ready rows had nobody on
 * (`../../../fleet/stateHistory.ts`). The console's Fleet page reads `--json` for the history folded under its state.
 *
 * Reads the supervisor tick ledger from its end and nothing else: no probe, no network, no model. `--now` replays a
 * past instant exactly.
 */
import {
  type FleetHistoryDocument,
  fleetHistoryLine,
  fleetHistoryOf,
  MAX_HISTORY_HOURS,
} from "../../../fleet/stateHistory.js";
import { MAX_HISTORY_BYTES, readTickRowsSince, type TickRowsSince } from "../../../fleet/stateHistoryRead.js";
import { slopweaverHome } from "../../../homeDir.js";
import { parseIsoMs } from "../../../lib/date.js";
import { logger } from "../../../lib/logger.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { supervisorTickLedgerPath } from "../../../supervisor/tickStore.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { parseFlags } from "../../parseFlags.js";

/** The flags `fleet history` accepts, and the ONLY place they are named. */
const HISTORY_FLAG_SPEC = { boolean: ["json"], string: ["hours", "home", "now"] } as const;

/** Where a verb's own arguments start in `process.argv`: `[node, cli, fleet, history, …]`. */
const VERB_ARG_OFFSET = 4;

/** Hours read when `--hours` is not given — the day the page folds. */
const DEFAULT_HOURS = 24;

/** One hour, in milliseconds. */
const HOUR_MS = 60 * 60 * 1000;

/**
 * Every flag `fleet history` advertises, derived from the spec it parses with.
 *
 * @internal — read by `helpTruth.test.ts` to hold `meta.usage` to the real parser.
 */
export const FLEET_HISTORY_FLAG_NAMES: readonly string[] = [
  ...HISTORY_FLAG_SPEC.string,
  ...HISTORY_FLAG_SPEC.boolean,
].map((name) => `--${name}`);

/** What one `fleet history` invocation asked for. */
export interface FleetHistoryArgs {
  readonly hours: number;
  readonly json: boolean;
  readonly home: string | undefined;
  readonly nowIso: string | undefined;
}

/** A string flag's value, or `undefined` when it was not supplied. */
function stringFlag({ values, name }: { values: Readonly<Record<string, unknown>>; name: string }): string | undefined {
  const value = values[name];
  if (typeof value !== "string") {
    return undefined;
  }
  return value;
}

/**
 * Parse `fleet history`'s argument tail, strictly, before anything is read.
 *
 * @param rest the argv tail, after `fleet history`
 * @returns the arguments, or every rejection at once
 */
export function parseFleetHistoryArgs({ rest }: { readonly rest: readonly string[] }): Result<FleetHistoryArgs> {
  const parsed = parseFlags({ args: rest, spec: HISTORY_FLAG_SPEC });
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  const { values } = parsed.value;
  const hoursText = stringFlag({ name: "hours", values });
  let hours = DEFAULT_HOURS;
  if (hoursText !== undefined) {
    hours = Number(hoursText);
  }
  const nowText = stringFlag({ name: "now", values });
  let nowMs: number | undefined;
  if (nowText !== undefined) {
    nowMs = parseIsoMs({ tsIso: nowText });
  }
  const problems: string[] = [];
  if (!Number.isInteger(hours) || hours < 1 || hours > MAX_HISTORY_HOURS) {
    problems.push(`--hours must be a whole number from 1 to ${String(MAX_HISTORY_HOURS)}, got ${String(hoursText)}`);
  }
  if (nowText !== undefined && nowMs === undefined) {
    problems.push(`--now ${nowText} is not an ISO-8601 instant`);
  }
  if (problems.length > 0) {
    return err(problems);
  }
  let nowIso: string | undefined;
  if (nowMs !== undefined) {
    nowIso = new Date(nowMs).toISOString();
  }
  return ok({ home: stringFlag({ name: "home", values }), hours, json: values["json"] === true, nowIso });
}

/** What `fleet history` touches outside itself. */
export interface FleetHistoryDeps {
  readonly now: () => string;
  readonly defaultHome: () => string;
  readonly readRows: (request: { home: string; fromIso: string }) => Result<TickRowsSince>;
  readonly writeOut: (line: string) => void;
  readonly writeDiagnostic: (line: string) => void;
}

/**
 * Run `fleet history` against injected seams.
 *
 * @param rest the argv tail after `fleet history`
 * @param deps the clock, the default home, the ledger reader and the two output channels
 * @returns the process exit code
 */
export function runFleetHistory({ rest, deps }: { rest: readonly string[]; deps: FleetHistoryDeps }): number {
  const args = parseFleetHistoryArgs({ rest });
  if (args.isErr()) {
    deps.writeDiagnostic(`fleet history: ${args.error.join("; ")}`);
    return EXIT_USAGE;
  }
  const { home = deps.defaultHome(), nowIso = deps.now() } = args.value;
  const fromIso = new Date(Date.parse(nowIso) - args.value.hours * HOUR_MS).toISOString();
  const read = deps.readRows({ fromIso, home });
  if (read.isErr()) {
    deps.writeDiagnostic(`fleet history: ${read.error.join("; ")}`);
    return EXIT_ERROR;
  }
  const document: FleetHistoryDocument = fleetHistoryOf({
    fromIso,
    observedAtIso: nowIso,
    reachedFrom: read.value.reachedFrom,
    ticks: read.value.rows,
    toIso: nowIso,
  });
  if (args.value.json) {
    deps.writeOut(JSON.stringify(document));
    return EXIT_OK;
  }
  let reach = "";
  if (!document.reachedFrom) {
    reach = ` — the read stopped at its byte budget, so it starts at the earliest row shown`;
  }
  deps.writeOut(`fleet history ${fromIso} → ${nowIso}: ${String(document.rows.length)} tick(s)${reach}`);
  document.rows.forEach((row) => {
    deps.writeOut(fleetHistoryLine({ row }));
  });
  return EXIT_OK;
}

/** `slopweaver fleet history`. */
export const fleetHistoryCommand = defineCommand({
  run: (argv) =>
    runFleetHistory({
      deps: {
        defaultHome: slopweaverHome,
        now: () => new Date().toISOString(),
        readRows: ({ home, fromIso }) =>
          readTickRowsSince({ fromIso, maxBytes: MAX_HISTORY_BYTES, path: supervisorTickLedgerPath({ home }) }).mapErr(
            (error) => [error.message],
          ),
        writeDiagnostic: (line) => {
          logger.error({ msg: line });
        },
        writeOut: (line) => {
          logger.out({ line });
        },
      },
      rest: argv.slice(VERB_ARG_OFFSET),
    }),
});
