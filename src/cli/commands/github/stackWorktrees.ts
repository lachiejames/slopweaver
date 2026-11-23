/**
 * Pure parsing of `git worktree list --porcelain -z`, and matching stack branches to the worktree each
 * checks out — `github stack sync` is repo-wide, so it has to discover every worktree a stack branch might
 * live in rather than assuming the current one, the way `stack push`'s single-branch model can.
 */

import { err, ok } from "../../../lib/result.js";
import { GithubVerbErrors, type GithubVerbResult } from "./errors.js";

/** One worktree, as `git worktree list --porcelain -z` reports it. */
export interface GithubStackWorktree {
  readonly path: string;
  readonly headSha: string;
  /** `undefined` when the worktree is in a detached-HEAD state. */
  readonly branch: string | undefined;
  readonly bare: boolean;
  readonly detached: boolean;
  readonly locked: boolean;
  readonly prunable: boolean;
}

/** One worktree record's fields, before being folded into a {@link GithubStackWorktree}. */
function worktreeFromFields({ fields }: { fields: readonly string[] }): GithubStackWorktree {
  let path = "";
  let headSha = "";
  let branch: string | undefined;
  let bare = false;
  let detached = false;
  let locked = false;
  let prunable = false;
  for (const field of fields) {
    if (field.startsWith("worktree ")) {
      path = field.slice("worktree ".length);
    } else if (field.startsWith("HEAD ")) {
      headSha = field.slice("HEAD ".length);
    } else if (field.startsWith("branch ")) {
      branch = field.slice("branch ".length).replace(/^refs\/heads\//, "");
    } else if (field === "bare") {
      bare = true;
    } else if (field === "detached") {
      detached = true;
    } else if (field === "locked" || field.startsWith("locked ")) {
      locked = true;
    } else if (field === "prunable" || field.startsWith("prunable ")) {
      prunable = true;
    }
  }
  return { bare, branch, detached, headSha, locked, path, prunable };
}

/**
 * Parse `git worktree list --porcelain -z`'s exact output.
 *
 * Records are NUL-separated fields, with an extra NUL between records (so a record's field list ends at the
 * first empty field). A trailing empty record from the final separator is dropped rather than reported.
 *
 * @param text the raw NUL-delimited stdout
 * @returns every worktree the repository currently has
 */
export function parseGithubWorktreeList({ text }: { text: string }): readonly GithubStackWorktree[] {
  return text
    .split("\0\0")
    .map((record) => record.split("\0").filter((field) => field.length > 0))
    .filter((fields) => fields.length > 0)
    .map((fields) => worktreeFromFields({ fields }));
}

/**
 * Resolve exactly one worktree per named branch — best-effort, never all-or-nothing. A stack with one
 * unresolvable branch must not block every OTHER stack sync would otherwise happily walk; the caller (the
 * pure sync planner) decides what an unresolved branch means for the entries above it in its OWN stack.
 *
 * Refuses a branch with no worktree, checked out in more than one, or whose one worktree is
 * bare/detached/locked — none of those are states this executor can safely rebase in.
 *
 * @param branches the stack branches sync needs a worktree for
 * @param worktrees every worktree the repository currently has
 * @returns one resolution per requested branch, in the same order
 */
export function worktreesForStackBranches({
  branches,
  worktrees,
}: {
  branches: readonly string[];
  worktrees: readonly GithubStackWorktree[];
}): ReadonlyMap<string, GithubVerbResult<GithubStackWorktree>> {
  const resolved = new Map<string, GithubVerbResult<GithubStackWorktree>>();
  for (const branch of new Set(branches)) {
    const matches = worktrees.filter((worktree) => worktree.branch === branch);
    if (matches.length === 0) {
      resolved.set(branch, err(GithubVerbErrors.noWorktree({ branch })));
      continue;
    }
    if (matches.length > 1) {
      resolved.set(branch, err(GithubVerbErrors.worktreeAmbiguous({ branch, paths: matches.map((m) => m.path) })));
      continue;
    }
    const worktree = matches[0]!;
    if (worktree.bare || worktree.detached) {
      resolved.set(branch, err(GithubVerbErrors.worktreeBareOrDetached({ branch, path: worktree.path })));
      continue;
    }
    if (worktree.locked) {
      resolved.set(branch, err(GithubVerbErrors.worktreeLocked({ branch, path: worktree.path })));
      continue;
    }
    resolved.set(branch, ok(worktree));
  }
  return resolved;
}
