import { describe, expect, it } from "vitest";

import type { LedgerScan } from "../../../codex/ledgerStore.js";
import type { CodexRateCard } from "../../../codex/pricing.js";
import type {
  CodexArtifactRecord,
  CodexAttempt,
  CodexPassId,
  CodexUsage,
  ReviewPassId,
  UnmeasuredReason,
} from "../../../codex/types.js";
import { renderCodexUsageReport } from "../../../codex/usageRender.js";
import { buildCodexUsageReport, type PassKindRow } from "../../../codex/usageReport.js";

const REPO = "/w/repo";
const OTHER_REPO = "/w/other";

const CARD: CodexRateCard = {
  counterMapping: {
    cacheWriteIncludedInInput: false,
    cachedInputIncludedInInput: false,
    reasoningIncludedInOutput: true,
    verifiedBy: "a test fixture — invented round numbers, never a published tariff",
  },
  currency: "USD",
  effectiveFromIso: "2026-01-01T00:00:00.000Z",
  effectiveToIso: undefined,
  models: [{ model: "gpt-6-astra", perMillionTokens: { cacheWriteInput: 0, cachedInput: 0, input: 1, output: 2 } }],
  schemaVersion: 1,
  source: "a test fixture — invented round numbers, never a published tariff",
};

function counters({
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

function measured({
  usage,
  startedAtIso = "2026-06-01T00:00:00.000Z",
}: {
  usage: CodexUsage;
  startedAtIso?: string;
}): CodexAttempt {
  return {
    elapsedMs: 10,
    finishedAtIso: "2026-06-01T00:00:10.000Z",
    items: { counts: {}, kind: "measured" },
    kind: "initial",
    startedAtIso,
    status: "answered",
    threadId: "t",
    usage: { kind: "measured", usage },
  };
}

function unmeasured({
  reason,
  startedAtIso = "2026-06-01T00:00:00.000Z",
}: {
  reason: UnmeasuredReason;
  startedAtIso?: string;
}): CodexAttempt {
  return {
    elapsedMs: 10,
    finishedAtIso: "2026-06-01T00:00:10.000Z",
    items: { kind: "not-measured", reason },
    kind: "initial",
    startedAtIso,
    status: "aborted",
    threadId: null,
    usage: { kind: "not-measured", reason },
  };
}

/** One pass record, plan or review, with whatever attempts a case needs. */
function record({
  pass,
  attempts,
  artifactId = `id-${pass}`,
  repoRoot = REPO,
  verdict = "READY",
  diffSha256 = "d".repeat(64),
  createdAtIso = "2026-06-01T00:01:00.000Z",
  requestedModel = "gpt-6-astra",
}: {
  pass: CodexPassId;
  attempts: readonly CodexAttempt[];
  artifactId?: string;
  repoRoot?: string;
  verdict?: string;
  diffSha256?: string;
  createdAtIso?: string;
  requestedModel?: string;
}): CodexArtifactRecord {
  const isReview = pass.startsWith("r");
  const base = {
    artifactId,
    attempts,
    bound: { conclusionWindowMs: 150, totalMs: 1000, warnAfterMs: 850 },
    createdAtIso,
    observedElapsedMs: 20,
    repoRoot,
    requestedApprovalPolicy: "never",
    requestedModel,
    requestedNetworkAccess: true,
    requestedReasoningEffort: "medium",
    requestedSandboxMode: "workspace-write",
    requestedWebSearch: true,
    requestedWritableRoots: [],
    schemaVersion: 1,
  } as const;
  if (!isReview) {
    return {
      ...base,
      outcome: {
        answer: {
          blockers: [],
          bodyMarkdown: "",
          summary: "planned",
          verdict: verdict === "BLOCKED" ? "BLOCKED" : "READY",
        },
        kind: "answered",
        rawFinalResponse: "{}",
      },
      scope: { mode: "plan", pass: pass as "p1" | "p2" | "p3", promptBytes: 1, promptSha256: "abc" },
    };
  }
  return {
    ...base,
    outcome: {
      answer: {
        counterexample: verdict === "BROKEN" ? "a concrete counterexample" : "",
        evidence: "",
        propertyId: `${pass}-01`,
        summary: "held",
        verdict: verdict === "BROKEN" ? "BROKEN" : "CLEAN",
      },
      kind: "answered",
      rawFinalResponse: "{}",
    },
    scope: {
      baseRef: "origin/main",
      baseSha: "b".repeat(40),
      diffBytes: 10,
      diffSha256,
      headSha: "h".repeat(40),
      mode: "review",
      pass: pass as ReviewPassId,
      property: { id: `${pass}-01`, statement: "a falsifiable claim" },
    },
  };
}

function scanOf({
  records,
  withoutSidecar = 0,
  unreadable = 0,
}: {
  records: readonly CodexArtifactRecord[];
  withoutSidecar?: number;
  unreadable?: number;
}): LedgerScan {
  return { withoutSidecar, records, unreadable };
}

/** One pass kind's row, unwrapped by throwing rather than by a conditional in an assertion. */
function rowFor({ report, pass }: { report: { rows: readonly PassKindRow[] }; pass: CodexPassId }): PassKindRow {
  const found = report.rows.find((row) => row.pass === pass);
  if (found === undefined) {
    throw new Error(`no row for pass ${pass}`);
  }
  return found;
}

describe("buildCodexUsageReport", () => {
  it("gives every one of the six pass kinds a row, including the ones that never ran", () => {
    const report = buildCodexUsageReport({
      rateCard: undefined,
      repoRoot: REPO,
      scan: scanOf({ records: [record({ attempts: [measured({ usage: counters() })], pass: "p1" })] }),
      target: undefined,
    });

    expect(report.rows.map((row) => row.pass)).toStrictEqual(["p1", "p2", "p3", "r1", "r2", "r3"]);
    expect(rowFor({ pass: "r3", report }).runs).toBe(0);
  });

  it("distinguishes a MEASURED zero from an absent reading: both exist, and only one is a run", () => {
    const report = buildCodexUsageReport({
      rateCard: undefined,
      repoRoot: REPO,
      scan: scanOf({ records: [record({ attempts: [measured({ usage: counters() })], pass: "p1" })] }),
      target: undefined,
    });

    const measuredZero = rowFor({ pass: "p1", report });
    const neverRan = rowFor({ pass: "p2", report });

    expect(measuredZero.runs).toBe(1);
    expect(measuredZero.complete).toBe(1);
    expect(measuredZero.measuredSubtotal).toStrictEqual(counters());
    expect(neverRan.runs).toBe(0);
    expect(neverRan.measuredSubtotal).toStrictEqual(counters());
  });

  it("exposes a partial pass's SUBTOTAL under a count no renderer can print as a total", () => {
    const report = buildCodexUsageReport({
      rateCard: undefined,
      repoRoot: REPO,
      scan: scanOf({
        records: [
          record({
            attempts: [unmeasured({ reason: "aborted" }), measured({ usage: counters({ input: 500, output: 20 }) })],
            pass: "p2",
          }),
        ],
      }),
      target: undefined,
    });

    const row = rowFor({ pass: "p2", report });

    expect(row.runs).toBe(1);
    expect(row.partial).toBe(1);
    expect(row.complete).toBe(0);
    expect(row.measuredSubtotal).toStrictEqual(counters({ input: 500, output: 20 }));
  });

  it("computes the unmeasured fraction from the records in scope, never from a constant", () => {
    const report = buildCodexUsageReport({
      rateCard: undefined,
      repoRoot: REPO,
      scan: scanOf({
        records: [
          record({ artifactId: "a", attempts: [measured({ usage: counters({ input: 1 }) })], pass: "p1" }),
          record({ artifactId: "b", attempts: [measured({ usage: counters({ input: 1 }) })], pass: "p1" }),
          record({ artifactId: "c", attempts: [measured({ usage: counters({ input: 1 }) })], pass: "p1" }),
          record({ artifactId: "d", attempts: [unmeasured({ reason: "aborted" })], pass: "p1" }),
        ],
      }),
      target: undefined,
    });

    expect(report.unmeasured).toStrictEqual({ fraction: 0.25, incomplete: 1, passes: 4 });
  });

  it("reports no fraction at all when no pass was in scope, rather than a zero", () => {
    const report = buildCodexUsageReport({
      rateCard: undefined,
      repoRoot: REPO,
      scan: scanOf({ records: [] }),
      target: undefined,
    });

    expect(report.unmeasured).toStrictEqual({ fraction: undefined, incomplete: 0, passes: 0 });
  });

  it("counts only the named checkout's passes, and keeps the coverage counts the scan's own", () => {
    const report = buildCodexUsageReport({
      rateCard: undefined,
      repoRoot: REPO,
      scan: scanOf({
        withoutSidecar: 277,
        records: [
          record({ artifactId: "mine", attempts: [measured({ usage: counters({ input: 10 }) })], pass: "p1" }),
          record({
            artifactId: "theirs",
            attempts: [measured({ usage: counters({ input: 999 }) })],
            pass: "p1",
            repoRoot: OTHER_REPO,
          }),
        ],
        unreadable: 2,
      }),
      target: undefined,
    });

    expect(report.coverage).toStrictEqual({ withoutSidecar: 277, records: 1, unreadable: 2 });
    expect(rowFor({ pass: "p1", report }).measuredSubtotal.input_tokens).toBe(10);
  });

  it("with no card there are no dollars at all, and the basis says why", () => {
    const report = buildCodexUsageReport({
      rateCard: undefined,
      repoRoot: REPO,
      scan: scanOf({
        records: [record({ attempts: [measured({ usage: counters({ input: 1_000_000 }) })], pass: "p1" })],
      }),
      target: undefined,
    });

    expect(report.pricing.kind).toBe("none");
    expect(rowFor({ pass: "p1", report }).estimate).toBeUndefined();
    expect(rowFor({ pass: "p1", report }).unpricedReasons).toStrictEqual(["no rate card was supplied"]);
  });

  it("prices what the card can and reports the rest as unpriced with a reason, never as free", () => {
    const report = buildCodexUsageReport({
      rateCard: CARD,
      repoRoot: REPO,
      scan: scanOf({
        records: [
          record({ artifactId: "known", attempts: [measured({ usage: counters({ input: 1_000_000 }) })], pass: "p1" }),
          record({
            artifactId: "unknown-model",
            attempts: [measured({ usage: counters({ input: 1_000_000 }) })],
            pass: "p1",
            requestedModel: "gpt-7-unpublished",
          }),
        ],
      }),
      target: undefined,
    });

    const row = rowFor({ pass: "p1", report });

    expect(row.pricedAttempts).toBe(1);
    expect(row.unpricedAttempts).toBe(1);
    expect(row.estimate).toBeCloseTo(1, 10);
    expect(row.unpricedReasons).toStrictEqual(["the card names no rate for the requested model gpt-7-unpublished"]);
  });

  it("carries the card's own provenance into the pricing basis", () => {
    const report = buildCodexUsageReport({
      rateCard: CARD,
      repoRoot: REPO,
      scan: scanOf({ records: [] }),
      target: undefined,
    });

    expect(report.pricing).toStrictEqual({
      currency: "USD",
      effectiveFromIso: "2026-01-01T00:00:00.000Z",
      effectiveToIso: undefined,
      kind: "card",
      source: "a test fixture — invented round numbers, never a published tariff",
      verifiedBy: "a test fixture — invented round numbers, never a published tariff",
    });
  });

  it("adds a marginal reading only when a diff was named", () => {
    const scan = scanOf({ records: [record({ attempts: [measured({ usage: counters() })], pass: "r1" })] });

    const without = buildCodexUsageReport({ rateCard: undefined, repoRoot: REPO, scan, target: undefined });
    const withTarget = buildCodexUsageReport({
      rateCard: undefined,
      repoRoot: REPO,
      scan,
      target: { diffSha256: "d".repeat(64), repoRoot: REPO },
    });

    expect(without.marginal).toBeUndefined();
    expect(withTarget.marginal!.nextOrdinal).toBe(2);
  });
});

describe("renderCodexUsageReport", () => {
  it("prints a never-run pass kind as an absence rather than as `0 tokens`", () => {
    const lines = renderCodexUsageReport({
      report: buildCodexUsageReport({
        rateCard: undefined,
        repoRoot: REPO,
        scan: scanOf({ records: [] }),
        target: undefined,
      }),
    });

    expect(lines).toContain("  r3  — never run in this scope");
  });

  it("labels a pass kind carrying an unmeasured pass as a FLOOR, with the count on the same line", () => {
    const lines = renderCodexUsageReport({
      report: buildCodexUsageReport({
        rateCard: undefined,
        repoRoot: REPO,
        scan: scanOf({
          records: [
            record({ artifactId: "a", attempts: [measured({ usage: counters({ input: 500 }) })], pass: "p1" }),
            record({ artifactId: "b", attempts: [unmeasured({ reason: "aborted" })], pass: "p1" }),
          ],
        }),
        target: undefined,
      }),
    });

    expect(lines.join("\n")).toContain("tokens (FLOOR — 1 of 2 not fully measured): in 500,");
  });

  it("says the coverage counts are machine-wide, so they cannot be read as this checkout's", () => {
    const lines = renderCodexUsageReport({
      report: buildCodexUsageReport({
        rateCard: undefined,
        repoRoot: REPO,
        scan: scanOf({ withoutSidecar: 277, records: [] }),
        target: undefined,
      }),
    });

    expect(lines.join("\n")).toContain(
      "coverage (every checkout — a pass with no sidecar has no checkout to scope it by): 277",
    );
  });

  it("flattens a multi-line counterexample onto one row and cuts it, keeping the artifact id beside it", () => {
    const long = `line one\n${"x".repeat(400)}`;
    const lines = renderCodexUsageReport({
      report: buildCodexUsageReport({
        rateCard: undefined,
        repoRoot: REPO,
        scan: scanOf({
          records: [
            {
              ...record({
                artifactId: "abc-123",
                attempts: [measured({ usage: counters() })],
                pass: "r1",
                verdict: "BROKEN",
              }),
              outcome: {
                answer: { counterexample: long, evidence: "", propertyId: "r1-01", summary: "s", verdict: "BROKEN" },
                kind: "answered",
                rawFinalResponse: "{}",
              },
            },
          ],
        }),
        target: { diffSha256: "d".repeat(64), repoRoot: REPO },
      }),
    });

    const row = lines.find((line) => line.includes("abc-123"));
    const detail = lines.find((line) => line.includes("line one"));

    expect(row).toBe("    #1 r1/r1-01 BROKEN abc-123");
    expect(detail).toBe(`        line one ${"x".repeat(151)}…`);
  });
});
