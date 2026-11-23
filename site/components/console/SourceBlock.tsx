import type { ReactElement } from "react";

import type { CardSource } from "../../lib/queueCardSource";
import { type SourcePending, type SourceTone, sourceBlockCopy } from "../../lib/sourceBlock";
import type { SteersCopy, WordsFold } from "../../lib/sourceBlockWords";
import { cn } from "../../lib/utils";
import { ReadStandIn } from "../live/LiveMarks";
import { type Board, readBoard } from "../live/read";
import type { HisWordsCut } from "../live/readHisWords";
import { useLive } from "../live/useLive";
import { InlineText } from "./InlineText";
import { PlainWhy } from "./RawFold";
import { ReadingIndicator } from "./ReadingIndicator";
import { ReasonLines } from "./ReasonLines";
import { StaleMark } from "./StaleMark";

/** The frame each tone draws: the owner's words stand out, a refusal is amber, everything else stays quiet. */
const TONE: Readonly<Record<SourceTone, string>> = {
  "not-owner": "border-l-[3px] border-muted-foreground/30",
  owner: "border-l-[3px] border-primary/70 bg-primary/5",
  refused: "border-l-[3px] border-warning/70 bg-warning/10",
  unknown: "border-l-[3px] border-muted-foreground/30",
};

/** The ellipsis drawn where the record cut the owner's words — the page's mark, so muted and never part of the quote. */
const CUT_MARK = "text-muted-foreground";

/** The small uppercase label each part of the block opens with. */
const LABEL = "m-0 text-[0.68rem] font-bold tracking-[0.06em] text-muted-foreground uppercase";

/**
 * One quote of the owner's, verbatim, folded when it runs past the fold. The summary shows
 * the stretch that names what the card is about, speech noise dropped, with a muted ellipsis wherever more of the
 * owner's words stand around it; opening it shows every word as recorded.
 *
 * @param words the words and where the record cut them
 * @param fold how they fold, or `undefined` to draw them whole
 * @returns the quote
 */
function Quote({
  words,
  fold,
}: {
  words: { readonly text: string; readonly cut: HisWordsCut };
  fold: WordsFold;
}): ReactElement {
  const quote = (
    <blockquote className="m-0 text-[0.95rem] leading-[1.55] whitespace-pre-wrap">
      {words.cut === "start" && <span className={CUT_MARK}>… </span>}
      {words.text}
      {words.cut === "end" && <span className={CUT_MARK}> …</span>}
    </blockquote>
  );
  if (fold === undefined) {
    return quote;
  }
  return (
    <details data-words-fold className="group">
      <summary className="cursor-pointer text-[0.9rem] leading-[1.5]">
        {fold.moreBefore && <span className={CUT_MARK}>… </span>}
        <span className="italic">{fold.head}</span>
        {fold.moreAfter && <span className={CUT_MARK}> …</span>}{" "}
        <span className="text-[0.78rem] text-muted-foreground not-italic">
          your whole words, verbatim (about {fold.aboutChars} characters)
        </span>
      </summary>
      <div className="mt-1">{quote}</div>
    </details>
  );
}

/**
 * The board read a card's source waits on, off the shared board channel: its spinner, or its staleness mark. Nothing
 * once it has a reading, since the card's rows are rebuilt from it then.
 *
 * @param subject what the board read gives this card, mid-sentence
 * @returns the mark, or nothing
 */
function BoardMark({ subject }: { subject: string }): ReactElement | null {
  const board = useLive<Board>({ read: readBoard, slug: "board" });
  if (board.phase === "ready") {
    return null;
  }
  return <ReadStandIn state={board} subject={subject} />;
}

/**
 * The read a card's source waits on: its spinner while it reads, its staleness mark when it failed.
 *
 * @returns the mark, or nothing
 */
function PendingMark({ pending }: { pending: SourcePending }): ReactElement | null {
  const read = pending.read;
  if (read === "board") {
    return <BoardMark subject={pending.subject} />;
  }
  if (read.phase === "loading") {
    return <ReadingIndicator label={`Reading ${pending.subject}`} />;
  }
  return <StaleMark facts={[{ subject: pending.subject, why: read.why }]} />;
}

