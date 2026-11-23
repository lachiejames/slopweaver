/**
 * How `worktree prune --apply` deletes without taking the machine down with it.
 *
 * ## The incident this exists for
 *
 * The disk-full run: an unthrottled acme-admin apply had the 1-minute load at 119.8 against the
 * 22 hold, with fseventsd at 113% CPU and 7.2 GB, and the owner said it happens every time worktrees are
 * deleted. One acme-admin tree is about 5 GB, nearly all `node_modules`, so millions of files. Two paths
 * deleted them at full speed: `git worktree remove` in place, because the apply passed no reclaim trash,
 * and the dependency drop's own `rmSync`. Every unlink is an FSEvents record, and fseventsd fell behind.
 *
 * ## Five brakes, each one cheap
 *
 * - **Background priority.** Every bulk delete runs as `taskpolicy -b rm -rf` on darwin, the background QoS
 *   tier, which caps its CPU and throttles its disk I/O behind every foreground process.
 * - **fseventsd governs every bulk delete from inside.** Load alone let a paced prune storm (load1 at 10-12, one
 *   `rm` drove fseventsd to 23-47%), and a brake between trees cannot stop the first tree. So
 *   {@link deleteGently} removes a tree in quanta of a counted number of entries and holds before each one while
 *   fseventsd is hot (`./governedDelete.ts`, `./fseventsdGauge.ts`).
 * - **A gate before every worktree removal that BACKS OFF.** The 1-minute load and fseventsd's CPU are read before
 *   each removal; at or above `machine capacity`'s load hold, or fseventsd's bar, or with fseventsd unreadable, the
 *   pass waits and reads again until the machine is out of the warning zone or the removal deadline arrives
 *   ({@link removalGateDecision}). That gate is also the drain between trees: no fixed sleep follows a removal.
 * - **A gate before every MAINTENANCE step** — a dependency drop, a mirror free, a trash batch — that stops the
 *   step and leaves the rest to the next run, and a pause after each one that holds, up to {@link DRAIN_HOLD_MAX_MS},
 *   until fseventsd falls under its lower bar.
 * - **A per-run cap on the maintenance passes**, so one apply never does more than a few of those however big its
 *   budget is. Worktree REMOVALS carry no count: their deadline bounds them ({@link removalGateDecision} says why).
 *
 * Below the prune floor (`./pruneFloor.ts`) the MAINTENANCE cap and load gate step aside —
 * {@link pacingStop} carries the measurement that made the load gate the thing starving a full disk. The
 * removal gate backs off on the load either way: the same pressure holds every spawn, so the load it waits on falls.
 *
 * Every gate is a stop between trees, never during one, for the reason `pruneApplyRotation.ts`'s rotation gives; the
 * one brake inside a tree holds, and never abandons the tree halfway except at its deadline.
 */
import { spawnSync } from "node:child_process";
import { chmodSync, type Dirent, existsSync, lstatSync, readdirSync } from "node:fs";
import { cpus, loadavg } from "node:os";
import { join } from "node:path";

import { loadHoldFor } from "../live/machine/capacityHolds.js";

import { claimDeleteLease, deleteLeaseRoot } from "./deleteLease.js";
import {
  FSEVENTSD_CPU_BAR,
  FSEVENTSD_RELEASE_BAR,
  type FseventsdCpu,
  fseventsdStop,
  governorHolds,
  readFseventsdCpu,
} from "./fseventsdGauge.js";
import { type DirListing, governedDelete, removeBeforeDeadline } from "./governedDelete.js";

/**
 * Trees whose `node_modules` one apply drops, and mirror roots it frees, before it stops. Removals carry no count
 * ({@link removalGateDecision}).
 */
const TREES_PER_RUN = 4;

/** How often a held gate or pause re-reads the machine. */
const DRAIN_POLL_MS = 15_000;

/** The longest a pause between trees holds for fseventsd before the gate decides instead. */
const DRAIN_HOLD_MAX_MS = 180_000;
/**
 * The argv that runs `argv` at background priority on this platform. darwin's `taskpolicy -b` is the
 * background QoS tier: its CPU is capped and its disk I/O is throttled behind every foreground process. No
 * other platform here has a tool, so it gets the plain argv.
 *
 * @param platform `process.platform`
 * @param argv the command to run
 * @returns the command, wrapped where the platform can lower its priority
 */
