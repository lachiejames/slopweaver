/**
 * Whether the Friction Review artifact is behind the report it is supposed to show — and whether anything
 * is still writing those reports at all.
 *
 * A self-improvement recipe row writes a dated report to
 * `$SLOPWEAVER_HOME/morning/self-improvement-YYYY-MM-DD.md` and does NOT
 * publish it anywhere itself — the supervisor's sweep republishes the Friction Review page from that file
 * with `reflect friction-review --republish` (`./frictionReviewPage.ts` renders it). This gauge is what makes
 * the hand-off checkable: a missed sweep was once silent until a human noticed the page looked stale, which is
 * the gap this module was built to close.
 *
 * ## Why the comparison needs a clock, measured
 *
 * Comparing the newest report against the publish stamp and nothing else has a blind spot that is exactly
 * the failure the gauge exists to catch: **both inputs come from the same stalled world.** When the
 * producer dies the report date stops advancing, the last hand republish stamps it, and the gap closes for
 * good. Measured once: `slopweaver reflect friction-review` printed `current — <report-date> is republished`
 * seventeen days after the last report was written, and `briefing/narrativeSources.ts` rendered that same
 * reading to the Fleet Briefing as "nothing waiting".
 *
 * The producing row was gone from `$SLOPWEAVER_HOME/live/recipe/definitions/` — the standing scheduler
 * stopped dispatching after `live/recipe/lifecycle.jsonl`'s last record and the
 * row never came back. So {@link FrictionReviewGap} carries two INDEPENDENT verdicts: {@link
 * FrictionReviewGap.hasGap} asks whether the hand-off was missed, and {@link FrictionReviewGap.isStale}
 * asks whether the producer is still alive. That reading is the case that proves they must be
 * separate — `hasGap: false`, `isStale: true`.
 *
 * Pure: no fs, no clock. Today's date is an INPUT, exactly as the other two dates are. The shell that
 * lists `$home/morning`, reads the stamp and supplies the clock lives in
 * `cli/commands/reflect/frictionReviewRun.ts`.
 */
import { parseYyyyMmDdUtcMs } from "../lib/date.js";

/** One dated report's filename shape: `self-improvement-YYYY-MM-DD.md`. */
const REPORT_FILENAME = /^self-improvement-(\d{4}-\d{2}-\d{2})\.md$/;

/** Milliseconds in one calendar day, the unit both report dates are expressed in. */
const MS_PER_DAY = 86_400_000;

/*
 * Derived from the row's own observed cadence rather than picked. The lifecycle log holds
 * `self-improvement|<date>|<time>` on consecutive days — a daily row firing at
 * one time of day — so two days is the smallest value that cannot fire on one ordinary run slipping past midnight,
 * while still catching a dead producer on its second missed day rather than its seventeenth. It also
 * absorbs the one-day UTC/local skew described on `staleAfterDays` below. Read the cadence back with:
 *
 *   grep -o 'self-improvement|[0-9-]*|[0-9:]*' "$SLOPWEAVER_HOME/live/recipe/lifecycle.jsonl" | tail -3
 *
 * `live/automation/dueReportLines.ts`'s banding is deliberately NOT reused: it reads `row.tolerance`, computed
 * from a recipe DEFINITION's cadence, and the whole subject of this check is that the definition is gone
 * from the store. There is no cadence there to band against, so the gauge carries its own.
 */
/** How many days without a new report means the producer has stopped, not merely slipped. */
export const REPORT_STALE_AFTER_DAYS = 2;

/**
 * The newest report date among a directory listing, or `null` when none of the names match.
 *
 * ISO dates sort lexically, so the newest is the max of the extracted strings — no date parsing needed.
 *
 * @param filenames the `$home/morning` directory listing (any order, any other files mixed in)
 * @returns the newest `YYYY-MM-DD` found, or `null` when no report has ever been written
 */
export function latestReportDate({ filenames }: { filenames: readonly string[] }): string | null {
  const dates = filenames
    .map((name) => REPORT_FILENAME.exec(name)?.[1])
    .filter((date): date is string => date !== undefined);
  if (dates.length === 0) {
    return null;
  }
  return dates.toSorted().at(-1)!;
}

/**
 * The gap between the newest report and what the artifact last republished, plus the report's own age.
 *
 * @internal
 */
export interface FrictionReviewGap {
  /** The newest report date under `$home/morning`, or `null` when the recipe has never run. */
  readonly latestReportDate: string | null;
  /** The report date the last republish stamped, or `null` when the artifact has never been marked. */
  readonly publishedDate: string | null;
  /** Whether a report exists that the last stamp does not cover. */
  readonly hasGap: boolean;
  /** Whole days from the newest report to today, or `null` when no report exists or a date is unreadable. */
  readonly daysSinceLatestReport: number | null;
  /** Whether the newest report is old enough that the producer has stopped rather than slipped. */
  readonly isStale: boolean;
}

