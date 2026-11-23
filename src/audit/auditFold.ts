/**
 * The audit's one pass over bronze, as a FOLD: every physical row the corpus census streams is added once,
 * and what the report needs — per-source volume, collapsible duplicates, superseded versions and the
 * records a cached digest cites — accumulates without any record being kept. Pure: the census that feeds it
 * is the effectful shell's ({@link ../cli/commands/audit/run}).
 */
import { recordDedupDigest } from "../corpus/bronzeDedupIndex.js";
import { recordIdentity } from "../corpus/latestRecords.js";
import type { CorpusRecord, CorpusSource } from "../corpus/types.js";
import { compareStrings } from "../lib/compare.js";
import type { SourceStat, SupersededStat } from "./auditCore.js";

/**
 * Everything `audit` counts over PHYSICAL bronze, gathered in one pass: per-source volume, the citation
 * targets a digest may resolve to, the rows compaction would collapse, and the superseded versions.
 */
export interface AuditTallies {
  /** Physical rows absorbed. */
  readonly rows: number;
  readonly sources: readonly SourceStat[];
  /** Rows per source `slopweaver compact` would collapse as cross-window duplicates. */
  readonly duplicatesBySource: ReadonlyMap<CorpusSource, number>;
  /** The citation targets the rows offer — only those in the fold's `citations`, when it was given one. */
  readonly refs: ReadonlySet<string>;
  readonly superseded: SupersededStat;
}

/**
 * A streaming fold over physical bronze rows, in read order. Feed it every row with {@link AuditFold.add},
 * then read {@link AuditFold.tallies} once.
 */
export interface AuditFold {
  /** Absorb one row; `versions` is how many rows of its identity have been absorbed, this one included. */
  readonly add: (args: { record: CorpusRecord; versions: number }) => void;
  readonly tallies: () => AuditTallies;
}

/** What one source's rows have added up to so far. */
interface SourceRun {
  rows: number;
  superseded: number;
  duplicates: number;
  spanStart: string;
  spanEnd: string;
  readonly kinds: Record<string, number>;
  readonly dedupDigests: Set<string>;
}

/** Fetch (or create) a source's run. */
function sourceRunFor({ runs, source }: { runs: Map<CorpusSource, SourceRun>; source: CorpusSource }): SourceRun {
  const existing = runs.get(source);
  if (existing !== undefined) {
    return existing;
  }
  const created: SourceRun = {
    dedupDigests: new Set<string>(),
    duplicates: 0,
    kinds: {},
    rows: 0,
    spanEnd: "",
    spanStart: "",
    superseded: 0,
  };
  runs.set(source, created);
  return created;
}

/**
 * Start a streaming audit fold.
 *
 * It exists so `audit` never holds the corpus: the verb used to read every record into one array and hand it
 * to four aggregators, and on the owner's corpus that read refused at the heap preflight. What the fold
 * RETAINS is one dedup digest per distinct row (the key `compact` itself collapses on), a few counters per
 * source, and — when `citations` is given — only the citation targets some digest actually cites, rather
 * than three strings for every row.
 *
 * @param citations restrict {@link AuditTallies.refs} to these strings — every citation of every digest the
 *   grounding stat will read; omit to keep every target
 * @returns the fold
 */
export function auditFold({ citations }: { citations?: ReadonlySet<string> } = {}): AuditFold {
  const runs = new Map<CorpusSource, SourceRun>();
  const refs = new Set<string>();
  let rows = 0;
  let logical = 0;
  let deepest = 0;
  const offer = ({ ref }: { ref: string }): void => {
    if (citations === undefined || citations.has(ref)) {
      refs.add(ref);
    }
  };
  return {
    add: ({ record, versions }) => {
      rows += 1;
      logical += versions === 1 ? 1 : 0;
      // A running max, not `Math.max(...values)`: the spread's argument limit is ~124k, and a real corpus
      // carries more identities than that.
      deepest = versions > deepest ? versions : deepest;
      const run = sourceRunFor({ runs, source: record.source });
      run.rows += 1;
      run.superseded += versions > 1 ? 1 : 0;
      const kindCount = run.kinds[record.kind];
      run.kinds[record.kind] = kindCount === undefined ? 1 : kindCount + 1;
      if (record.tsIso.length > 0) {
        run.spanStart = run.spanStart === "" || record.tsIso < run.spanStart ? record.tsIso : run.spanStart;
        run.spanEnd = record.tsIso > run.spanEnd ? record.tsIso : run.spanEnd;
      }
      const digest = recordDedupDigest({ record });
      if (run.dedupDigests.has(digest)) {
        run.duplicates += 1;
      } else {
        run.dedupDigests.add(digest);
      }
      if (record.url.length > 0) {
        offer({ ref: record.url });
      }
      offer({ ref: record.sourceId });
      offer({ ref: `${record.source}:${record.sourceId}` });
    },
    tallies: () => tallyRuns({ deepest, logical, refs, rows, runs }),
  };
}

/** Turn a finished fold's runs into its tallies, sources sorted by name for a stable report. */
function tallyRuns({
  runs,
  refs,
  rows,
  logical,
  deepest,
}: {
  runs: ReadonlyMap<CorpusSource, SourceRun>;
  refs: ReadonlySet<string>;
  rows: number;
  logical: number;
  deepest: number;
}): AuditTallies {
  const sorted = [...runs].toSorted(([a], [b]) => compareStrings({ a, b }));
  return {
    duplicatesBySource: new Map(sorted.map(([source, run]) => [source, run.duplicates])),
    refs,
    rows,
    sources: sorted.map(([source, run]) => ({
      count: run.rows,
      kinds: run.kinds,
      source,
      spanEnd: run.spanEnd,
      spanStart: run.spanStart,
    })),
    superseded: {
      deepest,
      logical,
      rows,
      sources: sorted.map(([source, run]) => ({
        logical: run.rows - run.superseded,
        rows: run.rows,
        source,
        superseded: run.superseded,
      })),
      superseded: rows - logical,
    },
  };
}

/**
 * {@link auditFold} over an in-memory list of records, counting each identity's versions in list order —
 * what the census hands the fold row by row. Pure.
 *
 * @internal — the unit tests' way in; the verb streams through {@link auditFold} directly.
 * @param records the physical rows, in read order
 * @param citations restrict the kept citation targets to these
 * @returns the tallies
 */
export function auditTallies({
  records,
  citations,
}: {
  records: readonly CorpusRecord[];
  citations?: ReadonlySet<string>;
}): AuditTallies {
  const fold = auditFold(citations !== undefined ? { citations } : {});
  const versions = new Map<string, number>();
  for (const record of records) {
    const key = recordIdentity({ record });
    const prior = versions.get(key);
    const seen = prior === undefined ? 1 : prior + 1;
    versions.set(key, seen);
    fold.add({ record, versions: seen });
  }
  return fold.tallies();
}
