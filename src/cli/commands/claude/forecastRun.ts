/**
 * `slopweaver claude forecast` — whether the fleet would survive on the plans it owns, each held to its usage limit,
 * if the measured burn repeats: a historical trend, printed and serialised as one (`basis`), never a fact.
 *
 * Reads the drawdown journal `claude watch` writes and the configured plans, and nothing else: no probe, no
 * network, no model. `--now` replays a past instant exactly, because every sample after it is ignored — that
 * is how the simulation's error is read (`../../../claude/survivalSimulate.ts` § What this model is not).
 *
 * Exit `3` when there is nothing current to forecast from: the watch is not running, or a plan has no reading
 * for its present week. That is a status, not a fault (`../../../cli` area rule § Exit codes).
 */
import { samplesOf } from "../../../claude/drawdownJournal.js";
import { readDrawdownJournal } from "../../../claude/drawdownJournalStore.js";
import { readClaudeFleet } from "../../../claude/spawnAccounts.js";
import { type DemandBasis, forecastSurvival } from "../../../claude/survivalForecast.js";
import { survivalPlansOf } from "../../../claude/survivalPlanState.js";
import { renderSurvivalForecast } from "../../../claude/survivalRender.js";
import { slopweaverHome } from "../../../homeDir.js";
import { parseIsoMs } from "../../../lib/date.js";
import { logger } from "../../../lib/logger.js";
import { err, ok } from "../../../lib/result.js";
import { type PlanRegisterPort, planRegisterPort } from "../../../plans/port.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_EXPECTED_EMPTY, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { parseFlags } from "../../parseFlags.js";
import { ClaudeCommandErrors, type ClaudeCommandResult, claudeCommandErrorLines } from "./errors.js";

/** The flags `claude forecast` accepts, and the ONLY place they are named. */
const FORECAST_FLAG_SPEC = { boolean: ["json"], string: ["weeks", "demand", "home", "now"] } as const;

/** Where a verb's own arguments start in `process.argv`: `[node, cli, claude, forecast, …]`. */
const VERB_ARG_OFFSET = 4;

/** Weeks simulated when `--weeks` is not given — the "coming month" the owner asked about. */
const DEFAULT_WEEKS = 4;
/** The longest horizon: past a quarter, a constant-demand extrapolation says nothing. */
const MAX_WEEKS = 12;

/**
 * Every flag `claude forecast` advertises, derived from the spec it parses with.
 *
 * @internal — read by `helpTruth.test.ts` to hold `meta.usage` to the real parser.
 */
export const CLAUDE_FORECAST_FLAG_NAMES: readonly string[] = [
  ...FORECAST_FLAG_SPEC.string,
  ...FORECAST_FLAG_SPEC.boolean,
].map((name) => `--${name}`);

/** What one `claude forecast` invocation asked for. */
export interface ClaudeForecastArgs {
  readonly weeks: number;
  readonly demandBasis: DemandBasis;
  readonly json: boolean;
  readonly home: string | undefined;
  readonly nowIso: string | undefined;
}

/**
 * Parse `claude forecast`'s argument tail, strictly, before anything is read.
 *
 * @param rest the argv tail, after `claude forecast`
 * @returns the arguments, or every rejection at once
 */
export function parseClaudeForecastArgs({
  rest,
}: {
  readonly rest: readonly string[];
}): ClaudeCommandResult<ClaudeForecastArgs> {
  const parsed = parseFlags({ args: rest, spec: FORECAST_FLAG_SPEC });
  if (parsed.isErr()) {
    return err(ClaudeCommandErrors.flagsRefused({ reasons: parsed.error }));
  }
  const { values } = parsed.value;
  const weeksText = stringFlag({ name: "weeks", values });
  const weeks = weeksText === undefined ? DEFAULT_WEEKS : Number(weeksText);
  const demand = stringFlag({ name: "demand", values });
  const nowIso = stringFlag({ name: "now", values });
  const problems = [
    ...(Number.isInteger(weeks) && weeks >= 1 && weeks <= MAX_WEEKS
      ? []
      : [ClaudeCommandErrors.weeksOutOfRange({ got: String(weeksText), max: MAX_WEEKS })]),
    ...(demand === undefined || demand === "trailing" || demand === "peak"
      ? []
      : [ClaudeCommandErrors.demandUnknown({ got: demand })]),
    ...(nowIso === undefined || parseIsoMs({ tsIso: nowIso }) !== undefined
      ? []
      : [ClaudeCommandErrors.nowNotIso({ got: nowIso })]),
  ];
  if (problems.length > 0) {
    return err(ClaudeCommandErrors.argumentsRefused({ problems }));
  }
  return ok({
    demandBasis: demand === "peak" ? "peak" : "trailing",
    home: stringFlag({ name: "home", values }),
    json: values["json"] === true,
    nowIso: nowIso === undefined ? undefined : new Date(parseIsoMs({ tsIso: nowIso })!).toISOString(),
    weeks,
  });
}