export function lowPriorityArgv({
  platform,
  argv,
}: {
  platform: NodeJS.Platform;
  argv: readonly string[];
}): readonly string[] {
  if (platform === "darwin") {
    return ["taskpolicy", "-b", ...argv];
  }
  return argv;
}

/**
 * Block this thread for `ms`. The delete paths are synchronous, so a hold inside one cannot yield to a timer.
 *
 * @param ms how long to block
 */
function sleepSync({ ms }: { ms: number }): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * Whether a listed entry is a directory. A filesystem may list an entry with no type at all, and taking that for a
 * file would hand a whole subtree to one `rm`, so an untyped entry is asked with `lstat`, and
 * one `lstat` cannot read is walked as a directory: its listing then fails, and nothing above it is removed.
 *
 * @param entry one entry of a `readdirSync` listing
 * @param path its full path
 * @returns true to walk it as a directory
 */
function isDirectoryEntry({ entry, path }: { entry: Dirent; path: string }): boolean {
  if (entry.isDirectory()) {
    return true;
  }
  if (entry.isFile() || entry.isSymbolicLink()) {
    return false;
  }
  try {
    return lstatSync(path).isDirectory();
  } catch {
    return true;
  }
}

/**
 * The entries directly inside a directory, or that it could not be read.
 *
 * @param dir the directory to list
 * @returns its entries, or `unlistable`
 */
function listEntries({ dir }: { dir: string }): DirListing {
  try {
    const entries = readdirSync(dir, { withFileTypes: true }).map((entry) => {
      const path = join(dir, entry.name);
      return { isDirectory: isDirectoryEntry({ entry, path }), path };
    });
    return { entries, kind: "listed" };
  } catch {
    return { kind: "unlistable" };
  }
}

/**
 * Give a directory its owner's read, write and search bits when it lacks any of them, so its entries can be listed
 * and removed. A directory already open is left alone, so the retry adds no event for it.
 *
 * @param dir the directory to unlock
 */
function unlockDir({ dir }: { dir: string }): void {
  try {
    const mode = lstatSync(dir).mode;
    if ((mode & 0o700) !== 0o700) {
      chmodSync(dir, (mode & 0o7777) | 0o700);
    }
  } catch {
    // Gone, or not ours to change: the listing that follows says which.
  }
}

/**
 * Delete a directory tree at background priority, quantum by quantum, holding before each quantum while fseventsd
 * is hot, all bounded by a timeout. Interrupting it is harmless: whatever is left is a smaller directory for the
 * next pass.
 *
 * @param dir the directory to delete
 * @param timeoutMs how long the delete may run, holds included, before it is cut short
 * @param gauge fseventsd's CPU now; the machine's own read unless a test passes a fixed one
 * @param now the epoch millisecond every deadline is read against; the wall clock unless a test passes a fixed one
 * @param os picks the `rm` wrapper {@link lowPriorityArgv} builds; this machine's own unless a test passes
 *   another. A test of the real delete passes a non-darwin one, because `taskpolicy -b`'s background QoS starves
 *   behind a saturated test lane: MEASURED, two cases of `prunePacing.test.ts` ran 30.4s and 34.5s inside a full
 *   unit shard against a 20s budget, while the whole file runs 37/37 in 1.6s alone
 * @returns whether the directory is gone
 */
