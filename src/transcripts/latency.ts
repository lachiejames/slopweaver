/**
 * How long each tool call in a transcript actually took, folded out of the record stream. Pure.
 *
 * ## Where the number comes from, and what it is not
 *
 * A Claude Code transcript writes the `tool_use` block on the ASSISTANT record that issued the call, and
 * the answering `tool_result` block on the USER record that carried it back, joined by `tool_use_id`. So
 * one call's latency is the difference between those two records' own `timestamp` fields. That is
 * wall-clock time from the call being written to its answer being written — it includes the tool's own work
 * and anything the machine was doing instead of it, which is exactly the quantity a question about a
 * machine-wide sensor is asking about, and exactly the wrong quantity for judging a tool in isolation.
 *
 * ## Two shapes that would silently corrupt a percentile, named rather than absorbed
 *
 * **A parallel batch.** One assistant record may carry several `tool_use` blocks, and they all share that
 * record's single timestamp. Their measured latencies therefore include waiting for each other, so a batch
 * of 8 reads makes the 8th look slow and the sample look bimodal. Every sample carries
 * {@link LatencySample.parallel}, and {@link summariseLatency} counts them separately rather than mixing
 * them into the percentiles.
 *
 * **An unmatched call.** A call whose result never arrives — the session was killed, the turn was
 * interrupted, the result fell outside the lines read — has no end instant. It is COUNTED as unmatched, and
 * contributes no sample, because the alternative (treating it as instantaneous, or as running until the
 * end of the file) invents a number.
 *
 * ## The homogeneity problem this module cannot solve for you
 *
 * `Bash` is not one tool: `git status` and a 10-minute test run are the same `tool_name`. Comparing raw
 * `Bash` percentiles across two windows compares the WORKLOADS as much as the machine. The filters
 * ({@link LatencyFilter}) exist so a caller can cut a homogeneous slice — one tool, or one command prefix —
 * before asking the question. Nothing here can tell whether the slice you cut is homogeneous; the summary
 * reports what it measured so a reader can judge that themselves.
 *
 * The verb is `src/cli/commands/transcripts/latencyRun.ts`; the record decoding is `./record.ts`.
 */

import type { LineReading, TranscriptRecord } from "./record.js";

/** One completed tool call, with the wall-clock time between its call record and its result record. */
export interface LatencySample {
  /** The tool that was called, e.g. `Bash`. */
  readonly tool: string;
  /** The `Bash` command's first token run, or "" for every other tool and for an unrecorded input. */
  readonly commandHead: string;
  /** The call's id, so a sample can be traced back to both records that produced it. */
  readonly toolUseId: string;
  /** When the call was written — the assistant record's own timestamp. */
  readonly startedIso: string;
  /** Epoch milliseconds of {@link startedIso}, which is what every bucket and split compares. */
  readonly startedMs: number;
  /** Wall-clock milliseconds from the call record to the result record. Never negative. */
  readonly latencyMs: number;
  /** Whether the answering result reported a failure. */
  readonly isError: boolean;
  /** Whether the call shared its assistant record with others, so its latency includes queueing. */
  readonly parallel: boolean;
  /** Whether the call was made by a subagent rather than on the main thread. */
  readonly sidechain: boolean;
}

/**
 * Which calls a fold keeps. An absent field filters nothing.
 *
 * The time bounds are here rather than only on the file selection, and that distinction is the whole
 * point: `--since 2d` picks which transcripts to WALK by their last write, and a transcript written an
 * hour ago may hold calls from last week. Without bounding the samples too, a two-day window quietly
 * reports a seven-day one — measured on the first real run of this verb, where a `--since 2d` before/after
 * split drew its before side from a week earlier.
 */
export interface LatencyFilter {
  /** Keep only these tool names, exactly. Empty keeps every tool. */
  readonly tools: readonly string[];
  /** Keep only calls whose command starts with this, after trimming. "" keeps every call. */
  readonly commandPrefix: string;
  /** Keep only calls STARTED at or after this instant, epoch ms. Absent keeps every earlier call. */
  readonly sinceMs: number | undefined;
  /** Keep only calls STARTED at or before this instant, epoch ms. Absent keeps every later call. */
  readonly untilMs: number | undefined;
}

