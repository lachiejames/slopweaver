/**
 * Bounding the SCAN, and deriving the apply deadline from the moment it ended — the pure half of the fix
 * for a nightly run that planned 55 GB of removals every night and performed none of them.
 *
 * ## The measurement this file exists for
 *
 * `--budget` was added to bound the REMOVALS, and `runWorktreePrune` computed its deadline
 * from the moment the PROCESS started — before a single `git status` had run. That was correct while a
 * scan cost seconds. It stopped being correct as the two worktree homes grew: the scan is serial, and per
 * worktree it costs a `git status --porcelain`, a `rev-list --count`, a patch-id comparison, a
 * `rev-list --not --remotes` and a `git log -1`.
 *
 * Two consecutive recipe slots measured it, and the records are still on disk under
 * `$SLOPWEAVER_HOME/live/recipe/slot-attempts/`:
 *
 * | slot | wall |
 * | --- | --- |
 * | first | 929.8 s |
 * | second | 982.4 s |
 *
 * Both ran past `DEFAULT_APPLY_BUDGET` (900 s) and both exited 0. `applyInRotation`'s loop condition is
 * `Date.now() < deadlineMs`, evaluated for the first time AFTER the scan — which had already spent the
 * whole budget — so the loop body never executed once, `removed` stayed 0, and the verb reported success.
 * The owner saw 90 registered worktrees in acme-admin and 756 in slopweaver, and asked why last night had
 * not handled them. It had not handled them because it never reached the removals.
 *
 * Reproduce the reading from the records themselves:
 * `grep -l '"worktree-prune"' $SLOPWEAVER_HOME/live/recipe/slot-attempts/*.json | xargs grep -h 'AtIso'`
 *
 * ## The two rules this file implements
 *
 * **The apply deadline starts when the SCAN ENDS.** {@link applyDeadlineMs} is the whole rule, and it is a
 * one-line function on purpose: it is the assertion a test can pin, and the shape the old code could not
 * express because its deadline was an expression at the top of a 30-line function.
 *
 * **A bounded scan is spread ROUND-ROBIN and SAYS what it did not reach.** {@link sweepWithin} stops
 * between worktrees — never during one, since a classification half-done is worse than one not attempted —
 * and reports the per-repository shortfall so {@link unreachedLine} can print it. That sentence is not
 * decoration: without it a partial census reads exactly like a whole one, and every consumer of `--json`
 * quietly understates. The round-robin itself reuses {@link ./pruneOrder}'s `interleave` rather than
 * growing a second copy — sweeping repositories in declaration order is what left acme-admin's candidates
 * untouched across two full passes on one `worktree-prune` slot, and a bounded scan would have
 * reproduced that failure one phase earlier.
 *
 * **Coldest-first is ORDERING, never eligibility.** {@link coldestFirst} decides which worktrees a bounded
 * scan spends itself on, and nothing else: every verdict is still `./pruneClassify`'s, off the full fact
 * set, and the 24-hour rule still holds a warm tree the ordering happened to reach. The honest objection —
 * that on a permanently-over-budget repository "never scanned" is indistinguishable from "never eligible",
 * so the cut is real even though it is not a rule — is answered by {@link unreachedLine} making the cut
 * visible rather than by denying it.
 *
 * **A bounded scan RESUMES where the last one stopped.** The order is stable, so without a cursor every
 * hourly run would classify the same coldest prefix and stop at the same place: a prefix of permanent holds
 * wider than `--scan-budget` would starve every tree behind it for good. {@link sweepWithin} hands back one
 * {@link ScanCursor} per repository it left short, and {@link scanOrder} rotates that repository's queue to
 * start past it, wrapping to the coldest once it runs off the end. A repository scanned whole clears its
 * cursor, so the next run starts coldest-first again. The cursor is an (mtime, path) key, so a
 * group of equal mtimes wider than the budget is walked through rather than restarted. Each cursor also
 * counts the consecutive runs that left its repository short without classifying anything there, and the
 * longest-waiting repository LEADS the next rotation, so a budget smaller than the repository count cannot
 * hand a fixed few of them every classification.
 */
