/**
 * Reporting one `session watch` batch whose fold and cursor are already committed: the drain's own diagnostics, the
 * screen inventory, and the three output modes — the row lines, the `--json` row array, and the `--json-report`
 * document `--record-reading` appends (`./watchReadingRecord.ts`). Kept beside `./watch.ts`, which owns the argument
 * handling, the starting state and the drain's wiring; this file is the only part that grows when an output mode is
 * added.
 */
import type { SessionActivity } from "../../../cmux/sessionActivity.js";
import { logger } from "../../../lib/logger.js";
import { recordReading } from "../../../readings/store.js";
import { activityFor } from "../../../sessions/liveSessionStore.js";
import {
  renderSessionWatchRow,
  renderSuppressedSessionWatchRows,
  reportedSessionWatchRows,
  type SessionWatchReport,
  STALE_UNMAPPED_AFTER_MS,
  sessionWatchReportDocument,
  withSessionTitles,
} from "../../../sessions/watchReport.js";
import { claudeProjectsDir } from "../../../transcripts/source.js";
import { EXIT_OK } from "../../exitCodes.js";
import { watchInventory } from "./seatWallScan.js";
import type { WatchBatch } from "./watchFollow.js";
import { emitWatchReportDocument } from "./watchReadingRecord.js";

/** What a drain says when its cursor had already aged out — printed, and carried in `--json-report`. */
const MISSED_EVENTS_DIAGNOSTIC =
  "the recorded cursor had already aged out of cmux's retained buffer — some events were MISSED, so this batch is not a complete picture";

/** What a drain says when cmux never answered it at all, and it ended on its own deadline. */
const UNANSWERED_DIAGNOSTIC =
  "cmux answered this drain with neither an acknowledgement nor an event before its deadline, so this report read no fleet rather than a quiet one";

/** What a drain says when cmux kept hanging up mid-replay and the resumed rounds could not reach the live edge. */
const TRUNCATED_DIAGNOSTIC =
  "cmux closed the subscription before its replay reached the live edge and resuming did not finish it, so this batch is not a complete picture — the cursor advanced to the last event folded";

/** What the text form prints when there is no row to show, so an empty reading is never an empty file. */
const NO_ROWS_LINE = "session watch: no session rows to report";

/**
 * Write one report to the two output channels.
 *
 * Under `--json` the DATA channel stays the row array it has always been, so a caller joining it to `cmux
 * list --json` keeps working, and the collapsed count goes to stderr instead of being dropped — a gauge
 * quietly declining to show something is the defect this whole windowing exists to fix, so it is never
 * silent about what it withheld. Under `--json-report` the data channel is one document carrying the rows,
 * the count and the instant together (`sessionWatchReportDocument`), for a caller that records the reading.
 * The text form prints {@link NO_ROWS_LINE} when it has nothing else, so stdout is never empty on success.
 *
 * @param report the rows to render and what was collapsed out of them
 * @param asJson whether the caller asked for the machine-readable row array
 * @param asJsonReport whether the caller asked for the whole report as one document
 * @param observedAtIso the instant the rows were judged at
 * @param diagnostics what this drain could not see — carried in the document, printed either way
 * @param recordReadingBy who takes the `--json-report` document as a reading, `undefined` when nobody does
 * @param home the state home the reading is recorded under
 * @returns the exit the report earns: non-zero only when a requested append was refused
 */
function emitReport({
  report,
  asJson,
  asJsonReport,
  observedAtIso,
  diagnostics,
  recordReadingBy,
  home,
}: {
  report: SessionWatchReport;
  asJson: boolean;
  asJsonReport: boolean;
  observedAtIso: string;
  diagnostics: readonly string[];
  recordReadingBy: string | undefined;
  home: string;
}): number {
  if (asJsonReport) {
    return emitWatchReportDocument({
      by: recordReadingBy,
      document: sessionWatchReportDocument({ diagnostics, observedAtIso, report }),
      home,
      recordedAtIso: new Date().toISOString(),
      sinks: {
        recordReading: (input) => recordReading({ ...input }),
        writeDiagnostic: (line) => {
          logger.error({ msg: line });
        },
        writeOut: (line) => {
          logger.out({ line });
        },
      },
    });
  }
  const suppressed = renderSuppressedSessionWatchRows({ report });
  if (asJson) {
    logger.out({ line: JSON.stringify(report.rows) });
    if (suppressed !== undefined) {
      logger.warn({ msg: suppressed });
    }
    return EXIT_OK;
  }
  for (const row of report.rows) {
    logger.out({ line: renderSessionWatchRow({ row }) });
  }
  if (suppressed !== undefined) {
    logger.out({ line: suppressed });
    return EXIT_OK;
  }
  if (report.rows.length === 0) {
    logger.out({ line: NO_ROWS_LINE });
  }
  return EXIT_OK;
}

