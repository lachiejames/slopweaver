/**
 * Every line `slopweaver transcripts` prints, and every `--json` payload it emits. Pure.
 *
 * The two are deliberately projections of the SAME view objects, so the human report and the machine one
 * cannot disagree about whether a window fell outside retention — the disagreement this repo has paid for
 * before, when a rendered summary and its JSON sibling were built from separate arithmetic.
 */

import { groupThousands } from "../../../lib/progressRender.js";
import { type BootHookFailure, hookLabel } from "../../../transcripts/bootHooks.js";
import type { HumanTurn } from "../../../transcripts/extract.js";
import type { ToolFailure, TranscriptSummary } from "../../../transcripts/fold.js";
import type { LatencySplit, LatencyStats, LatencySummary } from "../../../transcripts/latency.js";
import type { RetentionFloor, RetentionVerdict } from "../../../transcripts/retention.js";
import { retentionLine } from "../../../transcripts/retention.js";
import type { SessionFile } from "../../../transcripts/source.js";

/**
 * How much of a turn's text a row shows before `--full` is needed.
 *
 * @internal
 */
export const TURN_PREVIEW_CHARS = 240;

/**
 * How much of an error body a row shows.
 *
 * @internal
 */
export const ERROR_PREVIEW_CHARS = 200;

/** The retention facts every verb here reports, whatever else it found. */
export interface RetentionView {
  readonly floor: RetentionFloor;
  readonly verdict: RetentionVerdict;
}

/**
 * Collapse text to a single line and cut it to a budget, marking the cut.
 *
 * @param text the text to show
 * @param budget how many characters a row may spend on it
 * @returns the one-line preview
 */
export function preview({ text, budget }: { text: string; budget: number }): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length <= budget ? flat : `${flat.slice(0, budget)}… (+${flat.length - budget} chars)`;
}

/**
 * One row of `transcripts sessions`.
 *
 * @param session the listed transcript
 * @returns the row
 */
export function sessionRow({ session }: { session: SessionFile }): string {
  const mib = (session.bytes / (1024 * 1024)).toFixed(1);
  return `${session.sessionId}  ${new Date(session.lastWriteMs).toISOString()}  ${mib.padStart(7)} MiB  ${session.projectDir}`;
}

/**
 * One row of `transcripts turns`.
 *
 * @param turn the extracted human turn
 * @param full whether to print the turn whole rather than a preview
 * @returns the row
 */
export function turnRow({ turn, full }: { turn: HumanTurn; full: boolean }): string {
  const stamp = turn.timestamp === "" ? "(no timestamp)" : turn.timestamp;
  const body = full ? turn.text : preview({ budget: TURN_PREVIEW_CHARS, text: turn.text });
  return `${stamp}  L${turn.lineNumber}  [${turn.source}]  ${body}`;
}

/**
 * One row of `transcripts errors`.
 *
 * @param failure the failing tool result
 * @returns the row
 */
export function failureRow({ failure }: { failure: ToolFailure }): string {
  const stamp = failure.timestamp === "" ? "(no timestamp)" : failure.timestamp;
  const tool = failure.tool === "" ? "(call not in this file)" : failure.tool;
  return `${stamp}  L${failure.lineNumber}  ${tool}  ${preview({ budget: ERROR_PREVIEW_CHARS, text: failure.text })}`;
}

/**
 * One boot hook recorded as never run, as one line: when, which seat, which entry, and why.
 *
 * The entry is named by its `scripts/hook.sh` label rather than its command, which is a paragraph of
 * parameter expansion; a command with no label prints whole, so an unfamiliar shape is still named.
 *
 * @param failure the decoded failure
 * @returns the rendered row
 */
export function bootHookRow({ failure }: { failure: BootHookFailure }): string {
  const stamp = failure.timestamp === "" ? "(no timestamp)" : failure.timestamp;
  return `${stamp}  ${failure.sessionId}  L${failure.lineNumber}  ${failure.hookName}  ${hookEntry({ command: failure.command })}  ${failure.kind}  ${preview({ budget: ERROR_PREVIEW_CHARS, text: failure.stderr })}`;
}

/* A hook entry's name for a row: its `scripts/hook.sh` label, or the whole command when it has none. */
function hookEntry({ command }: { command: string }): string {
  const label = hookLabel({ command });
  if (label === undefined) {
    return command;
  }
  return label;
}

