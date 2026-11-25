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

/**
 * One diary event at `start`, last modified at `updated` when given. The text is the same at every start, as both
 * calendar projections write it, so two versions differ only in `tsIso` (which the fingerprint blanks) and `attrs`.
 */
function event({
  source,
  start,
  updated,
}: {
  source: "calendar" | "outlook-calendar";
  start: string;
  updated?: string;
}): CorpusRecord {
  return {
    container: "primary",
    kind: "event",
    refs: [],
    source,
    sourceId: "primary:evt1",
    text: "Planning",
    tsIso: start,
    url: "https://example.invalid/evt1",
    ...(updated !== undefined ? { attrs: { updatedIso: updated } } : {}),
  };
}

/** Store `stored`, then say whether `incoming` is written over it. */
function writtenOver({ stored, incoming }: { stored: CorpusRecord; incoming: CorpusRecord }): boolean {
  const index = emptyBronzeDedupIndex();
  absorbStoredRecord({ digest: recordDedupDigest({ record: stored }), index, record: stored });
  return isFreshRecord({ digest: recordDedupDigest({ record: incoming }), index, record: incoming });
}

describe("isFreshRecord — a diary orders its versions by modification time, not start", () => {
  it.each(["calendar", "outlook-calendar"] as const)("writes a %s event moved to an EARLIER start", (source) => {
    const stored = event({ source, start: "2026-12-10T10:00:00Z", updated: "2026-11-01T08:00:00Z" });
    const incoming = event({ source, start: "2026-12-03T10:00:00Z", updated: "2026-11-20T08:00:00Z" });
    expect(writtenOver({ incoming, stored })).toBe(true);
  });

  it.each(["calendar", "outlook-calendar"] as const)(
    "refuses an OLDER %s version, its later start notwithstanding",
    (source) => {
      const stored = event({ source, start: "2026-12-03T10:00:00Z", updated: "2026-11-20T08:00:00Z" });
      const incoming = event({ source, start: "2026-12-10T10:00:00Z", updated: "2026-11-01T08:00:00Z" });
      expect(writtenOver({ incoming, stored })).toBe(false);
    },
  );

  it("orders modification times by instant, as the latest view does, not by how the string sorts", () => {
    // The offset stamp sorts above the UTC one as a string while being 30 minutes EARLIER.
    const offset = event({
      source: "outlook-calendar",
      start: "2030-01-01T00:00:00Z",
      updated: "2026-01-05T09:30:00+10:00",
    });
    const utc = event({ source: "outlook-calendar", start: "2020-01-01T00:00:00Z", updated: "2026-01-05T00:00:00Z" });
    expect(writtenOver({ incoming: utc, stored: offset })).toBe(true);
    expect(writtenOver({ incoming: offset, stored: utc })).toBe(false);
  });

  it("writes a modified version over a stored row with no modification time, its start months ahead", () => {
    const stored = event({ source: "calendar", start: "2027-03-01T10:00:00Z" });
    const incoming = event({ source: "calendar", start: "2027-02-01T10:00:00Z", updated: "2026-11-20T08:00:00Z" });
    expect(writtenOver({ incoming, stored })).toBe(true);
  });

  it("refuses a row with no modification time over a stored modified one, its start months ahead", () => {
    const stored = event({ source: "calendar", start: "2027-02-01T10:00:00Z", updated: "2026-11-20T08:00:00Z" });
    const incoming = event({ source: "calendar", start: "2027-03-01T10:00:00Z" });
    expect(writtenOver({ incoming, stored })).toBe(false);
  });

  it("still orders any other source by tsIso, an updatedIso attr notwithstanding", () => {
    const stored: CorpusRecord = {
      ...record({ source: "slack", text: "a" }),
      attrs: { updatedIso: "2026-01-01T00:00:00Z" },
    };
    const incoming: CorpusRecord = {
      ...record({ source: "slack", text: "b" }),
      attrs: { updatedIso: "2030-01-01T00:00:00Z" },
      tsIso: "2025-12-31T00:00:00Z",
    };
    expect(writtenOver({ incoming, stored })).toBe(false);
  });
});
