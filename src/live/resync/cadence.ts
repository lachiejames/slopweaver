/**
 * Turning a declared freshness WINDOW into the five-field cron a recipe definition carries.
 *
 * An atlas already declares how stale it may get (`atlas/kit/freshnessWindow.ts`, four hours by default,
 * per atlas by declaration) and a corpus source has the same policy under a different name. A definition
 * row carries a CRON. Those are two numbers that mean nearly the same thing, and writing both by hand is
 * how they drift — so the cron is DERIVED here and the window stays the single source of truth. Change an
 * atlas's `freshnessWindow` and its schedule moves with it on the next registration pass.
 *
 * ## A window is a maximum age; a cron is a set of opportunities
 *
 * They are related, not equivalent, and this module never pretends otherwise. There is no
 * clock: a due row runs because a VISIBLE session decided it should, so any opportunity can be
 * missed and no derivation here can guarantee an elapsed maximum. What it can guarantee is that the
 * opportunities come round at least as often as the window allows, which is the honest half.
 *
 * So the mapping is deliberately CONSERVATIVE: the largest regular period no longer than the window.
 * Regular means the firings are evenly spaced across the day, which is why the candidates are the divisors
 * of an hour and of a day rather than any step value. A five-step in the hour field fires at 00, 05, 10, 15 and 20 and
 * then waits four hours, so a window that "fits" it is judged against a gap it never actually gets.
 *
 * A window between one and seven days is capped at daily rather than expressed in the day-of-month field,
 * because a two-step there means "the 1st, 3rd, 5th … and then the 31st and the 1st back to back", which is
 * not a 48-hour interval and reads exactly as though it were. Cloudflare's two-day window therefore gets a
 * daily schedule: running it more often than it declares is the deliberate trade for a cron that does not
 * lie.
 *
 * A window of a WEEK or more resolves to weekly, because the day-of-week field has no such hole: one named
 * weekday IS a regular seven-day period. That arm exists for the atlases whose source barely moves — a
 * surface map compiled from a vendor's published document, so a daily pass republishes the same bytes (the
 * cadence page: 34 of 35 captured compile-only syncs matched the one before it). Nothing coarser than weekly is derived: a monthly day-of-month is the same lie
 * as a two-day step.
 */
import { renderDuration } from "../../lib/duration.js";
import { err, ok, type Result } from "../../lib/result.js";

/** Minutes that divide an hour evenly, largest first, so the first match is the largest fitting period. */
const REGULAR_MINUTES: readonly number[] = [30, 20, 15, 12, 10, 6, 5, 4, 3, 2, 1];

/** Hours that divide a day evenly, largest first, for the same reason. */
const REGULAR_HOURS: readonly number[] = [24, 12, 8, 6, 4, 3, 2, 1];

const MS_PER_MINUTE = 60 * 1000;
const MS_PER_HOUR = 60 * MS_PER_MINUTE;

/** The cron a window of a day up to a week resolves to — midnight local, every day. */
const DAILY_CADENCE = "0 0 * * *";

/** The cron a window of a week or more resolves to — midnight local, every Sunday. */
const WEEKLY_CADENCE = "0 0 * * 0";

const MS_PER_DAY = 24 * MS_PER_HOUR;
const MS_PER_WEEK = 7 * MS_PER_DAY;

/**
 * The five-field cron for one declared window.
 *
 * @param windowMs the declared maximum age, in milliseconds
 * @returns the cron expression, or the one reason the window cannot be scheduled
 */
export function deriveResyncCadence({ windowMs }: { readonly windowMs: number }): Result<string> {
  if (!Number.isFinite(windowMs) || windowMs < MS_PER_MINUTE) {
    return err([
      `a freshness window of ${String(windowMs)}ms cannot become a cron cadence — the finest a five-field ` +
        "cron expresses is one minute, and a window shorter than that would schedule a resync it can never keep up with",
    ]);
  }
  if (windowMs >= MS_PER_WEEK) {
    return ok(WEEKLY_CADENCE);
  }
  if (windowMs >= MS_PER_DAY) {
    return ok(DAILY_CADENCE);
  }
  if (windowMs >= MS_PER_HOUR) {
    const hours = REGULAR_HOURS.find((candidate) => candidate * MS_PER_HOUR <= windowMs);
    // Safe: the branch above proved the window is at least one hour, and 1 is in the list.
    return ok(hourlyCadence({ hours: hours! }));
  }
  const minutes = REGULAR_MINUTES.find((candidate) => candidate * MS_PER_MINUTE <= windowMs);
  // Safe: the guard above proved the window is at least one minute, and 1 is in the list.
  return ok(`*/${String(minutes!)} * * * *`);
}

/** The cron for a whole number of hours, spelling the once-a-day case without a pointless twenty-four step. */
function hourlyCadence({ hours }: { readonly hours: number }): string {
  if (hours === 24) {
    return DAILY_CADENCE;
  }
  return `0 */${String(hours)} * * *`;
}

/**
 * The sentence a report prints when a derived cadence fires more often than the window asked for.
 *
 * Only the capped cases produce one: a window of two days scheduled daily, or of two weeks scheduled weekly,
 * is doing MORE work than declared, and a reader comparing the two columns deserves to be told why rather
 * than left to spot it. A window declared with headroom over its cadence is the usual reason — the firing
 * lands when a visible session runs it, not on the minute, so a window equal to its period reads behind for
 * part of every period.
 *
 * @param windowMs the declared window
 * @param cadence the cadence {@link deriveResyncCadence} returned for it
 * @returns the note, or `null` when the cadence matches the window's own period
 */
export function cadenceNote({
  windowMs,
  cadence,
}: {
  readonly windowMs: number;
  readonly cadence: string;
}): string | null {
  const window = renderDuration({ ms: windowMs });
  if (cadence === DAILY_CADENCE && windowMs > MS_PER_DAY) {
    return (
      `declares a ${window} window and is scheduled daily — a five-field cron cannot express a period ` +
      "between a day and a week without the day-of-month field lying about its interval, so it resyncs " +
      "more often than it asks to"
    );
  }
  if (cadence === WEEKLY_CADENCE && windowMs > MS_PER_WEEK) {
    return (
      `declares a ${window} window and is scheduled weekly — weekly is the coarsest period a five-field ` +
      "cron expresses honestly, so it resyncs more often than it asks to"
    );
  }
  return null;
}
