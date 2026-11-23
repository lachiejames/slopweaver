import { describe, expect, it } from "vitest";
import type { CorpusRecord } from "../../../corpus/types.js";
import { buildDigestPrompt, DISTIL_PROMPT_FINGERPRINT } from "../../../gold/distil.js";
import { BATCHING_SCHEME, DEFAULT_TARGET_PER_BATCH, groupForDistil } from "../../../gold/distilGroup.js";

const V = "testfp";

const rec = (over: Partial<CorpusRecord> = {}): CorpusRecord => ({
  container: "o/r",
  kind: "pr",
  refs: [],
  source: "github",
  sourceId: "#1",
  text: "t",
  tsIso: "2024-06-01T00:00:00Z",
  url: "u",
  ...over,
});

/** `n` records one minute apart, oldest first — a realistic container history. */
const history = ({ n, prefix = "r" }: { n: number; prefix?: string }): CorpusRecord[] =>
  Array.from({ length: n }, (_, i) =>
    rec({
      sourceId: `${prefix}-${String(i).padStart(5, "0")}`,
      text: `body ${String(i)}`,
      tsIso: new Date(Date.UTC(2024, 0, 1, 0, i)).toISOString(),
    }),
  );

const hashesOf = ({ records }: { records: readonly CorpusRecord[] }): string[] =>
  groupForDistil({ promptVersion: V, records }).map((b) => b.hash);

/** How many of `after`'s batch hashes were not present in `before` — the blast radius of a change. */
const changedCount = ({ before, after }: { before: readonly string[]; after: readonly string[] }): number => {
  const known = new Set(before);
  return after.filter((h) => !known.has(h)).length;
};

