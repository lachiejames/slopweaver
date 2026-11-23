/**
 * The writer half of the sync-run ledger: one recorder per `slopweaver refresh` run, holding one run file per
 * source it fetches, fed by the observer scope (`./observerScope.ts`) and closed with the run's own results.
 *
 * Two properties are the design rather than details.
 *
 * **It never fails the sync.** A ledger row that cannot be written is counted and reported on the `finished` row,
 * and the refresh carries on — a run that threw away rows it had fetched because an observability file was
 * unwritable would be strictly worse than one with a gap in its record. The count is best-effort by construction:
 * a failure to write the `finished` row itself cannot be recorded on it, and the fold reads that run as
 * `ended-unfinished` once the slot is released, which is the honest reading of a file with no end.
 *
 * **Each new record counts once.** Notion and Fathom commit mid-crawl and then offer the same records again to the
 * closing bulk write. Bronze already dedups the second offer, so `written` cannot double; `offered` would, and a
 * container would then read as "read twice as much as it held". The recorder drops a record it has already seen
 * offered in this run, keyed by source and `sourceId`, before it tallies.
 */
import type { SourceProgressEvent } from "../corpus/progress.js";
import type { CorpusRecord, ExportWindow } from "../corpus/types.js";
import type { Result } from "../lib/result.js";
import { SYNC_RUN_SCHEMA_VERSION, type SyncRunEvent } from "./event.js";
import type { SyncRunObserver } from "./observerScope.js";
import { appendSyncRunEvent, syncRunFileName } from "./store.js";
import { tallyCommit } from "./tally.js";

/** How often a source's heartbeat is written, at most, unless its phase changed — the terminal's own heartbeat. */
const PROGRESS_WRITE_EVERY_MS = 5000;

/** One source's slice of the run's result, as the refresh summary reported it. */
export interface SyncRunOutcome {
  readonly source: string;
  readonly ok: boolean;
  readonly written: number;
  readonly deduped: number;
  readonly excluded: number;
  readonly errors: readonly string[];
  readonly warnings: number;
  readonly gaps: number;
}

/** The appender the recorder writes through — the real store in production, a fake in a test. */
export type SyncRunAppend = (args: { source: string; fileName: string; event: SyncRunEvent }) => Result<void>;

/** A recorder for one refresh run. */
export interface SyncRunRecorder {
  readonly observer: SyncRunObserver;
  /** Write each source's `finished` row. Sources with no outcome get one saying the run did not report them. */
  readonly finish: (args: { outcomes: readonly SyncRunOutcome[] }) => void;
}

/** One source's open run file and its write bookkeeping. */
interface SourceRun {
  readonly fileName: string;
  readonly seen: Set<string>;
  lastProgressMs: number | null;
  lastPhase: string | null;
  ledgerFailures: number;
}

/** One row's write: a failed append is counted against its source and narrated, never thrown into the refresh. */
type LedgerWrite = (args: { source: string; event: SyncRunEvent }) => void;

/** The write every row of one run goes through; a source the run never opened writes nothing. */
function ledgerWriter({
  append,
  runs,
  warn,
}: {
  append: SyncRunAppend;
  runs: Map<string, SourceRun>;
  warn: (args: { msg: string }) => void;
}): LedgerWrite {
  return ({ source, event }) => {
    const run = runs.get(source);
    if (run === undefined) {
      return;
    }
    const appended = append({ event, fileName: run.fileName, source });
    if (appended.isErr()) {
      run.ledgerFailures += 1;
      warn({ msg: `sync-run ledger: ${appended.error.join("; ")}` });
    }
  };
}

/** Open a run per planned source and write its `started` row; a source planned twice keeps its first window. */
function openRuns({
  jobs,
  pid,
  runId,
  runs,
  startedAtIso,
  write,
}: {
  jobs: readonly { source: string; window: ExportWindow }[];
  pid: number;
  runId: string;
  runs: Map<string, SourceRun>;
  startedAtIso: string;
  write: LedgerWrite;
}): void {
  for (const { source, window } of jobs) {
    if (runs.has(source)) {
      continue;
    }
    runs.set(source, {
      fileName: syncRunFileName({ runId, startedAtIso }),
      lastPhase: null,
      lastProgressMs: null,
      ledgerFailures: 0,
      seen: new Set(),
    });
    const { since, until } = window;
    write({
      event: { atIso: startedAtIso, pid, runId, since, source, type: "started", until, v: SYNC_RUN_SCHEMA_VERSION },
      source,
    });
  }
}

/** The observer's commit leg: one `committed` row per container, counting only records this run had not yet seen. */
function commitWriter({
  nowIso,
  runId,
  runs,
  write,
}: {
  nowIso: () => string;
  runId: string;
  runs: Map<string, SourceRun>;
  write: LedgerWrite;
}): SyncRunObserver["commit"] {
  return ({ offered, written }) => {
    const firstOffers = offered.filter((record) => firstOffer({ record, runs }));
    const atIso = nowIso();
    for (const { container, kinds, label, source } of tallyCommit({ offered: firstOffers, written })) {
      write({
        event: { atIso, container, kinds, label, runId, type: "committed", v: SYNC_RUN_SCHEMA_VERSION },
        source,
      });
    }
  };
}

