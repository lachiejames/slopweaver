/**
 * The app's standing when the verb compared the app's own source with the upstream tip: whether that comparison is
 * of this app, and what to say from it. Split out of `./shellStanding.ts`.
 */

import { staleUpstream } from "./buildStanding";
import { behindOf, type ConsoleBuildReport } from "./buildStandingReport";
import type { ShellStamp } from "./desktopShellWire";
import { AVAILABLE, changesWord, installStep, MAY_BE_AVAILABLE, type ShellStanding } from "./shellStandingWords";

/**
 * The verb's content comparison, when it is a comparison of THIS app: the running build, the installed bundle as the
 * app read it and the installed bundle as the verb read it must be one stamp, of a clean tree. The verb and the app
 * read at different instants, so an install between them leaves two stamps and the comparison is of neither.
 *
 * @param installed the installed bundle's stamp, as the app read it
 * @param running the running build's stamp
 * @returns whether the app's source differs from the upstream tip's and where it forked, or `undefined` when the
 *   reading cannot stand for this app — the line then places the build by commit instead
 */
export function contentVerdict({
  installed,
  report,
  running,
}: {
  installed: ShellStamp | undefined;
  report: ConsoleBuildReport;
  running: ShellStamp;
}): { readonly shellDiffers: boolean; readonly forkSha: string | undefined } | undefined {
  const app = report.installedApp;
  if (app?.kind !== "read" || app.shellDiffers === undefined || installed === undefined) {
    return undefined;
  }
  const same = ({ stamp }: { stamp: ShellStamp }): boolean =>
    stamp.sha === running.sha && stamp.tree === running.tree && stamp.committedIso === running.committedIso;
  if (running.tree !== "clean" || !same({ stamp: installed }) || !same({ stamp: app.stamp })) {
    return undefined;
  }
  return { forkSha: app.forkSha, shellDiffers: app.shellDiffers };
}

/**
 * The app line when the verb compared the app's own source with the upstream tip. A build installed from a pull
 * request's branch head sits on no first-parent line, and was read as "not in origin/main's last 50" while its app
 * was byte-identical to main's — so the source decides whether there is a new version, and
 * the history only lists which landings it holds.
 *
 * @param build the running build's commit and age, as the fold prints it
 * @param judged the verb's comparison, joined to this app by `contentVerdict`
 * @param running the running build's stamp
 * @returns what to say
 */
export function byContent({
  build,
  callLive,
  judged,
  nowMs,
  report,
  running,
}: {
  build: string;
  callLive: boolean;
  judged: { readonly shellDiffers: boolean; readonly forkSha: string | undefined };
  nowMs: number;
  report: ConsoleBuildReport;
  running: ShellStamp;
}): ShellStanding {
  const ref = report.upstream === undefined ? "the upstream" : report.upstream.ref;
  // Either verdict is a claim about the upstream as it is NOW, so each needs the fetch the page line's "latest"
  // needs: a stale tip may since have landed a change to the app, or reverted one.
  const stale = staleUpstream({ nowMs, report });
  if (stale !== undefined && judged.shellDiffers) {
    return {
      build,
      changing: [],
      glance: MAY_BE_AVAILABLE,
      fix: "install",
      headline: `New version may be available: this build's app differed from ${ref}'s as ${stale}`,
      step: installStep({ callLive }),
      tone: "unknown",
    };
  }
  if (!judged.shellDiffers) {
    if (stale !== undefined) {
      return {
        build,
        changing: [],
        fix: "none",
        glance: "unchecked",
        headline: `App matches ${ref} as ${stale}`,
        step: `whether ${ref} has landed anything since that changes the app is not known`,
        tone: "unknown",
        upstreamUnread: { lastMatched: true, ref, why: `${ref} ${stale}` },
      };
    }
    if (report.upstream !== undefined && report.upstream.sha === running.sha) {
      return {
        build,
        changing: [],
        fix: "none",
        glance: "latest",
        headline: "App on the latest build",
        step: undefined,
        tone: "ok",
      };
    }
    return {
      build,
      changing: [],
      fix: "none",
      glance: "current",
      headline: "App current: no change to it since your build",
      step: undefined,
      tone: "ok",
    };
  }
  // Placed by its own commit when that is on the line, else by where it forked. Unplaced — no fork read, or one
  // outside the window or off the first-parent line, which the reading cannot tell apart — the window's flagged
  // commits may be ones the build already holds, so none is listed and nothing is counted.
  const bySha = behindOf({ report, sha: running.sha });
  let placed = bySha?.counted === true ? bySha : undefined;
  if (placed === undefined && judged.forkSha !== undefined) {
    const byFork = behindOf({ report, sha: judged.forkSha });
    placed = byFork?.counted === true ? byFork : undefined;
  }
  const step = installStep({ callLive });
  const differs = `New version available: this build's app differs from ${ref}'s`;
  if (placed === undefined) {
    return { build, changing: [], fix: "install", glance: AVAILABLE, headline: differs, step, tone: "attention" };
  }
  const changing = placed.missing.filter((commit) => commit.changesShell === true);
  if (changing.length === 0) {
    return { build, changing, fix: "install", glance: AVAILABLE, headline: differs, step, tone: "attention" };
  }
  const headline = `New version available: ${changesWord({ count: changing.length })} to the app`;
  return { build, changing, fix: "install", glance: AVAILABLE, headline, step, tone: "attention" };
}