export function deleteGently({
  dir,
  timeoutMs,
  gauge = readFseventsdCpu,
  now = Date.now,
  os = process.platform,
}: {
  dir: string;
  timeoutMs: number;
  gauge?: (input: { remainingMs: number }) => FseventsdCpu;
  now?: () => number;
  os?: NodeJS.Platform;
}): boolean {
  const deadline = now() + timeoutMs;
  const run = ({
    argv,
    timeoutMs: leftMs,
  }: {
    argv: readonly string[];
    timeoutMs: number;
  }): "finished" | "timed-out" => {
    const [command, ...args] = lowPriorityArgv({ argv, platform: os });
    const { error } = spawnSync(command!, args, { stdio: "ignore", timeout: leftMs });
    // A non-zero exit is `rm -fd` refusing a directory something left full, which the next pass finds; only the
    // timeout means the deadline cut the quantum short.
    return error !== undefined && "code" in error && error.code === "ETIMEDOUT" ? "timed-out" : "finished";
  };
  const leaseRoot = deleteLeaseRoot();
  const seams = {
    claim: () => claimDeleteLease({ root: leaseRoot }),
    gauge,
    list: listEntries,
    now,
    remove: ({ trees, leaves }: { trees: readonly string[]; leaves: readonly string[] }) =>
      removeBeforeDeadline({ deadline, leaves, now, run, trees }),
    sleep: sleepSync,
    unlock: unlockDir,
  };
  const ended = governedDelete({ deadline, dir, seams, unlocking: false });
  // A directory without its owner's write bit refuses `rm` its entries, and every pass would retry it for good
  // (reproduced with a 0555 directory). So once more, unlocking each directory as the walk reaches it —
  // governed like the first pass, never a `chmod -R` or `rm` of the whole residue at once.
  const walkedToTheEnd = ended === "deleted" || ended === "incomplete";
  if (walkedToTheEnd && existsSync(dir) && now() < deadline) {
    governedDelete({ deadline, dir, seams, unlocking: true });
  }
  return !existsSync(dir);
}

/**
 * Whether a pause between trees keeps holding: fseventsd has not yet fallen under its lower bar, and the hold has
 * time left. Not running, or unreadable, ends the hold at once — the gate that follows judges those.
 *
 * @param fseventsd one read of fseventsd's CPU
 * @param heldMs how long this pause has already held past its fixed wait
 * @param maxMs the longest a pause holds before the gate decides instead
 * @returns true to wait one more poll
 */
export function holdForDrain({
  fseventsd,
  heldMs,
  maxMs,
}: {
  fseventsd: FseventsdCpu;
  heldMs: number;
  maxMs: number;
}): boolean {
  return fseventsd.kind === "read" && fseventsd.cpu >= FSEVENTSD_RELEASE_BAR && heldMs < maxMs;
}

/**
 * Why a pass must stop before its next tree, or null when it may carry on.
 *
 * **Under disk pressure the cap and the load gate step aside, and fseventsd does not.** MEASURED in
 * `$SLOPWEAVER_HOME/worktree-bundles/auto-prune.log`: eleven consecutive hourly runs removed
 * nothing, every one stopped by a 1-minute load of 24 to 60 against the 22 hold, while the fleet booted onto a
 * disk the capacity floor then held on. Load did not name the deletion storm this module exists for — one delete
 * drove fseventsd to 23-47% at a load of 10-12 — so the brake that stays is the one that measures the delete:
 * fseventsd here and inside every bulk delete, background QoS, the pause and the drain hold between trees. Below
 * the owner's 100 GB floor (`./pruneTrigger.ts`) the apply's own deadline is the cap.
 *
 * @param load1 the 1-minute load average now
 * @param hold the load at which `machine capacity` holds a spawn
 * @param fseventsd one read of fseventsd's CPU now
 * @param done how many trees this pass has already acted on
 * @param cap how many trees one pass may act on
 * @param diskPressure whether free disk is under the prune floor right now
 * @returns the reason to stop, or null
 */
export function pacingStop({
  load1,
  hold,
  fseventsd,
  done,
  cap,
  diskPressure,
}: {
  load1: number;
  hold: number;
  fseventsd: FseventsdCpu;
  done: number;
  cap: number;
  diskPressure: boolean;
}): string | null {
  if (!diskPressure && done >= cap) {
    return `acted on ${String(done)} tree(s), this run's cap — the rest wait for the next run`;
  }
  const load = loadStop({ diskPressure, hold, load1 });
  if (load !== null) {
    return load;
  }
  return fseventsdStop({ bar: FSEVENTSD_CPU_BAR, fseventsd });
}

