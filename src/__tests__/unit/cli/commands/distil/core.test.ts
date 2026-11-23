import { describe, expect, it } from "vitest";
import {
  buildDistilPlanOptions,
  buildDistilWritePlan,
  digestsInBatchOrder,
  distilAnsweredProgressLine,
  distilCompleteLine,
  nextDistilBatch,
  parseDistilPlanOptions,
  planDistil,
  promptChangeRefusal,
  REMOVED_DISTIL_FLAGS,
  recordCountsBySource,
  removedDistilFlagRefusal,
  shouldWriteGold,
  toSourceDigests,
} from "../../../../../cli/commands/distil/core.js";
import type { CorpusRecord } from "../../../../../corpus/types.js";
import type { BatchDigest } from "../../../../../gold/distil.js";
import type { DistilBatch } from "../../../../../gold/distilGroup.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";
import type { SilverIndex } from "../../../../../silver/silverIndexRead.js";

const batch = ({
  source,
  container,
  hash,
}: {
  source: DistilBatch["source"];
  container: string;
  hash: string;
}): DistilBatch => ({
  container,
  hash,
  records: [],
  source,
});

const digest = ({ source, container }: { source: BatchDigest["source"]; container: string }): BatchDigest => ({
  container,
  points: [{ citations: ["u"], point: "a decision" }],
  source,
  summary: `${container} summary`,
});

const rec = (over: Partial<CorpusRecord>): CorpusRecord => ({
  container: "c",
  kind: "pr",
  refs: [],
  source: "github",
  sourceId: "#1",
  text: "t",
  tsIso: "2026-01-01T00:00:00Z",
  url: "u",
  ...over,
});

describe("removedDistilFlagRefusal", () => {
  it("names every removed flag present, with its migration message", () => {
    const lines = removedDistilFlagRefusal({ rest: ["--budget", "500000", "--full"] });
    expect(lines).toHaveLength(2);
    expect(lines[0]).toBe(`--budget ${REMOVED_DISTIL_FLAGS["--budget"]}`);
    expect(lines[1]).toBe(`--full ${REMOVED_DISTIL_FLAGS["--full"]}`);
  });

  it("says nothing for a tail with no removed flag", () => {
    expect(removedDistilFlagRefusal({ rest: ["--home", "/tmp", "--recent-only"] })).toEqual([]);
  });

  it("covers exactly the six named-removed flags", () => {
    expect(Object.keys(REMOVED_DISTIL_FLAGS).toSorted()).toEqual(
      ["--budget", "--concurrency", "--dry-run", "--full", "--max-batches", "--max-cost"].toSorted(),
    );
  });
});

describe("parseDistilPlanOptions", () => {
  it("parses --recent-only and the integer flags", () => {
    const parsed = unwrap(
      parseDistilPlanOptions({ rest: ["--recent-only", "--max-per-batch", "10", "--top-containers", "3"] }),
    );
    expect(parsed.recentOnly).toBe(true);
    expect(parsed.maxPerBatch).toBe(10);
    expect(parsed.topContainers).toBe(3);
  });

  it("defaults recentOnly to false and leaves the integers undefined", () => {
    const parsed = unwrap(parseDistilPlanOptions({ rest: [] }));
    expect(parsed.recentOnly).toBe(false);
    expect(parsed.maxPerBatch).toBeUndefined();
    expect(parsed.topContainers).toBeUndefined();
  });

  it("errors on a non-positive integer flag", () => {
    expect(unwrapErr(parseDistilPlanOptions({ rest: ["--max-per-batch", "0"] })).join(" ")).toContain(
      "--max-per-batch",
    );
  });

  it("errors on an unknown flag", () => {
    expect(unwrapErr(parseDistilPlanOptions({ rest: ["--bogus"] }))).toEqual(["unknown flag: --bogus"]);
  });
});

describe("buildDistilPlanOptions (from already-tokenised flags)", () => {
  it("builds the same options a full parse would, from pre-tokenised values/flags", () => {
    const built = unwrap(
      buildDistilPlanOptions({ flags: new Set(["recent-only"]), values: { home: "/wm", "max-per-batch": "5" } }),
    );
    expect(built).toEqual({ home: "/wm", maxPerBatch: 5, recentOnly: true });
  });
});

