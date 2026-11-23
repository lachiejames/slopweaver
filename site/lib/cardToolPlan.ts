/**
 * The card `read_card` and `open_card` name, from the Queue OR the Alignment page: what the voice is told of it, every
 * address it links, and the console address that puts it in front of the owner.
 *
 * The voice and the typed messenger are tested against every Queue AND Alignment card. Measured on that harness, every
 * Alignment act stood unread on both surfaces (`CARD_NOT_READ`) while the card tools resolved a key only among the
 * Queue's rows, which leave every act out on purpose — an act is never an action item (`./talkActionItems.ts`).
 * So the Alignment cards are resolved here BESIDE the Queue's, never merged into them: `action_items`, its counts and
 * its `recentlyLeft` are untouched, and a key on the Queue always resolves there first (`./openCard.ts`).
 *
 * One kind the Alignment page draws is a card a key names (`data-card-key`): the acts the fleet already took
 * (`act:<actionId>`, `../components/console/AlignmentAct.tsx`). A ruling question draws no card key, and the page asks
 * no voice question (the owner's voice is learnt from their Slack, `./alignmentVoice.ts`), so neither is here.
 */
import { type CardLinks, cardPagePath, cardPlanOf, type OpenCardPage, openCardPlan } from "./openCard";
import type { QueueRow } from "./queueRows";
import { markInView } from "./queueStopping";
import { cardForVoice } from "./queueVoice";
import type { CardRemoval, RecentlyLeftCard } from "./recentQueueDepartures";
import { CONTEXT_PARAM, contextAddressedBy, isWorkContext, WORK_CONTEXTS, withParamSet } from "./workContext";
import { shownInContext } from "./workspacePlacementContext";

/** The Alignment page's own path, which every Alignment card opens on. */
export const ALIGNMENT_PAGE_PATH = "/alignment";

/** Every card the Alignment page draws that a key names. */
export interface AlignmentCards {
  /** The acts it asks about, projected as the page projects them (`./talkActionItems.ts` `actionItemProjection`). */
  readonly acts: readonly QueueRow[];
  /**
   * The act keys a press in any window just settled, which the page hides at once (`../components/console/settling.tsx`,
   * shared across windows over its channel) and the registers still carry until they re-read.
   */
  readonly settled: readonly string[];
}

/** No Alignment card at all — a surface that resolves Queue cards only. */
export const NO_ALIGNMENT_CARDS: AlignmentCards = { acts: [], settled: [] };

/** One resolved card, as `read_card` answers with it and `open_card` opens it. */
export interface CardToolPlan {
  /** The card's own key, which an alias resolved to. */
  readonly key: string;
  /**
   * The page that draws the card. Only a Queue card is in the call's Queue walk (`./cardWalk.ts`): moving from one to an
   * Alignment card is not moving on to the next Queue card, so an act never takes a card off.
   */
  readonly page: "queue" | "alignment";
  /**
   * The Alignment act it resolved, as the registers project it, which a caller looks its pull request up for as the
   * page does before drawing it (`actToolPlan`); `undefined` for any other card.
   */
  readonly act: QueueRow | undefined;
  /** What the voice is told of the card — the console's card shape (`./queueVoice.ts` `cardForVoice`). */
  readonly card: unknown;
  /** When and why the card left the owner's Queue; `undefined` on any card still drawn. Only a Queue card ever leaves. */
  readonly removed: CardRemoval | undefined;
  /** The console address that puts the card in front of the owner, on the page that draws it. */
  readonly path: string;
  readonly links: CardLinks;
  /** The one page opened beside the card, or `undefined` when it links none. */
  readonly firstPage: OpenCardPage | undefined;
}

/**
 * The console path an act's address is built from: the one the owner is on, with its context switched to one that
 * draws the act when the owner's own would not. The Queue switches context for a hidden card itself
 * (`SwitchingPanel`); the Alignment page filters its acts by the context and draws nothing in its place, so an act
 * placed in the other context opened in the owner's would land on a page without it.
 *
 * @param fromPath the console's current path and query
 * @param row the act
 * @returns the path to build the act's address from
 */