/**
 * Whole days between two `YYYY-MM-DD` days, or `null` when either is unreadable.
 *
 * Both bounds resolve to UTC midnight, so the subtraction is exact days with no rounding and no timezone
 * of its own — the caller's one-day skew is handled by the threshold, not here.
 */
function wholeDaysBetween({ from, to }: { from: string; to: string }): number | null {
  const fromMs = parseYyyyMmDdUtcMs({ date: from });
  const toMs = parseYyyyMmDdUtcMs({ date: to });
  if (fromMs === undefined || toMs === undefined) {
    return null;
  }
  return Math.round((toMs - fromMs) / MS_PER_DAY);
}

/**
 * Compare a report date against a publish stamp, and against today.
 *
 * A report that has never run (`latestReportDate` is `null`) is neither a gap nor stale — there is nothing
 * yet for the artifact to be behind and nothing yet to have stopped, so a fresh install stays quiet.
 * Otherwise the gap is exactly "a report exists that is newer than what was last published", stated as a
 * string comparison because both dates are `YYYY-MM-DD`, and staleness is the report's age in days against
 * {@link REPORT_STALE_AFTER_DAYS}.
 *
 * @param latestReportDate the newest report date under `$home/morning`, or `null`
 * @param publishedDate the report date the last republish stamped, or `null`
 * @param todayDate today as `YYYY-MM-DD`; the shell supplies UTC while report filenames are local days, so
 *   the two may disagree by at most one day — {@link REPORT_STALE_AFTER_DAYS} is sized to absorb that
 * @returns the gap, carrying every input so a caller can render it without re-reading any source
 */
export function computeFrictionReviewGap({
  latestReportDate: reportDate,
  publishedDate,
  todayDate,
}: {
  latestReportDate: string | null;
  publishedDate: string | null;
  todayDate: string;
}): FrictionReviewGap {
  const hasGap = reportDate !== null && (publishedDate === null || reportDate > publishedDate);
  if (reportDate === null) {
    return { daysSinceLatestReport: null, hasGap, isStale: false, latestReportDate: reportDate, publishedDate };
  }
  const age = wholeDaysBetween({ from: reportDate, to: todayDate });
  const isStale = age !== null && age >= REPORT_STALE_AFTER_DAYS;
  return { daysSinceLatestReport: age, hasGap, isStale, latestReportDate: reportDate, publishedDate };
}

/** The report date the last republish stamped. NULL is an artifact never marked republished, so: never. */
function lastStampedDate({ publishedDate }: { publishedDate: string | null }): string {
  if (publishedDate == null) {
    return "never";
  }
  return publishedDate;
}

/**
 * The single human-readable line `reflect friction-review` prints for one outcome. Pure, so every branch
 * is a unit case rather than something only provable by running the CLI.
 *
 * STALE outranks `marked` deliberately. `--mark-published` stamping a seventeen-day-old report is precisely
 * the act that hides a dead producer — it is the one path that can turn "nothing has written a report for
 * weeks" into the words "stamped <report-date> as republished". The stamp still happens, because the republish
 * genuinely occurred and refusing it would break a legitimate hand-off; the line simply must not report
 * success. It names the check that settles it, per `.claude/rules/error-handling.md` (a
 * report that says only that something is wrong costs the reader the lookup this gauge exists to remove).
 *
 * @param gap the computed gap
 * @param marked whether this run just stamped a republish
 * @returns the one line to print
 */
export function renderFrictionReviewLine({ gap, marked }: { gap: FrictionReviewGap; marked: boolean }): string {
  if (gap.latestReportDate === null) {
    return "reflect friction-review: no self-improvement report has ever been written — nothing to check";
  }
  if (gap.isStale) {
    const age = gap.daysSinceLatestReport === null ? "" : `, ${String(gap.daysSinceLatestReport)} days old`;
    return (
      `reflect friction-review: STALE — newest report is ${gap.latestReportDate}${age}; the producer has ` +
      "stopped, so republishing will not help. Check the row with `slopweaver automation due`"
    );
  }
  if (marked) {
    return `reflect friction-review: stamped ${gap.latestReportDate} as republished`;
  }
  if (gap.hasGap) {
    return `reflect friction-review: GAP — newest report is ${gap.latestReportDate}, last republish stamped ${lastStampedDate({ publishedDate: gap.publishedDate })}`;
  }
  return `reflect friction-review: current — ${gap.latestReportDate} is republished`;
}
