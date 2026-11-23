/**
 * The fleet performance report — one pure fold over the three readings, and the grade that decides whether
 * the supervisor's tick has something to DO.
 *
 * The owner keeps noticing hook stalls and machine load before the chair does, and steers it by
 * hand. So the point of this module is not another gauge — `machine capacity` is already a gauge — it is a
 * SUMMARY thin enough to read every tick plus a `react` list that names the act, so a stall reaches the
 * briefing as something to dispatch rather than as a line to read.
 *
 * ## Three quantities, never conflated
 *
 * - `stallSeconds` is a LIVE `ps` reading of a hook process's own `etime` (`../machine/fleetLoad.ts`), and
 *   it is true hook runtime with no history at all.
 * - `turnaround` is the gap between a seat's consecutive tool calls inside one run (`./hookStream.ts`), and
 *   it is hook time PLUS tool time PLUS model time.
 * - `hookOverruns` is a CENSUS of calls that already blew their budget and died
 *   (`../../transcripts/hookDuration.ts`), read from the duration Claude Code writes per hook call.
 *
 * The first two are still never called "hook latency" without that qualification. The third is the half
 * that makes the first honest: a `ps` grade cannot see a call that has already ended, so a report carrying
 * only `stalledCount` said `no hook over the line` while 34 `PreToolUse` calls went past the 15 s budget in
 * the same 3 h 27 m window. The two are complements and both are reported —
 * `ps` sees a call still held, the transcript sees every call that already blew.
 *
 * ## `stuck` — the fourth reading, and why it is a SUSPICION rather than a verdict
 *
 * A stall is a hook process `ps` can see. The other shape is a tool call held 20
 * and 42 minutes with NO hook process alive under either seat, which `stallSeconds` reports as "no hook
 * running" — true, and the opposite of what a reader needs. `stuck` is that shape, and it is the only thing
 * here built out of an ABSENCE, so its boundary is stated rather than implied.
 *
 * A seat is `stuck` when its last tool call is a `Bash` older than the stall line, and NOTHING is running
 * for it: zero hook processes and zero tool shells (`../machine/fleetLoad.ts`'s `toolShellsInFlight`). The
 * tool restriction is the load-bearing part — `Bash` is the one tool whose execution leaves a process, so
 * it is the one tool where "no process" means the call never started. A `Read`, an `Edit` or an `Agent`
 * held the same way is invisible here, and saying so is the honest reading rather than a gap to paper over.
 *
 * Two shapes satisfy it and are NOT a harness hold, both residue rather than bugs to fix. cmux emits one
 * `agent.hook.PreToolUse` frame per tool call and NO frame for the tool's end (`./hookStream.ts`'s header
 * has the measurement), so the age of an in-flight frame also covers the model thinking or streaming after
 * a turn's last tool call, before its `Stop` frame lands; and if a turn-boundary frame is ever dropped, an
 * idle seat's age grows without bound. The line being the same five minutes a stall is graded against is
 * what keeps both rare. So the react line asks for a look, and never asserts a harness defect.
 *
 * ## The stall line is borrowed, never minted
 *
 * The grade reads {@link DEFAULT_HOOK_STALL_HOLD_SECONDS} from `../machine/fleetLoad.ts` — the same line
 * `machine capacity` holds spawns on. A second threshold here would eventually disagree with that one, and
 * two gauges disagreeing about whether the fleet is stalled is worse than one gauge nobody reads.
 */
import type { HookOverrunReading } from "../../transcripts/hookDuration.js";
import type { StrayDevServer } from "../machine/devServers.js";
import {
  briefDuration,
  DEFAULT_HOOK_STALL_HOLD_SECONDS,
  type FleetLoadReading,
  type SessionLoad,
  stalledHookLabel,
} from "../machine/fleetLoad.js";
import { harnessTimeoutReactLines } from "./harnessTimeouts.js";
import type { HookStreamReading, SeatStream } from "./hookStream.js";
import { type Distribution, summarise } from "./quantiles.js";

/**
 * The 1-minute load, relative to the cores that have to carry it.
 *
 * The MULTIPLE is what `machine capacity` already holds spawns on (1.5× the core count), so this report
 * states the ratio rather than minting a second opinion about what "busy" means.
 */
export interface LoadReading {
  /** The 1-minute load average, or `undefined` when the read failed — never zero, which reads as idle. */
  readonly load1: number | undefined;
  /** The machine's core count, or `undefined` when it could not be read. */
  readonly cores: number | undefined;
}

