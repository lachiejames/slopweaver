/**
 * `worktree prune`'s SCAN half: read every declared repository, and classify as much of it as the budget allows.
 *
 * Split out of `./pruneRun.ts` along the seam the verb already had. That file's header carries the rails,
 * and two of them are the reason this half is its own module rather than a section: the scan is bounded
 * SEPARATELY from the apply and its end is what the apply budget is counted from, and it sweeps repositories
 * round-robin so a budget that runs out cannot spend itself entirely inside whichever repository the profile
 * happens to list first. Everything here reads; nothing here deletes.
 */
import { readFileSync, realpathSync, statSync } from "node:fs";
import { join } from "node:path";

import { z } from "zod";

import { slopweaverHome } from "../../../config.js";
import { logger } from "../../../lib/logger.js";
import { safeJsonParse, safeJsonStringify } from "../../../lib/safeJson.js";
import { writeFileAtomic } from "../../../lib/writeAtomic.js";
import { mainCheckoutsFromProfile } from "../../../profileStore.js";
import { stateHomePaths } from "../../../stateHome.js";
import { worktreePathKey } from "../../../worktree/location.js";
import { classifyWorktree } from "../../../worktree/pruneClassify.js";
import { measureCandidates } from "../../../worktree/pruneDisk.js";
import { interleave, type RepoPlan } from "../../../worktree/pruneOrder.js";
import { dirMs, listRepoWorktrees, scanWorktree, trunkRefOf } from "../../../worktree/pruneScan.js";
import {
  type RepoShortfall,
  type ScanCursor,
  type ScanEntry,
  scanOrder,
  sweepWithin,
} from "../../../worktree/pruneSweep.js";
import { type LiveState, liveHoldsOn, openPullRequestsOn } from "./pruneLiveState.js";

/** Whether one `--repo` may be swept, and the refusal line when it may not. */
export type PruneRepoAdmission =
  { readonly kind: "admitted"; readonly repo: string } | { readonly kind: "refused"; readonly line: string };

/**
 * Whether `--repo` names a repository this run may sweep. PURE: the shell supplies the one filesystem fact.
 *
 * A DECLARED checkout is admitted as it always was. An undeclared one is admitted only under `--no-salvage`
 * and only when its `.git` is a directory, i.e. a main checkout rather than a linked worktree. Salvage pushes a
 * `salvage/<slug>-<sha8>` branch to the repository's remote, and a checkout the profile never declared has
 * never been agreed to receive one, so the flag that turns salvage off is what admits it. Declaring it instead
 * would enrol it in every `mainCheckouts` consumer, the hourly prune WITH salvage among them. A submodule or a
 * `--separate-git-dir` checkout has a `.git` file and is refused: a safe false negative.
 *
 * @param declared the profile's main checkouts, each once
 * @param repo the `--repo` value, matched by exact path so a typo can never widen into a sweep of everything
 * @param noSalvage whether the caller passed `--no-salvage`
 * @param gitDirIsDirectory whether `<repo>/.git` is a directory, read only for an undeclared path under the flag
 * @returns the path to sweep, or the line the verb refuses with
 */
export function admitPruneRepo({
  declared,
  repo,
  noSalvage,
  gitDirIsDirectory,
}: {
  declared: readonly string[];
  repo: string;
  noSalvage: boolean;
  gitDirIsDirectory: boolean;
}): PruneRepoAdmission {
  if (declared.includes(repo)) {
    return { kind: "admitted", repo };
  }
  if (!noSalvage) {
    return {
      kind: "refused",
      line: `worktree prune: ${repo} is not a declared main checkout; pass --no-salvage to admit an undeclared main checkout`,
    };
  }
  if (!gitDirIsDirectory) {
    return {
      kind: "refused",
      line: `worktree prune: ${repo} is not a declared main checkout; --no-salvage admits an undeclared path only when its .git is a directory (a main checkout)`,
    };
  }
  return { kind: "admitted", repo };
}

/** Every repository one run sweeps, or the line it refuses with. */
export type PruneRepoSelection =
  | { readonly kind: "selected"; readonly repos: readonly string[] }
  | { readonly kind: "refused"; readonly line: string };

