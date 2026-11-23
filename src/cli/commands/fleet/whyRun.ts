/**
 * `slopweaver fleet why` — why the fleet is not running more working seats right now, and what the machine
 * measured over the last `--minutes` (`../../../capacity/fleetWhy.ts`).
 *
 * Reads the readings ledger and nothing else: the window's `machine capacity` readings and the newest `fleet
 * ceiling` and `session watch` ones, each a document a supervisor tick already recorded. No `top`, no probe, no
 * model, so `--now` replays a past instant exactly. The supervisor tick captures `--json` as the `fleet why`
 * reading, and the Fleet page's glance shows that reading's sentences.
 */
import { type FleetWhyError, type FleetWhyReport } from "../../../capacity/fleetWhy.js";
import { readFleetWhyReport } from "../../../capacity/fleetWhyRead.js";
import { renderFleetWhyLines } from "../../../capacity/fleetWhyRender.js";
import { slopweaverHome } from "../../../homeDir.js";
import { parseIsoMs } from "../../../lib/date.js";
import { logger } from "../../../lib/logger.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { parseFlags } from "../../parseFlags.js";
import { type FleetCommandError, FleetCommandErrors, fleetCommandErrorLines } from "./errors.js";

/** The flags `fleet why` accepts, and the ONLY place they are named. */
const WHY_FLAG_SPEC = { boolean: ["json"], string: ["home", "minutes", "now"] } as const;

/** Where a verb's own arguments start in `process.argv`: `[node, cli, fleet, why, …]`. */
const VERB_ARG_OFFSET = 4;

/** Minutes measured when `--minutes` is not given — the last hour of supervisor ticks. */
const DEFAULT_MINUTES = 60;
/** The longest window: a day of ticks, past which a 1-minute load average says nothing about now. */
const MAX_MINUTES = 1440;

/**
 * Every flag `fleet why` advertises, derived from the spec it parses with.
 *
 * @internal — read by `helpTruth.test.ts` to hold `meta.usage` to the real parser.
 */
export const FLEET_WHY_FLAG_NAMES: readonly string[] = [...WHY_FLAG_SPEC.string, ...WHY_FLAG_SPEC.boolean].map(
  (name) => `--${name}`,
);

/** What one `fleet why` invocation asked for. */
export interface FleetWhyArgs {
  readonly minutes: number;
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
 * Parse `fleet why`'s argument tail, strictly, before anything is read.
 *
 * @param rest the argv tail, after `fleet why`
 * @returns the arguments, or every rejection at once
 */
export function parseFleetWhyArgs({
  rest,
}: {
  readonly rest: readonly string[];
}): Result<FleetWhyArgs, FleetCommandError> {
  const parsed = parseFlags({ args: rest, spec: WHY_FLAG_SPEC });
  if (parsed.isErr()) {
    return err(FleetCommandErrors.flagsRefused({ reasons: parsed.error }));
  }
  const { values } = parsed.value;
  const minutesText = stringFlag({ name: "minutes", values });
  let minutes = DEFAULT_MINUTES;
  if (minutesText !== undefined) {
    minutes = Number(minutesText);
  }
  const nowText = stringFlag({ name: "now", values });
  const nowMs = nowText === undefined ? undefined : parseIsoMs({ tsIso: nowText });
  const problems = [
    ...(Number.isInteger(minutes) && minutes >= 1 && minutes <= MAX_MINUTES
      ? []
      : [FleetCommandErrors.minutesOutOfRange({ got: minutesText, max: MAX_MINUTES })]),
    ...(nowText === undefined || nowMs !== undefined ? [] : [FleetCommandErrors.nowNotIso({ got: nowText })]),
  ];
  if (problems.length > 0) {
    return err(FleetCommandErrors.argumentsRefused({ problems }));
  }
  return ok({
    home: stringFlag({ name: "home", values }),
    json: values["json"] === true,
    minutes,
    nowIso: nowMs === undefined ? undefined : new Date(nowMs).toISOString(),
  });
}

/** What `fleet why` touches outside itself. */
export interface FleetWhyDeps {
  readonly now: () => string;
  readonly defaultHome: () => string;
  readonly readReport: (request: {
    home: string;
    minutes: number;
    nowIso: string;
  }) => Result<FleetWhyReport, FleetWhyError>;
  readonly writeOut: (line: string) => void;
  readonly writeDiagnostic: (line: string) => void;
}

/**
 * Run `fleet why` against injected seams.
 *
 * @param rest the argv tail after `fleet why`
 * @param deps the clock, the default home, the reader and the two output channels
 * @returns the process exit code
 */
export function runFleetWhy({ rest, deps }: { rest: readonly string[]; deps: FleetWhyDeps }): number {
  const args = parseFleetWhyArgs({ rest });
  if (args.isErr()) {
    deps.writeDiagnostic(`fleet why: ${fleetCommandErrorLines({ error: args.error }).join("; ")}`);
    return EXIT_USAGE;
  }
  const { home = deps.defaultHome(), nowIso = deps.now() } = args.value;
  const report = deps.readReport({ home, minutes: args.value.minutes, nowIso });
  if (report.isErr()) {
    deps.writeDiagnostic(`fleet why: ${report.error.message}`);
    return EXIT_ERROR;
  }
  if (args.value.json) {
    deps.writeOut(JSON.stringify(report.value));
    return EXIT_OK;
  }
  renderFleetWhyLines({ report: report.value }).forEach((line) => {
    deps.writeOut(line);
  });
  return EXIT_OK;
}

/** `slopweaver fleet why`. */
export const fleetWhyCommand = defineCommand({
  run: (argv) =>
    runFleetWhy({
      deps: {
        defaultHome: slopweaverHome,
        now: () => new Date().toISOString(),
        readReport: readFleetWhyReport,
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
