/**
 * When the worktree prune is OWED without anybody asking — the pure half of the two triggers that fire it.
 *
 * ## The owner's ruling, and the failure it answers
 *
 * The owner's ruling, P0: **worktree prune runs on TWO
 * conditions, a schedule AND a threshold — free disk never under 100 GB**, and it fires without a supervisor
 * pass noticing. Measured: `automation status --json` read the hourly `worktree-prune` row at 389 unrun
 * slots against 168 recorded, and `df` read 49 GB free with the fleet held on disk. Both halves
 * had one cause: the row ran only when a supervisor tick ran `automation run-due` for it, and the disk remedy
 * ran only when a tick saw a `disk` hold — so a quiet chair meant no prune at all. A full disk had halted the
 * fleet days earlier.
 *
 * ## The two causes, and why they launch different commands
 *
 * - **`threshold`** — a disk reading under the prune floor (`./pruneFloor.ts`: the higher of
 *   {@link WORKTREE_PRUNE_TRIGGER_FREE_GB} and capacity's disk hold). It runs `worktree prune --apply --if-idle`
 *   DIRECTLY, bypassing the row: `run-due` would do nothing once the hour's slot was stamped or while
 *   a failure hold stood, which is exactly when the disk still needs reclaiming.
 * - **`schedule`** — the first hook event in a new hour. It runs `automation run-due --recipe worktree-prune`,
 *   so the slot ledger still decides whether the hour is owed and records it exactly once.
 *
 * Either cause is claimed only by a caller holding a cmux capability token its detached child inherits; any
 * other leaves the window for one that does (`./pruneTriggerLaunch.ts`'s header has the measured failure).
 *
 * Neither is a clock. The rule of no cron, no launch agent and nothing resident stands: each fires off an
 * event that was already happening — a disk read, a tool call — so a machine nobody is using prunes nothing,
 * and needs nothing.
 *
 * Pure: the marker each launch claims, the command it runs and the floor it compares. The claim is
 * `./pruneTriggerLaunch.ts`; the log and the detached launch are `./pruneTriggerDetach.ts`.
 */

/** Free disk, in GB (10^9 bytes, Finder's unit), below which a prune starts the moment the disk is read. */
export const WORKTREE_PRUNE_TRIGGER_FREE_GB = 100;

/**
 * How long one threshold launch stands before the next disk reading may launch another.
 *
 * One `--apply` runs up to its 15-minute `--scan-budget` plus its 15-minute `--budget`, and a second one
 * launched meanwhile meets the `worktree-prune-apply` lock and, being `--if-idle`, exits 3 having removed nothing — so a launch
 * per reading would only start processes to be refused. Ten minutes keeps that to a handful per run while a
 * reading after the run has ended still launches the next one within ten minutes.
 */
const THRESHOLD_WINDOW_MS = 10 * 60 * 1000;

/** The hourly row's own cadence, `0 * * * *`: one schedule launch per wall-clock hour. */
const SCHEDULE_WINDOW_MS = 60 * 60 * 1000;

/** The recipe the schedule cause asks the slot ledger about. */
const WORKTREE_PRUNE_RECIPE_ID = "worktree-prune";

/** Why a prune is being launched unasked. */
export type PruneTriggerCause = "schedule" | "threshold";

/**
 * Whether this many `df`-available KiB is under the floor.
 *
 * Compared on the raw KiB, never the one-decimal GB every surface prints: 99.96 GB rounds to `100.0`, and a
 * floor judged on the rounded figure would read a disk under it as at it. Strict, so exactly 100 GB is not
 * under.
 *
 * @param availableKib `df -k`'s available column for the state home's volume, or `undefined` when unread
 * @param floorGb the floor to compare against — `worktreePruneFloorGb` (`./pruneFloor.ts`), or
 *   {@link WORKTREE_PRUNE_TRIGGER_FREE_GB} itself
 * @returns true only for a reading that exists and is under the floor — an unread disk launches nothing
 */
export function thresholdPruneOwed({
  availableKib,
  floorGb = WORKTREE_PRUNE_TRIGGER_FREE_GB,
}: {
  availableKib: number | undefined;
  floorGb?: number | undefined;
}): boolean {
  if (availableKib === undefined) {
    return false;
  }
  return availableKib * 1024 < floorGb * 1_000_000_000;
}

