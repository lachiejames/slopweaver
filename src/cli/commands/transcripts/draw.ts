/**
 * `slopweaver transcripts draw` — what each verb a session ran cost it in tokens, per tick, and every cap refusal
 * it retried (a trim-after-write lap) with what the lap spent.
 *
 * A thin effectful shell over the pure fold in `src/transcripts/draw.ts`, which carries where every number comes
 * from. It reuses `./scope.ts`'s scope and retention machinery, and walks RAW lines because `message.usage` — the
 * only measured token count in a transcript — is not on the decoded record.
 */
import { logger } from "#lib/logger.js";
import type { Result } from "#lib/result.js";
import { err, ok } from "#lib/result.js";
import { type DrawSummary, type DrawVerbCall, summariseDraw, verbCallsOf } from "../../../transcripts/draw.js";
import { drawReading } from "../../../transcripts/drawFold.js";
import type { DrawReading } from "../../../transcripts/drawShapes.js";
import { type SessionFile, transcriptLines } from "../../../transcripts/source.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_EXPECTED_EMPTY, EXIT_OK } from "../../exitCodes.js";
import { parseTranscriptsDrawArgs, resolveLimit } from "./core.js";
import { jsonEnvelope, retentionReport } from "./render.js";
import { prepare, refuse, reportWalkFailure } from "./scope.js";

const DRAW_USAGE =
  "usage: slopweaver transcripts draw [--session <value>] [--projects <dir>] [--since <value>] [--until <value>] [--project <value>] [--from-tick <n>] [--to-tick <n>] [--verb <head>] [--limit <value>] [--json]";

/** Walk one transcript's raw lines into its draw reading; a line past the walker's cap is skipped and named. */
function readingOf({ session }: { session: SessionFile }): Result<DrawReading> {
  const stream = transcriptLines({ path: session.path });
  if (stream.isErr()) {
    return err([stream.error.message]);
  }
  const oversized: string[] = [];
  const lines = (function* text(): Generator<string> {
    for (const raw of stream.value.lines) {
      if ("oversized" in raw) {
        oversized.push(`line ${String(raw.lineNumber)} is past the walker's limit and was not read`);
        continue;
      }
      yield raw.line;
    }
  })();
  const reading = drawReading({ lines });
  oversized.forEach((message) => {
    logger.error({ msg: `transcripts: ${session.sessionId} — ${message}` });
  });
  return stream.value.problems.length > 0 ? err(stream.value.problems) : ok(reading);
}

/** A `--from-tick`/`--to-tick` value as a whole number, the given default when absent. */
function tickFlag({ raw, name, absent }: { raw: unknown; name: string; absent: number }): Result<number> {
  if (raw === undefined) {
    return ok(absent);
  }
  if (typeof raw !== "string" || !/^\d+$/u.test(raw)) {
    return err([`--${name} takes a whole tick number, not ${JSON.stringify(raw)}`]);
  }
  return ok(Number(raw));
}

/** A whole number, rounded for a table cell. */
function cell({ value }: { value: number }): string {
  return String(Math.round(value));
}

/**
 * The report as text lines: the totals, the verbs ranked by tokens carried per tick, and every cap refusal.
 *
 * @param summary the folded report
 * @param limit how many verb rows to print
 * @returns the lines
 */
