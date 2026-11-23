/**
 * Where the owner was reading in the conversation, so it survives the history being drawn somewhere else: a tray open
 * in the corner carries across, keeping the place, when the owner goes full screen. The corner's Messenger tray and
 * the stage each mount their own history (`components/voice/StageHistory.tsx`), so the place is kept as the row the
 * owner was reading and how far
 * its top sat from the list's, never a pixel offset that means nothing in a list of another size. Pure.
 */

/** The row at the top of the owner's view, and where its top sat relative to the list's top, in pixels (negative above it). */
export interface ReadingPlace {
  readonly row: string;
  readonly offset: number;
}

/** One drawn row's key and its top and bottom edges, in the window's pixels. */
export interface RowBox {
  readonly row: string;
  readonly top: number;
  readonly bottom: number;
}

/**
 * The place a held history is at: the first row whose bottom is below the list's top, which is the row the owner is
 * reading from, and how far its top sits from the list's top.
 *
 * @param rows the drawn rows, in the order they are drawn
 * @param listTop the scrolling list's top edge, in the window's pixels
 * @returns the place, `undefined` with no row in view
 */
export function readingPlaceOf({
  rows,
  listTop,
}: {
  rows: readonly RowBox[];
  listTop: number;
}): ReadingPlace | undefined {
  const reading = rows.find((row) => row.bottom > listTop);
  if (reading === undefined) {
    return undefined;
  }
  return { offset: reading.top - listTop, row: reading.row };
}

/**
 * The list's scroll that puts a kept place's row back where it sat, and whether it can. A list taller than the one
 * the place was kept in may run out of turns below the row before the row reaches its offset: the
 * scroll stops at the foot, the row is still in view, and what the owner sees is the live end, so the list follows rather
 * than holding a place it could not reach. A row too near the top for its offset stops at the top, still held.
 *
 * @param place the kept place
 * @param rowTop that row's top edge now, in the window's pixels
 * @param listTop the list's top edge, in the window's pixels
 * @param scrollTop the list's scroll now
 * @param maxScrollTop the furthest the list scrolls: its scroll height less its own height
 * @returns the scroll to set, and whether the list holds there or follows from its foot
 */
export function scrollTopFor({
  place,
  rowTop,
  listTop,
  scrollTop,
  maxScrollTop,
}: {
  place: ReadingPlace;
  rowTop: number;
  listTop: number;
  scrollTop: number;
  maxScrollTop: number;
}): { readonly top: number; readonly held: boolean } {
  const wanted = scrollTop + (rowTop - listTop) - place.offset;
  // Half a pixel: a scroll position is fractional on a scaled display, and the foot itself is a place to follow from.
  if (wanted >= maxScrollTop - 0.5) {
    return { held: false, top: maxScrollTop };
  }
  return { held: true, top: Math.max(0, wanted) };
}

/**
 * Where the owner was reading, kept by the widget across every history it draws: read when one opens, kept as they scroll.
 * Two callbacks rather than the box itself, so a history never writes into what it was handed.
 */
export interface PlaceKeeper {
  /** The place kept now, `undefined` while the owner follows the live end. */
  readonly read: () => ReadingPlace | undefined;
  /** Keeps a new place, or `undefined` once the owner is back at the live end. */
  readonly keep: (place: ReadingPlace | undefined) => void;
}
