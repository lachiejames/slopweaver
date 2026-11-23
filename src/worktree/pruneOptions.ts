/**
 * The duration grammar `--older-than` and `--budget` share, and the plan's rendering — the pure pieces
 * `worktree prune` needs either side of its git work.
 *
 * The grammar is deliberately tiny (`<n>h`, `<n>d`, `<n>m`) rather than a general duration library: the
 * owner's rule is stated in hours ("not been touched for over 24h"), and a flag that silently accepts
 * `24 hours` or `1.5d` invites a caller to believe a spelling this verb never checked. A rejected value is
 * a usage error, never a fallback to the default — falling back would delete against a threshold the caller
 * did not ask for.
 */
import { err, ok, type Result } from "../lib/result.js";
import type { PruneClass, PruneVerdict } from "./pruneClassify.js";

/** The unit suffixes `--older-than` accepts, and what each is worth in milliseconds. */
const UNIT_MS: Readonly<Record<string, number>> = { d: 86_400_000, h: 3_600_000, m: 60_000 };

/** `--older-than`'s default: the owner's own 24-hour rule. */
export const DEFAULT_OLDER_THAN = "24h";

/**
 * `--nuke-after`'s default: the owner's week-old rule. A worktree untouched for over a week is safe to delete,
 * because worktrees are regenerable and the work is tracked on boards and spawned via the supervisor, and the repository ships about 30 pull requests a day.
 * Anything older than a week goes, and changes can be pushed to a remote branch with the board row updated
 * to say they can be pulled down into a fresh worktree.
 *
 * It is a SECOND threshold rather than a looser `--older-than`, and the distinction is the whole safety of
 * the `salvaged` class. `--older-than` decides when a tree carrying nothing unbacked may be removed;
 * this decides when a tree carrying work that exists nowhere else has that work PUSHED and is then removed.
 * Moving the first one would silently widen the second.
 */
export const DEFAULT_NUKE_AFTER = "7d";

/**
 * `--budget`'s default — how long a whole `--apply` run may take before it stops between removals.
 *
 * MEASURED on the recipe slots that produced this bound: `worktree-prune|<date>|04:00` slots both reported the apply killed by the caller's own 20-minute
 * `spawnSync` timeout (`ETIMEDOUT`), part-way down a list of roughly one removal per minute. Reproduce from
 * the record with
 * `grep -rh reason $SLOPWEAVER_HOME/live/recipe/results | grep ETIMEDOUT` — the two reasons say so in the
 * run's own words.
 *
 * A kill is not a clean stop. It lands wherever it lands, and a `git worktree remove` cut in half leaves a
 * gutted tree git then refuses forever — the exact shape the `interrupted` class was added for. Fifteen
 * minutes leaves the caller's bound five minutes of headroom, so this verb decides where a bounded run
 * stops rather than a signal deciding it.
 */
export const DEFAULT_APPLY_BUDGET = "15m";

/**
 * `--scan-budget`'s default — how long the CLASSIFICATION pass may take before it stops between worktrees.
 *
 * MEASURED over the WHOLE population rather than extrapolated from a sample. One full dry-run census of both declared checkouts —
 * 769 slopweaver registrations and 89 acme-admin ones — classified 855 worktrees with a ZERO shortfall in
 * **15 m 22 s** of wall, of which the last five are the dry run's own `DISK_BUDGET_MS` measurement pass.
 * The classification itself therefore cost about **10 m 20 s**, which a `10m` bound would cut.
 * Reproduce it:
 *
 * ```bash
 * time slopweaver worktree prune --json --scan-budget 20m > /tmp/census.json
 * ```
 *
 * Fifteen minutes is that measurement plus room, and it is chosen against the apply budget too: `15m` of
 * scanning and `15m` of removals is half an hour, and nothing bounds the recipe's verb run from outside —
 * the 20-minute `spawnSync` cap that killed this row belonged to a scheduler that no longer exists,
 * and two slot attempts have run past 16 minutes uninterrupted. A repository the bound does not
 * finish reports its shortfall (`pruneSweep.ts`'s `unreachedLine`) and is re-queued coldest-first next run.
 *
 * This is a first-night number and it should fall. The census above is the backlog two weeks of silent
 * failure built; once it is cleared the standing population is the held classes plus a day's churn, which
 * scans in well under a minute.
 */
