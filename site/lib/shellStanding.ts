/**
 * Which build the desktop APP is, and whether it is the latest — the evidence the sidebar's one update line reads
 * beside the page's own (`./buildStanding.ts`, joined into one standing by `./updateStanding.ts`). Pure.
 *
 * A line such as "one commit behind origin/main, rebuilt 1.7 hours ago" is true of the PAGE, which rebuilds on
 * every landing; the app is rebuilt only by `slopweaver desktop install`, so it can be older than a landing the page
 * already carries (one app had been built three hours before the landing merged). The owner needs confidence about what build is running and what it is missing. So this line says the commit the RUNNING app was built from, whether that is behind
 * origin/main in a way that changes the app, and whether a newer install is waiting on a relaunch.
 *
 * Every number comes from two readings: the app's own stamp (`desktop/src/shellBuild.ts`, written into its
 * `Info.plist` by the install) and the same `checkout console --json` mainline the page line reads, whose commits
 * each say whether they change what the app is built from (`changesShell`, `src/checkouts/consoleBuild.ts`). A commit
 * whose flag could not be read is never counted as "does not change the app".
 *
 * A line reading "App not in origin/main's last 50" over a pre-squash build whose app is byte-identical to main's
 * reads as an app never rebuilt. So whether there is a new version is
 * decided by the app's SOURCE where the verb compared it (`installedApp`, `src/checkouts/installedApp.ts`), and said
 * plainly — "update available" — while the place on the line only lists which landings it holds.
 */
import { shortSha, staleUpstream } from "./buildStanding";
import { behindOf, type ConsoleBuildReport, type ConsoleCommit } from "./buildStandingReport";
import type { ShellBuild } from "./desktopShellWire";
import { byContent, contentVerdict } from "./shellStandingContent";
import {
  AVAILABLE,
  builtFrom,
  changesWord,
  installStep,
  MAY_BE_AVAILABLE,
  type ShellStanding,
} from "./shellStandingWords";

/** What the console window has learned of the app it is drawn in. */
export type ShellReading =
  | { readonly kind: "browser" }
  | { readonly kind: "pending" }
  | { readonly kind: "no-method" }
  | { readonly kind: "unreadable"; readonly why: string; readonly last: ShellBuild | undefined }
  | { readonly kind: "read"; readonly build: ShellBuild };

/**
 * The reading after an ask of the app failed: unreadable, with why, keeping the last build it did read — a failed
 * re-ask every minute never wipes the answer before it (`useShellBuild`).
 *
 * @param was the reading before this ask
 * @param why what went wrong, in the page's words
 * @returns the unreadable reading
 */
export function shellUnreadable({ was, why }: { was: ShellReading; why: string }): ShellReading {
  let last: ShellBuild | undefined;
  if (was.kind === "read") {
    last = was.build;
  } else if (was.kind === "unreadable") {
    last = was.last;
  }
  return { kind: "unreadable", last, why };
}

/**
 * The sidebar's reading of the desktop app's build.
 *
 * @param shell what the console window learned from the app
 * @param report the last `checkout console --json` reading, which places the app's commit on origin/main
 * @param callLive whether a voice call is up now — the install quits the app, and the call with it
 * @param nowMs the render's clock, for ages
 * @returns what to say, or `undefined` in a browser and until the app has answered
 */
