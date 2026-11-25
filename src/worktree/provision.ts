/**
 * Creating a worktree AND making it runnable — the one implementation every caller goes through.
 *
 * ## Why this exists as a verb rather than as four call sites
 *
 * `git worktree add` is the easy half. The half that kept going wrong is what happens next: a fresh worktree
 * has no `node_modules`, and the first `bin/slopweaver` invocation there must never plant a SYMLINK
 * to one tree shared by the main checkout and all 247 worktrees. `deps.ts`'s header has the measured symptom
 * list; the short of it is that a dependency only one branch declares gets silently unlinked by anything that
 * installs the shared tree from a checkout without it.
 *
 * The rule, from the v1 system that already hit this: each worktree auto-installs yarn as part of worktree
 * creation, and `node_modules` is never symlinked across worktrees. So the install is part of
 * creation here, exactly like `checkout sync`'s post-pull install — a remembered second step is a step that
 * gets skipped, and when it is skipped the symptom appears somewhere else entirely.
 *
 * Effectful, with every seam injected: `provisionWorktree` itself is a decision tree over
 * {@link WorktreeProvisionDeps}, so a test drives it with plain fake functions and no subprocess.
 */
import { existsSync, lstatSync, readFileSync, readlinkSync, statSync } from "node:fs";
import { join } from "node:path";

import { cachePaths } from "../cacheHome.js";
import { installVerifiedPath, recordInstallVerified } from "../checkouts/installMark.js";
import { conventionalWorktreePath } from "../cmux/plan.js";
import { findExistingWorktree } from "../cmux/spawnTree.js";
import { commonGitDir, createWorktree, listWorktrees } from "../cmux/worktree.js";
import { reusedTreeBranch, type WorktreeInfo } from "../cmux/worktreeList.js";
import { err, ok, type Result } from "../lib/result.js";
import { ensureProofExclude } from "../proofPath/localExclude.js";
import {
  DEFAULT_DEPS_MODE,
  type DepsFacts,
  type DepsMode,
  type DepsStatus,
  depsStatus,
  renderDepsStatus,
  sharedDepsRefusal,
} from "./deps.js";
import { type DevBuildOutcome, devBuildDecision, renderDevBuildOutcome } from "./devBuild.js";
import { type WorktreeError, WorktreeErrors } from "./errors.js";
import { type ExecInodeReport, tallyExecInodes } from "./execInodes.js";
import { privatiseExecInodes } from "./execInodesApply.js";
import {
  claimRecycledTree,
  discardRecycledTree,
  holdOwnTree,
  installFromRecycled,
  linkSharedUnderLock,
  type RecycledProvision,
  recycledLines,
} from "./provisionRecycle.js";
import type { RecycleClaim } from "./recyclePool.js";
import { type DevBuildFailure, runBuild, runDevBuild, runInstall, sharedDepsRoot, supportsDevBuild } from "./shell.js";

/** What a caller asked `worktree create` for. */
export interface WorktreeRequest {
  /** The main checkout to create the worktree FROM. */
  readonly repoRoot: string;
  /** The directory name under `<repoRoot>/.claude/worktrees/`, and the default branch name. */
  readonly slug: string;
  /**
   * The exact directory to create, when nothing is reused. Defaults to the conventional
   * `<repoRoot>/.claude/worktrees/<slug>`, and is passed explicitly by callers that already decided a path
   * of their own — `cmux spawn`'s plan, whose `cwd` the planner may have taken from a non-conventional
   * worktree that already holds the branch.
   */
  readonly path: string;
  /** The branch to check out, defaulting to {@link slug}. */
  readonly branch: string;
  /** The ref a brand-new branch forks from, or `undefined` to use the remote's own default branch. */
  readonly baseBranch: string | undefined;
  /** Whether to install dependencies at all — on by default, off for a worktree nothing will be run in. */
  readonly install: boolean;
  /** Where those dependencies come from. */
  readonly deps: DepsMode;
  /** Whether to run `yarn build` after installing — off by default, because no verb here needs it. */
  readonly build: boolean;
  /**
   * Whether to emit this worktree's built CLI after installing — ON by default, because every verb run in
   * it afterwards is the thing that pays. `./devBuild.ts` carries the measurement and why provisioning is
   * the only place the first one can happen.
   */
  readonly devBuild: boolean;
}

