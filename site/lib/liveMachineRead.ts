/**
 * The effectful shell of the Fleet page's live machine reading: the reads one snapshot takes, inside the console
 * server, and the one baseline the next read differences against.
 *
 * Inside the server, never a `slopweaver` child: a `machine series` read starts a CLI process and runs `top` for a
 * second, 2.9 s measured, and queues behind every other console read. These reads cost about a third of a second
 * together on a busy machine — measured at load ~20, each timed alone: `ps … comm=` 0.15 s, `ps … args=`
 * 0.12 s, `vm_stat` 0.03 s, `sysctl` 0.03 s; `os.cpus()` and `os.loadavg()` take no subprocess. Reproduce one with
 * `time /bin/ps -axww -o pid=,ppid=,time=,rss=,comm= > /dev/null`. They are synchronous because `no-headless` refuses
 * the async child-process API here; a read answered within the last second is served again rather than re-read, so
 * two open tabs cost one read. A read with no baseline from the last ten seconds — the server's first, or a tab
 * opening after every other closed — takes two snapshots a second apart, so its CPU is measured, never "measuring".
 */
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { cpus, homedir, loadavg, totalmem } from "node:os";
import { dirname, join } from "node:path";
import { performance } from "node:perf_hooks";
import { setTimeout } from "node:timers/promises";

import { err, ok, type Result } from "neverthrow";

import {
  type CpuTickSnapshot,
  freshBaselineOf,
  type LiveMachineReading,
  type LiveMachineSnapshot,
  type LiveSessionRoot,
  liveMachineReadingOf,
} from "./liveMachine";
import {
  compressorSegmentsPctOf,
  countSwapfiles,
  type LiveMachineError,
  LiveMachineErrors,
  parseArgvRows,
  parseProcessStats,
  parseVmStatUsedBytes,
} from "./liveMachineParse";

/** The binaries, absolute, so the console's `PATH` decides nothing. */
const PS_BINARY = "/bin/ps";
const VM_STAT_BINARY = "/usr/bin/vm_stat";
const SYSCTL_BINARY = "/usr/sbin/sysctl";

/** How long any one read may block the server: each is a local snapshot, quick or broken. */
const READ_TIMEOUT_MS = 2_000;

/** More stdout than a whole-machine `ps` listing produces. */
const MAX_BUFFER = 16 * 1024 * 1024;

/** How long one answered reading is served again instead of re-read. */
const SERVE_AGAIN_MS = 1_000;

/**
 * One subprocess's stdout, or `undefined` when it failed.
 *
 * @returns the stdout
 */
function run({ file, args }: { file: string; args: readonly string[] }): string | undefined {
  try {
    return execFileSync(file, [...args], { encoding: "utf8", maxBuffer: MAX_BUFFER, timeout: READ_TIMEOUT_MS });
  } catch {
    return undefined;
  }
}

/**
 * The kernel's per-core counters, summed: idle and total milliseconds since boot.
 *
 * @returns the counters, or `undefined` when no core reported
 */
function cpuTicks(): CpuTickSnapshot | undefined {
  const all = cpus();
  if (all.length === 0) {
    return undefined;
  }
  let idleMs = 0;
  let totalMs = 0;
  for (const core of all) {
    idleMs += core.times.idle;
    totalMs += core.times.user + core.times.nice + core.times.sys + core.times.idle + core.times.irq;
  }
  return { cores: all.length, idleMs, totalMs };
}

/**
 * Every session root Claude Code's own registry names, one JSON file per running `claude` pid. A file that will not
 * read is a diagnostic, not a failure: the argv's own `--session-id` still finds a session the registry misses.
 *
 * @returns the roots, and a line per file that would not read
 */
function registryRoots(): { roots: readonly LiveSessionRoot[]; diagnostics: readonly string[] } {
  const directory = join(homedir(), ".claude", "sessions");
  let names: readonly string[];
  try {
    names = readdirSync(directory).filter((name) => name.endsWith(".json"));
  } catch (cause) {
    return { diagnostics: [`the session registry ${directory} could not be listed: ${String(cause)}`], roots: [] };
  }
  const roots: LiveSessionRoot[] = [];
  const diagnostics: string[] = [];
  for (const name of names) {
    try {
      const parsed: unknown = JSON.parse(readFileSync(join(directory, name), "utf8"));
      const pid = typeof parsed === "object" && parsed !== null ? Reflect.get(parsed, "pid") : undefined;
      const sessionId = typeof parsed === "object" && parsed !== null ? Reflect.get(parsed, "sessionId") : undefined;
      if (typeof pid === "number" && typeof sessionId === "string" && sessionId.length > 0) {
        roots.push({ pid, sessionId });
      } else {
        diagnostics.push(`session registry file ${name} names no pid and session id`);
      }
    } catch {
      // A file gone between the listing and the read is a session that just exited; its pid is no longer running.
    }
  }
  return { diagnostics, roots };
}

/**
 * How many swapfiles are on disk, the way `src/live/machine/read.ts` counts them.
 *
 * @returns the count, or `undefined` when the directory could not be read
 */
