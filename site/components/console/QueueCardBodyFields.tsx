/** The field-list pieces both of a Queue card's shapes draw (`./QueueCardBody.tsx`). */

import { createContext, type ReactElement, type ReactNode, useContext } from "react";

import { ageOf } from "../../lib/ageOf";
import {
  type BriefingCard,
  type CardOption,
  type CardPage,
  type CardStakes,
  type StepOption,
} from "../../lib/queueCard";
import { stillRealLead } from "../../lib/stillRealLead";
import type { HisWordsWhere } from "../live/readHisWords";
import { CitationChip } from "./CitationChip";
import { CopyBlock } from "./CopyBlock";
import { InlineText } from "./InlineText";

/**
 * Where and when the owner raised what the open card is about — its quote's place and instant — so the still-real row deep
 * in either field list can say so without every component between threading the card's source down.
 */
export const RaisedContext = createContext<{ readonly where: HisWordsWhere; readonly atIso: string } | undefined>(
  undefined,
);

/** How an option is taken, quiet beside the option's own sentence. */
const HOW = "text-[0.75rem] text-muted-foreground [&_code]:wrap-anywhere";

/**
 * The briefing: muted uppercase labels down the left, the values beside them. A field no verb states is no row; the
 * one muted, italic value left is a refusal or a hand step's own, and a preview drawn in a field keeps its heading at
 * the panel's label size.
 */
export const FIELDS =
  "m-0 grid grid-cols-[5.5rem_minmax(0,1fr)] gap-x-[0.9rem] gap-y-[0.55rem] text-[0.85rem] leading-[1.6] [&_dd]:m-0 [&_dd]:min-w-0 [&_dd_h4]:mb-2 [&_dd_h4]:text-[0.7rem] [&_dd_p]:m-0 [&_dd[data-stated=false]]:text-muted-foreground [&_dd[data-stated=false]]:italic [&_dt]:pt-[0.22rem] [&_dt]:text-[0.68rem] [&_dt]:font-bold [&_dt]:tracking-[0.06em] [&_dt]:text-muted-foreground [&_dt]:uppercase";

/**
 * How an option is taken, in one line under the option's own sentence.
 *
 * @param option the option
 * @returns the line
 */
function How({ option }: { option: CardOption }): ReactElement {
  const how = option.how;
  if (how.kind === "press") {
    return (
      <span className={HOW}>
        the <b>{how.button}</b> button below
      </span>
    );
  }
  if (how.kind === "silence") {
    return <span className={HOW}>nothing to press: this is what happens if you do nothing</span>;
  }
  // A command is drawn as its own copy block under the option (`optionCommand`), never inline here.
  return <span className={HOW}>in {how.where}</span>;
}

/**
 * The command an option is taken by, when it has one — an ask option the owner takes at a terminal, an offered draft's
 * send line, or a step card's option carrying the owner's command.
 *
 * @param option the option
 * @returns the exact line to copy, or `undefined` when it is taken without one
 */
function optionCommand({ option }: { option: CardOption | StepOption }): string | undefined {
  if (!("how" in option)) {
    return option.command;
  }
  return option.how.kind === "elsewhere" ? option.how.command : undefined;
}

/**
 * The problem row and the stakes rows, each drawn only when the card carries it.
 *
 * Folded, these sit ABOVE the disclosure beside the what. A finding pull request's check-in card that drew one
 * sentence and a link left the owner unable to tell what problem it found, what it cost or why to care until they read
 * the pull request on GitHub; the rows give enough on the card to decide without stepping out to GitHub. The rows are the pull request's own cells
 * (`../../lib/findingActCard.ts`), each capped at 50 words by the form that wrote them (`src/prformat/checkCore.ts`
 * `MAX_WORDS`), so the fold's bound is the form's and nothing here rewrites them.
 *
 * What the card is about sits directly under the problem, so the problem and the thing it is about are read together
 * before any option. For an inbox-triage card that is its mail, folded per message the way a Slack preview folds
 * there. For a card asking the owner to confirm private words, it is those words, each with its own Yes and No.
 *
 * @param card the briefing card
 * @param known the pull-request URLs the row publishes
 * @param underProblem the card's subject as `<dt>`/`<dd>` rows it brings: the mail (`./CardMail.tsx`) or the private
 *   words (`./PrivateTermProposals.tsx`)
 * @returns the rows, as `<dt>`/`<dd>` pairs for the card's own list
 */
export function ProblemAndStakes({
  card,
  known,
  underProblem,
}: {
  card: BriefingCard;
  known: readonly string[];
  underProblem: ReactNode;
}): ReactElement {
  return (
    <>
      {card.problem !== undefined && (
        <>
          <dt>problem</dt>
          <dd>
            <InlineText text={card.problem} known={known} />
          </dd>
        </>
      )}
      {underProblem}
      {card.stakes !== undefined && <StakesRows stakes={card.stakes} known={known} />}
    </>
  );
}

/**
 * The risk and blast radius rows, the pair every card that states stakes leads them with: a Queue card's, and an
 * Alignment general-ruling card's (`./AlignmentRulings.tsx`), so the two read alike.
 *
 * @param stakes the two sentences
 * @param known the pull-request URLs the row publishes, so a `#N` a stake names links
 * @returns the rows, as `<dt>`/`<dd>` pairs for the card's own list
 */
