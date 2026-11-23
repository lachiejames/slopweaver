/**
 * Which HOLD thresholds one capacity reading crossed — the compressor, the swapfile count, the 1-minute load, a
 * stalled hook, the boots in flight and the disk floor — each as a clause naming its subject and both numbers,
 * and the two thresholds derived from the machine rather than fixed: the load hold and the disk floor.
 * `./capacity.ts` owns the other thresholds' measured history and assembles the report around these clauses;
 * `./recentBoots.ts`'s `machineHoldStands` and `holdBlocksWait` say which consumers a `boots` or `disk` clause
 * reaches.
 */
import type { CompressorGauge, LoadAverage } from "./capacityParse.js";
import type { GradeReason } from "./capacityVerdict.js";
import { cpuLoadHolding, IDLE_HOLD_FLOOR_PCT } from "./cpuLoadHold.js";
import { type DiskReading, volumeFreeGb } from "./diskFootprint.js";
import { briefDuration, type FleetLoadReading, stalledHookLabel, stalledSessions } from "./fleetLoad.js";
import {
  DEFAULT_RECENT_BOOTS_HOLD,
  type RecentBootsReading,
  recentBootsClause,
  recentBootsHolding,
} from "./recentBoots.js";

export { cpuLoadHolding, DEFAULT_LOAD_HOLD, IDLE_HOLD_FLOOR_PCT, loadHoldFor } from "./cpuLoadHold.js";

/**
 * The load's hold clause, or `undefined` when {@link cpuLoadHolding} clears it: both load numbers, then the idle
 * beside its floor, or that idle went unmeasured so load judged alone.
 */
function loadHoldReason({
  load,
  loadHold,
  idlePct,
}: {
  load: LoadAverage | undefined;
  loadHold: number;
  idlePct: number | undefined;
}): GradeReason | undefined {
  if (load === undefined || !cpuLoadHolding({ idlePct, load1: load.load1, loadHold })) {
    return undefined;
  }
  let idle = "idle unmeasured, so load judged alone";
  if (idlePct !== undefined) {
    idle = `${String(idlePct)}% idle, under the ${String(IDLE_HOLD_FLOOR_PCT)}% floor`;
  }
  return { subject: "cpu", text: `1-min load ${String(load.load1)}, hold at ${String(loadHold)}, ${idle}` };
}

/*
 * The disk floor, derived from what a seat costs rather than chosen. A disk 85% full with Finder showing 150 GB is no
 * reason to hold; the question the hold answers is "would the next seats bring the disk dangerously close to
 * full?", and the hourly `worktree-prune` automation should keep it from ever being asked. So the floor reserves
 * only growth that has not happened yet. A live session's tree is ALREADY inside `df`'s used figure, so reserving
 * it again counts it twice: that floor grew with the fleet and held 53 sessions at 308 GB with 262.5 GB free.
 *
 * What can still grow fast is the seats about to start. The `boots` hold (`./recentBoots.ts`) stops seating once
 * {@link DEFAULT_RECENT_BOOTS_HOLD} sessions have started inside its window, so a burst is at most that many
 * trees; the next seat and one spare complete the reserve. RESIDUE, stated: a live tree that has not installed
 * yet (~0.28 GB) can still grow to the full figure later, and nothing here models that — the observed fleet's
 * trees are mostly built, and noticing disk falling from any cause is the supervisor's judgement, not this floor.
 *
 * MEASURED, `du -sk <worktree>`: three acme-admin seat trees at 4,521,988 / 5,327,640 / 5,471,152
 * KiB, a built slopweaver tree at 3,136,508 KiB and an unbuilt one at 282,028 KiB. The largest, 5.6 GB, is
 * {@link SEAT_TREE_GB}. Finder's free figure is `df`'s available PLUS the APFS purgeable space, so `df`
 * available is a LOWER bound on what the owner sees. Reproduce the reading: `df -k "$SLOPWEAVER_HOME"`.
 */

/** The disk one seat's worktree costs at its largest measured, in GB — the header above says where it was read. */
export const SEAT_TREE_GB = 5.6;

/** The seat this hold is asked about. */
const NEXT_SEAT_TREES = 1;

/** Seat trees held back beyond the burst and the next — the "dangerously close" in the floor's question. */
const SPARE_SEAT_TREES = 1;

/** The `df`-available GB the volume holds below, and the derivation the hold clause says beside it. */
export interface DiskFloor {
  readonly gb: number;
  readonly why: string;
}

/**
 * The disk floor: a {@link SEAT_TREE_GB} tree each for a {@link DEFAULT_RECENT_BOOTS_HOLD}-seat boots burst, the
 * next seat and one spare, to one decimal place — or the floor a caller pinned, which wins. It takes no session
 * count on purpose: a live session's tree is already in `df`'s used figure.
 *
 * @param pinnedGb a floor the caller set in place of the derived one, or `undefined` to derive it
 * @returns the floor and its derivation
 */
