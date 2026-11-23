/**
 * The latency fold, over hand-built readings rather than a real transcript.
 *
 * Every case here is a property the CrowdStrike measurement depended on being true: that a parallel batch
 * cannot inflate a percentile, that an unanswered call contributes no sample, and that a split reads as
 * "from this instant onwards". Each is asserted on an exact number, because a fold that quietly returns one
 * fewer sample than it should is the failure mode a `toBeGreaterThan` would pass.
 */
import { describe, expect, it } from "vitest";

import {
  bucketLatency,
  commandHeadOf,
  type LatencyFilter,
  latencySamples,
  latencyStats,
  splitLatency,
  summariseLatency,
} from "../../../transcripts/latency.js";
import type { LineReading, ToolUseBlock, TranscriptRecord } from "../../../transcripts/record.js";

const NO_FILTER: LatencyFilter = { commandPrefix: "", sinceMs: undefined, tools: [], untilMs: undefined };

/** An assistant record issuing calls at one instant. */
function calls({
  at,
  uses,
  sidechain = false,
}: {
  at: string;
  uses: readonly ToolUseBlock[];
  sidechain?: boolean;
}): LineReading {
  const record: TranscriptRecord = {
    blockKinds: uses.map(() => "tool_use"),
    cwd: "",
    hasToolUseResult: false,
    isCompactSummary: false,
    isMeta: false,
    isSidechain: sidechain,
    lineNumber: 1,
    model: "claude-opus-5",
    originKind: "",
    promptSource: "",
    role: "assistant",
    text: "",
    timestamp: at,
    toolResults: [],
    toolUses: uses,
    uuid: "",
  };
  return { record };
}

/** A user record carrying results back at one instant. */
function results({ at, ids, isError = false }: { at: string; ids: readonly string[]; isError?: boolean }): LineReading {
  const record: TranscriptRecord = {
    blockKinds: ids.map(() => "tool_result"),
    cwd: "",
    hasToolUseResult: true,
    isCompactSummary: false,
    isMeta: false,
    isSidechain: false,
    lineNumber: 2,
    model: "",
    originKind: "",
    promptSource: "",
    role: "user",
    text: "",
    timestamp: at,
    toolResults: ids.map((toolUseId) => ({ isError, text: "", toolUseId })),
    toolUses: [],
    uuid: "",
  };
  return { record };
}

/** One `tool_use` block. */
function use({ id, name, command = "" }: { id: string; name: string; command?: string }): ToolUseBlock {
  return { command, name, skill: "", toolUseId: id };
}