export function actFromPath({ fromPath, row }: { fromPath: string; row: QueueRow }): string {
  const cut = fromPath.indexOf("?");
  const search = cut === -1 ? "" : fromPath.slice(cut);
  const asked = new URLSearchParams(search).get(CONTEXT_PARAM);
  const drawing = WORK_CONTEXTS.filter((context) => shownInContext({ context, placement: row.placement }));
  // Drawn in every context, in the one the owner is on, or in none this console switches to: the address as it is.
  // `at` answers `undefined` on an empty list in every tsconfig; an index does not under the site's.
  const first = drawing.at(0);
  if (first === undefined) {
    return fromPath;
  }
  if (drawing.length === WORK_CONTEXTS.length || (isWorkContext(asked) && drawing.includes(asked))) {
    return fromPath;
  }
  const path = cut === -1 ? fromPath : fromPath.slice(0, cut);
  return `${path}${withParamSet({ param: CONTEXT_PARAM, search, value: first })}`;
}

/**
 * A card as the voice reads it off the view the owner's address names (`canonicalSearch` writes it into every
 * address): a card that view does not draw as its own says whose it is, as its row there does — a Queue card or an
 * Alignment act alike.
 *
 * @param fromPath the console's current path and query, whose context is the view the owner is on
 * @returns the card with the mark that view says on it
 */
function voiceCardIn({ fromPath, row }: { fromPath: string; row: QueueRow }): unknown {
  const context = contextAddressedBy({ path: fromPath, stored: null });
  const shows = (one: Pick<QueueRow, "placement">): boolean => shownInContext({ context, placement: one.placement });
  return { ...cardForVoice({ row }), mark: markInView({ row, shows }) };
}

/**
 * Resolve the card one key names: on the owner's Queue, then among the cards that recently left it, then on the
 * Alignment page — an act by its key or an alias, as `?open=` takes them. The key is never trimmed: a padded key no
 * card answers to moves nothing.
 *
 * @param key the key the model named
 * @param rows every row the Queue draws, in both work contexts
 * @param recentlyLeft the cards that recently left the Queue
 * @param alignment every card the Alignment page draws that a key names
 * @param fromPath the console's current path and query, whose view choices the card's address keeps
 * @returns the plan, or `undefined` when no card answers to the key
 */
export function cardToolPlan({
  fromPath,
  key,
  rows,
  recentlyLeft,
  alignment,
}: {
  fromPath: string;
  key: string;
  rows: readonly QueueRow[];
  recentlyLeft: readonly RecentlyLeftCard[];
  alignment: AlignmentCards;
}): CardToolPlan | undefined {
  const queue = openCardPlan({ fromPath, key, recentlyLeft, rows });
  if (queue !== undefined) {
    const { firstPage, links, path, removed, row } = queue;
    return {
      act: undefined,
      card: voiceCardIn({ fromPath, row }),
      firstPage,
      key: row.key,
      links,
      page: "queue",
      path,
      removed,
    };
  }
  // A settled key resolves no act, even as an alias a newer, open act still folds.
  if (alignment.settled.includes(key)) {
    return undefined;
  }
  const act = openCardPlan({
    fromPath,
    key,
    recentlyLeft: [],
    rows: alignment.acts.filter((row) => !alignment.settled.includes(row.key)),
  });
  if (act === undefined) {
    return undefined;
  }
  return actToolPlan({ fromPath, row: act.row });
}

/**
 * One Alignment act's plan: the card as the console draws it, every address it links, and the Alignment page's
 * address in a work context that draws it. A finding act's row is passed here again once its pull request is looked
 * up (`../components/voice/openCardRun.ts`), so the card and its links are the ones the page draws.
 *
 * @param fromPath the console's current path and query
 * @param row the act, as drawn
 * @returns the plan
 */
export function actToolPlan({ fromPath, row }: { fromPath: string; row: QueueRow }): CardToolPlan {
  const { firstPage, links } = cardPlanOf({ fromPath, removed: undefined, row });
  const path = cardPagePath({ fromPath: actFromPath({ fromPath, row }), key: row.key, pathname: ALIGNMENT_PAGE_PATH });
  return {
    act: row,
    card: voiceCardIn({ fromPath, row }),
    firstPage,
    key: row.key,
    links,
    page: "alignment",
    path,
    removed: undefined,
  };
}
