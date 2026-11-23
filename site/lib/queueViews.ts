/**
 * The Queue's one selector: a handful of views over the cards, each with how many it holds. Pure.
 *
 * The selector is one control, not a filter bar: it moves between what is urgent for the owner, what is blocking the
 * fleet, what is a new investigation finding and what is a prepared draft, with how many of each at a glance. The
 * first entry is "all"; each other entry offers its own view with the count beside it, and a view such as Slack drafts
 * selects just those.
 *
 * So a view is a READING POSITION, never a saved filter: one at a time, carried in the address as `?view=` so a link
 * the supervisor hands the owner opens on it, and absent for every card. Views overlap on purpose — a Slack draft blocking
 * a colleague is in both — because each answers its own question.
 */
import type { CardTag, QueueTags } from "./queueTagsInherited";
import type { WaitingTier } from "./waitingRank";

/** The query parameter the view rides in. */
export const VIEW_PARAM = "view";

/** Every view the selector offers, `all` first. */
export type QueueView = "all" | "urgent" | "colleague" | "fleet" | "slack" | "review" | "finding" | "check-in";

/** What a view needs of a card: its register, its tier and its tags. */
export interface ViewCard extends QueueTags {
  readonly kind: string;
  readonly tier: WaitingTier;
}

/** The views in the order the selector lists them, each with its words. */
export const QUEUE_VIEWS: readonly { readonly view: QueueView; readonly label: string }[] = [
  { label: "Everything", view: "all" },
  { label: "Urgent", view: "urgent" },
  { label: "Blocking a colleague", view: "colleague" },
  { label: "Blocking the fleet", view: "fleet" },
  { label: "Slack drafts", view: "slack" },
  { label: "Reviews under your name", view: "review" },
  { label: "New findings", view: "finding" },
  { label: "Check-ins", view: "check-in" },
];

/**
 * Whether a card's tags provably carry one value. A card whose inherited tags did not read whole proves nothing
 * (`matchesTags`, `./queueTags.ts`), so a tag-borne view never claims one.
 *
 * @returns true when the card reads whole and carries the tag
 */
function carries({ card, tag }: { card: QueueTags; tag: CardTag }): boolean {
  return card.tagsRead === "whole" && card.tags.some((each) => each.key === tag.key && each.value === tag.value);
}

/**
 * Whether a card is in a view.
 *
 * @returns true when the view shows the card
 */
export function inView({ card, view }: { card: ViewCard; view: QueueView }): boolean {
  switch (view) {
    case "all": {
      return true;
    }
    case "urgent": {
      return (
        carries({ card, tag: { key: "priority", value: "p0" } }) ||
        carries({ card, tag: { key: "priority", value: "p1" } })
      );
    }
    case "colleague": {
      return card.tier === "team-blocked";
    }
    case "fleet": {
      return card.tier === "fleet-blocked";
    }
    case "slack": {
      return card.kind === "draft" || card.kind === "post";
    }
    case "review": {
      return card.kind === "review";
    }
    case "finding": {
      return carries({ card, tag: { key: "origin", value: "finding" } });
    }
    case "check-in": {
      return card.tier === "check-in";
    }
    default: {
      const never: never = view;
      return never;
    }
  }
}

/**
 * Whether a view reads a card's inherited tags, so its count waits on the board.
 *
 * @returns true for a tag-borne view
 */
export function viewReadsTags({ view }: { view: QueueView }): boolean {
  return view === "urgent" || view === "finding";
}

/**
 * How many cards each view holds, in the selector's order. Every count is `undefined` until every register has read,
 * the same refusal the sidebar badge makes: a partial count is smaller than the truth, presented as the truth. A
 * tag-borne view's count also waits on the board, because every card's tags come from it.
 *
 * @param cards the cards on screen, after any tag selection
 * @param unnarrowed the same cards before a tag selection narrowed them — a selection hides every card whose tags read
 *   in part, and a hidden one may still belong to the selection and a tag-borne view
 * @param allRead whether every register has read, so no count is over half the queue
 * @param boardRead whether the board has read, so inherited tags are known
 * @returns each view with its words and its count
 */
export function viewCounts({
  cards,
  unnarrowed,
  allRead,
  boardRead,
}: {
  cards: readonly ViewCard[];
  unnarrowed: readonly ViewCard[];
  allRead: boolean;
  boardRead: boolean;
}): readonly { readonly view: QueueView; readonly label: string; readonly count: number | undefined }[] {
  // A card whose tags read only in part can be neither counted into a tag-borne view nor out of it, whether
  // it is on screen or a tag selection hid it.
  const tagsWhole = boardRead && unnarrowed.every((card) => card.tagsRead === "whole");
  return QUEUE_VIEWS.map(({ view, label }) => {
    if (!allRead || (viewReadsTags({ view }) && !tagsWhole)) {
      return { count: undefined, label, view };
    }
    return { count: cards.filter((card) => inView({ card, view })).length, label, view };
  });
}

/**
 * The view an address names, or `all` for none and for a word that is not a view — a mistyped link opens on every
 * card rather than an empty Queue that reads as a verdict.
 *
 * @param value the `view` parameter, or `null` when the address has none
 * @returns the view
 */
export function viewOf({ value }: { value: string | null }): QueueView {
  const known = QUEUE_VIEWS.find((each) => each.view === value);
  if (known === undefined) {
    return "all";
  }
  return known.view;
}

/**
 * The words a view is listed under.
 *
 * @returns the label
 */
export function viewLabel({ view }: { view: QueueView }): string {
  return QUEUE_VIEWS.find((each) => each.view === view)!.label;
}

/**
 * Set the view in a query string, keeping every other parameter; `all` drops it.
 *
 * @param search the current query string, with or without its `?`
 * @returns the new query string, `?`-prefixed, or `""` when nothing is left
 */
export function withView({ search, view }: { search: string; view: QueueView }): string {
  const params = new URLSearchParams(search);
  params.delete(VIEW_PARAM);
  if (view !== "all") {
    params.set(VIEW_PARAM, view);
  }
  const query = params.toString();
  if (query === "") {
    return "";
  }
  return `?${query}`;
}