describe("latencySamples", () => {
  it("measures one call as the gap between its call record and its result record", () => {
    const reading = latencySamples({
      filter: NO_FILTER,
      readings: [
        calls({ at: "2026-09-15T03:00:00.000Z", uses: [use({ id: "a", name: "Bash", command: "git status" })] }),
        results({ at: "2026-09-15T03:00:02.500Z", ids: ["a"] }),
      ],
    });
    expect(reading.samples.length).toBe(1);
    expect(reading.samples[0]!.latencyMs).toBe(2500);
    expect(reading.samples[0]!.tool).toBe("Bash");
    expect(reading.samples[0]!.commandHead).toBe("git");
    expect(reading.samples[0]!.parallel).toBe(false);
    expect(reading.samples[0]!.startedIso).toBe("2026-09-15T03:00:00.000Z");
    expect(reading.unmatchedCalls).toBe(0);
    expect(reading.orphanResults).toBe(0);
  });

  it("marks every call on a multi-call assistant record as parallel", () => {
    const reading = latencySamples({
      filter: NO_FILTER,
      readings: [
        calls({
          at: "2026-09-15T03:00:00.000Z",
          uses: [use({ id: "a", name: "Read" }), use({ id: "b", name: "Read" })],
        }),
        results({ at: "2026-09-15T03:00:01.000Z", ids: ["a", "b"] }),
      ],
    });
    expect(reading.samples.length).toBe(2);
    expect(reading.samples.filter((sample) => sample.parallel).length).toBe(2);
  });

  it("counts a call whose result never arrives rather than inventing an end instant", () => {
    const reading = latencySamples({
      filter: NO_FILTER,
      readings: [calls({ at: "2026-09-15T03:00:00.000Z", uses: [use({ id: "a", name: "Bash" })] })],
    });
    expect(reading.samples).toStrictEqual([]);
    expect(reading.unmatchedCalls).toBe(1);
  });

  it("counts a result whose call was outside these lines as an orphan", () => {
    const reading = latencySamples({
      filter: NO_FILTER,
      readings: [results({ at: "2026-09-15T03:00:01.000Z", ids: ["ghost"] })],
    });
    expect(reading.samples).toStrictEqual([]);
    expect(reading.orphanResults).toBe(1);
  });

  it("counts a call with no usable timestamp instead of measuring from the epoch", () => {
    const reading = latencySamples({
      filter: NO_FILTER,
      readings: [
        calls({ at: "", uses: [use({ id: "a", name: "Bash" })] }),
        results({ at: "2026-09-15T03:00:01.000Z", ids: ["a"] }),
      ],
    });
    expect(reading.samples).toStrictEqual([]);
    expect(reading.untimedRecords).toBe(1);
    expect(reading.orphanResults).toBe(1);
  });

  it("never reports a negative latency when the records are out of order", () => {
    const reading = latencySamples({
      filter: NO_FILTER,
      readings: [
        calls({ at: "2026-09-15T03:00:05.000Z", uses: [use({ id: "a", name: "Bash" })] }),
        results({ at: "2026-09-15T03:00:01.000Z", ids: ["a"] }),
      ],
    });
    expect(reading.samples[0]!.latencyMs).toBe(0);
  });

  it("keeps only the named tools", () => {
    const reading = latencySamples({
      filter: { commandPrefix: "", sinceMs: undefined, tools: ["Read"], untilMs: undefined },
      readings: [
        calls({ at: "2026-09-15T03:00:00.000Z", uses: [use({ id: "a", name: "Bash" })] }),
        calls({ at: "2026-09-15T03:00:00.000Z", uses: [use({ id: "b", name: "Read" })] }),
        results({ at: "2026-09-15T03:00:01.000Z", ids: ["a", "b"] }),
      ],
    });
    expect(reading.samples.length).toBe(1);
    expect(reading.samples[0]!.tool).toBe("Read");
    expect(reading.orphanResults).toBe(1);
  });

  it("keeps only commands with the given prefix, ignoring leading whitespace", () => {
    const reading = latencySamples({
      filter: { commandPrefix: "git ", sinceMs: undefined, tools: [], untilMs: undefined },
      readings: [
        calls({
          at: "2026-09-15T03:00:00.000Z",
          uses: [use({ id: "a", name: "Bash", command: "  git status" })],
        }),
        calls({ at: "2026-09-15T03:00:00.000Z", uses: [use({ id: "b", name: "Bash", command: "yarn test" })] }),
        results({ at: "2026-09-15T03:00:01.000Z", ids: ["a", "b"] }),
      ],
    });
    expect(reading.samples.length).toBe(1);
    expect(reading.samples[0]!.toolUseId).toBe("a");
  });

  it("carries the subagent flag off the call record", () => {
    const reading = latencySamples({
      filter: NO_FILTER,
      readings: [
        calls({ at: "2026-09-15T03:00:00.000Z", sidechain: true, uses: [use({ id: "a", name: "Bash" })] }),
        results({ at: "2026-09-15T03:00:01.000Z", ids: ["a"] }),
      ],
    });
    expect(reading.samples[0]!.sidechain).toBe(true);
  });

  it("carries a failing result's error flag", () => {
    const reading = latencySamples({
      filter: NO_FILTER,
      readings: [
        calls({ at: "2026-09-15T03:00:00.000Z", uses: [use({ id: "a", name: "Bash" })] }),
        results({ at: "2026-09-15T03:00:01.000Z", ids: ["a"], isError: true }),
      ],
    });
    expect(reading.samples[0]!.isError).toBe(true);
  });

  it("keeps only calls STARTED inside the window, because file selection is not sample selection", () => {
    const reading = latencySamples({
      filter: {
        commandPrefix: "",
        sinceMs: Date.parse("2026-09-15T03:00:00.000Z"),
        tools: [],
        untilMs: Date.parse("2026-09-15T04:00:00.000Z"),
      },
      readings: [
        calls({ at: "2026-09-14T20:00:00.000Z", uses: [use({ id: "old", name: "Bash" })] }),
        calls({ at: "2026-09-15T03:30:00.000Z", uses: [use({ id: "in", name: "Bash" })] }),
        calls({ at: "2026-09-15T05:00:00.000Z", uses: [use({ id: "late", name: "Bash" })] }),
        results({ at: "2026-09-15T05:00:01.000Z", ids: ["old", "in", "late"] }),
      ],
    });
    expect(reading.samples.length).toBe(1);
    expect(reading.samples[0]!.toolUseId).toBe("in");
    expect(reading.orphanResults).toBe(2);
  });

  it("includes a call starting exactly on either bound", () => {
    const reading = latencySamples({
      filter: {
        commandPrefix: "",
        sinceMs: Date.parse("2026-09-15T03:00:00.000Z"),
        tools: [],
        untilMs: Date.parse("2026-09-15T04:00:00.000Z"),
      },
      readings: [
        calls({ at: "2026-09-15T03:00:00.000Z", uses: [use({ id: "lo", name: "Bash" })] }),
        calls({ at: "2026-09-15T04:00:00.000Z", uses: [use({ id: "hi", name: "Bash" })] }),
        results({ at: "2026-09-15T04:00:01.000Z", ids: ["lo", "hi"] }),
      ],
    });
    expect(reading.samples.map((one) => one.toolUseId)).toStrictEqual(["lo", "hi"]);
  });

  it("skips an undecoded line rather than ending the fold", () => {
    const reading = latencySamples({
      filter: NO_FILTER,
      readings: [
        calls({ at: "2026-09-15T03:00:00.000Z", uses: [use({ id: "a", name: "Bash" })] }),
        { undecoded: { lineNumber: 2, why: "not-json" } },
        results({ at: "2026-09-15T03:00:01.000Z", ids: ["a"] }),
      ],
    });
    expect(reading.samples.length).toBe(1);
  });
});

