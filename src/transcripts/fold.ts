/**
 * The structured questions a transcript answers about ITSELF: how many turns of each role, how much of the
 * traffic was the machine talking to itself, which tool calls failed, and over what span.
 *
 * ## Why these numbers and not a search
 *
 * The one thing that had been tried over this corpus was a lexical sweep, and it is measurably not a
 * friction detector: it counts mentions, and a sweeping session's own output is echoed back into its own
 * transcript, so its top hits are its own words. Roles, counts and `tool_result.is_error` cannot do that —
 * they are properties of the record rather than of its prose. Everything here is one of those.
 *
 * The ratio the summary reports is the reason the phase is worth its own build: nobody has an autonomy
 * figure for the current fleet, and it falls straight out of `assistantTurns / humanTurns`.
 *
 * ## Streaming by construction
 *
 * Both folds take an ITERABLE of readings, so the effectful edge streams a 40 MB transcript through them one
 * line at a time and holds only the accumulator. An array satisfies the same signature, which is what the
 * unit suite passes.
 *
 * Pure: readings in, counts out. No I/O, no clock.
 */

import { absentAsNumber } from "#lib/absent.js";
import { classifyRecord } from "./extract.js";
import type { LineReading, TranscriptRecord } from "./record.js";

/**
 * How many unmatched `tool_use` ids the failure fold will hold at once.
 *
 * A call and its result are adjacent in the file, so the map is normally near-empty; the cap exists so that
 * a transcript whose tail was truncated mid-flight (every call unanswered) cannot grow it without bound.
 * When it is exceeded the OLDEST entries go, because the newest are the ones a result is about to quote.
 */
const PENDING_TOOL_CALLS = 1_000;

/** What one transcript says about its own shape. */
export interface TranscriptSummary {
  /** Lines read, decoded or not. */
  readonly lineCount: number;
  /** Lines that did not decode into a `user`/`assistant` record — housekeeping, or a truncated fragment. */
  readonly undecodedLines: number;
  /** Turns a person actually took, after every wrapper was stripped. */
  readonly humanTurns: number;
  /** Assistant turns. */
  readonly assistantTurns: number;
  /** `tool_result` blocks seen. */
  readonly toolResults: number;
  /** `tool_result` blocks carrying `is_error: true`. */
  readonly toolErrors: number;
  /** Records marked `isSidechain` — a subagent's turns rather than the main thread's. */
  readonly sidechainRecords: number;
  /** Machine `user` records by the kind that was stripped. */
  readonly stripped: Readonly<Record<string, number>>;
  /** The models that served this session, in first-seen order. */
  readonly models: readonly string[];
  /** The first record's ISO instant, or "" when nothing carried one. */
  readonly firstIso: string;
  /** The last record's ISO instant, or "" when nothing carried one. */
  readonly lastIso: string;
  /** The working directory the session ran in, as its first record reports it. */
  readonly cwd: string;
}

/** A mutable tally, private to {@link summariseReadings}. Its frozen projection is the exported summary. */
interface SummaryTally {
  lineCount: number;
  undecodedLines: number;
  humanTurns: number;
  assistantTurns: number;
  toolResults: number;
  toolErrors: number;
  sidechainRecords: number;
  firstIso: string;
  lastIso: string;
  cwd: string;
}

/**
 * Add one decoded record to the running tally.
 *
 * @param tally the accumulator being filled
 * @param record the decoded line
 * @param stripped the by-kind counter for machine `user` records
 * @param models the first-seen model set
 */
function tallyRecord({
  tally,
  record,
  stripped,
  models,
}: {
  tally: SummaryTally;
  record: TranscriptRecord;
  stripped: Record<string, number>;
  models: Set<string>;
}): void {
  if (record.timestamp !== "") {
    tally.firstIso = tally.firstIso === "" ? record.timestamp : tally.firstIso;
    tally.lastIso = record.timestamp;
  }
  tally.cwd = tally.cwd === "" ? record.cwd : tally.cwd;
  tally.sidechainRecords += record.isSidechain ? 1 : 0;
  tally.toolResults += record.toolResults.length;
  tally.toolErrors += record.toolResults.filter((result) => result.isError).length;
  if (record.model !== "") {
    models.add(record.model);
  }
  if (record.role === "assistant") {
    tally.assistantTurns += 1;
    return;
  }
  const reading = classifyRecord({ record });
  if (reading.kind === "human") {
    tally.humanTurns += 1;
    return;
  }
  stripped[reading.machine] = absentAsNumber({ value: stripped[reading.machine], whenAbsent: 0 }) + 1;
}

/**
 * Fold a transcript's line readings into its own shape.
 *
 * @param readings every line's reading, in file order
 * @returns the counts, the span and the models
 */
export function summariseReadings({ readings }: { readings: Iterable<LineReading> }): TranscriptSummary {
  const tally: SummaryTally = {
    assistantTurns: 0,
    cwd: "",
    firstIso: "",
    humanTurns: 0,
    lastIso: "",
    lineCount: 0,
    sidechainRecords: 0,
    toolErrors: 0,
    toolResults: 0,
    undecodedLines: 0,
  };
  const stripped: Record<string, number> = {};
  const models = new Set<string>();
  for (const reading of readings) {
    tally.lineCount += 1;
    if ("undecoded" in reading) {
      tally.undecodedLines += 1;
      continue;
    }
    tallyRecord({ models, record: reading.record, stripped, tally });
  }
  return { ...tally, models: [...models], stripped };
}

