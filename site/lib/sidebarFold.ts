/**
 * How a fold discloses a list: the first few entries when it opens, the rest behind a "N more" fold the reader opens
 * themself (rule 7, no walls of text).
 *
 * Opening the build line in the desktop app's sidebar once drew hundreds of lines of about three words each, pushing the sidebar past the
 * screen: the build fold drew every commit the console and the app were missing — up to 50 each (`MAINLINE_LIMIT`) in
 * a 220px column. The build's changes live in a release-notes modal (`ReleaseNotesModal.tsx`) instead, which folds
 * them this way.
 */

/** A list split into what shows when its fold opens and what waits behind its "N more" fold. */
export interface FoldedList<T> {
  /** The leading entries, shown as soon as the fold opens. */
  readonly shown: readonly T[];
  /** Every remaining entry, in order, behind the "more" fold. */
  readonly hidden: readonly T[];
  /** The "more" fold's label, such as `47 more commits`; absent when nothing is hidden. */
  readonly more: string | undefined;
}

/**
 * Split an ordered sidebar list into its preview and the remainder the reader discloses.
 *
 * @param items entries in display order, never reordered or dropped
 * @param shown how many lead entries show when the fold opens
 * @param noun the entry's name in the "more" label, singular and plural
 * @returns the preview, the remainder and the remainder's label
 */
export function foldList<T>({
  items,
  shown,
  noun,
}: {
  readonly items: readonly T[];
  readonly shown: number;
  readonly noun: { readonly one: string; readonly many: string };
}): FoldedList<T> {
  const lead = items.slice(0, shown);
  const hidden = items.slice(lead.length);
  if (hidden.length === 0) {
    return { hidden, more: undefined, shown: lead };
  }
  const name = hidden.length === 1 ? noun.one : noun.many;
  return { hidden, more: `${hidden.length} more ${name}`, shown: lead };
}