describe("groupForDistil", () => {
  it("buckets by source+container into one batch with a 16-char content hash", () => {
    const batches = groupForDistil({ promptVersion: V, records: [rec({ sourceId: "#1" }), rec({ sourceId: "#2" })] });
    expect(batches).toHaveLength(1);
    expect(batches[0]!.records).toHaveLength(2);
    expect(batches[0]!.hash).toHaveLength(16);
  });

  it("gives a stable hash for identical content and a new hash when text changes", () => {
    const a = groupForDistil({ promptVersion: V, records: [rec({ text: "v1" })] })[0]!.hash;
    const same = groupForDistil({ promptVersion: V, records: [rec({ text: "v1" })] })[0]!.hash;
    const changed = groupForDistil({ promptVersion: V, records: [rec({ text: "v2" })] })[0]!.hash;
    expect(same).toBe(a);
    expect(changed).not.toBe(a);
  });

  it("splits a bucket into several batches once it exceeds the target", () => {
    const batches = groupForDistil({ promptVersion: V, records: history({ n: 400 }) });
    expect(batches.length).toBeGreaterThan(1);
    expect(batches.flatMap((b) => b.records)).toHaveLength(400);
  });

  it("gives a DIFFERENT hash for the same records under a different prompt version", () => {
    const records = [rec({ text: "identical" })];
    const v1 = groupForDistil({ promptVersion: "fp-v1", records })[0]!.hash;
    const v2 = groupForDistil({ promptVersion: "fp-v2", records })[0]!.hash;
    expect(v1).not.toBe(v2);
  });

  it("gives an IDENTICAL hash for the same records under the same prompt version", () => {
    const records = [rec({ text: "identical" })];
    expect(groupForDistil({ promptVersion: "fp-v1", records })[0]!.hash).toBe(
      groupForDistil({ promptVersion: "fp-v1", records })[0]!.hash,
    );
  });

  it("derives the real fingerprint from the prompt+schema+batching as a stable 12-char hex", () => {
    expect(DISTIL_PROMPT_FINGERPRINT).toHaveLength(12);
    expect(DISTIL_PROMPT_FINGERPRINT).toMatch(/^[0-9a-f]{12}$/);
  });

  it("names the batching scheme in the contract, so a boundary change invalidates the cache loudly", () => {
    expect(BATCHING_SCHEME).toBe("cdc-sha256-v1 0.5 1.5");
  });

  // ── The load-bearing property. Fixed-position chunking re-hashed EVERY batch in a container when one
  // record arrived (measured mean 148 of 295 on the real corpus), so an ordinary `refresh` silently
  // re-spent the whole container. Content-defined boundaries bound the blast radius instead.
  describe("stable boundaries: one new record must not re-hash the container", () => {
    it("changes at most 2 batch hashes when a record is APPENDED at the newest end", () => {
      const base = history({ n: 400 });
      const before = hashesOf({ records: base });
      const after = hashesOf({ records: [...base, rec({ sourceId: "r-99999", tsIso: "2099-01-01T00:00:00Z" })] });
      expect(before.length).toBeGreaterThan(5);
      expect(changedCount({ after, before })).toBeLessThanOrEqual(2);
    });

    it("changes at most 2 batch hashes when a record is BACKFILLED at the oldest end", () => {
      const base = history({ n: 400 });
      const before = hashesOf({ records: base });
      const after = hashesOf({ records: [...base, rec({ sourceId: "r-00000-a", tsIso: "1999-01-01T00:00:00Z" })] });
      expect(changedCount({ after, before })).toBeLessThanOrEqual(2);
    });

    // The case plain ascending order does NOT fix, and the reason content-defined boundaries were chosen:
    // 18.3% of real records arrive with a timestamp in the middle of the existing history. The bound below
    // is for THIS fixture; on the real corpus the same probe measures mean 1.9 / max 8 against main's
    // mean 161.3 / max 321, so treat 4 as this fixture's regression tripwire, not a universal guarantee.
    it("changes at most 4 batch hashes for an insertion at ANY position in the history", () => {
      const base = history({ n: 400 });
      const before = hashesOf({ records: base });
      const radii = Array.from({ length: 40 }, (_, i) => {
        const anchor = base[Math.floor((i / 39) * (base.length - 1))]!;
        const probe = rec({ sourceId: `probe-${String(i)}`, text: "new", tsIso: anchor.tsIso });
        return changedCount({ after: hashesOf({ records: [...base, probe] }), before });
      });
      expect(Math.max(...radii)).toBeLessThanOrEqual(4);
    });

    it("keeps every OTHER batch hash byte-identical when one record is appended", () => {
      const base = history({ n: 400 });
      const before = hashesOf({ records: base });
      const after = hashesOf({ records: [...base, rec({ sourceId: "r-99999", tsIso: "2099-01-01T00:00:00Z" })] });
      const survivors = after.filter((h) => before.includes(h));
      expect(survivors.length).toBeGreaterThanOrEqual(before.length - 2);
    });
  });

  // ── Determinism. A cache key that depends on the order records came off disk is a silent re-spend.
  describe("determinism", () => {
    it("produces byte-identical hashes when the same records are supplied in a different order", () => {
      const base = history({ n: 400 });
      const shuffled = base.toReversed();
      const interleaved = [...base.filter((_, i) => i % 2 === 0), ...base.filter((_, i) => i % 2 === 1)];
      expect(hashesOf({ records: shuffled })).toStrictEqual(hashesOf({ records: base }));
      expect(hashesOf({ records: interleaved })).toStrictEqual(hashesOf({ records: base }));
    });

    it("orders records sharing a timestamp by sourceId, so a tie cannot flip between runs", () => {
      const tied = [
        rec({ sourceId: "b", text: "second", tsIso: "2024-06-01T00:00:00Z" }),
        rec({ sourceId: "a", text: "first", tsIso: "2024-06-01T00:00:00Z" }),
        rec({ sourceId: "c", text: "third", tsIso: "2024-06-01T00:00:00Z" }),
      ];
      const forward = groupForDistil({ promptVersion: V, records: tied });
      const reversed = groupForDistil({ promptVersion: V, records: tied.toReversed() });
      expect(forward[0]!.records.map((r) => r.sourceId)).toStrictEqual(["a", "b", "c"]);
      expect(reversed[0]!.hash).toBe(forward[0]!.hash);
    });
  });

  describe("batch sizes stay within the clamps", () => {
    it("never exceeds 1.5x the target and never falls below half it (except the trailing batch)", () => {
      const batches = groupForDistil({ promptVersion: V, records: history({ n: 2000 }) });
      const sizes = batches.map((b) => b.records.length);
      expect(Math.max(...sizes)).toBeLessThanOrEqual(DEFAULT_TARGET_PER_BATCH * 1.5);
      // The trailing (oldest) batch is whatever is left over, so exclude the one shortest batch.
      const withoutRunt = sizes.toSorted((a, b) => a - b).slice(1);
      expect(Math.min(...withoutRunt)).toBeGreaterThanOrEqual(DEFAULT_TARGET_PER_BATCH / 2);
    });

    it("honours an explicit targetPerBatch of 1 as one record per batch", () => {
      const batches = groupForDistil({
        promptVersion: V,
        records: [rec({ sourceId: "#1" }), rec({ sourceId: "#2" })],
        targetPerBatch: 1,
      });
      expect(batches).toHaveLength(2);
      expect(batches[0]!.records).toHaveLength(1);
    });
  });

  describe("boundaries", () => {
    it("returns no batches for an empty corpus", () => {
      expect(groupForDistil({ promptVersion: V, records: [] })).toStrictEqual([]);
    });

    it("returns one batch for a container smaller than the target", () => {
      const batches = groupForDistil({ promptVersion: V, records: history({ n: 5 }) });
      expect(batches).toHaveLength(1);
      expect(batches[0]!.records).toHaveLength(5);
    });

    it("keeps every record exactly once across all batches", () => {
      const records = history({ n: 977 });
      const batches = groupForDistil({ promptVersion: V, records });
      const ids = batches.flatMap((b) => b.records.map((r) => r.sourceId));
      expect(ids).toHaveLength(977);
      expect(new Set(ids).size).toBe(977);
    });

    it("emits the NEWEST batch first, so a --max-batches capped run distils recent content", () => {
      const batches = groupForDistil({ promptVersion: V, records: history({ n: 400 }) });
      const firstBatchNewest = batches[0]!.records.at(-1)!.tsIso;
      const lastBatchOldest = batches.at(-1)!.records[0]!.tsIso;
      expect(firstBatchNewest > lastBatchOldest).toBe(true);
      expect(batches[0]!.records.at(-1)!.sourceId).toBe("r-00399");
    });

    it("orders records oldest-first WITHIN a batch", () => {
      const batches = groupForDistil({ promptVersion: V, records: history({ n: 400 }) });
      const ids = batches.at(-1)!.records.map((r) => r.sourceId);
      expect(ids).toStrictEqual(ids.toSorted());
    });
  });

  describe("recentOnly", () => {
    it("keeps a single batch of the newest records", () => {
      const batches = groupForDistil({
        promptVersion: V,
        recentOnly: true,
        records: [
          rec({ sourceId: "#old", tsIso: "2024-01-01T00:00:00Z" }),
          rec({ sourceId: "#new", tsIso: "2024-06-01T00:00:00Z" }),
        ],
        targetPerBatch: 1,
      });
      expect(batches).toHaveLength(1);
      expect(batches[0]!.records[0]!.sourceId).toBe("#new");
    });

    it("selects exactly the newest N records by id, oldest-first within the batch", () => {
      const batches = groupForDistil({
        promptVersion: V,
        recentOnly: true,
        records: history({ n: 100 }),
        targetPerBatch: 3,
      });
      expect(batches).toHaveLength(1);
      expect(batches[0]!.records.map((r) => r.sourceId)).toStrictEqual(["r-00097", "r-00098", "r-00099"]);
    });
  });

  describe("topContainersPerSource", () => {
    it("keeps only the busiest container per source when asked for one", () => {
      const batches = groupForDistil({
        promptVersion: V,
        records: [
          ...history({ n: 10, prefix: "busy" }).map((r) => ({ ...r, container: "o/busy" })),
          ...history({ n: 2, prefix: "quiet" }).map((r) => ({ ...r, container: "o/quiet" })),
        ],
        topContainersPerSource: 1,
      });
      expect(batches).toHaveLength(1);
      expect(batches[0]!.container).toBe("o/busy");
    });
  });
});

