/**
 * Rendering the fleet performance report — the progressive disclosure AGENTS.md rule 7 asks for, as pure
 * string functions.
 *
 * The arrangement is the rule rather than a preference: **one summary line above the fold**, everything
 * else behind a verb the reader chooses to run. `slopweaver perf` prints {@link perfSummaryLine} plus the
 * react lines and nothing more; `perf seat <ref>` and `perf hook <name>` are the drill-downs. A reader who
 * needs none of the detail pays one line, and a sweep tick that reads this every tick pays one line too.
 *
 * Every number carries its own unit and its own claim: `turnaround` is never printed without that word,
 * because it is not hook time alone (`./hookStream.ts`'s header has the measurement that says so).
 */
import { briefDuration, stalledHookLabel } from "../machine/fleetLoad.js";
import { harnessTimeoutFoldLines } from "./harnessTimeouts.js";
import type { HookStreamReading } from "./hookStream.js";
import type { Distribution } from "./quantiles.js";
import type { PerfReport, SeatPerf } from "./report.js";

/** A distribution as `p50 12s p95 3m`, or the honest absence. */
function distributionClause({ distribution }: { distribution: Distribution | undefined }): string {
  if (distribution === undefined) {
    return "turnaround unmeasured";
  }
  return `turnaround p50 ${briefDuration({ seconds: distribution.p50 })} p95 ${briefDuration({ seconds: distribution.p95 })}`;
}

/** A field the STREAM half supplies, or the honest statement that the stream never carried it. */
function orUnseen({ value }: { value: string | undefined }): string {
  if (value === undefined) {
    return "not seen in the hook stream";
  }
  return value;
}

/** The load clause, which never reads `0` for a failed read. */
function loadClause({ report }: { report: PerfReport }): string {
  const { load1, cores } = report.load;
  if (load1 === undefined) {
    return "load unread";
  }
  if (cores === undefined) {
    return `load ${String(load1)} on an unread core count`;
  }
  return `load ${String(load1)} on ${String(cores)} cores`;
}

/**
 * The clause for calls nothing is running — absent entirely when there are none, because a `0 stuck` on
 * every healthy tick trains a reader to skip the position the real number appears in.
 */
function stuckClause({ report }: { report: PerfReport }): readonly string[] {
  if (report.stuckCount === 0) {
    return [];
  }
  // `perfReport` sorts stalled first and stuck next, so the worst stuck seat is the first one carrying it.
  const worst = report.seats.find((seat) => seat.stuck)!;
  return [
    `${String(report.stuckCount)} seat(s) with nothing running for an in-flight Bash, ` +
      `oldest ${briefDuration({ seconds: worst.inFlightSeconds! })}`,
  ];
}

/**
 * The clause for calls that already blew their budget and died — absent when there are none, on the same
 * reasoning as {@link stuckClause}, and absent when nothing was measured at all, which is a different
 * answer and says so in the fold rather than in the one line above it.
 */
function overrunClause({ report }: { report: PerfReport }): readonly string[] {
  const census = report.hookOverruns;
  if (census === undefined) {
    return [];
  }
  const clauses: string[] = [];
  if (census.overruns > 0) {
    const budgetSeconds = Math.round(census.budgetMs / 1000);
    const overranSeats = census.seats.filter((seat) => seat.overruns > 0).length;
    clauses.push(
      `${String(census.overruns)} PreToolUse call(s) blew the ${String(budgetSeconds)}s budget ` +
        `on ${String(overranSeats)} seat(s), of ${String(census.recorded)} with a recorded duration`,
    );
  }
  // A harness timeout is its own count, of every event and any duration, read off the transcript's
  // `timedOut` — see `src/transcripts/hookDuration.ts` § Two endings.
  if (census.unbounded > 0) {
    clauses.push(`${String(census.unbounded)} hook(s) past our own bound, ended by the harness's timeout`);
  }
  return clauses;
}

/**
 * The stall clause — the count, and WHICH hook on the worst seat.
 *
 * `NOW` is load-bearing whenever the census saw an overrun: this grade is a live `ps` sample, so a bare
 * "no hook over the line" is exactly the false green that let 34 blown budgets go unreported for 3 h 27 m.
 */
