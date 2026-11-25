/**
 * `slopweaver fleet burn` — how many tokens Claude and Codex each burned over the last 24 hours, what seven days at
 * that rate would burn, and how many sessions drew any in the last few minutes (`../../../fleet/hostBurn.ts`).
 *
 * Reads the local Claude transcripts and every registered Codex home's rollouts, and nothing else: no probe, no
 * network, no model. `--now` replays a past instant. The Fleet page's per-host usage line reads the `--json` document
 * with `reading last --producer "fleet burn"`. Two actors record it: the supervisor tick, which ledgers the child's
 * stdout itself, and the Fleet page's own opening refresh, whose sync row runs `--json --record-reading sync-now`
 * (`site/lib/syncVerbs.ts`). A refused append exits non-zero after the document printed, because the sync route
 * reads exit 0 as "the reading was taken".
 */
import { type FleetBurnReport, type HostBurn } from "../../../fleet/hostBurn.js";
import { scanFleetBurn } from "../../../fleet/hostBurnStore.js";
import { slopweaverHome } from "../../../homeDir.js";
import { parseIsoMs } from "../../../lib/date.js";
import { logger } from "../../../lib/logger.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { planRegisterPort } from "../../../plans/port.js";
import type { ReadingsError } from "../../../readings/errors.js";
import { type PrintedReadingAppend, printedReadingOutputOf } from "../../../readings/printedReading.js";
import { recordReading } from "../../../readings/store.js";
import type { ReadingReceipt } from "../../../readings/types.js";
import { compactTokens } from "../../../sessions/sessionCost.js";
import { claudeProjectsDir } from "../../../transcripts/source.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { parseFlags } from "../../parseFlags.js";
import { type FleetCommandError, FleetCommandErrors, fleetCommandErrorLines } from "./errors.js";

/** The producer the reading files under — the verb words `reading last --producer "fleet burn"` reads. */
export const FLEET_BURN_PRODUCER = "fleet burn";

/** The flags `fleet burn` accepts, and the ONLY place they are named. */
const BURN_FLAG_SPEC = { boolean: ["json"], string: ["home", "now", "record-reading"] } as const;

/** Where a verb's own arguments start in `process.argv`: `[node, cli, fleet, burn, …]`. */
const VERB_ARG_OFFSET = 4;

/**
 * Every flag `fleet burn` advertises, derived from the spec it parses with.
 *
 * @internal — read by `helpTruth.test.ts` to hold `meta.usage` to the real parser.
 */
export const FLEET_BURN_FLAG_NAMES: readonly string[] = [...BURN_FLAG_SPEC.string, ...BURN_FLAG_SPEC.boolean].map(
  (name) => `--${name}`,
);

