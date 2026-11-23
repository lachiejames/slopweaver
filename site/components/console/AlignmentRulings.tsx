/** The Alignment page's general-ruling question cards (`./Alignment.tsx`). */

import type { ReactElement } from "react";

import type { AlignmentOrderItem } from "../../lib/alignmentRank";
import { type CardRulingCandidate, FEEDBACK_SUBJECT, type RulingCandidate } from "../../lib/alignmentRules";
import { kindWords } from "../../lib/queueCard";
import { answerTo } from "../../lib/sidebarCountsAlignment";
import { cn } from "../../lib/utils";
import type { AlignmentAnswer } from "../live/readAlignment";
import { Answered, CARD, ConversationHint, dayOf, engaging } from "./AlignmentCommon";
import { CHIP } from "./controls";
import { FIELDS, RiskAndBlastRadiusRows } from "./QueueCardBodyFields";

/**
 * One "make it a general ruling?" question: the owner's repeated words on one kind of act, asking whether they are one.
 * Its Risk and Blast radius rows sit above the quotes, as a Queue card's do, so what a standing ruling would let the
 * fleet do unasked is read before the yes (`../../lib/alignmentRulingStakes.ts`).
 *
 * @returns the card
 */
function RulingCard({
  candidate,
  answer,
  onEngage,
}: {
  candidate: RulingCandidate;
  answer: AlignmentAnswer | undefined;
  onEngage: (key: string) => void;
}): ReactElement {
  const words = kindWords({ kind: candidate.kind });
  const shown = candidate.quotes.slice(0, 5);
  const more = candidate.quotes.length - shown.length;
  // Folded: there is one per kind the owner has steered twice, which on a long-run ledger is a page of them, so each shows
  // its question and count and opens onto the quotes.
  return (
    <details
      className={CARD}
      id={candidate.key}
      data-testid="alignment-ruling"
      {...engaging({ about: candidate.key, onEngage })}
    >
      <summary className="cursor-pointer text-[0.86rem] font-[650]">
        Make your word on “{words}” a general ruling?{" "}
        <span className="font-normal text-muted-foreground">
          · given on {String(candidate.steered)} acts, {String(candidate.quotes.length)}{" "}
          {candidate.quotes.length === 1 ? "wording" : "wordings"}
        </span>{" "}
        {answer !== undefined && <span className={CHIP}>answered</span>}
      </summary>
      <p className="mt-[0.5rem] mb-0 text-[0.9rem]">
        You have given your word on {String(candidate.steered)} acts where the fleet did <b>{words}</b>. Hypothetically,
        the next time it does, should what you said stand for that one too, or keep judging each one apart?
      </p>
      <dl className={cn(FIELDS, "mt-[0.6rem]")} data-testid="alignment-ruling-stakes">
        <RiskAndBlastRadiusRows stakes={candidate.stakes} known={[]} />
      </dl>
      <p className="mt-[0.4rem] mb-0 text-[0.75rem] text-muted-foreground">
        Until you say so, each word stays on the act you gave it on. Your own words, most used first:
      </p>
      <ul className="my-[0.4rem] pl-[1.1rem] text-[0.84rem]">
        {shown.map((quote) => (
          <li key={quote.words}>
            “{quote.words}” · on {String(quote.acts)} {quote.acts === 1 ? "act" : "acts"}, last{" "}
            {quote.dateBasis === "steered" ? "said" : "on an act from"} {dayOf({ iso: quote.latestIso })}
          </li>
        ))}
      </ul>
      {more > 0 && <p className="m-0 text-[0.75rem] text-muted-foreground">and {String(more)} other wordings</p>}
      <Answered answer={answer} />
      <ConversationHint />
    </details>
  );
}

/**
 * The general-ruling questions the page shows, as the voice names them: those of each read that has arrived, or none
 * while neither has.
 *
 * @param acts the questions over kinds of act, `undefined` until the ledger reads
 * @param cards the questions over cards the owner sent back, `undefined` until the feedback and the register read
 * @returns every key shown, or `undefined` when nothing has read
 */
