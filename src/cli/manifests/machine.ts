/**
 * Lazy manifest for the `machine` noun — read-only gauges of the machine Slopweaver is running on, as
 * opposed to `dev`'s repo-development verbs. `capacity` reads the machine — top memory footprints, swap and
 * load, classified fleet vs foreign, WHICH fleet session or dead seat is burning the CPU, and every plan and
 * machine ceiling's unused share now; `unused` measures the same ceilings over past days off histories on
 * disk; `series` keeps the last hour of cheap one-second samples the Fleet page charts; `reap` kills the orphaned
 * fleet shells whose seat is gone. Loads only when dispatched.
 */
import { lazy, type VerbManifestEntry } from "../manifest.js";

const capacityMeta = {
  createsWorkItem: false,
  diagnostic: true,
  doorRouted: false,
  // A bare call (no flags at all) still spawns `top`/`ps`/`sysctl` — only the PARSE-REJECT path (an unknown
  // flag) is side-effect-free, which `parseRejectIsIoFree` covers separately.
  dryParseSafe: false,
  effect: "local-state",
  example: "slopweaver machine capacity --brief",
  parseRejectIsIoFree: true,
  summary:
    "Top memory footprints (Activity Monitor's Memory column, not ps RSS), swap, load, compressor segments and swapfiles — a HOLD on spawns when the compressor nears its limit — and what is unused now on every Claude, Codex and machine ceiling, naming the lowest; --brief prints only the verdict a tick acts on",
  usage:
    "usage: slopweaver machine capacity [--top <n>] [--home <dir>] [--json] [--brief] [--full] [--wait] [--timeout-seconds <n>]",
} as const;

const reapMeta = {
  createsWorkItem: false,
  diagnostic: false,
  doorRouted: false,
  // A bare call reads `ps`/`top` and may SIGKILL; only the parse-reject path is side-effect-free.
  dryParseSafe: false,
  effect: "local-state",
  example: "slopweaver machine reap --dry-run",
  parseRejectIsIoFree: true,
  summary:
    "Kill the orphaned fleet shells whose seat is dead — parent launchd, argv sourcing a Claude Code shell snapshot no live process shares — plus stray dev servers and a live seat's runaway grep/rg children (the search alone, never its seat), and close browser sessions whose opener is gone or that sat idle past their expiry (never by age from open); report what it did",
  usage: "usage: slopweaver machine reap [--dry-run] [--json]",
} as const;

const watchMeta = {
  createsWorkItem: true,
  // A dispatch is a FOUND FAULT, not a broken tool — the same reasoning `capacity` carries.
  diagnostic: true,
  doorRouted: false,
  // A bare call samples the machine with `top`/`ps` and may open a cmux workspace.
  dryParseSafe: false,
  effect: "local-state",
  example: "slopweaver machine watch --once",
  parseRejectIsIoFree: true,
  summary:
    "Sample the machine between supervisor ticks and dispatch a visible investigation when a reading is anomalous — a capacity hold, one process sustaining 3 cores, or one session tree over 40 non-hook processes",
  usage:
    "usage: slopweaver machine watch [--once] [--for-seconds <n>] [--interval-seconds <n>] [--home <dir>] [--json]",
} as const;

const dispatchesMeta = {
  createsWorkItem: false,
  diagnostic: false,
  doorRouted: false,
  dryParseSafe: false,
  effect: "local-state",
  example: "slopweaver machine dispatches",
  parseRejectIsIoFree: true,
  summary:
    "The anomalous-load finding register — each row's triggers, culprit and process tree, and the investigation it seated; `settle <id> --witness` is the only way a row stops being open",
  usage:
    "usage: slopweaver machine dispatches [--all] [--home <dir>] [--json] | settle <id> --witness <what you found>",
} as const;

const unusedMeta = {
  createsWorkItem: false,
  diagnostic: false,
  doorRouted: false,
  // A bare call reads the drawdown journal, every Codex home's rollout logs and the tick ledger.
  dryParseSafe: false,
  effect: "none",
  example: "slopweaver machine unused --days 7",
  parseRejectIsIoFree: true,
  summary:
    "How much of each Claude plan's windows, each Codex plan's windows and the machine's load hold went unused over the last N days, off histories already on disk — no provider probe",
  usage: "usage: slopweaver machine unused [--days <n>] [--home <dir>] [--json]",
} as const;

const seriesMeta = {
  createsWorkItem: false,
  diagnostic: false,
  doorRouted: false,
  // A bare call may run `top`/`ps`/`sysctl` and rewrite the ring; only the parse-reject path is side-effect-free.
  dryParseSafe: false,
  effect: "local-state",
  example: "slopweaver machine series --json",
  parseRejectIsIoFree: true,
  summary:
    "The last hour of the machine for the Fleet page's charts: CPU split fleet and other by whole process tree, load against its hold, memory, compressor, swap, each session's tree and the heaviest other processes, one top sample per thirty seconds at most",
  usage: "usage: slopweaver machine series [--home <dir>] [--json]",
} as const;

const loadCapacity = () => import("../commands/machine/capacity.js").then((m) => m.machineCapacityCommand);
const loadWatch = () => import("../commands/machine/watch.js").then((m) => m.machineWatchCommand);
const loadDispatches = () => import("../commands/machine/dispatches.js").then((m) => m.machineDispatchesCommand);
const loadReap = () => import("../commands/machine/reap.js").then((m) => m.machineReapCommand);
const loadSeries = () => import("../commands/machine/series.js").then((m) => m.machineSeriesCommand);
const loadUnused = () => import("../commands/machine/unused.js").then((m) => m.machineUnusedCommand);

export const machineManifest: Readonly<Record<string, VerbManifestEntry>> = {
  capacity: lazy({ load: loadCapacity, meta: capacityMeta }),
  dispatches: lazy({ load: loadDispatches, meta: dispatchesMeta }),
  reap: lazy({ load: loadReap, meta: reapMeta }),
  series: lazy({ load: loadSeries, meta: seriesMeta }),
  unused: lazy({ load: loadUnused, meta: unusedMeta }),
  watch: lazy({ load: loadWatch, meta: watchMeta }),
};
