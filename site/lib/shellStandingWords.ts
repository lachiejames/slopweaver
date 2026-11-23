/**
 * What the sidebar says about the desktop app, and the words it says it in: the install step, the commit a build was
 * built from, the update glances and a count of changes. Split out of `./shellStanding.ts`.
 */

import { ageAt, type BuildStanding, shortSha } from "./buildStanding";
import type { ConsoleCommit } from "./buildStandingReport";
import type { ShellStamp } from "./desktopShellWire";

/** What the sidebar says about the app. */
export interface ShellStanding {
  /** The dot's colour, as the page line's. */
  readonly tone: BuildStanding["tone"];
  /** The fold's headline. */
  readonly headline: string;
  /** The same standing in the fewest words, for the sidebar's one staleness line. */
  readonly glance: string;
  /** The commit the running app was built from, and its age; `undefined` when no build is known. */
  readonly build: string | undefined;
  /** The one step to take, or why nothing can be said; `undefined` when there is nothing to do. */
  readonly step: string | undefined;
  /** The commits the running app is missing that change it, newest first. */
  readonly changing: readonly ConsoleCommit[];
  /**
   * What would move the app onto the latest build — a full install, or only a relaunch onto the one already installed
   * — or `none` when nothing would, or nothing can be said. The sidebar's Update button reads this, never the words.
   */
  readonly fix: "install" | "relaunch" | "none";
  /**
   * Set only when the app's standing is unknown because the upstream's fetch is not current, and as last fetched
   * nothing changed the app — a failed read, marked, never a sentence (`BuildStanding.upstreamUnread`).
   */
  readonly upstreamUnread?: BuildStanding["upstreamUnread"];
  /**
   * Set when the app's own last answer would not read: why, and whether the standing above is the one its last good
   * answer gave (`kept`) or nothing earlier was read — a failed read, marked, never a sentence.
   */
  readonly shellUnread?: { readonly why: string; readonly kept: boolean };
}

/** The install, named once: it rebuilds from the main checkout, quits the app and reopens it. */
const INSTALL = "`slopweaver desktop install` from the main checkout";

/**
 * The step to install, worded for a live call: the install quits the app, and a call in it with the app.
 *
 * @returns the step
 */
export function installStep({ callLive }: { callLive: boolean }): string {
  if (callLive) {
    return `after this call, ${INSTALL}: it quits the app, and would end the call with it`;
  }
  return `${INSTALL}: it quits the app and reopens it on the new build`;
}

/**
 * The commit a stamp names, with its age and whether the build carried local desktop changes.
 *
 * @returns `built from <short sha>, commit 3.2h ago`, `… (with uncommitted app changes)` for a dirty build
 */
export function builtFrom({ stamp, nowMs }: { stamp: ShellStamp; nowMs: number }): string {
  const line = `built from ${shortSha({ sha: stamp.sha })}, commit ${ageAt({ iso: stamp.committedIso, nowMs })}`;
  if (stamp.tree === "dirty") {
    return `${line} (with uncommitted app changes)`;
  }
  return line;
}

/** The glance when the app's source has moved on: the one word the owner reads, quietly, in the sidebar. */
export const AVAILABLE = "update available";

/** The glance when a newer app is likely but the reading cannot show that one changes it. */
export const MAY_BE_AVAILABLE = "update may be available";

/**
 * A count of changes to the app in words.
 *
 * @returns "3 changes" or "1 change"
 */
export function changesWord({ count }: { count: number }): string {
  return count === 1 ? "1 change" : `${String(count)} changes`;
}
