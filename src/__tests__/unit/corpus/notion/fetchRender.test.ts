/**
 * Notion rendering and row/page reconciliation. Rich text renders in span order with links as `text (url)`;
 * each property type `renderProperty`'s doc comment lists renders to an exact string; a row flattens to
 * `Name: value` lines; and a database row merged with its pages-lane shadow keeps the row's identity, appends
 * the page body, dedupes comments by id (the later one wins), unions refs in first-seen order, marks a skewed
 * timestamp partial and keeps the page's body digest. Batch reconciliation never merges one page twice.
 */
import { describe, expect, it } from "vitest";

import {
  mergeDuplicateRowPage,
  reconcileRowBatch,
  reconcileRowDuplicates,
  reconcilingBatchFlush,
  renderProperty,
  renderRichText,
  renderRowProperties,
} from "../../../../corpus/notion/fetchRender.js";
import type { NotionPageItem } from "../../../../corpus/notion/project.js";
import type { CorpusRecord } from "../../../../corpus/types.js";

describe("renderRichText", () => {
  it("joins spans in order, renders a link as text (url), and renders a malformed span as nothing", () => {
    const richText = [
      { plain_text: "See " },
      { href: "https://x.example", plain_text: "the doc" },
      "not-a-span",
      { href: "", plain_text: " now" },
      { plain_text: 7 },
    ];

    expect(renderRichText({ richText })).toBe("See the doc (https://x.example) now");
  });

  it("renders a non-array as empty", () => {
    expect(renderRichText({ richText: { plain_text: "x" } })).toBe("");
  });
});

describe("renderProperty", () => {
  it("renders each of the thirteen property types its doc comment lists, and an unknown type as empty", () => {
    const rich = [{ plain_text: "Hi" }];
    const values = [
      { title: rich, type: "title" },
      { rich_text: rich, type: "rich_text" },
      { select: { name: "High" }, type: "select" },
      { status: { name: "Done" }, type: "status" },
      { multi_select: [{ name: "a" }, { name: "" }, { name: "b" }], type: "multi_select" },
      { number: 0, type: "number" },
      { checkbox: true, type: "checkbox" },
      { date: { end: "2026-09-02", start: "2026-09-01" }, type: "date" },
      { type: "url", url: "https://x.example" },
      { email: "a@example.com", type: "email" },
      { phone_number: "+61 400 000 000", type: "phone_number" },
      { people: [{ name: "Ada" }, { name: "Grace" }], type: "people" },
      { relation: [{ id: "p-1" }, { id: "p-2" }], type: "relation" },
      { formula: { string: "x" }, type: "formula" },
    ];

    expect(values.map((value) => renderProperty({ value }))).toEqual([
      "Hi",
      "Hi",
      "High",
      "Done",
      "a, b",
      "0",
      "yes",
      "2026-09-01 → 2026-09-02",
      "https://x.example",
      "a@example.com",
      "+61 400 000 000",
      "Ada, Grace",
      "2 linked",
      "",
    ]);
  });

  it("renders the edge values of date, checkbox and relation exactly", () => {
    const values = [
      { date: { start: "2026-09-01" }, type: "date" },
      { date: { end: "2026-09-02" }, type: "date" },
      { checkbox: false, type: "checkbox" },
      { relation: [], type: "relation" },
      { number: "3", type: "number" },
    ];

    expect(values.map((value) => renderProperty({ value }))).toEqual(["2026-09-01", "", "", "0 linked", ""]);
  });

  it("renders a value with no string type, or no record at all, as empty", () => {
    expect(renderProperty({ value: { title: [{ plain_text: "x" }] } })).toBe("");
    expect(renderProperty({ value: "title" })).toBe("");
  });
});

describe("renderRowProperties", () => {
  it("takes the title-typed property as the title and lists only properties that rendered", () => {
    const properties = {
      Done: { checkbox: false, type: "checkbox" },
      Name: { title: [{ plain_text: "Ship it" }], type: "title" },
      Priority: { select: { name: "High" }, type: "select" },
    };

    expect(renderRowProperties({ properties })).toEqual({ text: "Name: Ship it\nPriority: High", title: "Ship it" });
  });

  it("renders a non-record as an empty title and text", () => {
    expect(renderRowProperties({ properties: null })).toEqual({ text: "", title: "" });
  });
});

/** A page item with the required fields filled and any field overridden. */
function item(over: Partial<NotionPageItem> & { id: string }): NotionPageItem {
  return { chunks: [], comments: [], title: over.id, tsIso: "2026-09-02T00:00:00.000Z", url: "", ...over };
}

