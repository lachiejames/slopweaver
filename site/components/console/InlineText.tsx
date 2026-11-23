"use client";

import { createContext, Fragment, type ReactElement, type ReactNode, useContext, useMemo } from "react";

import { personWords } from "../../lib/cardPeopleDisplay";
import { type CardReferences, type InlineSegment, inlineSegments, NO_CARD_REFERENCES } from "../../lib/inlineCitations";
import { oneNumberNotation } from "../../lib/numberPhrase";
import type { CardPeople } from "../../lib/personMentions";
import { CitationChip } from "./CitationChip";

/** No published pull requests — one stable array, so the default is not a fresh one on every render. */
const NONE: readonly string[] = [];

/**
 * What the open card's row knows beyond its addresses (`../../lib/cardReferences.ts`), for every sentence drawn
 * inside it — a context rather than a prop, because a drawer draws its sentences through a dozen components and
 * each would otherwise have to hand it on. Outside a drawer it is none, and a sentence links what it did before.
 */
const CardReferencesContext = createContext<CardReferences>(NO_CARD_REFERENCES);

/**
 * Every {@link InlineText} inside resolves a number or key its sentence names without an address through
 * `references`: every number, cited or not.
 *
 * @param references what the open card's row knows beyond its addresses
 * @param children the drawer
 * @returns the drawer, with the references in scope
 */
export function CardReferencesScope({
  references,
  children,
}: {
  references: CardReferences;
  children: ReactNode;
}): ReactElement {
  return <CardReferencesContext.Provider value={references}>{children}</CardReferencesContext.Provider>;
}

/**
 * A page's people in scope for every sentence drawn outside a drawer — a queue tile's title reads a `<@U…>` as the
 * person's name too. A drawer's own {@link CardReferencesScope} replaces it inside, carrying the same people.
 *
 * @param people every person the page's rosters name
 * @param children the page
 * @returns the page, with the people in scope
 */
export function PeopleScope({ people, children }: { people: CardPeople; children: ReactNode }): ReactElement {
  const references = useMemo(() => ({ ...NO_CARD_REFERENCES, people }), [people]);
  return <CardReferencesContext.Provider value={references}>{children}</CardReferencesContext.Provider>;
}

/**
 * The references in scope, for a place that folds a sentence to plain text rather than drawing it.
 *
 * @returns the open card's references, or none outside a drawer
 */
export function useCardReferences(): CardReferences {
  return useContext(CardReferencesContext);
}

/**
 * Each piece keyed by where it starts in the sentence as drawn — unique, and stable for one sentence.
 *
 * @returns the pieces with their keys
 */
function keyed({
  segments,
}: {
  segments: readonly InlineSegment[];
}): readonly { key: string; segment: InlineSegment }[] {
  const out: { key: string; segment: InlineSegment }[] = [];
  let at = 0;
  for (const segment of segments) {
    out.push({ key: `${segment.kind}@${String(at)}`, segment });
    if (segment.kind === "text") {
      at += segment.text.length;
    } else {
      at += segment.label.length;
    }
  }
  return out;
}

/**
 * A sentence with every reference it names drawn as its citation chip — a pull request as its number, any other
 * address as its place, a board row by its slug — hover or focus it for where it goes (and a pull request's diff). Never a raw URL in brackets after the number,
 * never a chip row at the bottom of the card. The split is `inlineSegments` (`../../lib/inlineCitations.ts`).
 *
 * A person is words, never a chip: identity chips live only in a card's properties, a name
 * anywhere else is a first name, and the owner is "you" (`personWords`, `../../lib/cardPeopleDisplay.ts`). And its numbers
 * read one way per sentence — 1.7K beside 5.9K, never beside 5,977 (`oneNumberNotation`, `../../lib/numberPhrase.ts`).
 * The owner's own words never come through here: a quote is drawn verbatim, as `./SourceBlock.tsx` draws it.
 *
 * @param text the card's own sentence
 * @param known the pull-request URLs the row publishes beyond this text, so a number named without its address resolves
 * @returns the sentence
 */
export function InlineText({ text, known = NONE }: { text: string; known?: readonly string[] }): ReactElement {
  const references = useCardReferences();
  const pieces = keyed({
    segments: personWords({
      people: references.people,
      segments: inlineSegments({ known, references, text: oneNumberNotation({ text }) }),
    }),
  });
  return (
    <>
      {pieces.map(({ key, segment }) => {
        if (segment.kind === "text") {
          return <Fragment key={key}>{segment.text}</Fragment>;
        }
        if (segment.kind === "person") {
          return <Fragment key={key}>{segment.label}</Fragment>;
        }
        // A record the board named — a monitor, a control — is placed by what it is called as well as its id, so
        // `monitor 50001` says which monitor before the owner opens it.
        const named = segment.title === undefined ? {} : { place: `${segment.label}: ${segment.title}` };
        return (
          <CitationChip key={key} reference={{ kind: "address", url: segment.url }} look="inline" {...named}>
            {segment.label}
          </CitationChip>
        );
      })}
    </>
  );
}
