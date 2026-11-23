"use client";

/*
 * Your steers, a section of the Alignment page: every steer the owner gave on a call, newest first, and whether it has been
 * applied. The section shows the different steers given over time, so the same steer is not given twice and the
 * context and learning carry forward; it sits on the alignment page because tracking steers and alignment over time
 * belong together. So each row leads with
 * what the steer became, tags whether it landed, and says so when the owner had to give it more than once — the count the owner
 * wants to see go down. Every field is derived by `handover steers` (`src/handover/steers.ts`); nothing here is kept.
 *
 * A steer whose fix is on main but not in the build the owner runs is NOT applied to the owner yet: a fix is not a fix
 * until the app restarts on the latest version. So such a row reads "waiting for your app to update", placed against what the owner
 * runs by `site/lib/steerInApp.ts` over the sidebar build line's own `checkout console --json` reading.
 *
 * Above the list, a chart of how many times the owner steered each week, first given and said again stacked, so the
 * owner can see steering shrink over time (`./SteersChart.tsx`,
 * `site/lib/steersChart.ts`).
 */

import type { ReactElement } from "react";

import { readConsoleBuildReport } from "../../lib/buildStandingReport";
import { clauseAfter } from "../../lib/clauseJoin";
import { readerTimeZone } from "../../lib/dateTimeFormat";
import { LOADED_BUILD } from "../../lib/loadedBuild";
import type { StalenessFact } from "../../lib/stalenessLabel";
import { type SteerInApp } from "../../lib/steerInApp";
import { steersChart } from "../../lib/steersChart";
import { ReadingIndicator } from "../console/ReadingIndicator";
import { StaleMark } from "../console/StaleMark";
import { useShellBuild } from "../voice/useDesktopShell";
import type { SteerStateView, SteersView } from "./readSteers";
import { readSteers } from "./readSteers";
import { SteersChart } from "./SteersChart";
import { inAppOf, type RunningReading, SteerList } from "./SteersLine";
import { STAT, Tile } from "./Tile";
import { useLive } from "./useLive";

/** The owner's browser's zone: the calendar the chart's weeks are counted on. */
function ownerZone(): string {
  return readerTimeZone();
}

/** The sidebar's own build poll, so this page rides the channel it keeps rather than reading on a second clock. */
const BUILD_POLL_MS = 60_000;

/** One headline figure. */
function Stat({ count, label, tone }: { count: number; label: string; tone: string }): ReactElement {
  let className = "";
  if (count > 0) {
    className = tone;
  }
  return (
    <p className={STAT}>
      <strong className={className}>{count}</strong>
      <span>{label}</span>
    </p>
  );
}

/**
 * The build reading's one mark on the page: a progress indicator while it is on its way, a staleness mark when it
 * failed — whether or not an earlier reading is still drawn beneath it.
 */
function RunningMark({ running }: { running: RunningReading }): ReactElement | null {
  if (running.kind === "reading") {
    return <ReadingIndicator label="Reading which build your app runs" className="self-center" />;
  }
  const why = running.kind === "not-read" ? running.why : running.staleWhy;
  if (why === undefined) {
    return null;
  }
  return <StaleMark facts={[{ subject: "which build your app runs", why }]} className="self-center" />;
}

/**
 * The headline: how many the owner gave, how many are in what the owner runs, how many wait on the owner's update, how many are moving,
 * and how many the owner had to repeat.
 */
function Stats({ view, running }: { view: SteersView; running: RunningReading }): ReactElement {
  const count = (kind: SteerStateView["kind"]): number =>
    view.steers.filter((steer) => steer.state.kind === kind).length;
  const inApp = (kind: SteerInApp["kind"]): number =>
    view.steers.filter((steer) => inAppOf({ running, steer })?.kind === kind).length;
  const nothingLanded = count("settled") + count("ended") + count("run-closed");
  const repeated = view.steers.filter((steer) => steer.timesGiven > 1).length;
  const unplaced = inApp("unknown");
  // Until the build reading is in, a landed steer cannot be placed against what the owner runs, so the landed figure stands
  // alone beside the reading's one mark rather than counting every landed steer as "not known".
  let placed: ReactElement = <Stat count={count("applied")} label="landed" tone="text-success" />;
  if (running.kind === "read") {
    placed = (
      <>
        <Stat count={inApp("in-app") + inApp("elsewhere")} label="applied" tone="text-success" />
        <Stat count={inApp("awaiting-update")} label="waiting for your app to update" tone="text-primary" />
        {unplaced === 0 ? null : (
          <Stat count={unplaced} label="landed, not known if your app has it" tone="text-muted-foreground" />
        )}
      </>
    );
  }
  return (
    <div className="flex flex-wrap gap-8">
      <Stat count={view.steers.length} label="steers given" tone="" />
      {placed}
      <RunningMark running={running} />
      <Stat count={count("in-flight")} label="in flight" tone="" />
      <Stat count={count("waiting")} label="not started" tone="text-warning" />
      <Stat count={nothingLanded} label="closed with nothing on main" tone="text-muted-foreground" />
      <Stat count={repeated} label="you had to say more than once" tone="text-warning" />
    </div>
  );
}

