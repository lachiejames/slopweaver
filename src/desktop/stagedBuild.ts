/**
 * The decisions behind the app's prebuilt update, as pure functions over what was read. The requirement: the
 * desktop app is never left old, so updating now always gets everything that has landed, never a stale build. So every move of the main checkout's HEAD builds and signs the app at that commit into one STAGED
 * folder beside the installed app, and the owner's Update now swaps that build in rather than starting one.
 *
 * One ready build at a time, named by nothing but its place: a newer one replaces it whole. The effects are
 * `cli/commands/desktop/prebuildRun.ts` (building the stage) and `installRun.ts` (taking it).
 */
import { join } from "node:path";

import type { ShellStamp } from "./buildStamp.js";
import { BUNDLE_NAME } from "./installPlan.js";

/** The folders one staged build moves through, all inside the app's own support folder. */
export interface StagePaths {
  /** The folder every staged build lives under. */
  readonly root: string;
  /** A build in progress, named for its run, so two never share one. */
  readonly building: string;
  /** The one build ready for the owner's Update now. */
  readonly ready: string;
  /** A ready build an install has taken, so a prebuild finishing meanwhile cannot replace it under the swap. */
  readonly claimed: string;
  /** The background half's record of its last run. */
  readonly log: string;
  /** The commit's own `desktop/`, exported for the build to compile, so nothing the checkout does reaches it. */
  readonly source: string;
}

/**
 * Where a staged build lives.
 *
 * @param appSupport the app's own support folder
 * @param nonce a value unique to this run
 * @returns the stage's folders
 */
export function stagePaths({ appSupport, nonce }: { appSupport: string; nonce: string }): StagePaths {
  const root = join(appSupport, "staged");
  return {
    building: join(root, `building-${nonce}`),
    claimed: join(root, `claimed-${nonce}`),
    log: join(root, "prebuild.log"),
    ready: join(root, "ready"),
    root,
    source: join(root, `source-${nonce}`),
  };
}

/**
 * The bundle inside one stage folder, where `yarn app` puts it when the folder is its output directory.
 *
 * @param folder a stage folder from {@link stagePaths}
 * @returns the `Slopweaver.app` in it
 */
export function stagedBundle({ folder }: { folder: string }): string {
  return join(folder, "mac-arm64", BUNDLE_NAME);
}

/** What a prebuild read before deciding. */
export interface PrebuildFacts {
  /** Whether this checkout is a declared main checkout — a worktree's HEAD is never what the owner updates to. */
  readonly isMain: boolean;
  /** Whether the app's signing keychain exists; a prebuild never mints one, the first install does. */
  readonly keychain: boolean;
  /** HEAD's stamp. */
  readonly head: ShellStamp;
  /** The installed app's stamp, when it carries one. */
  readonly installed: ShellStamp | undefined;
  /** Whether the app's source differs between the installed stamp and HEAD; unknown without an installed stamp. */
  readonly installedDiffers: boolean;
  /** The ready stage's stamp, when there is one. */
  readonly ready: ShellStamp | undefined;
}

/** Whether to build, and why — the line the hook prints either way. */
export type PrebuildDecision =
  { readonly due: true; readonly why: string } | { readonly due: false; readonly why: string };

/**
 * Whether HEAD's app should be built into the stage now. A ready build of exactly HEAD is enough; an installed app
 * whose source matches HEAD has no update to prepare; a checkout with local `desktop/` edits is never staged, since
 * the owner updates to main, not to a working tree.
 *
 * @param facts what was read
 * @returns due with why, or not due with why
 */
export function prebuildDecision({ facts }: { facts: PrebuildFacts }): PrebuildDecision {
  const short = facts.head.sha.slice(0, 9);
  if (!facts.isMain) {
    return { due: false, why: "not a declared main checkout" };
  }
  if (!facts.keychain) {
    return { due: false, why: "no signing keychain yet — the first `slopweaver desktop install` makes it" };
  }
  if (facts.head.tree === "dirty") {
    return { due: false, why: `${short} has local desktop/ edits, so it is not a build of main` };
  }
  if (facts.ready?.sha === facts.head.sha && facts.ready.tree === "clean") {
    return { due: false, why: `${short} is already built and waiting` };
  }
  if (facts.installed?.tree === "clean" && !facts.installedDiffers) {
    return { due: false, why: `the installed app already matches ${short}` };
  }
  return { due: true, why: `building ${short} so Update now has it ready` };
}

