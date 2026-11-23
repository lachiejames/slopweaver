/**
 * The Alignment page's steers chart arithmetic: how many times the owner steered each week, split into steers given for
 * the first time and steers they had to give again, on the days of THEIR calendar.
 *
 * The chart shows, over time, the owner giving fewer steers, so the count to drive down is giving the same steer again.
 * Every point is one time the owner steered, read
 * off the steer register (`slopweaver handover steers --json`): a row's own `askedIso` is the first time, each further
 * steer folded onto the row (`againIsos`) a time the owner said it again. One turn is one point, the unit the Slack
 * chart counts too.
 *
 * What it cannot say, and the page says so: whether a steer is about capacity or about alignment. Whether a turn names
 * a kind is a session's READ, never a keyword match (`src/profile/steerKinds.ts`), and nothing journals
 * that read for call steers yet.
 *
 * A time that cannot be placed — no instant kept, an instant that does not parse, or one later than the reading — is
 * counted as unplaced rather than dropped, so the columns plus the unplaced always equal every time the list counts.
 */

import type { SteerView } from "../components/live/readSteers";
import { perDay, windowDays } from "./slackSteers";

/** One column: a run of up to seven of the owner's days, newest last, and how many times they steered in it. */
export interface SteersWeek {
  /** The first day it covers, `YYYY-MM-DD` on the owner's calendar. */
  readonly fromDay: string;
  /** The last day it covers. */
  readonly throughDay: string;
  /** How many days it covers: seven, or fewer for the oldest when the window is not whole weeks. */
  readonly dayCount: number;
  /** Steers the owner gave for the first time in it. */
  readonly firstGiven: number;
  /** Times in it the owner gave a steer already given. */
  readonly saidAgain: number;
}

/** One series' times, split by whether a column holds them. */
export interface SteersSeriesCount {
  readonly placed: number;
  readonly unplaced: number;
}

/** What the chart draws. */
export interface SteersChart {
  /** Oldest first; empty when no time the owner steered can be placed. */
  readonly weeks: readonly SteersWeek[];
  readonly firstGiven: SteersSeriesCount;
  readonly saidAgain: SteersSeriesCount;
}

/** Whether an instant can sit on the axis: it parses, and it is not after the reading that reports it. */
function placeable({ iso, observedMs }: { iso: string | undefined; observedMs: number }): boolean {
  if (iso === undefined) {
    return false;
  }
  const at = Date.parse(iso);
  return !Number.isNaN(at) && at <= observedMs;
}

/** The axis's days in right-aligned runs of seven, so the newest column ends today and the oldest may be short. */
function weekRuns({ days }: { days: readonly string[] }): readonly (readonly string[])[] {
  const runs: (readonly string[])[] = [];
  for (let end = days.length; end > 0; end -= 7) {
    runs.unshift(days.slice(Math.max(0, end - 7), end));
  }
  return runs;
}

/** A run's sum of one series' day counts, the run starting at `from` on the axis. */
function sumOver({ counts, from, length }: { counts: readonly number[]; from: number; length: number }): number {
  return counts.slice(from, from + length).reduce((sum, one) => sum + one, 0);
}

/**
 * The chart for a steer register, on the owner's calendar.
 *
 * @param steers each steer's first instant and its said-again instants, as the register reports them
 * @param observedAtIso when the register was read — the axis ends on that day
 * @param timeZone an IANA zone, the owner's browser's own
 * @returns the columns, oldest first, and every time split into placed and unplaced
 */
export function steersChart({
  steers,
  observedAtIso,
  timeZone,
}: {
  steers: readonly Pick<SteerView, "askedIso" | "againIsos">[];
  observedAtIso: string;
  timeZone: string;
}): SteersChart {
  const observedMs = Date.parse(observedAtIso);
  const firsts = steers.map((steer) => steer.askedIso);
  const agains = steers.flatMap((steer) => steer.againIsos);
  const placedFirsts = firsts.filter((iso): iso is string => placeable({ iso, observedMs }));
  const placedAgains = agains.filter((iso): iso is string => placeable({ iso, observedMs }));
  const firstGiven = { placed: placedFirsts.length, unplaced: firsts.length - placedFirsts.length };
  const saidAgain = { placed: placedAgains.length, unplaced: agains.length - placedAgains.length };
  const placed = [...placedFirsts, ...placedAgains];
  if (placed.length === 0) {
    return { firstGiven, saidAgain, weeks: [] };
  }
  const oldest = placed.reduce((least, iso) => (Date.parse(iso) < Date.parse(least) ? iso : least));
  const days = windowDays({ nowIso: observedAtIso, sinceIso: oldest, timeZone });
  const firstCounts = perDay({ days, isos: placedFirsts, timeZone });
  const againCounts = perDay({ days, isos: placedAgains, timeZone });
  let from = 0;
  const weeks = weekRuns({ days }).map((run): SteersWeek => {
    const week = {
      dayCount: run.length,
      firstGiven: sumOver({ counts: firstCounts, from, length: run.length }),
      fromDay: run.at(0)!,
      saidAgain: sumOver({ counts: againCounts, from, length: run.length }),
      throughDay: run.at(-1)!,
    };
    from += run.length;
    return week;
  });
  return { firstGiven, saidAgain, weeks };
}

/**
 * A day key as the page prints it, a short day and month — the key is already the owner's calendar day, so it is read in UTC, never moved.
 *
 * @param day a `YYYY-MM-DD` key
 * @returns the label
 */
export function dayLabel({ day }: { day: string }): string {
  return new Date(Date.parse(day)).toLocaleDateString("en-AU", { day: "numeric", month: "short", timeZone: "UTC" });
}

/**
 * Which columns carry a printed total and date: every one while they fit, otherwise every k-th counted back from the
 * newest, so the week the owner is in is always labelled and no more than `most` labels share the width. A label on every
 * column of a long history is a few pixels wide and truncates to nothing; every column still names itself in full on
 * hover, on focus and in the table.
 *
 * @param count how many columns the chart draws
 * @param most the most labels the width holds
 * @returns one flag per column, oldest first
 */
export function labelledColumns({ count, most }: { count: number; most: number }): readonly boolean[] {
  const stride = Math.max(1, Math.ceil(count / Math.max(1, most)));
  return Array.from({ length: count }, (_, at) => (count - 1 - at) % stride === 0);
}
