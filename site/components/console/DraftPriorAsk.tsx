/*
 * "Asked before" — what a re-ask owes the owner, drawn ABOVE the message it would post. A question the team already
 * answered is never asked again in public unless something materially changed, and then the Queue card shows our
 * earlier message, their answer, and charts or proof of what changed: saying something changed is not enough.
 *
 * Concise above the fold, the rest folded: our earlier message and the first answer sit open, every further answer
 * the recording kept (and a count of those it did not) fold behind one disclosure. Then the ONE of two claims the
 * recorder made — what changed, with the pictures that show it, or why the replies there are not an answer — so the
 * card never reads as a re-ask carrying neither — once somebody answered; an unanswered ask owes neither. A row that
 * declared `none` draws nothing at all.
 *
 * It keeps time order: on a held draft our message and its answers open the live conversation's
 * slot, since they came first, and are not drawn at all once that conversation holds our message in place
 * (`../../lib/draftChronology.ts`); the claim sits above the draft either way.
 *
 * The proof is drawn by the draft's own attachment component from the exact stored bytes
 * (`/api/draft-media/<sha256>`), never a file icon with a byte count.
 */

import type { ReactElement } from "react";
import { consoleHref } from "../../lib/localPageHref";
import { channelNames } from "../../lib/slackChannelLabels";
import { personLabel, type SlackPeople } from "../../lib/slackPeople";
import type { DraftPriorAsk, DraftPriorMessage } from "../live/draftPriorAsk";
import { messageLines } from "../live/readSlackDraftsMessage";
import { type DraftLine } from "../live/readSlackDraftsRuns";
import { LINK, Line, type RunLabels } from "./DraftLines";
import { SlackAttachments } from "./SlackAttachments";

/** An earlier ask that was read, as opposed to the `none` declaration. */
type PriorAsk = Extract<DraftPriorAsk, { kind: "prior" }>;

/** The warning-bordered box the earlier ask, or its claim alone, is drawn in. */
const BOX = "grid gap-[0.5rem] rounded-[8px] border border-solid border-warning px-[0.7rem] py-[0.55rem]";

/** What an author's line reads when Slack named nobody. */
const UNKNOWN_AUTHOR = "unknown author";

/** An earlier message's words as the lines the card draws, read the way a message someone else wrote is. */
function linesOf({ message }: { message: DraftPriorMessage }): readonly DraftLine[] {
  return messageLines({ attachments: [], blocks: [], text: message.text });
}

/**
 * One earlier message: who wrote it, when Slack said, then its words.
 *
 * @param heading what the message is to this card — ours, or an answer
 * @param message the message as the recording kept it
 * @param people the roster the reading carried, which names the author
 * @returns the message
 */
function PriorMessage({
  heading,
  message,
  people,
}: {
  heading: string;
  message: DraftPriorMessage;
  people: SlackPeople;
}): ReactElement {
  // Its own words are the one place an earlier message names a channel in writing.
  const labels: RunLabels = { channels: channelNames({ known: [], texts: [message.text] }), mentions: [], people };
  let author = UNKNOWN_AUTHOR;
  let title = message.ts;
  if (message.userId !== undefined) {
    const label = personLabel({ id: message.userId, people });
    author = label.text;
    title = label.title;
  }
  const lines = linesOf({ message }).map((line, at) => (
    <Line key={`${message.ts}-${String(at)}`} labels={labels} line={line} />
  ));
  return (
    <div className="grid gap-[0.15rem] border-l-2 border-border pl-2" data-kind="prior-message">
      <p className="m-0 flex items-baseline gap-2 text-[0.8rem] text-muted-foreground">
        <b className="text-foreground" title={title}>
          {author}
        </b>
        <span>{heading}</span>
      </p>
      <div className="grid text-[0.9rem] leading-[1.35] wrap-anywhere whitespace-pre-wrap">{lines}</div>
    </div>
  );
}

/** `1 more answer`, `4 more answers`. */
function moreWords({ count }: { count: number }): string {
  if (count === 1) {
    return "1 more answer";
  }
  return `${String(count)} more answers`;
}

/**
 * The answers after the first, and the count of those the recording did not keep, folded behind one disclosure.
 *
 * @returns the disclosure, or nothing when the first answer is all there was
 */