import type { WorktreeInfo } from "../cmux/worktreeList.js";
import type { PruneVerdict } from "./pruneClassify.js";
import { interleave, type RepoPlan } from "./pruneOrder.js";

/** One worktree queued for scanning, kept with the repository whose git answers for it. */
export interface ScanEntry {
  readonly repoRoot: string;
  readonly worktree: WorktreeInfo;
  /**
   * The directory's own mtime in epoch ms, or `null` when it could not be stat'd.
   *
   * A cheap proxy for "how likely is this one to be a candidate", read with one `statSync` rather than the
   * five git calls a real scan costs. It orders the queue and decides NOTHING about any verdict.
   */
  readonly coldnessMs: number | null;
}

/** How many worktrees one repository had queued, and how many the budget never reached. */
export interface RepoShortfall {
  readonly repoRoot: string;
  readonly scanned: number;
  readonly unreached: number;
}

/**
 * Where one repository's next bounded scan resumes: past the (mtime, path) key of the last tree this one
 * classified.
 *
 * A KEY rather than a position or a bare path, because the tree a scan stopped on is often one the same run
 * then removes, and a key still orders against every tree left. The path half is what makes it total: a
 * stamp alone cannot say where inside a group of equal mtimes a scan stopped, and resuming "past 5" from the
 * middle of ten trees stamped 5 restarts that group forever. `null` is the unreadable-mtime
 * group, which sorts first.
 */
export interface ScanCursor {
  readonly repoRoot: string;
  readonly afterColdnessMs: number | null;
  readonly afterPath: string;
  /**
   * How many consecutive runs left this repository short while classifying nothing in it — zero for one the
   * last run reached. The largest count LEADS the next run's rotation: a declaration order, or a
   * reached-or-not bit, hands a budget smaller than the repository count to a fixed subset of them forever,
   * while a count lets every waiting repository overtake each one reached since.
   */
  readonly waited: number;
}

/**
 * The cursor record an apply writes: this scan's cursors for the repositories it queued, and every earlier
 * cursor for a repository it did not. An apply narrowed with `--repo` must not erase another repository's
 * resume point, or that repository restarts coldest-first on the same prefix every run.
 *
 * @param previous the record as it stands on disk now
 * @param queued the repositories this scan queued
 * @param written this scan's cursors
 * @returns the record to write
 */
export function mergeScanCursors({
  previous,
  queued,
  written,
}: {
  previous: readonly ScanCursor[];
  queued: ReadonlySet<string>;
  written: readonly ScanCursor[];
}): readonly ScanCursor[] {
  return [...previous.filter((cursor) => !queued.has(cursor.repoRoot)), ...written];
}

/** Where a repository with no cursor of its own starts: before every key, since no path is empty. */
const FROM_THE_COLDEST = { afterColdnessMs: null, afterPath: "" } as const;

/** The (mtime, path) key the queue is ordered by and a cursor points into. */
interface ScanKey {
  readonly coldnessMs: number | null;
  readonly path: string;
}

/**
 * Compare two scan keys: an unreadable mtime first, then oldest mtime, then path by code unit. Total, so two
 * distinct worktrees never tie.
 *
 * @returns negative when `left` is scanned first, positive when `right` is, zero only for one key
 */
function compareScanKeys({ left, right }: { left: ScanKey; right: ScanKey }): number {
  if (left.coldnessMs !== right.coldnessMs) {
    if (left.coldnessMs === null) {
      return -1;
    }
    if (right.coldnessMs === null) {
      return 1;
    }
    return left.coldnessMs - right.coldnessMs;
  }
  if (left.path === right.path) {
    return 0;
  }
  return left.path < right.path ? -1 : 1;
}

/** One queued worktree's scan key. */
function keyOf({ entry }: { entry: ScanEntry }): ScanKey {
  return { coldnessMs: entry.coldnessMs, path: entry.worktree.path };
}