export const DEFAULT_SCAN_BUDGET = "15m";

/** `<digits><unit>`, anchored, so `24hh` and `h24` are rejected rather than partially matched. */
const DURATION = /^(\d+)([dhm])$/;

/**
 * Parse one duration flag's value into milliseconds.
 *
 * @param value the flag's raw text
 * @param flag the flag's name, so a rejection names the flag the caller actually passed
 * @param zeroMeans what passing `0` would do, spelled out in the refusal rather than left to a reader
 * @returns the duration in milliseconds, or the usage error to print
 */
function parseDuration({ value, flag, zeroMeans }: { value: string; flag: string; zeroMeans: string }): Result<number> {
  const matched = DURATION.exec(value.trim());
  const unitMs = matched === null ? undefined : UNIT_MS[matched[2]!];
  if (matched === null || unitMs === undefined) {
    return err([`worktree prune: ${flag} expects <n>m, <n>h or <n>d (got ${JSON.stringify(value)})`]);
  }
  const count = Number(matched[1]);
  if (count === 0) {
    return err([`worktree prune: ${flag} 0 would ${zeroMeans} — pass a real threshold`]);
  }
  return ok(count * unitMs);
}

/**
 * Parse an `--older-than` value into milliseconds.
 *
 * @param value the flag's raw text
 * @returns the duration in milliseconds, or the usage error to print
 */
export function parseOlderThan({ value }: { value: string }): Result<number> {
  return parseDuration({ flag: "--older-than", value, zeroMeans: "make every worktree eligible" });
}

/**
 * Parse a `--nuke-after` value into milliseconds.
 *
 * @param value the flag's raw text
 * @returns the duration in milliseconds, or the usage error to print
 */
export function parseNukeAfter({ value }: { value: string }): Result<number> {
  return parseDuration({
    flag: "--nuke-after",
    value,
    zeroMeans: "capture and remove every worktree on the machine",
  });
}

/**
 * The waiver age a run classifies against: `--nuke-after` as parsed, or never under `--no-salvage`.
 *
 * `nukeAfterMs` is read in exactly one place, `pruneClassify.ts#holdReason`, to decide whether a waivable hold
 * (dirt, deletions, commits on no remote, a detached HEAD on no remote) is RELEASED into `salvaged`. An
 * infinite waiver releases none, so no verdict is ever `salvaged` and the apply, which pushes only a verdict the
 * plan already marked `salvaged`, pushes nothing. Each such tree stays `hold` under its own reason, so it is
 * kept, and its cold `node_modules` still drops. That is the flag's whole purpose: a checkout whose remote must
 * never receive a salvage branch can still be pruned of what is safe.
 *
 * @param noSalvage whether the caller passed `--no-salvage`
 * @param nukeAfterMs the parsed `--nuke-after`, which `--no-salvage` overrides
 * @returns the age past which a waivable hold is released, or positive infinity for never
 */
export function salvageWaiverMs({ noSalvage, nukeAfterMs }: { noSalvage: boolean; nukeAfterMs: number }): number {
  if (noSalvage) {
    return Number.POSITIVE_INFINITY;
  }
  return nukeAfterMs;
}

/**
 * Parse a `--budget` value into milliseconds.
 *
 * @param value the flag's raw text
 * @returns the duration in milliseconds, or the usage error to print
 */
export function parseApplyBudget({ value }: { value: string }): Result<number> {
  return parseDuration({ flag: "--budget", value, zeroMeans: "stop the run before it removed anything" });
}

/**
 * Parse a `--scan-budget` value into milliseconds.
 *
 * @param value the flag's raw text
 * @returns the duration in milliseconds, or the usage error to print
 */
export function parseScanBudget({ value }: { value: string }): Result<number> {
  return parseDuration({ flag: "--scan-budget", value, zeroMeans: "classify no worktree at all" });
}

/** A KiB count as GB, to one decimal — the unit the owner asked the number in. */
function gb({ kib }: { kib: number }): string {
  return `${(kib / 1_000_000).toFixed(1)} GB`;
}

/** The order classes print in: what would go, then what is being kept and why. */
const CLASS_ORDER: readonly PruneClass[] = [
  "merged",
  "interrupted",
  "pushed",
  "detached",
  "snapshot",
  "salvaged",
  "gone",
  "hold",
];

