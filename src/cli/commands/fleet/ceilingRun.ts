/**
 * `slopweaver fleet ceiling` — how much of the Claude plans' week went unused against the seats that worked,
 * and how many working seats the plans can carry until they reset (`../../../capacity/seatCeiling.ts`).
 *
 * Reads the drawdown journal, the configured plans and the supervisor tick ledger, and nothing else: no probe,
 * no network, no model. `--now` replays a past instant exactly. The supervisor's sweep captures `--json` for its
 * tick (`supervisor tick-draft --seat-ceiling`), and the daily `fleet-ceiling-weekly` row publishes the headline
 * as a local page, carding their Queue when more could have run.
 *
 * `--publish` writes that same morning page for the span ending at `--now` (the slot a firing would have used) and
 * places NO card. It is the repair seat's re-run: a firing that failed on a broken reading is settled, and no
 * scheduler path replays a settled slot, so the seat that fixed the reading republishes the page this way. A reading
 * still broken publishes its page naming what broke and exits 1.
 */
import { type FleetCeilingReport } from "../../../capacity/seatCeiling.js";
import { readFleetCeilingReport } from "../../../capacity/seatCeilingRead.js";
import { renderFleetCeilingLines } from "../../../capacity/seatCeilingRender.js";
import { slopweaverHome } from "../../../homeDir.js";
import { parseIsoMs } from "../../../lib/date.js";
import { logger } from "../../../lib/logger.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { type FleetCeilingWhy } from "../../../live/automation/fleetCeilingAsk.js";
import { fleetCeilingDelivery } from "../../../live/automation/fleetCeilingReport.js";
import { productionPublishPage } from "../../../pages/productionPublish.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { parseFlags } from "../../parseFlags.js";
import { readFleetWhyForCeiling } from "../automation/fleetCeilingDelivery.js";
import { type FleetCommandError, FleetCommandErrors, fleetCommandErrorLines } from "./errors.js";

/** The flags `fleet ceiling` accepts, and the ONLY place they are named. */
const CEILING_FLAG_SPEC = { boolean: ["json", "publish"], string: ["days", "home", "now"] } as const;

/** Where a verb's own arguments start in `process.argv`: `[node, cli, fleet, ceiling, …]`. */
const VERB_ARG_OFFSET = 4;

/** Days measured when `--days` is not given — the week they asked about. */
const DEFAULT_DAYS = 7;
/** The longest span: the drawdown journal's baseline policy looks back a week, and two is a fair comparison. */
const MAX_DAYS = 28;

/**
 * Every flag `fleet ceiling` advertises, derived from the spec it parses with.
 *
 * @internal — read by `helpTruth.test.ts` to hold `meta.usage` to the real parser.
 */
export const FLEET_CEILING_FLAG_NAMES: readonly string[] = [
  ...CEILING_FLAG_SPEC.string,
  ...CEILING_FLAG_SPEC.boolean,
].map((name) => `--${name}`);

