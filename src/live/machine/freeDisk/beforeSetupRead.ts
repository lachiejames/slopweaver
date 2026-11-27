/**
 * The read behind `before-setup-copy`: the copy beside a DECLARED main checkout, and the git checks over it.
 * Three things make it safe to remove, and each fails closed:
 *
 * - the main checkout the copy is derived from is one `profile.json` declares, so a run standing in any other
 *   repository derives nothing it may act on;
 * - no `.git` entry of any type — directory, link file or symlink — sits anywhere inside the copy, found by
 *   walking all of it;
 * - `git rev-parse --show-toplevel` inside the copy answers git's own "not a git repository"; any other failure
 *   is a failed read, never a clean answer.
 */
import { execFileSync } from "node:child_process";
import { type Dirent, readdirSync, realpathSync } from "node:fs";
import { join } from "node:path";

import { gitEnv } from "#lib/gitRepo.js";
import { err, ok, type Result } from "#lib/result.js";

import { mainCheckoutRoot } from "../../../worktree/shell.js";
import { type FreeDiskError, FreeDiskErrors } from "./errors.js";
import { observePath } from "./observePath.js";
import { beforeSetupCopyPath } from "./registry.js";
import type { BeforeSetupCopyObservation } from "./types.js";

/** A local read's bound. */
const READ_TIMEOUT_MS = 60_000;

/** The line git prints when a directory is in no repository, the one failure that is an answer. */
const NOT_A_REPOSITORY = "not a git repository";

/** The name every git entry carries: a repository's directory, or a worktree's or submodule's link file. */
const GIT_ENTRY_NAME = ".git";

/**
 * Whether a directory is in a git repository, failing closed: only git's own "not a git repository" is `false`.
 *
 * @param dir the directory git is asked about, which must exist
 * @returns `true` inside a repository, `false` on git's not-a-repository answer, or the failed read
 */
export function insideGitRepository({ dir }: { dir: string }): Result<boolean, FreeDiskError> {
  try {
    execFileSync("git", ["-C", dir, "rev-parse", "--show-toplevel"], {
      encoding: "utf8",
      env: gitEnv(),
      stdio: ["ignore", "pipe", "pipe"],
      timeout: READ_TIMEOUT_MS,
    });
    return ok(true);
  } catch (cause: unknown) {
    const answered =
      cause instanceof Error &&
      "stderr" in cause &&
      typeof cause.stderr === "string" &&
      cause.stderr.includes(NOT_A_REPOSITORY);
    if (answered) {
      return ok(false);
    }
    return err(FreeDiskErrors.readFailed({ cause, path: `git -C ${dir} rev-parse --show-toplevel` }));
  }
}

/**
 * How many `.git` entries, of ANY type, sit anywhere below a directory: a repository's directory, a worktree's or
 * submodule's link file, or a symlink named `.git`, each counted by its name and never entered or followed. Only
 * real directories are descended into. Its own walk, because the shared file walker drops a symlink before a
 * caller sees its name; a directory that cannot be listed fails the read rather than counting as clean.
 *
 * @returns the count, or the read that failed
 */
export function gitEntriesInside({ root }: { root: string }): Result<number, FreeDiskError> {
  let count = 0;
  const stack = [root];
  while (stack.length > 0) {
    const dir = stack.pop()!;
    let entries: readonly Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch (cause: unknown) {
      return err(FreeDiskErrors.readFailed({ cause, path: dir }));
    }
    for (const entry of entries) {
      if (entry.name === GIT_ENTRY_NAME) {
        count += 1;
      } else if (entry.isDirectory()) {
        stack.push(join(dir, entry.name));
      }
    }
  }
  return ok(count);
}

/** A path resolved through links, or itself when it cannot be resolved. */
function canonical({ path }: { path: string }): string {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

/**
 * `before-setup-copy`: the main checkout's `.before-setup` sibling and every git check over it.
 *
 * @param declaredMainCheckouts the canonical main checkouts `profile.json` declares
 * @returns the observation, or the read that failed
 */
export function observeBeforeSetupCopy({
  cwd,
  declaredMainCheckouts,
}: {
  cwd: string;
  declaredMainCheckouts: readonly string[];
}): Result<BeforeSetupCopyObservation, FreeDiskError> {
  const resolved = mainCheckoutRoot({ cwd });
  if (resolved === undefined) {
    return ok({ checkout: "unproven", kind: "before-setup-copy" });
  }
  const mainCheckout = canonical({ path: resolved });
  if (!declaredMainCheckouts.includes(mainCheckout)) {
    return ok({ checkout: "undeclared", kind: "before-setup-copy", mainCheckout });
  }
  const copy = observePath({ path: beforeSetupCopyPath({ mainCheckout }), walk: true });
  if (copy.isErr()) {
    return err(copy.error);
  }
  if (copy.value.state === "absent" || copy.value.kind !== "directory") {
    return ok({
      checkout: "declared",
      copy: copy.value,
      gitEntries: 0,
      insideGitRepository: false,
      kind: "before-setup-copy",
      mainCheckout,
    });
  }
  const gitEntries = gitEntriesInside({ root: copy.value.path });
  if (gitEntries.isErr()) {
    return err(gitEntries.error);
  }
  const inside = insideGitRepository({ dir: copy.value.path });
  if (inside.isErr()) {
    return err(inside.error);
  }
  return ok({
    checkout: "declared",
    copy: copy.value,
    gitEntries: gitEntries.value,
    insideGitRepository: inside.value,
    kind: "before-setup-copy",
    mainCheckout,
  });
}