export function RiskAndBlastRadiusRows({
  stakes,
  known,
}: {
  stakes: { readonly risk: string; readonly blastRadius: string };
  known: readonly string[];
}): ReactElement {
  return (
    <>
      <dt>risk</dt>
      <dd>
        <InlineText text={stakes.risk} known={known} />
      </dd>
      <dt>blast radius</dt>
      <dd>
        <InlineText text={stakes.blastRadius} known={known} />
      </dd>
    </>
  );
}

/**
 * The stakes rows — risk, blast radius and whether the problem still stands. A card stating none draws none.
 *
 * The still-real row leads on what happened, in the owner's terms — when they raised it and where, and when the fleet
 * last checked it stands (`../../lib/stillRealLead.ts`) — because a bare "confirmed 2.4d ago" folds both into one word
 * the owner cannot read. Every age is this panel's own clock against an instant a record carries, never
 * a date a session typed.
 *
 * @param stakes the card's stakes
 * @param known the pull-request URLs the row publishes, so a `#N` a stake names links
 * @returns the rows, as `<dt>`/`<dd>` pairs for the card's own list
 */
export function StakesRows({ stakes, known }: { stakes: CardStakes; known: readonly string[] }): ReactElement {
  const raisedAt = useContext(RaisedContext);
  if (stakes.kind === "pull-request") {
    return (
      <>
        <RiskAndBlastRadiusRows stakes={stakes} known={known} />
        <dt>PR status</dt>
        <dd>
          <b>{stakes.status}</b>: read {ageOf({ iso: stakes.checkedIso })}
        </dd>
      </>
    );
  }
  let raised: { where: HisWordsWhere; age: string } | undefined;
  if (raisedAt !== undefined) {
    raised = { age: ageOf({ iso: raisedAt.atIso }), where: raisedAt.where };
  }
  let checkedAge: string | undefined;
  if (stakes.checkedIso !== undefined) {
    checkedAge = ageOf({ iso: stakes.checkedIso });
  }
  const confirmed = stillRealLead({ checkedAge, raised });
  return (
    <>
      <RiskAndBlastRadiusRows stakes={stakes} known={known} />
      <dt>still real?</dt>
      <dd>
        <b>{confirmed}</b>: <InlineText text={stakes.stillReal} known={known} />
      </dd>
    </>
  );
}

/**
 * The options, one per line: the option's own sentence, its recorded trade-off, and — on a briefing option — how it
 * is taken. No option is a button: picking one is said aloud or in the call's chat with the card open — the console
 * takes no typed words, and an act card's two fixed verdicts are its Approve and Deny.
 *
 * A step card's options carry no `how` (`StepOption`): how an ask is answered is the panel's mechanics, and a
 * line of them under every option is the template text a step card bars.
 *
 * @param options the card's options
 * @param known the pull-request URLs the row publishes
 * @returns the list
 */
export function Options({
  options,
  known,
}: {
  options: readonly (CardOption | StepOption)[];
  known: readonly string[];
}): ReactElement {
  return (
    <ul className="m-0 grid list-none gap-2 p-0">
      {options.map((option) => (
        <li key={option.letter} className="grid grid-cols-[1.4rem_minmax(0,1fr)] items-start gap-[0.55rem]">
          <span className="inline-grid size-[1.4rem] place-items-center rounded-[6px] border border-border text-[0.7rem] font-bold text-muted-foreground">
            {option.letter}
          </span>
          <span className="min-w-0">
            <span className="after:text-muted-foreground after:content-['_·_'] last:after:content-none">
              <InlineText text={option.sentence} known={known} />
            </span>
            {option.tradeoff !== undefined && (
              <span className="text-[0.75rem] text-muted-foreground after:content-['_·_'] last:after:content-none [&_i]:font-semibold [&_i]:not-italic">
                <i>trade-off:</i> <InlineText text={option.tradeoff} known={known} />
              </span>
            )}
            {"how" in option && <How option={option} />}
          </span>
          <OptionCommand command={optionCommand({ option })} />
        </li>
      ))}
    </ul>
  );
}

/**
 * An option's command as a copy block on its own line under the option, so the owner pastes it rather than retyping
 * it: the owner is never shown a hand step without the command to copy.
 *
 * @param command the exact line, or `undefined` when the option has none
 * @returns the block, or nothing
 */
function OptionCommand({ command }: { command: string | undefined }): ReactElement | null {
  if (command === undefined) {
    return null;
  }
  return (
    // The option row's second column, so the block sits under the sentence and its separators stay the sentence's own.
    <div className="col-start-2 min-w-0">
      <CopyBlock text={command} />
    </div>
  );
}

/**
 * The local pages a card's record names, each a page citation chip under its own name, so a click and a
 * Command-click open the page rather than a `file://` address the browser refuses.
 *
 * @param pages the pages
 * @returns the list
 */
export function PagesList({ pages }: { pages: readonly CardPage[] }): ReactElement {
  return (
    <ul className="m-0 flex list-none flex-wrap gap-x-[0.8rem] gap-y-[0.35rem] p-0">
      {pages.map((page) => (
        <li key={page.url}>
          <CitationChip reference={{ kind: "address", url: page.url }}>{page.slug}</CitationChip>
        </li>
      ))}
    </ul>
  );
}
