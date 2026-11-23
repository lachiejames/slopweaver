/*
 * How a data-source row and its pages-lane shadow become one page item: the pairwise merge, the one-shot
 * reconcile `fetchNotionActivity` runs, and the per-batch reconcile the incremental write uses.
 */
import { describe, expect, it } from "vitest";
import {
  mergeDuplicateRowPage,
  reconcileRowBatch,
  reconcileRowDuplicates,
} from "../../../../../corpus/notion/fetch.js";

describe("mergeDuplicateRowPage (a row IS a page, so both lanes independently discover it)", () => {
  it("keeps the row's identity, appends the page's body chunks after the row's property chunks", () => {
    const row = {
      chunks: ["Status: Done"],
      comments: [{ body: "row comment", id: "c1", tsIso: "2026-05-01T00:00:00.000Z" }],
      id: "row1",
      parent: "db1",
      title: "A task",
      tsIso: "2026-05-01T00:00:00.000Z",
      url: "u",
    };
    const page = {
      chunks: ["extra body text"],
      comments: [{ body: "row comment", id: "c1", tsIso: "2026-05-01T00:00:00.000Z" }],
      id: "row1",
      title: "(untitled)",
      tsIso: "2026-05-01T00:00:00.000Z",
      url: "u",
    };
    const merged = mergeDuplicateRowPage({ page, row });
    expect(merged.id).toBe("row1");
    expect(merged.parent).toBe("db1");
    expect(merged.title).toBe("A task");
    expect(merged.chunks).toEqual(["Status: Done", "extra body text"]);
    expect(merged.comments).toEqual([{ body: "row comment", id: "c1", tsIso: "2026-05-01T00:00:00.000Z" }]);
  });

  it("unions relation/mention/file targets from both sides without duplicates", () => {
    const row = {
      chunks: [],
      comments: [],
      fileRefs: ["file: a"],
      id: "row1",
      relationTargets: ["notion:page:x"],
      title: "row",
      tsIso: "",
      url: "u",
    };
    const page = {
      chunks: [],
      comments: [],
      fileRefs: ["file: a"],
      id: "row1",
      mentionTargets: ["notion:user:y"],
      relationTargets: ["notion:page:x", "notion:page:z"],
      title: "page",
      tsIso: "",
      url: "u",
    };
    const merged = mergeDuplicateRowPage({ page, row });
    expect(merged.fileRefs).toEqual(["file: a"]);
    expect(merged.mentionTargets).toEqual(["notion:user:y"]);
    expect(merged.relationTargets).toEqual(["notion:page:x", "notion:page:z"]);
  });

  it("carries the PAGE's body digest, since the merged item carries the page lane's body", () => {
    // Row-leading this field would drop it on every merged row — the databases lane projects a row from its
    // properties and renders no markdown body at all, so the row side never has one to lead with.
    const row = { chunks: ["Status: Done"], comments: [], id: "row1", title: "row", tsIso: "", url: "u" };
    const page = {
      bodyDigest: "a1".repeat(32),
      chunks: ["body text"],
      comments: [],
      id: "row1",
      title: "page",
      tsIso: "",
      url: "u",
    };
    expect(mergeDuplicateRowPage({ page, row }).bodyDigest).toBe("a1".repeat(32));
  });

  it("leaves the merged item with no body digest when the page lane stored none", () => {
    const row = { chunks: ["Status: Done"], comments: [], id: "row1", title: "row", tsIso: "", url: "u" };
    const page = { chunks: ["body text"], comments: [], id: "row1", title: "page", tsIso: "", url: "u" };
    expect(mergeDuplicateRowPage({ page, row }).bodyDigest).toBe(undefined);
  });
});

