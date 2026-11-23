/**
 * Every budget reading in Codex's recent rollout logs, not just the newest one.
 *
 * `./gaugeScan.ts` answers "what is the budget NOW", which is what `codex gauge` prints, and it stops at the
 * first reading it finds in each file for exactly that reason. The burn watch needs a SERIES: a baseline is
 * history, and one reading is not history.
 *
 * Same bounded walk, a wider file cap, and it keeps every `token_count` event in each candidate's tail rather
 * than the newest. The bound is what makes that safe: five day-directories, at most `MAX_SERIES_FILES` files
 * (below), each read through `./quotaLog.ts`'s own capped `readRolloutTail`. A machine with 3,881 rollout files must not
 * scan them all, and a file whose tail holds a hundred readings contributes a hundred.
 *
 * **A re-read is not new information, and this does not pretend otherwise.** The watch calls this on every
 * tick and gets mostly the same events back; deduplication by source event id is
 * `./drawdownJournal.ts`'s `unseenCodexSamples`, so the same `token_count` event cannot contribute to the
 * baseline twice however many times it is read.
 */

import { type CodexGauge, parseGaugeLineAll } from "./gauge.js";
import { readRolloutTail, recentSessionDayDirs, rolloutFilesIn } from "./quotaLog.js";
import type { RolloutCandidate } from "./rolloutWalk.js";

/** How many day-directories back a series read looks. Matches `./gaugeScan.ts`'s own bound. */
const RECENT_SERIES_DAY_DIRS = 5;

/**
 * How many rollout files, newest by mtime, a series read opens.
 *
 * Fifty times `./gaugeScan.ts`'s twelve, and MEASURED rather than chosen. A gauge wants the newest reading,
 * which the newest handful of files always holds; a BASELINE wants a day, and Codex writes so many rollout
 * files that twelve of them reach about six minutes. Measured against 1,448 real rollout files
 * across five day-directories, as span of journalled history against wall time per pass:
 *
 * | files | history reached | per pass |
 * | --- | --- | --- |
 * | 12 | 0.1h | 4.6s |
 * | 60 | 2.0h | 5.9s |
 * | 200 | 11.8h | 5.9s |
 * | 600 | 26.1h | 8.5s |
 *
 * 600 is the first bound that clears `minimumObservedSpanMs` (12h) on a SINGLE pass, so a fresh watch has a
 * real baseline immediately instead of staying `warming` for half a day. 200 lands at 11.8h, which is just
 * inside the window and would have been a threshold nobody could see from the code. The cost is 8.5 seconds
 * against a 300-second default poll interval.
 *
 * Reproduce on any machine:
 *
 * ```bash
 * H=$(mktemp -d); slopweaver codex watch --once --home "$H"; slopweaver codex watch --once --home "$H"
 * ```
 */
const MAX_SERIES_FILES = 600;

/** What a series read found, including what it had to leave out. */
export interface CodexGaugeSeries {
  /** Every reading found, in no particular order — the detector sorts by observed instant itself. */
  readonly gauges: readonly CodexGauge[];
  readonly filesRead: number;
  /**
   * How many candidate files the bound excluded.
   *
   * Reported rather than dropped, for the reason `./gaugeScan.ts` gives and one more that matters here: a
   * watch whose baseline is thin needs to know whether the log is sparse or whether this stopped looking.
   */
  readonly filesSkipped: number;
}

/**
 * The candidate files a series read will open, newest by mtime first, bounded.
 *
 * @param codexHome the resolved `$CODEX_HOME`
 * @returns the files to open and how many were excluded by the bound
 */
function seriesCandidates({ codexHome, dayDirs, maxFiles }: { codexHome: string; dayDirs: number; maxFiles: number }): {
  readonly opened: readonly RolloutCandidate[];
  readonly skipped: number;
} {
  const all = recentSessionDayDirs({ codexHome, limit: dayDirs }).flatMap((dayDir) => rolloutFilesIn({ dayDir }));
  const ordered = all.toSorted((left, right) => right.mtimeMs - left.mtimeMs);
  return { opened: ordered.slice(0, maxFiles), skipped: Math.max(0, ordered.length - maxFiles) };
}

/**
 * Every reading in one file's bounded tail.
 *
 * `parseGaugeLineAll` rather than `parseGaugeLine`, because one `token_count` event carries both rate-limit
 * slots and the detector treats each window as its own series.
 *
 * @param path the rollout file to read
 * @returns every reading its tail holds, in file order
 */
function gaugesInFile({ path }: { path: string }): readonly CodexGauge[] {
  return readRolloutTail({ path })
    .split("\n")
    .flatMap((line) => parseGaugeLineAll({ line }));
}

/**
 * Read the recent budget series off Codex's own rollout logs.
 *
 * Read-only, and no network: a Codex budget can only be read from the log Codex already wrote
 * (`./gauge.ts` § Why this is not a probe).
 *
 * The two bounds default to the watch's measured ones above. `slopweaver machine unused` widens them, because a
 * seven-day measurement needs seven days of day-directories rather than a day-long baseline, and pays for it
 * once per invocation rather than on every watch tick.
 *
 * @param codexHome the resolved `$CODEX_HOME`
 * @param dayDirs how many non-empty day-directories back to look
 * @param maxFiles how many rollout files, newest first, to open
 * @returns every reading found, with how many files were opened and how many the bound excluded
 */
export function scanCodexGaugeSeries({
  codexHome,
  dayDirs = RECENT_SERIES_DAY_DIRS,
  maxFiles = MAX_SERIES_FILES,
}: {
  codexHome: string;
  dayDirs?: number;
  maxFiles?: number;
}): CodexGaugeSeries {
  const { opened, skipped } = seriesCandidates({ codexHome, dayDirs, maxFiles });
  return {
    filesRead: opened.length,
    filesSkipped: skipped,
    gauges: opened.flatMap((candidate) => gaugesInFile({ path: candidate.path })),
  };
}
