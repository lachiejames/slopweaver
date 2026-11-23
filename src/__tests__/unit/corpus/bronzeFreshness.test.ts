/**
 * The bronze writer's freshness rule: a record seen before is written again only when its source can revert and
 * it is not the version written last for its id — a ChatGPT chat renamed and renamed back.
 */
import { describe, expect, it } from "vitest";
import { emptyBronzeDedupIndex, recordDedupDigest } from "../../../corpus/bronzeDedupIndex.js";
import { absorbStoredRecord, isFreshRecord } from "../../../corpus/bronzeFreshness.js";
import type { CorpusRecord, CorpusSource } from "../../../corpus/types.js";

/** One record of `source` carrying `text`, at one fixed instant. */
function record({ source, text }: { source: CorpusSource; text: string }): CorpusRecord {
  return {
    container: "C1",
    kind: "message",
    refs: [],
    source,
    sourceId: "m1",
    text,
    tsIso: "2026-01-01T00:00:00Z",
    url: "https://example.invalid/m1",
  };
}

/** Offer each text in turn to one index, as a fresh run would, and say which were written. */
function offered({ source, texts }: { source: CorpusSource; texts: readonly string[] }): readonly boolean[] {
  const index = emptyBronzeDedupIndex();
  return texts.map((text) => {
    const one = record({ source, text });
    return isFreshRecord({ digest: recordDedupDigest({ record: one }), index, record: one });
  });
}

describe("isFreshRecord", () => {
  it("writes a chatgpt record going back to an earlier version, and nothing written last again", () => {
    expect(offered({ source: "chatgpt", texts: ["a", "b", "a", "a"] })).toEqual([true, true, true, false]);
  });

  it("dedups the same revert on any other source, which keeps one row per version", () => {
    expect(offered({ source: "slack", texts: ["a", "b", "a"] })).toEqual([true, true, false]);
  });

  it("refuses a record older than what is stored, revertible or not", () => {
    const index = emptyBronzeDedupIndex();
    const newer = { ...record({ source: "chatgpt", text: "a" }), tsIso: "2026-01-02T00:00:00Z" };
    absorbStoredRecord({ digest: recordDedupDigest({ record: newer }), index, record: newer });
    const older = record({ source: "chatgpt", text: "b" });
    expect(isFreshRecord({ digest: recordDedupDigest({ record: older }), index, record: older })).toBe(false);
  });
});

describe("absorbStoredRecord", () => {
  it("takes the version stored last as the one a chatgpt revert is measured against", () => {
    const index = emptyBronzeDedupIndex();
    for (const text of ["a", "b"]) {
      const stored = record({ source: "chatgpt", text });
      absorbStoredRecord({ digest: recordDedupDigest({ record: stored }), index, record: stored });
    }
    const [a, b] = [record({ source: "chatgpt", text: "a" }), record({ source: "chatgpt", text: "b" })];
    expect([
      isFreshRecord({ digest: recordDedupDigest({ record: b }), index, record: b }),
      isFreshRecord({ digest: recordDedupDigest({ record: a }), index, record: a }),
    ]).toEqual([false, true]);
  });
});