/** A call seen but not yet answered — everything a sample needs except its end instant. */
interface PendingCall {
  readonly tool: string;
  readonly commandHead: string;
  readonly command: string;
  readonly startedIso: string;
  readonly startedMs: number;
  readonly parallel: boolean;
  readonly sidechain: boolean;
}

/** What one sweep over a record stream produced — the samples, and everything it could not turn into one. */
export interface LatencyReading {
  /** Every matched call that passed the filter, in the order its result arrived. */
  readonly samples: readonly LatencySample[];
  /** Calls that passed the filter and whose result never arrived in these lines. */
  readonly unmatchedCalls: number;
  /** Results whose call was not in these lines, so no start instant exists for them. */
  readonly orphanResults: number;
  /** Records on either side of a pair that carried no usable timestamp, so no duration could be taken. */
  readonly untimedRecords: number;
}

/** The nearest-rank percentile of a sorted ascending list. */
function nearestRank({ sorted, fraction }: { sorted: readonly number[]; fraction: number }): number {
  const rank = Math.ceil(fraction * sorted.length);
  const index = Math.min(Math.max(rank, 1), sorted.length) - 1;
  return sorted[index]!;
}

/** The statistics one set of samples supports. */
export interface LatencyStats {
  readonly count: number;
  readonly p50Ms: number;
  readonly p90Ms: number;
  readonly maxMs: number;
  readonly meanMs: number;
}

/**
 * Reduce a set of latencies to the five numbers every report here quotes.
 *
 * Percentiles are NEAREST-RANK rather than interpolated, and that choice is part of the contract: every
 * value reported is a latency some call actually had, so a reader comparing two windows is comparing
 * observations rather than two different interpolations between them.
 *
 * @param latenciesMs the durations, in any order
 * @returns the statistics, all zero when there are no samples
 */
export function latencyStats({ latenciesMs }: { latenciesMs: readonly number[] }): LatencyStats {
  if (latenciesMs.length === 0) {
    return { count: 0, maxMs: 0, meanMs: 0, p50Ms: 0, p90Ms: 0 };
  }
  const sorted = [...latenciesMs].toSorted((left, right) => left - right);
  const total = sorted.reduce((sum, value) => sum + value, 0);
  return {
    count: sorted.length,
    maxMs: sorted[sorted.length - 1]!,
    meanMs: total / sorted.length,
    p50Ms: nearestRank({ fraction: 0.5, sorted }),
    p90Ms: nearestRank({ fraction: 0.9, sorted }),
  };
}

/** Whether a call passes the filter. The start instant is the one every bound is applied to. */
function keeps({
  filter,
  tool,
  command,
  startedMs,
}: {
  filter: LatencyFilter;
  tool: string;
  command: string;
  startedMs: number | undefined;
}): boolean {
  if (filter.tools.length > 0 && !filter.tools.includes(tool)) {
    return false;
  }
  if (filter.commandPrefix !== "" && !command.trimStart().startsWith(filter.commandPrefix)) {
    return false;
  }
  if (startedMs === undefined) {
    // Untimed: the tool and command bounds passed, so this is a call the caller asked about, and it is
    // counted as untimed by `rememberCalls` rather than dropped here without a trace.
    return true;
  }
  if (filter.sinceMs !== undefined && startedMs < filter.sinceMs) {
    return false;
  }
  return filter.untilMs === undefined || startedMs <= filter.untilMs;
}

/**
 * The first token of a command, which is what makes a Bash slice readable in a report.
 *
 * Two tokens for `slopweaver`, because every verb in this repository is `slopweaver <noun>` and a head of
 * just `slopweaver` would collapse the whole CLI into one row.
 *
 * @param command the raw command, or ""
 * @returns the head, or "" when there was no command
 */
export function commandHeadOf({ command }: { command: string }): string {
  const tokens = command
    .trim()
    .split(/\s+/)
    .filter((token) => token !== "");
  const first = tokens[0];
  if (first === undefined) {
    return "";
  }
  const second = tokens[1];
  if (first.endsWith("slopweaver") && second !== undefined) {
    return `slopweaver ${second}`;
  }
  return first;
}

/** Epoch milliseconds of an ISO instant, or `undefined` when the field was absent or unparseable. */
function instantOf({ iso }: { iso: string }): number | undefined {
  if (iso === "") {
    return undefined;
  }
  const parsed = Date.parse(iso);
  return Number.isNaN(parsed) ? undefined : parsed;
}

