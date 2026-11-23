/**
 * The contract between a source lane and the ingest shell (`./ingestSource.ts`): the job a lane hands over,
 * the coverage gap it may report, and the per-source result the shell hands back.
 */
import type { Result } from "#lib/result.js";
import type { CorpusRecord, CorpusSource, ExportWindow } from "./types.js";

/**
 * Why a lane could not cover its whole window. A NON-EMPTY list means the fetch succeeded but did not see
 * everything the window asked for, so the run FAILS — and, unless the lane says otherwise, its pooled cursor
 * does not move past the gap.
 *
 * This exists because `warnings` could not carry the signal. A warning is advisory by construction, and the
 * ingest shell treated every successful fetch as complete regardless of what the warnings said — a test
 * literally asserted that a run reporting `"skipped 1 thread"` still advanced its watermark past the
 * skipped thread. The thread was then never requested again: the cursor had moved beyond it, and nothing
 * anywhere recorded that a gap existed. State reported true when it was false.
 *
 * A gap is therefore its own typed channel, separate from advisory noise. The distinction that makes this
 * workable is between a node DROPPED by defect (a parse that failed, a page marker that did not add up) and
 * one CORRECTLY OMITTED by policy (a deliberate membership cap, a tombstone, a bot). Only the former belongs
 * here — treating a deliberate omission as a gap would wedge that lane's cursor forever, and a gate that can
 * never go green is no better than one that always is.
 *
 * {@link CoverageGap.heldPerContainer} is the THIRD distinction, and it was paid for the hard way: see that
 * field for the measurement.
 */
export interface CoverageGap {
  /** What a reader is told — the line that reaches `errors` and the refresh summary. */
  readonly message: string;
  /**
   * Whether the unread span this gap names is already withheld by the lane's OWN per-container resume state,
   * so the POOLED cursor is not what is protecting it.
   *
   * **A lane may only set this when abandoning the container leaves that container's own resume state
   * untouched**, so the next pass re-offers the span whatever the pooled cursor says. That is the obligation,
   * and it is checkable at the site that sets it rather than here.
   *
   * MEASURED on the operator's own home, which is why the field exists. Slack reports one gap per
   * conversation its progress watchdog abandons (`../corpus/slack/channelDeadline.ts#channelStallGap`), and
   * that held the cursor for the whole WORKSPACE: `corpus/watermarks/slack.json` read
   * an instant hours older than the newest pass's bronze rows, which ran through a later instant, and dozens of per-channel cursors among hundreds stood past the pooled one. At that
   * conversation count something stalls nearly every pass, so an intermittent hang froze the cursor
   * permanently — and every freshness check keyed on it read Slack as stale while well over a million rows sat in the store.
   * Reproduce the shape of it with:
   *
   * ```bash
   * cat "$SLOPWEAVER_HOME/corpus/watermarks/slack.json"
   * jq --arg c "$(jq -r .cursor "$SLOPWEAVER_HOME/corpus/watermarks/slack.json")" \
   *   '[.channels|to_entries[]|select(.value.cursor > $c)]|length' \
   *   "$SLOPWEAVER_HOME/corpus/.slack-channels.watermark.json"
   * ```
   *
   * It never softens the VERDICT: a gap carrying this still fails its source and still reaches `errors`, which
   * is the property the gap-to-verdict wiring exists for and this must not spend.
   */
  readonly heldPerContainer: boolean;
}

/**
 * One coverage gap. The default is the SAFE one — a lane that says nothing holds its pooled cursor. Pure.
 *
 * @param message what a reader is told
 * @param heldPerContainer set only when the lane's own per-container resume state already withholds this
 *   span (see {@link CoverageGap.heldPerContainer} for the obligation that carries)
 * @returns the gap
 */
export function coverageGap({
  message,
  heldPerContainer = false,
}: {
  message: string;
  heldPerContainer?: boolean;
}): CoverageGap {
  return { heldPerContainer, message };
}

