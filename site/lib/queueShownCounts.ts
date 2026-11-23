/**
 * The Queue's counts as the app shows them — the view selector's figures, the sidebar badge's — computed by the same
 * pure calls, in the same order, over the same rendered rows `Queue.tsx` and `ShellBadges.tsx` draw from
 * (`../components/console/useQueueRows.ts`). Pure, so the voice's count check reads exactly what the owner sees.
 *
 * A count the voice says must be one the app shows: once the voice said "That covers fourteen cards" while the
 * selector said Everything 29, the badge Queue 26, and the list "Blocking the fleet · 26" and "Check-ins · 3", and
 * nothing the voice read held a fourteen. This snapshot is what a count it says is checked against
 * (`./talkCountGrounding.ts`).
 *
 * It also carries how many cards the OTHER work context holds. Measured: the work context's Queue read Everything (0)
 * while `/queue?context=slopweaver` read Everything (20), and the voice's `action_items` said
 * `context work shown.Everything 0` with nothing naming the twenty, so an empty Queue read as a quiet one.
 */

import { queueCounts } from "./queueCardCounts";
import { type StoppingStamp, shownOnQueue } from "./queueStopping";
import { matchesTags, parseTagParams, TAG_PARAM, type TagSelection } from "./queueTags";
import { QUEUE_VIEWS, type QueueView, VIEW_PARAM, type ViewCard, viewCounts, viewOf } from "./queueViews";
import { otherContextLabel, otherWorkContext, type WorkContext } from "./workContext";
import type { WorkspacePlacement } from "./workspacePlacementBasis";

/** What the Queue's address selects: its tag filter and its view. Empty and `all` off the Queue. */
export interface QueueScope {
  readonly selection: TagSelection;
  readonly view: QueueView;
}

/** Every count the app prints over the Queue, labelled, `undefined` wherever the app prints no number. */
export interface QueueShownCounts {
  /** The selector's "Everything" — every card under the tag filter. */
  readonly everything: number | undefined;
  /** The sidebar's Queue badge: the cards waiting on the owner's word, check-ins apart. */
  readonly waiting: number | undefined;
  /** Each view's selector count. */
  readonly views: Readonly<Record<QueueView, number | undefined>>;
  /** The view the Queue has open. */
  readonly view: QueueView;
  /**
   * The cards the context switch hides: the other context's id, and how many of its cards this context does not draw,
   * before any tag filter or view. `undefined` until every register drew, as Everything is.
   */
  readonly otherContext: { readonly context: WorkContext; readonly count: number | undefined };
}

/**
 * The Queue's placeable rows split by the context switch: the ones this context draws — its own, and a card stopping the
 * owner's work, which every context draws (`./queueStopping.ts` `shownOnQueue`) — and the ones only the other context
 * draws. One split, so the page, the voice and the hidden count can never disagree about which card went where.
 *
 * @param placeable every row the Queue could draw in either context, before any tag filter or view
 * @param shows whether a row belongs to the context being looked at
 * @returns the rows drawn here, and the rows the other context holds
 */
export function queueContextRows<
  T extends { readonly placement: WorkspacePlacement; readonly stopping?: StoppingStamp },
>({
  placeable,
  shows,
}: {
  placeable: readonly T[];
  shows: (row: T) => boolean;
}): { readonly rows: readonly T[]; readonly otherRows: readonly T[] } {
  const rows: T[] = [];
  const otherRows: T[] = [];
  for (const row of placeable) {
    if (shownOnQueue({ row, shows })) {
      rows.push(row);
    } else {
      otherRows.push(row);
    }
  }
  return { otherRows, rows };
}

/**
 * The Queue's scope from an address, by the rule `useQueueTags` applies: the tag filter and view are read only on the
 * Queue itself, so anywhere else the badge counts every row in the context.
 *
 * @param pathname the page's path
 * @param search the page's query, with or without its leading `?`
 * @returns the tag selection and the open view
 */
export function queueScopeOf({ pathname, search }: { pathname: string; search: string }): QueueScope {
  if (pathname !== "/queue" && pathname !== "/queue/") {
    return { selection: parseTagParams({ values: [] }), view: "all" };
  }
  const params = new URLSearchParams(search);
  return {
    selection: parseTagParams({ values: params.getAll(TAG_PARAM) }),
    view: viewOf({ value: params.get(VIEW_PARAM) }),
  };
}

/**
 * The Queue's scope from the path the voice holds. In the desktop shell's voice window that path is the console
 * window's published one, query and all (`publishedPath`, `./pageVoice.ts`); in a browser it is the pathname alone and
 * the query is the window's own. A path carrying a query is read whole, never mixed with the window's.
 *
 * @param path the page's path as the voice holds it, with or without a query
 * @param search the window's own query, read only when the path carries none
 * @returns the tag selection and the open view
 */
export function queueScopeAt({ path, search }: { path: string; search: string }): QueueScope {
  const at = path.indexOf("?");
  if (at === -1) {
    return queueScopeOf({ pathname: path, search });
  }
  return queueScopeOf({ pathname: path.slice(0, at), search: path.slice(at) });
}

