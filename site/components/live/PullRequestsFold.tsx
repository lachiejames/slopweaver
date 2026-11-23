/**
 * The reviewer reading a pull request row joins against, the row's wait, and the fold under one row.
 */
import { type ReactElement } from "react";

import { ageOf } from "../../lib/ageOf";
import { checkRequirementWord } from "../../lib/landingCi";
import { proseParts } from "../../lib/proseParts";
import { type DrawnWait, drawnWaitOf } from "../../lib/reviewHook";
import { slackAskedLine } from "../../lib/slackAskedLine";
import type { SlackPeople } from "../../lib/slackPeople";
import { cn } from "../../lib/utils";
import { PR_FOLD_INDENT } from "./PrCard";
import { PrAskTrail } from "./PrReviewHook";
import { PrSuggestion } from "./PrSuggestion";
import { ROW_DETAIL, ROW_FIELD, ROW_FOLD, ROW_NEXT } from "./Row";
import { type LandingRow } from "./readLanding";
import { type ReviewerRow, type Reviewers, reviewerRowFor } from "./readReviewers";

/** The six tests, one per line, each verdict word in the colour of what it says. */
export const TESTS =
  "mt-0 mb-[0.35rem] list-disc pl-[1.1rem] text-[0.74rem] [&_li[data-verdict=fail]_b]:text-danger [&_li[data-verdict=pass]_b]:text-success [&_li[data-verdict=unknown]_b]:text-warning";

/**
 * The reviewer reading the rows join against, and whether the page is a fixture — which turns the suggestion
 * card's presses off. `reviewers` is `undefined` until `github reviewer list` answers, and stays so on a
 * fixture page, which carries no reviewer capture. `stale` is set when the reading drawn is an earlier one kept over a
 * failed read, which holds the presses too: a pick is never recorded off a suggestion the latest read did not confirm.
 */
export interface ReviewContext {
  readonly reviewers: Reviewers | undefined;
  readonly fixture: string | undefined;
  readonly stale: { readonly why: string; readonly observedAtIso: string } | undefined;
}

/**
 * This row's join in the reviewer reading, when there is one.
 *
 * @returns the joined row
 */
export function joinedOf({ row, review }: { row: LandingRow; review: ReviewContext }): ReviewerRow | undefined {
  if (review.reviewers === undefined) {
    return undefined;
  }
  return reviewerRowFor({ number: row.number, repoSlug: row.repoSlug, reviewers: review.reviewers });
}

/**
 * The row's wait as drawn — the verb's own, or the ask a pick the owner approved since supersedes it.
 *
 * @returns the wait, or `undefined` when the row is not waiting on a human
 */
export function waitOf({
  row,
  review,
  slackPeople,
}: {
  row: LandingRow;
  review: ReviewContext;
  slackPeople: SlackPeople;
}): DrawnWait | undefined {
  return drawnWaitOf({ people: slackPeople, picked: joinedOf({ review, row })?.picked, row });
}

/**
 * The fold under one row: every fact the next act rests on, in the verb's own sentences.
 *
 * @returns the fold
 */
export function Fold({
  row,
  slackPeople,
  review,
}: {
  row: LandingRow;
  slackPeople: SlackPeople;
  review: ReviewContext;
}): ReactElement {
  const wait = waitOf({ review, row, slackPeople });
  return (
    <div className={cn(ROW_FOLD, PR_FOLD_INDENT)}>
      <p className={ROW_NEXT}>{row.actionDetail}</p>
      {wait === undefined ? null : <Line label="waiting" value={wait.sentence} />}
      <PrAskTrail row={row} people={slackPeople} />
      <PrSuggestion
        fixture={review.fixture}
        stale={review.stale}
        joined={joinedOf({ review, row })}
        people={slackPeople}
        row={row}
      />
      <Line label="dispatch" value={row.dispatchWhy} />
      <ul className={TESTS}>
        {row.tests.map((test) => (
          <li key={test.id} data-verdict={test.verdict}>
            <b>{test.verdict}</b> {test.id}: {test.why}
          </li>
        ))}
      </ul>
      {row.failingChecks.length > 0 ? (
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
      ) : null}
      <Line
        label="threads"
        value={`humans ${String(row.humans.open)} open, ${String(row.humans.awaitingUs)} awaiting us · CodeRabbit ${String(row.codeRabbit.open)} open, ${String(row.codeRabbit.awaitingUs)} awaiting us`}
      />
      <Line label="blocked on" value={row.blockedOn.length === 0 ? "nobody named" : row.blockedOn.join(", ")} />
      <Line
        label="board row"
        value={`${row.boardRowKind}${row.boardRowWhy === undefined ? "" : `: ${row.boardRowWhy}`}`}
      />
      <Line label="slack" value={slackAskedLine({ asked: row.slackAsked, why: row.slackWhy })} />
      <Line
        label="head"
        value={`${row.headRefName} @ ${row.headOid.slice(0, 10)} onto ${row.baseRefName} · updated ${ageOf({ iso: row.updatedAtIso })}`}
      />
    </div>
  );
}

/**
 * One labelled line of the fold. An absent value is drawn as the absence it is, never skipped.
 *
 * Any address the verb pasted into the value is drawn as its own short label with the URL on the link,
 * never as the raw string: four Slack permalinks printed whole is 300 unbroken characters, which is the
 * wall rule 7 refuses and the one the owner met on the queue's card (`site/lib/queueCard.ts` § Prose with
 * addresses in it).
 *
 * @returns the line
 */
export function Line({ label, value }: { label: string; value: string | undefined }): ReactElement {
  if (value === undefined) {
    return (
      <p className={ROW_FIELD}>
        <span>{label}</span> the verb did not say
      </p>
    );
  }
  return (
    <p className={ROW_FIELD}>
      <span>{label}</span>{" "}
      {proseParts({ text: value }).map((part, at) =>
        part.kind === "link" ? (
          <a key={`${String(at)}-${part.url}`} href={part.url} rel="noreferrer">
            {part.label}
          </a>
        ) : (
          <span key={`${String(at)}-text`}>{part.text}</span>
        ),
      )}
    </p>
  );
}
