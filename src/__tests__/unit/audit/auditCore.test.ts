import { describe, expect, it } from "vitest";
import {
  type AuditPerson,
  groundingStats,
  identityStats,
  parseIdentityPeople,
  retentionStats,
  signalRatio,
} from "../../../audit/auditCore.js";
import { auditTallies } from "../../../audit/auditFold.js";
import type { CorpusRecord } from "../../../corpus/types.js";
import type { BatchDigest } from "../../../gold/distil.js";
import type { Opportunity } from "../../../silver/opportunity.js";

function record({
  source,
  sourceId,
  kind,
  container,
  url,
  tsIso,
}: {
  source: CorpusRecord["source"];
  sourceId: string;
  kind: CorpusRecord["kind"];
  container: string;
  url: string;
  tsIso: string;
}): CorpusRecord {
  return { container, kind, refs: [], source, sourceId, text: `t ${sourceId}`, tsIso, url };
}

describe("auditTallies — per-source volume", () => {
  it("counts records, date span, and kind breakdown per source", () => {
    const records = [
      record({
        container: "acme",
        kind: "pr",
        source: "github",
        sourceId: "#1",
        tsIso: "2026-06-03T00:00:00.000Z",
        url: "u1",
      }),
      record({
        container: "acme",
        kind: "pr",
        source: "github",
        sourceId: "#2",
        tsIso: "2026-06-01T00:00:00.000Z",
        url: "u2",
      }),
      record({
        container: "acme",
        kind: "issue",
        source: "github",
        sourceId: "#3",
        tsIso: "2026-06-05T00:00:00.000Z",
        url: "u3",
      }),
    ];
    const [gh] = auditTallies({ records }).sources;
    expect(gh!.source).toBe("github");
    expect(gh!.count).toBe(3);
    expect(gh!.spanStart).toBe("2026-06-01T00:00:00.000Z");
    expect(gh!.spanEnd).toBe("2026-06-05T00:00:00.000Z");
    expect(gh!.kinds).toStrictEqual({ issue: 1, pr: 2 });
  });

  it("sorts sources by name", () => {
    const records = [
      record({
        container: "c",
        kind: "message",
        source: "slack",
        sourceId: "s1",
        tsIso: "2026-06-01T00:00:00.000Z",
        url: "u1",
      }),
      record({
        container: "c",
        kind: "pr",
        source: "github",
        sourceId: "#1",
        tsIso: "2026-06-01T00:00:00.000Z",
        url: "u2",
      }),
    ];
    expect(auditTallies({ records }).sources.map((s) => s.source)).toStrictEqual(["github", "slack"]);
  });
});

describe("groundingStats", () => {
  it("counts a point as grounded only when a citation resolves to a real record (hallucinated cite is not)", () => {
    const records = [
      record({
        container: "c",
        kind: "message",
        source: "slack",
        sourceId: "s1",
        tsIso: "2026-06-01T00:00:00.000Z",
        url: "u1",
      }),
      record({
        container: "c",
        kind: "issue",
        source: "github",
        sourceId: "#7",
        tsIso: "2026-06-01T00:00:00.000Z",
        url: "u2",
      }),
    ];
    const digests: readonly BatchDigest[] = [
      {
        container: "c",
        points: [
          { citations: ["u1"], point: "cites a real url" },
          { citations: ["https://hallucinated.example.com/x"], point: "cites nothing real" },
          { citations: ["slack:s1"], point: "cites source:sourceId" },
        ],
        source: "slack",
        summary: "s",
      },
    ];
    const stat = groundingStats({ digests, refs: auditTallies({ records }).refs });
    expect(stat.digests).toBe(1);
    expect(stat.points).toBe(3);
    expect(stat.grounded).toBe(2);
    expect(stat.ratio).toBeCloseTo(2 / 3, 10);
  });

  it("keeps only the citation targets it was asked for, and grounds exactly as the unfiltered index does", () => {
    const records = [
      record({
        container: "c",
        kind: "message",
        source: "slack",
        sourceId: "s1",
        tsIso: "2026-06-01T00:00:00.000Z",
        url: "u1",
      }),
      record({
        container: "c",
        kind: "message",
        source: "slack",
        sourceId: "s2",
        tsIso: "2026-06-01T00:00:00.000Z",
        url: "u2",
      }),
    ];
    const digests: readonly BatchDigest[] = [
      { container: "c", points: [{ citations: ["u1", "missing"], point: "p" }], source: "slack", summary: "s" },
    ];
    const citations = new Set(["u1", "missing"]);
    const filtered = auditTallies({ citations, records }).refs;
    expect([...filtered]).toEqual(["u1"]);
    expect(groundingStats({ digests, refs: filtered })).toStrictEqual(
      groundingStats({ digests, refs: auditTallies({ records }).refs }),
    );
  });

  it("reports zero (not NaN) grounding when there are no points", () => {
    const stat = groundingStats({ digests: [], refs: new Set<string>() });
    expect(stat).toStrictEqual({ digests: 0, grounded: 0, points: 0, ratio: 0 });
  });
});