/** One tool call that came back an error. */
export interface ToolFailure {
  /** The 1-based line the failing result sits on. */
  readonly lineNumber: number;
  /** The result's ISO instant, or "" when the line carried none. */
  readonly timestamp: string;
  /** The tool that failed, or "" when the call it answers was outside the lines read. */
  readonly tool: string;
  /** The `tool_use` id, so the call and its result can be joined by hand. */
  readonly toolUseId: string;
  /** The error body, verbatim. Callers truncate for display; nothing is truncated here. */
  readonly text: string;
}

/**
 * Carry one record's `tool_use` calls forward so the results that answer them can be named.
 *
 * @param pending the bounded call map, mutated in place
 * @param record the decoded line
 */
function rememberCalls({ pending, record }: { pending: Map<string, string>; record: TranscriptRecord }): void {
  for (const use of record.toolUses) {
    pending.set(use.toolUseId, use.name);
    if (pending.size > PENDING_TOOL_CALLS) {
      const oldest = pending.keys().next();
      // `done` is false whenever the map is over its cap, so the value is present; the assertion says that
      // rather than deleting an empty key, which would silently leave the map over its bound forever.
      pending.delete(oldest.value!);
    }
  }
}

/**
 * The tool a result answers, or a stated absence.
 *
 * Written as a branch rather than as `?? ""`: an empty name here is a FACT the renderer reports in as many
 * words ("the call is not in this file"), not a default quietly standing in for a missing one, and the house
 * rule against empty-string coalescing exists precisely so the two cannot be confused.
 *
 * @param pending the bounded call map
 * @param toolUseId the id the result quotes back
 * @returns the tool's name, or "" when its call fell outside the lines read
 */
function toolNameFor({ pending, toolUseId }: { pending: Map<string, string>; toolUseId: string }): string {
  const named = pending.get(toolUseId);
  if (named === undefined) {
    return "";
  }
  return named;
}

/**
 * The failing results on one record, each named with the tool that produced it.
 *
 * @param pending the bounded call map, consumed as results match
 * @param record the decoded line
 * @returns the failures on this line, in block order
 */
function failuresOn({
  pending,
  record,
}: {
  pending: Map<string, string>;
  record: TranscriptRecord;
}): readonly ToolFailure[] {
  const failures: ToolFailure[] = [];
  for (const result of record.toolResults) {
    const tool = toolNameFor({ pending, toolUseId: result.toolUseId });
    pending.delete(result.toolUseId);
    if (result.isError) {
      failures.push({
        lineNumber: record.lineNumber,
        text: result.text,
        timestamp: record.timestamp,
        tool,
        toolUseId: result.toolUseId,
      });
    }
  }
  return failures;
}

/**
 * Every failing tool result, named with the tool that produced it.
 *
 * The name is not on the result — it is on the `tool_use` block that preceded it — so the calls are carried
 * forward in a bounded map and dropped as they are matched. A result whose call fell outside the lines read
 * reports an empty tool name rather than a guessed one.
 *
 * @param readings every line's reading, in file order
 * @returns the failures, in file order
 */
export function failedToolResults({ readings }: { readings: Iterable<LineReading> }): readonly ToolFailure[] {
  const pending = new Map<string, string>();
  const failures: ToolFailure[] = [];
  for (const reading of readings) {
    if ("undecoded" in reading) {
      continue;
    }
    rememberCalls({ pending, record: reading.record });
    failures.push(...failuresOn({ pending, record: reading.record }));
  }
  return failures;
}

/**
 * Sum many transcripts' summaries into one.
 *
 * The span becomes the union of the spans and the model list the union of the models; the `cwd` is dropped
 * to "" rather than picking one, because a sweep across projects has no single working directory and
 * naming one of them would be a quietly wrong fact.
 *
 * @param summaries the per-transcript summaries, in any order
 * @returns the aggregate
 */
export function mergeSummaries({ summaries }: { summaries: Iterable<TranscriptSummary> }): TranscriptSummary {
  const tally: SummaryTally = {
    assistantTurns: 0,
    cwd: "",
    firstIso: "",
    humanTurns: 0,
    lastIso: "",
    lineCount: 0,
    sidechainRecords: 0,
    toolErrors: 0,
    toolResults: 0,
    undecodedLines: 0,
  };
  const stripped: Record<string, number> = {};
  const models = new Set<string>();
  for (const summary of summaries) {
    tally.lineCount += summary.lineCount;
    tally.undecodedLines += summary.undecodedLines;
    tally.humanTurns += summary.humanTurns;
    tally.assistantTurns += summary.assistantTurns;
    tally.toolResults += summary.toolResults;
    tally.toolErrors += summary.toolErrors;
    tally.sidechainRecords += summary.sidechainRecords;
    tally.firstIso = earlier({ left: tally.firstIso, right: summary.firstIso });
    tally.lastIso = later({ left: tally.lastIso, right: summary.lastIso });
    summary.models.forEach((model) => models.add(model));
    for (const [kind, count] of Object.entries(summary.stripped)) {
      stripped[kind] = absentAsNumber({ value: stripped[kind], whenAbsent: 0 }) + count;
    }
  }
  return { ...tally, models: [...models], stripped };
}

/**
 * The earlier of two ISO instants, treating "" as absent rather than as the epoch.
 *
 * @param left one instant, or ""
 * @param right the other, or ""
 * @returns the earlier present instant, or "" when neither is present
 */
function earlier({ left, right }: { left: string; right: string }): string {
  if (left === "" || right === "") {
    return left === "" ? right : left;
  }
  return left <= right ? left : right;
}

/**
 * The later of two ISO instants, treating "" as absent rather than as the epoch.
 *
 * @param left one instant, or ""
 * @param right the other, or ""
 * @returns the later present instant, or "" when neither is present
 */
function later({ left, right }: { left: string; right: string }): string {
  if (left === "" || right === "") {
    return left === "" ? right : left;
  }
  return left >= right ? left : right;
}