/**
 * The report with each Claude Code row's own session title, when it is the `--json-report` document. Only that
 * document carries titles — the tick runs a plain watch beside it, which would read every transcript twice — and
 * only the rows it keeps, each off a bounded tail of its own transcript.
 */
function titledWhenReported({
  asJsonReport,
  report,
}: {
  asJsonReport: boolean;
  report: SessionWatchReport;
}): SessionWatchReport {
  if (!asJsonReport) {
    return report;
  }
  const projectsDir = claudeProjectsDir();
  return {
    ...report,
    rows: withSessionTitles({
      rows: report.rows,
      titleOf: (transcriptId) => activityFor({ projectsDir, sessionId: transcriptId }).title,
    }),
  };
}

/**
 * What a batch could not see, in the order the document carries them.
 *
 * @internal exported so a unit test can pin which diagnostic each drain outcome carries, and their order; the rest
 * of this file reads the screen and the transcripts, which a unit test cannot.
 * @returns the drain's own diagnostics, before the inventory's
 */
export function drainDiagnostics({ batch }: { batch: WatchBatch }): readonly string[] {
  return [
    ...(batch.gap ? [MISSED_EVENTS_DIAGNOSTIC] : []),
    ...(batch.answered ? [] : [UNANSWERED_DIAGNOSTIC]),
    ...(batch.truncated ? [TRUNCATED_DIAGNOSTIC] : []),
  ];
}

/**
 * Report one batch's already-committed fold.
 *
 * @param batch the events just drained and what the drain could not see
 * @param activities the fold, committed, that the report reads
 * @param idleAfterMs how long a quiet session must have been quiet to count as idle
 * @param includeStale whether the caller asked to see the collapsed rows anyway
 * @param asJson whether the caller asked for the machine-readable row array
 * @param asJsonReport whether the caller asked for the whole report as one document
 * @param home the state home whose recorded supervisor pin the screen scan skips, and where a reading is recorded
 * @param recordReadingBy who takes the `--json-report` document as a reading, `undefined` when nobody does
 * @returns the exit the report earns
 */
export async function reportBatch({
  batch,
  activities,
  idleAfterMs,
  includeStale,
  asJson,
  asJsonReport,
  home,
  recordReadingBy,
}: {
  batch: WatchBatch;
  activities: Readonly<Record<string, SessionActivity>>;
  idleAfterMs: number;
  includeStale: boolean;
  asJson: boolean;
  asJsonReport: boolean;
  home: string;
  recordReadingBy: string | undefined;
}): Promise<number> {
  const diagnostics = drainDiagnostics({ batch });
  for (const diagnostic of diagnostics) {
    logger.error({ msg: `session watch: ${diagnostic}` });
  }
  const judgedAtIso = new Date().toISOString();
  const inventoried = await watchInventory({ activities, home, idleAfterMs, nowIso: judgedAtIso });
  const reported = reportedSessionWatchRows({
    includeStale,
    inventoryRead: inventoried.read,
    rows: inventoried.rows,
    staleAfterMs: STALE_UNMAPPED_AFTER_MS,
  });
  const report = titledWhenReported({ asJsonReport, report: reported });
  return emitReport({
    asJson,
    asJsonReport,
    diagnostics: [...diagnostics, ...inventoried.problems],
    home,
    observedAtIso: judgedAtIso,
    recordReadingBy,
    report,
  });
}
