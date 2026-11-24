"use client";

import type { ReactElement, ReactNode } from "react";

import type { QueueCard } from "../../lib/queueCard";
import type { CardSource } from "../../lib/queueCardSource";
import type { ReasonWords } from "../../lib/quotedReason";
import type { StalenessFact } from "../../lib/stalenessLabel";
import type { HisWordsWhere } from "../live/readHisWords";
import { SLIDE_BODY, SLIDE_BODY_FOLDED } from "../live/SlideOver";
import { BriefingFields, ExampleRow, PasteRow, WhatRow } from "./QueueCardBodyBriefing";
import { FIELDS, PagesList, ProblemAndStakes, RaisedContext } from "./QueueCardBodyFields";
import { CardHeadRows, CitationFinding } from "./QueueCardBodyHead";
import { StepFields, StepScriptRows } from "./QueueCardBodyStep";
import { PlainWhy } from "./RawFold";
import { ReasonLines } from "./ReasonLines";
import { SourceBlock } from "./SourceBlock";
import { StaleMark } from "./StaleMark";

/**
 * One queue row drawn as a fleet-briefing react-now card — the shape the owner wants in place of the autonomy
 * ledger's raw `<dl>` row as the open card.
 *
 * The order is the briefing's own, and it is the whole point: what, the problem and its stakes, why you, the
 * options, the lean, what happens if you say nothing — and the record's own fields folded away beneath as labelled lines.
 * `skills/supervisor/reference/fleet-briefing-shape.md` is the contract; `site/lib/queueCard.ts` derives
 * every sentence from the register's own fields, because the console runs no model (`AGENTS.md` rule 2).
 *
 * The numbered QUESTION is not here: it is the drawer's own heading (`site/lib/drawerHead.ts`), which is
 * the briefing's pairing — a one-sentence question, its subject line under it — in place of a generic "Recorded
 * ask" heading. Drawn in both places it would be a verbatim second copy one line below the first.
 *
 * Nothing here composes text. This module decides only where a derived sentence sits on the page.
 */

/** No published pull requests — one stable array, so the default is not a fresh one on every render. */
const NO_PRS: readonly string[] = [];

/**
 * A card's `mail` row. The slot brings its own label rather than the card adding one round it, so a card whose
 * mail turns out to be nothing (a row that pinned none) draws no empty `mail` heading.
 *
 * @param children the mail, or the line saying it is still reading or did not read
 * @returns the `<dt>`/`<dd>` pair for the card's own list
 */
export function MailField({ children }: { children: ReactNode }): ReactElement {
  return (
    <>
      <dt>mail</dt>
      <dd>{children}</dd>
    </>
  );
}

/**
 * The card body: the six fields above the fold, and everything else behind a fold the owner chooses to open.
 *
 * @param card the derived card
 * @param details the register's own fields as labelled lines, plus whatever reader the panel adds
 * @param aside the reasoning's grid items: the right-hand column of properties and what moved since it opened, and a
 *   Checked section spanning the body beneath it (`./PanelReasoning.tsx`)
 * @param preview what the row OFFERS, drawn above the options — today the Slack draft an ask carries
 *   (`./SlackActionPreview.tsx`). Above them because the options are choices about the thing previewed:
 *   "post it to #delivery" is not a decision the owner can take until they have read what would be posted.
 * @param links where the row can be checked — the pull request, the board row — drawn directly under the
 *   what, because an act the owner is asked to judge is judged on its implementation and proof as well as its idea.
 *   It carries the card's local pages too, so the separate pages row is not
 *   drawn beside it — the same page twice on one card. Without links, that pages row sits in the same place, above
 *   the draft and the options: the page is what answers the owner's questions, and they cannot approve a draft until
 *   it has, so the card leads with what resolves the confusion rather than going straight to an approve ask.
 * @param known the pull-request URLs the row publishes, so a `#N` the what names without its address still links
 * @param folded draw the WHAT, the links, the problem and the stakes above the fold and put the rest of the
 *   briefing, the record and the aside behind one disclosure — the act panel's shape, by progressive
 *   disclosure. The WHAT leads, because it is the entire thing being asked and everything else is boilerplate beside
 *   it. The problem and stakes join it only when the card carries them ({@link ProblemAndStakes}).
 * @param refused the one sentence a card REFUSED by its form draws instead of the briefing (`../../lib/queueActRow.ts`
 *   `ActCardForm`): the links and the record stay, and no problem, stakes, lean or option row is drawn at all, so a
 *   card that cannot be filled with its real subject never shows a register's absence sentence in their place
 * @param source where the card came from — the owner's words, or the fleet — drawn first in every branch, refused and
 *   folded alike, because it is the one thing the owner reads before deciding whether the card is theirs at all
 * @param figure a picture the card carries — a hand step's provider page (`./HandShot.tsx`) — drawn last inside the
 *   scrolling body, never beside it, where a picture's height would squeeze the body to a strip
 * @param underProblem what the card asks about, drawn under the problem in both the folded and unfolded arrangements:
 *   the mail an inbox-triage card pinned (`./CardMail.tsx`), each message a closed row of its own, or the private
 *   words a confirm card names (`./PrivateTermProposals.tsx`), each with its own Yes and No
 * @param thread the Slack thread the card is ABOUT (`./SlackThread.tsx`), drawn as its first field in every
 *   arrangement, ahead of the WHAT: the thread itself rather than a sentence describing it, the way the owner would
 *   stumble on it in Slack, never a sentence telling them about it
 * @param reasonWhy the read's own reason behind a sentence the card's row carries in the console's words — a detached
 *   ask's doc that would not read (`../../lib/detachedAskRow.ts`) — said plainly beneath the card, the raw folded
 * @returns the body
 */
