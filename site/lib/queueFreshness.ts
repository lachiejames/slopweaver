/**
 * How recently each queue row was last CONFIRMED to still stand, and whether that is too long ago to trust.
 *
 * Rows 7.3 days and 35 hours old sat at the top of the queue with nothing saying which were still live. A row's own
 * date — when the ask was made, when the step was posted — says how long it has
 * waited, not whether anyone has looked since, and those are different questions. So every row carries the
 * instant something last confirmed it (`verifiedIso`) and what did the confirming, and a row whose
 * confirmation is older than {@link STALE_AFTER_HOURS} — or that was never re-confirmed and was asked longer
 * ago than that — is marked stale in text the owner can see.
 *
 * It imports NOTHING, for the reason `./queueCard.ts` states in full: the unit lane reaches this file from a
 * root that resolves modules differently from the site, and a file with no imports typechecks under both.
 * The clock is a parameter for the same reason a unit test may not read the real one.
 */

/**
 * Hours after which a row's last confirmation is too old to take on trust.
 *
 * Six, restated from `src/handover/reconcile.ts`'s `ASK_STALE_HOURS` rather than imported (`site/` never
 * imports `src/`): that is the threshold the board's reconcile pass already names an ask at, so the console
 * and the reconcile report call the same row stale at the same moment.
 */
export const STALE_AFTER_HOURS = 6;

/** What the queue can say about one row's freshness. */
export interface RowFreshness {
  /** The instant shown as "verified", or `undefined` when nothing has re-confirmed the row since it was made. */
  readonly verifiedIso: string | undefined;
  /** Whole hours since that instant — or since the row was made, when it was never re-confirmed. */
  readonly hoursOld: number | undefined;
  /** True past {@link STALE_AFTER_HOURS}, and on a row whose instant will not parse: an unreadable date is no confirmation. */
  readonly stale: boolean;
}

/**
 * Hours between an ISO instant and now, or `undefined` when the instant will not parse.
 *
 * @param iso the instant
 * @param nowMs the clock, passed in
 * @returns the elapsed hours, never negative
 */
function hoursSince({ iso, nowMs }: { iso: string; nowMs: number }): number | undefined {
  const at = new Date(iso).getTime();
  if (Number.isNaN(at)) {
    return undefined;
  }
  return Math.max(0, (nowMs - at) / 3_600_000);
}

/**
 * Judge one row's freshness from when it was last confirmed, falling back to when it was made ONLY to age it.
 *
 * A row never re-confirmed keeps `verifiedIso` undefined, so the page says "never re-confirmed" rather than
 * dressing the ask's own date up as a check nobody ran; its staleness is then judged from `madeIso`.
 *
 * @param verifiedIso when something last confirmed the row still stands
 * @param madeIso when the row was made — the ask, the post, the step
 * @param nowMs the clock, passed in
 * @returns the freshness the row renders
 */
export function rowFreshness({
  verifiedIso,
  madeIso,
  nowMs,
}: {
  verifiedIso: string | undefined;
  madeIso: string | undefined;
  nowMs: number;
}): RowFreshness {
  let judged = madeIso;
  if (verifiedIso !== undefined) {
    judged = verifiedIso;
  }
  if (judged === undefined) {
    // Nothing dates the row at all: no instant proves it current, so it is marked rather than trusted.
    return { hoursOld: undefined, stale: true, verifiedIso };
  }
  const hours = hoursSince({ iso: judged, nowMs });
  if (hours === undefined) {
    return { hoursOld: undefined, stale: true, verifiedIso };
  }
  return { hoursOld: hours, stale: hours >= STALE_AFTER_HOURS, verifiedIso };
}
