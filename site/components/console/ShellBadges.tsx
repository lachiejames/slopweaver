/** Each counted sidebar entry's badge, off the live reading its page draws from. */
import { type ReactElement, Suspense, useEffect, useState } from "react";

import { readerTimeZone } from "../../lib/dateTimeFormat";
import { landingNotRecordedWhyOf, landingRefreshPlanOf } from "../../lib/landingAutoRefresh";
import { noPlanConnectedOf } from "../../lib/pageEmpty";
import { landingLatestOf, pullRequestCountOf } from "../../lib/pullRequestEmptyDraw";
import { badgeRedrawAtOf, pullRequestPopulationOf } from "../../lib/pullRequestPopulation";
import type { TagSelection } from "../../lib/queueTags";
import { clockWords } from "../../lib/runTimeline";
import {
  automationsReadingOf,
  type CountedEntry,
  unfinishedWorkstreamsReadingOf,
  workingSessionsCountOf,
} from "../../lib/sidebarCounts";
import { readWorkstreamsReading, type WorkstreamsReading } from "../../lib/workstreamsReading";
import { readAutomations } from "../live/readAutomations";
import { isReadingNotRecorded, type RecordedReading } from "../live/reading";
import { readSeatsReading, type Seats } from "../live/readNow";
import { type PlanLimitsView, readPlanLimits } from "../live/readPlanLimits";
import { useLive } from "../live/useLive";
import { useSharedAlignmentWaiting } from "./alignmentWaitingShared";
import { useWorkspacePlacer } from "./organisationState";
import { useQueueTags } from "./queueTagState";
import { CountStandIn, LiveCountBadge, ReadingCountBadge, SideCount, WithheldCount } from "./ShellCount";
import { useShellLandingRefresh } from "./shellLanding";
import { alignmentNextWords } from "./useAlignmentAutoRefresh";
import { queueShownOf, useQueueRows } from "./useQueueRows";
import { useWorkContext } from "./workContextState";

/** How often a sidebar-only count reads; a page open beside it that polls faster governs (`useLive`'s shortest wins). */
const SIDEBAR_POLL_MS = 60_000;

/**
 * The Workstreams badge: the unfinished workstreams in the context shown.
 *
 * @returns the pill
 */
function WorkstreamsBadge({ attention }: { attention: boolean }): ReactElement {
  const { context } = useWorkContext();
  const state = useLive<WorkstreamsReading>({
    everyMs: SIDEBAR_POLL_MS,
    read: (payload) => readWorkstreamsReading({ payload }),
    slug: "workstreams",
  });
  return (
    <LiveCountBadge
      attention={attention}
      state={state}
      measure={(reading) => unfinishedWorkstreamsReadingOf({ context, reading })}
    />
  );
}

/**
 * The Automations badge: the automations switched on.
 *
 * @returns the pill
 */
function AutomationsBadge({ attention }: { attention: boolean }): ReactElement {
  const state = useLive({ everyMs: SIDEBAR_POLL_MS, read: readAutomations, slug: "automations" });
  return <LiveCountBadge attention={attention} state={state} measure={(view) => automationsReadingOf({ view })} />;
}

/**
 * The Fleet badge: the sessions working now, the number the Fleet page's glance prints off the live seats. Like the
 * Pull requests badge it reads the live channel: a page opened on a `?fixture=` capture freezes only itself, never
 * the sidebar.
 *
 * @returns the pill
 */
function FleetBadge({ attention }: { attention: boolean }): ReactElement {
  const state = useLive<RecordedReading<Seats>>({
    everyMs: SIDEBAR_POLL_MS,
    read: readSeatsReading,
    slug: "watch-reading",
  });
  // No session check recorded yet is an answer: nothing is known to be working, so a measured zero saying why.
  return (
    <LiveCountBadge
      attention={attention}
      state={state}
      measure={(reading) => {
        if (isReadingNotRecorded(reading)) {
          return {
            count: { count: 0, title: "the supervisor has not recorded session activity yet" },
            phase: "measured",
          };
        }
        return { count: workingSessionsCountOf({ seats: reading.value.rows }), phase: "measured" };
      }}
    />
  );
}

/**
 * Whether the plans reading the sidebar polls shows no plan connected: `true` only off a current reading holding none,
 * `undefined` while it cannot tell (`noPlanConnectedOf`).
 *
 * @returns the verdict
 */
export function useNoPlanConnected(): boolean | undefined {
  const plans = useLive<PlanLimitsView>({ everyMs: SIDEBAR_POLL_MS, read: readPlanLimits, slug: "plans" });
  return noPlanConnectedOf({ plans });
}

