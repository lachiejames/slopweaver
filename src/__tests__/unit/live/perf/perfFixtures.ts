/**
 * Fixtures for the `perf` fold — plain builders, no mocks: `perfReport` takes its three readings as values,
 * so a test constructs them directly and nothing needs to be intercepted.
 */
import type { FleetLoadReading, SessionLoad } from "../../../../live/machine/fleetLoad.js";
import type { HookStreamReading, SeatStream } from "../../../../live/perf/hookStream.js";
import { summarise } from "../../../../live/perf/quantiles.js";
import type { LoadReading } from "../../../../live/perf/report.js";

/**
 * One `ps` half row.
 *
 * @returns the SessionLoad `perfReport` reads, with every field a caller did not pin left at a quiet default
 */
export function sessionLoad({
  sessionId,
  pid,
  cpuPct = 10,
  parallelToolCalls = 0,
  bootsInFlight = 0,
  toolShellsInFlight = 0,
  hookStallSeconds,
  hookStallScript,
}: {
  sessionId: string;
  pid: number;
  cpuPct?: number;
  parallelToolCalls?: number;
  bootsInFlight?: number;
  toolShellsInFlight?: number;
  hookStallSeconds?: number | undefined;
  hookStallScript?: string | undefined;
}): SessionLoad {
  return {
    bootsInFlight,
    cpuPct,
    hookStallScript,
    hookStallSeconds,
    nonHookProcessCount: 4,
    parallelToolCalls,
    pid,
    processCount: 4 + bootsInFlight,
    sessionId,
    toolShellsInFlight,
    tree: [],
  };
}

/**
 * The `ps` half.
 *
 * @returns a FleetLoadReading carrying those sessions and no orphans
 */
export function fleetReading({ sessions }: { sessions: readonly SessionLoad[] }): FleetLoadReading {
  return { cpuAttributed: true, orphanCount: 0, orphanCpuPct: 0, orphans: [], sessions };
}

/**
 * One stream half row.
 *
 * @param turnaroundSamples the gaps in seconds, summarised by the REAL summariser so a fixture cannot
 *   disagree with production
 * @returns the SeatStream the report joins onto its `ps` row
 */
export function seatStream({
  sessionId,
  workspaceId,
  cwd,
  firings = 0,
  turnaroundSamples = [],
  inFlightSeconds,
  inFlightTool,
}: {
  sessionId: string;
  workspaceId?: string | undefined;
  cwd?: string | undefined;
  firings?: number;
  turnaroundSamples?: readonly number[];
  inFlightSeconds?: number | undefined;
  inFlightTool?: string | undefined;
}): SeatStream {
  // The REAL summariser, so a fixture can never disagree with what production computes.
  const distribution = summarise({ samples: turnaroundSamples });
  return {
    cwd,
    firings,
    inFlightSeconds,
    inFlightTool,
    sessionId,
    turnaround: distribution,
    workspaceId,
  };
}

/**
 * The stream half.
 *
 * @returns a HookStreamReading over a fixed 60-minute window
 */
export function streamReading({
  seats,
  frames = 100,
  byName = [{ count: 100, name: "agent.hook.PreToolUse" }],
}: {
  seats: readonly SeatStream[];
  frames?: number;
  byName?: readonly { readonly name: string; readonly count: number }[];
}): HookStreamReading {
  return { byName, frames, seats, windowMs: 60 * 60 * 1000 };
}

/** The machine's load half. */
export const LOAD: LoadReading = { cores: 15, load1: 7.5 };
