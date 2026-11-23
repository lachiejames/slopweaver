/**
 * One pull request row: its watch from the checks-read register (the watched cell and the fold's watch lines), the
 * readings its seat comes from, the seat, and the calm line with its fold.
 */
import { type ReactElement, type ReactNode } from "react";

import { ageOf } from "../../lib/ageOf";
import { pullRequestWatchTone, toneVariant } from "../../lib/consoleTone";
import { prProvenanceOf } from "../../lib/provenance";
import { openAge, plainStateOf } from "../../lib/prPlainState";
import { prPlacement } from "../../lib/registerPlacementDirect";
import { type DrawnWait, tagOf } from "../../lib/reviewHook";
import { type Seat, seatOf, sharedChannelOf } from "../../lib/seat";
import type { SlackPeople } from "../../lib/slackPeople";
import { cn } from "../../lib/utils";
import { useWorkspacePlacer } from "../console/organisationState";
import { FindingMark } from "../console/workContextState";
import { Badge } from "../ui/badge";
import { ReadMark, ReadStandIn } from "./LiveMarks";
import { CALM_ROW, PrChips, PrLead, ROW_CHIPS, RowTag } from "./PrCard";
import { PrAskLine } from "./PrReviewHook";
import { PrSuggestChip } from "./PrSuggestion";
import { Fold, joinedOf, Line, type ReviewContext, waitOf } from "./PullRequestsFold";
import { ROW, ROW_FIELD } from "./Row";
import { type Agents } from "./readAgents";
import { type LandingRow } from "./readLanding";
import { type Avatars, avatarKey, type DepthRow } from "./readPeople";
import { type WatchEntry, type Watchers } from "./readWatchers";
import { OpenButton } from "./SlideOver";
import { type LiveState } from "./useLive";

/** What the watched cell of one row says, and the word its colour follows. */
interface WatchCell {
  readonly kind: "watched" | "stale" | "none";
  readonly text: string;
}

/** The fold's entry for one row, when the register has ever named that pull request. */
function watchEntryFor({ row, fold }: { row: LandingRow; fold: Watchers }): WatchEntry | undefined {
  return fold.entries.find((entry) => entry.repo === row.repoSlug && entry.number === row.number);
}

/** A session id as the row prints it: enough to tell two apart, short enough to sit in a cell. */
function shortSession({ session }: { session: string }): string {
  return session.slice(0, 8);
}

/**
 * The watched cell of one row, in the read fold's own words. A fold still loading or not read draws its
 * progress indicator or staleness mark in the cell instead (`./LiveMarks.tsx`), never a blank that reads as
 * "not watched". A pull request the register has never named is the verb's own absence, "never read here", not
 * this page's. STALE is the verb's judgement — past the run's own timeout with no end recorded — never an age
 * this page computed.
 *
 * @returns the cell
 */
function watchCellOf({ row, fold }: { row: LandingRow; fold: Watchers }): WatchCell {
  const entry = watchEntryFor({ fold, row });
  if (entry === undefined) {
    return { kind: "none", text: "never read here" };
  }
  const live = entry.watchers.filter((watcher) => !watcher.stale);
  const only = live.at(0);
  if (only !== undefined && live.length === 1) {
    return { kind: "watched", text: `watched by ${shortSession({ session: only.session })} (${only.mode})` };
  }
  if (live.length > 1) {
    return { kind: "watched", text: `watched by ${String(live.length)} sessions` };
  }
  if (entry.watchers.length > 0) {
    return { kind: "stale", text: `STALE watch · ${String(entry.watchers.length)} dead session(s)` };
  }
  if (entry.lastRead === undefined) {
    return { kind: "none", text: "not watched · never read" };
  }
  return { kind: "none", text: `not watched · read ${ageOf({ iso: entry.lastRead.atIso })}` };
}

/**
 * The watch lines of one row's fold: every watcher the register holds, then the last read.
 *
 * @returns the lines
 */
export function WatchFold({ row, fold }: { row: LandingRow; fold: LiveState<Watchers> }): ReactElement {
  if (fold.phase !== "ready") {
    return (
      <p className={ROW_FIELD}>
        <span>watched by</span> <ReadStandIn state={fold} subject="the watchers" />
      </p>
    );
  }
  const entry = watchEntryFor({ fold: fold.value, row });
  if (entry === undefined) {
    return (
      <>
        <Line label="watched by" value="the register has never named this pull request" />
        <ReadMark state={fold} subject="the watchers" row />
      </>
    );
  }
  let watchedBy = "nobody";
  if (entry.watchers.length > 0) {
    watchedBy = entry.watchers
      .map((watcher) => {
        let suffix = "";
        if (watcher.stale) {
          suffix = " · STALE";
        }
        return `${watcher.session} ${watcher.mode} since ${ageOf({ iso: watcher.sinceIso })} at ${watcher.headSha.slice(0, 10)}${suffix}`;
      })
      .join("; ");
  }
  let lastRead = "never";
  if (entry.lastRead !== undefined) {
    lastRead = `${ageOf({ iso: entry.lastRead.atIso })} at ${entry.lastRead.headSha.slice(0, 10)}, rollup ${entry.lastRead.rollup}`;
  }
  return (
    <>
      <Line label="watched by" value={watchedBy} />
      <Line label="checks read" value={lastRead} />
      <ReadMark state={fold} subject="the watchers" row />
    </>
  );
}