/**
 * The dot on the sidebar's Settings entry while no plan is connected — the way an install with nothing to run on finds
 * Settings → Models. Drawn only off a current `plans list --json` reading that holds no plan (`noPlanConnectedOf`), so
 * a reading that cannot tell never claims a plan is missing. Polled on the sidebar's cadence; the Models section re-reads
 * the list the moment a Connect lands.
 *
 * @returns the dot, or nothing
 */
export function NoPlanDot({ noPlanConnected }: { noPlanConnected: boolean | undefined }): ReactElement | null {
  if (noPlanConnected !== true) {
    return null;
  }
  return (
    <span
      className="ml-auto size-2 shrink-0 rounded-full bg-[oklch(0.72_0.12_190)]"
      data-no-plan-dot=""
      title="No plan is connected yet: Settings → Models connects one"
    >
      <span className="sr-only">no plan connected</span>
    </span>
  );
}

/**
 * The Alignment badge: the number that page's head prints, off the console's one instance of the same hook
 * (`./alignmentWaitingShared.tsx`), so the two cannot disagree. A number counted off a handed-over reading prints at
 * once with its mark beside it, as the head draws it.
 *
 * @returns the pill
 */
function AlignmentBadge({ attention }: { attention: boolean }): ReactElement {
  const { waiting, recovery } = useSharedAlignmentWaiting();
  // What the console does about a failed read comes off the shell's one recovery runner, never the reading's age.
  return <ReadingCountBadge attention={attention} next={alignmentNextWords({ recovery })} reading={waiting} />;
}

/**
 * The badge a counted entry carries — one per key, so a counted entry with no badge to draw does not compile.
 *
 * @returns the pill
 */
export function EntryBadge({ entry }: { entry: CountedEntry }): ReactElement {
  const { attention } = entry.badge;
  switch (entry.key) {
    case "queue": {
      return <QueueBadge attention={attention} />;
    }
    case "alignment": {
      return <AlignmentBadge attention={attention} />;
    }
    case "pull-requests": {
      return <PullRequestsBadge attention={attention} />;
    }
    case "workstreams": {
      return <WorkstreamsBadge attention={attention} />;
    }
    case "automations": {
      return <AutomationsBadge attention={attention} />;
    }
    case "fleet": {
      return <FleetBadge attention={attention} />;
    }
    default: {
      const exhausted: never = entry;
      return exhausted;
    }
  }
}

/**
 * The Queue's badge: the SAME number the queue page's header prints, from the same rows.
 *
 * A badge counting only two of five registers disagrees with the header (a chip of 0 against 301 pending and 613
 * unsteered), and a definition kept in a `title` is invisible. A number and its definition ship together in text a
 * reader can see, or the number does not ship.
 *
 * It costs one extra read per console SESSION, not per page: `useLive`'s channels are module-scoped and a
 * new subscriber is handed the last arrival at once (`components/live/useLiveChannels.ts` § Channel), so the board
 * and the ledger are fetched once for the whole SPA however many pages subscribe. If that ever becomes
 * per-component, every page starts paying a board read measured at 33 seconds — check there before
 * changing it.
 *
 * @returns the pill
 */
function QueueBadge({ attention }: { attention: boolean }): ReactElement {
  // The tag selection is read from the address, and the shell sits in the layout, above any page's Suspense
  // boundary — so the read gets its own. Until the address is known the badge prints nothing: an unfiltered count
  // beside a filtered Queue would be a number measured over the wrong list.
  return (
    <Suspense fallback={null}>
      <TaggedQueueBadge attention={attention} />
    </Suspense>
  );
}

/**
 * The badge under the Queue's tag selection. On the Queue a tag filter narrows the page, and the badge beside it
 * counts what the page counts; anywhere else the address carries no selection and this is every row in the context.
 *
 * @returns the pill
 */
function TaggedQueueBadge({ attention }: { attention: boolean }): ReactElement {
  const { selection } = useQueueTags();
  return <QueueBadgeCount attention={attention} selection={selection} />;
}

/**
 * The badge's number for one tag selection.
 *
 * @param selection the Queue's tag filter, empty off the Queue
 * @returns the pill
 */