describe("latencyStats", () => {
  it("reports every number as zero for an empty set", () => {
    expect(latencyStats({ latenciesMs: [] })).toStrictEqual({ count: 0, maxMs: 0, meanMs: 0, p50Ms: 0, p90Ms: 0 });
  });

  it("takes nearest-rank percentiles, so every quoted value is an observed one", () => {
    expect(latencyStats({ latenciesMs: [10, 20, 30, 40, 50, 60, 70, 80, 90, 100] })).toStrictEqual({
      count: 10,
      maxMs: 100,
      meanMs: 55,
      p50Ms: 50,
      p90Ms: 90,
    });
  });

  it("reports the single value for a one-sample set", () => {
    expect(latencyStats({ latenciesMs: [7] })).toStrictEqual({ count: 1, maxMs: 7, meanMs: 7, p50Ms: 7, p90Ms: 7 });
  });

  it("does not depend on the input order", () => {
    expect(latencyStats({ latenciesMs: [100, 10, 50] }).p50Ms).toBe(50);
  });
});

describe("commandHeadOf", () => {
  it("returns the first token", () => {
    expect(commandHeadOf({ command: "git status --porcelain" })).toBe("git");
  });

  it("keeps the noun for a slopweaver verb, so the whole CLI is not one row", () => {
    expect(commandHeadOf({ command: "slopweaver handover list --json" })).toBe("slopweaver handover");
  });

  it("keeps the noun when the binary was reached by path", () => {
    expect(commandHeadOf({ command: "/usr/local/bin/slopweaver github checks" })).toBe("slopweaver github");
  });

  it("returns empty for a command that is not there", () => {
    expect(commandHeadOf({ command: "" })).toBe("");
  });

  it("returns the bare word when slopweaver was called with no noun", () => {
    expect(commandHeadOf({ command: "slopweaver" })).toBe("slopweaver");
  });
});

describe("bucketLatency", () => {
  it("aligns buckets to the epoch, so two runs produce the same boundaries", () => {
    const buckets = bucketLatency({
      bucketMs: 3_600_000,
      samples: [
        oneSample({ at: "2026-09-15T03:10:00.000Z", ms: 100 }),
        oneSample({ at: "2026-09-15T03:50:00.000Z", ms: 300 }),
        oneSample({ at: "2026-09-15T04:05:00.000Z", ms: 50 }),
      ],
    });
    expect(buckets.length).toBe(2);
    expect(buckets[0]!.startedIso).toBe("2026-09-15T03:00:00.000Z");
    expect(buckets[0]!.stats.count).toBe(2);
    expect(buckets[1]!.startedIso).toBe("2026-09-15T04:00:00.000Z");
    expect(buckets[1]!.stats.count).toBe(1);
  });

  it("emits no bucket for an empty sample", () => {
    expect(bucketLatency({ bucketMs: 3_600_000, samples: [] })).toStrictEqual([]);
  });
});

