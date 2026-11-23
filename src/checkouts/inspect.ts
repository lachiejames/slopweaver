/**
 * Measuring one main checkout — the effectful half of `./freshness.ts`.
 *
 * Everything git- or filesystem-shaped happens here and is handed to the pure rules as plain values, so the
 * verdicts stay testable against fixtures. Every git call goes through `gitEnv()` for the reason
 * `../lib/gitRepo.ts` documents at length: an ambient `GIT_DIR` redirects `-C`, and a check that silently
 * reads the wrong repository reports clean about a tree it never opened.
 *
 * A git call that FAILS never becomes a zero here. It becomes a recorded problem, and
 * `checkoutNeedsAttention` treats an unmeasurable checkout as needing attention — the opposite of the
 * swallow-and-report-green shape this repository keeps paying for.
 */
import { execFileSync } from "node:child_process";
import { statSync } from "node:fs";
import { join } from "node:path";

import { gitEnv } from "../lib/gitRepo.js";
import {
  type AheadBehind,
  type CheckoutFreshness,
  installFreshness,
  parseAheadBehind,
  parseNameOnly,
  type RebaseOntoDrift,
  type StrandedPath,
} from "./freshness.js";
import { installVerifiedPath } from "./installMark.js";

/** How long any one git read may block. A hung fetch must not hang a doctor sweep. */
const GIT_TIMEOUT_MS = 60_000;

/** How many upstream-removed paths are examined for local references before the examination is capped. */
const MAX_STRANDED_PATHS_EXAMINED = 40;

/** How many referencing files are listed per stranded path. */
const MAX_REFERENCES_LISTED = 5;

/** The read seams a measurement needs, injected so a test never shells out. */
export interface CheckoutInspectDeps {
  /**
   * Run one git command (a read, or `checkout sync`'s fast-forward), returning its trimmed stdout, or
   * `undefined` when it failed — for ANY reason, so a caller learns why only by measuring again.
   */
  readonly git: (args: { args: readonly string[]; cwd: string }) => string | undefined;
  /** One path's last-modified time in milliseconds, or `undefined` when it cannot be stat'ed. */
  readonly mtimeMs: (args: { path: string }) => number | undefined;
}

/**
 * The real seams: an actual git subprocess and an actual stat.
 *
 * @returns the production {@link CheckoutInspectDeps}
 */
export function productionInspectDeps(): CheckoutInspectDeps {
  return {
    git: ({ args, cwd }) => {
      try {
        return execFileSync("git", [...args], {
          cwd,
          encoding: "utf8",
          env: gitEnv(),
          maxBuffer: 32 * 1024 * 1024,
          // stderr is PIPED rather than left on Node's default, which inherits it. A failure here becomes
          // `undefined` and nothing else — no caller is ever handed git's text — so inheriting only ever put
          // it on the operator's terminal, unattributed. Measured: `refMoveInstallCli.ts
          // post-merge 0` in a repo with no ORIG_HEAD printed three `fatal: ambiguous argument 'ORIG_HEAD'`
          // lines ahead of the hook's one honest line, for a skip this code handles correctly.
          stdio: ["ignore", "pipe", "pipe"],
          timeout: GIT_TIMEOUT_MS,
        }).trim();
      } catch {
        return undefined;
      }
    },
    mtimeMs: ({ path }) => {
      try {
        return statSync(path).mtimeMs;
      } catch {
        return undefined;
      }
    },
  };
}

/** One configured main checkout: where it is, and what it is expected to stay current with. */
export interface MainCheckoutConfig {
  /** The checkout's absolute path. */
  readonly path: string;
  /** The ref to measure "behind" against; defaults to the branch's own configured upstream. */
  readonly upstream?: string | undefined;
  /** A SECOND ref this branch is expected to be periodically rebased onto, when it is a long-lived fork. */
  readonly rebaseOnto?: string | undefined;
}

/**
 * How much a measurement is allowed to cost.
 *
 * One knob rather than three booleans, because each caller has ONE intent and the three expensive reads are
 * not independently interesting — they are rungs. Measured on this machine, which is why this exists at all:
 * `thorough` on a real repository 92 commits behind its trunk took **90 seconds**, and `current`'s working-
 * tree read alone adds about a second per repository. `doctor` runs at every session start, so it takes the
 * bottom rung; anything the cheap rung did not look at is REPORTED as unchecked, never as clean.
 *
 * - `cheap` — local ref reads and three stats. No network, no working-tree scan, no reference scan.
 * - `current` — also fetches the remotes the comparisons need, and reads the working tree. What an operation
 *   that is about to CHANGE the checkout needs before it acts.
 * - `thorough` — also scans a rebase target's removed paths for local references. The 90-second rung.
 */
