/** What a Queue card body (`./QueueCardBody.tsx`) draws above its fields. */

import { Fragment, type ReactElement } from "react";

import { cardLinkLabel } from "../../lib/cardLinks";
import { inlinePersonName } from "../../lib/cardPeopleDisplay";
import { citationTexts, unlinkedMentions } from "../../lib/inlineCitations";
import { proseParts } from "../../lib/proseParts";
import { type CardHeadPerson, drawsPeopleRow, type QueueCard } from "../../lib/queueCard";
import { CitationChip } from "./CitationChip";
import { useCardReferences } from "./InlineText";

/**
 * The card's references that cite nothing — a `#N`, a `PR N` or a known team's key no address resolves — named in
 * one line, so a card that talks about a record it cannot link says so instead of drawing the words plain: a mention with
 * no resolvable target is a lint finding.
 *
 * @returns the line, or nothing when every reference resolves
 */
export function CitationFinding({ card, known }: { card: QueueCard; known: readonly string[] }): ReactElement | null {
  const references = useCardReferences();
  const unlinked = unlinkedMentions({ known, references, texts: citationTexts({ card }) });
  if (unlinked.length === 0) {
    return null;
  }
  return (
    <p
      data-citation-finding=""
      className="m-0 rounded-md border border-warning/40 bg-warning/10 px-3 py-1.5 text-[0.8rem] text-warning"
    >
      citations that link nowhere: {unlinked.map((mention) => mention.label).join(" · ")}
    </p>
  );
}

/**
 * One person in a card's people row, as words: their first name, their whole name where a colleague shares it, "you"
 * for the owner — identity chips live only in the properties (`../../lib/cardPeopleDisplay.ts`). A person
 * the roster does not hold keeps the name the draft reading gave them.
 *
 * @returns the name
 */
function HeadPerson({ person }: { person: CardHeadPerson }): ReactElement {
  const references = useCardReferences();
  return (
    <span data-person={person.id} className="font-medium">
      {inlinePersonName({ fallback: person.label, person: references.people.get(person.id) })}
    </span>
  );
}

/**
 * The card head under its title: who it is to, by id — `Nudging Seth Tanner, Ansel Jory`
 * — and one plain line of where it lands and what it answers. Both sit above the owner's words in every branch, because
 * they are what the owner reads to know what they are being asked to send before reading any of it.
 *
 * @returns the rows, or nothing on a card whose head names nobody and says no context
 */
export function CardHeadRows({ card }: { card: QueueCard }): ReactElement | null {
  if (card.kind !== "briefing" || card.head === undefined) {
    return null;
  }
  const { people, peopleVerb, context } = card.head;
  if (!drawsPeopleRow({ card }) && context === undefined) {
    return null;
  }
  return (
    <div data-card-head className="grid gap-1 text-[0.88rem]">
      {people.length > 0 && (
        <p data-people-row className="m-0">
          <span className="text-muted-foreground">{peopleVerb}</span>{" "}
          {people.map((person, at) => (
            <Fragment key={person.id}>
              {at > 0 && ", "}
              <HeadPerson person={person} />
            </Fragment>
          ))}
        </p>
      )}
      {context !== undefined && (
        <p data-card-context className="m-0 text-muted-foreground">
          {proseParts({ text: context }).map((part, at) =>
            part.kind === "link" ? (
              <CitationChip
                key={`${String(at)}-${part.url}`}
                reference={{ kind: "address", url: part.url }}
                look="inline"
              >
                {cardLinkLabel({ label: part.label, url: part.url })}
              </CitationChip>
            ) : (
              <Fragment key={`${String(at)}-text`}>{part.text}</Fragment>
            ),
          )}
        </p>
      )}
    </div>
  );
}