describe("signalRatio", () => {
  const opp = ({ evidence, score = 1 }: { evidence: number; score?: number }): Opportunity => ({
    evidence: Array.from({ length: evidence }, (_, i) => `e${String(i)}`),
    evidenceCount: evidence,
    kind: "cross-cutting",
    score,
    subject: `s${String(evidence)}`,
    summary: "x",
  });

  it("buckets opportunities into crisp (<=5 evidence) vs mega-clique (>5)", () => {
    const stat = signalRatio({ opportunities: [opp({ evidence: 2 }), opp({ evidence: 6 }), opp({ evidence: 5 })] });
    expect(stat).toStrictEqual({ crisp: 2, crispRatio: 2 / 3, mega: 1, topCrisp: 2, topN: 3, total: 3 });
  });

  it("measures the ranked HEAD separately — a mega-clique at the top is what a human actually reads", () => {
    const stat = signalRatio({ opportunities: [opp({ evidence: 40 }), opp({ evidence: 2 }), opp({ evidence: 3 })] });
    expect(stat.topCrisp).toBe(2);
    expect(stat.topN).toBe(3);
  });

  it("reads the TRUE pre-cap `evidenceCount`, so capping the citation list cannot inflate the ratio", () => {
    const capped: Opportunity = {
      evidence: ["e0", "e1", "e2", "e3", "e4"],
      evidenceCount: 900,
      kind: "cross-cutting",
      score: 1,
      subject: "wide",
      summary: "x",
    };
    expect(signalRatio({ opportunities: [capped] })).toStrictEqual({
      crisp: 0,
      crispRatio: 0,
      mega: 1,
      topCrisp: 0,
      topN: 1,
      total: 1,
    });
  });
});

describe("identityStats", () => {
  it("counts resolved people, cross-source-linked, and the exact persisted kinds", () => {
    const people: readonly AuditPerson[] = [
      { confidence: "single-source", identities: [{ nativeId: "alice" }], kind: "person" },
      { confidence: "email", identities: [{ handle: "bob", nativeId: "bob" }], kind: "person" },
      { confidence: "single-source", identities: [{ nativeId: "notifier" }], kind: "bot" },
      { confidence: "single-source", identities: [{ nativeId: "l-app-1" }], kind: "integration" },
    ];
    expect(identityStats({ directoryPeople: 2, people })).toStrictEqual({
      bots: 1,
      directoryPeople: 2,
      integrations: 1,
      linked: 1,
      resolved: 4,
    });
  });

  it("omits `directoryExcluded` when the caller has no exclusion count (a pre-PR4.8 directory)", () => {
    expect(identityStats({ directoryPeople: 7, people: [] })).toStrictEqual({
      bots: 0,
      directoryPeople: 7,
      integrations: 0,
      linked: 0,
      resolved: 0,
    });
    expect(identityStats({ directoryExcluded: 2, directoryPeople: 7, people: [] }).directoryExcluded).toBe(2);
  });

  it("falls back to the [bot] login suffix on a pre-PR4.8 artifact with no `kind`", () => {
    const people: readonly AuditPerson[] = [
      { confidence: "single-source", identities: [{ nativeId: "alice" }] },
      { confidence: "single-source", identities: [{ nativeId: "dependabot[bot]" }] },
    ];
    expect(identityStats({ directoryPeople: 1, people })).toStrictEqual({
      bots: 1,
      directoryPeople: 1,
      integrations: 0,
      linked: 0,
      resolved: 2,
    });
  });
});

describe("parseIdentityPeople", () => {
  it("keeps valid people + valid identities and drops garbled entries", () => {
    const value = {
      people: [
        { confidence: "email", identities: [{ handle: "y", nativeId: "x" }, { bad: 1 }] },
        { missing: "confidence" },
      ],
    };
    expect(parseIdentityPeople({ value })).toStrictEqual([
      { confidence: "email", identities: [{ handle: "y", nativeId: "x" }] },
    ]);
  });

  it("degrades to an empty list when the shape is absent", () => {
    expect(parseIdentityPeople({ value: undefined })).toStrictEqual([]);
  });
});