/** One seat's whole row — its `ps` half joined to its stream half. */
export interface SeatPerf {
  /** The Claude Code session id, bare. Present whenever `ps` saw the seat. */
  readonly sessionId: string;
  /** The session process's pid, so a reader can reach it in one `ps -p`. */
  readonly pid: number;
  /** cmux's workspace id, when the stream carried one for this session. */
  readonly workspaceId: string | undefined;
  /** The seat's worktree, when the stream carried one — the only identity a human recognises. */
  readonly cwd: string | undefined;
  /** The seat's summed `%CPU` across its whole tree; 100 is one whole core. */
  readonly cpuPct: number;
  /** Tool calls in flight at the instant of the snapshot. */
  readonly parallelToolCalls: number;
  /** Live hook PROCESSES under this seat — the per-tool-call tsx boot cost. */
  readonly bootsInFlight: number;
  /** The longest LIVE hook's runtime in seconds, or `undefined` when no hook is running. */
  readonly stallSeconds: number | undefined;
  /** WHICH hook that is (`pretooluse-poll-gate`), or `undefined` when no hook is running. */
  readonly stallScript: string | undefined;
  /** Turnaround between consecutive tool calls, in seconds — NOT hook time alone. */
  readonly turnaround: Distribution | undefined;
  /** Tool calls this seat fired inside the stream window. */
  readonly firings: number;
  /** Whether this seat's live hook crossed the stall line. */
  readonly stalled: boolean;
  /** Live tool shells under this seat — zero while a `Bash` call is in flight means it never started. */
  readonly toolShellsInFlight: number;
  /** How long this seat's last tool call has been in flight with no later frame, in seconds. */
  readonly inFlightSeconds: number | undefined;
  /** WHICH tool that in-flight call is for, when the stream frame named one. */
  readonly inFlightTool: string | undefined;
  /** Whether an in-flight `Bash` call is over the line with no hook and no shell running for it. */
  readonly stuck: boolean;
}

/** The whole report. */
export interface PerfReport {
  /** Every seat `ps` attributed, worst first: stalled seats, then by CPU. */
  readonly seats: readonly SeatPerf[];
  /** The machine's load against its cores. */
  readonly load: LoadReading;
  /** Hook processes live across the whole fleet — the number that moves the load average. */
  readonly bootsInFlight: number;
  /** How many seats have a hook over the line. */
  readonly stalledCount: number;
  /** How many seats have an in-flight `Bash` call over the line with nothing running for it. */
  readonly stuckCount: number;
  /** The stall line in seconds, so the summary states what it graded against. */
  readonly stallHoldSeconds: number;
  /** Turnaround across every seat's samples pooled — the fleet's pace in one distribution. */
  readonly fleetTurnaround: Distribution | undefined;
  /** How many `agent.hook.*` frames the window held. Zero means the log was unreadable, never "quiet". */
  readonly frames: number;
  /** The window the stream half folded, in minutes. */
  readonly windowMinutes: number;
  /**
   * The census of calls that already blew their budget, or `undefined` when no transcript could be read at
   * all. `undefined` rather than a zeroed reading on purpose: "nothing overran" and "nothing was measured"
   * are opposite answers, and `./quantiles.ts`'s header carries what conflating them once cost.
   */
  readonly hookOverruns: HookOverrunReading | undefined;
  /**
   * Docs dev servers that outlived what started them — a closed seat, a terminal board
   * row, or a duplicate inside a live seat — or `undefined` when the class could not be measured;
   * `../machine/devServers.ts` says why those two are opposite answers.
   */
  readonly strayDevServers: readonly StrayDevServer[] | undefined;
  /** One line per act this tick owes, empty when nothing is over a line. */
  readonly react: readonly string[];
}

/** The seat a stream row belongs to, matched on the session id `ps` and cmux both carry. */
function streamFor({ session, stream }: { session: SessionLoad; stream: HookStreamReading }): SeatStream | undefined {
  return stream.seats.find((seat) => seat.sessionId === session.sessionId);
}

/** The one tool whose execution leaves a process, so "no process" can mean "it never started". */
const OBSERVABLE_TOOL = "Bash";

/**
 * Whether nothing this machine can see is doing this seat's in-flight work — the `stuck` grade, whose whole
 * claim boundary is in this module's header.
 */
function nothingRunningFor({
  session,
  stream,
  stallHoldSeconds,
}: {
  session: SessionLoad;
  stream: SeatStream | undefined;
  stallHoldSeconds: number;
}): boolean {
  if (stream === undefined || stream.inFlightTool !== OBSERVABLE_TOOL) {
    return false;
  }
  const age = stream.inFlightSeconds;
  if (age === undefined || age < stallHoldSeconds) {
    return false;
  }
  return session.bootsInFlight === 0 && session.toolShellsInFlight === 0;
}

