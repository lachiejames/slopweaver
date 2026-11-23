/**
 * The worktree-provisioning domain's typed errors.
 *
 * Each variant is a DIFFERENT thing for a caller to do, which is why this is a union rather than a message:
 * a lockfile mismatch under `--deps shared` is fixed by installing the worktree's own tree, a failed
 * `yarn install` is fixed by reading yarn's own output, and a git refusal is fixed by clearing what the
 * previous attempt left behind. A caller that could only read one sentence would have to grep it to tell
 * those apart, which is exactly the shape `error-handling.md` bans.
 */

/** The repository, slug or flag combination a caller asked for cannot describe a worktree. */
export interface WorktreeRequestInvalidError {
  readonly code: "REQUEST_INVALID";
  readonly message: string;
  /** What was wrong with the request, one entry per problem, so a caller can print them all. */
  readonly problems: readonly string[];
}

/** No worktree of this repository answers to the slug, branch or path the caller named. */
export interface WorktreeNotFoundError {
  readonly code: "WORKTREE_NOT_FOUND";
  readonly message: string;
  readonly slug: string;
}

/** Git refused to create, list or remove the worktree. */
export interface WorktreeGitFailedError {
  readonly code: "GIT_FAILED";
  readonly message: string;
  readonly cause?: unknown;
}

/**
 * `--deps shared` was asked for, but the shared tree was installed from a DIFFERENT lockfile than this
 * worktree's — the measured defect this whole verb exists for, refused instead of silently linked.
 */
export interface WorktreeSharedDepsMismatchError {
  readonly code: "SHARED_DEPS_MISMATCH";
  readonly message: string;
  /** The shared `node_modules` that would have been linked, so the message names a path a reader can inspect. */
  readonly sharedRoot: string;
}

/** The dependency install (or the build that followed it) exited non-zero. */
export interface WorktreeInstallFailedError {
  readonly code: "INSTALL_FAILED";
  readonly message: string;
  /** Which step died — `install` or `build` — so a caller need not parse the message to know. */
  readonly step: "install" | "build";
  /** The last lines the failing command wrote, already trimmed of noise. */
  readonly detail: string;
}

/**
 * `<repo>/.claude/worktrees` and `<repo>/.claude/worktrees.noindex` are in a state no rename can reconcile
 * without hiding or merging something — two real directories, an alias pointing elsewhere, a plain file.
 */
export interface WorktreesDirConflictError {
  readonly code: "WORKTREES_DIR_CONFLICT";
  readonly message: string;
  /** Which of the refused layouts was found, so a caller need not parse the message to know. */
  readonly detail: string;
}

/**
 * An install over a recycled `node_modules` failed AND that tree could not be thrown away, so the clean retry
 * from an empty tree that recycling promises was never run. Fixed by moving `node_modules` aside by hand and
 * installing again — not by reading yarn's output, which a plain {@link WorktreeInstallFailedError} asks for.
 */
export interface WorktreeRecycleFailedError {
  readonly code: "RECYCLE_FAILED";
  readonly message: string;
  /** The pool entry the claimed tree came from. */
  readonly from: string;
}

/**
 * Another process holds the worktree's deps lock (`./depsLock.ts`), or the lock cannot be resolved, so a removal
 * that would delete its `node_modules` was not run. Fixed by waiting for the holder, not by `--force`.
 */
export interface WorktreeDepsLockedError {
  readonly code: "DEPS_LOCKED";
  readonly message: string;
  /** The worktree that was left in place. */
  readonly path: string;
}

/**
 * The machine's delete lease (`./deleteLease.ts`) was held by another delete past the wait, or could not be taken at
 * all, so git's in-place delete was not started beside another. Fixed by running it again once the other is done.
 */
export interface WorktreeDeleteLeaseError {
  readonly code: "DELETE_LEASE_UNHELD";
  readonly message: string;
  /** The worktree that was left in place. */
  readonly path: string;
}

/** Every way provisioning, inspecting or removing a worktree can fail. */
export type WorktreeError =
  | WorktreeRequestInvalidError
  | WorktreeNotFoundError
  | WorktreeGitFailedError
  | WorktreeSharedDepsMismatchError
  | WorktreeInstallFailedError
  | WorktreeRecycleFailedError
  | WorktreeDepsLockedError
  | WorktreeDeleteLeaseError
  | WorktreesDirConflictError;

/** The factory every producer of a {@link WorktreeError} constructs through — tests included. */
export const WorktreeErrors = {
  depsLocked: ({ path, detail }: { path: string; detail: string }): WorktreeDepsLockedError => ({
    code: "DEPS_LOCKED",
    message: `${path} was not removed, because its node_modules is not free to delete: ${detail}`,
    path,
  }),
  deleteLeaseUnheld: ({ path, detail }: { path: string; detail: string }): WorktreeDeleteLeaseError => ({
    code: "DELETE_LEASE_UNHELD",
    message: `${path} was not removed, because the machine's delete lease was not free: ${detail}`,
    path,
  }),
  gitFailed: ({ detail, cause }: { detail: string; cause?: unknown }): WorktreeGitFailedError => ({
    ...(cause === undefined ? {} : { cause }),
    code: "GIT_FAILED",
    message: `git refused: ${detail}`,
  }),
  installFailed: ({ step, detail }: { step: "install" | "build"; detail: string }): WorktreeInstallFailedError => ({
    code: "INSTALL_FAILED",
    detail,
    message: `\`yarn ${step === "install" ? "install" : "build"}\` failed: ${detail}`,
    step,
  }),
  notFound: ({ slug }: { slug: string }): WorktreeNotFoundError => ({
    code: "WORKTREE_NOT_FOUND",
    message: `no worktree named ${slug} is registered in this repository`,
    slug,
  }),
  recycleFailed: ({
    from,
    installFailure,
    discardFailure,
  }: {
    from: string;
    installFailure: string;
    discardFailure: string;
  }): WorktreeRecycleFailedError => ({
    code: "RECYCLE_FAILED",
    from,
    message:
      `\`yarn install\` failed over the recycled tree from ${from}, and that tree could not be moved aside for ` +
      `a clean install (${discardFailure}) — move node_modules aside and install again. The install said: ${installFailure}`,
  }),
  requestInvalid: ({ problems }: { problems: readonly string[] }): WorktreeRequestInvalidError => ({
    code: "REQUEST_INVALID",
    message: problems.join("; "),
    problems,
  }),
  sharedDepsMismatch: ({
    sharedRoot,
    detail,
  }: {
    sharedRoot: string;
    detail: string;
  }): WorktreeSharedDepsMismatchError => ({
    code: "SHARED_DEPS_MISMATCH",
    message:
      `--deps shared refused: ${detail}. The shared tree at ${sharedRoot} was installed from a different ` +
      "lockfile, so a dependency only this branch declares would be silently absent — install this " +
      "worktree's own tree instead (`--deps own`, the default)",
    sharedRoot,
  }),
  worktreesDirConflict: ({ detail }: { detail: string }): WorktreesDirConflictError => ({
    code: "WORKTREES_DIR_CONFLICT",
    detail,
    message: `the worktrees directory cannot be made Spotlight-safe: ${detail}`,
  }),
} as const;