describe("retentionStats", () => {
  const dup = {
    container: "acme",
    kind: "pr" as const,
    source: "github" as const,
    sourceId: "#1",
    tsIso: "2026-06-01T00:00:00.000Z",
    url: "u1",
  };

  it("counts cross-window duplicates on the writer's own key, tsIso-blind", () => {
    const records = [
      record(dup),
      record({ ...dup, tsIso: "2026-06-09T00:00:00.000Z" }),
      record({ ...dup, sourceId: "#2", url: "u2" }),
    ];

    expect(
      retentionStats({ tallies: auditTallies({ records }), storage: [{ bytes: 900, files: 2, source: "github" }] }),
    ).toStrictEqual({
      bytes: 900,
      collapsibleDuplicates: 1,
      files: 2,
      records: 3,
      sources: [{ bytes: 900, collapsibleDuplicates: 1, files: 2, records: 3, source: "github" }],
    });
  });

  it("counts a same-id DIFFERENT-content record as unique, never as a duplicate", () => {
    const records = [record(dup), record({ ...dup, url: "u-edited" })];

    expect(
      retentionStats({ tallies: auditTallies({ records }), storage: [{ bytes: 10, files: 1, source: "github" }] })
        .collapsibleDuplicates,
    ).toBe(0);
  });

  it("totals across sources and reports zeros for an empty corpus", () => {
    const records = [record(dup), record({ ...dup, container: "c", source: "slack", sourceId: "s1", url: "u2" })];

    const stat = retentionStats({
      tallies: auditTallies({ records }),
      storage: [
        { bytes: 100, files: 1, source: "github" },
        { bytes: 250, files: 3, source: "slack" },
      ],
    });

    expect(stat.bytes).toBe(350);
    expect(stat.files).toBe(4);
    expect(stat.records).toBe(2);
    expect(retentionStats({ tallies: auditTallies({ records: [] }), storage: [] })).toStrictEqual({
      bytes: 0,
      collapsibleDuplicates: 0,
      files: 0,
      records: 0,
      sources: [],
    });
  });
});

describe("auditTallies — superseded versions", () => {
  const pr = {
    container: "acme/api",
    kind: "pr" as const,
    source: "github" as const,
    sourceId: "#1",
    tsIso: "2026-06-01T00:00:00.000Z",
    url: "u1",
  };

  it("reports no stale versions when every row is a distinct entity", () => {
    const records = [record(pr), record({ ...pr, sourceId: "#2", url: "u2" })];

    expect(auditTallies({ records }).superseded).toStrictEqual({
      deepest: 1,
      logical: 2,
      rows: 2,
      sources: [{ logical: 2, rows: 2, source: "github", superseded: 0 }],
      superseded: 0,
    });
  });

  it("counts every version past the first as superseded and reports the deepest entity", () => {
    const records = [
      record(pr),
      record({ ...pr, tsIso: "2026-06-02T00:00:00.000Z" }),
      record({ ...pr, tsIso: "2026-06-03T00:00:00.000Z" }),
      record({ ...pr, sourceId: "#2", url: "u2" }),
    ];

    expect(auditTallies({ records }).superseded).toStrictEqual({
      deepest: 3,
      logical: 2,
      rows: 4,
      sources: [{ logical: 2, rows: 4, source: "github", superseded: 2 }],
      superseded: 2,
    });
  });

  it("keys on the CONTAINER too, so one issue number in two repos is two entities, not a stale version", () => {
    // GitHub numbers issues per repository: collapsing on `(source, sourceId)` would merge unrelated issues
    // and report a loss that never happened.
    const records = [record(pr), record({ ...pr, container: "acme/web", url: "u-web" })];

    expect(auditTallies({ records }).superseded.superseded).toBe(0);
    expect(auditTallies({ records }).superseded.logical).toBe(2);
  });

  it("splits per source and sorts sources by name", () => {
    const records = [
      record(pr),
      record({ ...pr, tsIso: "2026-06-02T00:00:00.000Z" }),
      record({
        container: "c",
        kind: "message",
        source: "slack",
        sourceId: "s1",
        tsIso: "2026-06-01T00:00:00.000Z",
        url: "u3",
      }),
    ];

    expect(auditTallies({ records }).superseded.sources).toStrictEqual([
      { logical: 1, rows: 2, source: "github", superseded: 1 },
      { logical: 1, rows: 1, source: "slack", superseded: 0 },
    ]);
  });

  it("reports zeros (and deepest 0) for an empty corpus rather than failing", () => {
    expect(auditTallies({ records: [] }).superseded).toStrictEqual({
      deepest: 0,
      logical: 0,
      rows: 0,
      sources: [],
      superseded: 0,
    });
  });

  it("is a DIFFERENT measure from collapsibleDuplicates — an edit is superseded but not collapsible", () => {
    // The distinction that makes both numbers worth printing: `compact` removes byte-identical rows, and a
    // changed row survives it. A corpus can have zero collapsible duplicates and still be mostly stale.
    const edited = [record(pr), record({ ...pr, url: "u-edited" })];
    expect(
      retentionStats({
        tallies: auditTallies({ records: edited }),
        storage: [{ bytes: 1, files: 1, source: "github" }],
      }).collapsibleDuplicates,
    ).toBe(0);
    expect(auditTallies({ records: edited }).superseded.superseded).toBe(1);

    // And the converse: a byte-identical re-fetch is BOTH, because it is one entity captured twice.
    const identical = [record(pr), record(pr)];
    expect(
      retentionStats({
        tallies: auditTallies({ records: identical }),
        storage: [{ bytes: 1, files: 1, source: "github" }],
      }).collapsibleDuplicates,
    ).toBe(1);
    expect(auditTallies({ records: identical }).superseded.superseded).toBe(1);
  });
});