/**
 * Open a recorder: write a `started` row for each planned source, and hand back the observer and the closer.
 *
 * @param runId the id every row of this run carries
 * @param pid the process running the refresh, which holds each source's refresh slot while it runs
 * @param jobs the planned sources and the window each was asked to read; a source planned twice keeps its first
 * @param nowIso the clock, read once per row
 * @param append where rows go
 * @param warn where a failed ledger write is narrated
 * @returns the recorder
 */
export function createSyncRunRecorder({
  runId,
  pid,
  jobs,
  nowIso,
  append,
  warn,
}: {
  runId: string;
  pid: number;
  jobs: readonly { source: string; window: ExportWindow }[];
  nowIso: () => string;
  append: SyncRunAppend;
  warn: (args: { msg: string }) => void;
}): SyncRunRecorder {
  const runs = new Map<string, SourceRun>();
  const write = ledgerWriter({ append, runs, warn });
  openRuns({ jobs, pid, runId, runs, startedAtIso: nowIso(), write });

  const commit = commitWriter({ nowIso, runId, runs, write });

  const progress: SyncRunObserver["progress"] = ({ event }) => {
    const run = runs.get(event.source);
    if (run === undefined || event.lane !== "heartbeat") {
      return;
    }
    const atIso = nowIso();
    if (!progressDue({ atMs: Date.parse(atIso), event, run })) {
      return;
    }
    run.lastProgressMs = Date.parse(atIso);
    run.lastPhase = event.phase;
    write({ event: progressRow({ atIso, event, runId }), source: event.source });
  };

  const finish: SyncRunRecorder["finish"] = ({ outcomes }) => {
    const atIso = nowIso();
    for (const [source, run] of runs) {
      const outcome = outcomes.find((candidate) => candidate.source === source);
      write({ event: finishedRow({ atIso, ledgerFailures: run.ledgerFailures, outcome, runId }), source });
    }
  };

  return { finish, observer: { commit, progress } };
}

/** Whether this is the first time this run has seen the record offered — and mark it seen. */
function firstOffer({ record, runs }: { record: CorpusRecord; runs: Map<string, SourceRun> }): boolean {
  const run = runs.get(record.source);
  if (run === undefined) {
    return true;
  }
  if (run.seen.has(record.sourceId)) {
    return false;
  }
  run.seen.add(record.sourceId);
  return true;
}

/** A heartbeat is written on a phase change, or once the last written one is old enough. */
function progressDue({ atMs, event, run }: { atMs: number; event: SourceProgressEvent; run: SourceRun }): boolean {
  if (run.lastProgressMs === null || run.lastPhase !== event.phase) {
    return true;
  }
  return atMs - run.lastProgressMs >= PROGRESS_WRITE_EVERY_MS;
}

/** A connector heartbeat as a ledger row, copying only what it reported. */
function progressRow({
  atIso,
  event,
  runId,
}: {
  atIso: string;
  event: SourceProgressEvent;
  runId: string;
}): SyncRunEvent {
  // A heartbeat that reported no counters records an empty set, which the ledger row requires.
  const { metrics = {} } = event;
  return {
    atIso,
    metrics,
    phase: event.phase,
    runId,
    type: "progress",
    v: SYNC_RUN_SCHEMA_VERSION,
    ...(event.done !== undefined ? { done: event.done } : {}),
    ...(event.total !== undefined ? { total: event.total } : {}),
    ...(event.currentItem !== undefined ? { item: event.currentItem.title } : {}),
  };
}

/** A source's closing row, from its outcome or — when the run reported nothing for it — saying so. */
function finishedRow({
  atIso,
  ledgerFailures,
  outcome,
  runId,
}: {
  atIso: string;
  ledgerFailures: number;
  outcome: SyncRunOutcome | undefined;
  runId: string;
}): SyncRunEvent {
  if (outcome === undefined) {
    return {
      atIso,
      deduped: 0,
      errors: ["the refresh ended without a result for this source"],
      excluded: 0,
      gaps: 0,
      ledgerFailures,
      ok: false,
      runId,
      type: "finished",
      v: SYNC_RUN_SCHEMA_VERSION,
      warnings: 0,
      written: 0,
    };
  }
  return {
    atIso,
    deduped: outcome.deduped,
    errors: outcome.errors,
    excluded: outcome.excluded,
    gaps: outcome.gaps,
    ledgerFailures,
    ok: outcome.ok,
    runId,
    type: "finished",
    v: SYNC_RUN_SCHEMA_VERSION,
    warnings: outcome.warnings,
    written: outcome.written,
  };
}

/**
 * The production appender: the real store under `home`.
 *
 * @param home the Slopweaver home
 * @returns the appender
 */
export function storeAppend({ home }: { home: string }): SyncRunAppend {
  return ({ source, fileName, event }) => appendSyncRunEvent({ event, fileName, home, source });
}
