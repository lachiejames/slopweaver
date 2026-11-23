/**
 * Where a repository's worktrees live, and why the directory carries a `.noindex` suffix.
 *
 * ## The measurement
 *
 * Spotlight's `mds` grew to about 14 GB of resident memory every day on the owner's machine, was killed and
 * disabled by hand (`sudo killall mds mds_stores`, `sudo mdutil -a -i off`, `sudo mdutil -a -E`), came back
 * roughly twelve hours later, and pushed swap to 9.4 of 10 GB alongside a kernel panic. The
 * feeder is the worktree churn: measured, the two worktree parents held 14,363,240 and 24,812,342
 * files (`find <repo>/.claude/worktrees -type f | wc -l`), almost all of them `node_modules`, and 83 trees
 * had been deleted that night alone. Every spawn creates such a tree and every prune deletes one, and
 * Spotlight re-imports both directions.
 *
 * ## Why a directory NAME rather than a setting
 *
 * Spotlight skips any directory whose name ends in `.noindex`, at any depth, and skips a symlink's target.
 * Proved on a throwaway disk image (`hdiutil create -fs APFS`, `mdutil -i on` needs no root on a
 * user-mounted volume): a file under `wt.noindex/` never appeared in `mdfind`, and stayed absent across
 * `mdutil -i off` then `-i on`, `mdutil -E`, and a detach and reattach of the volume — the three things the
 * owner's daily commands and a reboot do. The two alternatives failed the same test: a
 * `.metadata_never_index` marker in a nested directory was still indexed (it only means anything at a
 * volume root), and the System Settings privacy list needs an admin click per path and cannot be applied
 * from a session at all. A name needs no `sudo`, no click, travels with the directory, and is true for a
 * worktree the moment `git worktree add` creates it.
 *
 * ## Why a symlink stays behind
 *
 * The harness's own worktree feature creates `<repo>/.claude/worktrees/<name>`, and every worktree
 * registered before the rename is recorded under that spelling, so `.claude/worktrees` remains as a symlink
 * to `.claude/worktrees.noindex`. Git resolves a path to its physical form when it registers a worktree
 * (measured: an absolute path given through the symlink is listed under `worktrees.noindex/`), and a
 * process standing inside one reports the physical form from `process.cwd()`, so everything that COMPARES
 * two worktree paths goes through {@link worktreePathKey}, which folds the alias. `resolve` alone does not:
 * it is lexical and never reads the filesystem.
 */
import { lstatSync, mkdirSync, readlinkSync, renameSync, symlinkSync } from "node:fs";
import { join, resolve } from "node:path";

import { absentAs } from "#lib/absent.js";
import { err, ok, type Result } from "../lib/result.js";
import { type WorktreeError, WorktreeErrors } from "./errors.js";

/**
 * The directory every worktree of a repository lives under, relative to `<repo>/.claude/`.
 *
 * @internal
 */
export const WORKTREES_DIR_NAME = "worktrees.noindex";

/**
 * The alias the harness and pre-rename registrations use, kept as a symlink to {@link WORKTREES_DIR_NAME}.
 *
 * @internal
 */
export const WORKTREES_LINK_NAME = "worktrees";

/**
 * Every `/.claude/worktrees/` segment in either spelling, wherever it sits in a path. Global, because a worktree
 * nested inside another one carries two, and folding only the first left one directory in two spellings.
 */
const WORKTREES_SEGMENTS = /\/\.claude\/worktrees(?:\.noindex)?(?=\/|$)/gu;

/**
 * A worktree's own path, one level below the worktrees directory in either spelling — the suffix a caller
 * strips to reach the main checkout from a directory that may itself be a throwaway worktree.
 */
export const WORKTREE_SUFFIX = /\/\.claude\/worktrees(?:\.noindex)?\/[^/]+\/?$/u;

/**
 * The physical worktrees directory of a repository.
 *
 * @param repoRoot the main checkout
 * @returns `<repoRoot>/.claude/worktrees.noindex`
 */