/**
 * The fix `retrieval-truncation-drops-content` describes: `hashBatch` now hashes exactly what
 * `recordBlock` prompts with (the body clipped at 1,200 characters), not a record's full `text`. An edit
 * entirely past that clip can no longer invalidate an already-paid batch for a prompt that never moved.
 */
describe("the distil cap — hashed to match what is prompted", () => {
  const past = ({ tail }: { tail: string }): string => `${"h".repeat(1200)}${tail}`;

  it("does NOT change the batch hash when only text past the cap changes", () => {
    const before = hashesOf({ records: [rec({ text: past({ tail: "the answer is A" }) })] });
    const after = hashesOf({ records: [rec({ text: past({ tail: "the answer is B" }) })] });
    expect(changedCount({ after, before })).toBe(0);
  });

  it("builds a byte-identical prompt from those same two batches, and now agrees with the hash", () => {
    const a = groupForDistil({ promptVersion: V, records: [rec({ text: past({ tail: "the answer is A" }) })] })[0]!;
    const b = groupForDistil({ promptVersion: V, records: [rec({ text: past({ tail: "the answer is B" }) })] })[0]!;
    expect(a.hash).toBe(b.hash);
    expect(buildDigestPrompt({ batch: a }).user).toBe(buildDigestPrompt({ batch: b }).user);
  });

  it("still changes the hash when text WITHIN the prompted slice changes", () => {
    const before = hashesOf({ records: [rec({ text: "the answer is A" })] });
    const after = hashesOf({ records: [rec({ text: "the answer is B" })] });
    expect(changedCount({ after, before })).toBe(1);
  });

  it("clips the prompt body at exactly 1,200 characters", () => {
    const batch = groupForDistil({ promptVersion: V, records: [rec({ text: past({ tail: "PAST-THE-CAP" }) })] })[0]!;
    const { user } = buildDigestPrompt({ batch });
    expect(user.includes("PAST-THE-CAP")).toBe(false);
    expect(
      user
        .split("\n")
        .filter((line) => line.startsWith("h"))
        .join("").length,
    ).toBe(1200);
  });
});

