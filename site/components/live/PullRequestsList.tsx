/**
 * The pull request cards' plane under the state the selector is on, and the fold at the page's foot holding GitHub's
 * count and the pull requests the list leaves out.
 */
import { type ReactElement } from "react";

import { prCardKeyOf } from "../../lib/prCardKey";
import { ownerWordOn } from "../../lib/prNeedsOwner";
import { type PrView } from "../../lib/prViews";
import { censusFindingsOf } from "../../lib/pullRequestCensus";
import { type EmptyLatest, pullRequestEmptyDrawOf } from "../../lib/pullRequestEmptyDraw";
import type { PullRequestPopulation } from "../../lib/pullRequestPopulation";
import { pullRequestsForVoice, type StaleReadingForVoice } from "../../lib/pullRequestsVoice";
import { prPlacement } from "../../lib/registerPlacementDirect";
import type { SlackPeople } from "../../lib/slackPeople";
import { cn } from "../../lib/utils";
import { contextTally } from "../../lib/workspacePlacementContext";
import { About } from "../console/About";
import { useWorkspacePlacer } from "../console/organisationState";
import { PageEmpty } from "../console/PageEmpty";
import { PlainWhy } from "../console/RawFold";
import { FindingsNote, HiddenNote, useWorkContext } from "../console/workContextState";
import { usePageReading } from "../voice/voiceContext";
import { CensusHeadline, NotPlaced } from "./PrCensus";
import { joinedOf, type ReviewContext } from "./PullRequestsFold";
import { type People, PrRow } from "./PullRequestsRow";
import { ROW_DETAIL } from "./Row";
import { type Landing, type LandingReading, type LandingRow } from "./readLanding";
import { type Reviewers } from "./readReviewers";
import { type Watchers } from "./readWatchers";
import { type LiveState } from "./useLive";

/**
 * The Queue's glass plane the cards sit on, with an inset so a card's tag is not flush to its border and no rule
 * under the last card.
 */
export const PLANE =
  "sw-glass-plane overflow-hidden rounded-[14px] border border-solid px-[1rem] [&>details:last-child]:border-b-0";

/** The explanation inside the cards' plane when a state holds none the reading can prove, the way the Queue says it. */
const EMPTY = "m-0 py-[0.9rem] text-[0.82rem] text-muted-foreground";

/** A paragraph in the fold at the foot of the page. */
const FOLD_NOTE = "mx-[0.2rem] mt-[0.6rem] mb-0 text-[0.78rem] text-muted-foreground [&_b]:font-semibold";

/**
 * The names the landing reading resolved, with the reviewer reading's beside them — a suggested reviewer is
 * often somebody this reading's asks never named.
 *
 * @returns the merged roster, the landing reading's name winning a tie
 */
export function peopleOf({ landing, reviewers }: { landing: Landing; reviewers: Reviewers | undefined }): SlackPeople {
  if (reviewers === undefined) {
    return landing.people;
  }
  return new Map([...reviewers.people, ...landing.people]);
}

/**
 * The cards under the state the selector is on, straight after the bar, and ONE fold at the page's foot holding
 * GitHub's count and what the list leaves out — the Queue's arrangement.
 *
 * The cards are the population the sidebar badge counts (`pullRequestPopulation.ts`); GitHub's own count of the owner's open
 * pull requests in this workspace is that population's witness, and it and every one of those no card carries live in
 * the fold, named. A state holding no card says why when the reading cannot prove there is none, and draws the
 * designed empty state only when it can. The fold holds data only, never how the page was read.
 *
 * @param population the rows the work context shows, before the state narrows them, with GitHub's count of them
 * @param latest whether the readings the state stands on answered their latest read, the only readings a designed
 *   empty state may stand on
 * @param viewed the cards the state holds, in draw order
 * @param view the state the selector is on, with its words and count
 * @param onOpen what a card's open button does
 * @returns the cards and the fold
 */