/**
 * A seat's worst-first sort key: stalled seats above everything, then the seats nothing is running for,
 * then by how long each has been over its line, then by CPU. A busy seat is only busy; a wedged one is a
 * defect, which is the ordering, and a held call with no process at all is the stuck finding.
 */
function worseFirst({ a, b }: { a: SeatPerf; b: SeatPerf }): number {
  if (a.stalled !== b.stalled) {
    return a.stalled ? -1 : 1;
  }
  // `stalled` is only ever true off a defined `stallSeconds`, so both readings are there on this branch.
  if (a.stalled && b.stalled) {
    return b.stallSeconds! - a.stallSeconds!;
  }
  if (a.stuck !== b.stuck) {
    return a.stuck ? -1 : 1;
  }
  // Same again for `stuck`, which is only ever true off a defined `inFlightSeconds`.
  if (a.stuck && b.stuck) {
    return b.inFlightSeconds! - a.inFlightSeconds!;
  }
  return b.cpuPct - a.cpuPct;
}

/** What a reader types into `cmux stop` to reach this seat — its workspace id, or its pid when the stream never named one. */
function seatAddress({ seat }: { seat: SeatPerf }): string {
  if (seat.workspaceId !== undefined) {
    return seat.workspaceId;
  }
  return `pid ${String(seat.pid)}`;
}

/** The act a standing stray dev server owes, or nothing when none was found or none was measured. */
function devServerReactLines({
  strayDevServers,
}: {
  strayDevServers: readonly StrayDevServer[] | undefined;
}): readonly string[] {
  if (strayDevServers === undefined || strayDevServers.length === 0) {
    return [];
  }
  const worst = strayDevServers[0]!;
  return [
    // Never "with no seat behind them": that is one of the three reasons, and the commonest one in
    // practice — a duplicate — fires inside a LIVE seat. Each row carries its own `why`.
    `REACT — ${String(strayDevServers.length)} docs dev server(s) outlived what started them, ` +
      `worst ${worst.worktree} (pid ${String(worst.servePid)}: ${worst.why}): end them with ` +
      `\`slopweaver machine reap\`, and see what it would take first with \`slopweaver machine reap --dry-run\``,
  ];
}

/**
 * The acts this tick owes, one line each, each naming the seat and the command that ends it.
 *
 * Deliberately a command rather than a description: the point is the chair ACTING, and a
 * react line that says "seat X is slow" reproduces the `HOLD on cpu` that named nobody.
 */
function reactLines({
  seats,
  stallHoldSeconds,
  hookOverruns,
  strayDevServers,
}: {
  seats: readonly SeatPerf[];
  stallHoldSeconds: number;
  hookOverruns: HookOverrunReading | undefined;
  strayDevServers: readonly StrayDevServer[] | undefined;
}): string[] {
  const lines: string[] = [...devServerReactLines({ strayDevServers })];
  if (hookOverruns !== undefined && hookOverruns.overruns > 0) {
    const budgetSeconds = Math.round(hookOverruns.budgetMs / 1000);
    // Seats are ranked by overruns first, so with a non-zero count the first row is the worst overrun seat.
    const worst = hookOverruns.seats[0]!;
    const overranSeats = hookOverruns.seats.filter((seat) => seat.overruns > 0).length;
    lines.push(
      `REACT — ${String(hookOverruns.overruns)} PreToolUse call(s) spent the whole ${String(budgetSeconds)}s budget and ` +
        `decided NOTHING, across ${String(overranSeats)} seat(s), worst ${worst.cwd} with ` +
        `${String(worst.overruns)}: a door-gated call among them was refused, a tripwire-only one released with ` +
        `no PreToolUse verdict at all. Read them with \`slopweaver perf --json\` and fix the step that is ` +
        `spending the budget — the budget itself never widens`,
    );
  }
  // Only a LIVE seat on a pre-envelope `hooks.json` owes an act; every other harness timeout is folded
  // (`./harnessTimeouts.ts` says why, and what carried pass to pass before it did).
  lines.push(...harnessTimeoutReactLines({ hookOverruns, seats }));
  for (const seat of seats.filter((row) => row.stalled)) {
    const hook = stalledHookLabel({ script: seat.stallScript });
    const where = seatAddress({ seat });
    lines.push(
      `REACT — seat ${seat.sessionId} has its ${hook} stalled ` +
        `${briefDuration({ seconds: seat.stallSeconds! })} (line ${briefDuration({ seconds: stallHoldSeconds })}), ` +
        `${String(seat.bootsInFlight)} hook boots live: stop it with \`slopweaver cmux stop ${where} --why "<what it is costing>"\`, ` +
        `or dispatch an investigation seat with \`slopweaver cmux spawn\``,
    );
  }
  for (const seat of seats.filter((row) => row.stuck && !row.stalled)) {
    const where = seatAddress({ seat });
    lines.push(
      `REACT — seat ${seat.sessionId} has had a Bash call in flight ` +
        `${briefDuration({ seconds: seat.inFlightSeconds! })} (line ${briefDuration({ seconds: stallHoldSeconds })}) ` +
        `with no hook process and no tool shell running for it: nothing this machine can see is doing that ` +
        `work, so either the harness is holding the call or the seat is between frames. Look before acting — ` +
        `\`slopweaver perf seat ${where}\`, then \`slopweaver cmux stop ${where} --why "<what it is costing>"\` ` +
        `if it really is held`,
    );
  }
  return lines;
}

