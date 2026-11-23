import { describe, expect, it } from "vitest";
import type { CorpusRecord } from "../../../corpus/types.js";
import { blockerCitationInfo, blockerOpportunityForRecord, type Opportunity } from "../../../silver/opportunity.js";
import { sortOpportunities } from "../../../silver/opportunityScan.js";

const NOW = Date.parse("2024-06-15T00:00:00Z");
const rec = (over: Partial<CorpusRecord> = {}): CorpusRecord => ({
  container: "o/r",
  kind: "pr",
  refs: [],
  source: "github",
  sourceId: "#1",
  text: "t",
  tsIso: "2024-06-15T00:00:00Z",
  url: "u",
  ...over,
});

describe("blockerCitationInfo", () => {
  it("indexes citing containers and the newest citer per token", () => {
    const info = blockerCitationInfo({
      records: [
        rec({ container: "c1", refs: ["#target"], tsIso: "2024-06-10T00:00:00Z" }),
        rec({ container: "c2", refs: ["#target"], tsIso: "2024-06-14T00:00:00Z" }),
      ],
    });
    const target = info.get("#target")!;
    expect([...target.containers].toSorted()).toEqual(["c1", "c2"]);
    expect(target.latestCiterMs).toBe(Date.parse("2024-06-14T00:00:00Z"));
  });

  it("ignores an unparseable citer timestamp", () => {
    const info = blockerCitationInfo({ records: [rec({ refs: ["#t"], tsIso: "nope" })] });
    expect(info.get("#t")!.latestCiterMs).toBe(0);
  });
});

describe("blockerOpportunityForRecord", () => {
  it("returns undefined when the record is never cited", () => {
    expect(blockerOpportunityForRecord({ citing: undefined, nowMs: NOW, record: rec() })).toBeUndefined();
  });

  it("does not flag a stale target with no recent citer", () => {
    const result = blockerOpportunityForRecord({
      citing: { containers: new Set(["c1"]), latestCiterMs: Date.parse("2024-01-01T00:00:00Z") },
      nowMs: NOW,
      record: rec({ sourceId: "#old", text: "done", tsIso: "2024-01-01T00:00:00Z" }),
    });
    expect(result).toBeUndefined();
  });

  it("flags a stale target that a recent record still cites", () => {
    const result = blockerOpportunityForRecord({
      citing: { containers: new Set(["c1", "c2"]), latestCiterMs: Date.parse("2024-06-14T00:00:00Z") },
      nowMs: NOW,
      record: rec({ sourceId: "#old", text: "done", title: "Stale target", tsIso: "2024-01-01T00:00:00Z" }),
    })!;
    expect(result.kind).toBe("blocker");
    expect(result.summary).toContain("stale");
  });

  it("flags an unresolved record even when fresh", () => {
    const result = blockerOpportunityForRecord({
      citing: { containers: new Set(["c1"]), latestCiterMs: NOW },
      nowMs: NOW,
      record: rec({ sourceId: "#open", text: "this is blocked on review", title: "Open item" }),
    })!;
    expect(result.summary).toContain("unresolved");
  });

  it("trusts a projection's precomputed unresolved flag over the words, in both directions", () => {
    const citing = { containers: new Set(["c1"]), latestCiterMs: NOW };
    const flagged = blockerOpportunityForRecord({
      citing,
      nowMs: NOW,
      record: rec({ sourceId: "#flag", text: "", title: "Projected item", unresolved: true }),
    })!;
    expect(flagged.summary).toBe('#flag ("Projected item") is referenced and reads unresolved across 1 container(s)');
    expect(
      blockerOpportunityForRecord({
        citing,
        nowMs: NOW,
        record: rec({ sourceId: "#cleared", text: "this is blocked on review", title: "Done", unresolved: false }),
      }),
    ).toBeUndefined();
  });

  it("returns undefined for a cited but TITLE-LESS target — an opaque id is noise, not an insight (PR4.8)", () => {
    expect(
      blockerOpportunityForRecord({
        citing: { containers: new Set(["c1"]), latestCiterMs: NOW },
        nowMs: NOW,
        record: rec({ sourceId: "1712345678.001", text: "this is blocked on review" }),
      }),
    ).toBeUndefined();
  });
});

describe("sortOpportunities", () => {
  it("orders by score desc, then subject asc, then kind asc", () => {
    const opps: Opportunity[] = [
      { evidence: [], evidenceCount: 0, kind: "duplication", score: 1, subject: "b", summary: "" },
      { evidence: [], evidenceCount: 0, kind: "blocker", score: 2, subject: "z", summary: "" },
      { evidence: [], evidenceCount: 0, kind: "cross-cutting", score: 1, subject: "a", summary: "" },
      { evidence: [], evidenceCount: 0, kind: "blocker", score: 1, subject: "a", summary: "" },
    ];
    expect(sortOpportunities({ opportunities: opps }).map((o) => `${String(o.score)}:${o.subject}:${o.kind}`)).toEqual([
      "2:z:blocker",
      "1:a:blocker",
      "1:a:cross-cutting",
      "1:b:duplication",
    ]);
  });
});