export function QueueCardBody({
  card,
  details,
  aside,
  preview,
  links,
  known = NO_PRS,
  folded = false,
  refused,
  refusedMark,
  source,
  figure,
  underProblem,
  thread,
  reasonWhy,
}: {
  card: QueueCard;
  details: ReactNode;
  aside: ReactNode;
  preview?: ReactNode;
  links?: ReactNode;
  known?: readonly string[];
  folded?: boolean;
  refused?: ReasonWords;
  /** A read the card is drawn from that failed: drawn as its staleness mark in the refusal's place, never a sentence. */
  refusedMark?: StalenessFact;
  source: CardSource;
  figure?: ReactNode;
  underProblem?: ReactNode;
  thread?: ReactNode;
  reasonWhy?: string;
}): ReactElement {
  let raised: { where: HisWordsWhere; atIso: string } | undefined;
  if (source.kind === "words") {
    raised = { atIso: source.quote.atIso, where: source.quote.where };
  }
  return (
    <RaisedContext.Provider value={raised}>
      <CardBody
        card={card}
        details={details}
        aside={aside}
        preview={preview}
        links={links}
        known={known}
        folded={folded}
        refused={refused}
        refusedMark={refusedMark}
        source={source}
        figure={figure}
        underProblem={underProblem}
        thread={thread}
        reasonWhy={reasonWhy}
      />
    </RaisedContext.Provider>
  );
}

/**
 * The folded card's disclosure line, naming only what the fold actually holds: a briefing card with no `why you` or
 * no `if silent` (an ask carries neither) does not promise one.
 *
 * @returns the summary line
 */
function foldSummary({ card }: { card: QueueCard }): string {
  if (card.kind !== "briefing") {
    return "the rest: why it is yours, the options and what silence does";
  }
  const parts: string[] = [];
  if (card.whyYou !== undefined) {
    parts.push("why it is yours");
  }
  parts.push("the options");
  if (card.ifSilent !== undefined) {
    parts.push("what silence does");
  }
  const last = parts.pop()!;
  if (parts.length === 0) {
    return `the rest: ${last}`;
  }
  return `the rest: ${parts.join(", ")} and ${last}`;
}

/**
 * The card body inside the card's own raised-at context — every branch {@link QueueCardBody} names, with its props.
 *
 * @returns the body
 */
