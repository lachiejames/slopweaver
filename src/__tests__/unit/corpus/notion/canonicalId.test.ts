/**
 * The one spelling of a Notion page id the corpus keys on. Every fixture id is synthetic.
 */
import { describe, expect, it } from "vitest";

import {
  canonicalNotionId,
  canonicalNotionRecord,
  canonicalNotionSourceId,
  notionSourceIdSpellings,
} from "../../../../corpus/notion/canonicalId.js";
import type { CorpusRecord } from "../../../../corpus/types.js";

const DASHED = "0123abcd-4567-89ab-cdef-0123456789ab";
const UNDASHED = "0123abcd456789abcdef0123456789ab";

const record = (over: Partial<CorpusRecord> = {}): CorpusRecord => ({
  container: "notion/parent",
  kind: "page",
  refs: [],
  source: "notion",
  sourceId: `page:${UNDASHED}`,
  text: "body",
  tsIso: "2026-06-01T00:00:00.000Z",
  url: "https://www.notion.so/Page-0123abcd456789abcdef0123456789ab",
  ...over,
});

describe("canonicalNotionId", () => {
  it("dashes an undashed id", () => {
    expect(canonicalNotionId({ id: UNDASHED })).toBe(DASHED);
  });

  it("returns a dashed id unchanged", () => {
    expect(canonicalNotionId({ id: DASHED })).toBe(DASHED);
  });

  it("lowercases either spelling", () => {
    expect(canonicalNotionId({ id: UNDASHED.toUpperCase() })).toBe(DASHED);
    expect(canonicalNotionId({ id: DASHED.toUpperCase() })).toBe(DASHED);
  });

  it("refuses anything that is not 32 hex digits once undashed", () => {
    expect(canonicalNotionId({ id: UNDASHED.slice(1) })).toBeUndefined();
    expect(canonicalNotionId({ id: `${UNDASHED}0` })).toBeUndefined();
    expect(canonicalNotionId({ id: `${UNDASHED.slice(1)}g` })).toBeUndefined();
    expect(canonicalNotionId({ id: "" })).toBeUndefined();
  });
});

describe("canonicalNotionSourceId", () => {
  it("re-keys a bare undashed page id", () => {
    expect(canonicalNotionSourceId({ sourceId: `page:${UNDASHED}` })).toBe(`page:${DASHED}`);
  });

  it("re-keys the page segment of a chunk id and keeps the chunk index", () => {
    expect(canonicalNotionSourceId({ sourceId: `page:${UNDASHED}:chunk:3` })).toBe(`page:${DASHED}:chunk:3`);
  });

  it("re-keys the page segment of a comment id and keeps the comment's own id byte for byte", () => {
    const commentId = "fedcba98-7654-3210-fedc-ba9876543210";
    expect(canonicalNotionSourceId({ sourceId: `page:${UNDASHED}:comment:${commentId}` })).toBe(
      `page:${DASHED}:comment:${commentId}`,
    );
  });

  it("leaves an already-dashed page id, a database id and a malformed id as given", () => {
    expect(canonicalNotionSourceId({ sourceId: `page:${DASHED}:chunk:1` })).toBe(`page:${DASHED}:chunk:1`);
    expect(canonicalNotionSourceId({ sourceId: `database:${UNDASHED}` })).toBe(`database:${UNDASHED}`);
    expect(canonicalNotionSourceId({ sourceId: `page:${UNDASHED}0` })).toBe(`page:${UNDASHED}0`);
  });
});

describe("notionSourceIdSpellings", () => {
  it("names both spellings of a page id, canonical first, from either one", () => {
    const both = [`page:${DASHED}:chunk:0`, `page:${UNDASHED}:chunk:0`];
    expect(notionSourceIdSpellings({ sourceId: `page:${DASHED}:chunk:0` })).toStrictEqual(both);
    expect(notionSourceIdSpellings({ sourceId: `page:${UNDASHED}:chunk:0` })).toStrictEqual(both);
  });

  it("names one spelling for an id that is not a page's", () => {
    expect(notionSourceIdSpellings({ sourceId: `database:${UNDASHED}` })).toStrictEqual([`database:${UNDASHED}`]);
  });
});

describe("canonicalNotionRecord", () => {
  it("re-keys a Notion record and changes nothing else on it", () => {
    expect(canonicalNotionRecord({ record: record() })).toStrictEqual(record({ sourceId: `page:${DASHED}` }));
  });

  it("returns the very same object when nothing moved", () => {
    const dashed = record({ sourceId: `page:${DASHED}` });
    expect(canonicalNotionRecord({ record: dashed })).toBe(dashed);
  });

  it("never touches another source's record", () => {
    const github = record({ source: "github" });
    expect(canonicalNotionRecord({ record: github })).toBe(github);
  });
});