/** What a bounded sweep produced. */
export interface SweepResult {
  /** One plan per repository, in the order the repositories were given — including empty ones. */
  readonly plans: readonly RepoPlan[];
  /** The per-repository shortfall, including repositories the budget reached entirely. */
  readonly shortfalls: readonly RepoShortfall[];
  /** Where each repository left short resumes next time; a repository scanned whole has none. */
  readonly cursors: readonly ScanCursor[];
}

/**
 * The instant a bounded apply pass may not start another removal after.
 *
 * Derived from when the SCAN ENDED rather than from when the process started, which is the entire fix for
 * this module's header: a budget meant to bound the removals must not be spent by the work that precedes
 * them. An unreadable clock is not possible here — the caller reads one — so this takes no failure path.
 *
 * @param scanEndedMs the instant the scan returned, read once by the caller
 * @param budgetMs how long the removals themselves may take
 * @returns the epoch instant after which no further removal is started
 */
export function applyDeadlineMs({ scanEndedMs, budgetMs }: { scanEndedMs: number; budgetMs: number }): number {
  return scanEndedMs + budgetMs;
}

/**
 * The least time an apply's plugin-mirror pass gets, however much of the removal window the removals spent.
 *
 * A mirror root frees ~200 MB in seconds (`./pluginMirrors.ts`), so a steady hour's dozen roots fit easily; the
 * floor exists so a removal backlog — measured at over a minute a tree — can never starve the larger reclaim.
 */
const MIRROR_PASS_FLOOR_MS = 120_000;

/**
 * The instant an apply's plugin-mirror pass stops starting roots: the removal window's end, or the floor past now.
 *
 * @param nowMs the instant the mirror pass starts
 * @param deadlineMs the removal window's own end, from {@link applyDeadlineMs}
 * @returns the later of the two
 */
export function mirrorPassDeadlineMs({ nowMs, deadlineMs }: { nowMs: number; deadlineMs: number }): number {
  return Math.max(deadlineMs, nowMs + MIRROR_PASS_FLOOR_MS);
}

/**
 * How old the `--apply` lock may be before a later apply takes it over, even from a LIVE holder.
 *
 * Finite on purpose: a holder wedged on something no bound covers would otherwise hold the lock for
 * as long as the process lives, and every hourly slot after it would remove nothing. A salvage push is no longer
 * that case — `writeGit` stops one at fifty minutes — but the lease bounds the lock, not any one child. Twelve hours clears the longest drain run on this machine, 480 minutes, with room for the one
 * removal an apply may start just before its deadline; {@link applyLeaseRefusal} keeps every apply inside it.
 */
export const APPLY_LEASE_MS = 12 * 60 * 60 * 1000;

/** How much of {@link APPLY_LEASE_MS} the scan and removal budgets together may claim. */
const APPLY_BUDGET_CEILING_MS = 11 * 60 * 60 * 1000;

/**
 * Why an `--apply` with these budgets must not start, or `null` when it may. Pure.
 *
 * A run whose budgets outlast the lease would have its lock taken over mid-drain by the next slot.
 *
 * @param budgetMs the removal budget
 * @param scanBudgetMs how long classification may run before the first removal
 * @returns the usage refusal, or `null`
 */
export function applyLeaseRefusal({
  budgetMs,
  scanBudgetMs,
}: {
  budgetMs: number;
  scanBudgetMs: number;
}): string | null {
  if (budgetMs + scanBudgetMs <= APPLY_BUDGET_CEILING_MS) {
    return null;
  }
  return `worktree prune: --budget plus --scan-budget comes to ${String(Math.round((budgetMs + scanBudgetMs) / 60_000))}m, past the ${String(APPLY_BUDGET_CEILING_MS / 60_000)}m an apply may hold its lock — split the drain into shorter runs`;
}

/**
 * Order one repository's queue coldest-directory-first, so a bounded scan spends itself where the
 * candidates are.
 *
 * An unreadable mtime sorts FIRST, not last. A directory that cannot be stat'd is more likely to be a
 * stale registration — the `gone` class, which costs nothing to classify — than a checkout somebody is
 * working in, and a scan that never reaches its unreadable entries never clears a stale record at all.
 *
 * Equal stamps are ordered by path, so the order is TOTAL: two runs over an unchanged repository queue the
 * same way whatever order git listed it in, and a {@link ScanCursor} can name any point in it.
 *
 * @param entries one repository's queued worktrees
 * @returns the same entries, coldest first
 */
