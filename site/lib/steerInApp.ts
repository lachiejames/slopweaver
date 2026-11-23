/**
 * Whether a steer whose fix landed on main is in what the owner is RUNNING, or still waiting for their app to update. Pure.
 *
 * A fix merged but not yet in the running app reads "waiting for your app to update" rather than "fixed": that tells
 * the owner whether the effort of updating, closing and reconnecting the voice call will fix anything, and it
 * distinguishes fixed from not fixed until the app restarts on the latest version.
 *
 * So a landing is placed against the two builds the owner runs, on the same `checkout console --json` reading the sidebar's
 * update line stands on: the page's bundle (`LOADED_BUILD`, `./loadedBuild.ts`) and the desktop app's own stamp. Both
 * are placed by their commit's position in origin/main's first-parent window — never through the sidebar's standing,
 * whose not-known arms carry no missing commits for a build that may well be behind. A landing joins the window by
 * its pull request number, which a merge-queue squash carries in its subject — and only once its own address names
 * the repository the console is built from: a steer can land in another repository (acme-admin), which no update of
 * the owner's app ever carries, and whose numbers mean nothing on this window. Whatever cannot be placed is said to be not
 * known, with why — never "in your app".
 */
import type { ConsoleBuildReport } from "./buildStandingReport";
import type { ShellReading } from "./shellStanding";

/** Where a landed fix stands against what the owner runs. */
export type SteerInApp =
  | { readonly kind: "in-app" }
  /** Landed in a repository the console is not built from, so updating the owner's app has no bearing on it. */
  | { readonly kind: "elsewhere" }
  | { readonly kind: "awaiting-update" }
  | { readonly kind: "unknown"; readonly why: string };

/** The builds the owner is running, and the reading that places them. */
export interface RunningBuilds {
  /** The last `checkout console --json` reading, whose mainline places every build and landing. */
  readonly report: ConsoleBuildReport;
  /** The commit this page's bundle was baked from; `undefined` when the build carried no identity. */
  readonly loadedSha: string | undefined;
  /** What the console window has learned of the desktop app it is drawn in. */
  readonly shell: ShellReading;
}

/** The upstream's name for a sentence. */
function refOf({ report }: { report: ConsoleBuildReport }): string {
  return report.upstream === undefined ? "main" : report.upstream.ref;
}

/** The pull-request address prefix of the repository the console is built from, off the window's own links. */
function consolePullPrefixOf({ report }: { report: ConsoleBuildReport }): string | undefined {
  for (const commit of report.mainline.commits) {
    const url = commit.pullRequest?.url;
    if (url !== undefined) {
      const cut = url.lastIndexOf("/pull/");
      if (cut !== -1) {
        return url.slice(0, cut + "/pull/".length);
      }
    }
  }
  return undefined;
}

/** Where a sha sits in the window, newest first — 0 is the latest. */
function placeOf({ report, sha }: { report: ConsoleBuildReport; sha: string }): number | undefined {
  const at = report.mainline.commits.findIndex((commit) => commit.sha === sha);
  return at === -1 ? undefined : at;
}

/**
 * Whether the desktop app carries a commit that may change it, the commit at `at` in the window — or, for a landing
 * older than the whole window, at the window's length.
 */
function appCarries({ at, running }: { at: number; running: RunningBuilds }): SteerInApp {
  const { report, shell } = running;
  switch (shell.kind) {
    case "browser": {
      // No app: the page is all the owner runs, and it already carries this.
      return { kind: "in-app" };
    }
    case "pending": {
      return { kind: "unknown", why: "the app has not said which build it runs yet" };
    }
    case "no-method":
    case "unreadable": {
      return { kind: "unknown", why: "the app's build is not known" };
    }
    case "read": {
      break;
    }
    default: {
      const exhausted: never = shell;
      return exhausted;
    }
  }
  const { dev, running: stamp } = shell.build;
  if (dev) {
    return { kind: "unknown", why: "the app runs from source, so which commit it carries is not fixed" };
  }
  if (stamp === undefined) {
    return { kind: "unknown", why: "the running app carries no build stamp" };
  }
  // The verb compared this very build's app source with the upstream tip's and found them equal: every change to the
  // app the window holds is in it, whatever commit it was built from.
  const installed = report.installedApp;
  const sameBuild =
    installed?.kind === "read" &&
    installed.stamp.sha === stamp.sha &&
    installed.stamp.tree === stamp.tree &&
    installed.stamp.committedIso === stamp.committedIso;
  if (sameBuild && installed.shellDiffers === false) {
    return { kind: "in-app" };
  }
  const runAt = placeOf({ report, sha: stamp.sha });
  if (runAt === undefined) {
    return { kind: "unknown", why: `the app's build is not in ${refOf({ report })}'s recent history` };
  }
  if (at < runAt) {
    return { kind: "awaiting-update" };
  }
  return { kind: "in-app" };
}

/**
 * Whether a steer's landed pull request is in the app the owner is running, or waiting for it to update.
 *
 * @param landing the pull request the steer landed through — its address names its repository — and when it merged
 * @param running the builds the owner runs and the reading that places them
 * @returns in the app, waiting for an update, landed in another repository, or not known and why
 */
export function steerInApp({
  landing,
  running,
}: {
  landing: { readonly number: number; readonly mergedIso: string; readonly url: string };
  running: RunningBuilds;
}): SteerInApp {
  const { report, loadedSha } = running;
  const ref = refOf({ report });
  const prefix = consolePullPrefixOf({ report });
  if (prefix === undefined) {
    return { kind: "unknown", why: "the build reading names no repository for its pull requests" };
  }
  // GitHub's owner and repository names are case-insensitive, and the two readers spell them from different sources.
  if (landing.url.toLowerCase() !== `${prefix}${String(landing.number)}`.toLowerCase()) {
    return { kind: "elsewhere" };
  }
  if (report.served.kind === "dev") {
    return { kind: "unknown", why: "the console is a dev server, so which commit it carries is not fixed" };
  }
  if (loadedSha === undefined) {
    return { kind: "unknown", why: "this page's build carries no commit id" };
  }
  const pageAt = placeOf({ report, sha: loadedSha });
  if (pageAt === undefined) {
    return { kind: "unknown", why: `this page's build is not in ${ref}'s recent history` };
  }
  const commits = report.mainline.commits;
  const at = commits.findIndex((commit) => commit.pullRequest?.number === landing.number);
  if (at !== -1) {
    if (at < pageAt) {
      return { kind: "awaiting-update" };
    }
    if (commits[at].changesShell === false) {
      return { kind: "in-app" };
    }
    return appCarries({ at, running });
  }
  const mergedMs = Date.parse(landing.mergedIso);
  const newest = commits.at(0);
  if (newest !== undefined && mergedMs > Date.parse(newest.committedIso)) {
    // Merged after the reading last fetched main, so after every build it can place: none of them carries it.
    return { kind: "awaiting-update" };
  }
  const oldest = commits.at(-1);
  if (report.mainline.truncated && oldest !== undefined && mergedMs < Date.parse(oldest.committedIso)) {
    // Older than the whole window, and the page's build is inside it. Whether it changes the app is not read.
    return appCarries({ at: commits.length, running });
  }
  return { kind: "unknown", why: `#${String(landing.number)} is not in ${ref}'s recent history as last read` };
}
