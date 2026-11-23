/**
 * Whether a MAIN CHECKOUT is current and correctly installed — the pure half.
 *
 * ## Why this exists
 *
 * Two failures of the same shape were measured and both were invisible until something
 * downstream broke. In one, a main checkout's `node_modules` still held a transitive dependency at a version
 * the lockfile had long since moved off, so every call through the resilience stack threw before touching the
 * network — CI was green throughout, because CI installs from the lockfile and the local tree does not. In the
 * other, a main checkout was one commit behind its own upstream, so a session built on a base that did not yet
 * know about the thing it was asked to use.
 *
 * Neither is detectable by looking at the code. Both are detectable in one cheap read of two mtimes and one
 * `rev-list --count`, which is what this module turns into a verdict.
 *
 * ## What is deliberately NOT here
 *
 * No daemon, no auto-rebase, no refusal on any drift — the owner ruled that overkill explicitly, and the
 * reason is that a drifted base is often FINE: it only matters when the change depends on something the newer
 * base carries. Nothing here decides that; `../cmux/baseFreshness.ts` states the honest proxy (file overlap)
 * and leaves the judgement to a person.
 *
 * Pure: every input a caller could only get by running git or stat'ing a file is passed in already-read, so
 * every rule below is testable against literal fixtures with no filesystem and no subprocess.
 */

import { absentAs } from "#lib/absent.js";

/** How one ref stands against another: commits it has that the other lacks, in each direction. */
export interface AheadBehind {
  /** Commits the upstream has that the local head does not — the "you are N behind" number. */
  readonly behind: number;
  /** Commits the local head has that the upstream does not. */
  readonly ahead: number;
}

/**
 * Parse `git rev-list --left-right --count <upstream>...HEAD`, whose output is `<behind>\t<ahead>`.
 *
 * Returns `undefined` rather than zeroes for anything that is not exactly two non-negative integers — an
 * unparseable count must never read as "current", which is the whole failure class this module exists for.
 *
 * @param text the exact stdout from the rev-list call
 * @returns the counts, or `undefined` when the output was not the expected pair
 */
export function parseAheadBehind({ text }: { text: string }): AheadBehind | undefined {
  const fields = text.trim().split(/\s+/u);
  const [left, right] = fields;
  if (fields.length !== 2 || left === undefined || right === undefined) {
    return undefined;
  }
  if (!/^\d+$/u.test(left) || !/^\d+$/u.test(right)) {
    return undefined;
  }
  return { ahead: Number(right), behind: Number(left) };
}

/**
 * Parse a `git diff --name-only` / `git ls-files`-shaped listing into one repo-relative path per line.
 *
 * @param text the exact stdout
 * @returns the paths, blank lines dropped, in the order git printed them
 */
