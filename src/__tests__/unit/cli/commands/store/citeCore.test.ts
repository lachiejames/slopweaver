/**
 * The pure core `store cite` renders through.
 *
 * Every case is a plain call on a value: the rendering is what this verb adds over `store query`, so the
 * citation token, the optional title line and the subset banner are each asserted as exact lines rather
 * than as a shape. The empty case carries its banner on purpose — "no matching records" off a subset means
 * "none in this window", and a reader who takes it for "none anywhere" has been misled by a true sentence.
 */
import { describe, expect, it } from "vitest";

import {
  CITE_SNIPPET_CHARS,
  normaliseCiteSnippet,
  renderCiteLines,
} from "../../../../../cli/commands/store/citeCore.js";
import type { SubsetManifest } from "../../../../../corpus/subset.js";
import type { CorpusRecord } from "../../../../../corpus/types.js";

/** One record, spread over so only the field under test varies. */
function record(over: Partial<CorpusRecord> = {}): CorpusRecord {
  return {
    container: "an-owner/a-repo",
    kind: "pr",
    refs: [],
    source: "github",
    sourceId: "#42",
    text: "the body",
    tsIso: "2026-09-01T00:00:00.000Z",
    url: "https://github.com/an-owner/a-repo/pull/42",
    ...over,
  };
}

/** The whole banner SUBSET renders to, spelled out so a silently shortened one fails. */
const SUBSET_BANNER =
  "SUBSET — this world model holds only the last 7 day(s) " +
  "(2026-09-03T00:00:00.000Z → 2026-09-10T00:00:00.000Z), 2 record(s) sliced from /tmp/full. " +
  "Everything else is ABSENT from this home, not absent from the world.";

/** A subset manifest whose banner is a known string. */
const SUBSET: SubsetManifest = {
  builtAtIso: "2026-09-10T00:00:00.000Z",
  days: 7,
  sinceIso: "2026-09-03T00:00:00.000Z",
  sourceHome: "/tmp/full",
  sources: [{ kept: 2, newestIso: "2026-09-09T00:00:00.000Z", scanned: 9, source: "github", undated: 0 }],
  untilIso: "2026-09-10T00:00:00.000Z",
  version: 1,
};

describe("normaliseCiteSnippet", () => {
  it("collapses every whitespace run to one space", () => {
    expect(normaliseCiteSnippet({ maxChars: 100, text: "a\n\n  b\tc" })).toBe("a b c");
  });

  it("caps at maxChars, counted after the collapse", () => {
    expect(normaliseCiteSnippet({ maxChars: 5, text: "a\n\n  bcdefg" })).toBe("a bcd");
  });

  it("returns an empty string for empty text", () => {
    expect(normaliseCiteSnippet({ maxChars: 10, text: "" })).toBe("");
  });

  it("ships a 200-character default cap", () => {
    expect(CITE_SNIPPET_CHARS).toBe(200);
  });
});

describe("renderCiteLines", () => {
  it("says so, and says nothing else, when the slice is empty", () => {
    expect(renderCiteLines({ slice: [] })).toEqual(["no matching records"]);
  });

  it("keeps the subset banner above an EMPTY slice, where it matters most", () => {
    expect(renderCiteLines({ slice: [], subset: SUBSET })).toEqual([SUBSET_BANNER, "", "no matching records"]);
  });

  it("prints source, cite token and url, then the snippet, then a separator", () => {
    expect(renderCiteLines({ slice: [record()] })).toEqual([
      "[github] (an-owner/a-repo#42) https://github.com/an-owner/a-repo/pull/42",
      "  the body",
      "",
    ]);
  });

  it("inserts the title line only when the record carries a non-empty one", () => {
    expect(renderCiteLines({ slice: [record({ title: "Fix the pool" })] })[1]).toBe("  Fix the pool");
    expect(renderCiteLines({ slice: [record({ title: "" })] })[1]).toBe("  the body");
  });

  it("normalises the snippet in place, so a multi-line body stays one line", () => {
    expect(renderCiteLines({ slice: [record({ text: "first\nsecond" })] })[1]).toBe("  first second");
  });

  it("keeps the store's own order and renders one block per record", () => {
    expect(renderCiteLines({ slice: [record({ sourceId: "#1" }), record({ sourceId: "#2" })] })).toEqual([
      "[github] (an-owner/a-repo#1) https://github.com/an-owner/a-repo/pull/42",
      "  the body",
      "",
      "[github] (an-owner/a-repo#2) https://github.com/an-owner/a-repo/pull/42",
      "  the body",
      "",
    ]);
  });
});
