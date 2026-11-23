/**
 * Recall's pure halves: what a caller may ask for, and what a session actually reads back.
 *
 * The rendering tests assert exact lines rather than that output "contains" something, because the two
 * sentences that matter here are both about what recall does NOT establish — that a thin page is not proof
 * nothing was learned, and that page one is not every relevant memory. A softer assertion would let either
 * be reworded into a claim of completeness without a test noticing.
 */
import { describe, expect, it } from "vitest";

import {
  parseRecallQuery,
  RECALL_DEFAULT_LIMIT,
  RECALL_MAX_LIMIT,
  type RecallHit,
  renderRecall,
} from "../../../knowledge/recall.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";
import type { MemoryRecordingRow } from "../../../store/schema/memories.js";

/** One row as the database returns it, overridden per test. */
const row = (over: Partial<MemoryRecordingRow> = {}): MemoryRecordingRow => ({
  behaviourChange: "check the agent sample rate first",
  caveat: null,
  claim: "APM adaptive sampling sits upstream of retention filters",
  createdAt: new Date("2026-09-12T10:00:00.000Z"),
  domain: "datadog",
  evidence: "a 100%-error filter kept 0 of 412 traces over 7d",
  id: "l-abc123",
  importKey: null,
  kind: "lesson",
  learner: "fleet",
  outcome: null,
  question: null,
  recordedAt: new Date("2026-09-12T10:00:00.000Z"),
  recordingId: "a0000075-0000-4000-8000-000000000081",
  repro: null,
  retrievalCue: "a datadog tracing task",
  run: "ad-hoc",
  searchable: "",
  seq: 1,
  supersedes: null,
  surface: "api",
  tier: 2,
  verdict: "confirmed",
  ...over,
});

/** One hit wrapping that row. */
const hit = (over: Partial<RecallHit> = {}): RecallHit => ({
  broke: 0,
  held: 0,
  rank: 0.075,
  recalls: 0,
  recordings: 1,
  row: row(),
  runs: 1,
  ...over,
});

describe("parseRecallQuery", () => {
  it("defaults the limit and offset when a caller names neither", () => {
    const query = unwrap(parseRecallQuery({ value: { query: "datadog" } }));
    expect(query.limit).toBe(RECALL_DEFAULT_LIMIT);
    expect(query.offset).toBe(0);
  });

  it("leaves an unnamed facet ABSENT rather than present-and-undefined", () => {
    const query = unwrap(parseRecallQuery({ value: { query: "datadog" } }));
    expect(Object.hasOwn(query, "domain")).toBe(false);
    expect(Object.hasOwn(query, "kind")).toBe(false);
    expect(Object.hasOwn(query, "learner")).toBe(false);
  });

  it("keeps a facet a caller did name", () => {
    const query = unwrap(parseRecallQuery({ value: { domain: "datadog", kind: "lesson", query: "sampling" } }));
    expect(query.domain).toBe("datadog");
    expect(query.kind).toBe("lesson");
  });

  it("refuses a blank query as a usage failure, not as a query matching nothing", () => {
    const parsed = parseRecallQuery({ value: { query: "   " } });
    expect(parsed.isErr()).toBe(true);
    expect(parsed._unsafeUnwrapErr().code).toBe("INVALID_FIELD");
  });

  it("accepts the page bound itself and refuses one past it", () => {
    expect(unwrap(parseRecallQuery({ value: { limit: RECALL_MAX_LIMIT, query: "x" } })).limit).toBe(RECALL_MAX_LIMIT);
    expect(parseRecallQuery({ value: { limit: RECALL_MAX_LIMIT + 1, query: "x" } }).isErr()).toBe(true);
  });

  it("refuses a negative offset", () => {
    const error = unwrapErr(parseRecallQuery({ value: { offset: -1, query: "x" } }));
    expect(error.code).toBe("INVALID_FIELD");
    expect(error.message).toContain("offset");
  });

  it("refuses a kind outside the three-value vocabulary", () => {
    expect(unwrapErr(parseRecallQuery({ value: { kind: "fact", query: "x" } })).code).toBe("INVALID_FIELD");
  });

  it("accepts the trace kind", () => {
    expect(unwrap(parseRecallQuery({ value: { kind: "trace", query: "x" } })).kind).toBe("trace");
  });
});