/*
 * One row per seat `ps` attributed, plus the fleet's live hook-boot total, walked once.
 *
 * Extracted from `perfReport` rather than inlined: the assembly is a fold over `fleet.sessions` and the
 * report is a fold over its own result, and holding both in one body put it past `max-function-lines`.
 */
function seatRows({
  fleet,
  stream,
  stallHoldSeconds,
}: {
  fleet: FleetLoadReading;
  stream: HookStreamReading;
  stallHoldSeconds: number;
}): { readonly seats: readonly SeatPerf[]; readonly boots: number } {
  const seats: SeatPerf[] = [];
  let boots = 0;
  for (const session of fleet.sessions) {
    const seatStream = streamFor({ session, stream });
    const stalled = session.hookStallSeconds !== undefined && session.hookStallSeconds >= stallHoldSeconds;
    boots += session.bootsInFlight;
    seats.push({
      bootsInFlight: session.bootsInFlight,
      cpuPct: session.cpuPct,
      cwd: seatStream?.cwd,
      firings: seatStream === undefined ? 0 : seatStream.firings,
      inFlightSeconds: seatStream?.inFlightSeconds,
      inFlightTool: seatStream?.inFlightTool,
      parallelToolCalls: session.parallelToolCalls,
      pid: session.pid,
      sessionId: session.sessionId,
      stallScript: session.hookStallScript,
      stallSeconds: session.hookStallSeconds,
      stalled,
      stuck: nothingRunningFor({ session, stallHoldSeconds, stream: seatStream }),
      toolShellsInFlight: session.toolShellsInFlight,
      turnaround: seatStream?.turnaround,
      workspaceId: seatStream?.workspaceId,
    });
  }
  return { boots, seats };
}

/*
 * Each seat's own p50, which the fleet line summarises again.
 *
 * Pooling the SUMMARY's own samples would need the raw list; the p50 is the representative value the fleet
 * line wants, and weighting by count would over-report the busiest seat's pace as the fleet's.
 */
function pooledSeatP50s({ stream }: { stream: HookStreamReading }): readonly number[] {
  const pooled: number[] = [];
  for (const seat of stream.seats) {
    const turnaround = seat.turnaround;
    if (turnaround !== undefined) {
      pooled.push(turnaround.p50);
    }
  }
  return pooled;
}
/**
 * Build the report.
 *
 * @param fleet the `ps`/`top` attribution `machine capacity` already takes
 * @param stream the cmux hook stream fold
 * @param load the 1-minute load and the core count it is carried by
 * @param stallHoldSeconds the line a live hook is graded against (defaults to the one `machine capacity`
 *   holds spawns on, and a caller passing its own is a test, never a second opinion in production)
 * @param hookOverruns the transcript census, or `undefined` when no transcript could be read
 * @returns the assembled report
 */
export function perfReport({
  fleet,
  stream,
  load,
  hookOverruns,
  strayDevServers,
  stallHoldSeconds = DEFAULT_HOOK_STALL_HOLD_SECONDS,
}: {
  fleet: FleetLoadReading;
  stream: HookStreamReading;
  load: LoadReading;
  hookOverruns: HookOverrunReading | undefined;
  strayDevServers: readonly StrayDevServer[] | undefined;
  stallHoldSeconds?: number;
}): PerfReport {
  const { boots, seats } = seatRows({ fleet, stallHoldSeconds, stream });
  const ordered = seats.toSorted((a, b) => worseFirst({ a, b }));
  return {
    bootsInFlight: boots,
    fleetTurnaround: summarise({ samples: pooledSeatP50s({ stream }) }),
    frames: stream.frames,
    hookOverruns,
    load,
    react: reactLines({ hookOverruns, seats: ordered, stallHoldSeconds, strayDevServers }),
    seats: ordered,
    stallHoldSeconds,
    stalledCount: ordered.filter((seat) => seat.stalled).length,
    strayDevServers,
    stuckCount: ordered.filter((seat) => seat.stuck).length,
    windowMinutes: Math.round(stream.windowMs / 60_000),
  };
}