export function coldestFirst({ entries }: { entries: readonly ScanEntry[] }): readonly ScanEntry[] {
  return entries.toSorted((left, right) =>
    compareScanKeys({ left: keyOf({ entry: left }), right: keyOf({ entry: right }) }),
  );
}

/**
 * One repository's coldest-first queue, rotated to start past a cursor and wrap to the coldest after the end.
 *
 * @param entries one repository's queue, already coldest-first
 * @param cursor where the previous bounded scan of it stopped, or `undefined` to start at the coldest
 * @returns the same entries, the first one past the cursor leading
 */
export function resumeAfter({
  entries,
  cursor,
}: {
  entries: readonly ScanEntry[];
  cursor: ScanCursor | undefined;
}): readonly ScanEntry[] {
  if (cursor === undefined) {
    return entries;
  }
  const after = { coldnessMs: cursor.afterColdnessMs, path: cursor.afterPath };
  const start = entries.findIndex((item) => compareScanKeys({ left: keyOf({ entry: item }), right: after }) > 0);
  if (start <= 0) {
    return entries;
  }
  return [...entries.slice(start), ...entries.slice(0, start)];
}

/**
 * The order a bounded scan works through: every repository's queue coldest-first, resumed past its cursor,
 * taken in rotation.
 *
 * @param repos each repository's queued worktrees, in the order the repositories were declared
 * @param cursors where the previous bounded scan left each repository short
 * @returns the entries, round-robin across repositories and coldest-first within each
 */
export function scanOrder({
  repos,
  cursors = [],
}: {
  repos: readonly (readonly ScanEntry[])[];
  cursors?: readonly ScanCursor[];
}): readonly ScanEntry[] {
  const cursorOf = ({ entries }: { entries: readonly ScanEntry[] }): ScanCursor | undefined =>
    cursors.find((cursor) => cursor.repoRoot === entries[0]?.repoRoot);
  // The longest-waiting repository leads; a repository with no cursor was scanned whole, so it waits for none.
  const waited = ({ entries }: { entries: readonly ScanEntry[] }): number => {
    const cursor = cursorOf({ entries });
    if (cursor === undefined) {
      return 0;
    }
    return cursor.waited;
  };
  return interleave({
    lists: repos
      .toSorted((left, right) => waited({ entries: right }) - waited({ entries: left }))
      .map((entries) => resumeAfter({ cursor: cursorOf({ entries }), entries: coldestFirst({ entries }) })),
  });
}

/**
 * Classify as much of the queue as the budget allows, stopping BETWEEN worktrees.
 *
 * The deadline is checked before each classification and never during one, for the same reason
 * `./pruneRun`'s apply pass stops between removals: a fact set gathered half-way is not a fact set, and
 * the classifier's whole contract is that an unknown fact HOLDS. Stopping cleanly leaves the unscanned
 * worktree absent from the plan, which is the safe direction — `applyOrder` can only ever emit what was
 * classified.
 *
 * @param entries the queue, already in scan order
 * @param repoRoots every repository being swept, so one that got no entries still reports a shortfall row
 * @param classify the effectful per-worktree scan and classification the caller injects
 * @param deadlineMs the instant after which no further worktree is classified
 * @param nowMs the clock, injected so the bound is provable without waiting
 * @param previous the cursors this scan resumed from, carried forward for a repository it never reached
 * @returns the per-repository plans, the per-repository shortfall and where each short one resumes
 */