/**
 * What one `worktree create` did.
 *
 * @internal
 */
export interface WorktreeProvisionReport {
  /** The worktree's absolute path. */
  readonly path: string;
  /** The branch checked out there. */
  readonly branch: string;
  /** Whether this call created the worktree, as opposed to reusing one git already had. */
  readonly created: boolean;
  /** What was done about dependencies: installed a tree, linked the shared one, or nothing. */
  readonly deps: "installed" | "linked-shared" | "skipped";
  /**
   * Whether the install started from a recycled tree (`./recyclePool.ts`) and which, or why it started empty —
   * `undefined` when this worktree's own tree was not installed.
   */
  readonly recycled: RecycledProvision | undefined;
  /** Whether `yarn build` ran — the repository's tsc script, never the built CLI. */
  readonly built: boolean;
  /** What the built-CLI emit did: emitted it, skipped it and why, or tried and failed without stopping here. */
  readonly devBuild: DevBuildOutcome;
  /** How `node_modules` stands once everything above has happened. */
  readonly status: DepsStatus;
  /**
   * What privatising the native binaries' inodes did, or `undefined` when nothing was installed.
   *
   * `execInodes.ts` has the whole defect: with `nmMode: hardlinks-global` a worktree's esbuild IS yarn's
   * store entry, one in-place write to that inode leaves it PERMANENTLY unexecutable in every checkout at
   * once, and yarn's own `autoRepair` path performs exactly that write.
   */
  readonly execInodes: ExecInodeReport | undefined;
}

/** The effects provisioning needs, injected so the decision tree is testable without a subprocess. */
export interface WorktreeProvisionDeps {
  /** Every worktree git currently registers for a repository. */
  readonly worktrees: (args: { repoRoot: string }) => readonly WorktreeInfo[];
  /** Create one worktree at an exact path, creating the branch when it does not exist. */
  readonly create: (args: { repoRoot: string; path: string; branch: string; baseBranch: string | undefined }) => void;
  /** Read everything {@link depsStatus} needs about one worktree's `node_modules` and manifests. */
  readonly readDepsFacts: (args: { path: string; sharedRoot: string }) => DepsFacts;
  /** Run the dependency install, returning the failure detail or `undefined` on success. */
  readonly install: (args: { cwd: string }) => string | undefined;
  /**
   * Record that the install succeeded here, returning the failure detail or `undefined` on success.
   *
   * A seam of its own rather than part of {@link install}, because an install that RAN and a mark that was
   * not written are two different outcomes and this repository keeps paying for reports that conflate them.
   */
  readonly recordInstallVerified: (args: { root: string }) => string | undefined;
  /** Run the build, returning the failure detail or `undefined` on success. */
  readonly build: (args: { cwd: string }) => string | undefined;
  /** Emit the built CLI, returning the failure and what it left on disk, or `undefined` on success. */
  readonly devBuild: (args: { cwd: string }) => DevBuildFailure | undefined;
  /** Whether the resolved target carries an emitter for {@link WorktreeProvisionDeps.devBuild} to run. */
  readonly supportsDevBuild: (args: { path: string }) => boolean;
  /** Replace `<path>/node_modules` with a symlink to the shared tree. */
  readonly linkShared: (args: { path: string; sharedRoot: string }) => void;
  /** The shared dependency tree's absolute path. */
  readonly sharedRoot: () => string;
  /** Re-link this worktree's native binaries to Slopweaver's exec store, off yarn's shared inodes. */
  readonly privatiseExecInodes: (args: { root: string }) => ExecInodeReport;
  /** Rename a recycled `node_modules` from the repository's pool into `<path>/node_modules`, if one fits. */
  readonly claimRecycled: (args: { path: string; repoRoot: string }) => RecycleClaim;
  /** Move `<path>/node_modules` into the trash, answering why it could not be, or `undefined` once it is gone. */
  readonly discardRecycled: (args: { path: string; repoRoot: string }) => string | undefined;
  /** Run the own-tree install holding `<path>`'s deps lock, or answer why the lock was not taken. */
  readonly holdOwnTree: <T>(args: { path: string; act: () => Result<T, WorktreeError> }) => Result<T, WorktreeError>;
}