export type InspectDepth = "cheap" | "current" | "thorough";

/** The remote a remote-tracking ref belongs to (`origin/main` → `origin`), for a targeted fetch. */
function remoteOf({ ref }: { ref: string }): string | undefined {
  const slash = ref.indexOf("/");
  return slash <= 0 ? undefined : ref.slice(0, slash);
}

/** Fetch the remotes the requested comparisons need, recording (never throwing on) a failure. */
function fetchForComparison({
  config,
  upstream,
  deps,
  problems,
}: {
  config: MainCheckoutConfig;
  upstream: string | undefined;
  deps: CheckoutInspectDeps;
  problems: string[];
}): void {
  const remotes = new Set(
    [upstream, config.rebaseOnto]
      .map((ref) => (ref === undefined ? undefined : remoteOf({ ref })))
      .filter((remote): remote is string => remote !== undefined),
  );
  for (const remote of remotes) {
    if (deps.git({ args: ["fetch", "--quiet", remote], cwd: config.path }) === undefined) {
      problems.push(`could not fetch ${remote} — the comparisons below are against refs already on disk`);
    }
  }
}

/**
 * How the checkout stands against one ref — the `<behind>\t<ahead>` of `rev-list --left-right --count`.
 *
 * @param ref the ref to count against, such as the branch's upstream
 * @param cwd the checkout whose HEAD is counted
 * @returns the reading, or undefined when the count could not be taken or parsed
 */
export function driftAgainst({
  ref,
  cwd,
  deps,
}: {
  ref: string;
  cwd: string;
  deps: CheckoutInspectDeps;
}): AheadBehind | undefined {
  const text = deps.git({ args: ["rev-list", "--left-right", "--count", `${ref}...HEAD`], cwd });
  return text === undefined ? undefined : parseAheadBehind({ text });
}

/** The checkout's own files that still mention a path its upstream removed, capped. */
function referencesTo({
  path,
  cwd,
  deps,
}: {
  path: string;
  cwd: string;
  deps: CheckoutInspectDeps;
}): readonly string[] {
  const text = deps.git({ args: ["grep", "--files-with-matches", "--fixed-strings", "--", path], cwd });
  return text === undefined
    ? []
    : parseNameOnly({ text })
        .filter((file) => file !== path)
        .slice(0, MAX_REFERENCES_LISTED);
}

/** The paths a second upstream removed that this checkout still has and still references. */
function strandedPaths({ ref, cwd, deps }: { ref: string; cwd: string; deps: CheckoutInspectDeps }): {
  readonly stranded: readonly StrandedPath[];
  readonly examined: number;
  readonly removed: number;
} {
  const mergeBase = deps.git({ args: ["merge-base", ref, "HEAD"], cwd });
  if (mergeBase === undefined) {
    return { examined: 0, removed: 0, stranded: [] };
  }
  const text = deps.git({
    args: ["diff", "--diff-filter=D", "--name-only", "--no-renames", mergeBase, ref],
    cwd,
  });
  if (text === undefined) {
    return { examined: 0, removed: 0, stranded: [] };
  }
  const removed = parseNameOnly({ text });
  const stillHere = removed.filter((path) => deps.git({ args: ["cat-file", "-e", `HEAD:${path}`], cwd }) !== undefined);
  const examined = stillHere.slice(0, MAX_STRANDED_PATHS_EXAMINED);
  const stranded = examined
    .map((path) => ({ path, referencedBy: referencesTo({ cwd, deps, path }) }))
    .filter((entry) => entry.referencedBy.length > 0);
  return { examined: examined.length, removed: removed.length, stranded };
}

/** The second-upstream comparison, when one is configured. */
function measureRebaseOnto({
  config,
  deps,
  problems,
  depth,
}: {
  config: MainCheckoutConfig;
  deps: CheckoutInspectDeps;
  problems: string[];
  depth: InspectDepth;
}): RebaseOntoDrift | undefined {
  const ref = config.rebaseOnto;
  if (ref === undefined) {
    return undefined;
  }
  const drift = driftAgainst({ cwd: config.path, deps, ref });
  if (drift === undefined) {
    problems.push(`could not compare against the rebase target ${ref}`);
    return undefined;
  }
  if (depth !== "thorough") {
    return { behind: drift.behind, examined: 0, ref, removed: 0, scanned: false, stranded: [] };
  }
  const { stranded, examined, removed } = strandedPaths({ cwd: config.path, deps, ref });
  return { behind: drift.behind, examined, ref, removed, scanned: true, stranded };
}