/**
 * A list of the owner's quotes, shut under one summary so the card never grows by a quote list unasked.
 *
 * @param steers the fold's copy
 * @param data which list it is, for the page's own selectors — the owner's steers on the card, or their words on its pull request
 * @returns the fold
 */
function SteersFold({ steers, data }: { steers: SteersCopy; data: "steers" | "pr-steers" }): ReactElement {
  return (
    <details data-steers={data} className="mt-1">
      <summary className="cursor-pointer text-[0.85rem] leading-[1.5]">{steers.summary}</summary>
      <ol className="m-0 mt-1 grid list-none gap-2 p-0">
        {steers.placed.map((steer) => (
          <li
            key={`${steer.line} ${steer.words.text}`}
            data-steer
            className="grid gap-0.5 border-l-2 border-primary/40 pl-2"
          >
            <Quote words={steer.words} fold={steer.fold} />
            <p className="m-0 text-[0.78rem] text-muted-foreground">
              <InlineText text={steer.line} />
            </p>
          </li>
        ))}
        {steers.unplaced.map((steer) => (
          <li key={steer.line} data-steer-unread className="border-l-2 border-warning/70 pl-2 text-[0.78rem]">
            {steer.why === undefined ? (
              <InlineText text={steer.line} />
            ) : (
              <div>
                <PlainWhy lead={steer.line} why={steer.why} />
              </div>
            )}
          </li>
        ))}
      </ol>
    </details>
  );
}

/**
 * The block an expanded queue card opens with, above its WHAT: the owner's own words and where they said them, or where the
 * card came from instead. The words are drawn as plain text — never through the
 * citation linker — because they are a quote, and a quote rewritten into chips is no longer verbatim. The sentence
 * beside them is the page's own, so a person or address it names is a chip.
 *
 * Then, in the owner's order: every further steer of theirs on it, oldest first, shut under one
 * summary so the card does not grow by a list unasked; and last, why the card is in front of the owner — the registering
 * session's bears-on line, plain text like the words above it.
 *
 * @param source the card's source (`../../lib/queueCardSource.ts`)
 * @returns the block
 */
export function SourceBlock({ source }: { source: CardSource }): ReactElement {
  const copy = sourceBlockCopy({ source });
  const line = copy.sessionSteps;
  const steers = copy.steers;
  return (
    <section data-card-source={source.kind} className={cn("grid gap-1 rounded-r-md px-3 py-2", TONE[copy.tone])}>
      <h4 className={LABEL}>{copy.label}</h4>
      {copy.words !== undefined && <Quote words={copy.words} fold={copy.fold} />}
      <p className="m-0 text-[0.78rem] text-muted-foreground" title={copy.hover}>
        <InlineText text={line.lead} />
        {copy.pending !== undefined && (
          <>
            {line.lead === "" ? null : " "}
            <PendingMark pending={copy.pending} />
          </>
        )}
      </p>
      {/* A session's own steps, shut: drawn whole they made this block a wall of commands the owner never runs. */}
      {line.steps.length > 0 && (
        <details data-session-steps className="text-[0.78rem] text-muted-foreground">
          <summary className="cursor-pointer">what a session can do about it</summary>
          <p className="m-0 mt-1">
            <InlineText text={line.steps.join(" ")} />
          </p>
        </details>
      )}
      {/* Beneath the line, never inside its `<p>`: each quoted read's reason folds its raw message (steer 7). */}
      {copy.quoted.length > 0 && (
        <div className="text-[0.78rem] text-muted-foreground" data-source-quoted>
          <ReasonLines reason={copy.quoted} />
        </div>
      )}
      {steers !== undefined && <SteersFold steers={steers} data="steers" />}
      {copy.prSteers !== undefined && <SteersFold steers={copy.prSteers} data="pr-steers" />}
      {copy.bearsOn !== undefined && (
        <>
          <h4 className={cn(LABEL, "mt-1")}>why this is in front of you</h4>
          {/* Plain text, like the owner's words: a name matched into a chip mid-sentence is what this line removed. */}
          <p data-bears-on className="m-0 text-[0.9rem] leading-[1.45]">
            {copy.bearsOn}
          </p>
        </>
      )}
    </section>
  );
}