/** The heading each class prints under. */
const CLASS_HEADING: Readonly<Record<PruneClass, string>> = {
  detached: "SAFE — a detached HEAD a remote still carries: tree removed, recreatable from its own sha",
  gone: "STALE RECORD — git worktree prune clears the registration (frees nothing)",
  interrupted:
    "INTERRUPTED REMOVAL — a gutted tree whose work is in the trunk or on its own remote branch: finished, " +
    "and the branch deleted only when the trunk holds it",
  hold: "HELD — not touched",
  merged: "SAFE — merged, clean, unreferenced, cold: tree removed, and the branch deleted when the trunk holds its tip",
  pushed: "SAFE — clean, fully pushed, unreferenced, cold: tree removed and the branch KEPT",
  salvaged:
    "SALVAGED — over a week untouched and carrying work no remote has: the work is PUSHED to a remote " +
    "branch and recorded, and only then does the tree go",
  snapshot:
    "SAFE — a one-off Codex snapshot left behind past the longest pass: a frozen copy of another tree, removed " +
    "with nothing pushed",
};

/**
 * How a plan line names the tree. git reports no branch for a worktree at a detached HEAD, so the plan names
 * that state where a branch would stand.
 */
function verdictTreeName({ verdict }: { verdict: PruneVerdict }): string {
  const { branch } = verdict;
  if (branch === null) {
    return "(detached)";
  }
  return branch;
}

/**
 * Render one verdict as a plan line.
 *
 * @param verdict the classified worktree
 * @returns the line
 */
function renderVerdict({ verdict }: { verdict: PruneVerdict }): string {
  const size = verdict.diskKib === null ? "" : ` ${gb({ kib: verdict.diskKib })}`;
  return `  ${verdictTreeName({ verdict })}${size} — ${verdict.reason}\n    ${verdict.path}`;
}

/** A plan's totals, per class. */
export interface PruneTotals {
  readonly counts: Readonly<Record<PruneClass, number>>;
  readonly reclaimableKib: Readonly<Record<PruneClass, number>>;
}

/**
 * Total the verdicts by class, so a plan can print what it would free before it frees anything.
 *
 * @param verdicts every classified worktree
 * @returns the per-class counts and reclaimable KiB
 */
export function totalPrunePlan({ verdicts }: { verdicts: readonly PruneVerdict[] }): PruneTotals {
  const counts: Record<PruneClass, number> = {
    detached: 0,
    gone: 0,
    hold: 0,
    interrupted: 0,
    merged: 0,
    pushed: 0,
    salvaged: 0,
    snapshot: 0,
  };
  const reclaimableKib: Record<PruneClass, number> = {
    detached: 0,
    gone: 0,
    hold: 0,
    interrupted: 0,
    merged: 0,
    pushed: 0,
    salvaged: 0,
    snapshot: 0,
  };
  for (const verdict of verdicts) {
    counts[verdict.cls] += 1;
    // An unmeasured footprint adds nothing, which is what makes the plan's total a FLOOR rather than a guess.
    if (verdict.diskKib !== null) {
      reclaimableKib[verdict.cls] += verdict.diskKib;
    }
  }
  return { counts, reclaimableKib };
}

/** The classes an apply would ACT on — what the totals line sums, and what a FLOOR is counted over. */
const CANDIDATE_CLASSES: readonly PruneClass[] = [
  "merged",
  "interrupted",
  "pushed",
  "detached",
  "snapshot",
  "salvaged",
];

/**
 * One class's heading and its member lines, or nothing at all when the class has no members.
 *
 * An applied run's heading carries no gigabyte figure, for the reason `renderPrunePlan` states.
 */
function classSection({
  cls,
  measured,
  members,
  totals,
}: {
  cls: PruneClass;
  measured: boolean;
  members: readonly PruneVerdict[];
  totals: PruneTotals;
}): readonly string[] {
  if (members.length === 0) {
    return [];
  }
  const heading = `${CLASS_HEADING[cls]} — ${members.length}`;
  if (!measured) {
    return [heading, ...members.map((verdict) => renderVerdict({ verdict }))];
  }
  return [
    `${heading}, ${gb({ kib: totals.reclaimableKib[cls] })}`,
    ...members.map((verdict) => renderVerdict({ verdict })),
  ];
}

