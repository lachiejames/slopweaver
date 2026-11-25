/**
 * The order an apply acts in, and what a bounded run has left over — the pure half of `--apply`.
 *
 * Both pieces exist for the same measured failure. One `worktree-prune` slot swept the repositories
 * in the order the profile declares them, ran out of time inside the first, and left the second's sixteen
 * candidates untouched across two full passes; the audit that slot wrote in the state home records it in the
 * run's own words. A shortfall has to be SPREAD to be honest — the same
 * argument `pruneRun.ts`'s `measurePlans` already makes about the disk budget, applied to the removals.
 *
 * The rotation also has to survive a run that CANNOT finish its first removal. A salvage whose push stalls
 * past the whole budget and then declines keeps its tree, and an order rebuilt from scratch every hour would
 * put that same tree first again, forever, ahead of every removable one behind it. So an apply
 * remembers ({@link ApplyMemory}) each tree it attempted and had to keep, and when it last attempted anything
 * in each repository. The next one tries every never-attempted tree first, rotating from the repository
 * attempted longest ago, and only then the kept ones, the longest-ago attempt first.
 *
 * Nothing here touches git, the filesystem or the clock, so the ordering and the backlog sentence are
 * provable against literal verdicts rather than against a checkout that has to be staged first.
 */
import type { PruneVerdict } from "./pruneClassify.js";

/** One verdict, kept with the repository whose git has to carry it out. */
export interface RepoVerdict {
  readonly repoRoot: string;
  readonly verdict: PruneVerdict;
}

/** A tree an apply attempted and kept, and when — so the next apply tries every other tree before it. */
interface KeptAttempt {
  readonly repoRoot: string;
  readonly path: string;
  readonly attemptedAtMs: number;
}

/** When an apply last attempted a removal in one repository — so the next leads with another one. */
interface RepoAttempt {
  readonly repoRoot: string;
  readonly lastAttemptMs: number;
}

/** What one apply leaves the next to order by. */
export interface ApplyMemory {
  readonly kept: readonly KeptAttempt[];
  readonly repos: readonly RepoAttempt[];
}

/** One removal an apply attempted, and whether the tree went. */
export interface ApplyAttempt {
  readonly repoRoot: string;
  readonly path: string;
  readonly removed: boolean;
  readonly atMs: number;
}

/** One repository's classified worktrees. */
export interface RepoPlan {
  readonly repoRoot: string;
  readonly verdicts: readonly PruneVerdict[];
}

/**
 * Take one item from each list in turn until all are exhausted.
 *
 * @param lists the per-repository lists, in the order the repositories were swept
 * @returns the items, round-robin
 */
export function interleave<T>({ lists }: { lists: readonly (readonly T[])[] }): readonly T[] {
  const longest = Math.max(0, ...lists.map((list) => list.length));
  return Array.from({ length: longest }, (_unused, index) => lists.map((list) => list[index]))
    .flat()
    .filter((item): item is T => item !== undefined);
}

/**
 * Whether `--apply` acts on one verdict.
 *
 * `pushed` is in the applied set by default — the owner's untouched-over-24h rule, whose reasoning is in
 * `pruneClassify.ts`'s header. `detached` is in it with its own witness rather than a looser age cut, and so is
 * `salvaged`; the same header carries both.
 * `snapshot` joined under the owner's evergreen-prune ruling: a leaked one-off Codex snapshot past the
 * longest pass, its reasoning in `freshSnapshotPath.ts`. `lap` is a spent `github lap` tree, its reasoning in
 * `pruneLapClass.ts`.
 * `--merged-only` is the way back to the narrowest pass, and it is the way back past all five.
 *
 * @param verdict the classified worktree
 * @param mergedOnly whether the caller narrowed the run to the absorbed classes
 * @returns whether an apply removes this tree
 */
export function applicable({ verdict, mergedOnly }: { verdict: PruneVerdict; mergedOnly: boolean }): boolean {
  if (verdict.cls === "merged" || verdict.cls === "interrupted") {
    return true;
  }
  if (mergedOnly) {
    return false;
  }
  const removable: readonly PruneVerdict["cls"][] = ["pushed", "detached", "snapshot", "lap", "salvaged"];
  return removable.includes(verdict.cls);
}

/**
 * The identity an apply's memory knows a tree by: its repository and its path together, because a path a
 * removed worktree freed can be registered again under another repository.
 *
 * @returns the key naming one repository's tree at one path
 */
export function memoryKey({ repoRoot, path }: { repoRoot: string; path: string }): string {
  return `${repoRoot}\0${path}`;
}

/**
 * Every removal an apply will attempt: the never-attempted ones round-robin across the repositories, from the
 * one attempted longest ago, then the ones an earlier apply attempted and kept, the longest-ago attempt first.
 *
 * @param plans every repository's classified verdicts, in sweep order
 * @param mergedOnly whether the caller narrowed the run to the absorbed classes
 * @param memory what earlier applies attempted
 * @returns the removals in the order this apply attempts them
 */