/**
 * The install verdict for this checkout, from the four mtimes it depends on.
 *
 * Exported so a test can put a REAL fixture tree in front of the real stat seam — the false-STALE defect
 * lives in which files are read, which a test against literal numbers cannot see.
 *
 * @param path the checkout to measure
 * @param deps the read seams
 * @returns the verdict
 */
export function measureInstall({
  path,
  deps,
}: {
  path: string;
  deps: CheckoutInspectDeps;
}): CheckoutFreshness["install"] {
  return installFreshness({
    installStateMs: deps.mtimeMs({ path: join(path, "node_modules", ".yarn-state.yml") }),
    lockfileMs: deps.mtimeMs({ path: join(path, "yarn.lock") }),
    manifestMs: deps.mtimeMs({ path: join(path, "package.json") }),
    verifiedAtMs: deps.mtimeMs({ path: installVerifiedPath({ root: path }) }),
  });
}

/** When this checkout last fetched, read from the git directory's own `FETCH_HEAD` stamp. */
function measureFetchedAt({ path, deps }: { path: string; deps: CheckoutInspectDeps }): number | undefined {
  const gitDir = deps.git({ args: ["rev-parse", "--absolute-git-dir"], cwd: path });
  return gitDir === undefined ? undefined : deps.mtimeMs({ path: join(gitDir, "FETCH_HEAD") });
}

/** The upstream to compare against: the configured override, else the branch's own tracking ref. */
function resolveUpstream({
  config,
  deps,
}: {
  config: MainCheckoutConfig;
  deps: CheckoutInspectDeps;
}): string | undefined {
  const present = config.upstream;
  if (present === undefined) {
    return deps.git({ args: ["rev-parse", "--abbrev-ref", "@{upstream}"], cwd: config.path });
  }
  return present;
}

/**
 * Measure one main checkout end to end.
 *
 * @param config the checkout to measure and what it should stay current with
 * @param deps the read seams
 * @param depth how much this measurement may cost — see {@link InspectDepth}; whatever a lower rung did not
 *   look at is reported as unchecked rather than as clean
 * @returns the measurement, with every failed read recorded as a problem rather than dropped
 */
export function inspectCheckout({
  config,
  deps,
  depth,
}: {
  config: MainCheckoutConfig;
  deps: CheckoutInspectDeps;
  depth: InspectDepth;
}): CheckoutFreshness {
  const problems: string[] = [];
  const branch = deps.git({ args: ["branch", "--show-current"], cwd: config.path });
  if (branch === undefined) {
    problems.push(`${config.path} is not a readable git checkout`);
    return {
      branch: undefined,
      dirtyEntries: undefined,
      drift: undefined,
      fetchedAtMs: undefined,
      install: measureInstall({ deps, path: config.path }),
      path: config.path,
      problems,
      rebaseOnto: undefined,
      upstream: undefined,
    };
  }
  const upstream = resolveUpstream({ config, deps });
  if (depth !== "cheap") {
    fetchForComparison({ config, deps, problems, upstream });
  }
  // Skipped on the cheap rung: about a second per repository, and it changes no verdict
  // (`checkoutNeedsAttention` deliberately does not flag a dirty tree — the guard family owns that).
  const status = depth === "cheap" ? undefined : deps.git({ args: ["status", "--porcelain"], cwd: config.path });
  return {
    branch: branch.length === 0 ? undefined : branch,
    dirtyEntries: status === undefined ? undefined : parseNameOnly({ text: status }).length,
    drift: upstream === undefined ? undefined : driftAgainst({ cwd: config.path, deps, ref: upstream }),
    fetchedAtMs: measureFetchedAt({ deps, path: config.path }),
    install: measureInstall({ deps, path: config.path }),
    path: config.path,
    problems,
    rebaseOnto: measureRebaseOnto({ config, deps, depth, problems }),
    upstream,
  };
}

/**
 * The repo-relative paths that differ between two refs in one checkout.
 *
 * @param cwd the checkout to run the diff in
 * @param from the ref to diff from
 * @param to the ref to diff to
 * @param deps the read seams
 * @returns the changed paths, or `undefined` when the diff could not be taken
 */
export function changedPathsBetween({
  cwd,
  from,
  to,
  deps,
}: {
  cwd: string;
  from: string;
  to: string;
  deps: CheckoutInspectDeps;
}): readonly string[] | undefined {
  const text = deps.git({ args: ["diff", "--name-only", from, to], cwd });
  return text === undefined ? undefined : parseNameOnly({ text });
}