export function generalRulingKeys({
  acts,
  cards,
}: {
  acts: readonly RulingCandidate[] | undefined;
  cards: readonly CardRulingCandidate[] | undefined;
}): readonly string[] | undefined {
  if (acts === undefined && cards === undefined) {
    return undefined;
  }
  const keys: string[] = [];
  if (acts !== undefined) {
    keys.push(...acts.map((candidate) => candidate.key));
  }
  if (cards !== undefined) {
    keys.push(...cards.map((candidate) => candidate.key));
  }
  return keys;
}

/**
 * One "make it a general ruling?" question over a class of card the owner keeps sending back: their words on each draft,
 * asking whether the class is a rule every card is held to. Answering it lands as a ruling or a preference by their words,
 * through the supervisor; it never builds a gate or dispatches work by itself (`skills/supervisor/reference/routing.md`).
 *
 * @returns the card
 */
function CardRulingCard({
  candidate,
  answer,
  onEngage,
}: {
  candidate: CardRulingCandidate;
  answer: AlignmentAnswer | undefined;
  onEngage: (key: string) => void;
}): ReactElement {
  const subject = FEEDBACK_SUBJECT[candidate.feedback];
  const shown = candidate.quotes.slice(0, 5);
  const more = candidate.quotes.length - shown.length;
  return (
    <details
      className={CARD}
      id={candidate.key}
      data-testid="alignment-card-ruling"
      {...engaging({ about: candidate.key, onEngage })}
    >
      <summary className="cursor-pointer text-[0.86rem] font-[650]">
        Make sending back {subject} a general ruling?{" "}
        <span className="font-normal text-muted-foreground">· {String(candidate.quotes.length)} drafts</span>{" "}
        {answer !== undefined && <span className={CHIP}>answered</span>}
      </summary>
      <p className="mt-[0.5rem] mb-0 text-[0.9rem]">
        You have sent back {String(candidate.quotes.length)} drafts as <b>{subject}</b>. Hypothetically, should every
        card be held to that before it reaches you, or keep judging each one apart?
      </p>
      <dl className={cn(FIELDS, "mt-[0.6rem]")} data-testid="alignment-card-ruling-stakes">
        <RiskAndBlastRadiusRows stakes={candidate.stakes} known={[]} />
      </dl>
      <p className="mt-[0.4rem] mb-0 text-[0.75rem] text-muted-foreground">
        Until you say so, each word stays on the draft you gave it on. Your own words:
      </p>
      <ul className="my-[0.4rem] pl-[1.1rem] text-[0.84rem]">
        {shown.map((quote) => (
          <li key={quote.draftId}>
            “{quote.words}” · on {quote.draftId}, {dayOf({ iso: quote.atIso })}
          </li>
        ))}
      </ul>
      {more > 0 && <p className="m-0 text-[0.75rem] text-muted-foreground">and {String(more)} other drafts</p>}
      <Answered answer={answer} />
      <ConversationHint />
    </details>
  );
}

/**
 * One general ruling in the page's order, drawn by the card its kind has: over a kind of act, or over a class of card.
 * It is looked up in the list the order says it came from, so a key both lists happen to share still draws each once.
 *
 * @param item the question as the order placed it
 * @param acts the questions over kinds of act
 * @param cards the questions over classes of card
 * @param answered the owner's answers, `undefined` until they read
 * @returns the card, or nothing when its list does not hold it
 */
export function GeneralRuling({
  item,
  acts,
  cards,
  answered,
  onEngage,
}: {
  item: AlignmentOrderItem;
  acts: readonly RulingCandidate[];
  cards: readonly CardRulingCandidate[];
  answered: readonly AlignmentAnswer[] | undefined;
  onEngage: (key: string) => void;
}): ReactElement | null {
  const answer = answerTo({ answers: answered, key: item.key });
  if (item.from === "act-ruling") {
    const overActs = acts.find((candidate) => candidate.key === item.key);
    return overActs === undefined ? null : <RulingCard candidate={overActs} answer={answer} onEngage={onEngage} />;
  }
  if (item.from === "card-ruling") {
    const overCards = cards.find((candidate) => candidate.key === item.key);
    return overCards === undefined ? null : (
      <CardRulingCard candidate={overCards} answer={answer} onEngage={onEngage} />
    );
  }
  return null;
}
