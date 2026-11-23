/**
 * The one line a reader meets on the owner's folded list: how many rows, how old the read is, and — for a run cut short
 * at its `--deadline` — which parts it did not read.
 */
import type { BriefingYourList } from "./types.js";

/**
 * How long before the page was rendered the world it reports was actually read, in words.
 *
 * A list that carried the raw read instant read as stale and cost the reader's trust in everything below the
 * cards, and it WAS hours old. So the
 * section states its own age in the summary a reader meets rather than making them subtract two timestamps in
 * two different zones, and it is folded, so an old section never competes with a current card.
 *
 * An ELAPSED measurement, never an estimate — the two instants are both stamped by the verb.
 *
 * @param readIso when the list was read
 * @param readyIso when this page was rendered
 * @returns the gap in words, as `47 minutes` or `3 hours 47 minutes`
 */
function elapsed({ readIso, readyIso }: { readIso: string; readyIso: string }): string {
  const minutes = Math.max(0, Math.round((Date.parse(readyIso) - Date.parse(readIso)) / 60_000));
  if (minutes < 60) {
    return `${String(minutes)} minutes`;
  }
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (rest === 0) {
    return `${String(hours)} hours`;
  }
  return `${String(hours)} hours ${String(rest)} minutes`;
}

/**
 * The folded list's summary, as plain text the caller escapes.
 *
 * A list cut short names what it skipped right here, on the line a reader meets, rather than only below the fold: a
 * shorter list that looked whole would read as a quieter world.
 *
 * @param list the projected list
 * @param readyIso when this page was rendered
 * @returns the summary text
 */
export function yourListSummary({ list, readyIso }: { list: BriefingYourList; readyIso: string }): string {
  const age = elapsed({ readIso: list.readIso, readyIso });
  const cut = list.cutShort === undefined ? "" : `. Cut short, not read: ${list.cutShort.join(", ")}`;
  return `${String(list.rows.length)} ranked rows — read ${age} before this page was rendered${cut}`;
}