describe("planDistil (deduped by unique hash)", () => {
  it("counts unique batches cached vs remaining, ignoring raw batch count", () => {
    const batches = [
      batch({ container: "a", hash: "h1", source: "github" }),
      batch({ container: "b", hash: "h2", source: "github" }),
      batch({ container: "c", hash: "h3", source: "slack" }),
    ];
    const cache = new Map<string, BatchDigest>([["h1", digest({ container: "a", source: "github" })]]);
    const plan = planDistil({ batches, cache });
    expect(plan.totalUniqueBatches).toBe(3);
    expect(plan.cachedUniqueBatches).toBe(1);
    expect(plan.remainingUniqueBatches).toBe(2);
  });

  it("counts a duplicate-hash batch ONCE", () => {
    const dup = batch({ container: "a", hash: "dup", source: "github" });
    const plan = planDistil({ batches: [dup, { ...dup }], cache: new Map() });
    expect(plan.totalUniqueBatches).toBe(1);
    expect(plan.remainingUniqueBatches).toBe(1);
  });
});

describe("nextDistilBatch", () => {
  it("picks the first batch, in plan order, whose hash is not cached", () => {
    const batches = [
      batch({ container: "a", hash: "h1", source: "github" }),
      batch({ container: "b", hash: "h2", source: "github" }),
    ];
    const cache = new Map<string, BatchDigest>([["h1", digest({ container: "a", source: "github" })]]);
    expect(nextDistilBatch({ batches, cache })!.container).toBe("b");
  });

  it("returns undefined once every unique hash is cached", () => {
    const batches = [batch({ container: "a", hash: "h1", source: "github" })];
    const cache = new Map<string, BatchDigest>([["h1", digest({ container: "a", source: "github" })]]);
    expect(nextDistilBatch({ batches, cache })).toBeUndefined();
  });

  it("is deterministic across repeated calls with the same plan + cache (same pick every time)", () => {
    const batches = [
      batch({ container: "a", hash: "h1", source: "github" }),
      batch({ container: "b", hash: "h2", source: "github" }),
    ];
    const cache = new Map<string, BatchDigest>();
    expect(nextDistilBatch({ batches, cache })!.hash).toBe(nextDistilBatch({ batches, cache })!.hash);
  });
});

describe("digestsInBatchOrder (the sequence that feeds reduceToSourceDigest)", () => {
  it("maps every batch in PLAN ORDER through the cache, preserving duplicates", () => {
    const dup = batch({ container: "a", hash: "dup", source: "github" });
    const other = batch({ container: "b", hash: "other", source: "github" });
    const cache = new Map<string, BatchDigest>([
      ["dup", digest({ container: "a", source: "github" })],
      ["other", digest({ container: "b", source: "github" })],
    ]);
    const digests = digestsInBatchOrder({ batches: [dup, other, { ...dup }], cache });
    // THREE entries, not two — a hash appearing twice in the plan contributes its digest twice.
    expect(digests).toHaveLength(3);
    expect(digests.map((d) => d.container)).toEqual(["a", "b", "a"]);
  });

  it("skips a batch with no digest at all, rather than throwing", () => {
    const cached = batch({ container: "a", hash: "h1", source: "github" });
    const uncached = batch({ container: "b", hash: "h2", source: "github" });
    const cache = new Map<string, BatchDigest>([["h1", digest({ container: "a", source: "github" })]]);
    expect(digestsInBatchOrder({ batches: [cached, uncached], cache })).toHaveLength(1);
  });
});

describe("shouldWriteGold", () => {
  it("writes gold only when every batch resolved to a digest, and the plan is non-empty", () => {
    expect(shouldWriteGold({ batchCount: 5, digestCount: 5 })).toBe(true);
    expect(shouldWriteGold({ batchCount: 5, digestCount: 3 })).toBe(false);
    expect(shouldWriteGold({ batchCount: 0, digestCount: 0 })).toBe(false); // nothing to distil ≠ complete
  });
});

