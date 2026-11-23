/** A fleet-briefing card's fields, as the Queue card body (`./QueueCardBody.tsx`) draws them. */

import type { ReactElement, ReactNode } from "react";

import { type BriefingCard, UNRECORDED_EXAMPLE_LINE } from "../../lib/queueCard";
import { CopyBlock } from "./CopyBlock";
import { InlineText } from "./InlineText";
import { FIELDS, Options, PagesList, ProblemAndStakes } from "./QueueCardBodyFields";

/**
 * A card's PASTE row: each command its record carries as a copy block of its own, or nothing when it carries none.
 * Folded, it sits above the disclosure beside the WHAT — a command the owner has to run is the thing being asked, never
 * one more line behind "the rest".
 *
 * @param card the briefing card
 * @returns the `<dt>`/`<dd>` pair, or `null`
 */
export function PasteRow({ card }: { card: BriefingCard }): ReactElement | null {
  if (card.commands.length === 0) {
    return null;
  }
  return (
    <>
      <dt>paste</dt>
      <dd className="grid gap-[0.45rem]">
        {card.commands.map((command, index) => (
          <CopyBlock key={`${String(index)}-${command}`} text={command} />
        ))}
      </dd>
    </>
  );
}

/**
 * A card's WHAT row, or nothing when its record held none.
 *
 * @param card the briefing card
 * @param known the pull-request URLs the row publishes
 * @returns the `<dt>`/`<dd>` pair, or `null`
 */
export function WhatRow({ card, known }: { card: BriefingCard; known: readonly string[] }): ReactElement | null {
  if (card.what === undefined) {
    return null;
  }
  return (
    <>
      <dt>what</dt>
      <dd>
        <p>
          <InlineText text={card.what.aboveFold} known={known} />
        </p>
      </dd>
    </>
  );
}

/**
 * An ask card's concrete example — the second-person scene the owner can picture, ending on the question the card is
 * really asking. Drawn FIRST, above every other field, because it is what carries the
 * problem, why it was one, why solve it, how, and whether that is aligned with the owner; the rest is reference. Related asks
 * folded onto one card number their scenes 1, 2, 3. A row that recorded no scene says so in one line, its own gap line
 * or the card's, rather than drawing nothing a reader could mistake for a scene that failed to load.
 *
 * @returns the row, or nothing on a register that is not an ask
 */
export function ExampleRow({ card, known }: { card: BriefingCard; known: readonly string[] }): ReactElement | null {
  const examples = card.examples;
  if (examples === undefined) {
    return null;
  }
  if (examples.kind === "scenes" && examples.scenes.length > 1) {
    return (
      <>
        <dt>examples</dt>
        <dd data-examples="">
          <ol className="m-0 grid list-decimal gap-2 pl-5">
            {examples.scenes.map((scene, at) => (
              <li key={`${String(at)}-${scene}`}>
                <InlineText text={scene} known={known} />
              </li>
            ))}
          </ol>
        </dd>
      </>
    );
  }
  if (examples.kind === "scenes") {
    return (
      <>
        <dt>example</dt>
        <dd data-examples="">
          <p>
            <InlineText text={examples.scenes.join(" ")} known={known} />
          </p>
        </dd>
      </>
    );
  }
  let line = UNRECORDED_EXAMPLE_LINE;
  if (examples.kind === "gap") {
    line = examples.line;
  }
  return (
    <>
      <dt>example</dt>
      <dd data-examples="" data-stated="false">
        <InlineText text={line} known={known} />
      </dd>
    </>
  );
}

/**
 * The options row.
 *
 * @param card the briefing card
 * @param known the pull-request URLs the row publishes
 * @returns the row, or nothing when the card carries no option
 */
function OptionsRow({ card, known }: { card: BriefingCard; known: readonly string[] }): ReactElement | null {
  if (card.options.length === 0) {
    return null;
  }
  return (
    <>
      <dt>options</dt>
      <dd>
        <Options options={card.options} known={known} />
      </dd>
    </>
  );
}

/**
 * The fleet briefing's fields: what, the problem and its stakes, why you, the options, the lean and the if-silent —
 * each drawn only when the card carries it, so a field its register cannot fill is no row rather than a sentence
 * explaining the gap, which would be junk on the card. Folded, the WHAT and the links
 * are already drawn above the disclosure, so neither is drawn a second time here.
 *
 * @param card the briefing card
 * @param preview what the row offers, drawn above the options
 * @param links where the row can be checked
 * @param folded whether the links are drawn above the fold instead
 * @param known the pull-request URLs the row publishes
 * @param mail the mail the card is about, drawn under the problem
 * @returns the fields
 */
export function BriefingFields({
  card,
  preview,
  links,
  folded,
  known,
  mail,
}: {
  card: BriefingCard;
  preview: ReactNode;
  links: ReactNode;
  folded: boolean;
  known: readonly string[];
  mail: ReactNode;
}): ReactElement {
  const linksRow = links !== undefined && (
    <>
      <dt>links</dt>
      <dd>{links}</dd>
    </>
  );
  return (
    <dl className={FIELDS}>
      {!folded && <ExampleRow card={card} known={known} />}
      {!folded && <WhatRow card={card} known={known} />}
      {!folded && <PasteRow card={card} />}
      {!folded && linksRow}
      {links === undefined && card.pages.length > 0 && (
        <>
          <dt>pages</dt>
          <dd>
            <PagesList pages={card.pages} />
          </dd>
        </>
      )}
      {!folded && <ProblemAndStakes card={card} known={known} mail={mail} />}
      {card.whyYou !== undefined && (
        <>
          <dt>why you</dt>
          <dd>{card.whyYou}</dd>
        </>
      )}
      {preview !== undefined && (
        <>
          <dt>draft</dt>
          <dd>{preview}</dd>
        </>
      )}
      <OptionsRow card={card} known={known} />
      {card.lean !== undefined && (
        <>
          <dt>lean</dt>
          <dd>
            <InlineText text={card.lean} known={known} />
          </dd>
        </>
      )}
      {card.ifSilent !== undefined && (
        <>
          <dt>if silent</dt>
          <dd>
            <InlineText text={card.ifSilent} known={known} />
          </dd>
        </>
      )}
    </dl>
  );
}