/**
 * The autonomy ratio a summary reports — assistant turns per human turn.
 *
 * Stated as a string rather than a number because the zero-human case has no ratio at all, and a session
 * that nobody has spoken to yet must not be reported as infinitely autonomous.
 *
 * @param summary the folded summary
 * @returns the ratio, or a phrase saying why there is none
 */
export function autonomyRatio({ summary }: { summary: TranscriptSummary }): string {
  if (summary.humanTurns === 0) {
    return "no human turns, so no ratio";
  }
  return `${(summary.assistantTurns / summary.humanTurns).toFixed(1)}:1 assistant turns per human turn`;
}

/**
 * What a `transcripts summary` heading names: the one session and its file when exactly one was walked, else
 * the count walked and the projects directory they came from.
 *
 * @param sessions the sessions in scope
 * @param projectsDir the corpus the scope was drawn from
 * @param walked how many transcripts the sweep actually read
 * @returns the heading's session label and path
 */
export function summarySubject({
  sessions,
  projectsDir,
  walked,
}: {
  sessions: readonly SessionFile[];
  projectsDir: string;
  walked: number;
}): { readonly sessionId: string; readonly path: string } {
  const [only, ...others] = sessions;
  if (only === undefined || others.length > 0) {
    return { path: projectsDir, sessionId: `${walked} transcripts` };
  }
  return { path: only.path, sessionId: only.sessionId };
}

/**
 * Sum per-transcript stripped-record counts into one count per kind, keeping each kind's first-seen order.
 *
 * @param counts one by-kind count per transcript
 * @returns the summed count per kind
 */
export function mergeStrippedCounts({
  counts,
}: {
  counts: readonly Readonly<Record<string, number>>[];
}): Readonly<Record<string, number>> {
  const merged: Record<string, number> = {};
  for (const one of counts) {
    for (const [kind, count] of Object.entries(one)) {
      const seen = merged[kind];
      merged[kind] = seen === undefined ? count : seen + count;
    }
  }
  return merged;
}

/**
 * The `transcripts summary` report.
 *
 * @param summary the folded summary
 * @param sessionId the session it describes
 * @param path the transcript it was read from
 * @param bytes how large that transcript is
 * @returns the report lines
 */
export function summaryLines({
  summary,
  sessionId,
  path,
  bytes,
}: {
  summary: TranscriptSummary;
  sessionId: string;
  path: string;
  bytes: number;
}): readonly string[] {
  const stripped = Object.entries(summary.stripped)
    .toSorted((left, right) => right[1] - left[1])
    .map(([kind, count]) => `${kind} ${groupThousands({ value: count })}`)
    .join(" · ");
  return [
    `session ${sessionId} · ${path}`,
    `${groupThousands({ value: summary.lineCount })} lines, ${(bytes / (1024 * 1024)).toFixed(1)} MiB · ${groupThousands({ value: summary.undecodedLines })} carried no message record`,
    `${groupThousands({ value: summary.humanTurns })} human turns · ${groupThousands({ value: summary.assistantTurns })} assistant turns · ${autonomyRatio({ summary })}`,
    `${groupThousands({ value: summary.toolResults })} tool results, ${groupThousands({ value: summary.toolErrors })} of them errors · ${groupThousands({ value: summary.sidechainRecords })} subagent records`,
    `machine turns wearing the user role: ${stripped === "" ? "none" : stripped}`,
    `span ${summary.firstIso === "" ? "unknown" : summary.firstIso} … ${summary.lastIso === "" ? "unknown" : summary.lastIso} · models ${summary.models.length === 0 ? "none named" : summary.models.join(", ")}`,
    `cwd ${summary.cwd === "" ? "not recorded" : summary.cwd}`,
  ];
}

/**
 * The retention sentence, emitted by every verb on every path.
 *
 * @param retention the measured floor and the window's verdict against it
 * @returns the line
 */
export function retentionReport({ retention }: { retention: RetentionView }): string {
  return retentionLine({ floor: retention.floor, verdict: retention.verdict });
}

/**
 * The `--json` envelope every verb here shares: its payload, plus the retention facts.
 *
 * @param payload the verb's own result
 * @param retention the measured floor and the window's verdict
 * @returns the JSON text
 */
export function jsonEnvelope({
  payload,
  retention,
}: {
  payload: Readonly<Record<string, unknown>>;
  retention: RetentionView;
}): string {
  return JSON.stringify(
    {
      ...payload,
      retention: {
        note: retentionReport({ retention }),
        oldestTranscriptIso: retention.floor.oldestIso === "" ? null : retention.floor.oldestIso,
        retainedDays: retention.floor.retainedDays,
        transcriptCount: retention.floor.transcriptCount,
        verdict: retention.verdict,
      },
    },
    null,
    2,
  );
}

