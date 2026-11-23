/**
 * `slopweaver transcripts` — structured, typed access to the Claude session transcripts on this machine.
 *
 * ## Why there is no search verb here, and never will be
 *
 * The one thing that had been tried over this corpus was a lexical sweep, and it is measurably not a
 * friction detector: it counts MENTIONS, and a sweeping session's own output is echoed back into its own
 * transcript, so its top hits are its own words. Every verb below asks a STRUCTURED question instead —
 * roles, counts, `tool_result.is_error`, the human turns — because those are properties of the record
 * rather than of its prose. A `transcripts grep` would make the false positives cheaper to generate rather
 * than harder, which is the opposite of the point.
 *
 * ## Every path states the retention bound
 *
 * Claude Code deletes old transcripts, so "nothing found" over an aged-out window means the evidence was
 * deleted, not that nothing happened. The floor is measured off the disk on every invocation and printed
 * whatever the verb found — see `transcripts/retention.ts`.
 *
 * A thin effectful shell: the parsers are {@link ./core}, every rendered line is {@link ./render}, and the
 * folds are the pure modules under `src/transcripts/`.
 */

import { logger } from "../../../lib/logger.js";
import { extractUserTurns, type HumanTurn } from "../../../transcripts/extract.js";
import {
  failedToolResults,
  mergeSummaries,
  summariseReadings,
  type ToolFailure,
  type TranscriptSummary,
} from "../../../transcripts/fold.js";
import type { LineReading, TranscriptRecord } from "../../../transcripts/record.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_EXPECTED_EMPTY, EXIT_OK } from "../../exitCodes.js";
import {
  parseTranscriptsErrorsArgs,
  parseTranscriptsSessionsArgs,
  parseTranscriptsSummaryArgs,
  parseTranscriptsTurnsArgs,
  resolveLimit,
} from "./core.js";
import {
  failureRow,
  jsonEnvelope,
  mergeStrippedCounts,
  retentionReport,
  sessionRow,
  summaryLines,
  summarySubject,
  turnRow,
} from "./render.js";
import { prepare, refuse, type Scope, type Swept, sweep } from "./scope.js";

const SESSIONS_USAGE =
  "usage: slopweaver transcripts sessions [--projects <dir>] [--since <value>] [--until <value>] [--project <value>] [--limit <value>] [--json]";
const TURNS_USAGE =
  "usage: slopweaver transcripts turns [--session <value>] [--projects <dir>] [--since <value>] [--until <value>] [--limit <value>] [--full] [--json]";
const SUMMARY_USAGE = "usage: slopweaver transcripts summary [--session <value>] [--projects <dir>] [--json]";
const ERRORS_USAGE =
  "usage: slopweaver transcripts errors [--session <value>] [--projects <dir>] [--limit <value>] [--json]";

/**
 * List the session transcripts on this machine.
 *
 * @param argv the full process argv
 * @returns the process exit code
 */
export function runTranscriptsSessions(argv: readonly string[]): number {
  const prepared = prepare({ argv, parse: parseTranscriptsSessionsArgs, requireScope: false, usage: SESSIONS_USAGE });
  if ("code" in prepared) {
    return prepared.code;
  }
  const { scope } = prepared;
  const limit = resolveLimit({ fallback: 40, raw: prepared.parsed.values["limit"] });
  if (limit.isErr()) {
    return refuse({ errors: limit.error, usage: SESSIONS_USAGE });
  }
  const shown = scope.sessions.slice(0, limit.value);
  if (scope.json) {
    logger.out({
      line: jsonEnvelope({
        payload: { selected: scope.sessions.length, sessions: shown, shown: shown.length },
        retention: scope.retention,
      }),
    });
    return scope.sessions.length === 0 ? EXIT_EXPECTED_EMPTY : EXIT_OK;
  }
  logger.out({ line: retentionReport({ retention: scope.retention }) });
  shown.forEach((session) => {
    logger.out({ line: sessionRow({ session }) });
  });
  logger.out({ line: `${scope.sessions.length} transcripts in scope, ${shown.length} shown` });
  return scope.sessions.length === 0 ? EXIT_EXPECTED_EMPTY : EXIT_OK;
}

/**
 * The turns that actually steered the sessions in scope.
 *
 * @param argv the full process argv
 * @returns the process exit code
 */
export function runTranscriptsTurns(argv: readonly string[]): number {
  const prepared = prepare({ argv, parse: parseTranscriptsTurnsArgs, requireScope: true, usage: TURNS_USAGE });
  if ("code" in prepared) {
    return prepared.code;
  }
  const { scope } = prepared;
  const limit = resolveLimit({ fallback: 50, raw: prepared.parsed.values["limit"] });
  if (limit.isErr()) {
    return refuse({ errors: limit.error, usage: TURNS_USAGE });
  }
  const swept = sweep({
    fold: (readings) => extractUserTurns({ records: decodedOnly({ readings }) }),
    sessions: scope.sessions,
  });
  const turns = swept.results.flatMap((extracted) => extracted.turns);
  const stripped = mergeStrippedCounts({ counts: swept.results.map((extracted) => extracted.stripped) });
  return reportTurns({
    limit: limit.value,
    scope,
    stripped,
    swept,
    turns,
    full: prepared.parsed.values["full"] === true,
  });
}

/**
 * Print what `transcripts turns` found.
 *
 * @param turns every extracted human turn
 * @param stripped the machine records that were stripped, by kind
 * @param swept how much was walked
 * @param scope the resolved scope, for the retention line and the `--json` switch
 * @param limit how many rows to show
 * @param full whether to print each turn whole
 * @returns the process exit code
 */
