"use client";

import { useSearchParams } from "next/navigation";
import { type ReactElement, type ReactNode, Suspense, useEffect, useState } from "react";

import { ageOf } from "../../lib/ageOf";
import { countAgedFromOf, LANDING_CADENCE_MINUTES } from "../../lib/landingFreshness";
import { type PrReadingState, prFreshnessLine } from "../../lib/prFreshness";
import {
  PR_VIEW_PARAM,
  PR_VIEWS,
  type PrView,
  prKeyOf,
  prRowsForView,
  prViewCounts,
  prViewLabel,
  prViewOf,
  prViewReadsPicks,
  withPrView,
} from "../../lib/prViews";
import { emptyLatestOf, landingLatestOf, pullRequestCountOf } from "../../lib/pullRequestEmptyDraw";
import { type PullRequestPopulation, pullRequestPopulationOf } from "../../lib/pullRequestPopulation";
import { cn } from "../../lib/utils";
import { useWorkspacePlacer } from "../console/organisationState";
import { PAGE_BODY } from "../console/PageHead";
import { FreshnessMark } from "../console/QueueViewBar";
import { ReadingIndicator } from "../console/ReadingIndicator";
import { useShellLandingRefresh } from "../console/shellLanding";
import { ViewSelector } from "../console/ViewSelector";
import { useWorkContext } from "../console/workContextState";
import { PageVoice } from "../voice/PageVoice";
import { type SyncState } from "./LandingSync";
import { ReadStandIn, StaleReadings } from "./LiveMarks";
import { type ReviewContext } from "./PullRequestsFold";
import { PLANE, PrList, peopleOf } from "./PullRequestsList";
import { linkedPullKeyOf, type OpenedPullRequest, openedRowOf, openParamOf, prioritiesOf } from "./PullRequestsOpen";
import { type People } from "./PullRequestsRow";
import { PrSlideOver } from "./PullRequestsSlideOver";
import { type Board, readBoard } from "./read";
import { type Agents, readAgents } from "./readAgents";
import { type LandingReading, type LandingRow, readLandingReading } from "./readLanding";
import { type Avatars, type DepthRow, readAvatars, readDepth } from "./readPeople";
import { type Reviewers, readReviewers } from "./readReviewers";
import { readWatchers, type Watchers } from "./readWatchers";
import { readyValueOf, useLive } from "./useLive";

/**
 * The page body, once the search params are known: the Queue's shape — the page's voice, one state selector with
 * how current the cards are beside it, then straight into the cards.
 *
 * `?view=<state>` is the selector, written with `replaceState` the way the Queue writes its own, so a reload or a
 * shared link lands on the same state; Everything is the default and drops the parameter. `?fixture=<name>` makes
 * the route serve a frozen reading, and the freshness line says FIXTURE where an age would go.
 *
 * There is no button: the console takes a fresh reading ITSELF — the shell, on every page, when the one shown cannot
 * give GitHub's open count or cannot be counted as the owner's whole population; THIS page, on its own clock and only while
 * it is mounted, when the one shown comes due against the landing cadence. `landingFreshness.ts` is the whole rule,
 * the shell's one runner (`../console/useLandingAutoRefresh.ts`) takes both, the route allows one automatic run per
 * reading per backoff — and this page says "updating…" while it does, "failed to sync" with the reason on hover when
 * it could not, so it is always up to date.
 *
 * Live, the page draws the SHELL's landing reading, the very state the sidebar badge counts, through the same
 * population function and count rule (`pullRequestPopulation.ts`), so the badge and Everything are one number. A `?fixture=` page
 * draws its frozen reading while the sidebar stays live, as every fixture page does: that divergence is the fixture's.
 *
 * @returns the page
 */
