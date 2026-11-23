/**
 * Which paths a pull request conflicts with its base on, measured by `git merge-tree` in a local checkout.
 *
 * GitHub's GraphQL `mergeable` field says CONFLICTING and nothing more — the REST and GraphQL surfaces
 * carry no list of conflicting files at all — so the only way to name the paths is to perform the merge
 * locally. `git merge-tree --write-tree` does the real three-way merge without touching the working tree,
 * the index or any ref, which is what makes it safe to run inside one of the owner's DECLARED main checkouts:
 * the merge-guard hooks protect those from edits, and this reads them without making one. The same
 * invocation is what `../outbound/github/probeSweep.ts` uses to compute a post-merge tree; here its
 * `--name-only` output is read instead of its tree.
 *
 * ## What it fetches, and why that is not a second door
 *
 * The base branch and the pull request's head both have to be present locally, so the measurement runs one
 * `git fetch` of `<base>` and `refs/pull/<n>/head` against `origin` first. That is git talking to the remote
 * a checkout already declares, inside a `slopweaver` verb — the door rule 3 names — and it moves only the
 * remote-tracking ref, never a branch or the working tree. It is run only for a pull request GitHub already
 * reports as CONFLICTING, so the cost is bounded by the conflicting few rather than the whole fleet.
 *
 * ## Three outcomes, kept apart because a consumer says a different sentence for each
 *
 * A measurement that found paths names them. One that came out CLEAN is not "no conflict": GitHub's read
 * may be stale, or the base may have moved since — so the row says the local merge was clean rather than
 * dropping the conflict. One that could not run at all (no declared checkout holds the repository, or the
 * fetch failed) says why, so an empty list never reads as "conflicting nowhere".
 */

import { execFileSync } from "node:child_process";

import { resolveRepository } from "../config.js";
import { gitEnv } from "../lib/gitRepo.js";
import { isRecord } from "../lib/parsers.js";
import { mainCheckoutsFromProfile } from "../profileStore.js";

/** What one measurement produced. */
export type ConflictPathsRead =
  | { readonly kind: "paths"; readonly paths: readonly string[] }
  | { readonly kind: "clean" }
  | { readonly kind: "unmeasured"; readonly why: string };

/**
 * The conflicting paths out of `git merge-tree --write-tree --name-only --no-messages` output.
 *
 * On a conflict, git prints the merged tree's oid on the first line and then one conflicted path per line;
 * with `--no-messages` there is no informational section after them. The first line is dropped and blank
 * lines are ignored, so a clean output (the oid alone) yields no paths.
 *
 * @param stdout what git printed
 * @returns the conflicted paths in git's own order, de-duplicated
 */
export function parseMergeTreeNameOnly({ stdout }: { stdout: string }): readonly string[] {
  const [, ...rest] = stdout.split("\n");
  return [...new Set(rest.map((line) => line.trim()).filter((line) => line.length > 0))];
}

/**
 * The declared main checkout whose `origin` is `slug`, or the current directory when its own remote is.
 *
 * @param home the state home holding `profile.json`
 * @param slug the `owner/repo` to find a checkout of
 * @param cwd the directory this process runs in, tried last
 * @returns the checkout's path, or undefined when no local checkout holds the repository
 */
function checkoutForSlug({ home, slug, cwd }: { home: string; slug: string; cwd: string }): string | undefined {
  const candidates = [...mainCheckoutsFromProfile({ home }).map((checkout) => checkout.path), cwd];
  for (const path of candidates) {
    const resolved = resolveRepository({ cwd: path });
    if (resolved.isOk() && `${resolved.value.owner}/${resolved.value.repo}` === slug) {
      return path;
    }
  }
  return undefined;
}

/**
 * How long the `origin` fetch may run. It moves two refs of a repository the checkout already holds, so it is
 * normally seconds; ten minutes is room for a slow link and a large pull request, and ends a fetch sat on a
 * credential prompt the verb cannot show.
 */
const FETCH_TIMEOUT_MS = 10 * 60_000;

/**
 * How long the in-memory `merge-tree` may run: a local read of two trees, so two minutes, matching the bound
 * the tree's other local git reads carry, bounds a wedged repository rather than real work.
 */
const MERGE_TREE_TIMEOUT_MS = 2 * 60_000;

/** Run one git command in `checkout`, bounded at `timeoutMs`, returning its stdout, or the failure as an error. */
function git({ checkout, args, timeoutMs }: { checkout: string; args: readonly string[]; timeoutMs: number }): string {
  return execFileSync("git", ["-C", checkout, ...args], {
    encoding: "utf8",
    env: gitEnv(),
    stdio: ["ignore", "pipe", "pipe"],
    // SIGKILL, not the default SIGTERM: a child that traps TERM would outlive the bound.
    killSignal: "SIGKILL",
    timeout: timeoutMs,
  });
}

/** Whether a thrown child failure is Node's report of a child killed at its `timeout`. */
function timedOut({ error }: { error: unknown }): boolean {
  return isRecord(error) && error["code"] === "ETIMEDOUT";
}

