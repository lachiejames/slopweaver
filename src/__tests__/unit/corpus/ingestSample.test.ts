import { describe, expect, it } from "vitest";
import type { SourceIngestJob } from "../../../corpus/ingestJob.js";
import { capPerContainer, type IngestDeps, ingestSources } from "../../../corpus/ingestSource.js";
import type { CorpusRecord } from "../../../corpus/types.js";
import { ok } from "../../../lib/result.js";

/** A minimal fake record — only the fields the sampler + write path read. */
function record({ container, sourceId }: { container: string; sourceId: string }): CorpusRecord {
  return {
    container,
    kind: "message",
    refs: [],
    source: "slack",
    sourceId,
    text: `text ${sourceId}`,
    tsIso: "2026-06-01T00:00:00.000Z",
    url: `https://demo.example.com/${sourceId}`,
  };
}

describe("capPerContainer", () => {
  it("keeps at most N records per container, first-seen order preserved", () => {
    const records = [
      record({ container: "a", sourceId: "a1" }),
      record({ container: "a", sourceId: "a2" }),
      record({ container: "a", sourceId: "a3" }),
      record({ container: "b", sourceId: "b1" }),
    ];
    const capped = capPerContainer({ records, sample: 2 });
    expect(capped.map((r) => r.sourceId)).toStrictEqual(["a1", "a2", "b1"]);
  });

  it("returns every record when no container exceeds the cap", () => {
    const records = [record({ container: "a", sourceId: "a1" }), record({ container: "b", sourceId: "b1" })];
    expect(capPerContainer({ records, sample: 5 })).toStrictEqual(records);
  });
});

/** A fake ingest deck that records what was written + whether the watermark advance ran. */
function fakeDeck(): {
  deps: IngestDeps;
  writtenRecords: CorpusRecord[];
  advanceCalls: number;
} {
  const writtenRecords: CorpusRecord[] = [];
  const state = { advanceCalls: 0 };
  const deps: IngestDeps = {
    advance: () => {
      state.advanceCalls += 1;
      return ok({ paths: [] });
    },
    nowIso: () => "2030-01-01T00:00:00Z",
    write: ({ records }) => {
      writtenRecords.push(...records);
      return ok({ bySource: {}, deduped: 0, excluded: 0, written: records.length });
    },
  };
  return {
    get advanceCalls() {
      return state.advanceCalls;
    },
    deps,
    writtenRecords,
  };
}

/** One fake job yielding the given records for `slack`. */
function job({ records }: { records: readonly CorpusRecord[] }): SourceIngestJob {
  return {
    label: "slack",
    run: () => Promise.resolve(ok({ records, warnings: [] })),
    source: "slack",
    window: { since: "2026-06-01", until: "2026-07-01" },
  };
}

describe("ingestSources with --sample", () => {
  const records = [
    record({ container: "a", sourceId: "a1" }),
    record({ container: "a", sourceId: "a2" }),
    record({ container: "a", sourceId: "a3" }),
    record({ container: "b", sourceId: "b1" }),
  ];

  it("caps records per container AND does NOT advance the watermark when sampled", async () => {
    const deck = fakeDeck();
    const result = await ingestSources({ deps: deck.deps, home: "/tmp/h", jobs: [job({ records })], sample: 1 });
    expect(result.isOk()).toBe(true);
    expect(deck.writtenRecords.map((r) => r.sourceId)).toStrictEqual(["a1", "b1"]);
    expect(deck.advanceCalls).toBe(0);
  });

  it("writes every record AND advances the watermark on a normal (un-sampled) run", async () => {
    const deck = fakeDeck();
    const result = await ingestSources({ deps: deck.deps, home: "/tmp/h", jobs: [job({ records })] });
    expect(result.isOk()).toBe(true);
    expect(deck.writtenRecords).toHaveLength(4);
    expect(deck.advanceCalls).toBe(1);
  });
});