export function worktreesDir({ repoRoot }: { repoRoot: string }): string {
  return join(repoRoot, ".claude", WORKTREES_DIR_NAME);
}

/**
 * The alias path the harness creates worktrees through.
 *
 * @param repoRoot the main checkout
 * @returns `<repoRoot>/.claude/worktrees`
 */
export function worktreesLink({ repoRoot }: { repoRoot: string }): string {
  return join(repoRoot, ".claude", WORKTREES_LINK_NAME);
}

/**
 * The conventional path of one worktree, in the physical spelling git will register it under.
 *
 * @param repoRoot the main checkout
 * @param name the directory name under the worktrees directory
 * @returns `<repoRoot>/.claude/worktrees.noindex/<name>`
 */
export function worktreePath({ repoRoot, name }: { repoRoot: string; name: string }): string {
  return join(worktreesDir({ repoRoot }), name);
}

/**
 * Whether a path is inside a checkout's worktrees directory, in either spelling.
 *
 * @param path the path to test, already absolute
 * @param checkout the main checkout, already absolute
 * @returns `true` when `path` is a worktree of `checkout` or something inside one
 */
export function isUnderWorktrees({ path, checkout }: { path: string; checkout: string }): boolean {
  return (
    path.startsWith(`${checkout}/.claude/${WORKTREES_LINK_NAME}/`) ||
    path.startsWith(`${checkout}/.claude/${WORKTREES_DIR_NAME}/`)
  );
}

/**
 * The one key two references to the same worktree agree on.
 *
 * Folds the three ways this machine spells one directory: `resolve` for `..` and trailing slashes, the
 * `/private` prefix macOS adds to a temp path when it is read back through `getcwd`, and the
 * `worktrees` → `worktrees.noindex` alias this module keeps. Purely lexical, so a test drives it with
 * literal rows.
 *
 * @param path any spelling of a worktree path
 * @returns the physical spelling, without a `/private` prefix
 */
export function worktreePathKey({ path }: { path: string }): string {
  return resolve(path)
    .replace(/^\/private(?=\/)/u, "")
    .replaceAll(WORKTREES_SEGMENTS, `/.claude/${WORKTREES_DIR_NAME}`);
}

/**
 * Every live reference that holds a tree: one at its root, or at any path beneath it. A workspace opened in
 * `<tree>/apps/web` is standing in `<tree>` as surely as one at its root, and an exact-key lookup missed it.
 *
 * @param live the live-reference index, keyed by {@link worktreePathKey}
 * @param path the tree, in any spelling
 * @returns the references holding it, empty when none does
 */
export function liveReferencesTo({
  live,
  path,
}: {
  live: ReadonlyMap<string, readonly string[]>;
  path: string;
}): readonly string[] {
  const root = worktreePathKey({ path });
  const beneath = root.endsWith("/") ? root : `${root}/`;
  return [...live.entries()].filter(([key]) => key === root || key.startsWith(beneath)).flatMap(([, refs]) => refs);
}

/**
 * What one filesystem entry is, as far as the repair needs to know.
 *
 * @internal
 */
export type WorktreesEntryKind = "absent" | "directory" | "symlink" | "other";

/**
 * What stands at the two paths the repair reconciles.
 *
 * @internal
 */
export interface WorktreesDirFacts {
  /** What is at `<repo>/.claude/worktrees.noindex`. */
  readonly dir: WorktreesEntryKind;
  /** What is at `<repo>/.claude/worktrees`. */
  readonly link: WorktreesEntryKind;
  /** Where the alias points when {@link link} is a symlink, exactly as `readlink` reports it. */
  readonly linkTarget: string | undefined;
}

/** One step {@link ensureNoindexWorktreesDir} takes, in order. */
export type WorktreesDirStep = "rename-alias-to-dir" | "create-dir" | "create-alias";

/**
 * Decide how to make `<repo>/.claude/worktrees` an alias of a `.noindex` directory, from what is there now.
 *
 * Every existing worktree keeps working because a rename moves the directory's contents and the alias keeps
 * the old spelling valid. The refusals are the states a rename would silently merge or hide: two real
 * directories, an alias pointing somewhere else, or a plain file where a directory belongs.
 *
 * @param facts what stands at the two paths
 * @returns the steps to take, empty when the layout is already right — or the refusal
 */
