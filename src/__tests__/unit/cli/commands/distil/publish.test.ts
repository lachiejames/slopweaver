/**
 * Publishing silver + gold from a complete digest cache.
 *
 * The case that matters is the one an adversarial review pass produced, and it is a REGRESSION rather than a
 * hypothetical: before the model was removed, rerunning `distil` over a complete cache mapped the digests
 * back through the batch list and wrote gold. Afterwards, bare `distil` aliased `distil brief`, which
 * returned "nothing to distil" the moment every hash was cached — so a cache that was complete while gold was
 * missing could never rebuild. The state is reachable by killing the process between a per-batch checkpoint
 * and the write.
 */
import { describe, expect, it } from "vitest";
import { cacheIsComplete, publishFromCache } from "../../../../../cli/commands/distil/publish.js";
import type { CorpusRecord } from "../../../../../corpus/types.js";
import type { BatchDigest } from "../../../../../gold/distil.js";
import type { DistilBatch } from "../../../../../gold/distilGroup.js";

const RECORD: CorpusRecord = {
  container: "acme/one",
  kind: "issue",
  refs: [],
  source: "github",
  sourceId: "#1",
  text: "the deploy pipeline was changed to run nightly",
  tsIso: "2026-01-01T00:00:00.000Z",
  url: "https://example.invalid/1",
};

const BATCH: DistilBatch = { container: "acme/one", hash: "h1", records: [RECORD], source: "github" };

const DIGEST: BatchDigest = {
  container: "acme/one",
  points: [{ citations: ["#1"], point: "The deploy pipeline runs nightly." }],
  source: "github",
  summary: "The deploy pipeline moved to a nightly schedule.",
};

describe("cacheIsComplete", () => {
  it("is true when every batch has a cached digest", () => {
    expect(cacheIsComplete({ batches: [BATCH], cache: new Map([["h1", DIGEST]]) })).toBe(true);
  });

  it("is false when a batch is still outstanding", () => {
    expect(cacheIsComplete({ batches: [BATCH], cache: new Map() })).toBe(false);
  });
});

describe("publishFromCache", () => {
  it("writes the gold and silver files a complete cache can produce", () => {
    const written: string[] = [];
    const counts = publishFromCache({
      batches: [BATCH],
      builtAtIso: "2026-02-02T00:00:00.000Z",
      cache: new Map([["h1", DIGEST]]),
      exists: () => false,
      home: "/tmp/home",
      recordCountBySource: new Map([["github", 1]]),
      writeText: ({ path }) => {
        written.push(path);
      },
    });

    expect(counts.gold).toBeGreaterThan(0);
    expect(written.length).toBe(counts.gold + counts.silver);
    expect(written.some((path) => path.endsWith("by-source/github.md"))).toBe(true);
  });

  it("is idempotent in its own terms — the same cache renders the same file set twice", () => {
    const run = (): readonly string[] => {
      const paths: string[] = [];
      publishFromCache({
        batches: [BATCH],
        builtAtIso: "2026-02-02T00:00:00.000Z",
        cache: new Map([["h1", DIGEST]]),
        exists: () => false,
        home: "/tmp/home",
        recordCountBySource: new Map([["github", 1]]),
        writeText: ({ path }) => {
          paths.push(path);
        },
      });
      return paths;
    };

    expect(run()).toEqual(run());
  });
});

describe("publishFromCache — leaving a complete set alone", () => {
  /**
   * The narrowing this needed after the first fix went too far. Republishing unconditionally rewrote the
   * `_built` stamp on every invocation, so "complete gold is untouched" stopped being observable — a golden
   * pipeline test caught it. All-or-none is the rule: a set with any file missing is rewritten whole, because
   * a half-present set of derived files disagreeing about when they were built is worse than either extreme.
   */
  it("writes NOTHING when every file it would produce already exists", () => {
    const written: string[] = [];
    const counts = publishFromCache({
      batches: [BATCH],
      builtAtIso: "2026-02-02T00:00:00.000Z",
      cache: new Map([["h1", DIGEST]]),
      exists: () => true,
      home: "/tmp/home",
      recordCountBySource: new Map([["github", 1]]),
      writeText: ({ path }) => {
        written.push(path);
      },
    });

    expect(written).toEqual([]);
    expect(counts).toEqual({ gold: 0, silver: 0 });
  });

  it("rewrites the WHOLE set when a single file is missing, never just the gap", () => {
    const written: string[] = [];
    const counts = publishFromCache({
      batches: [BATCH],
      builtAtIso: "2026-02-02T00:00:00.000Z",
      cache: new Map([["h1", DIGEST]]),
      exists: ({ path }) => !path.endsWith("overview.md"),
      home: "/tmp/home",
      recordCountBySource: new Map([["github", 1]]),
      writeText: ({ path }) => {
        written.push(path);
      },
    });

    expect(written.length).toBe(counts.gold + counts.silver);
    expect(written.length).toBeGreaterThan(1);
  });
});