function PullRequestsBody(): ReactElement {
  const params = useSearchParams();
  const fixtureParam = params.get("fixture");
  let fixture: string | undefined;
  if (fixtureParam !== null) {
    fixture = fixtureParam;
  }
  const view = prViewOf({ value: params.get(PR_VIEW_PARAM) });
  const choose = (next: PrView): void => {
    const search = withPrView({ search: window.location.search, view: next });
    window.history.replaceState(null, "", `${window.location.pathname}${search}${window.location.hash}`);
  };
  // The panel holds a repository and NUMBER, never a row: the row is looked up in the current reading on every
  // render, so an open panel follows a fresh reading instead of showing the instant it was opened at, and two
  // repositories' pull requests of one number stay two panels. `?open=<n>&repo=<owner/repo>` is the deep link, and how the panel is
  // screenshotted.
  const linked = openParamOf({ params });
  const linkedKey = linkedPullKeyOf({ linked });
  const [openedPull, setOpenedPull] = useState<OpenedPullRequest | undefined>(linked);
  // The shell navigates in place, so a second deep link reaches this page still mounted: reopen on the pull request
  // the address now names, during render, rather than keep the one it arrived on.
  const [linkedSeen, setLinkedSeen] = useState(linkedKey);
  if (linkedSeen !== linkedKey) {
    setLinkedSeen(linkedKey);
    setOpenedPull(linked);
  }
  const shell = useShellLandingRefresh({ who: "the Pull requests page" });
  // Unconditional, as a hook must be; live it joins the shell's own channel, so it costs no second read.
  const fixtureState = useLive<LandingReading>({ fixture, read: readLandingReading, slug: "landing-reading" });
  let state = shell.state;
  let sync: SyncState = shell.sync;
  if (fixture !== undefined) {
    state = fixtureState;
    sync = { phase: "idle" };
  }
  // A DISPLAY clock: the minute tick ages the line beside the selector. It asks for nothing — the shell owns the
  // landing reading's freshness on every page (`useLandingAutoRefresh`), this page included.
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const tick = setInterval(() => {
      setNowMs(Date.now());
    }, 60_000);
    return () => {
      clearInterval(tick);
    };
  }, []);
  const shown = readyValueOf({ state });
  let agedFromIso: string | undefined;
  if (shown !== undefined) {
    agedFromIso = countAgedFromOf({ census: shown.landing.census, observedAtIso: shown.observedAtIso });
  }
  // The minute tick is coarse, so the count passing the cadence gets a timer of its own: the count is withdrawn AT the
  // cadence, not up to a minute after. A deadline already behind the reading when it arrives fires at once.
  useEffect(() => {
    if (agedFromIso === undefined) {
      return;
    }
    const cutoffMs = Date.parse(agedFromIso) + LANDING_CADENCE_MINUTES * 60_000 + 1;
    const waitMs = (): number => Math.max(0, cutoffMs - Date.now());
    const timer = setTimeout(() => {
      setNowMs(Date.now());
    }, waitMs());
    return () => {
      clearTimeout(timer);
    };
  }, [agedFromIso]);
  const fold = useLive<Watchers>({ fixture, read: readWatchers, slug: "watchers" });
  const reviewerState = useLive<Reviewers>({ fixture, read: readReviewers, slug: "reviewers" });
  let reviewersStale: ReviewContext["stale"];
  if (reviewerState.phase === "ready" && reviewerState.stale !== undefined) {
    reviewersStale = { observedAtIso: reviewerState.observedAtIso, why: reviewerState.stale.why };
  }
  const review: ReviewContext = {
    fixture,
    reviewers: readyValueOf({ state: reviewerState }),
    stale: reviewersStale,
  };
  const people: People = {
    avatars: useLive<Avatars>({ fixture, read: readAvatars, slug: "avatars" }),
    depth: useLive<readonly DepthRow[]>({ fixture, read: readDepth, slug: "depth" }),
    sessions: useLive<Agents>({ fixture, read: readAgents, slug: "sessions" }),
  };
  const { context, shows: showsHere } = useWorkContext();
  const placer = useWorkspacePlacer();
  const opened = openedRowOf({ opened: openedPull, placer, shows: showsHere, state });
  const board = useLive<Board>({ fixture, read: readBoard, slug: "board" });
  // The cards this workspace shows, the counts the selector prints over them, and the ones the state holds, ordered
  // by the board's priority band before the verb's act.
  let readingState: PrReadingState = { phase: "loading" };
  let population: PullRequestPopulation | undefined;
  let staleCards: { readonly why: string; readonly readingFromIso: string } | undefined;
  let views: readonly { readonly view: PrView; readonly label: string; readonly count: number | undefined }[] =
    PR_VIEWS.map((each) => ({ ...each, count: undefined }));
  // A pick supersedes the verb's wait on the card, so the states read it too (`prViews.ts`).
  const picked = new Set<string>();
  if (review.reviewers !== undefined) {
    for (const each of review.reviewers.rows) {
      if (each.picked !== undefined) {
        picked.add(prKeyOf({ row: each }));
      }
    }
  }
  if (state.phase === "not-measured") {
    readingState = { phase: "not-measured", why: state.why };
  }
  if (shown !== undefined) {
    readingState = {
      by: shown.by,
      fixture: fixture !== undefined,
      observedAtIso: shown.observedAtIso,
      phase: "ready",
    };
    // The cards stay drawn over a failed read of the ledger, marked stale (`../../lib/liveState.ts`).
    if (state.phase === "ready" && state.stale !== undefined) {
      readingState = { ...readingState, stale: state.stale.why };
      staleCards = { readingFromIso: state.observedAtIso, why: state.stale.why };
    }
    // Aged against this render's own clock as well as the page's: the page's clock only advances when a timer runs,
    // and a render committed before the deadline timer gets the thread would otherwise count past the cadence.
    // oxlint-disable-next-line react/purity -- the clock IS the input: a render that shows the count must read the time it shows it at
    const renderedAtMs = Date.now();
    population = pullRequestPopulationOf({ context, nowMs: Math.max(nowMs, renderedAtMs), placer, reading: shown });
    // The badge's own rule (`pullRequestCountOf` over `landingLatestOf`): a reading kept over a failed read, handed over
    // while it is read again, or whose replacement the console's refresh failed to take prints no count here either.
    const counted = pullRequestCountOf({ latest: landingLatestOf({ state, sync }), population });
    views = prViewCounts({ measured: counted.phase === "counted", picked, rows: population.rows });
  }
  let inContext: readonly LandingRow[] = [];
  if (population !== undefined) {
    inContext = population.rows;
  }
  const viewed = prRowsForView({
    picked,
    priorities: prioritiesOf({ board: readyValueOf({ state: board }) }),
    rows: inContext,
    view,
  });
  // A state that reads the owner's reviewer picks is proven empty only while the reviewer reading behind them is current too.
  let latest = landingLatestOf({ state, sync });
  if (latest.phase === "current" && prViewReadsPicks({ view })) {
    latest = emptyLatestOf({ state: reviewerState, subject: "your reviewer picks" });
  }
  const current = views.find((each) => each.view === view)!;
  const freshness = prFreshnessLine({
    age: (iso) => ageOf({ iso }),
    nowMs,
    reading: readingState,
    sync,
  });
  return (
    <>
      <PageVoice title="Pull requests" />
      <div className={cn(PAGE_BODY, "pt-4")}>
        <div className="mb-[0.7rem] flex flex-wrap items-center gap-[0.5rem]">
          <ViewSelector views={views} view={view} choose={choose} listLabel="What to show" />
          <FreshnessMark line={freshness} />
          <StaleReadings
            readings={[
              { state: fold, subject: "the watchers each card's watch badge is read from" },
              { state: people.depth, subject: "the seats each card's seat is read from" },
              { state: people.sessions, subject: "the open sessions each card's seat is joined to" },
              { state: people.avatars, subject: "the people's pictures" },
              { state: board, subject: "the board priorities the cards are ordered by" },
            ]}
          />
        </div>
        {state.phase !== "ready" && (
          <div className={PLANE}>
            <ReadStandIn state={state} subject="your pull requests" block />
          </div>
        )}
        {shown !== undefined && population !== undefined && (
          <PrList
            reading={shown}
            population={population}
            latest={latest}
            stale={staleCards}
            fold={fold}
            people={people}
            viewed={viewed}
            view={{ count: current.count, key: view, label: prViewLabel({ view }) }}
            review={review}
            opened={opened}
            onOpen={(row) => {
              setOpenedPull({ number: row.number, repoSlug: row.repoSlug });
            }}
          />
        )}
      </div>
      {opened !== undefined && state.phase === "ready" && (
        <PrSlideOver
          row={opened}
          fold={fold}
          slackPeople={peopleOf({ landing: state.value.landing, reviewers: review.reviewers })}
          review={review}
          onClose={() => {
            setOpenedPull(undefined);
          }}
        />
      )}
    </>
  );
}

/**
 * Pull requests: the owner's open pull requests in this workspace from the last recorded `github landing` reading, one card
 * each under the state the selector is on, highest board priority first — the console's own invocations take every
 * open one of the owner's on both repositories, and the page never claims more than the document it shows.
 *
 * `useSearchParams` needs a Suspense boundary under Next's app router, which is the only reason this
 * wrapper exists.
 *
 * @returns the page
 */
export function PullRequests(): ReactElement {
  const fallback: ReactNode = <ReadingIndicator label="Reading your pull requests" block />;
  return (
    <Suspense fallback={fallback}>
      <PullRequestsBody />
    </Suspense>
  );
}
