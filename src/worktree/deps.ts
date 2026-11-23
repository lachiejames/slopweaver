/**
 * What a worktree's `node_modules` IS, what it should be, and whether the two agree.
 *
 * ## The defect this encodes
 *
 * Every worktree of this repository used to get a `node_modules` SYMLINK to one shared tree under the
 * plugin's data directory, planted by `bin/slopweaver` the first time it ran there. Measured twice in one
 * session: a dependency only ONE branch's `package.json` lists is silently unlinked the moment
 * anything installs that shared tree from a checkout without it — while the branch's own `package.json` and
 * `yarn.lock` still list it, so nothing looks wrong. The symptom surfaces as `TS2307 Cannot find module` from
 * a gate that builds a whole-repo Program, or `ERR_MODULE_NOT_FOUND` from a loader test, and reads exactly
 * like a broken import in your own code.
 *
 * ## Why per-worktree trees are affordable, which is the only reason this is the default
 *
 * The owner's v1 rule is one real install per worktree and never a shared symlink. The obvious objection is
 * disk: measured on this machine, a classic `yarn install` costs **2.41 GiB per worktree**, and
 * there are 247 registered worktrees — 596 GB, on a volume with 68 GiB free. What makes the rule affordable
 * is `nmMode: hardlinks-global` in `.yarnrc.yml`: every file in `node_modules` is a hardlink into one
 * content-addressed store under the global folder, so a worktree's own tree costs **316 KiB** of unique
 * blocks. Reproduce both with
 * `du -sch ~/.yarn/berry/store <worktree>/node_modules` — the union stays at the store's own size.
 *
 * Pure: no filesystem, no subprocess. Everything a decision needs is passed in already-read, so each rule
 * below is testable against a literal fixture.
 */
import { absentAs } from "#lib/absent.js";
import { type InstallFreshness, installFreshness } from "../checkouts/freshness.js";

/** Where a worktree's dependencies come from. */
export type DepsMode = "own" | "shared";

/** The default — a real per-worktree tree, installed from that worktree's own lockfile. */
export const DEFAULT_DEPS_MODE: DepsMode = "own";

/** What is at `<worktree>/node_modules` right now. */
type DepsLink = "absent" | "own" | "shared";

/** The already-read facts one worktree's dependency state is decided from. */
export interface DepsFacts {
  /** Where the symlink at `node_modules` points, or `undefined` when it is a real directory or absent. */
  readonly linkTarget: string | undefined;
  /** Whether anything at all exists at `node_modules`. */
  readonly present: boolean;
  /** `package.json`'s last-modified time, or `undefined` when it could not be stat'ed. */
  readonly manifestMs: number | undefined;
  /** `yarn.lock`'s last-modified time, or `undefined` when it could not be stat'ed. */
  readonly lockfileMs: number | undefined;
  /** `node_modules/.yarn-state.yml`'s last-modified time — absent means nothing was ever installed here. */
  readonly installStateMs: number | undefined;
  /**
   * When `yarn install --immutable` last succeeded here, from Slopweaver's own mark, or `undefined`.
   *
   * Yarn writes nothing when an install changes nothing, so without this a verified install can never move
   * the installed side of the comparison — see `../checkouts/installMark.ts`.
   */
  readonly verifiedAtMs: number | undefined;
  /** This worktree's own `yarn.lock` contents, or `undefined` when unreadable. */
  readonly lockfileText: string | undefined;
  /** The SHARED tree's `yarn.lock` contents, or `undefined` when there is no shared tree to compare with. */
  readonly sharedLockfileText: string | undefined;
}

/** Whether a worktree's lockfile and the shared tree's are the same file, or whether that is even knowable. */
type LockfileAgreement = "match" | "differs" | "unknown";

/** One worktree's dependency state, as a caller renders or branches on it. */
export interface DepsStatus {
  /** What `node_modules` is: nothing, this worktree's own tree, or a symlink to a shared one. */
  readonly link: DepsLink;
  /** The shared tree the symlink points at, when {@link link} is `shared`. */
  readonly linkTarget: string | undefined;
  /** Whether the installed tree is older than the manifest that describes it. */
  readonly freshness: InstallFreshness;
  /** Whether this worktree's lockfile agrees with the shared tree's. */
  readonly lockfile: LockfileAgreement;
}

/**
 * Fold the already-read facts into one worktree's dependency state.
 *
 * @param facts everything read from disk about this worktree's `node_modules` and manifests
 * @returns the state, with no judgement about whether it is acceptable — see {@link sharedDepsRefusal}
 */
export function depsStatus({ facts }: { facts: DepsFacts }): DepsStatus {
  let link: DepsLink;
  if (facts.linkTarget !== undefined) {
    link = "shared";
  } else if (facts.present) {
    link = "own";
  } else {
    link = "absent";
  }
  return {
    freshness: installFreshness({
      installStateMs: facts.installStateMs,
      lockfileMs: facts.lockfileMs,
      manifestMs: facts.manifestMs,
      verifiedAtMs: facts.verifiedAtMs,
    }),
    link,
    linkTarget: facts.linkTarget,
    lockfile: lockfileAgreement({ facts }),
  };
}

/** Whether the two lockfiles agree, treating either one being unreadable as `unknown` rather than as a match. */
function lockfileAgreement({ facts }: { facts: DepsFacts }): LockfileAgreement {
  if (facts.lockfileText === undefined || facts.sharedLockfileText === undefined) {
    return "unknown";
  }
  return facts.lockfileText === facts.sharedLockfileText ? "match" : "differs";
}

/**
 * Why `--deps shared` must be refused for this worktree, if it must be.
 *
 * Sharing is only ever safe when the shared tree was installed from BYTE-IDENTICAL lockfile contents. An
 * `unknown` comparison refuses too: a check that could not run is not a check that passed, and this is the
 * exact place the measured defect entered.
 *
 * @param status the worktree's dependency state as {@link depsStatus} folded it
 * @returns the refusal detail, or `undefined` when sharing is safe
 */
export function sharedDepsRefusal({ status }: { status: DepsStatus }): string | undefined {
  if (status.lockfile === "match") {
    return undefined;
  }
  return status.lockfile === "differs"
    ? "this worktree's yarn.lock differs from the shared tree's"
    : "this worktree's yarn.lock could not be compared with the shared tree's";
}

/**
 * The sentence `worktree status` and `worktree create` both print for a worktree's dependency state.
 *
 * @param status the state to describe
 * @returns one line, naming the shared target and the lockfile verdict when the tree is a symlink
 */
export function renderDepsStatus({ status }: { status: DepsStatus }): string {
  switch (status.link) {
    case "absent":
      return "deps: none installed — run `slopweaver worktree create <slug>` or `yarn install` here";
    case "shared":
      return (
        `deps: SHARED symlink → ${absentAs({ value: status.linkTarget, whenAbsent: "an unreadable target" })} ` +
        `(lockfile ${status.lockfile}) — a branch-only dependency can be unlinked without warning`
      );
    case "own":
      return `deps: own tree, ${status.freshness} against this worktree's package.json + yarn.lock`;
  }
}

/**
 * Whether a worktree is safe to run gates in: its own tree, installed no earlier than its own manifests.
 *
 * @param status the state to judge
 * @returns true only for an own tree that is current — a shared or stale one can be missing a branch's deps
 */
export function depsAreTrustworthy({ status }: { status: DepsStatus }): boolean {
  return status.link === "own" && status.freshness === "current";
}
