/**
 * `slopweaver perf seat <ref>` — the first drill-down behind the summary line.
 *
 * A seat is addressable by any of the three identities the two readings carry, because a supervisor holds a
 * different one depending on where it is looking: a cmux workspace id off `cmux list`, a Claude session id
 * off the fleet reading, or a worktree path off the board. `matchSeat` resolves all three and is pure.
 */
import { logger } from "../../../lib/logger.js";
import { perfSeatLines } from "../../../live/perf/render.js";
import type { PerfReport, SeatPerf } from "../../../live/perf/report.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_EXPECTED_EMPTY, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { parsePerfArgs, perfReading, windowMinutesOf } from "./core.js";

export const PERF_SEAT_USAGE =
  "usage: slopweaver perf seat <workspace-id|session-id|worktree-path|pid> [--window-minutes <n>] [--json]\n" +
  "  One seat in full: its cpu, its in-flight tool calls, its live hook boots, WHICH hook is running and\n" +
  "  for how long, and its turnaround distribution. Exit 3 when the reference matches no seat `ps` saw.";

/** Where this verb's own flags start in `process.argv`. */
const SEAT_ARG_OFFSET = 4;

/**
 * The seat a reference names, matched on every identity the report carries — exact on the ids and the pid,
 * substring on the worktree so a board slug reaches its own row without the absolute path.
 *
 * @param ref the reference a caller typed
 * @param report the assembled report
 * @returns the seat, or `undefined` when nothing matched
 */
export function matchSeat({ ref, report }: { ref: string; report: PerfReport }): SeatPerf | undefined {
  const needle = ref.trim();
  if (needle.length === 0) {
    return undefined;
  }
  const exact = report.seats.find(
    (seat) => seat.sessionId === needle || seat.workspaceId === needle || String(seat.pid) === needle,
  );
  if (exact !== undefined) {
    return exact;
  }
  return report.seats.find((seat) => seat.cwd?.includes(needle) === true);
}

/**
 * Run `slopweaver perf seat`.
 *
 * @param argv the full process argv
 * @returns the process exit code
 */
export function runPerfSeat(argv: readonly string[]): number {
  const rest = argv.slice(SEAT_ARG_OFFSET);
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: PERF_SEAT_USAGE });
    return EXIT_OK;
  }
  const parsed = parsePerfArgs({ allowPositionals: true, rest });
  if (parsed.isErr()) {
    parsed.error.forEach((error) => {
      logger.error({ msg: error });
    });
    logger.error({ msg: PERF_SEAT_USAGE });
    return EXIT_USAGE;
  }
  const ref = parsed.value.positionals[0];
  if (ref === undefined) {
    logger.error({ msg: "perf seat: name the seat — a cmux workspace id, a session id, a worktree or a pid" });
    logger.error({ msg: PERF_SEAT_USAGE });
    return EXIT_USAGE;
  }
  let reading;
  try {
    reading = perfReading({ windowMinutes: windowMinutesOf({ values: parsed.value.values }) });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    logger.error({ msg: `perf seat: the machine or the cmux event log could not be read — ${detail}` });
    return EXIT_ERROR;
  }
  const seat = matchSeat({ ref, report: reading.report });
  if (seat === undefined) {
    logger.error({
      msg: `perf seat: no live seat matches ${ref} — \`slopweaver perf\` lists every seat ps attributed`,
    });
    return EXIT_EXPECTED_EMPTY;
  }
  if (parsed.value.values["json"] === true) {
    logger.out({ line: JSON.stringify(seat) });
    return EXIT_OK;
  }
  for (const line of perfSeatLines({ report: reading.report, seat })) {
    logger.out({ line });
  }
  return EXIT_OK;
}

export const perfSeatCommand = defineCommand({ run: runPerfSeat });