export function diskFloorFor({ pinnedGb = undefined }: { pinnedGb?: number | undefined } = {}): DiskFloor {
  if (pinnedGb !== undefined) {
    return { gb: pinnedGb, why: "the floor the caller set" };
  }
  const trees = DEFAULT_RECENT_BOOTS_HOLD + NEXT_SEAT_TREES + SPARE_SEAT_TREES;
  return {
    gb: Math.round(trees * SEAT_TREE_GB * 10) / 10,
    why: `a ${String(SEAT_TREE_GB)} GB seat tree each for the ${String(DEFAULT_RECENT_BOOTS_HOLD)}-seat boots burst, the next and one spare`,
  };
}

/**
 * The disk floor's hold clause, or `undefined` when the volume is at or above it or was not read. Judged on
 * {@link volumeFreeGb}'s one-decimal figure, the number every surface prints beside the floor, so no page can
 * say "28.0 GB free, under the 28 GB" while the raw KiB sit a hair below it.
 *
 * @param disk the disk reading, or `undefined` when it was not taken
 * @param diskFloor the `df`-available GB the volume holds below, and why
 * @returns the clause naming both numbers, the floor's derivation and the remedy
 */
function diskHold({
  disk,
  diskFloor,
}: {
  disk: DiskReading | undefined;
  diskFloor: DiskFloor;
}): GradeReason | undefined {
  const freeGb = volumeFreeGb({ volume: disk?.volume });
  if (freeGb === undefined || freeGb >= diskFloor.gb) {
    return undefined;
  }
  return {
    subject: "disk",
    text:
      `disk ${String(freeGb)} GB free (df, Finder shows at least this), hold below ` +
      `${String(diskFloor.gb)} GB — ${diskFloor.why}; run slopweaver worktree prune --apply`,
  };
}

/** The compressor and swapfile hold clauses, in that order — the two readings the kernel panic's log graded. */
function memoryHoldReasons({
  compressor,
  swapfileCount,
  segmentsHoldPct,
  swapfileHoldCount,
}: {
  compressor: CompressorGauge | undefined;
  swapfileCount: number | undefined;
  segmentsHoldPct: number;
  swapfileHoldCount: number;
}): GradeReason[] {
  const reasons: GradeReason[] = [];
  if (compressor !== undefined && compressor.segmentsPct >= segmentsHoldPct) {
    reasons.push({
      subject: "memory",
      text: `compressor at ${String(compressor.segmentsPct)}% of its segments limit, hold at ${String(segmentsHoldPct)}%`,
    });
  }
  if (swapfileCount !== undefined && swapfileCount >= swapfileHoldCount) {
    reasons.push({
      subject: "memory",
      text: `${String(swapfileCount)} swapfiles, hold at ${String(swapfileHoldCount)}`,
    });
  }
  return reasons;
}

/**
 * The compressor, swapfile, load, stalled-hook, boots and disk HOLD thresholds, and which of them this reading
 * crossed, in that order.
 *
 * @param segmentsHoldPct the compressor-segments percentage that holds
 * @param swapfileHoldCount the swapfile count that holds
 * @param loadHold the 1-minute load that holds, already sized to the core count
 * @param idlePct `top`'s idle percentage, which clears a load hold at or above {@link IDLE_HOLD_FLOOR_PCT}
 * @param hookStallHoldSeconds how long one hook may stall before its session holds the machine
 * @param diskFloor the `df`-available GB the state home's volume holds below, and why
 * @returns one clause per crossing, empty when nothing held
 */
export function holdReasons({
  compressor,
  swapfileCount,
  load,
  segmentsHoldPct,
  swapfileHoldCount,
  loadHold,
  idlePct,
  fleet,
  hookStallHoldSeconds,
  boots,
  disk,
  diskFloor,
}: {
  compressor: CompressorGauge | undefined;
  swapfileCount: number | undefined;
  load: LoadAverage | undefined;
  segmentsHoldPct: number;
  swapfileHoldCount: number;
  loadHold: number;
  idlePct: number | undefined;
  fleet: FleetLoadReading;
  hookStallHoldSeconds: number;
  boots: RecentBootsReading;
  disk: DiskReading | undefined;
  diskFloor: DiskFloor;
}): readonly GradeReason[] {
  const reasons = [...memoryHoldReasons({ compressor, segmentsHoldPct, swapfileCount, swapfileHoldCount })];
  const loadReason = loadHoldReason({ idlePct, load, loadHold });
  if (loadReason !== undefined) {
    reasons.push(loadReason);
  }
  // One clause per stalled session, never only the worst: two sessions wedged on hooks at once are two
  // different tool calls to stop, and the stalled-session incident had one of them running nineteen in parallel.
  for (const session of stalledSessions({ reading: fleet, stallHoldSeconds: hookStallHoldSeconds })) {
    reasons.push({
      subject: "cpu",
      // `stalledSessions` selects on a defined `hookStallSeconds`, so the reading is always there.
      text: `session ${session.sessionId} has its ${stalledHookLabel({ script: session.hookStallScript })} stalled ${briefDuration({ seconds: session.hookStallSeconds! })}, hold at ${briefDuration({ seconds: hookStallHoldSeconds })}`,
    });
  }
  if (recentBootsHolding({ reading: boots })) {
    reasons.push({ subject: "boots", text: recentBootsClause({ reading: boots }) });
  }
  const floor = diskHold({ disk, diskFloor });
  if (floor !== undefined) {
    reasons.push(floor);
  }
  return reasons;
}
