/*
 * `fetchNotionActivity` over an injected `NotionApi` seam: rows folded into pages, the `onBatch` durability
 * side-channel, streamed progress, `since` threading and paging to exhaustion, a fatal seam throw, and skips
 * carried rather than failing the run.
 */
import { describe, expect, it } from "vitest";
import { fetchNotionActivity, type NotionApi } from "../../../../../corpus/notion/fetch.js";
import { NotionFetchErrors } from "../../../../../corpus/notion/fetchErrors.js";
import type { SourceProgressEvent } from "../../../../../corpus/progress.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";

describe("fetchNotionActivity folds data-source rows into pages", () => {
  it("collects the databases lane's `rows` as page records", async () => {
    const api: NotionApi = {
      databases: async () => ({
        databases: [{ description: "", id: "db1", title: "Tasks", tsIso: "2026-05-01T00:00:00.000Z", url: "u" }],
        rows: [
          {
            chunks: ["Status: Done"],
            comments: [],
            id: "row1",
            parent: "db1",
            title: "A task",
            tsIso: "2026-05-01T00:00:00.000Z",
            url: "u",
          },
        ],
      }),
      pages: async () => ({ pages: [] }),
      users: async () => ({ results: [] }),
    };
    const result = unwrap(await fetchNotionActivity({ api, window: { since: "2026-01-01", until: "2026-06-01" } }));
    expect(result.databases.map((d) => d.id)).toEqual(["db1"]);
    expect(result.pages.map((p) => p.id)).toEqual(["row1"]); // the ROW is ingested, not just the summary
  });
});

describe("fetchNotionActivity onBatch (the durability side-channel)", () => {
  it("fires once per databases-lane search page with that page's records already projected", async () => {
    const api: NotionApi = {
      databases: async () => ({
        databases: [{ description: "", id: "db1", title: "Tasks", tsIso: "2026-05-01T00:00:00.000Z", url: "u" }],
        rows: [
          {
            chunks: ["Status: Done"],
            comments: [],
            id: "row1",
            title: "A task",
            tsIso: "2026-05-01T00:00:00.000Z",
            url: "u",
          },
        ],
      }),
      pages: async () => ({ pages: [] }),
      users: async () => ({ results: [] }),
    };
    const batches: number[] = [];
    await fetchNotionActivity({
      api,
      onBatch: ({ records }) => batches.push(records.length),
      window: { since: "2026-01-01", until: "2026-06-01" },
    });
    // 1 database record + 1 row record from the single search page the fake seam returns.
    expect(batches).toEqual([2]);
  });

  it("never fires when the caller doesn't ask for it", async () => {
    const api: NotionApi = {
      databases: async () => ({
        databases: [{ description: "", id: "db1", title: "Tasks", tsIso: "2026-05-01T00:00:00.000Z", url: "u" }],
        rows: [],
      }),
      pages: async () => ({ pages: [] }),
      users: async () => ({ results: [] }),
    };
    const result = unwrap(await fetchNotionActivity({ api, window: { since: "2026-01-01", until: "2026-06-01" } }));
    expect(result.databases.map((d) => d.id)).toEqual(["db1"]);
  });
});

describe("fetchNotionActivity streamed progress", () => {
  it("emits a first-item preview + a per-page heartbeat for pages and databases", async () => {
    const events: SourceProgressEvent[] = [];
    const api: NotionApi = {
      databases: async () => ({
        databases: [{ description: "", id: "db1", title: "Registry", tsIso: "2026-05-01T00:00:00.000Z", url: "u" }],
        rows: [],
      }),
      pages: async () => ({
        pages: [
          { chunks: ["hello"], comments: [], id: "pg1", title: "One", tsIso: "2026-05-01T00:00:00.000Z", url: "u" },
        ],
      }),
      users: async () => ({ results: [] }),
    };
    await fetchNotionActivity({
      api,
      onProgress: (e) => events.push(e),
      window: { since: "2026-01-01", until: "2026-06-01" },
    });
    const previews = events.filter((e) => e.lane === "content_preview");
    expect(previews.map((e) => e.preview!.subject)).toEqual(["One", "Registry"]);
    const pageBeat = events.findLast((e) => e.lane === "heartbeat" && e.phase === "pages");
    expect(pageBeat!.metrics!["pages"]).toBe(1);
    const dbBeat = events.findLast((e) => e.lane === "heartbeat" && e.phase === "databases");
    expect(dbBeat!.metrics!["databases"]).toBe(1);
  });
});

