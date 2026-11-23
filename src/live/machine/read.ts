/**
 * The real subprocess edges `slopweaver machine capacity` has: `top`, `sysctl` (swap usage, the compressor
 * oids, the swapfile prefix), a directory listing for the swapfile count, the core count that sizes the load
 * hold, and the process-table snapshot `../standing/processes.js` already knows how to decode. Synchronous by
 * construction, not by habit — `no-headless` bans the async `node:child_process` API repo-wide (AGENTS.md
 * rule 2, no allowlist).
 */
import { execFileSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { cpus } from "node:os";
import { dirname } from "node:path";

import { defaultSessionsDir } from "../../measurement/sessions.js";
import { mainCheckoutsFromProfile } from "../../profileStore.js";
import { scanSessions } from "../../sessions/liveSessionStore.js";
import { claudeHeldPin } from "../../sessions/supervisorPin.js";
import { readSupervisorPin } from "../../sessions/supervisorPinStore.js";
import { worktreePruneFloorGb } from "../../worktree/pruneFloor.js";
import { listRepoWorktrees } from "../../worktree/pruneScan.js";
import { productionPruneTriggerDeps, requestWorktreePrune } from "../../worktree/pruneTriggerLaunch.js";
import { type ProcessRow, parseProcessRows } from "../standing/processes.js";
import { countSwapfiles, type ProcessComm, parseCommRows } from "./capacityParse.js";
import {
  type DiskReading,
  diskReadingOf,
  parseDfKib,
  type RepoWorktreeCount,
  type VolumeReading,
} from "./diskFootprint.js";
import { type ProcessElapsed, parseElapsedRows } from "./fleetLoad.js";
import { type ProcessStatRow, parseProcessStatRows } from "./hiddenCpu.js";
import type { ClaudeSession } from "./sessionOwner.js";

/** The four compressor oids `./capacity.ts#parseCompressorSysctl` reads — the two ratios the panic log grades. */
const COMPRESSOR_OIDS = [
  "vm.compressor.segment.total",
  "vm.compressor.segment.limit",
  "vm.compressor_segment_pages_compressed",
  "vm.compressor_segment_pages_compressed_limit",
] as const;

/** How long any one of these reads may block. Each is a single local syscall-backed snapshot — quick, or broken. */
export const READ_TIMEOUT_MS = 10_000;

/** More stdout than a `top`/`ps` snapshot produces, so a read never dies of ENOBUFS. */
const MAX_BUFFER = 8 * 1024 * 1024;

/** The read seams `machine capacity` needs, injected so a test never shells out. */
export interface MachineCapacityDeps {
  /** `top -l 1 -o mem -stats pid,mem`'s stdout, or `undefined` when the read failed. */
  readonly topReport: () => string | undefined;
  /**
   * `top -l 1 -stats pid,mem` over exactly these pids — every watched daemon (`./daemonWatch.ts`), whatever its
   * rank, since the ranked read above keeps only `topN` rows. `undefined` when the read failed or `pids` is empty.
   */
  readonly watchedTopReport: (args: { pids: readonly number[] }) => string | undefined;
  /** `sysctl vm.swapusage`'s stdout, or `undefined` when the read failed. */
  readonly swapUsage: () => string | undefined;
  /** The four compressor oids' stdout (`vm.compressor.segment.total` …), or `undefined` when the read failed. */
  readonly compressorSysctl: () => string | undefined;
  /** How many swapfiles sit under `vm.swapfileprefix`'s directory, or `undefined` when it could not be listed. */
  readonly swapfileCount: () => number | undefined;
  /** The whole process table, decoded — read once per report, per `../standing/processes.ts`'s own header. */
  readonly processes: () => readonly ProcessRow[];
  /** Every process's short command name, decoded — the display label's source; see `./capacity.ts#parseCommRows`. */
  readonly comms: () => readonly ProcessComm[];
  /** The machine's core count, which sizes the load hold — `os.cpus().length`, the same number as `sysctl -n hw.ncpu`. */
  readonly cpuCount: () => number | undefined;
  /**
   * Every live Claude Code session `~/.claude/sessions/<pid>.json` names — what a spawned child is attributed
   * to. Empty when the registry could not be read, which leaves every child reading as it did before.
   */
  readonly sessions: () => readonly ClaudeSession[];
  /**
   * The pinned supervisor's Claude Code session id, which the culprit never offers a kill (`./fleetCulprit.ts`),
   * or `undefined` when no pin is recorded or a Codex thread holds it.
   */
  readonly chairSessionId: () => string | undefined;
  /** `top -l 2 -s 1 -stats pid,cpu`'s stdout — the unattributed-CPU residual's source — or `undefined` on failure. */
  readonly cpuSample: () => string | undefined;
  /** Every process's resident size and state, decoded — which ones refused their stats; see `./hiddenCpu.ts`. */
  readonly statRows: () => readonly ProcessStatRow[];
  /**
   * How long every process has been running, decoded — the hook-stall reading's only source; see
   * `./fleetLoad.ts`. Empty when the read failed, which leaves every stall `undefined` rather than zero.
   */
  readonly elapsed: () => readonly ProcessElapsed[];
  /**
   * The volume's own numbers and the worktree registration counts — `./diskFootprint.ts`.
   *
   * MEMOISED in the production seam, and that is a contract rather than an optimisation:
   * `git worktree list --porcelain` measured 1.0s against 766 registrations (repro:
   * `time git -C <checkout> worktree list --porcelain | wc -l`) and `machine capacity --wait` re-reads
   * everything on every poll. Disk fill and worktree counts move over hours; re-reading them per poll would
   * spend a second of `git` for a number that cannot have changed.
   */
  readonly disk: () => DiskReading | undefined;
}

/** One `sysctl` invocation's stdout, or `undefined` when it failed — the shape every gauge read here shares. */
function sysctlText({ args }: { args: readonly string[] }): string | undefined {
  try {
    return execFileSync("sysctl", [...args], { encoding: "utf8", maxBuffer: MAX_BUFFER, timeout: READ_TIMEOUT_MS });
  } catch {
    return undefined;
  }
}

/**
 * `sysctl -n vm.loadavg`'s stdout, or `undefined` when it failed — the load a spawn reads without paying for
 * `top` (`./spawnBackoff.ts`).
 *
 * @returns the raw `{ load1 load5 load15 }` line, or `undefined`
 */
export function loadavgSysctlText(): string | undefined {
  return sysctlText({ args: ["-n", "vm.loadavg"] });
}

/** One `ps` listing's stdout, or `undefined` when it failed. */
function psText({ args }: { args: readonly string[] }): string | undefined {
  try {
    return execFileSync("ps", [...args], { encoding: "utf8", maxBuffer: MAX_BUFFER, timeout: READ_TIMEOUT_MS });
  } catch {
    return undefined;
  }
}

/**
 * The swapfiles under `vm.swapfileprefix`'s directory. The files themselves are root-only (mode 0600), but
 * their directory (`/System/Volumes/VM`, mode 0755) lists without sudo — a plain `ls` on it is how the count
 * in the panic line is reproduced.
 */
function readSwapfileCount(): number | undefined {
  const prefix = sysctlText({ args: ["-n", "vm.swapfileprefix"] })?.trim();
  if (prefix === undefined || prefix.length === 0) {
    return undefined;
  }
  try {
    return countSwapfiles({ entries: readdirSync(dirname(prefix)), prefix });
  } catch {
    return undefined;
  }
}

/** `df -k <path>`'s stdout, or `undefined` when it failed. */
function dfText({ path }: { path: string }): string | undefined {
  try {
    return execFileSync("df", ["-k", path], { encoding: "utf8", maxBuffer: MAX_BUFFER, timeout: READ_TIMEOUT_MS });
  } catch {
    return undefined;
  }
}

/** The seams one disk reading runs through, in the order {@link readDiskInOrder} calls them. */
export interface DiskReadSeams {
  /** Every declared main checkout's root. */
  readonly checkouts: readonly string[];
  /** `df -k` over the state home's volume, parsed, or `undefined` when it could not be read. */
  readonly readVolume: () => VolumeReading | undefined;
  /** Hand a fresh reading to the unasked prune (`../../worktree/pruneTrigger.ts`), which decides whether it is owed. */
  readonly requestPrune: (args: { availableKib: number | undefined }) => void;
  /** One checkout's registration count, or `null` when its list could not be read. */
  readonly countRepo: (args: { repoRoot: string }) => number | null;
}

/**
 * One whole disk reading: the volume the state home sits on, and every declared main checkout's registration
 * count. A repository whose list could not be read answers `null` rather than zero — the same rule the prune
 * classifier keeps, for the same reason.
 *
 * **A reading under the prune floor starts a prune the moment it is read**; the floor is the higher of 100 GB and
 * capacity's disk hold (`../../worktree/pruneFloor.ts`).
 * The trigger is handed the volume as soon as the reading is whole, and not before: a prune launched
 * ahead of the registration counts would race them, unregistering trees mid-read, so this reading would no
 * longer be one instant's. The counts come before `df`, so the reading a caller gets back is whole.
 * Whether a prune is owed — the floor, the window already launched, a home with nothing to reclaim — is the
 * trigger's to decide, never this read's.
 *
 * @param seams the reads and the trigger, in call order
 * @returns the reading the report carries
 */
export function readDiskInOrder({ seams }: { seams: DiskReadSeams }): DiskReading {
  const repos = seams.checkouts.map((repoRoot): RepoWorktreeCount => ({
    registered: seams.countRepo({ repoRoot }),
    repoRoot,
  }));
  const volume = seams.readVolume();
  seams.requestPrune({ availableKib: volume?.availableKib });
  return diskReadingOf({ repos, volume });
}

/** The production disk reading under `home`, launching the threshold prune through the real trigger. */
function readDisk({ home }: { home: string }): DiskReading {
  return readDiskInOrder({
    seams: {
      checkouts: mainCheckoutsFromProfile({ home }).map((checkout) => checkout.path),
      countRepo: ({ repoRoot }) => {
        const listed = listRepoWorktrees({ repoRoot });
        return listed === null ? null : listed.length;
      },
      readVolume: () => parseDfKib({ text: dfText({ path: home }) }),
      requestPrune: ({ availableKib }) => {
        // Best effort by construction: a capacity read never fails, or blocks, for maintenance.
        try {
          // Never below the floor capacity holds spawns at (`../../worktree/pruneFloor.ts`).
          requestWorktreePrune({
            availableKib,
            cause: "threshold",
            deps: productionPruneTriggerDeps({ home, importMetaUrl: import.meta.url }),
            floorGb: worktreePruneFloorGb(),
          });
        } catch {
          // An unreadable profile or trigger directory costs this launch; the next reading asks again.
        }
      },
    },
  });
}

/**
 * The real seams: actual `top`, `sysctl`, `ps`, `df`, `git` and directory reads.
 *
 * @param topN how many processes `top` is asked to report — bounds `-n`, so the subprocess itself does the
 *   ranking rather than this process sorting a system-wide table
 * @param home the state home, which names the volume to measure and holds the declared main checkouts
 * @returns the production {@link MachineCapacityDeps}
 */
export function productionMachineCapacityDeps({ topN, home }: { topN: number; home: string }): MachineCapacityDeps {
  // Read at most once per process, per the seam’s own contract: a `--wait` loop polls every few seconds and
  // neither the volume’s fill nor a repository’s worktree count can move meaningfully between two polls. The
  // flag rather than a null check on `cached` is what memoises an UNREADABLE reading too — a `df` that
  // refuses is not a reason to shell out again on every poll of the same loop.
  let diskRead = false;
  let cached: DiskReading | undefined;
  return {
    ...processTableSeams(),
    ...topSeams({ topN }),
    chairSessionId: () => {
      const pin = readSupervisorPin({ home });
      if (pin === undefined) {
        return undefined;
      }
      return claudeHeldPin({ pin })?.session.id;
    },
    compressorSysctl: () => sysctlText({ args: COMPRESSOR_OIDS }),
    cpuCount: () => {
      // `os.cpus()` reads `hw.ncpu` — the same 15 `sysctl -n hw.ncpu` reports on this device, without a
      // subprocess. An empty array (it can be one on a constrained host) is `undefined`, not zero cores.
      const count = cpus().length;
      return count > 0 ? count : undefined;
    },
    disk: () => {
      if (!diskRead) {
        diskRead = true;
        cached = readDisk({ home });
      }
      return cached;
    },
    sessions: () =>
      scanSessions({ sessionsDir: defaultSessionsDir() }).records.map((record): ClaudeSession => ({
        cwd: record.cwd,
        pid: record.pid,
        sessionId: record.sessionId,
      })),
    swapUsage: () => sysctlText({ args: ["vm.swapusage"] }),
    swapfileCount: readSwapfileCount,
  };
}

/** The four `ps` listings, each decoded by its own parser and each answering EMPTY rather than throwing. */
function processTableSeams(): Pick<MachineCapacityDeps, "comms" | "elapsed" | "processes" | "statRows"> {
  return {
    comms: () => {
      const text = psText({ args: ["-ax", "-o", "pid=,comm="] });
      return text === undefined ? [] : parseCommRows({ text });
    },
    elapsed: () => {
      const text = psText({ args: ["-ax", "-o", "pid=,etime="] });
      return text === undefined ? [] : parseElapsedRows({ text });
    },
    processes: () => {
      const text = psText({ args: ["-ax", "-o", "pid=,ppid=,args="] });
      return text === undefined ? [] : parseProcessRows({ text });
    },
    statRows: () => {
      const text = psText({ args: ["-ax", "-o", "pid=,rss=,stat=,comm="] });
      return text === undefined ? [] : parseProcessStatRows({ text });
    },
  };
}

/** The three `top` invocations: the ranked footprint snapshot, the watched daemons by pid, and the two-sample CPU read. */
function topSeams({
  topN,
}: {
  topN: number;
}): Pick<MachineCapacityDeps, "cpuSample" | "topReport" | "watchedTopReport"> {
  const top = ({ args }: { args: readonly string[] }): string | undefined => {
    try {
      return execFileSync("top", [...args], { encoding: "utf8", maxBuffer: MAX_BUFFER, timeout: READ_TIMEOUT_MS });
    } catch {
      return undefined;
    }
  };
  return {
    // Two samples one second apart: the first sample's per-process %CPU is always zero. Measured 1.45 s wall.
    cpuSample: () => top({ args: ["-l", "2", "-s", "1", "-stats", "pid,cpu"] }),
    topReport: () => top({ args: ["-l", "1", "-o", "mem", "-n", String(topN), "-stats", "pid,mem"] }),
    // `-pid` may repeat, and an empty list would read the whole table, which is the ranked read's job.
    watchedTopReport: ({ pids }) =>
      pids.length === 0
        ? undefined
        : top({ args: ["-l", "1", ...pids.flatMap((pid) => ["-pid", String(pid)]), "-stats", "pid,mem"] }),
  };
}
