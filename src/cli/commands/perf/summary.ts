/**
 * `slopweaver perf` — the one line the supervisor's sweep reads every tick, and the fold behind it.
 *
 * The owner keeps noticing hook stalls and load before the chair does. The whole point of this
 * verb is that the chair sees it FIRST and acts, so the summary is one line (rule 7) and every stall comes
 * with the command that ends it rather than a description of how bad it is.
 *
 * Exit 3 when the tick OWES A REACT LINE — a hook over the stall line, a tool call in flight with nothing
 * running for it, a live seat booted on a pre-envelope `hooks.json`, or a stray docs dev server — so a sweep
 * step can branch on the code the way `events tail` already does. A harness timeout with no act is folded.
 * The code follows the react list rather than the stall count alone: a tick that exits 0 while printing an
 * act to take is the shape a `|| …` caller silently drops.
 */
import { logger } from "../../../lib/logger.js";
import { perfFoldLines, perfJson, perfSummaryLine } from "../../../live/perf/render.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_EXPECTED_EMPTY, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { PERF_FLAG_NAMES, parsePerfArgs, perfReading, windowMinutesOf } from "./core.js";

export const PERF_USAGE =
  "usage: slopweaver perf [--window-minutes <n>] [--json]\n" +
  "  One line: load against cores, seats, stalled hooks NAMED, hook boots live, turnaround p50/p95, and how\n" +
  "  many hook frames the window held. Then one fold line per seat, worst first, and a REACT line per stall\n" +
  "  carrying the command that ends it. Drill down with `slopweaver perf seat <ref>` / `perf hook <name>`.\n" +
  "  Readings only: `ps`/`top` for the live half (the same seams `machine capacity` takes) and cmux's own\n" +
  "  event log for the window. Turnaround is the gap between a seat's consecutive tool calls INSIDE one run\n" +
  "  — hook time plus tool time plus model time, never hook time alone. A call that ALREADY blew its\n" +
  "  budget is a separate census, read off the transcript's own durationMs (src/transcripts/hookDuration.ts):\n" +
  "  the summary says `no hook over the line NOW` whenever it saw one, with the count and its denominator.\n" +
  "  A call the HARNESS's timeout ended reacts only on a live seat booted on a pre-envelope hooks.json, with\n" +
  "  the `cmux reseat` that reloads it; an enveloped one, or one on a closed seat, goes in the fold.\n" +
  "  A seat is STUCK when its in-flight Bash call is over the line with no hook process AND no tool shell\n" +
  "  running for it — nothing this machine can see is doing that work. That is a suspicion, not a verdict:\n" +
  "  the same reading covers a seat between its last tool call and its Stop frame, so look before acting.\n" +
  "  Exit 3 when the tick owes a REACT line — a hook over the stall line `machine capacity` already holds\n" +
  "  spawns on, a call nothing is running for, a seat to reseat, or a stray docs dev server to reap.";

/** Where a verb's own flags start in `process.argv` for a noun + default-verb invocation. */
const PERF_ARG_OFFSET = 3;

/**
 * Run `slopweaver perf`.
 *
 * @param argv the full process argv
 * @returns the process exit code
 */
export function runPerfSummary(argv: readonly string[]): number {
  const rest = argv.slice(PERF_ARG_OFFSET);
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: PERF_USAGE });
    return EXIT_OK;
  }
  const parsed = parsePerfArgs({ rest });
  if (parsed.isErr()) {
    parsed.error.forEach((error) => {
      logger.error({ msg: error });
    });
    logger.error({ msg: PERF_USAGE });
    return EXIT_USAGE;
  }
  let reading;
  try {
    reading = perfReading({ windowMinutes: windowMinutesOf({ values: parsed.value.values }) });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    logger.error({ msg: `perf: the machine or the cmux event log could not be read — ${detail}` });
    return EXIT_ERROR;
  }
  const { report } = reading;
  if (parsed.value.values["json"] === true) {
    logger.out({ line: perfJson({ report }) });
    return report.react.length === 0 ? EXIT_OK : EXIT_EXPECTED_EMPTY;
  }
  logger.out({ line: perfSummaryLine({ report }) });
  for (const line of perfFoldLines({ report })) {
    logger.out({ line });
  }
  for (const line of report.react) {
    logger.out({ line });
  }
  return report.react.length === 0 ? EXIT_OK : EXIT_EXPECTED_EMPTY;
}

export { PERF_FLAG_NAMES };

export const perfSummaryCommand = defineCommand({ run: runPerfSummary });
