"use client";

/**
 * A pull request's suggested reviewer, with the press that records the owner's approval of it — and the line a pick the owner has
 * not yet acted on in Slack shows in place of the ask.
 *
 * The suggestion is `github reviewer list`'s: who, on what evidence, in the verb's own sentence. Approving it
 * records the pick and parks the ask to that person on the owner's queue, SENDING NOTHING — the send stays the owner's yes on
 * the queue card, and the button says so. It is an act-list row (`site/lib/actVerbs.ts`), pressed through `usePress`
 * and re-reading the `reviewers` channel, so the card moves when the register does. "Not them" has no press: it
 * takes the owner's words, and the console's one text input is the call's chat, so the owner says it there.
 *
 * On a fixture the presses are off: a frozen page recording a real pick would be a write nobody meant. Over a
 * reviewer reading kept past a failed read they wait too, beside a staleness mark: the latest read did not confirm
 * the suggestion they would act on.
 */

import type { ReactElement } from "react";

import { actLineFor } from "../../lib/actVerbs";
import { ageOf } from "../../lib/ageOf";
import { APPROVE_SLUG, approveSlotsOf, tierWords } from "../../lib/reviewerPick";
import { suggestionHeld } from "../../lib/reviewHook";
import { personLabel, type SlackPeople } from "../../lib/slackPeople";
import { BUTTON, BUTTON_PRIMARY } from "../console/controls";
import { Outcome, usePress } from "../console/press";
import { StaleMark } from "../console/StaleMark";
import type { LandingRow } from "./readLanding";
import type { ReviewerRow, ReviewerSuggestion } from "./readReviewers";

/** The live channel the press re-reads. */
const READS = "reviewers";

/**
 * A person, named, with their Slack id on hover.
 *
 * @returns the name
 */
function Person({ id, people }: { id: string; people: SlackPeople }): ReactElement {
  const label = personLabel({ id, people });
  return <b title={label.title}>{label.text}</b>;
}

/** The summary's short line: full width under the ask line, the person in the page's accent. */
const SUGGEST = "flex-[1_1_100%] text-[0.76rem] text-muted-foreground [&_b]:font-semibold [&_b]:text-primary";

/** The card in the fold: a quiet panel, its heading small, its candidates an unmarked list. */
const SUGGESTION =
  "my-[0.6rem] rounded-lg border border-border bg-muted px-[0.75rem] py-[0.6rem] [&_h5]:mt-0 [&_h5]:mb-[0.4rem] [&_h5]:text-[0.78rem] [&_h5]:font-semibold [&_h5]:text-foreground [&_ul]:m-0 [&_ul]:list-none [&_ul]:p-0";

/** One candidate, a faint rule between it and the one above. */
const CANDIDATE =
  "border-t border-border/60 py-[0.35rem] text-[0.8rem] text-muted-foreground first:border-t-0 [&_b]:text-foreground [&>p]:my-[1em]";

/** A candidate's press. */
const ACTS = "mt-[0.3rem] flex flex-wrap items-center gap-[0.4rem]";

/**
 * The summary's short line for a pick no reading has seen an ask for since, or for a suggestion waiting on the owner.
 *
 * A suggestion is held back while the row's post to a channel still reads green or yellow — `suggestionHeld`.
 *
 * @param joined the reviewer reading's row for this pull request, when it has one
 * @returns the line, or nothing when neither applies
 */
export function PrSuggestChip({
  row,
  joined,
  people,
}: {
  row: LandingRow;
  joined: ReviewerRow | undefined;
  people: SlackPeople;
}): ReactElement | null {
  if (joined?.picked !== undefined) {
    return (
      <span className={SUGGEST} data-state="picked">
        you picked <Person id={joined.picked.reviewer} people={people} /> {ageOf({ iso: joined.picked.atIso })}, no ask
        seen since
      </span>
    );
  }
  if (joined?.suggestion === undefined || suggestionHeld({ row })) {
    return null;
  }
  return (
    <span className={SUGGEST} data-state="suggested">
      suggest <Person id={joined.suggestion.primary.reviewer} people={people} /> ·{" "}
      {tierWords({ tier: joined.suggestion.primary.tier })}
    </span>
  );
}

/**
 * One candidate: who, why, and the approve press.
 *
 * @returns the candidate
 */
function Candidate({
  row,
  candidate,
  people,
  lead,
  frozen,
}: {
  row: LandingRow;
  candidate: ReviewerSuggestion;
  people: SlackPeople;
  lead: boolean;
  frozen: boolean;
}): ReactElement {
  const approve = usePress();
  const target = { number: row.number, repoSlug: row.repoSlug, reviewer: candidate.reviewer };
  const busy = approve.state.phase === "sending";
  let approveLabel = "Approve: parks the ask for your yes, sends nothing";
  if (!lead) {
    approveLabel = "Approve instead";
  }
  return (
    <li className={CANDIDATE} data-lead={lead}>
      <p>
        <Person id={candidate.reviewer} people={people} /> · {tierWords({ tier: candidate.tier })} · {candidate.basis}
      </p>
      <div className={ACTS}>
        <button
          type="button"
          className={lead ? BUTTON_PRIMARY : BUTTON}
          disabled={frozen || busy}
          onClick={() => {
            void approve.press({ readsSlug: READS, slots: approveSlotsOf(target), slug: APPROVE_SLUG });
          }}
        >
          {approveLabel}
        </button>
        {lead && <span className="text-[0.76rem]">Not them? Say why in the call&apos;s chat.</span>}
      </div>
      <Outcome state={approve.state} />
    </li>
  );
}

/**
 * The suggestion card in a row's fold and in its slide-over.
 *
 * @param joined the reviewer reading's row for this pull request, when it has one
 * @param fixture the fixture name when the page is frozen, which turns the presses off
 * @param stale why the reviewer reading drawn is an earlier one kept over a failed read, and when it was taken —
 *   which holds the presses too, since the latest read did not confirm the suggestion
 * @returns the card, or nothing when the verb offered no suggestion
 */
export function PrSuggestion({
  row,
  joined,
  people,
  fixture,
  stale,
}: {
  row: LandingRow;
  joined: ReviewerRow | undefined;
  people: SlackPeople;
  fixture: string | undefined;
  stale: { readonly why: string; readonly observedAtIso: string } | undefined;
}): ReactElement | null {
  if (joined?.suggestion === undefined || suggestionHeld({ row })) {
    return null;
  }
  const { primary, alternatives } = joined.suggestion;
  const frozen = fixture !== undefined || stale !== undefined;
  return (
    <section className={SUGGESTION}>
      <h5 className="flex items-center gap-[0.35rem]">
        Suggested reviewer
        {stale !== undefined && (
          <StaleMark
            facts={[{ observedAtIso: stale.observedAtIso, subject: "the reviewer suggestions", why: stale.why }]}
          />
        )}
      </h5>
      <ul>
        <Candidate candidate={primary} frozen={frozen} lead people={people} row={row} />
        {alternatives.map((alt) => (
          <Candidate key={alt.reviewer} candidate={alt} frozen={frozen} lead={false} people={people} row={row} />
        ))}
      </ul>
      <p className="sw-tile-note">
        {fixture !== undefined && `a fixture (${fixture}), so the presses are off. `}
        {fixture === undefined && stale !== undefined && "an earlier reading, so the presses wait for a fresh one. "}
        <code>{actLineFor({ slug: APPROVE_SLUG })}</code>
      </p>
    </section>
  );
}
