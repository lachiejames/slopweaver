/**
 * The Linear half of `tokenedJobs.ts` — the per-PAGE bronze committer the issues and projects walks bank
 * through, and the durability note a run reports from it.
 *
 * Split out of `tokenedJobs.ts` for the same reason `tokenedJobsSlack.ts` and `tokenedJobsNotion.ts` were:
 * to keep that file composing lanes rather than knowing how each one reaches disk. No behaviour moves.
 */

import { createBronzeCommitter } from "../../../corpus/corpusWriter.js";
import { writeHistoryRows } from "../../../corpus/history/store.js";
import { type CoverageGap, coverageGap } from "../../../corpus/ingestJob.js";
import type { LinearActivity, LinearPageCommit } from "../../../corpus/linear/fetch.js";
import { projectLinearRecords } from "../../../corpus/linear/project.js";
import { newestTs } from "../../../corpus/newestTs.js";
import type { CorpusRecord, ExportWindow } from "../../../corpus/types.js";
import { err, ok, type Result } from "../../../lib/result.js";

/** What a run's per-page commits banked, and the newest instant they cover. */
export interface LinearCommitTally {
  /** Bronze lines the page commits actually appended. */
  readonly written: number;
  /** Records those commits were OFFERED — written plus deduped. */
  readonly projected: number;
  /** The newest `tsIso` banked, or undefined when nothing was. */
  readonly committedCursor: string | undefined;
}

/**
 * Open the per-page committer for a Linear crawl: project ONE page of a lane, append it to bronze, and keep
 * running totals of what that cost — all before the walk asks for the next page.
 *
 * `undefined` for a BOUNDED run (`--sample`, `--fetch-cap`) or a CURSOR-ISOLATED one, which must stay on the
 * write-once path. The three reasons are independent and each is sufficient:
 *
 *  - `--sample` is applied by `capPerContainer` (`corpus/ingestSource.ts`) AFTER the fetch returns, so a
 *    commit that happens DURING the walk bypasses it entirely and a `--sample 5` run would put the whole
 *    window into bronze. That is a correctness bug, not a cosmetic one.
 *  - `--fetch-cap` describes a run that saw a prefix of its window, so it has not earned a cursor.
 *  - a cursor-isolated run (`store load` pulling into Supabase) is not the file corpus's crawl at all, and
 *    bronze IS the file corpus.
 *
 * The committer is created ONCE and closed over by the seam, which is the difference between this being
 * affordable and not: it holds the dedup index open instead of rebuilding it from the whole Linear bronze
 * tree on every page (see {@link ../../../corpus/corpusWriter.createBronzeCommitter}).
 *
 * @param bounded whether `--sample`/`--fetch-cap` bounded the run
 * @param cursorIsolated whether this run must leave every store in the home untouched
 * @param home the Slopweaver home
 * @param window the export window, which names the bronze file every page appends to
 * @returns the commit seam plus a reader for the running totals, or `undefined` on a write-once run
 */
export function linearPageCommitter({
  bounded,
  cursorIsolated,
  home,
  window,
}: {
  bounded: boolean;
  cursorIsolated: boolean;
  home: string;
  window: ExportWindow;
}): { commit: LinearPageCommit; tally: () => LinearCommitTally } | undefined {
  if (bounded || cursorIsolated) {
    return undefined;
  }
  const committer = createBronzeCommitter({ home, window });
  const spend = { offered: 0, written: 0 };
  let maxTsIso: string | undefined;
  const commit: LinearPageCommit = ({ issues, projects }) => {
    const records = projectLinearRecords({ issues, projects });
    // No records means no ITEMS: `issueRecords`/`projectRecords` each open with the atom unconditionally,
    // so a non-empty page can never shape down to nothing. That matters because the caller reads `ok` as
    // "banked, do not retain" — if either projector ever gains a drop path, a page could be dropped here
    // with a clean result to show for it.
    if (records.length === 0) {
      return ok({ written: 0 });
    }
    const written = committer.commit({ records });
    if (written.isErr()) {
      return err(written.error);
    }
    spend.offered += records.length;
    spend.written += written.value.written;
    const pageNewest = newestTs({ records });
    if (pageNewest !== undefined && (maxTsIso === undefined || pageNewest > maxTsIso)) {
      maxTsIso = pageNewest;
    }
    return ok({ written: written.value.written });
  };
  return {
    commit,
    tally: (): LinearCommitTally => ({
      committedCursor: maxTsIso,
      projected: spend.offered,
      written: spend.written,
    }),
  };
}

/**
 * What the per-page commits banked, as the note lines a run reports.
 *
 * Reported rather than left to the counts alone because a store that fills up invisibly is
 * indistinguishable from one that never fills at all — the property this whole change exists to fix. A run
 * that banked nothing says nothing, so silence still means the write-once path.
 *
 * @param tally the run's accumulated per-page totals, or undefined on a write-once run
 * @returns zero or one note line
 */
function linearDurabilityNotes({ tally }: { tally: LinearCommitTally | undefined }): readonly string[] {
  if (tally === undefined || tally.projected === 0) {
    return [];
  }
  return [
    `durability: banked ${String(tally.written)} record(s) to bronze page by page during the crawl (${String(tally.projected)} offered) — an interruption keeps them`,
  ];
}