/**
 * One duration, in the unit that keeps it readable at the scale it actually has.
 *
 * Milliseconds below a second, then seconds, then minutes — because this verb's samples span four orders of
 * magnitude (a 7 ms `Monitor` and a 10-minute `TaskOutput` sit in one report) and a single unit makes one
 * end of that range unreadable.
 *
 * @param ms the duration
 * @returns the formatted duration
 */
export function humanMs({ ms }: { ms: number }): string {
  if (ms < 1000) {
    return `${Math.round(ms)}ms`;
  }
  if (ms < 60_000) {
    return `${(ms / 1000).toFixed(1)}s`;
  }
  return `${(ms / 60_000).toFixed(1)}m`;
}

/**
 * One statistics line — the four numbers every latency report quotes, in one order everywhere.
 *
 * @param stats the reduced statistics
 * @returns the line, or a phrase saying the set was empty
 */
export function statsLine({ stats }: { stats: LatencyStats }): string {
  if (stats.count === 0) {
    return "no samples";
  }
  return `n=${groupThousands({ value: stats.count })} · p50 ${humanMs({ ms: stats.p50Ms })} · p90 ${humanMs({ ms: stats.p90Ms })} · max ${humanMs({ ms: stats.maxMs })} · mean ${humanMs({ ms: stats.meanMs })}`;
}

/**
 * The before/after block of the report.
 *
 * @param split the comparison
 * @returns the lines
 */
export function splitLines({ split }: { split: LatencySplit }): readonly string[] {
  const faster = split.p50Ratio !== null && split.p50Ratio < 1;
  const direction = faster ? "faster" : "slower";
  const ratio =
    split.p50Ratio === null
      ? "no ratio — one side has no serial sample, or the before-side median is zero"
      : `after/before p50 ratio ${split.p50Ratio.toFixed(2)}× (${direction} after)`;
  const beforeSpan = split.before.firstIso === "" ? "(empty)" : `${split.before.firstIso} … ${split.before.lastIso}`;
  const afterSpan = split.after.firstIso === "" ? "(empty)" : `${split.after.firstIso} … ${split.after.lastIso}`;
  return [
    `split at ${split.splitIso}`,
    `  before ${beforeSpan}  ${statsLine({ stats: split.before.stats })} · ${groupThousands({ value: split.before.parallelExcluded })} parallel excluded · ${groupThousands({ value: split.before.errorsIncluded })} error(s) in sample`,
    `  after  ${afterSpan}  ${statsLine({ stats: split.after.stats })} · ${groupThousands({ value: split.after.parallelExcluded })} parallel excluded · ${groupThousands({ value: split.after.errorsIncluded })} error(s) in sample`,
    `  ${ratio}`,
  ];
}

/**
 * The `transcripts latency` report.
 *
 * Every line states what it measured rather than only what it found: the counts of unmatched calls and
 * parallel batches are printed even when they are zero, because a reader comparing two windows needs to see
 * that the sample was whole rather than infer it from silence.
 *
 * @param summary the assembled report
 * @param filterNote what the filter cut the sample down to, in words
 * @returns the report lines
 */
export function latencyLines({
  summary,
  filterNote,
}: {
  summary: LatencySummary;
  filterNote: string;
}): readonly string[] {
  const reading = summary.reading;
  const parallel = reading.samples.length - summary.overall.count;
  const lines: string[] = [
    `sample: ${filterNote}`,
    `matched ${groupThousands({ value: reading.samples.length })} call(s) · ${groupThousands({ value: reading.unmatchedCalls })} never answered · ${groupThousands({ value: reading.orphanResults })} result(s) whose call was outside these lines · ${groupThousands({ value: reading.untimedRecords })} record(s) carried no usable timestamp`,
    `serial calls: ${statsLine({ stats: summary.overall })}`,
    `${groupThousands({ value: parallel })} call(s) shared an assistant record with another and are excluded from every statistic above — their latency includes waiting for their batch`,
  ];
  summary.byTool.forEach((row) => {
    lines.push(`  ${row.tool.padEnd(14)} ${statsLine({ stats: row.stats })}`);
  });
  if (summary.split !== null) {
    lines.push(...splitLines({ split: summary.split }));
  }
  summary.buckets.forEach((bucket) => {
    lines.push(`  ${bucket.startedIso}  ${statsLine({ stats: bucket.stats })}`);
  });
  return lines;
}
