/**
 * The effectful shell of `slopweaver machine series`: the machine reads one sample needs, and the locked
 * read-sample-rewrite of the ring. Synchronous subprocesses only, for the reason `./read.ts` gives (`no-headless`
 * bans the async `node:child_process` API repo-wide).
 *
 * The lock is what makes two pages polling at once cost one `top`, not two: the second caller waits, re-reads the
 * ring under the lock, finds the first caller's fresh sample and prints it.
 */
import { execFileSync } from "node:child_process";
import { cpus, totalmem } from "node:os";

import { acquireOperationLockWaiting } from "../../admit/operationLockWait.js";
import { err, ok, type Result } from "../../lib/result.js";
import { defaultSessionsDir } from "../../measurement/sessions.js";
import { scanSessions } from "../../sessions/liveSessionStore.js";
import { realWaitClock } from "../../wait/loop.js";
import { type ProcessRow, parseProcessRows } from "../standing/processes.js";
import { type ProcessComm, parseCommRows, parseCompressorSysctl, parseSwapUsage } from "./capacityParse.js";
import { buildMachineSeriesSample, type MachineSeriesInputs, type MachineSeriesSample } from "./series.js";
import {
  type MachineSeriesError,
  MachineSeriesErrors,
  type MachineSeriesStoreError,
  MachineSeriesStoreErrors,
} from "./seriesErrors.js";
import { parseMachineSeriesTop, parseVmStatUsedBytes } from "./seriesParse.js";
import { type MachineSeriesDocument, machineSeriesDocument, retainMachineSeries, sampleFresh } from "./seriesRing.js";
import { readMachineSeries, writeMachineSeries } from "./seriesStore.js";
import type { ClaudeSession } from "./sessionOwner.js";

/** The lock key two concurrent samplers share. */
const MACHINE_SERIES_LOCK_KEY = "machine-series-sample";

/** How long a caller waits for another caller's sample before giving up: a sample takes about one second. */
const LOCK_WAIT_SECONDS = 5;

/** How long any one read may block. Each is a local snapshot: quick, or broken. */
const READ_TIMEOUT_MS = 10_000;

/** More stdout than a `top` or `ps` snapshot produces, so a read never dies of ENOBUFS. */
const MAX_BUFFER = 8 * 1024 * 1024;

/** The four compressor oids `./capacityParse.ts#parseCompressorSysctl` reads. */
const COMPRESSOR_OIDS = [
  "vm.compressor.segment.total",
  "vm.compressor.segment.limit",
  "vm.compressor_segment_pages_compressed",
  "vm.compressor_segment_pages_compressed_limit",
] as const;

/** The reads one sample takes, injected so a test never shells out. Each answers `undefined` when it failed. */
export interface MachineSeriesDeps {
  /** `top -l 2 -s 1 -stats pid,cpu,mem`'s stdout. */
  readonly top: () => string | undefined;
  /** The whole process table with parents and argv, decoded. */
  readonly processes: () => readonly ProcessRow[] | undefined;
  /** Every process's short command name, decoded. */
  readonly comms: () => readonly ProcessComm[] | undefined;
  /** Every live Claude Code session the registry names. */
  readonly sessions: () => readonly ClaudeSession[];
  /** The core count, which sizes the load hold. */
  readonly cores: () => number | undefined;
  /** The four compressor oids' stdout. */
  readonly compressorSysctl: () => string | undefined;
  /** `sysctl vm.swapusage`'s stdout. */
  readonly swapUsage: () => string | undefined;
  /** `vm_stat`'s stdout, which memory in use is summed from. */
  readonly vmStat: () => string | undefined;
  /** The machine's physical memory in bytes. */
  readonly totalMemory: () => number | undefined;
}

/**
 * Take one sample through the seams. Every read is required: a sample missing one is the error naming it, never a
 * zero on the chart.
 *
 * @param nowIso stamps the sample once its reads are in, so its instant is when `top` finished measuring
 * @returns the sample, or which read failed
 */
export function takeMachineSeriesSample({
  deps,
  nowIso,
}: {
  deps: MachineSeriesDeps;
  nowIso: () => string;
}): Result<MachineSeriesSample, MachineSeriesError> {
  const topText = deps.top();
  if (topText === undefined) {
    return err(MachineSeriesErrors.readFailed({ read: "top" }));
  }
  const top = parseMachineSeriesTop({ text: topText });
  if (top.isErr()) {
    return err(top.error);
  }
  const processes = deps.processes();
  if (processes === undefined) {
    return err(MachineSeriesErrors.readFailed({ read: "ps" }));
  }
  const comms = deps.comms();
  if (comms === undefined) {
    return err(MachineSeriesErrors.readFailed({ read: "comm" }));
  }
  const cores = deps.cores();
  if (cores === undefined) {
    return err(MachineSeriesErrors.readFailed({ read: "cores" }));
  }
  const memory = readMemory({ deps });
  if (memory.isErr()) {
    return err(memory.error);
  }
  return ok(
    buildMachineSeriesSample({
      ...memory.value,
      comms,
      cores,
      observedAtIso: nowIso(),
      processes,
      sessions: deps.sessions(),
      top: top.value,
    }),
  );
}

/**
 * The memory half of one sample: the compressor, swap, memory in use and physical memory, each required.
 *
 * @returns the four readings, or which read failed
 */