/** What an install read off the ready stage it might take. */
export interface StageFacts {
  /** The stage's stamp, when its bundle carries one. */
  readonly stamp: ShellStamp | undefined;
  /** HEAD's stamp, which the install would otherwise build. */
  readonly head: ShellStamp;
  /** The requirement the stage's bundle is signed with, when codesign could read one. */
  readonly requirement: string | undefined;
  /** The requirement the app's identity signs with. */
  readonly expected: string;
  /** Whether `codesign --verify --deep --strict` accepted the stage's bundle. */
  readonly verified: boolean;
}

/** Whether the ready stage can be installed as it stands, and why not when it cannot. */
export type StageVerdict = { readonly usable: true } | { readonly usable: false; readonly why: string };

/**
 * Whether the ready build IS what the install would build: exactly HEAD from a clean tree, signed with the app's
 * identity, its signature intact. Anything else is built fresh, so a stage can only ever save time, never install
 * something other than HEAD.
 *
 * @param facts what was read off the stage
 * @returns usable, or the reason it is not
 */
export function stageVerdict({ facts }: { facts: StageFacts }): StageVerdict {
  if (facts.stamp === undefined) {
    return { usable: false, why: "it carries no stamp" };
  }
  if (facts.stamp.sha !== facts.head.sha || facts.stamp.tree !== "clean" || facts.head.tree !== "clean") {
    return { usable: false, why: `it is ${facts.stamp.sha.slice(0, 9)}, not a clean ${facts.head.sha.slice(0, 9)}` };
  }
  // The whole stamp, its time included: the sha fixes the time, so a disagreement is a stamp not written by a build
  // of this commit.
  if (facts.stamp.committedIso !== facts.head.committedIso) {
    return { usable: false, why: `its stamp names ${facts.stamp.committedIso}, not HEAD's ${facts.head.committedIso}` };
  }
  if (facts.requirement !== facts.expected) {
    return { usable: false, why: "it is not signed with the app's identity" };
  }
  if (!facts.verified) {
    return { usable: false, why: "its signature did not verify" };
  }
  return { usable: true };
}

/**
 * The symlinks a commit's tree tracks, read off `git ls-tree -r`. A tracked symlink survives the export as a link,
 * and one pointing outside it would compile the live checkout's bytes under the commit's stamp,
 * so a prebuild refuses any commit that tracks one.
 *
 * @param tree what `git ls-tree -r <sha> desktop` printed
 * @returns the path of every tracked symlink, empty when there are none
 */
export function trackedSymlinks({ tree }: { tree: string }): readonly string[] {
  return tree
    .split("\n")
    .filter((line) => line.startsWith("120000 "))
    .map((line) => line.slice(line.indexOf("\t") + 1));
}

/**
 * The tracked paths a commit's tree holds twice over on the owner's disk: two that differ only in case or Unicode
 * normalisation (`scripts/Foo.sh`, `scripts/foo.sh`) extract onto ONE file of the default case-insensitive APFS
 * volume, the later overwriting the earlier, so the export would compile one blob under the other's name while every
 * path still reads as present. Folded as APFS compares: NFD, then lower case — an approximation of its
 * own case-folding table, which a constructed non-ASCII pair could still differ from.
 *
 * @param tree what `git ls-tree -r <sha> -- <pathspecs>` printed
 * @returns every path whose folded form another listed path shares, in listing order, empty when none collide
 */
export function caseCollidingPaths({ tree }: { tree: string }): readonly string[] {
  const paths = tree
    .split("\n")
    .filter((line) => line.includes("\t"))
    .map((line) => line.slice(line.indexOf("\t") + 1));
  const folded = paths.map((path) => path.normalize("NFD").toLowerCase());
  return paths.filter((_, at) => folded.indexOf(folded[at]!) !== folded.lastIndexOf(folded[at]!));
}

/** How long an install waits for a prebuild holding the build lock, before it reports the lock refused. */
export const PREBUILD_WAIT_MS = 10 * 60_000;

/** How often an install re-tries the lock while it waits. */
export const PREBUILD_POLL_MS = 2_000;