describe("splitLatency", () => {
  it("puts a sample starting exactly at the split on the after side", () => {
    const split = splitLatency({
      samples: [oneSample({ at: "2026-09-15T03:28:54.000Z", ms: 100 })],
      splitMs: Date.parse("2026-09-15T03:28:54.000Z"),
    });
    expect(split.before.stats.count).toBe(0);
    expect(split.after.stats.count).toBe(1);
  });

  it("reports the median ratio and the parallel count it set aside on each side", () => {
    const split = splitLatency({
      samples: [
        oneSample({ at: "2026-09-15T03:00:00.000Z", ms: 1000 }),
        oneSample({ at: "2026-09-15T03:10:00.000Z", ms: 1000 }),
        oneSample({ at: "2026-09-15T03:15:00.000Z", ms: 9000, parallel: true }),
        oneSample({ at: "2026-09-15T04:00:00.000Z", ms: 500 }),
        oneSample({ at: "2026-09-15T04:10:00.000Z", ms: 500 }),
      ],
      splitMs: Date.parse("2026-09-15T03:30:00.000Z"),
    });
    expect(split.before.stats.count).toBe(2);
    expect(split.before.parallelExcluded).toBe(1);
    expect(split.after.stats.count).toBe(2);
    expect(split.after.parallelExcluded).toBe(0);
    expect(split.p50Ratio).toBe(0.5);
  });

  it("reports no ratio when one side has no serial sample", () => {
    const split = splitLatency({
      samples: [oneSample({ at: "2026-09-15T03:00:00.000Z", ms: 1000 })],
      splitMs: Date.parse("2026-09-15T03:30:00.000Z"),
    });
    expect(split.p50Ratio).toBe(null);
    expect(split.after.firstIso).toBe("");
  });

  it("counts the errors inside each side's sample", () => {
    const split = splitLatency({
      samples: [
        oneSample({ at: "2026-09-15T03:00:00.000Z", isError: true, ms: 1000 }),
        oneSample({ at: "2026-09-15T04:00:00.000Z", ms: 1000 }),
      ],
      splitMs: Date.parse("2026-09-15T03:30:00.000Z"),
    });
    expect(split.before.errorsIncluded).toBe(1);
    expect(split.after.errorsIncluded).toBe(0);
  });
});

describe("summariseLatency", () => {
  it("excludes parallel calls from the overall statistics and from every bucket", () => {
    const summary = summariseLatency({
      bucketMs: 3_600_000,
      reading: {
        orphanResults: 0,
        samples: [
          oneSample({ at: "2026-09-15T03:00:00.000Z", ms: 100 }),
          oneSample({ at: "2026-09-15T03:05:00.000Z", ms: 90_000, parallel: true }),
        ],
        unmatchedCalls: 0,
        untimedRecords: 0,
      },
      splitMs: undefined,
    });
    expect(summary.overall.count).toBe(1);
    expect(summary.overall.maxMs).toBe(100);
    expect(summary.buckets.length).toBe(1);
    expect(summary.buckets[0]!.stats.count).toBe(1);
    expect(summary.split).toBe(null);
  });

  it("ranks the per-tool breakdown by sample count", () => {
    const summary = summariseLatency({
      bucketMs: 3_600_000,
      reading: {
        orphanResults: 0,
        samples: [
          oneSample({ at: "2026-09-15T03:00:00.000Z", ms: 10, tool: "Read" }),
          oneSample({ at: "2026-09-15T03:01:00.000Z", ms: 20, tool: "Bash" }),
          oneSample({ at: "2026-09-15T03:02:00.000Z", ms: 30, tool: "Bash" }),
        ],
        unmatchedCalls: 0,
        untimedRecords: 0,
      },
      splitMs: undefined,
    });
    expect(summary.byTool.map((row) => row.tool)).toStrictEqual(["Bash", "Read"]);
    expect(summary.byTool[0]!.stats.count).toBe(2);
  });

  it("carries the reading's own counts through untouched", () => {
    const summary = summariseLatency({
      bucketMs: 3_600_000,
      reading: { orphanResults: 3, samples: [], unmatchedCalls: 7, untimedRecords: 2 },
      splitMs: undefined,
    });
    expect(summary.reading.unmatchedCalls).toBe(7);
    expect(summary.reading.orphanResults).toBe(3);
    expect(summary.reading.untimedRecords).toBe(2);
    expect(summary.overall.count).toBe(0);
  });
});

/** One completed sample, for the pure reducers that take samples rather than readings. */
function oneSample({
  at,
  ms,
  parallel = false,
  isError = false,
  tool = "Bash",
}: {
  at: string;
  ms: number;
  parallel?: boolean;
  isError?: boolean;
  tool?: string;
}): {
  readonly tool: string;
  readonly commandHead: string;
  readonly toolUseId: string;
  readonly startedIso: string;
  readonly startedMs: number;
  readonly latencyMs: number;
  readonly isError: boolean;
  readonly parallel: boolean;
  readonly sidechain: boolean;
} {
  return {
    commandHead: "",
    isError,
    latencyMs: ms,
    parallel,
    sidechain: false,
    startedIso: at,
    startedMs: Date.parse(at),
    tool,
    toolUseId: `${at}-${String(ms)}`,
  };
}