export function sweepWithin({
  entries,
  repoRoots,
  classify,
  deadlineMs,
  nowMs,
  previous = [],
}: {
  entries: readonly ScanEntry[];
  repoRoots: readonly string[];
  classify: (entry: ScanEntry) => PruneVerdict;
  deadlineMs: number;
  nowMs: () => number;
  previous?: readonly ScanCursor[];
}): SweepResult {
  const verdicts = new Map<string, PruneVerdict[]>(repoRoots.map((repoRoot) => [repoRoot, []]));
  const queued = new Map<string, number>(repoRoots.map((repoRoot) => [repoRoot, 0]));
  // Both maps are SEEDED from `repoRoots`, so every lookup below BY a declared root is present by
  // construction, and `!` is the honest spelling of that rather than a `?? 0` that would silently invent a
  // repository. An entry naming a root the caller did not declare is dropped instead of counted: there is
  // no shortfall row it could ever appear in, so counting it would report a queue nothing reports on.
  for (const entry of entries) {
    const queuedHere = queued.get(entry.repoRoot);
    if (queuedHere !== undefined) {
      queued.set(entry.repoRoot, queuedHere + 1);
    }
  }
  const lastKey = new Map<string, ScanKey>();
  let index = 0;
  while (index < entries.length && nowMs() < deadlineMs) {
    const entry = entries[index]!;
    verdicts.get(entry.repoRoot)?.push(classify(entry));
    lastKey.set(entry.repoRoot, keyOf({ entry }));
    index += 1;
  }
  const shortfalls = repoRoots.map((repoRoot) => {
    const scanned = verdicts.get(repoRoot)!.length;
    return { repoRoot, scanned, unreached: queued.get(repoRoot)! - scanned };
  });
  return {
    cursors: shortfalls.flatMap((shortfall) =>
      nextCursor({ last: lastKey.get(shortfall.repoRoot), previous, shortfall }),
    ),
    plans: repoRoots.map((repoRoot) => ({ repoRoot, verdicts: verdicts.get(repoRoot)! })),
    shortfalls,
  };
}

/**
 * Where one repository's next scan resumes: nowhere for one scanned whole, past the last key for one left
 * short, and — for one never reached — its previous point, one run longer waited so it gains on the others.
 *
 * @param shortfall the repository's scanned and unreached counts
 * @param last the key of the last tree this run classified there, absent when it classified none
 * @param previous the cursors this run resumed from
 * @returns the cursor to persist, or none
 */
function nextCursor({
  shortfall,
  last,
  previous,
}: {
  shortfall: RepoShortfall;
  last: ScanKey | undefined;
  previous: readonly ScanCursor[];
}): readonly ScanCursor[] {
  const { repoRoot } = shortfall;
  if (shortfall.unreached === 0) {
    return [];
  }
  if (last !== undefined) {
    return [{ afterColdnessMs: last.coldnessMs, afterPath: last.path, repoRoot, waited: 0 }];
  }
  const before = previous.find((cursor) => cursor.repoRoot === repoRoot);
  if (before !== undefined) {
    return [{ ...before, waited: before.waited + 1 }];
  }
  return [{ ...FROM_THE_COLDEST, repoRoot, waited: 1 }];
}

/**
 * The sentence a run prints when the scan budget left worktrees unlooked-at.
 *
 * Spelled per repository and never as one total, for the reason `./pruneOrder`'s `backlogLine` is: a
 * shortfall of twelve across two repositories is exactly the ambiguity the round-robin exists to remove.
 *
 * This line is what keeps coldest-first ordering from being a hidden age cut. A partial census that does
 * not announce itself reads as a whole one, and the reader draws a conclusion about the repository that
 * the run never measured.
 *
 * @param shortfalls every repository's scanned and unreached counts
 * @returns the line, or `undefined` when every queued worktree was classified
 */
export function unreachedLine({ shortfalls }: { shortfalls: readonly RepoShortfall[] }): string | undefined {
  const missed = shortfalls.filter((shortfall) => shortfall.unreached > 0);
  if (missed.length === 0) {
    return undefined;
  }
  const per = missed
    .map((shortfall) => `${shortfall.unreached} of ${shortfall.scanned + shortfall.unreached} in ${shortfall.repoRoot}`)
    .join(" · ");
  return (
    `scan budget reached with worktrees never looked at — ${per}. ` +
    "Every count above is a PARTIAL census of those repositories; the next --apply resumes past where this one stopped."
  );
}