/** Remember every call on an assistant record that passes the filter. */
function rememberCalls({
  pending,
  record,
  filter,
  untimed,
}: {
  pending: Map<string, PendingCall>;
  record: TranscriptRecord;
  filter: LatencyFilter;
  untimed: { count: number };
}): void {
  const startedMs = instantOf({ iso: record.timestamp });
  const parallel = record.toolUses.length > 1;
  for (const call of record.toolUses) {
    if (!keeps({ command: call.command, filter, startedMs, tool: call.name })) {
      continue;
    }
    if (startedMs === undefined) {
      untimed.count += 1;
      continue;
    }
    pending.set(call.toolUseId, {
      command: call.command,
      commandHead: commandHeadOf({ command: call.command }),
      parallel,
      sidechain: record.isSidechain,
      startedIso: record.timestamp,
      startedMs,
      tool: call.name,
    });
  }
}

/**
 * Fold a transcript's readings into one completed sample per matched tool call.
 *
 * Single pass, one map of outstanding calls: a `tool_use` is remembered, the matching `tool_result` closes
 * it and the entry is dropped, so the map holds only calls still in flight rather than the whole file.
 *
 * @param readings every line's reading, in file order
 * @param filter which calls to keep
 * @returns the samples, and the counts of everything that could not become one
 */
export function latencySamples({
  readings,
  filter,
}: {
  readings: Iterable<LineReading>;
  filter: LatencyFilter;
}): LatencyReading {
  const pending = new Map<string, PendingCall>();
  const samples: LatencySample[] = [];
  const untimed = { count: 0 };
  let orphanResults = 0;
  for (const reading of readings) {
    if ("undecoded" in reading) {
      continue;
    }
    const record = reading.record;
    rememberCalls({ filter, pending, record, untimed });
    const endedMs = instantOf({ iso: record.timestamp });
    for (const result of record.toolResults) {
      const call = pending.get(result.toolUseId);
      if (call === undefined) {
        orphanResults += 1;
        continue;
      }
      pending.delete(result.toolUseId);
      if (endedMs === undefined) {
        untimed.count += 1;
        continue;
      }
      samples.push({
        commandHead: call.commandHead,
        isError: result.isError,
        latencyMs: Math.max(0, endedMs - call.startedMs),
        parallel: call.parallel,
        sidechain: call.sidechain,
        startedIso: call.startedIso,
        startedMs: call.startedMs,
        tool: call.tool,
        toolUseId: result.toolUseId,
      });
    }
  }
  return { orphanResults, samples, unmatchedCalls: pending.size, untimedRecords: untimed.count };
}

/** One time bucket of samples, named by the instant it starts. */
export interface LatencyBucket {
  readonly startedIso: string;
  readonly stats: LatencyStats;
}

/**
 * Group samples into fixed buckets by their START instant, aligned to the epoch.
 *
 * Aligned to the epoch rather than to the first sample so that two runs over overlapping windows produce
 * the same bucket boundaries, which is what lets a reader lay two reports side by side.
 *
 * @param samples the completed samples
 * @param bucketMs the bucket width in milliseconds
 * @returns one bucket per interval that held at least one sample, oldest first
 */
export function bucketLatency({
  samples,
  bucketMs,
}: {
  samples: readonly LatencySample[];
  bucketMs: number;
}): readonly LatencyBucket[] {
  const byBucket = new Map<number, number[]>();
  for (const sample of samples) {
    const key = Math.floor(sample.startedMs / bucketMs) * bucketMs;
    const into = byBucket.get(key);
    if (into === undefined) {
      byBucket.set(key, [sample.latencyMs]);
      continue;
    }
    into.push(sample.latencyMs);
  }
  return [...byBucket.entries()]
    .toSorted((left, right) => left[0] - right[0])
    .map(([startedMs, latencies]) => ({
      startedIso: new Date(startedMs).toISOString(),
      stats: latencyStats({ latenciesMs: latencies }),
    }));
}

/**
 * What one side of a split measured, and how much of it was set aside.
 *
 * Named rather than inlined into {@link LatencySplit} so the two sides cannot drift apart, and reached
 * structurally through that type rather than imported.
 *
 * @internal
 */