/** What one `fleet ceiling` invocation asked for. */
export interface FleetCeilingArgs {
  readonly days: number;
  readonly json: boolean;
  /** Also write the morning page for the span ending at the instant read, never a card. */
  readonly publish: boolean;
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
 * Parse `fleet ceiling`'s argument tail, strictly, before anything is read.
 *
 * @param rest the argv tail, after `fleet ceiling`
 * @returns the arguments, or every rejection at once
 */
export function parseFleetCeilingArgs({
  rest,
}: {
  readonly rest: readonly string[];
}): Result<FleetCeilingArgs, FleetCommandError> {
  const parsed = parseFlags({ args: rest, spec: CEILING_FLAG_SPEC });
  if (parsed.isErr()) {
    return err(FleetCommandErrors.flagsRefused({ reasons: parsed.error }));
  }
  const { values } = parsed.value;
  const daysText = stringFlag({ name: "days", values });
  let days = DEFAULT_DAYS;
  if (daysText !== undefined) {
    days = Number(daysText);
  }
  const nowText = stringFlag({ name: "now", values });
  const nowMs = nowText === undefined ? undefined : parseIsoMs({ tsIso: nowText });
  const problems = [
    ...(Number.isInteger(days) && days >= 1 && days <= MAX_DAYS
      ? []
      : [FleetCommandErrors.daysOutOfRange({ got: daysText, max: MAX_DAYS })]),
    ...(nowText === undefined || nowMs !== undefined ? [] : [FleetCommandErrors.nowNotIso({ got: nowText })]),
  ];
  if (problems.length > 0) {
    return err(FleetCommandErrors.argumentsRefused({ problems }));
  }
  return ok({
    days,
    home: stringFlag({ name: "home", values }),
    json: values["json"] === true,
    nowIso: nowMs === undefined ? undefined : new Date(nowMs).toISOString(),
    publish: values["publish"] === true,
  });
}

/** What `fleet ceiling` touches outside itself. */
export interface FleetCeilingDeps {
  readonly now: () => string;
  readonly defaultHome: () => string;
  readonly readReport: (request: { home: string; days: number; nowIso: string }) => Promise<Result<FleetCeilingReport>>;
  readonly readWhy: (request: { home: string; nowIso: string }) => FleetCeilingWhy;
  readonly publish: (request: {
    home: string;
    slug: string;
    fragment: string;
    nowIso: string;
  }) => Promise<Result<{ readonly url: string }>>;
  readonly writeOut: (line: string) => void;
  readonly writeDiagnostic: (line: string) => void;
}

/**
 * Publish the morning page for `report`, and say where — or why it could not.
 *
 * @returns the exit code: 1 when the page could not be written or the reading it shows is broken
 */
async function publishMorningPage({
  deps,
  days,
  home,
  nowIso,
  report,
}: {
  deps: FleetCeilingDeps;
  days: number;
  home: string;
  nowIso: string;
  report: FleetCeilingReport;
}): Promise<number> {
  const why = deps.readWhy({ home, nowIso });
  const delivery = fleetCeilingDelivery({ days, report, slotIso: nowIso, why });
  if (delivery.isErr()) {
    deps.writeDiagnostic(`fleet ceiling: ${delivery.error.message}`);
    return EXIT_ERROR;
  }
  const { brokenReason, fragment, slug } = delivery.value;
  const published = await deps.publish({ fragment, home, nowIso: deps.now(), slug });
  if (published.isErr()) {
    deps.writeDiagnostic(`fleet ceiling: page ${slug} could not be published: ${published.error.join("; ")}`);
    return EXIT_ERROR;
  }
  deps.writeDiagnostic(`fleet ceiling: published page ${slug} → ${published.value.url} · no card placed`);
  if (brokenReason !== null) {
    deps.writeDiagnostic(`fleet ceiling: the measurement is still broken: ${brokenReason}`);
    return EXIT_ERROR;
  }
  return EXIT_OK;
}

/**
 * Run `fleet ceiling` against injected seams.
 *
 * @param rest the argv tail after `fleet ceiling`
 * @param deps the clock, the default home, the readers, the page publisher and the two output channels
 * @returns the process exit code
 */
export async function runFleetCeiling({
  rest,
  deps,
}: {
  rest: readonly string[];
  deps: FleetCeilingDeps;
}): Promise<number> {
  const args = parseFleetCeilingArgs({ rest });
  if (args.isErr()) {
    deps.writeDiagnostic(`fleet ceiling: ${fleetCommandErrorLines({ error: args.error }).join("; ")}`);
    return EXIT_USAGE;
  }
  const { home = deps.defaultHome(), nowIso = deps.now() } = args.value;
  const report = await deps.readReport({ days: args.value.days, home, nowIso });
  if (report.isErr()) {
    deps.writeDiagnostic(`fleet ceiling: ${report.error.join("; ")}`);
    return EXIT_ERROR;
  }
  if (args.value.json) {
    deps.writeOut(JSON.stringify(report.value));
  } else {
    renderFleetCeilingLines({ report: report.value }).forEach((line) => {
      deps.writeOut(line);
    });
  }
  if (!args.value.publish) {
    return EXIT_OK;
  }
  return publishMorningPage({ days: args.value.days, deps, home, nowIso, report: report.value });
}

/** `slopweaver fleet ceiling`. */
export const fleetCeilingCommand = defineCommand({
  run: (argv) =>
    runFleetCeiling({
      deps: {
        defaultHome: slopweaverHome,
        now: () => new Date().toISOString(),
        publish: productionPublishPage,
        readReport: readFleetCeilingReport,
        readWhy: readFleetWhyForCeiling,
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