export function drawLines({ summary, limit }: { summary: DrawSummary; limit: number }): readonly string[] {
  const head = [
    `${String(summary.ticks)} tick(s), ${String(summary.apiCalls)} API calls, ${String(summary.calls)} tool calls, ${String(summary.compactions)} compaction(s)`,
    `per tick: ${cell({ value: summary.promptTokensPerTick })} prompt tokens read, ${cell({ value: summary.outputTokensPerTick })} output tokens, ${cell({ value: summary.resultTokensPerTick })} result tokens added, ${cell({ value: summary.preambleTokensPerTick })} of them stale-seat preamble (estimated)`,
    `measured gaps imply ${summary.impliedCharsPerToken.toFixed(2)} chars/token; ${String(summary.unmeasuredGaps)} result(s) sat in a gap that shrank and took their verb's mean`,
    "",
    "verb                                     calls  /tick  mean tok  est tok  tok/tick  carried/tick  preamble  errors",
  ];
  const rows = summary.verbs
    .slice(0, limit)
    .map((row) =>
      [
        row.head.padEnd(40).slice(0, 40),
        String(row.calls).padStart(5),
        row.callsPerTick.toFixed(1).padStart(6),
        cell({ value: row.meanTokens }).padStart(9),
        cell({ value: row.meanEstimatedTokens }).padStart(8),
        cell({ value: row.tokensPerTick }).padStart(9),
        cell({ value: row.carriedPerTick }).padStart(13),
        `${(row.preambleShare * 100).toFixed(0)}%`.padStart(9),
        String(row.errors).padStart(7),
      ].join(" "),
    );
  const retryHead = [
    "",
    `${String(summary.retries.length)} shape refusal(s), ${String(summary.retriedLaps)} retried: ${cell({ value: summary.lapTokens / summary.ticks })} tokens a tick written into the rewrites, ${cell({ value: summary.lapCarried / summary.ticks })} a tick carried by the refusals, ${(summary.lapApiCalls / summary.ticks).toFixed(1)} extra API calls a tick reading ${cell({ value: summary.lapPromptTokens / summary.ticks })} prompt tokens`,
    ...summary.retriesByCap.map(
      (row) =>
        `  ${row.cap} (${row.heads.join(", ")}): ${String(row.refusals)} refusal(s), ${(row.lapApiCalls / summary.ticks).toFixed(1)} extra API calls a tick reading ${cell({ value: row.lapPromptTokens / summary.ticks })} prompt tokens, ${cell({ value: row.lapTokens })} tok rewritten`,
    ),
  ];
  const retryRows = summary.retries.map(
    (row) =>
      `  tick ${String(row.tick)}  ${row.head}  ${row.retried ? `retried after ${String(row.callsBetween)} call(s), lap ${cell({ value: row.lapOutputTokens + row.refusalTokens })} tok` : "not retried"}  — ${row.refusal.slice(0, 120)}`,
  );
  const attachmentLines = [
    "",
    `attachments per tick (hook context and harness reminders): ${summary.attachmentsPerTick
      .slice(0, 8)
      .map((row) => `${row.kind} ${cell({ value: row.tokensPerTick })}`)
      .join(", ")}`,
    `${String(summary.hookRefusals)} call(s) refused by a PreToolUse hook, their refusals adding ${cell({ value: summary.hookRefusalTokens })} tokens`,
  ];
  return [...head, ...rows, ...attachmentLines, ...retryHead, ...retryRows];
}

/** The `--verb` listing: one line per call, its measured tokens and how many calls read it. */
function verbCallLines({ calls }: { calls: readonly DrawVerbCall[] }): readonly string[] {
  if (calls.length === 0) {
    return [];
  }
  return [
    "",
    "tick  tokens  reads  call",
    ...calls.map(
      (call) =>
        `${String(call.tick).padStart(4)}  ${(call.tokens < 0 ? "?" : cell({ value: call.tokens })).padStart(6)}  ${String(call.reads).padStart(5)}  ${call.label}`,
    ),
  ];
}

/**
 * What each verb in scope cost its session in tokens, and every cap refusal it retried.
 *
 * @param argv the full process argv
 * @returns the process exit code
 */
export function runTranscriptsDraw(argv: readonly string[]): number {
  const prepared = prepare({
    argv,
    ignoreUntilForFiles: true,
    parse: parseTranscriptsDrawArgs,
    requireScope: true,
    usage: DRAW_USAGE,
  });
  if ("code" in prepared) {
    return prepared.code;
  }
  const { scope, parsed } = prepared;
  const limit = resolveLimit({ fallback: 20, raw: parsed.values["limit"] });
  const fromTick = tickFlag({ absent: 0, name: "from-tick", raw: parsed.values["from-tick"] });
  const toTick = tickFlag({ absent: Number.MAX_SAFE_INTEGER, name: "to-tick", raw: parsed.values["to-tick"] });
  const flagErrors = [limit, fromTick, toTick].flatMap((result) => (result.isErr() ? result.error : []));
  if (limit.isErr() || fromTick.isErr() || toTick.isErr()) {
    return refuse({ errors: flagErrors, usage: DRAW_USAGE });
  }
  const readings: DrawReading[] = [];
  for (const session of scope.sessions) {
    const reading = readingOf({ session });
    if (reading.isErr()) {
      reportWalkFailure({ errors: reading.error, session });
      continue;
    }
    readings.push(reading.value);
  }
  const summary = summariseDraw({ fromTick: fromTick.value, readings, toTick: toTick.value });
  const verb = parsed.values["verb"];
  const verbCalls =
    typeof verb === "string"
      ? verbCallsOf({ fromTick: fromTick.value, head: verb, readings, toTick: toTick.value })
      : [];
  if (scope.json) {
    logger.out({
      line: jsonEnvelope({
        payload: { sessionsWalked: readings.length, summary, verbCalls },
        retention: scope.retention,
      }),
    });
    return summary.calls === 0 ? EXIT_EXPECTED_EMPTY : EXIT_OK;
  }
  logger.out({ line: retentionReport({ retention: scope.retention }) });
  drawLines({ limit: limit.value, summary }).forEach((line) => {
    logger.out({ line });
  });
  verbCallLines({ calls: verbCalls }).forEach((line) => {
    logger.out({ line });
  });
  return summary.calls === 0 ? EXIT_EXPECTED_EMPTY : EXIT_OK;
}

export const transcriptsDrawCommand = defineCommand({ run: runTranscriptsDraw });