/**
 * Why the load alone stops a delete, or null when it is under the hold or the disk is under the prune floor —
 * {@link pacingStop} says why pressure lifts it.
 *
 * @param load1 the 1-minute load average now
 * @param hold the load at which `machine capacity` holds a spawn
 * @param diskPressure whether free disk is under the prune floor right now
 * @returns the reason to stop, or null
 */
export function loadStop({
  load1,
  hold,
  diskPressure,
}: {
  load1: number;
  hold: number;
  diskPressure: boolean;
}): string | null {
  if (!diskPressure && load1 >= hold) {
    return `the 1-minute load is ${load1.toFixed(1)}, at or above the ${String(hold)} hold — the rest wait for the next run`;
  }
  return null;
}

/**
 * The live load against `machine capacity`'s hold, then fseventsd against its bar, for a delete that has no tree
 * count of its own.
 *
 * @param diskPressure whether free disk is under the prune floor right now, which lifts the load gate alone
 * @returns the reason to stop, or null
 */
export function machineLoadStop({ diskPressure }: { diskPressure: boolean }): string | null {
  return pacingStop({
    cap: Number.POSITIVE_INFINITY,
    diskPressure,
    done: 0,
    fseventsd: readFseventsdCpu({ remainingMs: Number.POSITIVE_INFINITY }),
    hold: loadHoldFor({ cores: cpus().length }),
    load1: loadavg()[0]!,
  });
}

/** What the gate before a worktree removal decides from one reading. */
export type RemovalGateDecision = { readonly kind: "proceed" } | { readonly kind: "hold"; readonly reason: string };

/**
 * The gate before a worktree removal, as one pure step over one reading: back off while the machine is in the
 * warning zone, then carry on. It never ENDS the pass — only the removal deadline does ({@link machinePacer}).
 *
 * **The owner's ruling:** a busy machine backs the removals off until the load is back in the acceptable range,
 * never ends the pass. Before it, a routine run ENDED its pass on one warm reading and
 * only a run under disk pressure held, so a backlog drained only while the disk was nearly full. MEASURED in
 * `$SLOPWEAVER_HOME/worktree-bundles/auto-prune.log`, 21 passes stopped on a `removals paused` line:
 * eight on a `ps` that did not answer in time, four on the load, four on fseventsd and five on the old count cap
 * (`grep -o "removals paused: .\{0,40\}" auto-prune.log | sort | uniq -c`). So every case holds the same way,
 * pressure or not: the load at the hold, fseventsd at its bar (and, once held, until it falls under the release
 * bar — {@link governorHolds}'s hysteresis), and an fseventsd that could not be read, because a busy daemon reads
 * no different. No tree starts while any of them stands.
 *
 * **No count stops a removal pass.** MEASURED in the same log: one apply removed 9 trees, and the
 * four-tree cap stopped it with 260 removals owed. On an earlier day about 45 back-to-back uncapped applies removed trees
 * with fseventsd flat at 4-5 MB.
 *
 * @param load1 the 1-minute load average now
 * @param hold the load at which `machine capacity` holds a spawn
 * @param fseventsd one read of fseventsd's CPU now
 * @param holding fseventsd's own hysteresis state after the reading before this one ({@link fseventsdHolding}),
 *   never the gate's: a load hold would otherwise impose the lower release bar on a daemon that never crossed the
 *   upper one
 * @returns proceed, or hold with what it is waiting out
 */
export function removalGateDecision({
  load1,
  hold,
  fseventsd,
  holding,
}: {
  load1: number;
  hold: number;
  fseventsd: FseventsdCpu;
  holding: boolean;
}): RemovalGateDecision {
  if (load1 >= hold) {
    return {
      kind: "hold",
      reason: `the 1-minute load is ${load1.toFixed(1)}, at or above the ${String(hold)} hold`,
    };
  }
  if (fseventsd.kind === "unreadable") {
    return { kind: "hold", reason: `fseventsd's CPU could not be read (${fseventsd.why})` };
  }
  if (fseventsd.kind === "read" && governorHolds({ cpu: fseventsd.cpu, holding })) {
    return {
      kind: "hold",
      reason: `fseventsd (pid ${fseventsd.pids.join(", ")}) is at ${fseventsd.cpu.toFixed(1)}% CPU`,
    };
  }
  return { kind: "proceed" };
}

