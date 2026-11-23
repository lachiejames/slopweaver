import { describe, expect, it } from "vitest";
import {
  fetchNotionActivity,
  isDataSourceRowShadow,
  mergeDuplicateRowPage,
  type NotionApi,
} from "../../../../corpus/notion/fetch.js";
import type { NotionPageItem } from "../../../../corpus/notion/project.js";
import type { CorpusRecord } from "../../../../corpus/types.js";
import { unwrap } from "../../../../lib/result.js";

const WINDOW = { since: "2026-01-01", until: "2026-06-01" };

const page = ({ id, parentType }: { id: string; parentType?: string }): NotionPageItem => ({
  chunks: ["body"],
  comments: [],
  id,
  raw: parentType === undefined ? { id } : { id, parent: { type: parentType } },
  title: id,
  tsIso: "2026-05-01T00:00:00.000Z",
  url: "u",
});

describe("isDataSourceRowShadow", () => {
  it("is true for a page whose parent is a data source", () => {
    expect(isDataSourceRowShadow({ page: page({ id: "row1", parentType: "data_source_id" }) })).toBe(true);
  });

  it("is true for a page whose parent is still described as a database", () => {
    expect(isDataSourceRowShadow({ page: page({ id: "row1", parentType: "database_id" }) })).toBe(true);
  });

  it("is false for a page parented by another page", () => {
    expect(isDataSourceRowShadow({ page: page({ id: "p1", parentType: "page_id" }) })).toBe(false);
  });

  it("is false for a page with no raw parent at all", () => {
    expect(isDataSourceRowShadow({ page: page({ id: "p1" }) })).toBe(false);
  });
});

describe("fetchNotionActivity flushes the PAGES lane too", () => {
  const collectBatches = async ({ api }: { api: NotionApi }): Promise<readonly (readonly CorpusRecord[])[]> => {
    const batches: (readonly CorpusRecord[])[] = [];
    unwrap(await fetchNotionActivity({ api, onBatch: ({ records }) => batches.push(records), window: WINDOW }));
    return batches;
  };

  it("fires once per pages-lane search page, so a kill mid-pages-lane loses one page not the run", async () => {
    let served = 0;
    const api: NotionApi = {
      databases: async () => ({ databases: [], rows: [] }),
      pages: async () => {
        served += 1;
        return served === 1 ? { nextCursor: "c2", pages: [page({ id: "p1" })] } : { pages: [page({ id: "p2" })] };
      },
      users: async () => ({ results: [] }),
    };
    // The trailing empty batch is the databases lane's own (unchanged) checkpoint over an empty page.
    const batches = await collectBatches({ api });
    expect(batches.map((batch) => batch.map((record) => record.sourceId))).toEqual([["page:p1"], ["page:p2"], []]);
  });

  it("HOLDS BACK a database-row shadow, so the row's merged form is the only version written", async () => {
    const api: NotionApi = {
      databases: async () => ({
        databases: [],
        rows: [{ ...page({ id: "row1", parentType: "data_source_id" }), chunks: ["Status: Done"], parent: "db1" }],
      }),
      pages: async () => ({ pages: [page({ id: "p1" }), page({ id: "row1", parentType: "data_source_id" })] }),
      users: async () => ({ results: [] }),
    };
    const batches = await collectBatches({ api });
    expect(batches[0]!.map((record) => record.sourceId)).toEqual(["page:p1"]);
    expect(batches[1]!.map((record) => record.sourceId)).toEqual(["page:row1:chunk:0", "page:row1:chunk:1"]);
    expect(batches[1]!.map((record) => record.text)).toEqual(["Status: Done", "body"]);
  });

  it("emits no batch for a search page that yielded only row shadows", async () => {
    const api: NotionApi = {
      databases: async () => ({ databases: [], rows: [] }),
      pages: async () => ({ pages: [page({ id: "row1", parentType: "data_source_id" })] }),
      users: async () => ({ results: [] }),
    };
    // One batch, from the databases lane's own checkpoint — and it is EMPTY: the shadow was held back.
    expect(await collectBatches({ api })).toEqual([[]]);
  });
});

describe("mergeDuplicateRowPage carries truncation across the merge", () => {
  const row = (over: Partial<NotionPageItem>): NotionPageItem => ({
    chunks: ["Status: Done"],
    comments: [],
    id: "row1",
    parent: "db1",
    title: "A task",
    tsIso: "2026-05-01T00:00:00.000Z",
    url: "u",
    ...over,
  });

  it("marks the merged item partial when only the PAGE lane's block tree was truncated", () => {
    const merged = mergeDuplicateRowPage({
      page: { ...page({ id: "row1" }), partial: true },
      row: row({}),
    });
    expect(merged.partial).toBe(true);
  });

  it("marks the merged item partial when only the ROW's own crawl was cut short", () => {
    const merged = mergeDuplicateRowPage({ page: page({ id: "row1" }), row: row({ partial: true }) });
    expect(merged.partial).toBe(true);
  });

  it("leaves a merge of two complete captures at the SAME timestamp unmarked", () => {
    const merged = mergeDuplicateRowPage({ page: page({ id: "row1" }), row: row({}) });
    expect(merged.partial).toBe(undefined);
  });

  it("marks the merge partial when the lanes read DIFFERENT versions of the same object", () => {
    // The pages lane finished hours before the databases lane, and the row was edited in between: the
    // record would otherwise carry the newer identity over the older body, and look complete doing it.
    const merged = mergeDuplicateRowPage({
      page: { ...page({ id: "row1" }), tsIso: "2026-05-01T00:00:00.000Z" },
      row: row({ tsIso: "2026-05-04T00:00:00.000Z" }),
    });
    expect(merged.partial).toBe(true);
    expect(merged.tsIso).toBe("2026-05-04T00:00:00.000Z");
  });
});
