/**
 * `slopweaver machine series`: the last hour of the machine, one sample per thirty seconds at most, which the
 * Fleet page charts. Effectful shell only: the arithmetic is `../../../live/machine/series.ts`, the reads and the
 * locked ring `../../../live/machine/seriesRead.ts`.
 */
import { slopweaverHome } from "../../../config.js";
import { type Logger, logger } from "../../../lib/logger.js";
import { safeJsonStringify } from "../../../lib/safeJson.js";
import {
  type MachineSeriesDeps,
  productionMachineSeriesDeps,
  refreshMachineSeries,
} from "../../../live/machine/seriesRead.js";
import type { MachineSeriesDocument } from "../../../live/machine/seriesRing.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { booleanFlagsOf, type FlagSpec, parseFlags, stringFlagsOf } from "../../parseFlags.js";

export const MACHINE_SERIES_USAGE =
  "usage: slopweaver machine series [--home <dir>] [--json]\n" +
  "  The last hour of the machine, newest last: CPU split fleet and other (every fleet process TREE summed, so a\n" +
  "  cmux child counts as fleet), the 1-minute load against the load hold, physical memory, compressor segments,\n" +
  "  swap, each Claude Code session's tree, and the heaviest other processes by comm name. Takes one top sample\n" +
  "  when the newest is thirty seconds old or more, and prints the kept ring otherwise. --json prints the whole\n" +
  "  window, which the Fleet page polls.";

const FLAGS: FlagSpec = { boolean: ["json"], string: ["home"] };

/** `--`-prefixed, for the help-truth ratchet. */
export const MACHINE_SERIES_FLAG_NAMES: readonly string[] = [
  ...stringFlagsOf({ spec: FLAGS }),
  ...booleanFlagsOf({ spec: FLAGS }),
]
  .map((name) => `--${name}`)
  .toSorted();

/**
 * Parse `machine series`'s flags. Exported so the help-truth ratchet probes the REAL parser.
 *
 * @param rest the argv tail after the verb
 * @returns the parsed flags, or the parse errors
 */
export function parseMachineSeriesArgs({ rest }: { rest: readonly string[] }): ReturnType<typeof parseFlags> {
  return parseFlags({ args: rest, spec: FLAGS });
}

/**
 * Bytes as whole gigabytes to one decimal, the unit Activity Monitor prints memory in.
 *
 * @returns the figure with its unit
 */
function gb({ bytes }: { bytes: number }): string {
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}

/**
 * The human lines for one window: the newest sample's figures, and the hold.
 *
 * @returns the lines, newest sample first
 */
export function renderMachineSeriesLines({ document }: { document: MachineSeriesDocument }): readonly string[] {
  // The document is never empty: `machineSeriesDocument` refuses an empty ring.
  const newest = document.samples.at(-1)!;
  // Idle clears a load over its hold, so the load line says it: without it a load over 45 that is not held reads wrong.
  let idle = ", idle unmeasured";
  if (newest.cpu.idlePct !== undefined) {
    idle = `, ${String(newest.cpu.idlePct)}% idle`;
  }
  const lines = [
    `newest sample ${newest.observedAtIso}, ${String(document.samples.length)} kept over the last ${String(document.windowSeconds / 60)} minutes`,
    `CPU: fleet ${String(newest.cpu.fleetPct)}%, other ${String(newest.cpu.otherPct)}%, of ${String(newest.cores * 100)}% (${String(newest.cores)} cores)`,
    `load: 1-minute ${String(newest.load.load1)}, hold at ${String(newest.load.holdAt)}${idle}`,
    `memory: ${gb({ bytes: newest.memory.usedBytes })} used of ${gb({ bytes: newest.memory.totalBytes })}, compressor segments ${String(newest.memory.compressorSegmentsPct)}%, swap ${String(newest.memory.swapUsedGb)} of ${String(newest.memory.swapTotalGb)} GB`,
  ];
  const hold = document.currentLoadHold;
  if (hold.kind === "since") {
    lines.push(`held since ${hold.startedAtIso}`);
  } else if (hold.kind === "after-gap") {
    lines.push(`held since at least ${hold.earliestHeldIso}, with no sample in the gap before it`);
  } else if (hold.kind === "before-window") {
    lines.push(`held since at least ${hold.oldestObservedAtIso}, the oldest sample kept`);
  }
  for (const other of newest.topOtherCpu) {
    lines.push(`other by CPU: ${other.label} ${String(other.cpuPct)}% over ${String(other.processCount)} processes`);
  }
  return lines;
}

/**
 * Run `machine series` over injected reads, logger and clock.
 *
 * @param argv the full process argv (the verb tail starts at index 4: `machine series <tail>`)
 * @param log the diagnostic and data sinks
 * @param deps the machine reads one sample takes
 * @param nowIso the clock the freshness and the new sample's instant are read off
 * @returns `EXIT_OK`, `EXIT_USAGE` on a bad flag, or `EXIT_ERROR` when no window could be printed
 */
export async function runMachineSeriesWithDeps({
  argv,
  log,
  deps,
  nowIso,
}: {
  argv: readonly string[];
  log: Pick<Logger, "error" | "out">;
  deps: MachineSeriesDeps;
  nowIso: () => string;
}): Promise<number> {
  const rest = argv.slice(4);
  if (rest.includes("--help") || rest.includes("-h")) {
    log.out({ line: MACHINE_SERIES_USAGE });
    return EXIT_OK;
  }
  const parsed = parseMachineSeriesArgs({ rest });
  if (parsed.isErr()) {
    [...parsed.error, MACHINE_SERIES_USAGE].forEach((msg) => {
      log.error({ msg });
    });
    return EXIT_USAGE;
  }
  const { values } = parsed.value;
  let home = slopweaverHome();
  if (typeof values["home"] === "string") {
    home = values["home"];
  }
  const document = await refreshMachineSeries({ deps, home, nowIso });
  if (document.isErr()) {
    log.error({ msg: document.error.message });
    return EXIT_ERROR;
  }
  if (values["json"] === true) {
    log.out({ line: safeJsonStringify({ label: "the machine series window", value: document.value }) });
    return EXIT_OK;
  }
  for (const line of renderMachineSeriesLines({ document: document.value })) {
    log.out({ line });
  }
  return EXIT_OK;
}

/**
 * Run the `machine series` verb.
 *
 * @param argv the full process argv
 * @returns the process exit code: see {@link runMachineSeriesWithDeps}
 */
export async function runMachineSeries(argv: readonly string[]): Promise<number> {
  return runMachineSeriesWithDeps({
    argv,
    deps: productionMachineSeriesDeps(),
    log: logger,
    nowIso: () => new Date().toISOString(),
  });
}

export const machineSeriesCommand = defineCommand({ run: runMachineSeries });