export function applyOrder({
  plans,
  mergedOnly,
  memory = { kept: [], repos: [] },
}: {
  plans: readonly RepoPlan[];
  mergedOnly: boolean;
  memory?: ApplyMemory;
}): readonly RepoVerdict[] {
  const keptAt = new Map(memory.kept.map((attempt) => [memoryKey(attempt), attempt.attemptedAtMs]));
  const keyOf = (item: RepoVerdict): string => memoryKey({ path: item.verdict.path, repoRoot: item.repoRoot });
  const lastAt = new Map(memory.repos.map((repo) => [repo.repoRoot, repo.lastAttemptMs]));
  const since = ({ repoRoot }: { repoRoot: string }): number => {
    const at = lastAt.get(repoRoot);
    if (at === undefined) {
      return Number.NEGATIVE_INFINITY;
    }
    return at;
  };
  const lists = plans
    .toSorted((left, right) => since({ repoRoot: left.repoRoot }) - since({ repoRoot: right.repoRoot }))
    .map((plan) =>
      plan.verdicts
        .filter((verdict) => applicable({ mergedOnly, verdict }))
        .map((verdict) => ({ repoRoot: plan.repoRoot, verdict })),
    );
  const fresh = interleave({ lists: lists.map((list) => list.filter((item) => !keptAt.has(keyOf(item)))) });
  const retried = lists
    .flat()
    .filter((item) => keptAt.has(keyOf(item)))
    .toSorted((left, right) => keptAt.get(keyOf(left))! - keptAt.get(keyOf(right))!);
  return [...fresh, ...retried];
}

/**
 * The memory the next apply orders by: these attempts' kept trees at their own instant, every earlier kept
 * tree they did not touch, and each repository's latest attempt. An earlier kept tree is forgotten only once
 * it is no longer a worktree of a repository whose worktree list this run read — never for being absent from
 * one run's PLAN, which a bounded scan leaves partial, so a kept tree it did not reach would read as fresh
 * and lead again.
 *
 * @param attempted the removals attempted since `previous`, a removal still running recorded as not removed
 * @param previous the memory those attempts were ordered by
 * @param registered the `memoryKey` of every worktree of every repository in `listed`, scanned this run or not
 * @param listed the repositories whose worktree list this run read
 * @returns the memory to persist
 */
export function nextApplyMemory({
  attempted,
  previous,
  registered,
  listed,
}: {
  attempted: readonly ApplyAttempt[];
  previous: ApplyMemory;
  registered: ReadonlySet<string>;
  listed: ReadonlySet<string>;
}): ApplyMemory {
  const touched = new Set(attempted.map((attempt) => memoryKey(attempt)));
  const carried = previous.kept.filter(
    (attempt) =>
      !touched.has(memoryKey(attempt)) && (registered.has(memoryKey(attempt)) || !listed.has(attempt.repoRoot)),
  );
  const keptNow = attempted
    .filter((attempt) => !attempt.removed)
    .map((attempt) => ({ attemptedAtMs: attempt.atMs, path: attempt.path, repoRoot: attempt.repoRoot }));
  const lastAt = new Map(previous.repos.map((repo) => [repo.repoRoot, repo.lastAttemptMs]));
  for (const attempt of attempted) {
    const was = lastAt.get(attempt.repoRoot);
    if (was === undefined || attempt.atMs > was) {
      lastAt.set(attempt.repoRoot, attempt.atMs);
    }
  }
  return {
    kept: [...carried, ...keptNow],
    repos: [...lastAt.entries()].map(([repoRoot, lastAttemptMs]) => ({ lastAttemptMs, repoRoot })),
  };
}

/**
 * The sentence a run prints when its budget stopped it with removals still owed.
 *
 * Spelled per repository rather than as one count, because "12 left" over two repositories is the exact
 * ambiguity the round-robin was added to remove: a reader has to know whether the shortfall landed on one
 * of them or on both.
 *
 * @param remaining the removals the budget did not reach
 * @returns the line, or `undefined` when nothing was left over
 */
export function backlogLine({ remaining }: { remaining: readonly RepoVerdict[] }): string | undefined {
  if (remaining.length === 0) {
    return undefined;
  }
  const counts = new Map<string, number>();
  for (const item of remaining) {
    const { repoRoot } = item;
    const owed = counts.get(repoRoot);
    // A repository's first owed removal opens its tally; every later one adds to it.
    if (owed === undefined) {
      counts.set(repoRoot, 1);
    } else {
      counts.set(repoRoot, owed + 1);
    }
  }
  const per = [...counts.entries()].map(([repoRoot, count]) => `${count} in ${repoRoot}`).join(" · ");
  return (
    `budget reached with ${remaining.length} removal(s) still owed — ${per}. ` +
    "Nothing was cut short: the next run re-plans and resumes."
  );
}
