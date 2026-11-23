/**
 * The eyebrow's two instants, written the way the owner reads a clock — and the exact shape the gate reads
 * back out of the rendered page.
 *
 * The owner needs exact timestamps on when the page was last refreshed and ready for review, so as never to
 * have to ask whether the artefact being read is up to date. Two things follow from "exact", and both are
 * the reason this is a module rather than a line in the renderer.
 *
 * **The zone is named on the page.** `YYYY-MM-DD HH:MM:SS` is not exact if a reader has to guess whose clock
 * it is, and a page rendered from a machine set to UTC would read hours behind the owner's own day for no
 * visible reason. So every stamp carries its zone abbreviation, resolved for `Australia/Melbourne`, which
 * also means the same instant reads as `AEST` in winter and `AEDT` in summer without anything here knowing
 * about daylight saving.
 *
 * **The FORMAT is contract.** `../../briefing/shape.ts` refuses a page whose eyebrow does not carry both
 * stamps, and it recognises one by {@link MELBOURNE_STAMP}. A renderer free to format an instant its own way
 * would be a renderer that can quietly stop satisfying the gate that reads it, so the writer and the reader
 * share this file the way every cap is shared through `../../briefing/caps.ts`.
 *
 * ## It arrived on the ranked-list page and it lives here now
 *
 * It was written for `src/outbound/rankedList/` and moved when that page was folded
 * into the briefing's own react-now block. Nothing about it changed in the move: the eyebrow it stamps is
 * the same eyebrow, answering the same question of the owner's, and the briefing's header carries the two instants
 * as ISO fields for exactly the reason the ranked list did — a freshness claim a composer can write is a
 * freshness claim that can be current-looking on a stale page.
 *
 * Pure — no clock of its own. The instant is always supplied.
 */

import { BRIEFING_TIME_ZONE } from "../../briefing/localDay.js";

/**
 * The zone every stamp on this page is resolved in. The owner's own, and stated rather than assumed.
 *
 * Imported rather than declared, so this stamp and the day boundaries the narrative sections are grouped by
 * cannot drift apart — see `../../briefing/localDay.ts`.
 */
const PAGE_TIME_ZONE = BRIEFING_TIME_ZONE;

/**
 * One rendered stamp: `YYYY-MM-DD HH:MM:SS AEST`.
 *
 * The zone abbreviation is `[A-Z]{3,5}` rather than a fixed pair, because the same zone resolves to `AEST`
 * and `AEDT` across the year and a node build without full ICU data resolves it to `GMT+10` — a page
 * rendered on one of those is still honest about its instant, and refusing it would refuse the machine
 * rather than the page.
 */
export const MELBOURNE_STAMP = /\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} (?:[A-Z]{3,5}|GMT[+-]\d{1,2}(?::\d{2})?)/;

/** The parts a stamp is assembled from, in the order this file writes them. */
const PARTS = new Intl.DateTimeFormat("en-AU", {
  day: "2-digit",
  hour: "2-digit",
  hour12: false,
  minute: "2-digit",
  month: "2-digit",
  second: "2-digit",
  timeZone: PAGE_TIME_ZONE,
  timeZoneName: "short",
  year: "numeric",
});

/**
 * One instant as the eyebrow states it.
 *
 * Assembled from `formatToParts` rather than from a locale's own ordering, because `en-AU` writes
 * `DD/MM/YYYY, HH:MM:SS AEST` and a page whose date reads `01/09` is a page an American reader — or a
 * machine-written check — reads as the first of September or the ninth of January depending on habit. The
 * order is fixed here to the ISO one, which orders correctly when sorted and cannot be misread.
 *
 * Deliberately NOT total on a bad input: an unparseable instant throws out of `Intl` rather than degrading
 * to a plausible-looking string, and `./schema.ts`'s own instant refinement is what guarantees the instant
 * parsed before this ran.
 *
 * @param iso the instant, ISO-8601
 * @returns the stamp, matching {@link MELBOURNE_STAMP}
 */
export function stampMelbourne({ iso }: { iso: string }): string {
  const parts = new Map(PARTS.formatToParts(new Date(iso)).map((part) => [part.type, part.value]));
  // Every one of these seven parts was ASKED FOR in `PARTS`, so a missing one is a broken `Intl`, not a
  // formatting variation. The assertions are honest: there is no sensible page to render without them, and
  // an empty-string fallback would put `2026--01 :07:42` on an artifact the owner reads as authoritative.
  const date = `${parts.get("year")!}-${parts.get("month")!}-${parts.get("day")!}`;
  const time = `${parts.get("hour")!}:${parts.get("minute")!}:${parts.get("second")!}`;
  return `${date} ${time} ${parts.get("timeZoneName")!}`;
}