/** A string flag's value, or `undefined` when it was not supplied. */
function stringFlag({ values, name }: { values: Readonly<Record<string, unknown>>; name: string }): string | undefined {
  const value = values[name];
  return typeof value === "string" ? value : undefined;
}

/** What `claude forecast` touches outside itself. */
export interface ClaudeForecastDeps {
  readonly now: () => string;
  readonly defaultHome: () => string;
  readonly writeOut: (line: string) => void;
  readonly writeDiagnostic: (line: string) => void;
  /** Where the plan register is read — the store's port in production, an in-memory one in a test. */
  readonly port: PlanRegisterPort;
}

/**
 * What a flag named, or the seam's answer when it named nothing — an `if` that returns, so the seam is asked
 * only when the flag is absent and that laziness is visible here rather than left to an operator.
 */
function namedOrSeam({ named, seam }: { named: string | undefined; seam: () => string }): string {
  if (named !== undefined) {
    return named;
  }
  return seam();
}

/**
 * Run `claude forecast` against injected seams.
 *
 * @param rest the argv tail after `claude forecast`
 * @param deps the clock, the default home and the two output channels
 * @returns the process exit code
 */
export async function runClaudeForecast({
  rest,
  deps,
}: {
  rest: readonly string[];
  deps: ClaudeForecastDeps;
}): Promise<number> {
  const args = parseClaudeForecastArgs({ rest });
  if (args.isErr()) {
    deps.writeDiagnostic(`claude forecast: ${claudeCommandErrorLines({ error: args.error }).join("; ")}`);
    return EXIT_USAGE;
  }
  const home = namedOrSeam({ named: args.value.home, seam: deps.defaultHome });
  const fleet = await readClaudeFleet({ home, port: deps.port });
  if (fleet.isErr()) {
    deps.writeDiagnostic(`claude forecast: ${fleet.error.message}`);
    return EXIT_ERROR;
  }
  const journal = readDrawdownJournal({ home });
  if (journal.isErr()) {
    deps.writeDiagnostic(`claude forecast: ${journal.error.message}`);
    return EXIT_ERROR;
  }
  const read = forecastSurvival({
    demandBasis: args.value.demandBasis,
    nowIso: namedOrSeam({ named: args.value.nowIso, seam: deps.now }),
    plans: survivalPlansOf({ accounts: fleet.value.accounts }),
    samples: samplesOf({ events: journal.value.events }),
    thresholds: fleet.value.thresholds,
    weeks: args.value.weeks,
  });
  if (read.kind === "unmeasurable") {
    deps.writeOut(`claude historical trend: unmeasurable — ${read.because}`);
    return EXIT_EXPECTED_EMPTY;
  }
  if (args.value.json) {
    deps.writeOut(JSON.stringify(read.forecast));
    return EXIT_OK;
  }
  renderSurvivalForecast({ forecast: read.forecast }).forEach((line) => {
    deps.writeOut(line);
  });
  return EXIT_OK;
}

/** `slopweaver claude forecast`. */
export const claudeForecastCommand = defineCommand({
  run: (argv) =>
    runClaudeForecast({
      deps: {
        defaultHome: slopweaverHome,
        now: () => new Date().toISOString(),
        port: planRegisterPort(),
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