/**
 * fseventsd's own hysteresis state after one reading, tracked apart from the load: a load hold neither starts it
 * nor hides it, so a daemon over its bar at a busy reading still has to fall under the release
 * bar before a removal starts. An unreadable reading tells nothing about the daemon, so the state carries.
 *
 * @param fseventsd the reading's fseventsd CPU
 * @param holding fseventsd's state after the reading before this one
 * @returns whether fseventsd's own bar holds after this reading
 */
export function fseventsdHolding({ fseventsd, holding }: { fseventsd: FseventsdCpu; holding: boolean }): boolean {
  if (fseventsd.kind === "unreadable") {
    return holding;
  }
  return fseventsd.kind === "read" && governorHolds({ cpu: fseventsd.cpu, holding });
}

/**
 * The line a removal pass prints when its deadline arrives while the gate is still backing off.
 *
 * @param reason what the last held reading was waiting out
 * @returns the stop line, naming that reason
 */
export function removalDeadlineStop({ reason }: { reason: string }): string {
  return `the removal deadline passed while backing off (${reason}) — the rest wait for the next run`;
}

/** The brakes one pass applies between trees. */
export interface Pacer {
  /** Why the pass must stop before its next tree, given how many it has acted on, or null to carry on. */
  readonly stopReason: (input: { done: number }) => string | null;
  /** Wait between two trees. */
  readonly settle: () => Promise<void>;
}

/** The worktree removal pass's pacer: {@link Pacer}, plus a gate that holds under disk pressure. */
export interface RemovalPacer extends Pacer {
  /**
   * Wait until the next tree may start, answering why the pass must stop instead, or null to start it.
   * {@link removalGateDecision} decides each reading.
   */
  readonly waitUntilReady: (input: { deadlineMs: number }) => Promise<string | null>;
}

/**
 * The machine's pacer: the live load against `machine capacity`'s hold, fseventsd against its bar, this run's
 * cap, and a real pause that holds on while fseventsd drains the last tree's events.
 *
 * @param diskPressureNow whether free disk is under the prune floor, asked afresh before every tree
 * @returns the pacer every apply pass shares
 */
export function machinePacer({ diskPressureNow }: { diskPressureNow: () => boolean }): RemovalPacer {
  const hold = loadHoldFor({ cores: cpus().length });
  const wait = ({ ms }: { ms: number }): Promise<void> =>
    new Promise((resolve) => {
      setTimeout(resolve, ms);
    });
  return {
    waitUntilReady: async ({ deadlineMs }) => {
      let held: string | null = null;
      let holding = false;
      // The deadline is read BEFORE the gauge, so a spent window never pays for one more `ps`.
      while (Date.now() < deadlineMs) {
        const reading = {
          fseventsd: readFseventsdCpu({ remainingMs: Math.max(1, deadlineMs - Date.now()) }),
          hold,
          load1: loadavg()[0]!,
        };
        const decision = removalGateDecision({ ...reading, holding });
        if (decision.kind === "proceed") {
          return null;
        }
        held = decision.reason;
        holding = fseventsdHolding({ fseventsd: reading.fseventsd, holding });
        await wait({ ms: Math.max(0, Math.min(DRAIN_POLL_MS, deadlineMs - Date.now())) });
      }
      if (held === null) {
        return "the removal deadline passed — the rest wait for the next run";
      }
      return removalDeadlineStop({ reason: held });
    },
    settle: async () => {
      let heldMs = 0;
      while (
        holdForDrain({
          fseventsd: readFseventsdCpu({ remainingMs: Number.POSITIVE_INFINITY }),
          heldMs,
          maxMs: DRAIN_HOLD_MAX_MS,
        })
      ) {
        await wait({ ms: DRAIN_POLL_MS });
        heldMs += DRAIN_POLL_MS;
      }
    },
    stopReason: ({ done }) =>
      pacingStop({
        cap: TREES_PER_RUN,
        diskPressure: diskPressureNow(),
        done,
        fseventsd: readFseventsdCpu({ remainingMs: Number.POSITIVE_INFINITY }),
        hold,
        load1: loadavg()[0]!,
      }),
  };
}