export function PrList({
  reading,
  population,
  latest,
  fold,
  people,
  viewed,
  view,
  review,
  opened,
  onOpen,
  stale,
}: {
  reading: LandingReading;
  population: PullRequestPopulation;
  latest: EmptyLatest;
  stale: { readonly why: string; readonly readingFromIso: string } | undefined;
  fold: LiveState<Watchers>;
  people: People;
  viewed: readonly LandingRow[];
  view: { readonly key: PrView; readonly label: string; readonly count: number | undefined };
  review: ReviewContext;
  opened: LandingRow | undefined;
  onOpen: (row: LandingRow) => void;
}): ReactElement {
  const { landing } = reading;
  const { context } = useWorkContext();
  const placer = useWorkspacePlacer();
  const placements = landing.rows.map((row) => prPlacement({ placer, row }));
  const inContext = population.rows;
  const census = population.picture;
  // A census-only pull request in a repository no workspace owns is a finding too, placed by the default rule and counted where it is drawn.
  const censusFindings = censusFindingsOf({ picture: census, placer });
  const tally = contextTally({ context, placements: [...placements, ...censusFindings] });
  const slackPeople = peopleOf({ landing, reviewers: review.reviewers });
  const hidden = landing.rows.length - inContext.length;
  // The verb's own rule for ready (every test passed, `src/review/landing.ts`), over this context's rows only.
  const readyHere = inContext.filter((row) => row.tests.every((test) => test.verdict === "pass")).length;
  // What the console voice reads when the owner asks about this page: the verb's tally, the state on screen with the count
  // the selector prints, the PR the owner has open, and every card drawn here in draw order.
  // A row whose key would name another pull request names no open card, rather than that other one (`prCardKeyOf`).
  let openKey: string | undefined;
  if (opened !== undefined) {
    openKey = prCardKeyOf({ number: opened.number, repoSlug: opened.repoSlug });
  }
  // Every reading drawn over a failed read, so the voice never passes one off as current.
  const staleReadings: StaleReadingForVoice[] = [];
  if (stale !== undefined) {
    staleReadings.push({ reading: "your pull requests", ...stale });
  }
  if (review.stale !== undefined) {
    staleReadings.push({
      reading: "the reviewer suggestions",
      readingFromIso: review.stale.observedAtIso,
      why: review.stale.why,
    });
  }
  usePageReading({
    open: openKey,
    openTitle: opened?.title,
    shows: pullRequestsForVoice({
      census,
      hiddenByContext: hidden,
      landing,
      open: opened,
      placer,
      readyHere,
      reviewers: review.reviewers,
      rows: viewed,
      stale: staleReadings,
      view,
    }),
  });
  // A state the reading cannot prove empty — drafts left out, rows GitHub's list does not reconcile with, a read that
  // failed or is being taken again — explains itself rather than drawing a zero over pull requests that may exist.
  const draw = pullRequestEmptyDrawOf({ latest, population, view, viewedCount: viewed.length });
  let empty: ReactElement | null = null;
  if (draw.kind === "explanation") {
    empty = (
      <div className={EMPTY} data-page-empty="pull-requests-unproven">
        <p className="m-0 font-medium text-foreground">{draw.title}</p>
        {draw.detail === undefined ? null : <p className="mt-1 mb-0">{draw.detail}</p>}
        {/* Each read reason said plainly, its raw message folded beneath it: a block, since a `<p>` cannot hold the fold (steer 7). */}
        {draw.quoted.map((reason, at) => (
          <div className="mt-1" key={`${String(at)}:${reason.lead}`}>
            <PlainWhy lead={reason.lead} why={reason.why} />
          </div>
        ))}
      </div>
    );
  }
  if (draw.kind === "designed") {
    empty = (
      <PageEmpty title={draw.title} appearsWhen={draw.appearsWhen} action={{ kind: "plans" }} surface="pull-requests" />
    );
  }
  return (
    <>
      <div className={PLANE}>
        {empty}
        {viewed.map((row) => (
          <PrRow
            key={`${row.repoSlug}#${String(row.number)}`}
            row={row}
            needsOwner={ownerWordOn({ picked: joinedOf({ review, row })?.picked, row }) !== undefined}
            fold={fold}
            people={people}
            slackPeople={slackPeople}
            review={review}
            onOpen={onOpen}
          />
        ))}
      </div>
      <About label="GitHub's count, and the pull requests this list leaves out" className="mt-[1.4rem]">
        <CensusHeadline picture={census} ready={readyHere} />
        <NotPlaced picture={census} />
        <HiddenNote hidden={hidden} one="pull request" what="pull requests" />
        <FindingsNote tally={tally} />
        {landing.residue.length > 0 && (
          <>
            <p className={FOLD_NOTE}>
              <b>{String(landing.residue.length)}</b> thing(s) the verb could not decide, in its own words:
            </p>
            <ul className={cn(ROW_DETAIL, "text-[0.78rem] text-muted-foreground")}>
              {landing.residue.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </>
        )}
      </About>
    </>
  );
}