/** The three readings a row's seat and picture come from, each in whatever phase it is in. */
export interface People {
  readonly depth: LiveState<readonly DepthRow[]>;
  readonly sessions: LiveState<Agents>;
  readonly avatars: LiveState<Avatars>;
}

/**
 * Who is on one row: the watchers fold joined to the seats, else the head branch joined to the open
 * sessions, else the verb's own "blocked on" — `site/lib/seat.ts` is the rule, this is the plumbing.
 *
 * @param wait the wait the row's tag draws, so a pick that superseded a Slack sync or the channel's wait moves the
 *   seat with it
 * @returns the seat
 */
function seatFor({
  row,
  fold,
  people,
  wait,
}: {
  row: LandingRow;
  fold: LiveState<Watchers>;
  people: People;
  wait: DrawnWait | undefined;
}): Seat {
  let watchers: Watchers["entries"][number]["watchers"] | undefined;
  if (fold.phase === "ready") {
    const entry = watchEntryFor({ fold: fold.value, row });
    watchers = entry === undefined ? [] : entry.watchers;
  }
  let depth: readonly DepthRow[] | undefined;
  if (people.depth.phase === "ready") {
    depth = people.depth.value;
  }
  let sessions: Agents["rows"] | undefined;
  if (people.sessions.phase === "ready") {
    sessions = people.sessions.value.rows;
  }
  const sharedIn = sharedChannelOf({ next: wait?.next, share: row.channelShare });
  return seatOf({ blockedOn: row.blockedOn, depth, headRefName: row.headRefName, sessions, sharedIn, wait, watchers });
}

/**
 * One pull request, one calm line, the fold a click away.
 *
 * The line is the repository, the number and the title, then the state in words and how long it has been open
 *, the machine word on its hover. Every chip — provenance, state, labels, author, checks,
 * review, seat, the watched cell, the suggested reviewer — opens the fold,
 * so nothing is dropped, only deferred (rule 7). A row that needs the owner's word keeps its ask line on the line too:
 * who was asked and whether to ask again IS the act the owner takes there. The `open` button
 * raises the row's slide-over; it prevents the summary's own toggle so a press opens the panel and never also
 * unfolds the row.
 *
 * @param needsOwner whether the row is waiting on the owner's word, which draws the page's one accent
 * @param onOpen what the page does with the row a reader chose to open
 * @returns the row
 */
export function PrRow({
  row,
  needsOwner,
  fold,
  people,
  slackPeople,
  review,
  onOpen,
}: {
  row: LandingRow;
  needsOwner: boolean;
  fold: LiveState<Watchers>;
  people: People;
  slackPeople: SlackPeople;
  review: ReviewContext;
  onOpen: (row: LandingRow) => void;
}): ReactElement {
  const placer = useWorkspacePlacer();
  const wait = waitOf({ review, row, slackPeople });
  const tag = tagOf({ row, wait });
  let watch: ReactNode;
  if (fold.phase !== "ready") {
    watch = <ReadStandIn state={fold} subject="the watchers" />;
  } else {
    const cell = watchCellOf({ fold: fold.value, row });
    watch = (
      <Badge
        variant={toneVariant({ tone: pullRequestWatchTone({ watch: cell.kind }) })}
        size="sm"
        className="border-0 px-[0.45rem] text-[0.7rem] leading-[1.5] font-normal"
        title="from the checks-read register"
      >
        {cell.text}
      </Badge>
    );
  }
  const seat = seatFor({ fold, people, row, wait });
  const avatarOf = (login: string): string | undefined => {
    if (people.avatars.phase !== "ready") {
      return undefined;
    }
    return people.avatars.value.byId.get(avatarKey({ nativeId: login, source: "github" }))?.avatarUrl;
  };
  const placement = prPlacement({ placer, row });
  const provenance = prProvenanceOf({
    facts: { action: row.action, botAwaitingUs: row.codeRabbit.awaitingUs },
    placement,
  });
  return (
    <details className={cn(ROW, "[&>summary]:flex-wrap", CALM_ROW)}>
      <summary>
        <PrLead row={row} />
        <RowTag
          state={plainStateOf({ row, wait })}
          tag={tag}
          age={openAge({ createdAtIso: row.createdAtIso })}
          needsOwner={needsOwner}
        />
        <OpenButton row={row} onOpen={onOpen} />
        {needsOwner ? <PrAskLine row={row} people={slackPeople} /> : null}
      </summary>
      <div className={ROW_CHIPS}>
        <PrChips
          row={row}
          seat={seat}
          seatReads={{ depth: people.depth, sessions: people.sessions, watchers: fold }}
          avatarOf={avatarOf}
          provenance={provenance}
        />
        <FindingMark placement={placement} />
        {watch}
        {needsOwner ? null : <PrAskLine row={row} people={slackPeople} />}
        <PrSuggestChip joined={joinedOf({ review, row })} people={slackPeople} row={row} />
      </div>
      <Fold row={row} slackPeople={slackPeople} review={review} />
      <WatchFold fold={fold} row={row} />
    </details>
  );
}