describe("renderRecall — a trace", () => {
  const trace = (over: Partial<MemoryRecordingRow> = {}): MemoryRecordingRow =>
    row({
      behaviourChange: "still run this leg",
      caveat: "Linear only; the thread may say load test",
      claim: "slopweaver store probe k6 --source linear — for: why did the staging pool exhaust",
      domain: "store-detective",
      evidence: "exact 0, wild-both 0",
      id: "t-abc",
      kind: "trace",
      outcome: "empty",
      question: "why did the staging pool exhaust",
      repro: "slopweaver store probe k6 --source linear",
      surface: null,
      tier: null,
      ...over,
    });

  it("prints where it looked, what came back, what that does not prove, and that the leg still runs", () => {
    const lines = renderRecall({
      page: {
        hasMore: false,
        hits: [hit({ row: trace() })],
        query: unwrap(parseRecallQuery({ value: { query: "pool" } })),
      },
    });
    expect(lines.slice(2, 9)).toEqual([
      "t-abc  [trace · empty · confirmed] store-detective",
      "  question: why did the staging pool exhaust",
      "  probe: slopweaver store probe k6 --source linear",
      "  traced by: fleet · 2026-09-12T10:00:00.000Z · run ad-hoc",
      "  evidence: exact 0, wild-both 0",
      "  does not prove: Linear only; the thread may say load test",
      "  still run this leg — a remembered dead end reorders the work, it never skips a probe",
    ]);
  });

  it("prints no still-run line for a probe that paid", () => {
    const lines = renderRecall({
      page: {
        hasMore: false,
        hits: [hit({ row: trace({ caveat: null, outcome: "paid" }), recordings: 2, runs: 2 })],
        query: unwrap(parseRecallQuery({ value: { query: "pool" } })),
      },
    });
    expect(lines.slice(2, 8)).toEqual([
      "t-abc  [trace · paid · confirmed] store-detective · traced 2× across 2 run(s)",
      "  question: why did the staging pool exhaust",
      "  probe: slopweaver store probe k6 --source linear",
      "  traced by: fleet · 2026-09-12T10:00:00.000Z · run ad-hoc",
      "  evidence: exact 0, wild-both 0",
      "",
    ]);
  });
});

describe("renderRecall", () => {
  it("says the QUERY matched nothing, never that nothing was learned", () => {
    const lines = renderRecall({
      page: { hasMore: false, hits: [], query: unwrap(parseRecallQuery({ value: { query: "kafka" } })) },
    });
    expect(lines[0]).toBe('recall "kafka" — 0 claim(s). Nothing in the memories table matches those words.');
    expect(lines[1]).toBe(
      "Full-text search stems (sampling/sampled) and has no synonyms — ask again in the words the row itself",
    );
  });

  it("prints the exact next-page command when more claims match", () => {
    const lines = renderRecall({
      page: {
        hasMore: true,
        hits: [hit()],
        query: unwrap(parseRecallQuery({ value: { domain: "datadog", limit: 1, query: "sampling" } })),
      },
    });
    expect(lines.at(-1)).toBe(
      'more claims match. Next page: slopweaver knowledge recall "sampling" --domain datadog --limit 1 --offset 1',
    );
  });

  it("echoes every facet a caller narrowed by into the next-page command", () => {
    const lines = renderRecall({
      page: {
        hasMore: true,
        hits: [hit()],
        query: unwrap(
          parseRecallQuery({ value: { domain: "datadog", kind: "trace", learner: "owner", limit: 2, query: "pool" } }),
        ),
      },
    });
    expect(lines.at(-1)).toBe(
      'more claims match. Next page: slopweaver knowledge recall "pool" --domain datadog --kind trace --learner owner --limit 2 --offset 2',
    );
  });

  it("refuses to call the last page every relevant memory", () => {
    const lines = renderRecall({
      page: { hasMore: false, hits: [hit()], query: unwrap(parseRecallQuery({ value: { query: "sampling" } })) },
    });
    expect(lines.at(-1)).toBe("that is every claim matching those words — not every memory that could be relevant.");
  });

  it("shows an imported row's missing attribution as unknown rather than inventing one", () => {
    const lines = renderRecall({
      page: {
        hasMore: false,
        hits: [hit({ row: row({ behaviourChange: null, learner: null }) })],
        query: unwrap(parseRecallQuery({ value: { query: "sampling" } })),
      },
    });
    expect(lines[4]).toBe("  learned by: unknown (imported) · 2026-09-12T10:00:00.000Z · run ad-hoc");
  });

  it("reports a repeated claim's recording and distinct-run counts", () => {
    const lines = renderRecall({
      page: {
        hasMore: false,
        hits: [hit({ recordings: 3, runs: 2 })],
        query: unwrap(parseRecallQuery({ value: { query: "sampling" } })),
      },
    });
    expect(lines[2]).toBe("l-abc123  [lesson · confirmed tier 2 · api] datadog · recorded 3× across 2 run(s)");
  });

  it("prints the accounting a claim has earned, because that is what the page is ordered by", () => {
    const lines = renderRecall({
      page: {
        hasMore: false,
        hits: [hit({ broke: 1, held: 3, recalls: 5 })],
        query: unwrap(parseRecallQuery({ value: { query: "sampling" } })),
      },
    });
    expect(lines[2]).toBe("l-abc123  [lesson · confirmed tier 2 · api] datadog · recalled 5× · held 3 · broke 1");
  });

  it("prints no accounting for a claim nobody has ever recalled, rather than three zeroes", () => {
    const lines = renderRecall({
      page: { hasMore: false, hits: [hit()], query: unwrap(parseRecallQuery({ value: { query: "sampling" } })) },
    });
    expect(lines[2]).toBe("l-abc123  [lesson · confirmed tier 2 · api] datadog");
  });

  it("prints a preference without the lesson facets it does not carry", () => {
    const lines = renderRecall({
      page: {
        hasMore: false,
        hits: [hit({ row: row({ id: "p-abc", kind: "preference", surface: null, tier: null }) })],
        query: unwrap(parseRecallQuery({ value: { query: "supervisor" } })),
      },
    });
    expect(lines[2]).toBe("p-abc  [preference · confirmed] datadog");
  });
});