function stallClause({ report }: { report: PerfReport }): string {
  if (report.stalledCount === 0) {
    const census = report.hookOverruns;
    const blewEarlier = census !== undefined && (census.overruns > 0 || census.unbounded > 0);
    if (blewEarlier) {
      return "no hook over the line NOW";
    }
    return "no hook over the line";
  }
  // `perfReport` sorts stalled seats first and longest-stalled among them, so with a non-zero count the
  // first row IS the worst — reading `[0]` rather than re-scanning keeps the two orderings from diverging.
  const worst = report.seats[0]!;
  const hook = stalledHookLabel({ script: worst.stallScript });
  return `${String(report.stalledCount)} seat(s) stalled, worst ${hook} ${briefDuration({ seconds: worst.stallSeconds! })}`;
}

/**
 * The stray-dev-server clause — absent when there are none and absent when the class was not measured, on
 * the same reasoning as {@link stuckClause}: a `0 stray` on every healthy tick is a position a reader learns
 * to skip.
 */
function devServerClause({ report }: { report: PerfReport }): readonly string[] {
  const stray = report.strayDevServers;
  if (stray === undefined || stray.length === 0) {
    return [];
  }
  return [`${String(stray.length)} stray dev server(s)`];
}

/**
 * The ONE line that goes above the fold.
 *
 * @param report the assembled report
 * @returns the summary line
 */
export function perfSummaryLine({ report }: { report: PerfReport }): string {
  return [
    "fleet perf",
    loadClause({ report }),
    `${String(report.seats.length)} seat(s)`,
    stallClause({ report }),
    ...overrunClause({ report }),
    ...stuckClause({ report }),
    ...devServerClause({ report }),
    `${String(report.bootsInFlight)} hook boot(s) live`,
    distributionClause({ distribution: report.fleetTurnaround }),
    `${String(report.frames)} frame(s)/${String(report.windowMinutes)}m`,
  ].join(" · ");
}

/** One seat as a fold line. */
function seatLine({ seat }: { seat: SeatPerf }): string {
  const stall =
    seat.stallSeconds === undefined
      ? "no hook running"
      : `${stalledHookLabel({ script: seat.stallScript })} ${briefDuration({ seconds: seat.stallSeconds })}`;
  let flag = "";
  if (seat.stalled) {
    flag = "STALLED ";
  } else if (seat.stuck) {
    flag = "STUCK ";
  }
  return (
    `  ${flag}${seat.sessionId} (pid ${String(seat.pid)}) · ${String(seat.cpuPct)}% cpu · ` +
    `${String(seat.parallelToolCalls)} in flight · ${String(seat.bootsInFlight)} boots · ${stall} · ` +
    `${String(seat.firings)} call(s), ${distributionClause({ distribution: seat.turnaround })}`
  );
}

/**
 * The collapsed half of `slopweaver perf` — one line per seat, worst first, then the harness timeouts that
 * owe no act (`./harnessTimeouts.ts`), which the seat cap never drops.
 *
 * @param report the assembled report
 * @param topN how many seat rows to print. Above the fleet's live seat count, which was 8 when this verb
 *   landed and 10 since — `ps -ax -o args= | grep -c '[c]laude --session-id'`. A seat over a line
 *   sorts first and is never the row that falls off, so this bounds the reading rather than hiding a grade.
 * @returns the fold lines, empty when `ps` attributed no seat and no harness timeout is folded
 */
export function perfFoldLines({ report, topN = 12 }: { report: PerfReport; topN?: number }): readonly string[] {
  return [
    ...report.seats.slice(0, topN).map((seat) => seatLine({ seat })),
    ...harnessTimeoutFoldLines({ hookOverruns: report.hookOverruns, seats: report.seats }),
  ];
}

/**
 * One seat in full — `slopweaver perf seat <ref>`.
 *
 * @param seat the row to expand
 * @param report the report it came from, for the line it was graded against
 * @returns the lines, in display order
 */