/** Whether `<repo>/.git` is a directory; absent, unreadable or a file all answer false. */
function gitDirIsDirectoryAt({ repo }: { repo: string }): boolean {
  try {
    return statSync(join(repo, ".git")).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Every repository to sweep: the profile's declared main checkouts, or the one `--repo` names.
 *
 * An unmatched `--repo` refuses rather than falling back to all of them, the one behaviour a typo must not be
 * able to turn into a sweep of everything; {@link admitPruneRepo} is the decision. An admitted undeclared path is
 * resolved to its physical spelling, because git lists the main worktree physically and the scan recognises the
 * main checkout by literal equality with that listing.
 *
 * @param repo the `--repo` value, or `undefined` to sweep every declared checkout
 * @param noSalvage whether the caller passed `--no-salvage`, the one thing that admits an undeclared checkout
 * @returns the repository roots to sweep, in profile order, each once — or the refusal line
 */
export function selectRepos({ repo, noSalvage }: { repo: string | undefined; noSalvage: boolean }): PruneRepoSelection {
  const declared = distinctRepos({
    declared: mainCheckoutsFromProfile({ home: slopweaverHome() }).map((config) => config.path),
    keyOf: physicalRepoKey,
  });
  if (repo === undefined) {
    if (declared.length === 0) {
      return {
        kind: "refused",
        line: "worktree prune: no main checkouts declared — add a `mainCheckouts` array to $SLOPWEAVER_HOME/profile.json",
      };
    }
    return { kind: "selected", repos: declared };
  }
  const undeclaredUnderFlag = noSalvage && !declared.includes(repo);
  const admission = admitPruneRepo({
    declared,
    gitDirIsDirectory: undeclaredUnderFlag && gitDirIsDirectoryAt({ repo }),
    noSalvage,
    repo,
  });
  if (admission.kind === "refused") {
    return admission;
  }
  if (undeclaredUnderFlag) {
    return { kind: "selected", repos: [physicalRepoKey({ path: admission.repo })] };
  }
  return { kind: "selected", repos: [admission.repo] };
}

/**
 * The declared repositories with each one kept once, at its first spelling.
 *
 * A profile declaring one repository twice — verbatim, as `/r` and `/r/`, or through a symlink — would queue
 * every tree in it twice, and the apply order is built once per run, so a tree it tried and kept would be
 * tried again before a tree it never tried.
 *
 * @param declared the profile's main checkouts, in profile order
 * @param keyOf the one key two spellings of a repository agree on
 * @returns each repository once, in the order it was first declared
 */
export function distinctRepos({
  declared,
  keyOf,
}: {
  declared: readonly string[];
  keyOf: (input: { path: string }) => string;
}): readonly string[] {
  const seen = new Set<string>();
  return declared.filter((path) => {
    const key = keyOf({ path });
    const fresh = !seen.has(key);
    seen.add(key);
    return fresh;
  });
}

/**
 * A repository's physical path, symlinks resolved, or its lexical key when it cannot be resolved. A resolved
 * path is never folded lexically as well: two real directories are two repositories, whatever their names.
 *
 * @param path a declared main checkout
 * @returns the key {@link distinctRepos} folds duplicates on
 */
export function physicalRepoKey({ path }: { path: string }): string {
  try {
    return realpathSync(path);
  } catch {
    return worktreePathKey({ path });
  }
}

/** The file one `$SLOPWEAVER_HOME`'s scan cursors live in, beside the salvage ledger. */
function scanCursorPath({ home }: { home: string }): string {
  return join(stateHomePaths({ home }).worktreeBundles, "scan-cursors.json");
}

const scanCursorsSchema = z.array(
  z.object({
    afterColdnessMs: z.number().nullable(),
    afterPath: z.string(),
    repoRoot: z.string(),
    waited: z.number().int().nonnegative(),
  }),
);

/**
 * Parse a state file's text, answering `undefined` for text that is not JSON at all — so one torn byte reads
 * as a malformed record and takes the documented fallback, rather than throwing out of every hourly run.
 *
 * @param text the file's text
 * @param label what the text is, for the size guard's message
 * @returns the parsed value, or undefined when the text does not parse
 * @internal
 */
export function jsonOrUndefined({ text, label }: { text: string; label: string }): unknown {
  try {
    return safeJsonParse({ label, text });
  } catch {
    return undefined;
  }
}

/**
 * Where the last `--apply` left each repository's bounded scan short — `worktree/pruneSweep.ts` says why.
 *
 * An absent file is the normal state of a home whose last scan reached everything. An unreadable or
 * malformed one is said out loud and read as no cursors, which only costs the rotation: the scan starts
 * coldest-first, exactly as it did before cursors existed.
 *
 * @returns the cursors, empty when there are none or they could not be read
 */
export function readScanCursors({ home }: { home: string }): readonly ScanCursor[] {
  const path = scanCursorPath({ home });
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return [];
    }
    logger.error({ msg: `worktree prune: could not read ${path} — this scan starts coldest-first` });
    return [];
  }
  const parsed = scanCursorsSchema.safeParse(jsonOrUndefined({ label: "worktree prune scan cursors", text }));
  if (!parsed.success) {
    logger.error({ msg: `worktree prune: ${path} is not a cursor list — this scan starts coldest-first` });
    return [];
  }
  return parsed.data;
}

