/**
 * The bound that makes an empty answer honest.
 *
 * ## Why a verb here must volunteer this
 *
 * Claude Code deletes old transcripts. Ask this corpus about a week that has aged out and it will answer
 * "nothing found" — which is indistinguishable from "that never happened", and is the more damaging of the
 * two readings because it looks like evidence. Every query over a time window therefore states where the
 * floor is and whether the window crosses it, in the verb's OWN OUTPUT rather than in a document nobody
 * reading the output has open.
 *
 * ## The floor is measured, never asserted
 *
 * {@link TRANSCRIPT_RETENTION_DAYS_NOMINAL} records what the retention window was observed to be, and it is
 * used only to EXPLAIN an absence — never to compute one. What a verb reports is the oldest transcript that
 * is actually on disk right now, which cannot rot. Reproduce the nominal figure with:
 *
 * ```
 * find ~/.claude/projects -name '*.jsonl' -exec stat -f '%m %N' {} \; | sort -n | head -1
 * du -sh ~/.claude/projects
 * ```
 *
 * Measured: the oldest file was written one month back, over 2,800 transcripts
 * totalling 4.1 GB. That is why anything worth keeping out of this corpus is distilled when it is read and
 * never left to be re-read later.
 *
 * Pure: instants in, verdicts and sentences out. No I/O, no clock — `nowMs` is passed.
 */

/**
 * The retention window this corpus has been observed to hold, in days.
 *
 * Explanatory only: see this module's header for what it is and is not used for, and for the two commands
 * that reproduce it.
 */
export const TRANSCRIPT_RETENTION_DAYS_NOMINAL = 31;

/** Milliseconds in a day, so the arithmetic below reads as days rather than as a magic constant. */
const MS_PER_DAY = 86_400_000;

/** Where a requested window sits relative to the oldest transcript still on disk. */
export type RetentionVerdict =
  /** The window starts at or after the floor — an empty result genuinely means nothing happened. */
  | "within-retention"
  /** The window ends before the floor — an empty result means the evidence was deleted, not absent. */
  | "predates-retention"
  /** The window starts before the floor and ends after it — the early part is unanswerable. */
  | "spans-retention-floor";

/** What is actually on disk, as opposed to what the retention policy nominally allows. */
export interface RetentionFloor {
  /** The oldest transcript's ISO instant, or "" when there are no transcripts at all. */
  readonly oldestIso: string;
  /** How many whole days of history that floor represents, or 0 when there are no transcripts. */
  readonly retainedDays: number;
  /** How many transcripts the floor was measured over. */
  readonly transcriptCount: number;
}

/**
 * Measure the floor from the transcripts that exist.
 *
 * @param oldestMs the oldest transcript's last-write instant, or `undefined` when there are none
 * @param nowMs the instant to measure against, injected so this stays pure
 * @param transcriptCount how many transcripts the floor was measured over
 * @returns the measured floor
 */
export function retentionFloor({
  oldestMs,
  nowMs,
  transcriptCount,
}: {
  oldestMs: number | undefined;
  nowMs: number;
  transcriptCount: number;
}): RetentionFloor {
  if (oldestMs === undefined) {
    return { oldestIso: "", retainedDays: 0, transcriptCount };
  }
  return {
    oldestIso: new Date(oldestMs).toISOString(),
    retainedDays: Math.max(0, Math.floor((nowMs - oldestMs) / MS_PER_DAY)),
    transcriptCount,
  };
}

/**
 * Where a requested window sits relative to the floor.
 *
 * @param sinceMs the start of the requested window, or `undefined` for "everything on disk"
 * @param untilMs the end of the requested window, or `undefined` for "up to now"
 * @param floor the measured floor
 * @returns the verdict a caller renders alongside its result count
 */
export function retentionVerdictFor({
  sinceMs,
  untilMs,
  floor,
}: {
  sinceMs: number | undefined;
  untilMs: number | undefined;
  floor: RetentionFloor;
}): RetentionVerdict {
  if (sinceMs === undefined || floor.oldestIso === "") {
    return "within-retention";
  }
  const floorMs = Date.parse(floor.oldestIso);
  if (sinceMs >= floorMs) {
    return "within-retention";
  }
  return untilMs !== undefined && untilMs < floorMs ? "predates-retention" : "spans-retention-floor";
}

/**
 * The sentence a verb prints so an empty answer cannot be misread as an absence of history.
 *
 * @param floor the measured floor
 * @param verdict where the requested window sits relative to it
 * @returns one line, always — a verb that printed this only sometimes would be silent exactly when it matters
 */
export function retentionLine({ floor, verdict }: { floor: RetentionFloor; verdict: RetentionVerdict }): string {
  if (floor.oldestIso === "") {
    return `retention: no transcripts on disk at all — Claude Code keeps roughly ${TRANSCRIPT_RETENTION_DAYS_NOMINAL} days and this machine is holding none`;
  }
  const held = `${floor.transcriptCount} transcripts, oldest ${floor.oldestIso} (${floor.retainedDays}d back; Claude Code retains roughly ${TRANSCRIPT_RETENTION_DAYS_NOMINAL} days and deletes the rest)`;
  if (verdict === "predates-retention") {
    return `retention: OUTSIDE THE WINDOW — the requested window ends before the oldest transcript on disk, so an empty result means the evidence was DELETED, not that nothing happened. Holding ${held}`;
  }
  if (verdict === "spans-retention-floor") {
    return `retention: PARTLY OUTSIDE THE WINDOW — the requested window starts before the oldest transcript on disk, so anything earlier than the floor is unanswerable rather than absent. Holding ${held}`;
  }
  return `retention: within the window. Holding ${held}`;
}