describe("fetchNotionActivity", () => {
  it("threads `since` to both lanes and aggregates page warnings", async () => {
    const seen: string[] = [];
    const api: NotionApi = {
      databases: async ({ since }) => {
        seen.push(`db:${since}`);
        return { databases: [], rows: [] };
      },
      pages: async ({ since }) => {
        seen.push(`pg:${since}`);
        return { pages: [], warnings: ["notion: comments for page pg1 failed: 403"] };
      },
      users: async () => ({ results: [] }),
    };
    const result = unwrap(await fetchNotionActivity({ api, window: { since: "2026-04-01", until: "2026-06-01" } }));
    expect(seen).toContain("pg:2026-04-01");
    expect(seen).toContain("db:2026-04-01");
    expect(result.warnings).toEqual(["notion: comments for page pg1 failed: 403"]);
  });

  it("pages both pages and databases to exhaustion via the injected seam", async () => {
    const api: NotionApi = {
      databases: async ({ cursor }) =>
        cursor === undefined
          ? {
              databases: [
                { description: "", id: "db1", title: "Registry", tsIso: "2026-05-01T00:00:00.000Z", url: "u" },
              ],
              nextCursor: "d2",
              rows: [],
            }
          : {
              databases: [
                { description: "", id: "db2", title: "Roadmap", tsIso: "2026-05-01T00:00:00.000Z", url: "u" },
              ],
              rows: [],
            },
      pages: async ({ cursor }) =>
        cursor === undefined
          ? {
              nextCursor: "p2",
              pages: [
                { chunks: ["a"], comments: [], id: "pg1", title: "One", tsIso: "2026-05-01T00:00:00.000Z", url: "u" },
              ],
            }
          : {
              pages: [
                { chunks: ["b"], comments: [], id: "pg2", title: "Two", tsIso: "2026-05-01T00:00:00.000Z", url: "u" },
              ],
            },
      users: async () => ({ results: [] }),
    };
    const result = unwrap(await fetchNotionActivity({ api, window: { since: "2026-01-01", until: "2026-06-01" } }));
    expect(result.pages.map((p) => p.id)).toEqual(["pg1", "pg2"]);
    expect(result.databases.map((d) => d.id)).toEqual(["db1", "db2"]);
  });

  it("is fatal when the seam throws", async () => {
    const api: NotionApi = {
      databases: async () => ({ databases: [], rows: [] }),
      pages: async () => {
        throw new Error("401 unauthorized");
      },
      users: async () => ({ results: [] }),
    };
    const result = await fetchNotionActivity({ api, window: { since: "2026-01-01", until: "2026-06-01" } });
    const error = unwrapErr(result);
    expect(error).toEqual(NotionFetchErrors.fetchFailed({ cause: new Error("401 unauthorized") }));
    expect(error.message).toBe("fetch failed: 401 unauthorized");
  });
});

describe("fetchNotionActivity carries skips rather than failing the run", () => {
  it("returns ok with the records it COULD read when a lane reports unreadable nodes", async () => {
    const api: NotionApi = {
      databases: async () => ({ databases: [], rows: [] }),
      pages: async () => ({
        pages: [
          { chunks: ["body"], comments: [], id: "pg1", title: "One", tsIso: "2026-05-01T00:00:00.000Z", url: "u" },
        ],
        skips: [{ operation: "notion.blocks.children.list", reason: "unshared", subject: "nested block" }],
      }),
      users: async () => ({ results: [] }),
    };
    const result = unwrap(await fetchNotionActivity({ api, window: { since: "2026-01-01", until: "2026-06-01" } }));
    expect(result.pages.map((p) => p.id)).toEqual(["pg1"]);
    expect(result.skips).toEqual([
      { operation: "notion.blocks.children.list", reason: "unshared", subject: "nested block" },
    ]);
  });

  it("aggregates skips from BOTH lanes and reports an empty list when everything was readable", async () => {
    const api: NotionApi = {
      databases: async () => ({
        databases: [],
        rows: [],
        skips: [{ operation: "notion.comments.list", reason: "restricted", subject: "page comments" }],
      }),
      pages: async () => ({
        pages: [],
        skips: [{ operation: "notion.blocks.children.list", reason: "rate-limit", subject: "page body" }],
      }),
      users: async () => ({ results: [] }),
    };
    const both = unwrap(await fetchNotionActivity({ api, window: { since: "2026-01-01", until: "2026-06-01" } }));
    expect(both.skips.map((s) => s.reason)).toEqual(["rate-limit", "restricted"]);

    const clean: NotionApi = {
      databases: async () => ({ databases: [], rows: [] }),
      pages: async () => ({ pages: [] }),
      users: async () => ({ results: [] }),
    };
    const none = unwrap(
      await fetchNotionActivity({ api: clean, window: { since: "2026-01-01", until: "2026-06-01" } }),
    );
    expect(none.skips).toEqual([]);
  });

  it("counts unreadable nodes on the heartbeat, so a partial crawl is visible while it runs", async () => {
    const events: SourceProgressEvent[] = [];
    const api: NotionApi = {
      databases: async () => ({ databases: [], rows: [] }),
      pages: async () => ({
        pages: [{ chunks: ["b"], comments: [], id: "pg1", title: "One", tsIso: "2026-05-01T00:00:00.000Z", url: "u" }],
        skips: [
          { operation: "notion.blocks.children.list", reason: "unshared", subject: "nested block" },
          { operation: "notion.blocks.children.list", reason: "depth-cap", subject: "nested block" },
        ],
      }),
      users: async () => ({ results: [] }),
    };
    await fetchNotionActivity({
      api,
      onProgress: (e) => events.push(e),
      window: { since: "2026-01-01", until: "2026-06-01" },
    });
    const beat = events.findLast((e) => e.lane === "heartbeat" && e.phase === "pages");
    expect(beat!.metrics!["unreadable"]).toBe(2);
  });
});