function reportTurns({
  turns,
  stripped,
  swept,
  scope,
  limit,
  full,
}: {
  turns: readonly HumanTurn[];
  stripped: Readonly<Record<string, number>>;
  swept: Swept<unknown>;
  scope: Scope;
  limit: number;
  full: boolean;
}): number {
  const shown = turns.slice(0, limit);
  if (scope.json) {
    logger.out({
      line: jsonEnvelope({
        payload: { humanTurns: turns.length, sessionsWalked: swept.walked, shown, stripped, unreadable: swept.failed },
        retention: scope.retention,
      }),
    });
    return turns.length === 0 ? EXIT_EXPECTED_EMPTY : EXIT_OK;
  }
  logger.out({ line: retentionReport({ retention: scope.retention }) });
  shown.forEach((turn) => {
    logger.out({ line: turnRow({ full, turn }) });
  });
  logger.out({
    line: `${turns.length} human turns across ${swept.walked} transcripts (${swept.failed} unreadable), ${shown.length} shown`,
  });
  return turns.length === 0 ? EXIT_EXPECTED_EMPTY : EXIT_OK;
}

/**
 * What the sessions in scope say about their own shape.
 *
 * @param argv the full process argv
 * @returns the process exit code
 */
export function runTranscriptsSummary(argv: readonly string[]): number {
  const prepared = prepare({ argv, parse: parseTranscriptsSummaryArgs, requireScope: true, usage: SUMMARY_USAGE });
  if ("code" in prepared) {
    return prepared.code;
  }
  const { scope } = prepared;
  const swept = sweep({ fold: (readings) => summariseReadings({ readings }), sessions: scope.sessions });
  if (swept.walked === 0) {
    return reportNothingWalked({ scope });
  }
  const merged: TranscriptSummary =
    swept.results.length === 1 ? swept.results[0]! : mergeSummaries({ summaries: swept.results });
  if (scope.json) {
    logger.out({
      line: jsonEnvelope({
        payload: { bytes: swept.bytes, sessionsWalked: swept.walked, summary: merged, unreadable: swept.failed },
        retention: scope.retention,
      }),
    });
    return EXIT_OK;
  }
  logger.out({ line: retentionReport({ retention: scope.retention }) });
  summaryLines({
    bytes: swept.bytes,
    ...summarySubject({ projectsDir: scope.projectsDir, sessions: scope.sessions, walked: swept.walked }),
    summary: merged,
  }).forEach((line) => {
    logger.out({ line });
  });
  return EXIT_OK;
}

/**
 * Every tool call in scope that came back an error.
 *
 * @param argv the full process argv
 * @returns the process exit code
 */
export function runTranscriptsErrors(argv: readonly string[]): number {
  const prepared = prepare({ argv, parse: parseTranscriptsErrorsArgs, requireScope: true, usage: ERRORS_USAGE });
  if ("code" in prepared) {
    return prepared.code;
  }
  const { scope } = prepared;
  const limit = resolveLimit({ fallback: 50, raw: prepared.parsed.values["limit"] });
  if (limit.isErr()) {
    return refuse({ errors: limit.error, usage: ERRORS_USAGE });
  }
  const swept = sweep({ fold: (readings) => failedToolResults({ readings }), sessions: scope.sessions });
  const failures: readonly ToolFailure[] = swept.results.flat();
  const shown = failures.slice(0, limit.value);
  if (scope.json) {
    logger.out({
      line: jsonEnvelope({
        payload: {
          failures: shown,
          sessionsWalked: swept.walked,
          toolErrors: failures.length,
          unreadable: swept.failed,
        },
        retention: scope.retention,
      }),
    });
    return failures.length === 0 ? EXIT_EXPECTED_EMPTY : EXIT_OK;
  }
  logger.out({ line: retentionReport({ retention: scope.retention }) });
  shown.forEach((failure) => {
    logger.out({ line: failureRow({ failure }) });
  });
  logger.out({
    line: `${failures.length} failing tool results across ${swept.walked} transcripts (${swept.failed} unreadable), ${shown.length} shown`,
  });
  return failures.length === 0 ? EXIT_EXPECTED_EMPTY : EXIT_OK;
}

/** The decoded records of a reading stream, lazily — the undecoded lines are the fold's business, not this one's. */
function* decodedOnly({ readings }: { readings: Iterable<LineReading> }): Generator<TranscriptRecord> {
  for (const reading of readings) {
    if (!("undecoded" in reading)) {
      yield reading.record;
    }
  }
}

/**
 * What a sweep that walked nothing reports.
 *
 * It is a deliberate non-zero: a caller piping this into an alert wants to hear that its window found no
 * transcripts, and the retention line above says whether that means deleted or absent.
 *
 * @param scope the resolved scope
 * @returns the process exit code
 */
function reportNothingWalked({ scope }: { scope: Scope }): number {
  const line = retentionReport({ retention: scope.retention });
  logger.out({
    line: scope.json
      ? jsonEnvelope({ payload: { sessionsWalked: 0, summary: null }, retention: scope.retention })
      : line,
  });
  if (!scope.json) {
    logger.out({ line: "no transcripts in scope" });
  }
  return EXIT_EXPECTED_EMPTY;
}

export const transcriptsSessionsCommand = defineCommand({ run: runTranscriptsSessions });
export const transcriptsTurnsCommand = defineCommand({ run: runTranscriptsTurns });
export const transcriptsSummaryCommand = defineCommand({ run: runTranscriptsSummary });
export const transcriptsErrorsCommand = defineCommand({ run: runTranscriptsErrors });
