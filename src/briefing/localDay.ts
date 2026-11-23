/**
 * Which DAY an instant belongs to, in the zone the briefing is read in.
 *
 * "Earlier today" and "history" are the two sections a tick ledger is grouped into, so the whole projection
 * turns on one question — which day is this row on — and the answer has to be the owner's day rather than the
 * machine's. A supervisor sweeping in a Melbourne morning on a machine set to UTC is in the previous day's
 * evening by `Date`'s own reckoning, so a UTC day key would put ten hours of the owner's morning under yesterday's fold.
 *
 * `../outbound/briefing/stamp.ts` already resolved this for the page's eyebrow and for the same reason: an
 * instant is not exact if a reader has to guess whose clock it is. This module carries the zone so the two
 * cannot drift apart, and the stamp imports it rather than declaring a second copy.
 *
 * ## Never compute the offset
 *
 * Australia/Melbourne is `AEST` in winter and `AEDT` in summer, and the transitions repeat one local hour in
 * April and skip one in October. Arithmetic on a fixed offset is wrong twice a year, and wrong in the
 * direction that silently moves a tick into the wrong fold. So the key is read out of
 * `Intl.DateTimeFormat.formatToParts`, which knows the zone's own rules, and the boundary cases are pinned by
 * `src/__tests__/unit/briefing/localDay.test.ts` rather than trusted.
 *
 * Pure — no clock of its own. The instant is always supplied.
 */

/** The zone the briefing's day boundaries and its eyebrow are both resolved in. The owner's own. */
export const BRIEFING_TIME_ZONE = "Australia/Melbourne";

/** The parts a day key is assembled from. Module-scoped so the formatter is built once. */
const DAY_PARTS = new Intl.DateTimeFormat("en-AU", {
  day: "2-digit",
  month: "2-digit",
  timeZone: BRIEFING_TIME_ZONE,
  year: "numeric",
});

/**
 * The local day an instant falls on, as `YYYY-MM-DD`.
 *
 * Sortable as a string, which is what lets the projection order days without parsing them back.
 *
 * @param iso the instant, in any form `Date` accepts
 * @returns the local day key, or the empty string when the instant is not readable
 */
export function localDayKey({ iso }: { iso: string }): string {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) {
    return "";
  }
  const parts = DAY_PARTS.formatToParts(new Date(ms));
  const year = parts.find((part) => part.type === "year");
  const month = parts.find((part) => part.type === "month");
  const day = parts.find((part) => part.type === "day");
  if (year === undefined || month === undefined || day === undefined) {
    return "";
  }
  return `${year.value}-${month.value}-${day.value}`;
}