export function planWorktreesDirRepair({
  facts,
}: {
  facts: WorktreesDirFacts;
}): Result<readonly WorktreesDirStep[], WorktreeError> {
  const aliasPointsAtDir = facts.link === "symlink" && facts.linkTarget === WORKTREES_DIR_NAME;
  if (facts.dir === "other" || facts.link === "other") {
    return err(
      WorktreeErrors.worktreesDirConflict({
        detail: "a plain file stands where the worktrees directory or its alias belongs",
      }),
    );
  }
  if (facts.dir === "symlink") {
    return err(WorktreeErrors.worktreesDirConflict({ detail: `${WORKTREES_DIR_NAME} is itself a symlink` }));
  }
  if (facts.link === "symlink" && !aliasPointsAtDir) {
    return err(
      WorktreeErrors.worktreesDirConflict({
        detail: `${WORKTREES_LINK_NAME} is a symlink to ${absentAs({ value: facts.linkTarget, whenAbsent: "nowhere" })}, not to ${WORKTREES_DIR_NAME}`,
      }),
    );
  }
  if (facts.dir === "directory" && facts.link === "directory") {
    return err(
      WorktreeErrors.worktreesDirConflict({
        detail: `both ${WORKTREES_LINK_NAME} and ${WORKTREES_DIR_NAME} are real directories — merge them by hand`,
      }),
    );
  }
  if (facts.dir === "directory") {
    return ok(aliasPointsAtDir ? [] : ["create-alias"]);
  }
  if (facts.link === "directory") {
    return ok(["rename-alias-to-dir", "create-alias"]);
  }
  return ok(aliasPointsAtDir ? ["create-dir"] : ["create-dir", "create-alias"]);
}

/** What one path is, without following it. */
function entryKind({ path }: { path: string }): WorktreesEntryKind {
  try {
    const stat = lstatSync(path);
    if (stat.isSymbolicLink()) {
      return "symlink";
    }
    return stat.isDirectory() ? "directory" : "other";
  } catch {
    return "absent";
  }
}

/**
 * Read what stands at a repository's worktrees directory and its alias.
 *
 * @param repoRoot the main checkout
 * @returns the facts {@link planWorktreesDirRepair} decides from
 */
export function readWorktreesDirFacts({ repoRoot }: { repoRoot: string }): WorktreesDirFacts {
  const link = worktreesLink({ repoRoot });
  const linkKind = entryKind({ path: link });
  return {
    dir: entryKind({ path: worktreesDir({ repoRoot }) }),
    link: linkKind,
    linkTarget: linkKind === "symlink" ? readlinkSync(link) : undefined,
  };
}

/**
 * Make a repository's worktrees directory one Spotlight never indexes, and keep the alias the harness uses.
 *
 * Idempotent: a repository already in the right layout takes no step. Called before every `git worktree
 * add` this repository performs, so a spawn keeps the property true for every new worktree rather than
 * relying on a one-time migration having happened.
 *
 * @param repoRoot the main checkout
 * @returns the steps taken, in order — or the refusal, with nothing touched
 */
export function ensureNoindexWorktreesDir({
  repoRoot,
}: {
  repoRoot: string;
}): Result<readonly WorktreesDirStep[], WorktreeError> {
  const planned = planWorktreesDirRepair({ facts: readWorktreesDirFacts({ repoRoot }) });
  if (planned.isErr()) {
    return err(planned.error);
  }
  const dir = worktreesDir({ repoRoot });
  const link = worktreesLink({ repoRoot });
  for (const step of planned.value) {
    if (step === "rename-alias-to-dir") {
      renameSync(link, dir);
    } else if (step === "create-dir") {
      mkdirSync(dir, { recursive: true });
    } else {
      symlinkSync(WORKTREES_DIR_NAME, link);
    }
  }
  return ok(planned.value);
}