/**
 * The counts the app shows over one rendered reading. The selector's figures are `viewCounts` over the tag-filtered
 * rows, as `Queue.tsx` draws them; the badge is `queueCounts` over the same rows, printed only once every register it
 * counts has read, as `ShellBadges.tsx`'s `QueueBadgeCount` refuses a number otherwise.
 *
 * @param rows the rendered rows in the current work context — `useQueueRows().rows`
 * @param otherRows the rows only the other context draws — `useQueueRows().otherRows`
 * @param context the context being looked at, whose other one the hidden count names
 * @param allDrawn whether every register has a reading drawn — `useQueueRows().allDrawn`
 * @param splitRead whether the workstreams and steers readings, which move a card into both contexts or off the list,
 *   answered their latest read — `useQueueRows().splitRead`; until both have, the other context's figure is unread
 * @param boardRead whether the board has read, so inherited tags are known
 * @param badgeRead whether every register the badge counts read its latest poll and nothing is missing
 * @param scope the Queue's tag filter and open view
 * @returns every count, labelled
 */
export function queueShownCounts({
  rows,
  otherRows,
  context,
  allDrawn,
  splitRead,
  boardRead,
  badgeRead,
  scope,
}: {
  rows: readonly ViewCard[];
  otherRows: readonly unknown[];
  context: WorkContext;
  allDrawn: boolean;
  splitRead: boolean;
  boardRead: boolean;
  badgeRead: boolean;
  scope: QueueScope;
}): QueueShownCounts {
  const filtered = rows.filter((row) => matchesTags({ card: row, selection: scope.selection }));
  const counted = viewCounts({ allRead: allDrawn, boardRead, cards: filtered, unnarrowed: rows });
  const of = ({ view }: { view: QueueView }): number | undefined => counted.find((each) => each.view === view)!.count;
  const views: Record<QueueView, number | undefined> = {
    all: of({ view: "all" }),
    "check-in": of({ view: "check-in" }),
    colleague: of({ view: "colleague" }),
    finding: of({ view: "finding" }),
    fleet: of({ view: "fleet" }),
    review: of({ view: "review" }),
    slack: of({ view: "slack" }),
    urgent: of({ view: "urgent" }),
  };
  let waiting: number | undefined;
  if (badgeRead) {
    waiting = queueCounts({ rows: filtered }).waiting;
  }
  let hidden: number | undefined;
  if (allDrawn && splitRead) {
    hidden = otherRows.length;
  }
  return {
    everything: views.all,
    otherContext: { context: otherWorkContext({ context }), count: hidden },
    view: scope.view,
    views,
    waiting,
  };
}

/**
 * The view selector's entries, in the selector's order, with the figure each one prints — what `QueueViewBar` draws.
 *
 * @returns each view with its label and count
 */
export function selectorViews({
  shown,
}: {
  shown: QueueShownCounts;
}): readonly { readonly view: QueueView; readonly label: string; readonly count: number | undefined }[] {
  return QUEUE_VIEWS.map(({ label, view }) => ({ count: shown.views[view], label, view }));
}

/** The counts as `action_items` hands them to the thinking model: each under the label the app prints, or `unread`. */
export type ShownForVoice = Readonly<Record<string, number | "unread">>;

/**
 * The counts as the thinking model reads them: one field per label the app prints — `Everything`, `Queue` (the
 * badge), the other context's hidden cards under a label naming that context, each view — with `unread` where the app
 * prints no number. A count it says is one of these fields, by name (`TALK_BACKEND_INSTRUCTIONS`).
 *
 * @returns the labelled counts
 */
export function shownForVoice({ shown }: { shown: QueueShownCounts }): ShownForVoice {
  const fields: Record<string, number | "unread"> = {
    Everything: countOrUnread({ count: shown.everything }),
    Queue: countOrUnread({ count: shown.waiting }),
    [otherContextLabel({ context: shown.otherContext.context })]: countOrUnread({ count: shown.otherContext.count }),
  };
  for (const { label, view } of QUEUE_VIEWS) {
    if (view !== "all") {
      fields[label] = countOrUnread({ count: shown.views[view] });
    }
  }
  return fields;
}

/**
 * A count as the thinking model reads it.
 *
 * @returns the number, or `unread`
 */
function countOrUnread({ count }: { count: number | undefined }): number | "unread" {
  if (count === undefined) {
    return "unread";
  }
  return count;
}

/**
 * The counts as one line, for a tool line and a correction to name: each figure under the label the app prints it
 * with, and the ones it prints none for said as unread.
 *
 * @returns e.g. `Everything 29, Queue 26, Blocking the fleet 26, Check-ins 3`
 */
export function shownCountsLine({ shown }: { shown: QueueShownCounts }): string {
  const parts = [`Everything ${numberOrUnread({ count: shown.everything })}`];
  parts.push(`Queue ${numberOrUnread({ count: shown.waiting })}`);
  for (const { label, view } of QUEUE_VIEWS) {
    if (view !== "all" && shown.views[view] !== 0) {
      parts.push(`${label} ${numberOrUnread({ count: shown.views[view] })}`);
    }
  }
  if (shown.otherContext.count !== 0) {
    const label = otherContextLabel({ context: shown.otherContext.context });
    parts.push(`${label} ${numberOrUnread({ count: shown.otherContext.count })}`);
  }
  return parts.join(", ");
}

/**
 * A count as the line prints it.
 *
 * @returns the number, or `unread`
 */
function numberOrUnread({ count }: { count: number | undefined }): string {
  if (count === undefined) {
    return "unread";
  }
  return String(count);
}