function readMemory({
  deps,
}: {
  deps: MachineSeriesDeps;
}): Result<
  Pick<MachineSeriesInputs, "compressor" | "swap" | "memoryUsedBytes" | "memoryTotalBytes">,
  MachineSeriesError
> {
  const compressorText = deps.compressorSysctl();
  const compressor = compressorText === undefined ? undefined : parseCompressorSysctl({ text: compressorText });
  if (compressor === undefined) {
    return err(MachineSeriesErrors.readFailed({ read: "compressor" }));
  }
  const swapText = deps.swapUsage();
  const swap = swapText === undefined ? undefined : parseSwapUsage({ text: swapText });
  if (swap === undefined) {
    return err(MachineSeriesErrors.readFailed({ read: "swap" }));
  }
  const vmStatText = deps.vmStat();
  if (vmStatText === undefined) {
    return err(MachineSeriesErrors.readFailed({ read: "vm_stat" }));
  }
  const memoryUsedBytes = parseVmStatUsedBytes({ text: vmStatText });
  if (memoryUsedBytes.isErr()) {
    return err(memoryUsedBytes.error);
  }
  const memoryTotalBytes = deps.totalMemory();
  if (memoryTotalBytes === undefined) {
    return err(MachineSeriesErrors.readFailed({ read: "memory" }));
  }
  return ok({ compressor, memoryTotalBytes, memoryUsedBytes: memoryUsedBytes.value, swap });
}

/** Whatever stops the verb printing a window. */
export type MachineSeriesRefreshError = MachineSeriesError | MachineSeriesStoreError;

/**
 * The ring after this call, under the lock: read it, sample when the newest row is older than the minimum gap,
 * keep the window, rewrite it, and build the document. A fresh ring is printed without running `top` at all.
 *
 * @param home the state home the ring and the lock live under
 * @param nowIso the clock: read once to judge freshness, and again to stamp a new sample
 * @returns the document, or the first failure
 */
export async function refreshMachineSeries({
  home,
  deps,
  nowIso,
}: {
  home: string;
  deps: MachineSeriesDeps;
  nowIso: () => string;
}): Promise<Result<MachineSeriesDocument, MachineSeriesRefreshError>> {
  const lock = await acquireOperationLockWaiting({
    clock: realWaitClock(),
    emit: () => undefined,
    home,
    key: MACHINE_SERIES_LOCK_KEY,
    nowIso,
    timeoutSeconds: LOCK_WAIT_SECONDS,
  });
  if (lock.isErr()) {
    return err(MachineSeriesStoreErrors.lockHeld({ why: lock.error }));
  }
  try {
    return refreshUnderLock({ deps, home, nowIso });
  } finally {
    lock.value.release();
  }
}

/**
 * {@link refreshMachineSeries}'s body, with the lock already held.
 *
 * @returns the document, or the first failure
 */
function refreshUnderLock({
  home,
  deps,
  nowIso,
}: {
  home: string;
  deps: MachineSeriesDeps;
  nowIso: () => string;
}): Result<MachineSeriesDocument, MachineSeriesRefreshError> {
  const stored = readMachineSeries({ home });
  if (stored.isErr()) {
    return err(stored.error);
  }
  if (sampleFresh({ nowIso: nowIso(), samples: stored.value })) {
    return machineSeriesDocument({ samples: stored.value });
  }
  const sample = takeMachineSeriesSample({ deps, nowIso });
  if (sample.isErr()) {
    return err(sample.error);
  }
  const kept = retainMachineSeries({
    nowIso: sample.value.observedAtIso,
    samples: [...stored.value, sample.value],
  });
  const written = writeMachineSeries({ home, samples: kept });
  if (written.isErr()) {
    return err(written.error);
  }
  return machineSeriesDocument({ samples: kept });
}

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
 * The real reads: `top`, `ps`, `sysctl`, `vm_stat`, `os.cpus()`, `os.totalmem()` and the Claude Code session
 * registry.
 *
 * @returns the production {@link MachineSeriesDeps}
 */
export function productionMachineSeriesDeps(): MachineSeriesDeps {
  return {
    comms: () => {
      const text = run({ args: ["-ax", "-o", "pid=,comm="], file: "ps" });
      return text === undefined ? undefined : parseCommRows({ text });
    },
    compressorSysctl: () => run({ args: COMPRESSOR_OIDS, file: "sysctl" }),
    cores: () => {
      // `os.cpus()` reads `hw.ncpu` without a subprocess; an empty array is no reading, never zero cores.
      const count = cpus().length;
      return count > 0 ? count : undefined;
    },
    processes: () => {
      const text = run({ args: ["-ax", "-o", "pid=,ppid=,args="], file: "ps" });
      return text === undefined ? undefined : parseProcessRows({ text });
    },
    sessions: () =>
      scanSessions({ sessionsDir: defaultSessionsDir() }).records.map((record): ClaudeSession => ({
        cwd: record.cwd,
        pid: record.pid,
        sessionId: record.sessionId,
      })),
    swapUsage: () => run({ args: ["vm.swapusage"], file: "sysctl" }),
    // Two samples one second apart: only the second carries a measured per-process %CPU.
    top: () => run({ args: ["-l", "2", "-s", "1", "-stats", "pid,cpu,mem"], file: "top" }),
    totalMemory: () => {
      // `os.totalmem()` reads `hw.memsize` without a subprocess; zero is no reading, never an empty machine.
      const bytes = totalmem();
      return bytes > 0 ? bytes : undefined;
    },
    vmStat: () => run({ args: [], file: "vm_stat" }),
  };
}