export function perfSeatLines({ seat, report }: { seat: SeatPerf; report: PerfReport }): readonly string[] {
  const lines = [
    `seat ${seat.sessionId} (pid ${String(seat.pid)})`,
    `  workspace   ${orUnseen({ value: seat.workspaceId })}`,
    `  worktree    ${orUnseen({ value: seat.cwd })}`,
    `  cpu         ${String(seat.cpuPct)}% across its whole tree`,
    `  in flight   ${String(seat.parallelToolCalls)} tool call(s), ${String(seat.bootsInFlight)} hook boot(s), ` +
      `${String(seat.toolShellsInFlight)} tool shell(s)`,
  ];
  const inFlightSeconds = seat.inFlightSeconds;
  if (inFlightSeconds === undefined) {
    lines.push("  last call   closed out by a later frame or a turn boundary — nothing is in flight");
  } else {
    lines.push(
      `  last call   ${orUnseen({ value: seat.inFlightTool })} began ${briefDuration({ seconds: inFlightSeconds })} ago` +
        ` with no later frame${seat.stuck ? " — and NOTHING is running for it (see below)" : ""}`,
    );
  }
  if (seat.stuck) {
    lines.push(
      "  stuck       an in-flight Bash over the line with no hook process and no tool shell. That is a",
      "              SUSPICION, not a verdict: the same reading covers a seat between its last tool call",
      "              and its Stop frame. Look at the seat before stopping it.",
    );
  }
  if (seat.stallSeconds === undefined) {
    lines.push("  live hook   none running at the instant of this read");
  } else {
    lines.push(
      `  live hook   ${stalledHookLabel({ script: seat.stallScript })} running ${briefDuration({ seconds: seat.stallSeconds })}` +
        ` (line ${briefDuration({ seconds: report.stallHoldSeconds })})`,
    );
  }
  const turnaround = seat.turnaround;
  if (turnaround === undefined) {
    lines.push(`  turnaround  unmeasured — ${String(seat.firings)} call(s) in the window paired into no gap`);
  } else {
    lines.push(
      `  turnaround  p50 ${briefDuration({ seconds: turnaround.p50 })}, p95 ${briefDuration({ seconds: turnaround.p95 })},` +
        ` max ${briefDuration({ seconds: turnaround.max })} over ${String(turnaround.count)} gap(s)` +
        ` — hook time PLUS tool time PLUS model time, never hook time alone`,
    );
  }
  return lines;
}

/**
 * One hook across the fleet — `slopweaver perf hook <name>`.
 *
 * @param script the hook script stem asked about, e.g. `pretooluse-poll-gate`
 * @param report the assembled report
 * @param stream the stream fold, for the per-name firing counts
 * @returns the lines, in display order
 */
export function perfHookLines({
  script,
  report,
  stream,
}: {
  script: string;
  report: PerfReport;
  stream: HookStreamReading;
}): readonly string[] {
  const running = report.seats.filter((seat) => seat.stallScript === script);
  const lines = [`hook ${script}`];
  if (running.length === 0) {
    lines.push("  live        no seat had it running at the instant of this read");
  } else {
    for (const seat of running) {
      lines.push(
        `  live        ${briefDuration({ seconds: seat.stallSeconds! })} on seat ${seat.sessionId} (pid ${String(seat.pid)})` +
          `${seat.stalled ? " — OVER THE LINE" : ""}`,
      );
    }
  }
  lines.push(
    "  note        only the LONGEST live hook per seat is attributable to a script; a shorter one running",
    "              beside it is counted in that seat's boot count and named by no row here.",
  );
  for (const row of stream.byName) {
    lines.push(`  stream      ${row.name} fired ${String(row.count)} time(s) in the window`);
  }
  return lines;
}

/**
 * The whole report as one JSON document, with the summary line included so a `--json` consumer and a human
 * reader are never looking at two different sentences.
 *
 * @param report the assembled report
 * @returns the document, on one line
 */
export function perfJson({ report }: { report: PerfReport }): string {
  return JSON.stringify({ ...report, summary: perfSummaryLine({ report }) });
}