/**
 * The one line the owner actually reads: what each class contributed, and the total.
 *
 * `--apply` does not measure a single tree — it reads FREE SPACE either side of the run instead, which is
 * cheaper and truer, and the caller prints that delta. So an UNMEASURED run prints counts and NO gigabyte
 * figures: every one of them would render `0.0 GB`, and a reader would take that for a measurement of zero
 * rather than for the absence of one. Measured on the first live acme-admin apply, where the
 * line read `0.0 GB in total (a FLOOR — 44 candidate(s) went unmeasured within the disk budget)` — true
 * in every word and unreadable as anything but a failure.
 */
function totalsLine({
  measured,
  totals,
  unmeasured,
}: {
  measured: boolean;
  totals: PruneTotals;
  unmeasured: number;
}): string {
  const size = ({ kib }: { kib: number }): string => {
    if (!measured) {
      return "";
    }
    return `${gb({ kib })} from `;
  };
  /** The same, for a segment that reads as an addition to the one before it. */
  const sizeMore = ({ kib }: { kib: number }): string => {
    if (!measured) {
      return "";
    }
    return `${gb({ kib })} more from `;
  };
  const sumOf = ({ per }: { per: Readonly<Record<PruneClass, number>> }): number =>
    CANDIDATE_CLASSES.reduce((running, cls) => running + per[cls], 0);
  // A candidate the disk budget did not reach counts as zero in that sum, so the total is a FLOOR. Saying so
  // is the difference between a number a reader can act on and one that quietly understates.
  const floor = ` (a FLOOR — ${unmeasured} candidate(s) went unmeasured within the disk budget)`;
  const optional = ({ count, segment }: { count: number; segment: string }): string => {
    if (count === 0) {
      return "";
    }
    return segment;
  };
  let total = `${sumOf({ per: totals.counts })} tree(s) in total`;
  if (measured) {
    total = `${gb({ kib: sumOf({ per: totals.reclaimableKib }) })} in total${optional({ count: unmeasured, segment: floor })}`;
  }
  return (
    `reclaimable: ${size({ kib: totals.reclaimableKib.merged })}${totals.counts.merged} merged` +
    optional({
      count: totals.counts.interrupted,
      segment: ` · ${totals.counts.interrupted} interrupted removal(s) to finish`,
    }) +
    ` · ${sizeMore({ kib: totals.reclaimableKib.pushed })}${totals.counts.pushed} pushed-not-merged (branches kept)` +
    optional({
      count: totals.counts.detached,
      segment: ` · ${size({ kib: totals.reclaimableKib.detached })}${totals.counts.detached} detached-on-a-remote`,
    }) +
    ` · ${total} · ${totals.counts.hold} held`
  );
}

/**
 * Render the whole plan: every class in turn, then the totals line the owner reads.
 *
 * @param verdicts every classified worktree, in scan order
 * @param totals the counts and reclaimable KiB per class
 * @param measured whether this run measured disk at all — false on every `--apply`, which reads free space
 * @returns the lines to print, in order
 */
export function renderPrunePlan({
  measured,
  totals,
  verdicts,
}: {
  measured: boolean;
  totals: PruneTotals;
  verdicts: readonly PruneVerdict[];
}): readonly string[] {
  const sections = CLASS_ORDER.flatMap((cls) =>
    classSection({ cls, measured, members: verdicts.filter((verdict) => verdict.cls === cls), totals }),
  );
  // Nothing was measured on an `--apply` run, so nothing can have fallen short: the FLOOR qualifier is
  // suppressed there by counting zero unmeasured candidates rather than by a second branch downstream.
  let unmeasured = 0;
  if (measured) {
    unmeasured = verdicts.filter((verdict) => verdict.cls !== "hold" && verdict.diskKib === null).length;
  }
  const stripped = verdicts.filter((verdict) => verdict.dropsDeps).length;
  const depsLine =
    stripped === 0
      ? []
      : [`node_modules: ${String(stripped)} kept worktree(s) cold and unreferenced — dropped on --apply, tree kept`];
  return [...sections, totalsLine({ measured, totals, unmeasured }), ...depsLine];
}
