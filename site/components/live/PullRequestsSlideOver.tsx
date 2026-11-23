/**
 * One pull request opened GitHub-shaped, in the read-only panel that slides over the list.
 */
import { type ReactElement, type ReactNode } from "react";

import { ageOf } from "../../lib/ageOf";
import { checkRequirementWord, landingCiWord } from "../../lib/landingCi";
import { prPlacement } from "../../lib/registerPlacementDirect";
import { tagOf } from "../../lib/reviewHook";
import { slackAskedLine } from "../../lib/slackAskedLine";
import type { SlackPeople } from "../../lib/slackPeople";
import { useWorkspacePlacer } from "../console/organisationState";
import { FindingMark } from "../console/workContextState";
import { PrAskLine, PrAskTrail } from "./PrReviewHook";
import { ActionTag } from "./PrStatus";
import { PrSuggestChip, PrSuggestion } from "./PrSuggestion";
import { joinedOf, Line, type ReviewContext, TESTS, waitOf } from "./PullRequestsFold";
import { WatchFold } from "./PullRequestsRow";
import { ROW_DETAIL, ROW_NEXT } from "./Row";
import { type LandingRow } from "./readLanding";
import { type Watchers } from "./readWatchers";
import { SLIDE_EMPTY, SLIDE_SECTION, SlideOver } from "./SlideOver";
import { type LiveState } from "./useLive";

/**
 * One pull request opened GitHub-shaped, in a panel that slides over the list and can only be read.
 *
 * This is the archive's platform-native panel kept as a detail view and nothing else (never a place to act). Every line is a field `github landing` printed for this row, grouped the way
 * GitHub itself groups them — the six tests with each verdict's why, the checks not green with their logs,
 * reviewer threads counted for CodeRabbit and humans apart, the stack position, the Slack asks, the board
 * row — plus who is watching it from the checks-read register. There is no button here that sends anything;
 * the one control closes the panel, and so does Escape.
 *
 * @param onClose what closing the panel does
 * @returns the panel
 */
export function PrSlideOver({
  row,
  fold,
  slackPeople,
  review,
  onClose,
}: {
  row: LandingRow;
  fold: LiveState<Watchers>;
  slackPeople: SlackPeople;
  review: ReviewContext;
  onClose: () => void;
}): ReactElement {
  let stack = "not stacked";
  if (row.stacked && row.stackPosition !== undefined && row.stackSize !== undefined) {
    stack = `entry ${String(row.stackPosition)} of ${String(row.stackSize)}`;
  } else if (row.stacked) {
    stack = "stacked, position not read";
  }
  const placer = useWorkspacePlacer();
  const wait = waitOf({ review, row, slackPeople });
  let checks: ReactNode = <p className={SLIDE_EMPTY}>every check GitHub reported is green</p>;
  if (row.failingChecks.length > 0) {
    checks = (
      <ul className={ROW_DETAIL}>
        {row.failingChecks.map((check) => (
          <li key={check.name}>
            {check.state} · {check.name}
            {` · ${checkRequirementWord({ required: check.required })}`}
            {check.url === undefined ? "" : " · "}
            {check.url === undefined ? null : (
              <a href={check.url} rel="noreferrer">
                log
              </a>
            )}
          </li>
        ))}
      </ul>
    );
  }
  return (
    <SlideOver
      label={`Pull request #${String(row.number)}`}
      onClose={onClose}
      tag={
        <>
          <ActionTag row={row} wait={wait} title={tagOf({ row, wait })} />
          <FindingMark placement={prPlacement({ placer, row })} />
        </>
      }
      title={
        <>
          <a href={`${row.url}/commits/${row.headOid}`} rel="noreferrer">
            #{String(row.number)}
          </a>{" "}
          {row.title}
        </>
      }
    >
      <p className={ROW_NEXT}>{row.actionDetail}</p>
      <p className="sw-tile-note">
        {row.headRefName} @ {row.headOid.slice(0, 10)} onto {row.baseRefName} · ci {landingCiWord({ row })} · updated{" "}
        {ageOf({ iso: row.updatedAtIso })} · nothing here sends; approving a reviewer parks the ask on the queue
      </p>
      <section className={SLIDE_SECTION}>
        <h4>Who was asked</h4>
        <PrAskLine row={row} people={slackPeople} />
        <PrSuggestChip joined={joinedOf({ review, row })} people={slackPeople} row={row} />
        <PrAskTrail row={row} people={slackPeople} />
        <PrSuggestion
          fixture={review.fixture}
          stale={review.stale}
          joined={joinedOf({ review, row })}
          people={slackPeople}
          row={row}
        />
      </section>
      <section className={SLIDE_SECTION}>
        <h4>The six tests</h4>
        <ul className={TESTS}>
          {row.tests.map((test) => (
            <li key={test.id} data-verdict={test.verdict}>
              <b>{test.verdict}</b> {test.id}: {test.why}
            </li>
          ))}
        </ul>
        {wait === undefined ? null : <Line label="waiting" value={wait.sentence} />}
        <Line label="dispatch" value={row.dispatchWhy} />
        <Line label="blocked on" value={row.blockedOn.length === 0 ? "nobody named" : row.blockedOn.join(", ")} />
      </section>
      <section className={SLIDE_SECTION}>
        <h4>Checks not green</h4>
        {checks}
      </section>
      <section className={SLIDE_SECTION}>
        <h4>Reviewer threads</h4>
        <Line label="humans" value={`${String(row.humans.open)} open, ${String(row.humans.awaitingUs)} awaiting us`} />
        <Line
          label="CodeRabbit"
          value={`${String(row.codeRabbit.open)} open, ${String(row.codeRabbit.awaitingUs)} awaiting us`}
        />
      </section>
      <section className={SLIDE_SECTION}>
        <h4>Stack, Slack and the board</h4>
        <Line label="stack" value={stack} />
        <Line label="slack" value={slackAskedLine({ asked: row.slackAsked, why: row.slackWhy })} />
        <Line
          label="board row"
          value={`${row.boardRowKind}${row.boardRowWhy === undefined ? "" : `: ${row.boardRowWhy}`}`}
        />
      </section>
      <section className={SLIDE_SECTION}>
        <h4>Watched</h4>
        <WatchFold fold={fold} row={row} />
      </section>
    </SlideOver>
  );
}