describe("mergeDuplicateRowPage", () => {
  it("keeps the row identity, appends the page body, lets the later duplicate comment win and keeps the digest", () => {
    const row = item({
      chunks: ["Name: Ship it"],
      comments: [
        { body: "row copy", id: "c-1", tsIso: "2026-09-01T00:00:00.000Z" },
        { body: "row only", id: "c-2", tsIso: "2026-09-01T00:00:00.000Z" },
      ],
      fileRefs: ["file: a.png"],
      id: "r-1",
      mentionTargets: ["notion:user:u-1"],
      parent: "ds-1",
      relationTargets: ["notion:page:p-2", "notion:page:p-3"],
      title: "Ship it",
      url: "https://notion.so/r-1",
    });
    const page = item({
      bodyDigest: "digest-1",
      chunks: ["The page body."],
      comments: [
        { body: "page copy", id: "c-1", tsIso: "2026-09-01T00:00:00.000Z" },
        { body: "page only", id: "c-3", tsIso: "2026-09-01T00:00:00.000Z" },
      ],
      fileRefs: ["file: b.png", "file: a.png"],
      id: "r-1",
      mentionTargets: ["notion:page:p-9"],
      relationTargets: ["notion:page:p-3", "notion:page:p-4"],
      title: "page-lane title",
      url: "https://notion.so/page-lane",
    });

    expect(mergeDuplicateRowPage({ page, row })).toEqual({
      bodyDigest: "digest-1",
      chunks: ["Name: Ship it", "The page body."],
      comments: [
        { body: "page copy", id: "c-1", tsIso: "2026-09-01T00:00:00.000Z" },
        { body: "row only", id: "c-2", tsIso: "2026-09-01T00:00:00.000Z" },
        { body: "page only", id: "c-3", tsIso: "2026-09-01T00:00:00.000Z" },
      ],
      fileRefs: ["file: a.png", "file: b.png"],
      id: "r-1",
      mentionTargets: ["notion:user:u-1", "notion:page:p-9"],
      parent: "ds-1",
      relationTargets: ["notion:page:p-2", "notion:page:p-3", "notion:page:p-4"],
      title: "Ship it",
      tsIso: "2026-09-02T00:00:00.000Z",
      url: "https://notion.so/r-1",
    });
  });

  it("marks the merge partial on a timestamp skew, and not when both lanes read the same instant", () => {
    const row = item({ id: "r-2" });

    expect(mergeDuplicateRowPage({ page: item({ id: "r-2", tsIso: "2026-09-03T00:00:00.000Z" }), row }).partial).toBe(
      true,
    );
    expect(mergeDuplicateRowPage({ page: item({ id: "r-2" }), row })).toEqual({
      chunks: [],
      comments: [],
      id: "r-2",
      title: "r-2",
      tsIso: "2026-09-02T00:00:00.000Z",
      url: "",
    });
  });

  it("marks the merge partial when either side alone was partial", () => {
    expect(mergeDuplicateRowPage({ page: item({ id: "r-3", partial: true }), row: item({ id: "r-3" }) }).partial).toBe(
      true,
    );
    expect(mergeDuplicateRowPage({ page: item({ id: "r-3" }), row: item({ id: "r-3", partial: true }) }).partial).toBe(
      true,
    );
  });
});

describe("reconcileRowDuplicates", () => {
  it("returns merged rows first in row order, then the pages no row claimed", () => {
    const pages = [
      item({ chunks: ["page A"], id: "a" }),
      item({ chunks: ["standalone"], id: "s" }),
      item({ chunks: ["page B"], id: "b" }),
    ];
    const rows = [
      item({ chunks: ["row B"], id: "b" }),
      item({ chunks: ["row only"], id: "r" }),
      item({ chunks: ["row A"], id: "a" }),
    ];

    expect(reconcileRowDuplicates({ pages, rows }).map((one) => [one.id, one.chunks])).toEqual([
      ["b", ["row B", "page B"]],
      ["r", ["row only"]],
      ["a", ["row A", "page A"]],
      ["s", ["standalone"]],
    ]);
  });
});

describe("reconcileRowBatch", () => {
  it("merges a row whose page is not yet consumed, reports it consumed, and passes an already-consumed one through", () => {
    const pagesById = new Map([
      ["a", item({ chunks: ["page A"], id: "a" })],
      ["b", item({ chunks: ["page B"], id: "b" })],
    ]);
    const rows = [item({ chunks: ["row A"], id: "a" }), item({ chunks: ["row B"], id: "b" })];

    const batch = reconcileRowBatch({ alreadyConsumed: new Set(["b"]), pagesById, rows });

    expect(batch.consumedIds).toEqual(["a"]);
    expect(batch.items.map((one) => [one.id, one.chunks])).toEqual([
      ["a", ["row A", "page A"]],
      ["b", ["row B"]],
    ]);
  });
});

describe("reconcilingBatchFlush", () => {
  it("merges a page into the first batch's row and not again into a later batch's row with the same id", () => {
    const received: (readonly CorpusRecord[])[] = [];
    const flush = reconcilingBatchFlush({
      onBatch: ({ records }) => {
        received.push(records);
      },
      pageLanePages: [item({ chunks: ["page body"], id: "r-1" })],
    });

    flush({ databases: [], rows: [item({ chunks: ["row text"], id: "r-1" })] });
    flush({ databases: [], rows: [item({ chunks: ["row again"], id: "r-1" })] });

    expect(received.map((records) => records.map((record) => [record.sourceId, record.text]))).toEqual([
      [
        ["page:r-1:chunk:0", "row text"],
        ["page:r-1:chunk:1", "page body"],
      ],
      [["page:r-1", "row again"]],
    ]);
  });
});
