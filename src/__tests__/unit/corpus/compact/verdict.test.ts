/*
 * The PURE per-record verdict compaction judges each row by: dedup semantics, the age horizon and their order. No
 * disk and no clock.
 */
import { describe, expect, it } from "vitest";
import { recordDedupDigest } from "../../../../corpus/bronzeDedupIndex.js";
import { classifyForCompaction } from "../../../../corpus/compactVerdict.js";
import type { CorpusRecord } from "../../../../corpus/types.js";
import { record } from "./harness.js";

const digestOf = ({ of }: { of: CorpusRecord }): string => recordDedupDigest({ record: of });

describe("classifyForCompaction", () => {
  it("keeps a digest never seen before", () => {
    const kept = record();
    expect(
      classifyForCompaction({
        digest: digestOf({ of: kept }),
        olderThanIso: undefined,
        record: kept,
        seen: new Set<string>(),
      }),
    ).toBe("keep");
  });

  it("calls a digest already kept a duplicate", () => {
    const seenRecord = record();
    const digest = digestOf({ of: seenRecord });
    expect(
      classifyForCompaction({ digest, olderThanIso: undefined, record: seenRecord, seen: new Set([digest]) }),
    ).toBe("duplicate");
  });

  it("prunes strictly before the horizon and keeps the record ON it", () => {
    const past = record({ tsIso: "2026-05-31T23:59:59.999Z" });
    const edge = record({ tsIso: "2026-06-01T00:00:00.000Z" });
    const horizon = "2026-06-01T00:00:00.000Z";
    expect(
      classifyForCompaction({ digest: digestOf({ of: past }), olderThanIso: horizon, record: past, seen: new Set() }),
    ).toBe("pruned");
    expect(
      classifyForCompaction({ digest: digestOf({ of: edge }), olderThanIso: horizon, record: edge, seen: new Set() }),
    ).toBe("keep");
  });

  it("prunes nothing without a horizon, however ancient the record", () => {
    const ancient = record({ tsIso: "2019-01-01T00:00:00.000Z" });
    expect(
      classifyForCompaction({
        digest: digestOf({ of: ancient }),
        olderThanIso: undefined,
        record: ancient,
        seen: new Set(),
      }),
    ).toBe("keep");
  });

  it("never prunes a record whose tsIso cannot be parsed — an undateable record can't be proven old", () => {
    const undateable = record({ tsIso: "not-a-date" });
    expect(
      classifyForCompaction({
        digest: digestOf({ of: undateable }),
        olderThanIso: "2026-06-01T00:00:00.000Z",
        record: undateable,
        seen: new Set(),
      }),
    ).toBe("keep");
  });

  it("checks the horizon BEFORE the digest, so a past-horizon copy is pruned rather than deduped", () => {
    // The fingerprint is tsIso-blind, so a stale copy and a fresh re-capture share a digest. Dedup-first
    // would report "duplicate" here and drop the row without ever counting it as pruned.
    const stale = record({ tsIso: "2026-01-01T00:00:00.000Z" });
    const digest = digestOf({ of: stale });
    expect(
      classifyForCompaction({
        digest,
        olderThanIso: "2026-06-01T00:00:00.000Z",
        record: stale,
        seen: new Set([digest]),
      }),
    ).toBe("pruned");
  });
});
