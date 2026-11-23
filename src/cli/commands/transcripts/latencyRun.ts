/**
 * `slopweaver transcripts latency` — how long each tool call took, and whether that changed across an instant.
 *
 * A thin effectful shell over the pure folds in `src/transcripts/latency.ts`: the scope, window and retention
 * machinery is {@link ./scope}, the parsers are {@link ./core}, and every rendered line is {@link ./render}.
 */

import { logger } from "../../../lib/logger.js";
import {
  type LatencyFilter,
  type LatencyReading,
  type LatencySummary,
  latencySamples,
  summariseLatency,
} from "../../../transcripts/latency.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_EXPECTED_EMPTY, EXIT_OK } from "../../exitCodes.js";
import { parseTranscriptsLatencyArgs, resolveBucketMs, resolveSplitMs, resolveToolFilter } from "./core.js";
import { jsonEnvelope, latencyLines, retentionReport } from "./render.js";
import { prepare, refuse, type Scope, type Swept, sweep } from "./scope.js";

const LATENCY_USAGE =
  "usage: slopweaver transcripts latency [--session <value>] [--projects <dir>] [--since <value>] [--until <value>] [--project <value>] [--tool <value>] [--command-prefix <value>] [--split <value>] [--bucket <value>] [--limit <value>] [--json]";

/**
 * How long each tool call took, and whether that changed across an instant.
 *
 * @param argv the full process argv
 * @returns the process exit code
 */
export function runTranscriptsLatency(argv: readonly string[]): number {
  const prepared = prepare({
    argv,
    ignoreUntilForFiles: true,
    parse: parseTranscriptsLatencyArgs,
    requireScope: true,
    usage: LATENCY_USAGE,
  });
  if ("code" in prepared) {
    return prepared.code;
  }
  const { scope, parsed } = prepared;
  const bucketMs = resolveBucketMs({ fallbackMinutes: 60, raw: parsed.values["bucket"] });
  if (bucketMs.isErr()) {
    return refuse({ errors: bucketMs.error, usage: LATENCY_USAGE });
  }
  const splitMs = resolveSplitMs({ raw: parsed.values["split"] });
  if (splitMs.isErr()) {
    return refuse({ errors: splitMs.error, usage: LATENCY_USAGE });
  }
  const commandPrefixFlag = parsed.values["command-prefix"];
  const filter: LatencyFilter = {
    commandPrefix: typeof commandPrefixFlag === "string" ? commandPrefixFlag : "",
    sinceMs: prepared.window.sinceMs,
    tools: resolveToolFilter({ raw: parsed.values["tool"] }),
    untilMs: prepared.window.untilMs,
  };
  const swept = sweep({ fold: (readings) => latencySamples({ filter, readings }), sessions: scope.sessions });
  const reading: LatencyReading = mergeLatencyReadings({ readings: swept.results });
  const summary = summariseLatency({ bucketMs: bucketMs.value, reading, splitMs: splitMs.value });
  return reportLatency({ filter, scope, summary, swept });
}

/**
 * Sum one reading per transcript into one.
 *
 * Summed rather than concatenated-then-refolded because a call and its result are always in the SAME file:
 * a cross-file join would be a join between two sessions, which is not a thing that happens.
 *
 * @param readings one reading per transcript walked
 * @returns the combined reading
 */
export function mergeLatencyReadings({ readings }: { readings: readonly LatencyReading[] }): LatencyReading {
  return {
    orphanResults: readings.reduce((sum, one) => sum + one.orphanResults, 0),
    samples: readings.flatMap((one) => one.samples),
    unmatchedCalls: readings.reduce((sum, one) => sum + one.unmatchedCalls, 0),
    untimedRecords: readings.reduce((sum, one) => sum + one.untimedRecords, 0),
  };
}

/**
 * What the filter cut the sample down to, said in words rather than left for a reader to reconstruct.
 *
 * @param filter the resolved filter
 * @param sessionsWalked how many transcripts the sweep read
 * @returns the sentence
 */
export function filterNoteOf({ filter, sessionsWalked }: { filter: LatencyFilter; sessionsWalked: number }): string {
  const tools = filter.tools.length === 0 ? "every tool" : filter.tools.join(", ");
  const prefix = filter.commandPrefix === "" ? "" : ` · commands starting \`${filter.commandPrefix}\``;
  return `${tools} across ${sessionsWalked} transcript(s)${prefix}`;
}

/**
 * Print what `transcripts latency` measured.
 *
 * @param summary the assembled report
 * @param filter the resolved filter, for the sample sentence
 * @param swept how much was walked
 * @param scope the resolved scope, for the retention line and the `--json` switch
 * @returns the process exit code
 */
function reportLatency({
  summary,
  filter,
  swept,
  scope,
}: {
  summary: LatencySummary;
  filter: LatencyFilter;
  swept: Swept<unknown>;
  scope: Scope;
}): number {
  const filterNote = filterNoteOf({ filter, sessionsWalked: swept.walked });
  if (scope.json) {
    logger.out({
      line: jsonEnvelope({
        payload: {
          buckets: summary.buckets,
          byTool: summary.byTool,
          filter,
          matched: summary.reading.samples.length,
          orphanResults: summary.reading.orphanResults,
          overall: summary.overall,
          sessionsWalked: swept.walked,
          split: summary.split,
          unmatchedCalls: summary.reading.unmatchedCalls,
          unreadable: swept.failed,
          untimedRecords: summary.reading.untimedRecords,
        },
        retention: scope.retention,
      }),
    });
    return summary.overall.count === 0 ? EXIT_EXPECTED_EMPTY : EXIT_OK;
  }
  logger.out({ line: retentionReport({ retention: scope.retention }) });
  latencyLines({ filterNote, summary }).forEach((line) => {
    logger.out({ line });
  });
  return summary.overall.count === 0 ? EXIT_EXPECTED_EMPTY : EXIT_OK;
}

export const transcriptsLatencyCommand = defineCommand({ run: runTranscriptsLatency });