export function parseNameOnly({ text }: { text: string }): readonly string[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

/**
 * The files whose arrival in a pull means `node_modules` no longer reflects the lockfile.
 *
 * `.yarn/patches/` is in the set because a changed patch produces a different installed tree from an
 * unchanged lockfile entry, which is exactly the silent-staleness shape this guards.
 */
const DEPENDENCY_FILENAMES: ReadonlySet<string> = new Set(["package.json", "yarn.lock", ".yarnrc.yml"]);

/** The directory prefix whose contents change the installed tree without changing a manifest filename. */
const PATCH_PREFIX = ".yarn/patches/";

/**
 * Whether one repo-relative path is a dependency-defining file, at the root or in any nested workspace.
 *
 * @param path the repo-relative path
 * @returns true when a change to it invalidates an existing `node_modules`
 */
export function isDependencyPath({ path }: { path: string }): boolean {
  const filename = path.slice(path.lastIndexOf("/") + 1);
  return DEPENDENCY_FILENAMES.has(filename) || path.startsWith(PATCH_PREFIX) || path.includes(`/${PATCH_PREFIX}`);
}

/**
 * Whether a set of paths a pull just changed means an install must follow it.
 *
 * This is the decision behind "post-pull install, by construction": a pull that touched no dependency file
 * needs no install, and saying so is what keeps the install from being skipped the one time it matters.
 *
 * @param changedPaths the repo-relative paths the pull changed
 * @returns the dependency-defining paths among them — empty when no install is needed
 */
export function dependencyPathsAmong({ changedPaths }: { changedPaths: readonly string[] }): readonly string[] {
  return changedPaths.filter((path) => isDependencyPath({ path }));
}

/** Whether an installed tree can be believed to match the lockfile beside it. */
export type InstallFreshness = "current" | "stale" | "never-installed" | "unmeasurable";

/**
 * Compare the last PROOF that the tree matches its sources against the last change to those sources.
 *
 * The comparison is mtimes, not a resolution diff, and that limit is stated rather than buried: it catches
 * "the lockfile moved and nothing reinstalled" — the measured failure, since a `git pull` stamps the pulled
 * lockfile with the pull's own time — and it cannot catch a tree corrupted without touching either file.
 * `yarn install --immutable` remains the only answer that is certain, and it is what every caller here names
 * as the fix.
 *
 * There are TWO marks on the installed side, and taking only the first is the defect measured.
 * Yarn's own `.yarn-state.yml` moves when the installed tree CHANGES; a `--immutable` install that succeeds
 * and changes nothing writes no yarn file at all, so its mtime cannot rise to meet a lockfile a
 * fast-forward has already stamped — and the verdict stays STALE through every install it asks for.
 * `./installMark.ts` carries the reproduction and why the second mark is ours rather than yarn's.
 *
 * `never-installed` deliberately keys on {@link installStateMs} ALONE. Our own mark says an install ran; only
 * yarn's file says a tree is there.
 *
 * @param manifestMs the manifest's (`package.json`) last-modified time, or undefined when it is unreadable
 * @param lockfileMs the lockfile's last-modified time, or undefined when it is unreadable
 * @param installStateMs the installed tree's own state-file time, or undefined when nothing is installed
 * @param verifiedAtMs when a `--immutable` install last succeeded here, or undefined when none is recorded
 * @returns the verdict
 */
export function installFreshness({
  manifestMs,
  lockfileMs,
  installStateMs,
  verifiedAtMs,
}: {
  manifestMs: number | undefined;
  lockfileMs: number | undefined;
  installStateMs: number | undefined;
  verifiedAtMs: number | undefined;
}): InstallFreshness {
  if (installStateMs === undefined) {
    return "never-installed";
  }
  const sources = [manifestMs, lockfileMs].filter((value): value is number => value !== undefined);
  if (sources.length === 0) {
    return "unmeasurable";
  }
  // The latest proof the tree is current: its own state file, and a recorded `--immutable` install when one ran.
  const proofs = [installStateMs, verifiedAtMs].filter((value): value is number => value !== undefined);
  const proven = Math.max(...proofs);
  return Math.max(...sources) > proven ? "stale" : "current";
}

/** One path an upstream removed or renamed away that this checkout's own sources still name. */
export interface StrandedPath {
  /** The repo-relative path the upstream no longer has. */
  readonly path: string;
  /** The checkout's own files that still mention it, capped by the caller. */
  readonly referencedBy: readonly string[];
}

/** How a checkout stands against a SECOND upstream it is expected to be periodically rebased onto. */
export interface RebaseOntoDrift {
  /** The ref the checkout should be rebased onto (a remote-tracking ref, e.g. `origin/<trunk>`). */
  readonly ref: string;
  /** Commits {@link ref} carries that this checkout does not. */
  readonly behind: number;
  /**
   * Whether the reference scan actually RAN. It is off by default because it is genuinely expensive —
   * measured at 90 seconds on a real repository, which is unusable at session start — and an empty
   * {@link stranded} list from a scan that never happened must never read as "nothing is stranded".
   */
  readonly scanned: boolean;
  /** Paths {@link ref} removed that this checkout still has AND still references. Empty unless {@link scanned}. */
  readonly stranded: readonly StrandedPath[];
  /** How many removed paths were examined for references. */
  readonly examined: number;
  /** How many paths {@link ref} removed in total — so a cap on {@link examined} is never silent. */
  readonly removed: number;
}

/** Everything measured about one main checkout, ready to render or to branch on. */
export interface CheckoutFreshness {
  /** The checkout's absolute path. */
  readonly path: string;
  /** The branch it currently has checked out, or undefined on a detached HEAD. */
  readonly branch: string | undefined;
  /** The upstream ref it was compared against, or undefined when it has none. */
  readonly upstream: string | undefined;
  /** How it stands against {@link upstream}, or undefined when that could not be measured. */
  readonly drift: AheadBehind | undefined;
  /** When this checkout last fetched, so a comparison never claims to be fresher than its own refs. */
  readonly fetchedAtMs: number | undefined;
  /** How many uncommitted changes the working tree carries, or `undefined` when it was not checked. */
  readonly dirtyEntries: number | undefined;
  /** Whether `node_modules` can be believed to match the lockfile. */
  readonly install: InstallFreshness;
  /** The second-upstream comparison, when the checkout declared one. */
  readonly rebaseOnto: RebaseOntoDrift | undefined;
  /** Anything that could not be measured, stated rather than reported as clean. */
  readonly problems: readonly string[];
}

/**
 * Whether this checkout needs a human to do something before it is a safe base to build on.
 *
 * A checkout AHEAD of its upstream is not a fault (unpushed local commits are ordinary), and neither is a
 * dirty tree on its own — the main-checkout guard family already owns that. Behind, mis-installed, or
 * unmeasurable are the three that mean "the base you are about to build on is not what you think".
 *
 * @param freshness the measured checkout
 * @returns true when the report should be read as a finding rather than a status line
 */
export function checkoutNeedsAttention({ freshness }: { freshness: CheckoutFreshness }): boolean {
  return (
    freshness.problems.length > 0 ||
    freshness.drift === undefined ||
    freshness.drift.behind > 0 ||
    freshness.install !== "current"
  );
}

/**
 * One main checkout as a value-free JSON row: its path, how far behind its upstream it is, its install
 * verdict and whether it needs attention. `behind` is `null` when the drift could not be measured — a
 * checkout with no upstream, or one whose comparison failed — never a substituted `0`, which would read as
 * up to date.
 *
 * @param freshness the measured checkout
 * @returns the row `doctor --json` reports under `mainCheckouts`
 */
export function checkoutFreshnessJson({ freshness }: { freshness: CheckoutFreshness }): {
  readonly behind: number | null;
  readonly install: InstallFreshness;
  readonly needsAttention: boolean;
  readonly path: string;
} {
  const row = {
    install: freshness.install,
    needsAttention: checkoutNeedsAttention({ freshness }),
    path: freshness.path,
  };
  if (freshness.drift === undefined) {
    return { behind: null, ...row };
  }
  return { behind: freshness.drift.behind, ...row };
}

/** The one command that makes an install match its lockfile, named on every stale verdict. */
export const INSTALL_FIX_COMMAND = "yarn install --immutable";

/** The install verdict as one clause, with its fix named whenever there is one. */
function installClause({ install }: { install: InstallFreshness }): string {
  if (install === "current") {
    return "node_modules: matches the lockfile (by install mtime, or a recorded verified install)";
  }
  if (install === "never-installed") {
    return `node_modules: NOT INSTALLED — run \`${INSTALL_FIX_COMMAND}\``;
  }
  if (install === "stale") {
    return `node_modules: STALE — the lockfile or manifest changed after the last install; run \`${INSTALL_FIX_COMMAND}\``;
  }
  return `node_modules: UNMEASURABLE — neither the manifest nor the lockfile could be read; run \`${INSTALL_FIX_COMMAND}\` to be sure`;
}

/** The upstream-drift verdict as one clause, always naming the ref it was measured against. */
function driftClause({ freshness }: { freshness: CheckoutFreshness }): string {
  if (freshness.upstream === undefined) {
    return "upstream: NONE — this branch tracks nothing, so nothing can say whether it is current";
  }
  if (freshness.drift === undefined) {
    return `upstream ${freshness.upstream}: UNMEASURABLE — the comparison did not produce a count`;
  }
  const { ahead, behind } = freshness.drift;
  const aheadNote = ahead === 0 ? "" : `, ${String(ahead)} ahead`;
  return behind === 0
    ? `upstream ${freshness.upstream}: current${aheadNote}`
    : `upstream ${freshness.upstream}: ${String(behind)} BEHIND${aheadNote} — run \`slopweaver checkout sync\``;
}

/** How stale the compared refs themselves are, so a "current" verdict never overstates its own evidence. */
function fetchClause({ fetchedAtMs, nowMs }: { fetchedAtMs: number | undefined; nowMs: number }): string {
  if (fetchedAtMs === undefined) {
    return "last fetch: unknown — the comparison above may be against refs this checkout has never refreshed";
  }
  const minutes = Math.max(0, Math.round((nowMs - fetchedAtMs) / 60_000));
  return `last fetch: ${String(minutes)} min ago`;
}

/** The stranded-path lines for a second upstream, including what the examination cap did not look at. */
function rebaseOntoLines({ rebaseOnto }: { rebaseOnto: RebaseOntoDrift }): readonly string[] {
  const head =
    rebaseOnto.behind === 0
      ? `  rebase target ${rebaseOnto.ref}: current`
      : `  rebase target ${rebaseOnto.ref}: ${String(rebaseOnto.behind)} behind`;
  if (!rebaseOnto.scanned) {
    return [head, "    (removed paths not scanned for references — run `slopweaver checkout status --fetch`)"];
  }
  const uncapped =
    rebaseOnto.removed > rebaseOnto.examined
      ? [
          `    (examined ${String(rebaseOnto.examined)} of ${String(rebaseOnto.removed)} removed paths — the rest were not checked for references)`,
        ]
      : [];
  const stranded = rebaseOnto.stranded.map(
    (entry) => `    STRANDED ${entry.path} — removed upstream, still referenced by ${entry.referencedBy.join(", ")}`,
  );
  return [head, ...stranded, ...uncapped];
}

/**
 * Render one checkout's measurement as report lines, in display order.
 *
 * @param freshness the measured checkout
 * @param nowMs the current wall-clock in milliseconds, passed in so this stays pure
 * @returns the lines to print
 */
export function renderCheckoutFreshness({
  freshness,
  nowMs,
}: {
  freshness: CheckoutFreshness;
  nowMs: number;
}): readonly string[] {
  // An unchecked working tree says so. Omitting the line for BOTH "clean" and "not looked at" is exactly the
  // conflation the rest of this module refuses everywhere else.
  let dirty: readonly string[];
  if (freshness.dirtyEntries === undefined) {
    dirty = ["  working tree: not checked"];
  } else if (freshness.dirtyEntries === 0) {
    dirty = [];
  } else {
    dirty = [`  working tree: ${String(freshness.dirtyEntries)} uncommitted change(s)`];
  }
  return [
    `${freshness.path} [${absentAs({ value: freshness.branch, whenAbsent: "detached HEAD" })}]`,
    `  ${driftClause({ freshness })}`,
    `  ${fetchClause({ fetchedAtMs: freshness.fetchedAtMs, nowMs })}`,
    `  ${installClause({ install: freshness.install })}`,
    ...dirty,
    ...(freshness.rebaseOnto === undefined ? [] : rebaseOntoLines({ rebaseOnto: freshness.rebaseOnto })),
    ...freshness.problems.map((problem) => `  UNMEASURED: ${problem}`),
  ];
}
