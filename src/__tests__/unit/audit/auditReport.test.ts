import { describe, expect, it } from "vitest";
import { auditTallies } from "../../../audit/auditFold.js";
import { auditHumanLines, auditJson, composeAuditReport } from "../../../audit/auditReport.js";
import { COLD_TOKENS_PER_BATCH, type PersistedBatchUsage } from "../../../audit/costEstimate.js";
import type { CorpusRecord } from "../../../corpus/types.js";
import type { BatchDigest } from "../../../gold/distil.js";
import { isRecord } from "../../../lib/parsers.js";

function slackRecord({ sourceId }: { sourceId: string }): CorpusRecord {
  return {
    container: "c",
    kind: "message",
    refs: [],
    source: "slack",
    sourceId,
    text: `t ${sourceId}`,
    tsIso: "2026-06-01T00:00:00.000Z",
    url: `https://demo.example.com/${sourceId}`,
  };
}

const records = [slackRecord({ sourceId: "s1" }), slackRecord({ sourceId: "s2" })];
const digests: readonly BatchDigest[] = [
  {
    container: "c",
    points: [{ citations: ["https://demo.example.com/s1"], point: "p" }],
    source: "slack",
    summary: "s",
  },
];

describe("composeAuditReport", () => {
  it("wires every aggregator + the cold cost estimate into one report", () => {
    const report = composeAuditReport({
      batchHashes: ["h1", "h2"],
      cachedHashes: new Set(["h1"]),
      digests,
      directoryPeople: 0,
      opportunities: [],
      people: [],
      storage: [{ bytes: 512, files: 2, source: "slack" as const }],
      tallies: auditTallies({ records }),
      usageByHash: new Map<string, PersistedBatchUsage>(),
    });
    expect(report.totalRecords).toBe(2);
    expect(report.sources.map((s) => s.source)).toStrictEqual(["slack"]);
    expect(report.grounding).toStrictEqual({ digests: 1, grounded: 1, points: 1, ratio: 1 });
    expect(report.signal).toStrictEqual({ crisp: 0, crispRatio: 0, mega: 0, topCrisp: 0, topN: 0, total: 0 });
    expect(report.identity).toStrictEqual({ bots: 0, directoryPeople: 0, integrations: 0, linked: 0, resolved: 0 });
    expect(report.cost.uncachedBatches).toBe(1);
    expect(report.cost.initialTokens).toBe(COLD_TOKENS_PER_BATCH);
    expect(report.cost.rate.calibratedFrom).toBe(0);
    expect(report.retention).toStrictEqual({
      bytes: 512,
      collapsibleDuplicates: 0,
      files: 2,
      records: 2,
      sources: [{ bytes: 512, collapsibleDuplicates: 0, files: 2, records: 2, source: "slack" }],
    });
    expect(report.superseded).toStrictEqual({
      deepest: 1,
      logical: 2,
      rows: 2,
      sources: [{ logical: 2, rows: 2, source: "slack", superseded: 0 }],
      superseded: 0,
    });
  });
});

describe("auditJson", () => {
  it("emits a stable machine shape with the cost provenance label folded in", () => {
    const report = composeAuditReport({
      batchHashes: ["h1"],
      cachedHashes: new Set<string>(),
      digests,
      directoryPeople: 0,
      opportunities: [],
      people: [],
      storage: [{ bytes: 512, files: 2, source: "slack" as const }],
      tallies: auditTallies({ records }),
      usageByHash: new Map<string, PersistedBatchUsage>(),
    });
    const json = auditJson({ report });
    expect(Object.keys(json).toSorted()).toStrictEqual([
      "cost",
      "grounding",
      "identity",
      "retention",
      "schemaVersion",
      "signal",
      "sources",
      "superseded",
      "totalRecords",
    ]);
    expect(json["schemaVersion"]).toBe(3);
    const cost = json["cost"];
    if (!isRecord(cost)) {
      throw new Error("expected auditJson to carry a cost object");
    }
    expect(cost["provenance"]).toBe("cold estimate");
  });
});

describe("auditHumanLines — the superseded clause", () => {
  const report = ({ rows }: { rows: readonly CorpusRecord[] }): ReturnType<typeof composeAuditReport> =>
    composeAuditReport({
      batchHashes: ["h1"],
      cachedHashes: new Set<string>(),
      digests: [],
      directoryPeople: 0,
      opportunities: [],
      people: [],
      storage: [{ bytes: 512, files: 2, source: "slack" as const }],
      tallies: auditTallies({ records: rows }),
      usageByHash: new Map<string, PersistedBatchUsage>(),
    });

  /** The one `superseded:` line out of the human report. */
  const supersededLine = ({ rows }: { rows: readonly CorpusRecord[] }): string =>
    auditHumanLines({ report: report({ rows }) }).find((line) => line.startsWith("superseded:"))!;

  it("says plainly that nothing is stale when nothing is", () => {
    expect(supersededLine({ rows: records })).toBe(
      "superseded: no stale versions — every physical row is the latest of its entity",
    );
  });

  it("prints the count, the share, the logical total, the deepest entity, and who hides them", () => {
    const stale = [
      ...records,
      { ...slackRecord({ sourceId: "s1" }), text: "t s1 edited", tsIso: "2026-06-02T00:00:00.000Z" },
    ];
    expect(supersededLine({ rows: stale })).toBe(
      "superseded: 1 of 3 row(s) are stale versions (33.3%) — 2 logical record(s), deepest entity 2 version(s). `store read`/`store cite`/`derive` hide them; `audit` counts physical bronze",
    );
  });
});