/**
 * The seam to spread into `fetchLinearActivity`, or nothing on a write-once run.
 *
 * @param committer the opened committer, absent on a write-once run
 * @returns `{ onPage }` when there is a committer, or an empty object
 */
export function linearCommitSeam({ committer }: { committer: ReturnType<typeof linearPageCommitter> }): {
  onPage?: LinearPageCommit;
} {
  if (committer === undefined) {
    return {};
  }
  return { onPage: committer.commit };
}

/**
 * Write the crawl's activity history to the sibling store and assemble the ingest outcome.
 *
 * Split out of `ingestLinear` so that function stays the SEQUENCE of steps and this stays the shape of what
 * they produced. The history write happens here rather than inside the connector because `refresh` is the
 * only writer into the corpus, and it is reported through `notes` rather than left silent: a store that
 * fills up invisibly is indistinguishable from one that never fills at all.
 *
 * A history-write failure is a COVERAGE GAP, and so is every lane the crawl reports `incomplete`. Neither
 * aborts the write — the records that did arrive are still worth committing — but each fails the source and
 * holds its cursor, so the next pass re-reads the window. That is the one receipt a consumer can refuse on:
 * a warning is advisory by construction (`ingestJob.ts`'s `CoverageGap`), and when these were warnings
 * Linear stamped fresh with a whole lane missing, or with the event store that movement is read from
 * unwritten. The history rows deliberately stay on ONE write at the end while bronze commits page by page:
 * they are re-fetchable, the store dedups them itself, and splitting them would add a second per-page
 * failure channel for a much smaller prize.
 *
 * @param activity the completed crawl, already stripped of every page a commit banked
 * @param cursorIsolated whether this run must leave every store in the home untouched
 * @param home the Slopweaver home
 * @param referencedWarnings the reference pass's own warnings, which precede the crawl's
 * @param spendNote what the crawl cost, from the transport's own observation
 * @param tally the per-page commit totals, or undefined on a write-once run
 * @returns the records the closing write still has to carry, the counts, the warnings, the notes and the gaps
 */
export function linearIngestResult({
  activity,
  cursorIsolated,
  home,
  referencedWarnings,
  spendNote,
  tally,
}: {
  activity: LinearActivity;
  cursorIsolated: boolean;
  home: string;
  referencedWarnings: readonly string[];
  spendNote: string;
  tally: LinearCommitTally | undefined;
}): {
  records: readonly CorpusRecord[];
  warnings: readonly string[];
  notes: readonly string[];
  gaps: readonly CoverageGap[];
  committedPerContainer: number;
  projectedPerContainer: number;
  committedCursor?: string;
} {
  // An isolated run writes nothing into the home, and the history store is a home store — a `store load`
  // pulling into Supabase has no business appending to the file corpus's sibling event log.
  const wrote = cursorIsolated
    ? ok({ deduped: 0, written: 0 })
    : writeHistoryRows({ home, rows: activity.historyRows, source: "linear" });
  return {
    committedPerContainer: tally === undefined ? 0 : tally.written,
    gaps: linearGaps({ incomplete: activity.incomplete, wrote }),
    notes: [...historyNotes({ cursorIsolated, wrote }), ...linearDurabilityNotes({ tally }), spendNote],
    projectedPerContainer: tally === undefined ? 0 : tally.projected,
    // Only what NO page commit covered. A banked page is gone from `activity` already, so re-offering it
    // here would double it in `projected` and count it again as a dedup — see `ingestSource.runCounts`.
    records: projectLinearRecords(activity),
    warnings: [...referencedWarnings, ...activity.warnings],
    ...(tally?.committedCursor !== undefined ? { committedCursor: tally.committedCursor } : {}),
  };
}

/**
 * The run's coverage gaps: one per lane that did not arrive whole, and one per history-store write failure.
 *
 * None is `heldPerContainer`: Linear keeps no per-container resume state, so the pooled cursor is the only
 * thing that can withhold the span. Pure.
 *
 * @param incomplete the lanes the crawl reported as not arriving whole
 * @param wrote the history-store write outcome
 * @returns the gaps, empty when every lane arrived and the history store took its rows
 */
export function linearGaps({
  incomplete,
  wrote,
}: {
  incomplete: readonly string[];
  wrote: Result<{ written: number; deduped: number }>;
}): readonly CoverageGap[] {
  const historyLines = wrote.isOk() ? [] : wrote.error.map((line) => `history persist failed: ${line}`);
  return [...incomplete, ...historyLines].map((message) => coverageGap({ message }));
}

/**
 * What the history write did, as the one note line it earns.
 *
 * @param cursorIsolated whether the write was deliberately withheld
 * @param wrote the write outcome
 * @returns one note line, or none when the write failed (the failure travels as a coverage gap instead)
 */
function historyNotes({
  cursorIsolated,
  wrote,
}: {
  cursorIsolated: boolean;
  wrote: Result<{ written: number; deduped: number }>;
}): readonly string[] {
  if (cursorIsolated) {
    return ["history: not written — this run is isolated from the file corpus's stores"];
  }
  if (wrote.isErr()) {
    return [];
  }
  return [`history: wrote ${String(wrote.value.written)} event(s), deduped ${String(wrote.value.deduped)}`];
}
