import { describe, expect, it } from "vitest";
import { parseCorpusRecords } from "../../../corpus/corpusDirRead.js";
import { unwrap } from "../../../lib/result.js";

const line = (over: Record<string, unknown> = {}): string =>
  JSON.stringify({
    container: "o/r",
    kind: "pr",
    refs: [],
    source: "github",
    sourceId: "#1",
    text: "hi",
    tsIso: "2024-01-01T00:00:00Z",
    url: "u",
    ...over,
  });

describe("parseCorpusRecords", () => {
  it("keeps valid records and skips corrupt/unknown lines with warnings", () => {
    const content = [
      line(),
      "not json at all",
      line({ source: "gitlab" }), // unknown source (github/slack/linear/notion/gold only)
      line({ text: "" }), // missing required field
      "",
    ].join("\n");
    const result = unwrap(parseCorpusRecords({ content }));
    expect(result.records).toHaveLength(1);
    expect(result.warnings).toHaveLength(3);
  });

  it("drops a record with an unknown kind", () => {
    const result = unwrap(parseCorpusRecords({ content: line({ kind: "saga" }) }));
    expect(result.records).toHaveLength(0);
    expect(result.warnings[0]).toContain("unknown kind");
  });

  it("reads pre-attrs bronze unchanged (backward-compatible: no attrs field ⇒ no attrs)", () => {
    const record = unwrap(parseCorpusRecords({ content: line() })).records[0]!;
    expect(record.attrs).toBeUndefined();
  });

  it("reads an explicit private visibility back", () => {
    const record = unwrap(parseCorpusRecords({ content: line({ visibility: "private" }) })).records[0]!;
    expect(record.visibility).toBe("private");
  });

  it("reads an unmarked legacy record as public (visibility absent)", () => {
    const record = unwrap(parseCorpusRecords({ content: line() })).records[0]!;
    expect(record.visibility).toBeUndefined();
  });

  it("drops an unrecognised visibility value WITHOUT dropping the record (reads as public)", () => {
    const record = unwrap(parseCorpusRecords({ content: line({ visibility: "secret" }) })).records[0]!;
    expect(record.sourceId).toBe("#1");
    expect(record.visibility).toBeUndefined();
  });

  it("round-trips a rich attrs payload (scalars + string array)", () => {
    const attrs = { draft: false, labels: ["bug", "retrieval"], state: "open" };
    const record = unwrap(parseCorpusRecords({ content: line({ attrs }) })).records[0]!;
    expect(record.attrs).toEqual(attrs);
  });

  it("drops malformed attrs WITHOUT dropping the record", () => {
    const notAnObject = unwrap(parseCorpusRecords({ content: line({ attrs: "nope" }) })).records[0]!;
    expect(notAnObject.sourceId).toBe("#1");
    expect(notAnObject.attrs).toBeUndefined();
  });

  it("keeps well-typed attr entries and drops only the malformed ones", () => {
    const record = unwrap(parseCorpusRecords({ content: line({ attrs: { bad: { nested: 1 }, good: "keep" } }) }))
      .records[0]!;
    expect(record.attrs).toEqual({ good: "keep" });
  });

  it("round-trips the full raw payload verbatim (nested objects + arrays kept)", () => {
    const raw = { labels: [{ name: "bug" }], number: 7, state: { name: "open" } };
    const record = unwrap(parseCorpusRecords({ content: line({ raw }) })).records[0]!;
    expect(record.raw).toEqual(raw);
  });

  it("drops a malformed (non-object) raw WITHOUT dropping the record", () => {
    const record = unwrap(parseCorpusRecords({ content: line({ raw: "nope" }) })).records[0]!;
    expect(record.sourceId).toBe("#1");
    expect(record.raw).toBeUndefined();
  });
});