function QueueBadgeCount({ selection, attention }: { selection: TagSelection; attention: boolean }): ReactElement {
  const reading = useQueueRows();
  const { hands, board, drafts, posts, landing, missing } = reading;
  const filtered = selection.groups.length > 0;
  const unread = [hands, board, drafts, posts, landing].find((state) => state.phase !== "ready");
  if (unread !== undefined) {
    // A register it counts has not arrived, so it prints no number — `Badge` refuses a zero it has not
    // measured, and this badge owes the same refusal.
    return <CountStandIn state={unread} />;
  }
  if (missing.length > 0) {
    // The header refuses its count while anything it folds is unread, spoken steers included; so does this.
    return <CountStandIn state={{ phase: "not-measured", why: `not current: ${missing.join(", ")}` }} />;
  }
  // Every register read and nothing missing, so the shared count prints a number: the one the voice is checked against.
  const n = queueShownOf({ reading, scope: { selection, view: "all" } }).waiting!;
  const title =
    "waiting on your word: your hands, recorded asks, held replies, drafts under your own name and pull requests on your judgment";
  return (
    <SideCount
      attention={attention}
      n={n}
      title={filtered ? `${title} (only those matching the Queue's tag filter)` : title}
    />
  );
}

/**
 * The Pull requests badge: the number of cards that page lists under Everything — the landing reading's rows in this
 * context, drafts included — through the page's own population function and its one count rule
 * (`pullRequestCountOf`), so the badge and the list are ONE population and print a number on the same grounds (a badge
 * and a list counting two different things is a defect, and drafts count). No number over a reading kept over a failed read, handed over while it is read again, or whose replacement
 * the console's own refresh just failed to take (`landingLatestOf`), nor while the
 * population cannot be counted: a reading taken without drafts, one whose rows GitHub's own open list does not
 * reconcile with, or one past the landing cadence, aged against this render's clock; while the shell's own refresh is
 * taking the reading that repairs it, the spinner. It reads the live channel: a page opened on a `?fixture=` capture freezes only itself, never the sidebar.
 * One display-only timer draws it again at the cadence (`badgeRedrawAtOf`), so its number goes at the same instant
 * the page's does; that timer only moves this badge's clock and never asks for a reading.
 *
 * @returns the pill
 */
function PullRequestsBadge({ attention }: { attention: boolean }): ReactElement {
  const { context } = useWorkContext();
  const placer = useWorkspacePlacer();
  const { state: landing, sync, visible, nextAtMs } = useShellLandingRefresh({ who: "the Pull requests badge" });
  // Display only: the deadline re-render sets this clock and nothing else; the shell's run decision never reads it.
  const [clockMs, setClockMs] = useState(() => Date.now());
  let redrawAtMs: number | undefined;
  if (landing.phase === "ready") {
    redrawAtMs = badgeRedrawAtOf({ context, nowMs: clockMs, placer, reading: landing.value });
  }
  useEffect(() => {
    if (redrawAtMs === undefined) {
      return;
    }
    const timer = setTimeout(
      () => {
        setClockMs(Date.now());
      },
      Math.max(0, redrawAtMs - Date.now()),
    );
    return () => {
      clearTimeout(timer);
    };
  }, [redrawAtMs]);
  // No reading to show while the shell's own run is establishing one is a run in flight, not a failure.
  if (landing.phase === "not-measured" && sync.phase === "taking") {
    return <CountStandIn state={{ phase: "loading" }} />;
  }
  // oxlint-disable-next-line react/purity -- the clock IS the input: a render that shows the count must read the time it shows it at
  const renderedAtMs = Date.now();
  let nextAtWords: string | undefined;
  if (nextAtMs !== undefined) {
    nextAtWords = clockWords({
      iso: new Date(nextAtMs).toISOString(),
      nowIso: new Date(renderedAtMs).toISOString(),
      timeZone: readerTimeZone(),
    });
  }
  // None recorded yet is an absence, withheld with what the shell does next — never "could not be read".
  const notRecorded = landingNotRecordedWhyOf({ state: landing, sync });
  if (notRecorded !== undefined) {
    return <WithheldCount next={landingRefreshPlanOf({ nextAtWords, sync, visible })} reason={notRecorded} />;
  }
  // A reading kept over a failed read draws the stale mark with its stamp, never a number (`countStandInOf`).
  if (landing.phase !== "ready" || landing.stale !== undefined) {
    return <CountStandIn state={landing} />;
  }
  const population = pullRequestPopulationOf({
    context,
    nowMs: Math.max(clockMs, renderedAtMs),
    placer,
    reading: landing.value,
  });
  const counted = pullRequestCountOf({ latest: landingLatestOf({ state: landing, sync }), population });
  if (counted.phase === "withheld" && (sync.phase === "taking" || landing.refreshing === true)) {
    return <CountStandIn state={{ phase: "loading" }} />;
  }
  if (counted.phase === "withheld") {
    // Nothing failed unless a quoted read says so: the count is held back, said as such with what the shell's runner
    // is really doing next — never "could not be read", never a promise an age cannot back.
    return <WithheldCount next={landingRefreshPlanOf({ nextAtWords, sync, visible })} reason={counted.why} />;
  }
  return <SideCount attention={attention} n={counted.count.count} title={counted.count.title} />;
}