export function shellStanding({
  shell,
  report,
  callLive,
  nowMs,
}: {
  shell: ShellReading;
  report: ConsoleBuildReport;
  callLive: boolean;
  nowMs: number;
}): ShellStanding | undefined {
  if (shell.kind === "browser" || shell.kind === "pending") {
    return undefined;
  }
  const line = (
    fields: Omit<ShellStanding, "changing" | "fix"> & {
      readonly changing?: readonly ConsoleCommit[];
      readonly fix?: ShellStanding["fix"];
    },
  ): ShellStanding => {
    let changing: readonly ConsoleCommit[] = [];
    if (fields.changing !== undefined) {
      changing = fields.changing;
    }
    let fix: ShellStanding["fix"] = "none";
    if (fields.fix !== undefined) {
      fix = fields.fix;
    }
    return { ...fields, changing, fix };
  };
  const unstamped = line({
    build: undefined,
    fix: "install",
    glance: "not known, install",
    headline: "App build not known",
    step: `this app was installed before builds were stamped; ${installStep({ callLive })}`,
    tone: "attention",
  });
  if (shell.kind === "no-method") {
    return unstamped;
  }
  if (shell.kind === "unreadable") {
    // The last build it did answer stays the standing, marked; with none, nothing is said in words at all.
    if (shell.last !== undefined) {
      const kept = shellStanding({ callLive, nowMs, report, shell: { build: shell.last, kind: "read" } })!;
      return { ...kept, shellUnread: { kept: true, why: shell.why } };
    }
    return {
      ...line({
        build: undefined,
        glance: "not known",
        headline: "App build not known",
        step: undefined,
        tone: "unknown",
      }),
      shellUnread: { kept: false, why: shell.why },
    };
  }
  const { dev, installed, running } = shell.build;
  if (dev) {
    return line({
      build: undefined,
      glance: "from source",
      headline: "App run from source",
      step: undefined,
      tone: "unknown",
    });
  }
  // The commit and the tree word: two builds of one commit, one carrying local edits, are two different apps.
  const relaunch =
    installed !== undefined &&
    (running === undefined || installed.sha !== running.sha || installed.tree !== running.tree);
  if (relaunch) {
    // The app on disk is not the one running: whatever this one is missing, a relaunch is the step that moves it.
    let step = `the installed app is ${shortSha({ sha: installed.sha })}; quit and reopen Slopweaver to run it`;
    if (callLive) {
      step = `the installed app is ${shortSha({ sha: installed.sha })}; quit and reopen Slopweaver after this call to run it`;
    }
    let build: string | undefined;
    if (running !== undefined) {
      build = builtFrom({ nowMs, stamp: running });
    }
    return line({
      build,
      fix: "relaunch",
      glance: "relaunch",
      headline: "App relaunch pending",
      step,
      tone: "attention",
    });
  }
  if (running === undefined) {
    return unstamped;
  }
  const build = builtFrom({ nowMs, stamp: running });
  const judged = contentVerdict({ installed, report, running });
  if (judged !== undefined) {
    return byContent({ build, callLive, judged, nowMs, report, running });
  }
  const behind = behindOf({ report, sha: running.sha });
  if (behind === undefined) {
    const ref = report.upstream === undefined ? "an upstream" : report.upstream.ref;
    return line({
      build,
      glance: "off the line",
      headline: "App off the line",
      step: `the app was built from a commit not on ${ref}'s history, so what it is missing cannot be counted`,
      tone: "unknown",
    });
  }
  const ref = report.upstream === undefined ? "the upstream" : report.upstream.ref;
  const changing = behind.missing.filter((commit) => commit.changesShell === true);
  if (!behind.counted) {
    // Outside a cut window the app is older than every commit the reading carries, or off the line: the flags cover
    // only the window, so nothing can be said of what lies past it — never "none change it".
    // Nor a count or a list: a build off the line may already hold any of the window's commits,
    // which is why this comes before the unread branch below, which lists.
    return line({
      build,
      fix: "install",
      glance: MAY_BE_AVAILABLE,
      headline: `New version may be available: this build is ${behind.lag}`,
      step: installStep({ callLive }),
      tone: "attention",
    });
  }
  const unread = behind.missing.filter((commit) => commit.changesShell === undefined);
  if (unread.length > 0) {
    return line({
      build,
      changing,
      fix: "install",
      glance: MAY_BE_AVAILABLE,
      headline: `New version may be available: this build is ${behind.lag}`,
      step: `which of those change the app could not be read; ${installStep({ callLive })}`,
      tone: "unknown",
    });
  }
  // Every claim left is about origin/main as it is NOW, so each needs the fetch the page line's "latest" needs.
  const stale = staleUpstream({ nowMs, report });
  if (changing.length > 0) {
    // Placed by its own commit, these landed after it; but over a stale fetch a later landing may have reverted them
    // and a build's local edits may already hold them, so the list stands, the verdict "may".
    const changes = changesWord({ count: changing.length });
    let headline = `New version available: ${changes} to the app`;
    let glance = AVAILABLE;
    if (stale !== undefined) {
      headline = `New version may be available: ${changes} to the app as ${stale}`;
      glance = MAY_BE_AVAILABLE;
    } else if (running.tree === "dirty") {
      headline = `New version may be available: ${changes} to the app since this build's commit`;
      glance = MAY_BE_AVAILABLE;
    }
    return line({
      build,
      changing,
      fix: "install",
      glance,
      headline,
      step: installStep({ callLive }),
      tone: "attention",
    });
  }
  if (stale !== undefined) {
    return line({
      build,
      glance: `${behind.short}, unchecked`,
      headline: `App ${behind.lag} ${ref} as ${stale}`,
      step: `whether ${ref} has landed anything since that changes the app is not known`,
      tone: "unknown",
      upstreamUnread: { lastMatched: true, ref, why: `${ref} ${stale}` },
    });
  }
  if (running.tree === "dirty") {
    return line({
      build,
      fix: "install",
      glance: "local changes",
      headline: "App built with uncommitted changes",
      step: `it is not ${ref}'s app; ${installStep({ callLive })}`,
      tone: "unknown",
    });
  }
  if (behind.missing.length > 0) {
    return line({
      build,
      glance: "current",
      headline: `App current: ${behind.lag}, none change it`,
      step: undefined,
      tone: "ok",
    });
  }
  return line({ build, glance: "latest", headline: "App on the latest build", step: undefined, tone: "ok" });
}