/**
 * Replace the cursor record whole with one `mergeScanCursors` (`worktree/pruneSweep.ts`) built.
 *
 * NEVER throws. The cursors are a fairness hint, not a safety prerequisite: an unwritable `worktree-bundles`
 * must cost the next run its resume point, never this run its removals. A state home too full for
 * the apply lock stops the run before this, on purpose.
 *
 * @param cursors every repository's resume point; an empty list records that the scan reached everything
 * @returns whether the record was written; a failure is reported on stderr
 */
export function writeScanCursors({ home, cursors }: { home: string; cursors: readonly ScanCursor[] }): boolean {
  try {
    writeFileAtomic({
      contents: `${safeJsonStringify({ label: "worktree prune scan cursors", value: cursors })}\n`,
      path: scanCursorPath({ home }),
    });
    return true;
  } catch (error) {
    logger.error({
      msg: `worktree prune: the scan cursors could not be written — the next scan starts coldest-first — ${String(error)}`,
    });
    return false;
  }
}

/** One repository's queue of worktrees to scan, with the trunk ref its branches are judged against. */
export interface RepoQueue {
  readonly repoRoot: string;
  readonly trunk: string;
  readonly entries: readonly ScanEntry[];
}

/**
 * Queue one repository's worktrees for scanning — one `git worktree list` and one `statSync` each.
 *
 * Deliberately cheap: the whole point of a bounded scan is to decide WHICH worktrees to spend five git
 * calls on, so the queue itself must cost almost nothing to build even at 756 entries.
 *
 * @returns the queue, or `null` when the repository could not be read at all
 */
export function queueRepo({ repoRoot }: { repoRoot: string }): RepoQueue | null {
  const worktrees = listRepoWorktrees({ repoRoot });
  const trunk = trunkRefOf({ repoRoot });
  if (worktrees === null || trunk === null) {
    logger.error({ msg: `worktree prune: could not read ${repoRoot} — skipped, nothing was touched there` });
    return null;
  }
  return {
    entries: worktrees.map((worktree) => ({ coldnessMs: dirMs({ path: worktree.path }), repoRoot, worktree })),
    repoRoot,
    trunk,
  };
}

/**
 * One measured candidate's KiB, from a map whose values are themselves nullable.
 *
 * A `Map<string, number | null>` returns `undefined` for a missing key and `null` for an unmeasured one, and
 * the caller only asks about keys it has already confirmed present — so both absences mean "not measured".
 *
 * @param measured the measurement map
 * @param path the worktree to read
 * @returns the measured KiB, or `null` when it was never measured
 */
function measuredKibOf({
  measured,
  path,
}: {
  measured: ReadonlyMap<string, number | null>;
  path: string;
}): number | null {
  const kib = measured.get(path);
  if (kib === undefined) {
    return null;
  }
  return kib;
}

/**
 * The filesystem path free space is read from, either side of an apply.
 *
 * The first repository being swept, because that is where the removals happen. `/` is the honest stand-in
 * when there is no repository at all — a run with no repositories removes nothing, so the reading is
 * unused, and refusing to produce one would mean a failure path for a case that cannot free any disk.
 *
 * @param repos the repositories being swept
 * @returns a path on the filesystem to probe
 */
