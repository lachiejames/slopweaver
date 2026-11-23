/**
 * Matching a stored row to the bronze record it should hold — kind, title, body and one attribute, never the key
 * alone.
 */
import { describe, expect, it } from "vitest";

import type { CorpusRecord } from "../../../corpus/types.js";
import { contentFactsOf, matchingContentIds } from "../../../store/contentMatch.js";

const ATTR = "meetingDate";

/** A transcript row as bronze holds one. */
const row = (over: Partial<CorpusRecord> = {}): CorpusRecord => ({
  attrs: { meetingDate: "2 Oct 2026" },
  container: "mail/meetings",
  kind: "transcript",
  refs: [],
  source: "gmail",
  sourceId: "m1:meeting",
  text: "Ana: shall we ship it",
  title: "Standup",
  tsIso: "2026-10-02T03:00:00.000Z",
  url: "https://docs.google.com/document/d/doc1/edit",
  visibility: "private",
  ...over,
});

describe("contentFactsOf", () => {
  it("hashes the body as md5 hex and keeps the kind, title and named attribute the projection stores", () => {
    expect(contentFactsOf({ attrKey: ATTR, record: row({ text: "hello" }) })).toEqual({
      attr: "2 Oct 2026",
      bodyMd5: "5d41402abc4b2a76b9719d911017c592",
      kind: "transcript",
      sourceId: "m1:meeting",
      title: "Standup",
      visibility: "private",
    });
  });

  it("stores an absent title as null, the way the store's column does", () => {
    const { title: _title, ...untitled } = row();
    expect(contentFactsOf({ attrKey: ATTR, record: untitled }).title).toBe(null);
  });

  it("stores an unstamped record as public, the store column's default", () => {
    const { visibility: _visibility, ...unstamped } = row();
    expect(contentFactsOf({ attrKey: ATTR, record: unstamped }).visibility).toBe("public");
  });

  it("reads an absent or non-string attribute as null, as the store's `->>` of a missing key does", () => {
    expect([
      contentFactsOf({ attrKey: ATTR, record: row({ attrs: {} }) }).attr,
      contentFactsOf({ attrKey: ATTR, record: row({ attrs: { meetingDate: 2 } }) }).attr,
    ]).toEqual([null, null]);
  });
});

describe("matchingContentIds", () => {
  const factsOf = ({ record }: { record: CorpusRecord }) => contentFactsOf({ attrKey: ATTR, record });
  const expected = [factsOf({ record: row() })];
  const storedAs = ({ record }: { record: CorpusRecord }) => new Map([[record.sourceId, factsOf({ record })]]);

  it("matches a stored row carrying the same kind, title, body, attribute and visibility", () => {
    expect([...matchingContentIds({ expected, stored: storedAs({ record: row() }) })]).toEqual(["m1:meeting"]);
  });

  it("refuses a row under the same key whose body, title, kind, attribute or visibility differs, and an absent row", () => {
    const misses = [
      storedAs({ record: row({ text: "Ana: an earlier draft" }) }),
      storedAs({ record: row({ title: "Retro" }) }),
      storedAs({ record: row({ kind: "message" }) }),
      storedAs({ record: row({ attrs: { meetingDate: "1 Oct 2026" } }) }),
      storedAs({ record: row({ visibility: "public" }) }),
      new Map(),
    ].map((stored) => matchingContentIds({ expected, stored }).size);
    expect(misses).toEqual([0, 0, 0, 0, 0, 0]);
  });
});