function FurtherAnswers({ prior, people }: { prior: PriorAsk; people: SlackPeople }): ReactElement | null {
  const kept = prior.answers.slice(1);
  const unkept = prior.answerCount - prior.answers.length;
  const total = kept.length + unkept;
  if (total === 0) {
    return null;
  }
  return (
    <details className="text-[0.8rem]">
      <summary className="cursor-pointer text-muted-foreground">{moreWords({ count: total })}</summary>
      <div className="mt-[0.4rem] grid gap-[0.4rem]">
        {kept.map((answer) => (
          <PriorMessage heading="also answered" key={answer.ts} message={answer} people={people} />
        ))}
        {unkept > 0 && (
          <p className="m-0 text-muted-foreground">{moreWords({ count: unkept })} not kept here. Read them in Slack.</p>
        )}
      </div>
    </details>
  );
}

/** Whether the row owes a claim: somebody answered, or the recorder made one anyway. An unanswered ask owes none. */
function owesClaim({ prior }: { prior: PriorAsk }): boolean {
  return prior.answerCount > 0 || prior.changed !== undefined || prior.notAnswered !== undefined;
}

/**
 * The claim the recorder made about why this is asked again: what changed, with the proof that shows it, or why the
 * replies were not an answer. A row recording neither after somebody answered says so rather than drawing a bare
 * re-ask; an ask nobody answered owes neither (`slack draft record --asked-before` demands one only when answered).
 */
function Claim({ prior }: { prior: PriorAsk }): ReactElement | null {
  if (!owesClaim({ prior })) {
    return null;
  }
  if (prior.changed !== undefined) {
    return (
      <div className="grid gap-[0.3rem]" data-kind="what-changed">
        <b className="text-[0.8rem]">What changed</b>
        <p className="m-0 text-[0.9rem] wrap-anywhere whitespace-pre-wrap">{prior.changed}</p>
        {prior.proof.length === 0 ? (
          <p className="m-0 text-[0.8rem] text-warning">no chart or picture attached as proof</p>
        ) : (
          <SlackAttachments media={prior.proof} unfurls={[]} />
        )}
      </div>
    );
  }
  if (prior.notAnswered !== undefined) {
    return (
      <div className="grid gap-[0.3rem]" data-kind="not-answered">
        <b className="text-[0.8rem]">Not an answer</b>
        <p className="m-0 text-[0.9rem] wrap-anywhere whitespace-pre-wrap">{prior.notAnswered}</p>
      </div>
    );
  }
  return (
    <p className="m-0 text-[0.8rem] text-warning" data-kind="no-claim">
      this draft records neither what changed nor why the earlier replies were not an answer
    </p>
  );
}

/**
 * The earlier ask a parked draft repeats, whole or in part: our message, their first answer, the rest folded, and what
 * changed with its proof — or why the replies were not an answer. A held draft's card splits it: the `exchange` sits at the top of the reserved conversation slot, in time order and moving nothing outside it
 * when the live read lands, and the `claim`, which the record alone settles, sits above the draft.
 *
 * @param prior the draft's declaration about an earlier ask
 * @param people the roster the reading carried, which names each author
 * @param part `whole`, our message and its answers alone (`exchange`), or the claim alone (`claim`)
 * @returns the block, or nothing for a draft that declared it was never asked before, or a claim nobody owes
 */
export function PriorAskCard({
  prior,
  people,
  part = "whole",
}: {
  prior: DraftPriorAsk | undefined;
  people: SlackPeople;
  part?: "whole" | "exchange" | "claim";
}): ReactElement | null {
  if (prior?.kind !== "prior") {
    return null;
  }
  if (part === "claim") {
    if (!owesClaim({ prior })) {
      return null;
    }
    return (
      <section aria-label="why the question is asked again" className={BOX} data-kind="prior-ask-claim">
        <Claim prior={prior} />
      </section>
    );
  }
  const firstAnswer = prior.answers.at(0);
  return (
    <section aria-label="the question was asked before" className={BOX} data-kind="prior-ask">
      <p className="m-0 flex items-baseline gap-2 text-[0.8rem]">
        <b className="tracking-[0.04em] uppercase">Asked before</b>
        <a
          className={LINK}
          href={consoleHref({ url: prior.permalink })}
          rel="noreferrer"
          target="_blank"
          title={prior.permalink}
        >
          open in Slack
        </a>
      </p>
      <PriorMessage heading="our earlier message" message={prior.ours} people={people} />
      {firstAnswer === undefined ? (
        <p className="m-0 text-[0.8rem] text-muted-foreground">nobody else had replied when this was recorded</p>
      ) : (
        <PriorMessage heading="their answer" message={firstAnswer} people={people} />
      )}
      <FurtherAnswers people={people} prior={prior} />
      {part === "whole" && <Claim prior={prior} />}
    </section>
  );
}