export function probePath({ repos }: { repos: readonly string[] }): string {
  const first = repos[0];
  if (first === undefined) {
    return "/";
  }
  return first;
}

/** What a bounded scan produced across every repository it could read. */
export interface ScanPass {
  readonly plans: readonly RepoPlan[];
  readonly shortfalls: readonly RepoShortfall[];
  /** Where each repository left short resumes on the next run. */
  readonly cursors: readonly ScanCursor[];
  /** The instant the scan stopped, which is what the apply budget is counted from. */
  readonly endedMs: number;
}

/**
 * Classify as much of every repository as the scan budget allows, round-robin and coldest-first.
 *
 * @param queues every readable repository's queue
 * @param live the sessions, workspaces, processes and open pull requests holding a worktree
 * @param nowMs the instant the whole plan is judged against
 * @param olderThanMs the eligibility age
 * @param nukeAfterMs the age past which a hold over unbacked work is released by capturing that work
 * @param scanBudgetMs how long the scan itself may take
 * @param runsDir where handover run journals live
 * @param cursors where the previous `--apply` left each repository short
 * @param includeUnmarkedLap whether this is the explicit run that may take a lap tree with no provenance marker
 *   (`--include-unmarked-lap`); never set by the hourly or disk-pressure runs
 * @returns the plans, the per-repository shortfall, where each short one resumes, and when the scan ended
 */
export function scanRepos({
  cursors,
  queues,
  live,
  nowMs,
  nukeAfterMs,
  olderThanMs,
  scanBudgetMs,
  runsDir,
  includeUnmarkedLap = false,
}: {
  queues: readonly RepoQueue[];
  live: LiveState;
  nowMs: number;
  nukeAfterMs: number;
  olderThanMs: number;
  scanBudgetMs: number;
  runsDir: string;
  cursors: readonly ScanCursor[];
  includeUnmarkedLap?: boolean;
}): ScanPass {
  const trunks = new Map(queues.map((queue) => [queue.repoRoot, queue.trunk]));
  const swept = sweepWithin({
    classify: (entry) =>
      classifyWorktree({
        facts: scanWorktree({
          liveRefs: liveHoldsOn({ live, path: entry.worktree.path }),
          mainCheckout: entry.repoRoot,
          openPullRequests: openPullRequestsOn({ branch: entry.worktree.branch, live }),
          repoRoot: entry.repoRoot,
          runsDir,
          // Every entry was built from one of `queues`, so its repository always has a trunk in the map.
          trunk: trunks.get(entry.repoRoot)!,
          worktree: entry.worktree,
        }),
        includeUnmarkedLap,
        nowMs,
        nukeAfterMs,
        olderThanMs,
      }),
    deadlineMs: Date.now() + scanBudgetMs,
    entries: scanOrder({ cursors, repos: queues.map((queue) => queue.entries) }),
    nowMs: () => Date.now(),
    previous: cursors,
    repoRoots: queues.map((queue) => queue.repoRoot),
  });
  return { cursors: swept.cursors, endedMs: Date.now(), plans: swept.plans, shortfalls: swept.shortfalls };
}

/**
 * Measure the candidates across EVERY repository under one shared budget, then splice the results back.
 *
 * One budget rather than one per repository, because the budget exists to bound the whole run: two
 * repositories each spending the full allowance is the slow run it was added to prevent.
 *
 * @param plans every repository's classified verdicts
 * @returns the same plans with each candidate's `diskKib` measured, as far as the budget reached
 */
export function measurePlans({ plans }: { plans: readonly RepoPlan[] }): readonly RepoPlan[] {
  const candidates = interleave({
    lists: plans.map((plan) => plan.verdicts.filter((verdict) => verdict.cls !== "hold")),
  });
  const measured = new Map(
    measureCandidates({ verdicts: candidates }).map((verdict) => [verdict.path, verdict.diskKib]),
  );
  return plans.map((plan) => ({
    repoRoot: plan.repoRoot,
    verdicts: plan.verdicts.map((verdict) =>
      measured.has(verdict.path) ? { ...verdict, diskKib: measuredKibOf({ measured, path: verdict.path }) } : verdict,
    ),
  }));
}
