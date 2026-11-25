/**
 * `session watch --json-report --record-reading <by>` — print the report document, then append that same text to
 * the readings ledger, kept beside `./watch.ts` rather than inside it.
 *
 * Two actors take this reading: the supervisor tick, which ledgers the child's stdout itself
 * (`../../../supervisor/scratch/tickCapture.ts`), and the Fleet page's own opening refresh, whose sync row runs the
 * verb with `--record-reading sync-now` (`site/lib/syncVerbs.ts`). The append comes AFTER the drain has committed its
 * fold and cursor, so a drain that lost the compare-and-set to a concurrent one never reaches it: it exits non-zero
 * with nothing appended, and the winner's reading is the one the page reads next. A refused append exits non-zero
 * after the document printed, because the sync route reads exit 0 as "the reading was taken".
 */
import type { Result } from "#lib/result.js";

import type { ReadingsError } from "../../../readings/errors.js";
import { type PrintedReadingAppend, printedReadingOutputOf } from "../../../readings/printedReading.js";
import type { ReadingReceipt } from "../../../readings/types.js";
import { EXIT_ERROR, EXIT_OK } from "../../exitCodes.js";

/** The producer the reading files under — the verb words `reading last --producer "session watch"` reads. */
const SESSION_WATCH_PRODUCER = "session watch";

/** The seams the print-then-record step writes through. */
export interface WatchReportSinks {
  readonly writeOut: (line: string) => void;
  readonly writeDiagnostic: (line: string) => void;
  readonly recordReading: (input: PrintedReadingAppend) => Result<ReadingReceipt, ReadingsError>;
}

/**
 * Print the `--json-report` document and, when `--record-reading` named who took it, append that exact text.
 *
 * @param document the report document, carrying its own `observedAtIso`
 * @param by the flag's value, `undefined` when absent — then nothing is appended
 * @param home the state home the drain read under, where the reading is recorded too
 * @param recordedAtIso the append instant
 * @param sinks stdout, stderr and the ledger append
 * @returns 0 when nothing was asked or the row landed; 1 when the ledger refused it, after the document printed
 */
export function emitWatchReportDocument({
  by,
  document,
  home,
  recordedAtIso,
  sinks,
}: {
  by: string | undefined;
  document: { readonly observedAtIso: string };
  home: string;
  recordedAtIso: string;
  sinks: WatchReportSinks;
}): number {
  const output = printedReadingOutputOf({
    by,
    document,
    home,
    observedAtIso: document.observedAtIso,
    producer: SESSION_WATCH_PRODUCER,
    recordedAtIso,
  });
  sinks.writeOut(output.text);
  if (output.append === undefined) {
    return EXIT_OK;
  }
  const recorded = sinks.recordReading(output.append);
  if (recorded.isErr()) {
    sinks.writeDiagnostic(`session watch: the reading was not recorded — ${recorded.error.message}`);
    return EXIT_ERROR;
  }
  return EXIT_OK;
}

/**
 * Commit a batch's fold and cursor, then report from the committed state — never the other way round. A commit
 * the store refused (another drain won the compare-and-set, the store is down) throws its message before the
 * report runs, so no document prints and no reading is appended; the drain turns the throw into a non-zero exit.
 *
 * @param commit the fold-and-cursor commit, under the revision this drain started from
 * @param report the report over the committed state: what prints, and what `--record-reading` appends
 * @returns the report's exit
 */
export async function commitThenReport<S>({
  commit,
  report,
}: {
  commit: () => Promise<Result<S, { readonly message: string }>>;
  report: (committed: S) => Promise<number>;
}): Promise<number> {
  const committed = await commit();
  if (committed.isErr()) {
    throw new Error(committed.error.message);
  }
  return report(committed.value);
}

/**
 * Why `--record-reading` cannot run with the flags beside it, or `undefined` when it can: it records the one
 * `--json-report` document a plain drain prints, so it needs `--json-report` and refuses `--follow`, whose batches
 * would each be a reading.
 *
 * @param by the flag's value, `undefined` when absent
 * @param jsonReport whether `--json-report` was given
 * @param follow whether `--follow` was given
 * @returns the usage problem, or `undefined`
 */
export function recordReadingRefusal({
  by,
  follow,
  jsonReport,
}: {
  by: string | undefined;
  follow: boolean;
  jsonReport: boolean;
}): string | undefined {
  if (by === undefined) {
    return undefined;
  }
  if (!jsonReport) {
    return "--record-reading records the --json-report document, so it needs --json-report";
  }
  if (follow) {
    return "--record-reading records one plain drain's document, so it cannot run with --follow";
  }
  return undefined;
}