describe("groupForDistil — emission order", () => {
  /** `n` records in one container, so a container's SIZE is what the ranking sees. */
  const container = ({ name, n }: { name: string; n: number }): CorpusRecord[] =>
    Array.from({ length: n }, (_, i) =>
      rec({ container: name, sourceId: `${name}-${String(i)}`, text: `body ${String(i)}` }),
    );

  it("hands out the BUSIEST container first, not the alphabetically first one", () => {
    // `zebra` is the container worth distilling and `alpha` is the low-signal one. Sorted by name, the
    // 12-record container came first and the 40-record one third — measured on the real corpus, that is
    // exactly what a session was handed when it asked for a first batch of gold.
    const records = [...container({ n: 12, name: "alpha" }), ...container({ n: 40, name: "zebra" })];

    const order = groupForDistil({ promptVersion: V, records }).map((batch) => batch.container);

    expect(order[0]).toBe("zebra");
    expect(order.at(-1)).toBe("alpha");
  });

  it("ranks emission with the SAME comparator --top-containers selects with", () => {
    const records = [
      ...container({ n: 40, name: "zebra" }),
      ...container({ n: 12, name: "alpha" }),
      ...container({ n: 5, name: "middle" }),
    ];

    const kept = groupForDistil({ promptVersion: V, records, topContainersPerSource: 2 });

    // The two the ranking keeps are the two busiest, and they arrive in that same ranked order — the
    // coherence this pins: selecting by one order and emitting by another is what put a 12-record
    // container in front of a 40-record one.
    expect([...new Set(kept.map((batch) => batch.container))]).toStrictEqual(["zebra", "alpha"]);
  });

  it("breaks a size tie by key, so equal containers cannot swap between runs", () => {
    const records = [...container({ n: 10, name: "b-repo" }), ...container({ n: 10, name: "a-repo" })];

    const order = groupForDistil({ promptVersion: V, records }).map((batch) => batch.container);

    expect(order).toStrictEqual(["a-repo", "b-repo"]);
  });

  it("leaves the cache key alone — a batch's hash does not depend on where it is emitted", () => {
    const big = container({ n: 40, name: "zebra" });
    const small = container({ n: 12, name: "alpha" });

    const first = groupForDistil({ promptVersion: V, records: [...small, ...big] });
    const second = groupForDistil({ promptVersion: V, records: [...big, ...small] });

    expect(first.map((batch) => batch.hash)).toStrictEqual(second.map((batch) => batch.hash));
  });
});