function CardBody({
  card,
  details,
  aside,
  preview,
  links,
  known,
  folded,
  refused,
  refusedMark,
  source,
  figure,
  underProblem,
  thread,
  reasonWhy,
}: {
  card: QueueCard;
  details: ReactNode;
  aside: ReactNode;
  preview: ReactNode;
  links: ReactNode;
  known: readonly string[];
  folded: boolean;
  refused: ReasonWords | undefined;
  refusedMark: StalenessFact | undefined;
  source: CardSource;
  figure: ReactNode;
  underProblem: ReactNode;
  thread: ReactNode;
  reasonWhy: string | undefined;
}): ReactElement {
  const linksRow = links !== undefined && (
    <>
      <dt>links</dt>
      <dd>{links}</dd>
    </>
  );
  // A refused card draws neither field set, so its pages are drawn here, by the rule `BriefingFields` keeps: a links
  // strip, when the panel passes one, already carries them. Without them a refused ask would hide the briefing the voice
  // reads through it.
  const pagesRow = links === undefined && card.pages.length > 0 && (
    <>
      <dt>pages</dt>
      <dd>
        <PagesList pages={card.pages} />
      </dd>
    </>
  );
  const threadRow = thread !== undefined && (
    <dl className={FIELDS} data-card-thread="">
      <dt>thread</dt>
      <dd>{thread}</dd>
    </dl>
  );
  // A `<div>`, never inside a `<p>` or a `<dl>` text node: the read's reason folds its raw message beneath (steer 7).
  const reasonRow = reasonWhy !== undefined && (
    <div className="text-[0.84rem] text-muted-foreground" data-card-reason-why="">
      <PlainWhy why={reasonWhy} />
    </div>
  );
  let briefing: ReactElement;
  if (card.kind === "step") {
    briefing = (
      <StepFields card={card} preview={preview} links={folded ? undefined : links} known={known} folded={folded} />
    );
  } else {
    briefing = (
      <BriefingFields
        card={card}
        preview={preview}
        links={links}
        folded={folded}
        known={known}
        underProblem={underProblem}
      />
    );
  }
  if (refused !== undefined) {
    return (
      <div className={SLIDE_BODY_FOLDED}>
        <div>
          <article className="grid gap-[0.9rem]">
            <CardHeadRows card={card} />
            <SourceBlock source={source} />
            <CitationFinding card={card} known={known} />
            {threadRow}
            <dl className={FIELDS}>
              {linksRow}
              {pagesRow}
              <dt>card</dt>
              <dd data-stated="false">
                {refusedMark === undefined ? (
                  <ReasonLines reason={refused} known={known} />
                ) : (
                  <StaleMark facts={[refusedMark]} />
                )}
              </dd>
            </dl>
            {reasonRow}
            {figure}
            <details className="group [&>aside]:mt-4">
              <summary className="cursor-pointer text-[0.82rem] text-muted-foreground group-open:mb-[0.8rem]">
                the ledger record
              </summary>
              {details}
              {aside}
            </details>
          </article>
        </div>
      </div>
    );
  }
  if (folded) {
    let lead: ReactElement | null = (
      <>
        {card.kind === "briefing" && <ExampleRow card={card} known={known} />}
        {card.kind === "briefing" && <WhatRow card={card} known={known} />}
        {card.kind === "briefing" && <PasteRow card={card} />}
      </>
    );
    if (card.kind === "step") {
      const scripted = card.copy !== undefined || card.checklist !== undefined;
      lead = scripted ? <StepScriptRows card={card} known={known} /> : null;
    }
    return (
      <div className={SLIDE_BODY_FOLDED}>
        <div>
          <article className="grid gap-[0.9rem]">
            <CardHeadRows card={card} />
            <SourceBlock source={source} />
            <CitationFinding card={card} known={known} />
            {threadRow}
            {(lead !== null || links !== undefined) && (
              <dl className={FIELDS}>
                {lead}
                {linksRow}
                {card.kind !== "step" && <ProblemAndStakes card={card} known={known} underProblem={underProblem} />}
              </dl>
            )}
            {reasonRow}
            {figure}
            <details className="group [&>aside]:mt-4">
              <summary className="cursor-pointer text-[0.82rem] text-muted-foreground group-open:mb-[0.8rem]">
                {foldSummary({ card })}
              </summary>
              {briefing}
              {details}
              {aside}
            </details>
          </article>
        </div>
      </div>
    );
  }
  return (
    <div className={SLIDE_BODY}>
      <div>
        <article className="grid gap-[0.9rem]">
          <CardHeadRows card={card} />
          <SourceBlock source={source} />
          <CitationFinding card={card} known={known} />
          {threadRow}
          {briefing}
          {reasonRow}
          {details}
          {figure}
        </article>
      </div>
      {aside}
    </div>
  );
}
