import { describe, expect, it } from "vitest";
import { decodeCorpusRecordRow, parseRow } from "../../../corpus/corpusRowCore.js";
import { collapseRowWarnings } from "../../../corpus/rowWarnings.js";

const validRow = {
  container: "o/r",
  kind: "pr",
  refs: ["#1"],
  source: "github",
  sourceId: "gh-1",
  text: "hello",
  tsIso: "2024-01-01T00:00:00Z",
  url: "https://example.test/1",
};

describe("decodeCorpusRecordRow", () => {
  it("decodes a well-formed row", () => {
    expect(decodeCorpusRecordRow({ value: validRow })).toEqual({ record: validRow });
  });

  it("rejects an unknown source", () => {
    expect(decodeCorpusRecordRow({ value: { ...validRow, source: "jira" } })).toEqual({
      error: "unknown source: jira",
      reason: "unknown-source",
    });
  });

  it("rejects an unknown kind", () => {
    expect(decodeCorpusRecordRow({ value: { ...validRow, kind: "wat" } })).toEqual({
      error: "unknown kind: wat",
      reason: "unknown-kind",
    });
  });

  it("names the EMPTY field, and the field, rather than listing all four as missing", () => {
    expect(decodeCorpusRecordRow({ value: { ...validRow, text: "" } })).toEqual({
      error: "empty required field: text",
      reason: "empty-field",
    });
  });

  it("names a genuinely absent field as missing, which is the other defect entirely", () => {
    expect(decodeCorpusRecordRow({ value: { ...validRow, container: undefined } })).toEqual({
      error: "missing required field: container",
      reason: "missing-field",
    });
  });

  it("names a non-string field as missing rather than empty", () => {
    expect(decodeCorpusRecordRow({ value: { ...validRow, sourceId: 5 } })).toEqual({
      error: "missing required field: sourceId",
      reason: "missing-field",
    });
  });

  it("names the FIRST failing field, so two bad fields do not produce a compound message", () => {
    expect(decodeCorpusRecordRow({ value: { ...validRow, container: "", tsIso: "" } })).toEqual({
      error: "empty required field: tsIso",
      reason: "empty-field",
    });
  });

  it("rejects a non-string url", () => {
    expect(decodeCorpusRecordRow({ value: { ...validRow, url: 5 } })).toEqual({
      error: "url must be a string",
      reason: "bad-url",
    });
  });

  it("rejects non-string refs", () => {
    expect(decodeCorpusRecordRow({ value: { ...validRow, refs: [1] } })).toEqual({
      error: "refs must be a string array",
      reason: "bad-refs",
    });
  });

  it("keeps well-typed attrs and drops malformed entries", () => {
    expect(decodeCorpusRecordRow({ value: { ...validRow, attrs: { bad: { nested: 1 }, good: "x" } } })).toEqual({
      record: { ...validRow, attrs: { good: "x" } },
    });
  });

  it("keeps an object raw verbatim and preserves author/title", () => {
    expect(decodeCorpusRecordRow({ value: { ...validRow, author: "alice", raw: { a: 1 }, title: "T" } })).toEqual({
      record: { ...validRow, author: "alice", raw: { a: 1 }, title: "T" },
    });
  });
});

describe("parseRow", () => {
  it("returns invalid JSON for a malformed line", () => {
    expect(parseRow({ line: "{not json" })).toEqual({ error: "invalid JSON", reason: "invalid-json" });
  });

  it("returns not a JSON object for a JSON array line", () => {
    expect(parseRow({ line: "[1,2]" })).toEqual({ error: "not a JSON object", reason: "invalid-json" });
  });

  it("parses a valid JSONL line into a record", () => {
    expect(parseRow({ line: JSON.stringify(validRow) })).toEqual({ record: validRow });
  });
});

describe("collapseRowWarnings — one line per finding, not one per row", () => {
  it("collapses many identical rejections into one line carrying the count", () => {
    const warnings = Array.from({ length: 146 }, (_unused, index) => ({
      error: "empty required field: text",
      line: index + 1,
    }));
    expect(collapseRowWarnings({ warnings })).toEqual([
      "146 row(s) rejected: empty required field: text (line 1, 2, 3, +143 more)",
    ]);
  });

  it("keeps two different messages apart — they are two different connector bugs", () => {
    expect(
      collapseRowWarnings({
        warnings: [
          { error: "empty required field: text", line: 2 },
          { error: "invalid json", line: 5 },
          { error: "empty required field: text", line: 9 },
        ],
      }),
    ).toEqual([
      "2 row(s) rejected: empty required field: text (line 2, 9)",
      "1 row(s) rejected: invalid json (line 5)",
    ]);
  });

  it("names every line when there are few enough to name, with no +more clause", () => {
    expect(collapseRowWarnings({ warnings: [{ error: "bad", line: 4 }] })).toEqual(["1 row(s) rejected: bad (line 4)"]);
  });

  it("reports nothing for a clean file", () => {
    expect(collapseRowWarnings({ warnings: [] })).toEqual([]);
  });
});