/** One source's ingest job: its window + a runner that fetches and projects records (or errors). */
export interface SourceIngestJob {
  readonly source: CorpusSource;
  readonly window: ExportWindow;
  readonly label: string;
  /**
   * This lane has NO resume cursor, so no watermark may be written for it. Absent ⇒ false (the fetched sources,
   * which all resume from one).
   *
   * A THIRD reason to hold a cursor beside `--sample` and `--fetch-cap`, and a different KIND of reason: those
   * two describe a run that saw part of its window, whereas this describes a source where a cursor is not a
   * meaningful object at all. `self` is a full deterministic re-scan of local files — free, idempotent, nothing
   * to page through. Writing a watermark for it would create a cursor nothing reads and a future refresh might,
   * which is how a lane that should always re-scan quietly starts skipping.
   *
   * Unlike a coverage gap this is NOT a failure: the lane saw everything there was.
   */
  readonly cursorless?: boolean;
  readonly run: () => Promise<
    Result<{
      readonly records: readonly CorpusRecord[];
      readonly warnings: readonly string[];
      /** Coverage gaps. Absent or empty ⇒ the lane saw its whole window and its cursor may advance. */
      readonly gaps?: readonly CoverageGap[];
      /**
       * Informational per-lane facts worth printing — a side store the lane wrote, a count a reader would
       * otherwise have to infer. NOT warnings: a note never means anything went wrong, and folding one into
       * `warnings` to get it printed would make the warning channel useless as a signal.
       */
      readonly notes?: readonly string[];
      /**
       * How many bronze lines this job already appended ITSELF, committing PER-CONTAINER as it crawled.
       * Absent ⇒ the job wrote nothing of its own and the bulk write below is this run's only write.
       *
       * A long crawl that writes once at the end is a bet that nothing restarts before it finishes. Measured
       * on the epoch-wide Slack backfill: 603 conversations, ~36 hours, nothing on disk until the
       * end — started twice, killed twice, zero records kept. A job that commits each container as it
       * finishes turns that into progress a restart can build on.
       *
       * The bulk write still runs afterwards, and that is deliberate rather than redundant: a job may hold
       * records that belong to no container it committed — Slack's curated surfaces (pins, bookmarks,
       * canvases) are fetched workspace-wide once the crawl is over, and a container whose own commit FAILED
       * has no other route to disk.
       *
       * What it is no longer offered is everything already committed. Re-offering it was safe (the write path
       * deduplicates) but not free: holding a whole workspace's shaped records for a final pass is what made
       * the crawl's memory grow with the workspace and killed the backfill at conversation 95 of 603. See
       * `../corpus/slack/fetch.SlackChannelSummary`.
       *
       * What the count is FOR is the arithmetic. Without it, a run that committed 200,000 rows container by
       * container would report `written: 0, deduped: 200000`, which reads as "this run found nothing new".
       */
      readonly committedPerContainer?: number;
      /**
       * How many records those per-container commits were OFFERED — written plus deduped.
       *
       * Absent ⇒ zero. It exists so `projected`/`deduped` stay true once a job stops re-offering what it
       * already committed: with only {@link committedPerContainer} to go on, a run that committed 459,384
       * rows and then bulk-wrote a hundred curated ones would report a hundred projected and a NEGATIVE
       * dedup count.
       */
      readonly projectedPerContainer?: number;
      /**
       * The newest `tsIso` this job banked per-container, when it banked anything.
       *
       * The pooled cursor is derived from the records handed to the bulk write, so a job whose bulk write
       * carries only the records no container commit covered would otherwise leave that cursor standing
       * still — and every later incremental run would re-read from wherever it stopped.
       */
      readonly committedCursor?: string;
    }>
  >;
}

/** One source's ingest outcome — counts + any warnings/errors, so `refresh` can print a per-source summary. */
export interface SourceIngestResult {
  readonly source: CorpusSource;
  readonly ok: boolean;
  readonly projected: number;
  readonly written: number;
  readonly deduped: number;
  /**
   * Records the install's sync author denylist dropped before they could be written
   * ({@link ./syncExclusion}).
   *
   * Its own count rather than folded into `deduped`, because `deduped` means "bronze already holds this"
   * and this means "bronze will never hold this". Left folded, a denylist that matched far more than its
   * author intended would read as an ordinary re-fetch on every line of the refresh summary.
   */
  readonly excluded: number;
  readonly warnings: readonly string[];
  readonly errors: readonly string[];
  /**
   * Coverage gaps this lane reported. Non-empty means its cursor was deliberately HELD BACK, so the next
   * refresh re-scans the same window rather than stepping over the gap. Surfaced on the result so the run
   * can name the lane instead of exiting zero over an incomplete corpus.
   */
  readonly gaps: readonly CoverageGap[];
  /** Informational per-lane facts (see {@link SourceIngestJob.run}'s `notes`). Never a failure signal. */
  readonly notes: readonly string[];
}