describe("progress + completion report lines", () => {
  it("formats the in-progress line with the recomputed unique-batch counts", () => {
    const line = distilAnsweredProgressLine({
      batch: batch({ container: "acme/web", hash: "h1", source: "github" }),
      plan: { cachedUniqueBatches: 1, remainingUniqueBatches: 2, totalUniqueBatches: 3 },
    });
    expect(line).toBe(
      "digested github/acme/web (batch h1) — 1/3 unique batch(es) cached, 2 remaining. Run `slopweaver distil brief` for the next one.",
    );
  });

  it("formats the completion line naming the gold path", () => {
    const line = distilCompleteLine({
      batch: batch({ container: "acme/web", hash: "h1", source: "github" }),
      goldPath: "/wm/gold",
    });
    expect(line).toBe(
      "digested github/acme/web (batch h1) — every unique batch is now cached → gold rebuilt at /wm/gold",
    );
  });
});

describe("toSourceDigests (source-digest partitioning)", () => {
  it("groups batch digests by source with per-source record counts", () => {
    const digests = [
      digest({ container: "a", source: "github" }),
      digest({ container: "b", source: "github" }),
      digest({ container: "c", source: "slack" }),
    ];
    const records = [rec({ source: "github" }), rec({ source: "github" }), rec({ source: "slack" })];
    const sourceDigests = toSourceDigests({ digests, recordCountBySource: recordCountsBySource({ records }) });
    const github = sourceDigests.find((d) => d.source === "github")!;
    expect(github.containers).toHaveLength(2);
    expect(github.recordCount).toBe(2);
  });
});

describe("buildDistilWritePlan (gold write plan)", () => {
  const silverIndex: SilverIndex = { containers: [], opportunities: [], people: [] };

  it("resolves the silver digest + gold doc file paths under home", () => {
    const sourceDigests = [
      { containers: [digest({ container: "a", source: "github" })], recordCount: 1, source: "github" as const },
    ];
    const plan = buildDistilWritePlan({
      builtAtIso: "2026-07-19T00:00:00Z",
      home: "/wm",
      silverIndex,
      sourceDigests,
    });
    expect(plan.silverDigests.map((f) => f.path)).toEqual(["/wm/corpus/silver/digests/github.json"]);
    expect(plan.goldDocs.some((f) => f.path.endsWith("overview.md"))).toBe(true);
    expect(plan.goldDocs.some((f) => f.path.endsWith("by-source/github.md"))).toBe(true);
    // The build timestamp is stamped into the overview.
    expect(plan.goldDocs.find((f) => f.path.endsWith("overview.md"))!.content).toContain("2026-07-19T00:00:00Z");
  });
});

describe("promptChangeRefusal", () => {
  const base = { cachedCount: 842, currentFingerprint: "bbbbbbbbbbbb" };

  it("refuses a changed contract, naming both fingerprints and the escape", () => {
    const lines = promptChangeRefusal({ ...base, accepted: false, storedFingerprint: "aaaaaaaaaaaa" });
    expect(lines).toEqual([
      "distil: the distil contract changed — prompt, schema, or batch boundaries (aaaaaaaaaaaa → bbbbbbbbbbbb).",
      "distil: all 842 cached digest(s) were produced under the old contract and no longer apply.",
      "distil: re-run `distil brief --accept-prompt-change` to authorise starting over under the new contract.",
    ]);
  });

  it("names a pre-marker cache as unversioned rather than inventing a version", () => {
    const lines = promptChangeRefusal({ ...base, accepted: false, storedFingerprint: null });
    expect(lines[0]!).toBe(
      "distil: the distil contract changed — prompt, schema, or batch boundaries (unversioned (pre-PR5.4 cache) → bbbbbbbbbbbb).",
    );
  });

  it("proceeds once --accept-prompt-change authorises the change", () => {
    expect(promptChangeRefusal({ ...base, accepted: true, storedFingerprint: "aaaaaaaaaaaa" })).toEqual([]);
  });

  it("proceeds when the contract is unchanged", () => {
    expect(promptChangeRefusal({ ...base, accepted: false, storedFingerprint: "bbbbbbbbbbbb" })).toEqual([]);
  });

  it("proceeds on a COLD cache — there is nothing cached to invalidate", () => {
    expect(
      promptChangeRefusal({ ...base, accepted: false, cachedCount: 0, storedFingerprint: "aaaaaaaaaaaa" }),
    ).toEqual([]);
  });
});
