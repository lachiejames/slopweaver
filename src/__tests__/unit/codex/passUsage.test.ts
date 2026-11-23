import { describe, expect, it } from "vitest";

import { measuredTokens, type PassUsageSummary, summarizePassUsage, type UsageGap } from "../../../codex/passUsage.js";
import type { CodexArtifactRecord, CodexAttempt, CodexUsage, UnmeasuredReason } from "../../../codex/types.js";

const REPO = "/w/repo";

/**
 * A summary's gap rows, unwrapped by throwing rather than by a ternary.
 *
 * `.claude/rules/testing.md` bans `?:` inside an assertion because the fallback arm makes the test pass for
 * every shape it was not written for — including the one the case exists to catch.
 */
function gapsOf({ summary }: { summary: PassUsageSummary }): readonly UsageGap[] {
  if (summary.kind === "complete") {
    throw new Error("expected a summary carrying gaps, got complete");
  }
  return summary.gaps;
}

/** A partial summary's measured attempt count, unwrapped by throwing. */
function partialMeasuredAttempts({ summary }: { summary: PassUsageSummary }): number {
  if (summary.kind !== "partial") {
    throw new Error(`expected a partial summary, got ${summary.kind}`);
  }
  return summary.measuredAttempts;
}

/** Five counters, spelled out so a case can assert the exact sum rather than a shape. */
function usage({
  input = 0,
  cached = 0,
  cacheWrite = 0,
  output = 0,
  reasoning = 0,
}: {
  input?: number;
  cached?: number;
  cacheWrite?: number;
  output?: number;
  reasoning?: number;
} = {}): CodexUsage {
  return {
    cache_write_input_tokens: cacheWrite,
    cached_input_tokens: cached,
    input_tokens: input,
    output_tokens: output,
    reasoning_output_tokens: reasoning,
  };
}

/** One measured attempt. */
function measured({ counters, kind = "initial" }: { counters: CodexUsage; kind?: CodexAttempt["kind"] }): CodexAttempt {
  return {
    elapsedMs: 10,
    finishedAtIso: "2026-09-01T00:00:10.000Z",
    items: { counts: {}, kind: "measured" },
    kind,
    startedAtIso: "2026-09-01T00:00:00.000Z",
    status: "answered",
    threadId: "t",
    usage: { kind: "measured", usage: counters },
  };
}

/** One attempt the SDK never reported usage for. */
function unmeasured({
  reason,
  kind = "initial",
}: {
  reason: UnmeasuredReason;
  kind?: CodexAttempt["kind"];
}): CodexAttempt {
  return {
    elapsedMs: 10,
    finishedAtIso: "2026-09-01T00:00:10.000Z",
    items: { kind: "not-measured", reason },
    kind,
    startedAtIso: "2026-09-01T00:00:00.000Z",
    status: "aborted",
    threadId: null,
    usage: { kind: "not-measured", reason },
  };
}

function recordWith({ attempts }: { attempts: readonly CodexAttempt[] }): CodexArtifactRecord {
  return {
    artifactId: "id-1",
    attempts,
    bound: { conclusionWindowMs: 150, totalMs: 1000, warnAfterMs: 850 },
    createdAtIso: "2026-09-01T00:00:20.000Z",
    observedElapsedMs: 20,
    outcome: {
      answer: { blockers: [], bodyMarkdown: "", summary: "", verdict: "READY" },
      kind: "answered",
      rawFinalResponse: "{}",
    },
    repoRoot: REPO,
    requestedApprovalPolicy: "never",
    requestedModel: "gpt-6-astra",
    requestedNetworkAccess: true,
    requestedReasoningEffort: "medium",
    requestedSandboxMode: "workspace-write",
    requestedWebSearch: true,
    requestedWritableRoots: [],
    schemaVersion: 1,
    scope: { mode: "plan", pass: "p1", promptBytes: 1, promptSha256: "abc" },
  };
}

describe("summarizePassUsage", () => {
  it("reports a MEASURED zero as complete, with counters, not as an absence", () => {
    const summary = summarizePassUsage({ record: recordWith({ attempts: [measured({ counters: usage() })] }) });

    expect(summary.kind).toBe("complete");
    expect(measuredTokens({ summary })).toStrictEqual(usage());
  });

  it("reports a pass with no attempts as unmeasured with `no-attempt`, never a measured zero", () => {
    const summary = summarizePassUsage({ record: recordWith({ attempts: [] }) });

    expect(summary.kind).toBe("unmeasured");
    expect(measuredTokens({ summary })).toBeUndefined();
    expect(gapsOf({ summary })).toStrictEqual([{ attempts: 1, reason: "no-attempt" }]);
  });

  it("keeps an aborted initial plus a measured conclusion PARTIAL, so the pass has no total", () => {
    const summary = summarizePassUsage({
      record: recordWith({
        attempts: [
          unmeasured({ kind: "initial", reason: "aborted" }),
          measured({ counters: usage({ input: 100, output: 7 }), kind: "conclusion" }),
        ],
      }),
    });

    expect(summary.kind).toBe("partial");
    expect(measuredTokens({ summary })).toStrictEqual(usage({ input: 100, output: 7 }));
    expect(partialMeasuredAttempts({ summary })).toBe(1);
    expect(gapsOf({ summary })).toStrictEqual([{ attempts: 1, reason: "aborted" }]);
  });

  it("sums each counter INDEPENDENTLY across attempts and never adds one to another", () => {
    const summary = summarizePassUsage({
      record: recordWith({
        attempts: [
          measured({ counters: usage({ cacheWrite: 3, cached: 50, input: 100, output: 10, reasoning: 4 }) }),
          measured({
            counters: usage({ cacheWrite: 1, cached: 20, input: 200, output: 30, reasoning: 9 }),
            kind: "conclusion",
          }),
        ],
      }),
    });

    expect(measuredTokens({ summary })).toStrictEqual(
      usage({ cacheWrite: 4, cached: 70, input: 300, output: 40, reasoning: 13 }),
    );
  });

  it("counts one gap row per distinct reason, in first-seen order", () => {
    const summary = summarizePassUsage({
      record: recordWith({
        attempts: [
          unmeasured({ reason: "transport-failed" }),
          unmeasured({ reason: "aborted" }),
          unmeasured({ kind: "conclusion", reason: "transport-failed" }),
        ],
      }),
    });

    expect(summary.kind).toBe("unmeasured");
    expect(gapsOf({ summary })).toStrictEqual([
      { attempts: 2, reason: "transport-failed" },
      { attempts: 1, reason: "aborted" },
    ]);
  });

  it("gives an unmeasured summary NO numeric field for a formatter to reach for", () => {
    const summary = summarizePassUsage({
      record: recordWith({ attempts: [unmeasured({ reason: "sdk-reported-none" })] }),
    });

    expect(measuredTokens({ summary })).toBeUndefined();
    expect(Object.keys(summary).toSorted()).toStrictEqual(["gaps", "kind"]);
  });
});