/** What one `fleet burn` invocation asked for. */
export interface FleetBurnArgs {
  readonly json: boolean;
  readonly home: string | undefined;
  readonly nowIso: string | undefined;
  /** Who takes the reading under `--record-reading`; `undefined` when the flag is absent. */
  readonly recordReadingBy: string | undefined;
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
 * Parse `fleet burn`'s argument tail, strictly, before anything is read.
 *
 * @param rest the argv tail, after `fleet burn`
 * @returns the arguments, or every rejection at once
 */
export function parseFleetBurnArgs({
  rest,
}: {
  readonly rest: readonly string[];
}): Result<FleetBurnArgs, FleetCommandError> {
  const parsed = parseFlags({ args: rest, spec: BURN_FLAG_SPEC });
  if (parsed.isErr()) {
    return err(FleetCommandErrors.flagsRefused({ reasons: parsed.error }));
  }
  const { values } = parsed.value;
  const nowText = stringFlag({ name: "now", values });
  let nowIso: string | undefined;
  if (nowText !== undefined) {
    const nowMs = parseIsoMs({ tsIso: nowText });
    if (nowMs === undefined) {
      return err(FleetCommandErrors.argumentsRefused({ problems: [FleetCommandErrors.nowNotIso({ got: nowText })] }));
    }
    nowIso = new Date(nowMs).toISOString();
  }
  const json = values["json"] === true;
  const recordReadingBy = stringFlag({ name: "record-reading", values });
  if (recordReadingBy !== undefined && !json) {
    return err(
      FleetCommandErrors.argumentsRefused({
        problems: [FleetCommandErrors.recordReadingNeedsJson({ got: recordReadingBy })],
      }),
    );
  }
  return ok({ home: stringFlag({ name: "home", values }), json, nowIso, recordReadingBy });
}

/**
 * One host's burn as one line a reader takes in at a glance.
 *
 * @param name the host as they read it
 * @param burn measured, partial or unavailable, each said differently
 * @returns the line
 */
export function hostBurnLine({ name, burn }: { name: string; burn: HostBurn }): string {
  if (burn.kind === "unavailable") {
    return `${name}: burn not measured — ${burn.why}`;
  }
  const drawn = `${compactTokens({ count: burn.totalTokens })} tokens in 24h (${compactTokens({ count: burn.outputTokens })} output) across ${String(burn.sessions)} sessions, ${String(burn.activeSessions)} drawing now`;
  if (burn.kind === "partial") {
    return `${name}: at least ${drawn}; no projection, ${String(burn.problems.length)} problem(s) — ${burn.problems.join("; ")}`;
  }
  return `${name}: ${drawn} · ${compactTokens({ count: burn.projectedWeekTokens })} over 7 days at this rate`;
}

/**
 * The report as the lines a human reads.
 *
 * @param report the whole report
 * @returns one line per host, under the window it covers
 */
export function renderFleetBurnLines({ report }: { report: FleetBurnReport }): readonly string[] {
  return [
    `fleet burn: ${report.fromIso} → ${report.observedAtIso}; "drawing now" is the last ${String(report.activeWithinMinutes)} minutes`,
    hostBurnLine({ burn: report.hosts.claude, name: "Claude" }),
    hostBurnLine({ burn: report.hosts.codex, name: "Codex" }),
  ];
}

/** What `fleet burn` touches outside itself. */
export interface FleetBurnDeps {
  readonly now: () => string;
  readonly defaultHome: () => string;
  readonly readReport: (request: { home: string; nowIso: string }) => Promise<FleetBurnReport>;
  readonly recordReading: (input: PrintedReadingAppend) => Result<ReadingReceipt, ReadingsError>;
  readonly writeOut: (line: string) => void;
  readonly writeDiagnostic: (line: string) => void;
}

/**
 * Run `fleet burn` against injected seams.
 *
 * Under `--json --record-reading <by>` the document prints first and is appended second, so a completed scan is never
 * hidden; a refused append then exits non-zero, because the console's sync route reads exit 0 as a reading taken.
 *
 * @param rest the argv tail after `fleet burn`
 * @param deps the clock, the default home, the scanner, the ledger append and the two output channels
 * @returns the process exit code
 */
export async function runFleetBurn({ rest, deps }: { rest: readonly string[]; deps: FleetBurnDeps }): Promise<number> {
  const args = parseFleetBurnArgs({ rest });
  if (args.isErr()) {
    deps.writeDiagnostic(`fleet burn: ${fleetCommandErrorLines({ error: args.error }).join("; ")}`);
    return EXIT_USAGE;
  }
  const { home = deps.defaultHome(), nowIso = deps.now() } = args.value;
  const report = await deps.readReport({ home, nowIso });
  if (args.value.json) {
    const output = printedReadingOutputOf({
      by: args.value.recordReadingBy,
      document: report,
      home,
      observedAtIso: report.observedAtIso,
      producer: FLEET_BURN_PRODUCER,
      recordedAtIso: deps.now(),
    });
    deps.writeOut(output.text);
    if (output.append === undefined) {
      return EXIT_OK;
    }
    const recorded = deps.recordReading(output.append);
    if (recorded.isErr()) {
      deps.writeDiagnostic(`fleet burn: the reading was not recorded — ${recorded.error.message}`);
      return EXIT_ERROR;
    }
    return EXIT_OK;
  }
  renderFleetBurnLines({ report }).forEach((line) => {
    deps.writeOut(line);
  });
  return EXIT_OK;
}

/** `slopweaver fleet burn`. */
export const fleetBurnCommand = defineCommand({
  run: (argv) =>
    runFleetBurn({
      deps: {
        defaultHome: slopweaverHome,
        now: () => new Date().toISOString(),
        readReport: ({ home, nowIso }) =>
          scanFleetBurn({ home, nowIso, port: planRegisterPort(), projectsDir: claudeProjectsDir() }),
        recordReading: (input) => recordReading({ ...input }),
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