function swapfileCount(): number | undefined {
  const prefix = run({ args: ["-n", "vm.swapfileprefix"], file: SYSCTL_BINARY });
  if (prefix === undefined || prefix.trim() === "") {
    return undefined;
  }
  try {
    return countSwapfiles({ entries: readdirSync(dirname(prefix.trim())), prefix });
  } catch {
    return undefined;
  }
}

/**
 * Take one snapshot. Every read the meters stand on is required; the memory-pressure gauges are optional, and their
 * absence leaves the verdict saying it could not judge memory.
 *
 * @returns the snapshot, or which read failed
 */
function takeSnapshot(): Result<LiveMachineSnapshot, LiveMachineError> {
  // Stamped beside the kernel's counters, before the slower reads, so the instant a reading names is the instant its
  // CPU was sampled, and two snapshots' stamps measure the interval their counters span.
  const monotonicMs = performance.now();
  const observedAtIso = new Date().toISOString();
  const cpu = cpuTicks();
  if (cpu === undefined) {
    return err(LiveMachineErrors.readFailed({ read: "the kernel's CPU counters" }));
  }
  const stats = run({ args: ["-axww", "-o", "pid=,ppid=,time=,rss=,comm="], file: PS_BINARY });
  const argv = run({ args: ["-axww", "-o", "pid=,args="], file: PS_BINARY });
  if (stats === undefined || argv === undefined) {
    return err(LiveMachineErrors.readFailed({ read: "ps" }));
  }
  const vmStat = run({ args: [], file: VM_STAT_BINARY });
  if (vmStat === undefined) {
    return err(LiveMachineErrors.readFailed({ read: "vm_stat" }));
  }
  const used = parseVmStatUsedBytes({ text: vmStat });
  if (used.isErr()) {
    return err(used.error);
  }
  const load1 = loadavg().at(0);
  if (load1 === undefined) {
    return err(LiveMachineErrors.readFailed({ read: "the load average" }));
  }
  const compressor = run({ args: ["vm.compressor.segment.total", "vm.compressor.segment.limit"], file: SYSCTL_BINARY });
  const processes = parseProcessStats({ text: stats });
  const registry = registryRoots();
  const diagnostics = [...registry.diagnostics];
  if (processes.refused > 0) {
    diagnostics.push(`${String(processes.refused)} ps line(s) did not decode and are not counted`);
  }
  return ok({
    argvByPid: parseArgvRows({ text: argv }),
    compressorSegmentsPct: compressor === undefined ? undefined : compressorSegmentsPctOf({ text: compressor }),
    cpu,
    diagnostics,
    load1,
    monotonicMs,
    observedAtIso,
    processes: processes.rows,
    registry: registry.roots,
    swapfileCount: swapfileCount(),
    totalMemoryBytes: totalmem(),
    usedMemoryBytes: used.value,
  });
}

/**
 * How far apart the two snapshots of a warming read are: long enough that a busy core's ticks are counted, short
 * enough that a tab opening on a quiet server draws within a second of its spinner.
 */
const WARM_INTERVAL_MS = 1_000;

/** The last complete snapshot, the next read's baseline. Held by this server process only. */
let baseline: LiveMachineSnapshot | undefined;

/** The last reading answered, and when, so a second tab within {@link SERVE_AGAIN_MS} rides it. */
let answered: { readonly reading: LiveMachineReading; readonly atMs: number } | undefined;

/** The read in progress, so two tabs asking at once share it rather than each warming. */
let inFlight: Promise<Result<LiveMachineReading, LiveMachineError>> | undefined;

/**
 * One read: against the last snapshot when it is fresh as of the snapshot just taken, and otherwise that snapshot
 * becomes the baseline for one taken {@link WARM_INTERVAL_MS} later, so CPU is always an interval of at most ten
 * seconds and never an average over the hours nobody looked. Freshness is judged at the new snapshot's own stamp,
 * never before it was taken, so a slow read cannot stretch an accepted interval past the bound. A
 * snapshot that failed leaves the baseline where it was.
 *
 * @returns the reading, or why it could not be taken
 */
async function readNow(): Promise<Result<LiveMachineReading, LiveMachineError>> {
  const taken = takeSnapshot();
  if (taken.isErr()) {
    return err(taken.error);
  }
  let current = taken.value;
  let previous = freshBaselineOf({ baseline, nowMs: current.monotonicMs });
  if (previous === undefined) {
    previous = current;
    baseline = current;
    await setTimeout(WARM_INTERVAL_MS);
    const warmed = takeSnapshot();
    if (warmed.isErr()) {
      return err(warmed.error);
    }
    current = warmed.value;
  }
  const reading = liveMachineReadingOf({ current, previous });
  baseline = current;
  if (reading.isOk()) {
    answered = { atMs: current.monotonicMs, reading: reading.value };
  }
  return reading;
}

/**
 * The live reading: served again when one was answered within the last second, joined when one is in progress, and
 * otherwise read now.
 *
 * @returns the reading, or why it could not be taken
 */
export async function readLiveMachine(): Promise<Result<LiveMachineReading, LiveMachineError>> {
  if (answered !== undefined && performance.now() - answered.atMs < SERVE_AGAIN_MS) {
    return ok(answered.reading);
  }
  if (inFlight !== undefined) {
    return inFlight;
  }
  const started = readNow().finally(() => {
    inFlight = undefined;
  });
  inFlight = started;
  return started;
}