/**
 * The real seams: git through `cmux/worktree.ts`, yarn through `./shell.ts`, and plain filesystem reads.
 *
 * @returns the production {@link WorktreeProvisionDeps}
 */
export function productionProvisionDeps(): WorktreeProvisionDeps {
  return {
    build: ({ cwd }) => runBuild({ cwd }),
    claimRecycled: ({ path, repoRoot }) => claimRecycledTree({ path, repoRoot }),
    create: ({ repoRoot, path, branch, baseBranch }) => {
      // The repository's shared `info/exclude` is brought up to the proof-output block first, so a capture left
      // in any worktree of it is ignored locally without its own `.gitignore` changing (`src/proofPath/`).
      const excluded = ensureProofExclude({ commonGitDir: commonGitDir({ repoRoot }) });
      if (excluded.isErr()) {
        throw new Error(excluded.error.join("\n"));
      }
      createWorktree({ baseBranch, branch, path, repoRoot });
    },
    devBuild: ({ cwd }) => runDevBuild({ cwd }),
    discardRecycled: ({ path, repoRoot }) => discardRecycledTree({ dir: join(path, "node_modules"), path, repoRoot }),
    holdOwnTree: ({ path, act }) => holdOwnTree({ act, path }),
    install: ({ cwd }) => runInstall({ cwd }),
    linkShared: ({ path, sharedRoot }) => {
      linkSharedUnderLock({ path, sharedRoot });
    },
    privatiseExecInodes: ({ root }) => privatiseExecInodes({ apply: true, execStore: cachePaths().execStore, root }),
    recordInstallVerified: ({ root }) => recordInstallVerified({ nowIso: new Date().toISOString(), root }),
    readDepsFacts: ({ path, sharedRoot }) => readDepsFacts({ path, sharedRoot }),
    sharedRoot: () => sharedDepsRoot(),
    supportsDevBuild: ({ path }) => supportsDevBuild({ path }),
    worktrees: ({ repoRoot }) => listWorktrees({ repoRoot }),
  };
}

/** One path's last-modified time in milliseconds, or `undefined` when it cannot be stat'ed. */
function mtimeMs({ path }: { path: string }): number | undefined {
  try {
    return statSync(path).mtimeMs;
  } catch {
    return undefined;
  }
}

/** One file's contents, or `undefined` when it cannot be read. */
function textOf({ path }: { path: string }): string | undefined {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return undefined;
  }
}

