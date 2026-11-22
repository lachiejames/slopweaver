/**
 * The effectful edge of the local Linear query: stream bronze line by line and RETAIN only what matched.
 *
 * The distinction from {@link ../corpusStore.readCorpusDir} is the whole reason this module exists. That
 * reader retains every record it parses, which is right for a reader that needs the corpus and wrong for a
 * query, because the corpus is far larger than any answer: the owner's Linear bronze is 661 MB across
 * 173,206 rows (measured — `wc -l ~/.slopweaver/corpus/bronze/linear/*.jsonl`), and a query for
 * everything assigned to one person keeps 923 of them. Filtering inside the line loop makes the retained
 * heap a property of the ANSWER rather than of the corpus, and the parse itself — a full streaming
 * `JSON.parse` of all 661 MB — measured 2.2 s at 199 MB peak RSS, so there is nothing to index around yet.
 *
 * The retained set is still bounded, by {@link MATCH_CEILING}, and crossing it REFUSES rather than
 * truncating: a silently-capped match count is a wrong answer to "how much is on my plate".
 */
import { err, ok, type Result } from "../../lib/result.js";
import { safeFs } from "../../lib/safeBoundary.js";
import type { OwnerProtectionResolver } from "../bronzeProtection.js";
import { bronzeSourceDir } from "../corpusPaths.js";
import { parseRow } from "../corpusRowCore.js";
import { protectedSkipWarnings, readJsonlLines, scanJsonlProtected } from "../corpusStore.js";
import type { CorpusRecord } from "../types.js";
import { currentMatches, type LinearQueryFilter, matchesLinearQuery, noteNewestCapture } from "./query.js";
import { type LinearQueryError, LinearQueryErrors } from "./queryErrors.js";

/**
 * The most distinct matches one query will hold before it refuses.
 *
 * Sized from the corpus rather than guessed: the owner's whole Linear bronze holds 173,206 rows across every
 * kind, so a filter that matches 50,000 objects has not selected anything — it has asked for the workspace.
 * Reproduce the denominator with `wc -l ~/.slopweaver/corpus/bronze/linear/*.jsonl`.
 *
 * @internal — the number a {@link ./queryErrors.TooManyMatchesError} carries; callers read it off the error.
 */
export const MATCH_CEILING = 50_000;

/** What one local scan found, plus the honest account of what it could not read. */
export interface LinearScanResult {
  /**
   * Every matching record that is its object's newest capture ({@link ./query.currentMatches}) — a capture a
   * later one superseded is dropped here even when the later one did not match, and a same-instant tie is left
   * for {@link ./query.rankLinearMatches} to collapse.
   */
  readonly records: readonly CorpusRecord[];
  /** How many bronze rows the scan read, matched or not. */
  readonly rowsScanned: number;
  /** Files the walk could not open at all; a scan reporting these has an unknown shortfall, not zero. */
  readonly unreadable: readonly string[];
  /** One line per path the walk left out because the owner's protect list covers it; the answer is short by these. */
  readonly warnings: readonly string[];
}

/**
 * Fold one bronze line into a scan: counted, its capture noted as its object's newest, and kept when it matches,
 * until the match ceiling is crossed, after which every later line is skipped.
 *
 * @param line one line of an already-judged bronze file
 * @param filter the resolved query every record is tested against
 * @param newest each object's newest capture so far, which {@link ./query.currentMatches} reads
 * @param progress the scan's mutable counters
 * @param records the matches so far
 */
function foldLine({
  line,
  filter,
  newest,
  progress,
  records,
}: {
  line: string;
  filter: LinearQueryFilter;
  newest: Map<string, string>;
  progress: { overflowed: boolean; rowsScanned: number };
  records: CorpusRecord[];
}): void {
  if (progress.overflowed || line.trim().length === 0) {
    return;
  }
  progress.rowsScanned += 1;
  const parsed = parseRow({ line, projection: "retrieval" });
  if (!("record" in parsed)) {
    return;
  }
  noteNewestCapture({ kind: filter.kind, newest, record: parsed.record });
  if (!matchesLinearQuery({ filter, record: parsed.record })) {
    return;
  }
  if (records.length >= MATCH_CEILING) {
    progress.overflowed = true;
    return;
  }
  records.push(parsed.record);
}

/**
 * Scan the local Linear bronze for every record matching a filter.
 *
 * @param dir the bronze Linear directory to walk
 * @param filter the resolved query every record is tested against
 * @param home the Slopweaver home whose protect list the walk is judged by; `dir` may sit outside it
 * @param protection an injected resolver, which a test supplies so it never reads the owner's own registry
 * @returns the matching records and the read's own account of itself, or a typed refusal — the owner's protect
 *   list refusing the walk among them, which is never reported as no local corpus
 */
export function scanLinearBronze({
  dir,
  filter,
  home,
  protection,
}: {
  dir: string;
  filter: LinearQueryFilter;
  home: string;
  protection?: OwnerProtectionResolver | undefined;
}): Result<LinearScanResult, LinearQueryError> {
  const scanned = scanJsonlProtected({
    dir,
    home,
    operation: { target: "Linear bronze", verb: "query" },
    protection,
  });
  if (scanned.isErr()) {
    return err(LinearQueryErrors.localScanFailed({ message: scanned.error.join("; ") }));
  }
  const scan = scanned.value;
  if (scan.files.length === 0) {
    return err(LinearQueryErrors.noLocalCorpus({ dir }));
  }
  const records: CorpusRecord[] = [];
  const newest = new Map<string, string>();
  // A mutable holder rather than two `let`s: the counters are written from inside the per-line callback, and
  // a plain binding assigned only there narrows to its initialiser for every read after the loop.
  const progress = { overflowed: false, rowsScanned: 0 };
  const unreadable: string[] = [...scan.unreadableDirs];
  for (const file of scan.files) {
    const read = safeFs({
      execute: () => {
        readJsonlLines({
          onLine: ({ line }) => {
            foldLine({ filter, line, newest, progress, records });
          },
          path: file.path,
        });
      },
      operation: "scanLinearBronze",
      path: file.path,
    });
    if (read.isErr()) {
      unreadable.push(file.path);
    }
  }
  if (progress.overflowed) {
    return err(LinearQueryErrors.tooManyMatches({ ceiling: MATCH_CEILING }));
  }
  return ok({
    records: currentMatches({ newest, records }),
    rowsScanned: progress.rowsScanned,
    unreadable,
    warnings: protectedSkipWarnings({ scan }),
  });
}

/**
 * The bronze directory a query reads: an explicit `--corpus` dir verbatim, else the Linear source dir under
 * the state home.
 *
 * @param home the state home, when no explicit corpus dir was given
 * @param corpus the explicit corpus directory `--corpus` named
 * @returns the directory to scan
 */
export function linearBronzeDir({ home, corpus }: { home: string | undefined; corpus: string | undefined }): string {
  if (corpus !== undefined) {
    return corpus;
  }
  return bronzeSourceDir({ source: "linear", ...(home !== undefined ? { home } : {}) });
}