/**
 * Measure which paths `headOid` conflicts with `baseRefName` on, in the local checkout of `repoSlug`.
 *
 * @param home the state home holding `profile.json`
 * @param repoSlug the pull request's `owner/repo`
 * @param number the pull request's number, for the `refs/pull/<n>/head` fetch
 * @param baseRefName the branch the pull request merges into
 * @param headOid the pull request's head commit
 * @param cwd the directory this process runs in, tried after the declared checkouts
 * @returns the paths, a clean local merge, or why nothing could be measured
 */
export function measureConflictingPaths({
  home,
  repoSlug,
  number,
  baseRefName,
  headOid,
  cwd = process.cwd(),
}: {
  home: string;
  repoSlug: string;
  number: number;
  baseRefName: string;
  headOid: string;
  cwd?: string;
}): ConflictPathsRead {
  const checkout = checkoutForSlug({ cwd, home, slug: repoSlug });
  if (checkout === undefined) {
    return {
      kind: "unmeasured",
      why: `no declared checkout holds ${repoSlug}, so the conflicting paths were not measured`,
    };
  }
  return measureConflictingPathsIn({ baseRefName, checkout, headOid, number });
}

/**
 * The measurement itself, in a checkout already known to hold the repository: fetch the base and the pull
 * request head from `origin`, then merge them in memory and read which paths did not merge.
 *
 * @param checkout the local checkout to measure in
 * @param number the pull request's number, for the `refs/pull/<n>/head` fetch
 * @param baseRefName the branch the pull request merges into
 * @param headOid the pull request's head commit
 * @returns the paths, a clean local merge, or why nothing could be measured
 */
export function measureConflictingPathsIn({
  checkout,
  number,
  baseRefName,
  headOid,
}: {
  checkout: string;
  number: number;
  baseRefName: string;
  headOid: string;
}): ConflictPathsRead {
  const fetch = ["fetch", "--quiet", "--no-tags", "origin", baseRefName, `refs/pull/${String(number)}/head`];
  try {
    git({ args: fetch, checkout, timeoutMs: FETCH_TIMEOUT_MS });
  } catch (error) {
    const cause = timedOut({ error })
      ? `it did not finish within ${String(FETCH_TIMEOUT_MS / 60_000)} minutes and was stopped`
      : firstLine({ error });
    return {
      kind: "unmeasured",
      why: `fetching ${baseRefName} and the pull request head into ${checkout} failed: ${cause}`,
    };
  }
  const merge = ["merge-tree", "--write-tree", "--name-only", "--no-messages", `origin/${baseRefName}`, headOid];
  try {
    git({ args: merge, checkout, timeoutMs: MERGE_TREE_TIMEOUT_MS });
    return { kind: "clean" };
  } catch (error) {
    return mergeTreeThrew({ checkout, error });
  }
}

/** What a thrown `git merge-tree` means: stopped at its bound, a failed measurement, or a merge with conflicts. */
function mergeTreeThrew({ checkout, error }: { checkout: string; error: unknown }): ConflictPathsRead {
  if (timedOut({ error })) {
    const minutes = String(MERGE_TREE_TIMEOUT_MS / 60_000);
    return { kind: "unmeasured", why: `git merge-tree in ${checkout} did not finish within ${minutes} minutes` };
  }
  // Exit 1 with a tree oid on the first line is git's own "merged with conflicts". Exit 1 WITHOUT one is
  // "not something we can merge" (a head that does not resolve), and any other status is a failed
  // measurement — reading either's empty stdout as "no paths" would report a conflict as clean.
  const merged =
    isExecError(error) && error.status === MERGE_TREE_CONFLICT_EXIT && hasTreeOid({ stdout: error.stdout });
  if (!isExecError(error) || !merged) {
    const detail = isExecError(error) ? error.stderr.trim().split("\n")[0]! : firstLine({ error });
    return { kind: "unmeasured", why: `git merge-tree in ${checkout} failed: ${detail}` };
  }
  const paths = parseMergeTreeNameOnly({ stdout: error.stdout });
  return paths.length === 0 ? { kind: "clean" } : { kind: "paths", paths };
}

/** The exit status `git merge-tree --write-tree` uses for a merge that completed with conflicts. */
const MERGE_TREE_CONFLICT_EXIT = 1;

/** Whether merge-tree output opens with the merged tree's oid, which only a merge that ran produces. */
function hasTreeOid({ stdout }: { stdout: string }): boolean {
  return /^[0-9a-f]{40,64}$/.test(stdout.split("\n")[0]!);
}

/** The first line of a thrown value's message, or the empty string when it carries none. */
function firstLine({ error }: { error: unknown }): string {
  return error instanceof Error ? error.message.split("\n")[0]! : "";
}

/** Whether a thrown value is a `child_process` failure carrying the command's stdout and exit status. */
function isExecError(
  error: unknown,
): error is Error & { readonly stdout: string; readonly stderr: string; readonly status: number } {
  return (
    error instanceof Error &&
    "stdout" in error &&
    typeof error.stdout === "string" &&
    "stderr" in error &&
    typeof error.stderr === "string" &&
    "status" in error &&
    typeof error.status === "number"
  );
}
