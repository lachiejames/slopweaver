/**
 * Lazy manifest for the `perf` noun — what the FLEET is costing, with progressive disclosure.
 *
 * A separate noun from `machine` on purpose: `machine capacity` grades the BOX (memory, swap, the
 * compressor) and holds spawns, while `perf` answers "which seat is slow, and why" and hands back the
 * command that ends it. They share every reading and neither owns a threshold the other disagrees with —
 * `perf` borrows `machine capacity`'s own stall line rather than minting a second one.
 *
 * The default verb is the SUMMARY, so a sweep step is `slopweaver perf --json` and the drill-downs are
 * `perf seat` and `perf hook`.
 */
import { DEFAULT_VERB, lazy, type VerbManifestEntry } from "../manifest.js";

const summaryMeta = {
  createsWorkItem: false,
  diagnostic: true,
  doorRouted: false,
  // A bare call spawns `ps`/`top`/`sysctl` and reads cmux's event log; only the parse-reject path is free.
  dryParseSafe: false,
  effect: "local-state",
  example: "slopweaver perf --json",
  parseRejectIsIoFree: true,
  summary:
    "One line on what the fleet is costing — load against cores, stalled hooks NAMED, seats with nothing running for an in-flight call, hook boots live, turnaround p50/p95 — and a REACT line per stall carrying the command that ends it",
  usage: "usage: slopweaver perf [--window-minutes <n>] [--json]",
} as const;

const seatMeta = {
  createsWorkItem: false,
  diagnostic: true,
  doorRouted: false,
  // The seat reference is required: `runPerfSeat` refuses a bare run and an unknown flag before `perfReading` spawns anything.
  dryParseSafe: true,
  effect: "local-state",
  example: "slopweaver perf seat 00000104-0000-4000-8000-000000000115",
  parseRejectIsIoFree: true,
  summary:
    "One seat in full — its cpu, its in-flight tool calls, its live hook boots and tool shells, which hook is running, how long its last call has been in flight, and its turnaround distribution",
  usage: "usage: slopweaver perf seat <workspace-id|session-id|worktree-path|pid> [--window-minutes <n>] [--json]",
} as const;

const hookMeta = {
  createsWorkItem: false,
  diagnostic: true,
  doorRouted: false,
  // The hook name is required: `runPerfHook` refuses a bare run and an unknown flag before `perfReading` spawns anything.
  dryParseSafe: true,
  effect: "local-state",
  example: "slopweaver perf hook poll-gate",
  parseRejectIsIoFree: true,
  summary: "One hook across every seat — where it is live, for how long, and whether it crossed the stall line",
  usage: "usage: slopweaver perf hook <name> [--window-minutes <n>] [--json]",
} as const;

const consoleMeta = {
  createsWorkItem: false,
  diagnostic: true,
  doorRouted: false,
  // A bare call launches a browser, walks the console and spawns its reads; only the parse-reject path is free.
  dryParseSafe: false,
  effect: "local-state",
  example: "slopweaver perf console --base http://localhost:3100",
  parseRejectIsIoFree: true,
  summary:
    "The console profiled in a LAUNCHED browser — every fixed route cold (TTFB, first paint, drawn, fully loaded, heap, DOM), every sidebar item and in-page flow warm, each live read alone — as median tables against named budgets, kept under $SLOPWEAVER_HOME/perf/console",
  usage:
    "usage: slopweaver perf console [--base <url>] [--runs <n>] [--only <path,...>] [--headed] [--skip-verbs] [--check] [--json] [--home <dir>]",
} as const;

const loadConsole = () => import("../commands/perf/console.js").then((m) => m.perfConsoleCommand);
const loadSummary = () => import("../commands/perf/summary.js").then((m) => m.perfSummaryCommand);
const loadSeat = () => import("../commands/perf/seat.js").then((m) => m.perfSeatCommand);
const loadHook = () => import("../commands/perf/hook.js").then((m) => m.perfHookCommand);

export const perfManifest: Readonly<Record<string, VerbManifestEntry>> = {
  [DEFAULT_VERB]: lazy({ load: loadSummary, meta: summaryMeta }),
  console: lazy({ load: loadConsole, meta: consoleMeta }),
  hook: lazy({ load: loadHook, meta: hookMeta }),
  seat: lazy({ load: loadSeat, meta: seatMeta }),
};
