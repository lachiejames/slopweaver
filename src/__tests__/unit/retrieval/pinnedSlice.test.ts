/**
 * Rebuilding the exact slice a brief pinned.
 *
 * The case that decides this module is the GitHub one, and it is the same case `latestRecords.test.ts`
 * exercises for the same reason: `sourceId` is unique only WITHIN a repository, so a bare hash-number exists in every repo
 * the corpus has seen. A suite built only on Slack or Linear ids — both globally unique — passes over the
 * defect entirely.
 */
import { describe, expect, it } from "vitest";

import type { CorpusRecord } from "../../../corpus/types.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";
import { pinSlice, sliceByPinnedRefs } from "../../../retrieval/pinnedSlice.js";

function record({
  source = "github",
  container = "acme/one",
  sourceId = "#1",
  tsIso = "2026-01-01T00:00:00.000Z",
  text = "body",
}: {
  source?: CorpusRecord["source"];
  container?: string;
  sourceId?: string;
  tsIso?: string;
  text?: string;
}): CorpusRecord {
  return { container, kind: "issue", refs: [], source, sourceId, text, tsIso, url: "https://example.invalid/x" };
}

describe("pinSlice", () => {
  it("keeps rank order, because the order IS the ranking the prompt truncates against", () => {
    const slice = [record({ sourceId: "#3" }), record({ sourceId: "#1" }), record({ sourceId: "#2" })];

    expect(pinSlice({ slice }).map((ref) => ref.sourceId)).toEqual(["#3", "#1", "#2"]);
  });

  it("carries all three identity fields, not just the id", () => {
    expect(pinSlice({ slice: [record({ container: "acme/two", sourceId: "#42" })] })).toEqual([
      { container: "acme/two", source: "github", sourceId: "#42" },
    ]);
  });

  it("pins nothing for an empty slice", () => {
    expect(pinSlice({ slice: [] })).toEqual([]);
  });
});

describe("sliceByPinnedRefs", () => {
  it("round-trips a slice back to the same records", () => {
    const slice = [record({ sourceId: "#1", text: "one" }), record({ sourceId: "#2", text: "two" })];
    const result = sliceByPinnedRefs({ records: slice, refs: pinSlice({ slice }) });

    expect(result.isOk()).toBe(true);
    expect(unwrap(result).map((r) => r.text)).toEqual(["one", "two"]);
  });

  it("returns records in REF order, not corpus order", () => {
    const a = record({ sourceId: "#1", text: "one" });
    const b = record({ sourceId: "#2", text: "two" });
    const result = sliceByPinnedRefs({ records: [a, b], refs: pinSlice({ slice: [b, a] }) });

    expect(unwrap(result).map((r) => r.text)).toEqual(["two", "one"]);
  });

  it("tells two repositories' same-numbered issues apart — the whole reason the ref is composite", () => {
    const one = record({ container: "acme/one", sourceId: "#42", text: "alpha launch approved" });
    const two = record({ container: "acme/two", sourceId: "#42", text: "payroll schedule" });
    const result = sliceByPinnedRefs({
      records: [one, two],
      refs: [{ container: "acme/one", source: "github", sourceId: "#42" }],
    });

    expect(unwrap(result).map((r) => r.text)).toEqual(["alpha launch approved"]);
  });

  it("REFUSES an ambiguous identity rather than letting the last row win", () => {
    const older = record({ sourceId: "#7", text: "deploy Monday", tsIso: "2026-01-01T00:00:00.000Z" });
    const edited = record({ sourceId: "#7", text: "deploy Friday", tsIso: "2026-01-02T00:00:00.000Z" });
    const result = sliceByPinnedRefs({
      records: [older, edited],
      refs: [{ container: "acme/one", source: "github", sourceId: "#7" }],
    });

    expect(result.isErr()).toBe(true);
    expect(unwrapErr(result)[0]).toContain("matches 2 records");
  });

  it("REFUSES a ref whose record has left the corpus", () => {
    const result = sliceByPinnedRefs({
      records: [record({ sourceId: "#1" })],
      refs: [{ container: "acme/one", source: "github", sourceId: "#404" }],
    });

    expect(result.isErr()).toBe(true);
    expect(unwrapErr(result)[0]).toContain("no longer in the corpus");
  });

  it("reports EVERY unresolvable ref at once, not just the first", () => {
    const result = sliceByPinnedRefs({
      records: [record({ sourceId: "#1" })],
      refs: [
        { container: "acme/one", source: "github", sourceId: "#404" },
        { container: "acme/one", source: "github", sourceId: "#405" },
      ],
    });

    expect(unwrapErr(result).length).toBe(2);
  });

  it("does not confuse the same id in a different SOURCE", () => {
    const gh = record({ container: "acme/one", source: "github", sourceId: "X-1", text: "github one" });
    const lin = record({ container: "acme/one", source: "linear", sourceId: "X-1", text: "linear one" });
    const result = sliceByPinnedRefs({
      records: [gh, lin],
      refs: [{ container: "acme/one", source: "linear", sourceId: "X-1" }],
    });

    expect(unwrap(result).map((r) => r.text)).toEqual(["linear one"]);
  });

  it("resolves an empty ref list to an empty slice rather than refusing", () => {
    const result = sliceByPinnedRefs({ records: [record({})], refs: [] });

    expect(result.isOk()).toBe(true);
    expect(unwrap(result)).toEqual([]);
  });
});