export interface LatencySide {
  readonly stats: LatencyStats;
  readonly parallelExcluded: number;
  readonly errorsIncluded: number;
  readonly firstIso: string;
  readonly lastIso: string;
}

/** A before/after comparison across one instant. */
export interface LatencySplit {
  readonly splitIso: string;
  readonly before: LatencySide;
  readonly after: LatencySide;
  /** `after.p50 / before.p50`, or `null` when either side has no sample or the before-side p50 is zero. */
  readonly p50Ratio: number | null;
}

/** Reduce one side's samples, setting the parallel batches aside. */
function sideOf({ samples }: { samples: readonly LatencySample[] }): LatencySide {
  const serial = samples.filter((sample) => !sample.parallel);
  const instants = serial.map((sample) => sample.startedIso).toSorted();
  // Tested on LENGTH rather than on the element being undefined, so this reads as "an empty side has no
  // span" rather than as a nullish fallback — the shape `no-silent-fallback` exists to keep out.
  const empty = instants.length === 0;
  return {
    errorsIncluded: serial.filter((sample) => sample.isError).length,
    firstIso: empty ? "" : instants[0]!,
    lastIso: empty ? "" : instants[instants.length - 1]!,
    parallelExcluded: samples.length - serial.length,
    stats: latencyStats({ latenciesMs: serial.map((sample) => sample.latencyMs) }),
  };
}

/**
 * Split samples across one instant and reduce each side.
 *
 * Parallel-batch samples are excluded from both sides' statistics rather than dropped from the reading, and
 * the count that was set aside is reported on each side — a change in how much of the work was batched is
 * itself a difference between two windows, and one that would otherwise masquerade as a latency change.
 *
 * A sample starting exactly at the split instant belongs to the AFTER side, so the split reads as
 * "from this instant onwards", which is how a change made at a known time is described.
 *
 * @param samples the completed samples, in any order
 * @param splitMs the instant the two sides meet, epoch milliseconds
 * @returns each side's statistics and the ratio between their medians
 */
export function splitLatency({
  samples,
  splitMs,
}: {
  samples: readonly LatencySample[];
  splitMs: number;
}): LatencySplit {
  const before = sideOf({ samples: samples.filter((sample) => sample.startedMs < splitMs) });
  const after = sideOf({ samples: samples.filter((sample) => sample.startedMs >= splitMs) });
  const comparable = before.stats.count > 0 && after.stats.count > 0 && before.stats.p50Ms > 0;
  return {
    after,
    before,
    p50Ratio: comparable ? after.stats.p50Ms / before.stats.p50Ms : null,
    splitIso: new Date(splitMs).toISOString(),
  };
}

/** The whole reading, summarised for one report. */
export interface LatencySummary {
  readonly reading: LatencyReading;
  readonly overall: LatencyStats;
  readonly buckets: readonly LatencyBucket[];
  readonly split: LatencySplit | null;
  readonly byTool: readonly { readonly tool: string; readonly stats: LatencyStats }[];
}

/**
 * Assemble the whole report from one reading.
 *
 * @param reading what the fold produced
 * @param bucketMs the bucket width
 * @param splitMs the split instant, or `undefined` for no before/after comparison
 * @returns the overall statistics, the buckets, the per-tool breakdown and the split
 */
export function summariseLatency({
  reading,
  bucketMs,
  splitMs,
}: {
  reading: LatencyReading;
  bucketMs: number;
  splitMs: number | undefined;
}): LatencySummary {
  const serial = reading.samples.filter((sample) => !sample.parallel);
  const tools = new Map<string, number[]>();
  for (const sample of serial) {
    const into = tools.get(sample.tool);
    if (into === undefined) {
      tools.set(sample.tool, [sample.latencyMs]);
      continue;
    }
    into.push(sample.latencyMs);
  }
  const byTool = [...tools.entries()]
    .map(([tool, latencies]) => ({ stats: latencyStats({ latenciesMs: latencies }), tool }))
    .toSorted((left, right) => right.stats.count - left.stats.count);
  return {
    buckets: bucketLatency({ bucketMs, samples: serial }),
    byTool,
    overall: latencyStats({ latenciesMs: serial.map((sample) => sample.latencyMs) }),
    reading,
    split: splitMs === undefined ? null : splitLatency({ samples: reading.samples, splitMs }),
  };
}
