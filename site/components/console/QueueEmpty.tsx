"use client";

/** What the queue's list draws in place of cards: the empty line, and why a tag-narrowed list cannot place them yet. */
import type { ReactElement } from "react";

import type { EmptyListDraw } from "../../lib/registerFreshness";
import type { StalenessFact } from "../../lib/stalenessLabel";
import { EMPTY, PageEmpty } from "./PageEmpty";
import { ReadingIndicator } from "./ReadingIndicator";
import { StaleMark } from "./StaleMark";
import type { QueueReading } from "./useQueueRows";
import { HiddenNote } from "./workContextState";

/**
 * The staleness fact for cards whose tags read only in part off a board that answered because a read failed: a
 * document, a row's run journal or a tag that did not wholly read, so a tag-borne view cannot place those cards.
 *
 * @param count how many cards read their tags only in part through a failed read
 * @returns the fact
 */
export function partialTagsFact({ count }: { count: number }): StalenessFact {
  return {
    subject: `the tags of ${String(count)} card(s), which a tag-borne view sorts by`,
    why: "a board document, a run journal or a tag behind them did not wholly read, so a tag-borne view cannot say whether they belong; Everything shows them",
  };
}

/**
 * The words for cards a tag-borne view cannot place because each names a slug several board rows carry — the data,
 * not a failed read, so it is said rather than marked stale.
 *
 * @param count how many such cards
 * @returns the words, or `undefined` when there are none
 */
export function ambiguousTagsWords({ count }: { count: number }): string | undefined {
  if (count === 0) {
    return undefined;
  }
  return `${String(count)} card(s) name a slug several board rows carry, so a tag-borne view cannot say whether they belong; Everything shows them`;
}

/**
 * Why a list narrowed by tags draws nothing yet: a spinner while the board reads, a staleness mark when it did not,
 * a staleness mark naming the cards whose tags a failed read left in part, and in words the cards an ambiguous slug
 * leaves unplaced.
 *
 * @param board the board register, which every card's tags come from
 * @param partial how many cards read their tags only in part, by why
 * @returns the stand-in
 */
export function UnknownTags({
  board,
  partial,
}: {
  board: QueueReading["board"];
  partial: { failed: number; ambiguous: number };
}): ReactElement {
  if (board.phase === "not-measured") {
    return <StaleMark facts={[{ subject: "The board this view needs", why: board.why }]} block />;
  }
  // A card waiting on the board's first read has its tags absent only because that read is in flight, so the
  // spinner leads; the part-read mark is a fact only once the board has answered.
  if (board.phase === "ready" && partial.failed + partial.ambiguous > 0) {
    const facts = partial.failed > 0 ? [partialTagsFact({ count: partial.failed })] : [];
    if (board.stale !== undefined) {
      facts.push({
        observedAtIso: board.observedAtIso,
        subject: "the board this view's tags come from",
        why: board.stale.why,
      });
    }
    const words = ambiguousTagsWords({ count: partial.ambiguous });
    return (
      <>
        {facts.length > 0 && <StaleMark facts={facts} block />}
        {words !== undefined && <p className={EMPTY}>{words}</p>}
      </>
    );
  }
  return <ReadingIndicator label="Reading the board this view's tags come from" block />;
}

/**
 * What an empty list draws (`../../lib/registerFreshness.ts` `emptyListDraw`): the designed empty state (`PageEmpty`,
 * the `data-page-empty="queue"` mark `desktop e2e` reads as a proven empty Queue, with Settings → Models offered only
 * while no plan is known connected, and Setup folded into Settings); a
 * spinner while a register is read or re-read; else the staleness mark naming every register that could not be read —
 * never a sentence standing in for the cards. The Plans button carries no `data-kind`, so the walk never opens it as a
 * card. Under the designed empty state it says how many cards the other context holds, so an empty Queue is never read
 * as a quiet one while the other context waits on the owner, and while that count is unread it says so.
 *
 * @param draw what the registers allow the list to say
 * @param hidden how many cards only the other context draws, `undefined` while unread
 * @returns the line or its stand-in
 */
export function EmptyList({ draw, hidden }: { draw: EmptyListDraw; hidden: number | undefined }): ReactElement {
  switch (draw.kind) {
    case "measured-zero":
      return (
        <>
          <PageEmpty
            title="Queue cards will appear here."
            appearsWhen="A card appears when something needs your word: a pull request to land, a question from a run, or an ask recorded for you."
            action={{ kind: "plans" }}
            surface="queue"
          />
          <HiddenNote hidden={hidden} one="card" what="cards" />
        </>
      );
    case "reading":
      return <ReadingIndicator label={draw.label} block />;
    case "stale":
      // Emptied only by a register kept over a failed read: the plain line every page draws, then the reason.
      return (
        <>
          <p className="m-0 mb-[0.4rem] text-[0.84rem] text-muted-foreground">
            No cards as of the last reading that answered.
          </p>
          <StaleMark facts={draw.facts} block />
        </>
      );
    default: {
      const unreachable: never = draw;
      return unreachable;
    }
  }
}