/** Where `node_modules` points when it is a symlink, or `undefined` when it is a real directory or absent. */
function linkTargetOf({ path }: { path: string }): string | undefined {
  try {
    return lstatSync(path).isSymbolicLink() ? readlinkSync(path) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Read one worktree's dependency facts off disk.
 *
 * @param path the worktree to read
 * @param sharedRoot the shared `node_modules` whose sibling lockfile is compared against this worktree's
 * @returns the facts, with an unreadable file recorded as `undefined` rather than as a zero
 */
export function readDepsFacts({ path, sharedRoot }: { path: string; sharedRoot: string }): DepsFacts {
  const nodeModules = join(path, "node_modules");
  return {
    installStateMs: mtimeMs({ path: join(nodeModules, ".yarn-state.yml") }),
    linkTarget: linkTargetOf({ path: nodeModules }),
    lockfileMs: mtimeMs({ path: join(path, "yarn.lock") }),
    lockfileText: textOf({ path: join(path, "yarn.lock") }),
    manifestMs: mtimeMs({ path: join(path, "package.json") }),
    present: existsSync(nodeModules),
    sharedLockfileText: textOf({ path: join(sharedRoot, "..", "yarn.lock") }),
    verifiedAtMs: mtimeMs({ path: installVerifiedPath({ root: path }) }),
  };
}

/** The worktree a request would reuse, or `undefined` when one must be created. */
function existingFor({
  request,
  deps,
  path,
}: {
  request: WorktreeRequest;
  deps: WorktreeProvisionDeps;
  path: string;
}): WorktreeInfo | undefined {
  return findExistingWorktree({
    candidates: [request.branch],
    conventionalPath: path,
    worktrees: deps.worktrees({ repoRoot: request.repoRoot }),
  });
}

/** What the dependency step settled on. */
interface SettledDeps {
  readonly deps: "installed" | "linked-shared";
  readonly execInodes: ExecInodeReport | undefined;
  readonly recycled: RecycledProvision | undefined;
}

/** Install this worktree's own tree, or link the shared one after proving the lockfiles agree. */
function settleDeps({
  request,
  deps,
  path,
}: {
  request: WorktreeRequest;
  deps: WorktreeProvisionDeps;
  path: string;
}): Result<SettledDeps, WorktreeError> {
  if (request.deps === "own") {
    // A recycled start, rolled back to an empty one if the install over it fails, held under the deps lock from the
    // claim to the exec-inode privatisation so a `--deps shared` provision of this path never swaps the tree yarn
    // or the privatisation is writing for its symlink (`./provisionRecycle.ts`). The privatisation runs BEFORE
    // anything is compiled here: both builds exec a binary out of this very tree, so one still sharing yarn's store
    // inode is a binary the next install anywhere can condemn. A recycled tree is no exception — yarn may have
    // relinked any file in it.
    return deps.holdOwnTree({
      act: () =>
        installFromRecycled({
          claim: () => deps.claimRecycled({ path, repoRoot: request.repoRoot }),
          discard: () => deps.discardRecycled({ path, repoRoot: request.repoRoot }),
          install: () => deps.install({ cwd: path }),
          mark: () => deps.recordInstallVerified({ root: path }),
        }).map((recycled): SettledDeps => ({
          deps: "installed",
          execInodes: deps.privatiseExecInodes({ root: path }),
          recycled,
        })),
      path,
    });
  }
  const sharedRoot = deps.sharedRoot();
  const refusal = sharedDepsRefusal({
    status: depsStatus({ facts: deps.readDepsFacts({ path, sharedRoot }) }),
  });
  if (refusal !== undefined) {
    return err(WorktreeErrors.sharedDepsMismatch({ detail: refusal, sharedRoot }));
  }
  deps.linkShared({ path, sharedRoot });
  return ok({ deps: "linked-shared", execInodes: undefined, recycled: undefined });
}

/** The dependency step a request that installs nothing settles on. */
const NOTHING_INSTALLED: { readonly deps: "skipped"; readonly execInodes: undefined; readonly recycled: undefined } = {
  deps: "skipped",
  execInodes: undefined,
  recycled: undefined,
};

/**
 * Create the worktree if it is not already there, then make it runnable.
 *
 * Reuse is deliberate and silent about nothing: a worktree already holding {@link WorktreeRequest.branch},
 * or already registered at the path this would create, is OPENED rather than fought over — `cmux/plan.ts`
 * documents both live collisions that taught that. The dependency step still runs for a reused worktree,
 * which is how a worktree that predates this verb stops carrying a shared symlink.
 *
 * @param request what the caller asked for
 * @param deps the injected effects
 * @returns the report, or the first typed failure — creation, install and shared-link refusal each have one
 */
export function provisionWorktree({
  request,
  deps,
}: {
  request: WorktreeRequest;
  deps: WorktreeProvisionDeps;
}): Result<WorktreeProvisionReport, WorktreeError> {
  const existing = existingFor({ deps, path: request.path, request });
  // No worktree to reuse means one is created, at the path the request names.
  const path = existing === undefined ? request.path : existing.path;
  if (existing === undefined) {
    try {
      deps.create({ baseBranch: request.baseBranch, branch: request.branch, path, repoRoot: request.repoRoot });
    } catch (error: unknown) {
      return err(
        WorktreeErrors.gitFailed({ cause: error, detail: error instanceof Error ? error.message : String(error) }),
      );
    }
  }
  const settled = request.install
    ? settleDeps({ deps, path, request })
    : ok<SettledDeps | typeof NOTHING_INSTALLED, WorktreeError>(NOTHING_INSTALLED);
  if (settled.isErr()) {
    return err(settled.error);
  }
  if (request.build) {
    const failure = deps.build({ cwd: path });
    if (failure !== undefined) {
      return err(WorktreeErrors.installFailed({ detail: failure, step: "build" }));
    }
  }
  return ok({
    branch: reusedTreeBranch({ candidates: [request.branch], existing, whenAbsent: request.branch }),
    built: request.build,
    created: existing === undefined,
    deps: settled.value.deps,
    devBuild: emitBuiltCli({ deps, path, request, settled: settled.value.deps }),
    execInodes: settled.value.execInodes,
    path,
    recycled: settled.value.recycled,
    status: depsStatus({ facts: deps.readDepsFacts({ path, sharedRoot: deps.sharedRoot() }) }),
  });
}

/**
 * Emit this worktree's built CLI, when the request and the target both say one belongs here.
 *
 * Last, and NON-FATAL by construction: a worktree with no built CLI is the state every worktree was in
 * before this existed, so a broken emit degrades provisioning rather than refusing to open the session that
 * would repair it. Everything above it stays fatal — a failed install, an unwritten mark and a shared-lockfile
 * mismatch each return before this is reached, so a tree whose dependencies are wrong never gets an emit.
 */
function emitBuiltCli({
  request,
  deps,
  path,
  settled,
}: {
  request: WorktreeRequest;
  deps: WorktreeProvisionDeps;
  path: string;
  settled: "installed" | "linked-shared" | "skipped";
}): DevBuildOutcome {
  // The capability is read unconditionally so that ONE pure function owns the whole ordering — two
  // `existsSync` calls on a directory this verb has just finished writing, against a rule the next reader
  // would otherwise have to find in two places.
  const decision = devBuildDecision({
    deps: settled,
    enabled: request.devBuild,
    supported: deps.supportsDevBuild({ path }),
  });
  if (!decision.emit) {
    return { did: "skipped", why: decision.why };
  }
  const failure = deps.devBuild({ cwd: path });
  if (failure !== undefined) {
    return { detail: failure.detail, did: "failed", left: failure.left };
  }
  return { did: "emitted" };
}

/**
 * The default request for a slug, so every caller that only knows a slug agrees on the same options.
 *
 * @param repoRoot the main checkout to create the worktree from
 * @param slug names both the directory and, by default, the branch
 * @returns the request the owner's v1 rule describes — install on, own tree, no tsc build, built CLI emitted
 */
export function defaultRequest({ repoRoot, slug }: { repoRoot: string; slug: string }): WorktreeRequest {
  return {
    baseBranch: undefined,
    branch: slug,
    build: false,
    deps: DEFAULT_DEPS_MODE,
    devBuild: true,
    install: true,
    path: conventionalWorktreePath({ repoRoot, slug }),
    repoRoot,
    slug,
  };
}

/**
 * The lines `worktree create` prints for one report.
 *
 * @param report what provisioning did
 * @returns one line per fact, outcome first
 */
export function renderProvisionReport({ report }: { report: WorktreeProvisionReport }): readonly string[] {
  return [
    `${report.created ? "created" : "reused"} ${report.path} on ${report.branch}`,
    `  ${renderDepsStatus({ status: report.status })}`,
    ...recycledLines({ recycled: report.recycled }),
    `  ${execInodeLine({ report: report.execInodes })}`,
    `  build: ${renderDevBuildOutcome({ outcome: report.devBuild, path: report.path })}; ${
      report.built ? "tsc ran (`yarn build`)" : "tsc skipped (no verb here needs it; pass --build to run it)"
    }`,
  ];
}

/** The one line `worktree create` prints about the native binaries' inodes. */
function execInodeLine({ report }: { report: ExecInodeReport | undefined }): string {
  if (report === undefined) {
    return "exec inodes: not touched (nothing was installed)";
  }
  const tally = tallyExecInodes({ report });
  const failed = tally.failed.count > 0 ? `, ${String(tally.failed.count)} FAILED` : "";
  return (
    `exec inodes: ${String(tally.relinked.count)} native binary(ies) relinked off yarn's shared store, ` +
    `${String(tally["already-private"].count)} already private${failed}`
  );
}