/**
 * The marker file one launch claims, named by its cause and the start of the window it falls in.
 *
 * A NAME per window rather than one file rewritten in place, so claiming is an exclusive create that either
 * wins or meets `EEXIST`, and an old window is deleted by name without racing the claim of a new one.
 *
 * @param cause which trigger is launching
 * @param nowMs the instant of the reading, in epoch milliseconds
 * @returns a file name such as `schedule-2026-10-11T22-00-00Z`
 */
export function pruneTriggerMarker({ cause, nowMs }: { cause: PruneTriggerCause; nowMs: number }): string {
  const windowMs = cause === "schedule" ? SCHEDULE_WINDOW_MS : THRESHOLD_WINDOW_MS;
  const windowStartMs = nowMs - (nowMs % windowMs);
  const start = new Date(windowStartMs).toISOString();
  return `${cause}-${start.slice(0, 19).replaceAll(":", "-")}Z`;
}

/**
 * The markers of the SAME cause as the one just claimed whose windows have passed, bar the newest of them.
 * The other cause's marker is never stale here, even when older: its window runs on its own clock, and
 * deleting a live one is a second launch in that window. The window just before this one is kept because a
 * caller that named it a moment before the boundary may not have reached its own claim yet, and deleting the
 * marker would let it claim that window a second time. The apply lock is what keeps two
 * prunes from running at once; the markers only keep the launches down.
 *
 * @param names the directory's entries
 * @param current the marker this launch claimed
 * @returns the names to delete, oldest first; anything not shaped like a marker is left alone
 */
export function staleTriggerMarkers({ names, current }: { names: readonly string[]; current: string }): string[] {
  const prefix = current.slice(0, current.indexOf("-") + 1);
  const passed = names
    .filter(
      (name) =>
        name.startsWith(prefix) && name < current && /^(?:schedule|threshold)-\d{4}-\d{2}-\d{2}T[\d-]+Z$/u.test(name),
    )
    .toSorted();
  return passed.slice(0, -1);
}

/** What a marker holds once its launch went through. A claimed marker is empty until then. */
export const MARKER_LAUNCHED = "launched";

/**
 * How long a claimed marker may stand unconfirmed before it reads as abandoned. Claim to launch is one
 * `spawnSync` bounded at five seconds, so a minute is a process that died between the two.
 */
const ABANDONED_AFTER_MS = 60 * 1000;

/**
 * Whether a marker was claimed by a caller that never launched — killed between its claim and its launch —
 * so its window is still owed a prune.
 *
 * Only the two shapes a claim writes stand: an empty file inside its minute, and one holding exactly
 * {@link MARKER_LAUNCHED}. Anything else — a FIFO, a directory, a symlink, a file holding other bytes — was
 * never a claim's, and is abandoned at once rather than standing in for a launch that never happened.
 *
 * @param regularFile whether the marker path is a regular file, as every claim writes it
 * @param content what it holds, read without blocking; never read for anything but a regular file
 * @param mtimeMs when it was written
 * @param nowMs the instant asked about
 * @returns false only for a launched marker, or an empty one still inside a claim-to-launch's time
 */
export function markerAbandoned({
  content,
  mtimeMs,
  nowMs,
  regularFile,
}: {
  content: string;
  mtimeMs: number;
  nowMs: number;
  regularFile: boolean;
}): boolean {
  if (!regularFile) {
    return true;
  }
  if (content === MARKER_LAUNCHED) {
    return false;
  }
  if (content === "") {
    return nowMs - mtimeMs > ABANDONED_AFTER_MS;
  }
  return true;
}

/**
 * The verb, after the launcher, that one cause runs.
 *
 * @param cause which trigger is launching
 * @returns the argv: the prune itself for `threshold` — `--if-idle`, so it steps aside for an apply already
 *   running rather than waiting on it — and the hourly row's own firing for `schedule`
 */
export function pruneTriggerCommand({ cause }: { cause: PruneTriggerCause }): readonly string[] {
  if (cause === "threshold") {
    return ["worktree", "prune", "--apply", "--if-idle"];
  }
  return ["automation", "run-due", "--recipe", WORKTREE_PRUNE_RECIPE_ID];
}