/**
 * What the verb could not read, steers whose landing could not be judged among it — a staleness mark whose hover names
 * each — and steers that carry no words of the owner's, said in lines: each a reason a figure may be short.
 */
function Problems({ view }: { view: SteersView }): ReactElement | null {
  const unknown = view.steers.filter((steer) => steer.state.kind === "landing-unknown").length;
  const unanchored = view.steers.filter((steer) => steer.origin.kind === "named-in-text").length;
  const unread: StalenessFact[] = [];
  const lines: string[] = [];
  for (const repo of view.repos) {
    if (repo.kind === "unread") {
      unread.push({
        subject: `main in ${repo.dir}`,
        why: clauseAfter({ clause: "no steer there shows as applied", joint: ";", reason: repo.why }),
      });
    } else {
      if (repo.ledgerUnread > 0) {
        unread.push({
          subject: `${String(repo.ledgerUnread)} PR-ledger file(s) for ${repo.repo}`,
          why: "a steer shown as not landed may have landed",
        });
      }
      if (repo.unjoined > 0) {
        lines.push(
          `${String(repo.unjoined)} PR(s) on ${repo.repo}'s main have no ledger record, so a steer whose branch landed through one shows as not landed`,
        );
      }
    }
  }
  if (view.unreadableDocs > 0) {
    unread.push({
      subject: `${String(view.unreadableDocs)} board row(s)`,
      why: "a steer on one is missing here",
    });
  }
  if (view.unreadableJournals.length > 0) {
    unread.push({
      subject: `${String(view.unreadableJournals.length)} run journal(s)`,
      why: `each such steer says its landing is unknown: ${view.unreadableJournals.join(", ")}`,
    });
  }
  if (unknown > 0) {
    unread.push({
      subject: `whether ${String(unknown)} steer(s) landed`,
      why: "a read each is judged from failed; each row's own mark names which and why",
    });
  }
  if (unanchored > 0) {
    lines.push(
      `${String(unanchored)} steer(s) name a call turn only in their text, registered without --anchor, so your words are not attached`,
    );
  }
  if (lines.length === 0 && unread.length === 0) {
    return null;
  }
  return (
    <>
      {unread.length > 0 && <StaleMark facts={unread} className="self-start" />}
      {lines.length > 0 && (
        <ul className="m-0 grid gap-1 pl-4 text-[0.8rem] text-warning">
          {lines.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      )}
    </>
  );
}

/**
 * The builds the owner runs, read off the sidebar's own `checkout console --json` channel and the app's stamp.
 *
 * @returns the builds, or why they could not be placed yet
 */
function useRunning(): RunningReading {
  const build = useLive({
    everyMs: BUILD_POLL_MS,
    read: (payload) => readConsoleBuildReport({ payload }),
    slug: "build",
  });
  const shell = useShellBuild({ everyMs: BUILD_POLL_MS });
  if (build.phase === "loading") {
    return { kind: "reading" };
  }
  if (build.phase === "not-measured") {
    return { kind: "not-read", why: `the build reading did not read: ${build.why}` };
  }
  return {
    builds: { loadedSha: LOADED_BUILD.sha, report: build.value, shell },
    kind: "read",
    staleWhy: build.stale?.why,
  };
}

/**
 * The page body.
 *
 * @returns the tile holding every steer
 */
export function Steers(): ReactElement {
  const state = useLive({ read: readSteers, slug: "steers" });
  const running = useRunning();
  return (
    <Tile state={state} title="Your steers">
      {(view) => (
        <>
          <Stats running={running} view={view} />
          <Problems view={view} />
          <SteersChart
            chart={steersChart({ observedAtIso: view.observedAtIso, steers: view.steers, timeZone: ownerZone() })}
          />
          <SteerList running={running} view={view} />
        </>
      )}
    </Tile>
  );
}