describe("reconcileRowDuplicates (fetchNotionActivity's dedup point)", () => {
  it("merges a row with its pages-lane shadow instead of emitting both", () => {
    const row = {
      chunks: ["Status: Done"],
      comments: [],
      id: "row1",
      parent: "db1",
      title: "A task",
      tsIso: "",
      url: "u",
    };
    const shadow = { chunks: ["body"], comments: [], id: "row1", title: "(untitled)", tsIso: "", url: "u" };
    const result = reconcileRowDuplicates({ pages: [shadow], rows: [row] });
    expect(result.map((item) => item.id)).toEqual(["row1"]);
    expect(result[0]!.chunks).toEqual(["Status: Done", "body"]);
  });

  it("keeps a standalone page the databases lane never found as a row", () => {
    const page = { chunks: ["body"], comments: [], id: "pg1", title: "Standalone", tsIso: "", url: "u" };
    const result = reconcileRowDuplicates({ pages: [page], rows: [] });
    expect(result).toEqual([page]);
  });

  it("keeps a row the pages lane never independently discovered", () => {
    const row = {
      chunks: ["Status: Done"],
      comments: [],
      id: "row1",
      parent: "db1",
      title: "A task",
      tsIso: "",
      url: "u",
    };
    const result = reconcileRowDuplicates({ pages: [], rows: [row] });
    expect(result).toEqual([row]);
  });
});

describe("reconcileRowBatch (the incremental-write decomposition of reconcileRowDuplicates)", () => {
  it("merges a batch's row with its known pages-lane shadow", () => {
    const shadow = { chunks: ["body"], comments: [], id: "row1", title: "(untitled)", tsIso: "", url: "u" };
    const row = {
      chunks: ["Status: Done"],
      comments: [],
      id: "row1",
      parent: "db1",
      title: "A task",
      tsIso: "",
      url: "u",
    };
    const result = reconcileRowBatch({
      alreadyConsumed: new Set(),
      pagesById: new Map([["row1", shadow]]),
      rows: [row],
    });
    expect(result.items.map((item) => item.id)).toEqual(["row1"]);
    expect(result.items[0]!.chunks).toEqual(["Status: Done", "body"]);
    expect(result.consumedIds).toEqual(["row1"]);
  });

  it("keeps a row standalone when nothing in pagesById matches", () => {
    const row = {
      chunks: ["Status: Done"],
      comments: [],
      id: "row1",
      parent: "db1",
      title: "A task",
      tsIso: "",
      url: "u",
    };
    const result = reconcileRowBatch({ alreadyConsumed: new Set(), pagesById: new Map(), rows: [row] });
    expect(result.items).toEqual([row]);
    expect(result.consumedIds).toEqual([]);
  });

  it("refuses to double-claim a page an earlier batch already consumed", () => {
    const shadow = { chunks: ["body"], comments: [], id: "row1", title: "(untitled)", tsIso: "", url: "u" };
    const row = {
      chunks: ["Status: Done"],
      comments: [],
      id: "row1",
      parent: "db1",
      title: "A task",
      tsIso: "",
      url: "u",
    };
    const result = reconcileRowBatch({
      alreadyConsumed: new Set(["row1"]),
      pagesById: new Map([["row1", shadow]]),
      rows: [row],
    });
    expect(result.items).toEqual([row]);
    expect(result.consumedIds).toEqual([]);
  });

  it("splits across multiple batches the same way reconcileRowDuplicates does in one shot", () => {
    const shadowA = { chunks: ["bodyA"], comments: [], id: "rowA", title: "(untitled)", tsIso: "", url: "u" };
    const rowA = { chunks: ["propsA"], comments: [], id: "rowA", parent: "db1", title: "A", tsIso: "", url: "u" };
    const rowB = { chunks: ["propsB"], comments: [], id: "rowB", parent: "db1", title: "B", tsIso: "", url: "u" };
    const pagesById = new Map([["rowA", shadowA]]);
    const consumed = new Set<string>();
    const batch1 = reconcileRowBatch({ alreadyConsumed: consumed, pagesById, rows: [rowA] });
    for (const id of batch1.consumedIds) {
      consumed.add(id);
    }
    const batch2 = reconcileRowBatch({ alreadyConsumed: consumed, pagesById, rows: [rowB] });
    const oneShot = reconcileRowDuplicates({ pages: [shadowA], rows: [rowA, rowB] });
    expect([...batch1.items, ...batch2.items]).toEqual(oneShot);
  });
});
