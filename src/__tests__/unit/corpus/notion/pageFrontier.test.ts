/**
 * The child-page frontier, driven through its real `pages.retrieve` door with a plain client object: which ids
 * it reads, which it fetches, and how the waves fold into one result.
 */
import { describe, expect, it } from "vitest";

import type { FetchBudget } from "../../../../corpus/notion/budget.js";
import type { GatedCall } from "../../../../corpus/notion/callDeadline.js";
import { createNotionCrawlMeter } from "../../../../corpus/notion/meter.js";
import { drainChildPages, type FetchOnePage } from "../../../../corpus/notion/pageFrontier.js";
import { EMPTY_NOTION_SEEN_INDEX, type NotionSeenIndex } from "../../../../corpus/notion/seenIndex.js";

const EDITED = "2026-01-01T00:00:00.000Z";
const call: GatedCall = (task) => task();

/** A page graph: each id's children, as the fake fetch reports them. An id absent here cannot be retrieved. */
const GRAPH: Readonly<Record<string, readonly string[]>> = {
  a: ["c", "pre", "b"],
  b: ["d"],
  c: ["a"],
  d: [],
  same: ["never-reached"],
};

/** A client whose `pages.retrieve` answers from {@link GRAPH} and refuses anything else with a 404. */
const clientOver = ({ retrieved }: { retrieved: string[] }) => ({
  pages: {
    retrieve: async ({ page_id }: { page_id: string }): Promise<Record<string, unknown>> => {
      retrieved.push(page_id);
      if (GRAPH[page_id] === undefined) {
        throw Object.assign(new Error("Could not find page"), { status: 404 });
      }
      return { id: page_id, last_edited_time: EDITED, object: "page" };
    },
  },
});

/** A fetch that turns each page into one item, one skip and one note, and reports its children. */
const fetchInto = ({ fetched }: { fetched: { id: string; lastEdited: string; raw: unknown }[] }): FetchOnePage => {
  return async ({ id, lastEdited, raw }) => {
    fetched.push({ id, lastEdited, raw });
    return {
      childPageIds: GRAPH[id]!,
      item: { chunks: [], comments: [], id, title: `title ${id}`, tsIso: lastEdited, url: `https://n.test/${id}` },
      notes: [`note ${id}`],
      skips: [{ operation: `op-${id}`, reason: "unknown", subject: "page" }],
    };
  };
};

/** A budget that records every spend and is exhausted once `cap` items have been taken. */
const budgetOf = ({ cap, spends }: { cap: number; spends: number[] }): FetchBudget => ({
  exhausted: () => spends.reduce((sum, items) => sum + items, 0) >= cap,
  spend: ({ items }) => {
    spends.push(items);
  },
});

/** Bronze already holds `same` at {@link EDITED}, and nothing else. */
const SEEN: NotionSeenIndex = {
  ...EMPTY_NOTION_SEEN_INDEX,
  isUnchanged: ({ id, lastEdited }) => id === "same" && lastEdited === EDITED,
};

describe("drainChildPages", () => {
  it("drains wave by wave, skipping visited, unreadable and unchanged pages, until no new id is left", async () => {
    const retrieved: string[] = [];
    const fetched: { id: string; lastEdited: string; raw: unknown }[] = [];
    const spends: number[] = [];
    const meter = createNotionCrawlMeter();
    const visited = new Set(["pre"]);
    const result = await drainChildPages({
      budget: budgetOf({ cap: 100, spends }),
      call,
      client: clientOver({ retrieved }),
      fetchPage: fetchInto({ fetched }),
      meter,
      scopeId: "test-scope",
      seedIds: ["a", "pre", "b", "gone", "same"],
      seen: SEEN,
      visited,
    });
    expect(result).toEqual({
      notes: ["note a", "note b", "note c", "note d"],
      pages: [
        { chunks: [], comments: [], id: "a", title: "title a", tsIso: EDITED, url: "https://n.test/a" },
        { chunks: [], comments: [], id: "b", title: "title b", tsIso: EDITED, url: "https://n.test/b" },
        { chunks: [], comments: [], id: "c", title: "title c", tsIso: EDITED, url: "https://n.test/c" },
        { chunks: [], comments: [], id: "d", title: "title d", tsIso: EDITED, url: "https://n.test/d" },
      ],
      skips: ["a", "b", "c", "d"].map((id) => ({ operation: `op-${id}`, reason: "unknown", subject: "page" })),
    });
    // Concurrency may interleave one wave's reads, so the read log is compared as a set; `pre` was never read.
    expect(retrieved.toSorted()).toEqual(["a", "b", "c", "d", "gone", "same"]);
    expect([...visited].toSorted()).toEqual(["a", "b", "c", "d", "gone", "pre", "same"]);
    expect(spends).toEqual([1, 1, 1, 1]);
    expect(meter.read()).toEqual({ calls: 0, skippedUnchanged: 1 });
    expect(meter.wasSkippedUnchanged({ id: "same" })).toBe(true);
    expect(fetched.find((one) => one.id === "a")).toEqual({
      id: "a",
      lastEdited: EDITED,
      raw: { id: "a", last_edited_time: EDITED, object: "page" },
    });
  });

  it("starts no wave once the budget is exhausted, and none at all when it already is", async () => {
    const retrieved: string[] = [];
    const spends: number[] = [];
    const result = await drainChildPages({
      budget: budgetOf({ cap: 1, spends }),
      call,
      client: clientOver({ retrieved }),
      fetchPage: fetchInto({ fetched: [] }),
      meter: createNotionCrawlMeter(),
      scopeId: "test-scope",
      seedIds: ["b"],
      seen: EMPTY_NOTION_SEEN_INDEX,
      visited: new Set(),
    });
    expect(result.pages.map((page) => page.id)).toEqual(["b"]);
    expect(retrieved).toEqual(["b"]);
    expect(spends).toEqual([1]);

    const none: string[] = [];
    const empty = await drainChildPages({
      budget: budgetOf({ cap: 0, spends: [] }),
      call,
      client: clientOver({ retrieved: none }),
      fetchPage: fetchInto({ fetched: [] }),
      meter: createNotionCrawlMeter(),
      scopeId: "test-scope",
      seedIds: ["a"],
      seen: EMPTY_NOTION_SEEN_INDEX,
      visited: new Set(),
    });
    expect(empty).toEqual({ notes: [], pages: [], skips: [] });
    expect(none).toEqual([]);
  });

  it("reads nothing when every seed was already visited", async () => {
    const retrieved: string[] = [];
    const result = await drainChildPages({
      budget: budgetOf({ cap: 100, spends: [] }),
      call,
      client: clientOver({ retrieved }),
      fetchPage: fetchInto({ fetched: [] }),
      meter: createNotionCrawlMeter(),
      scopeId: "test-scope",
      seedIds: ["a", "b"],
      seen: EMPTY_NOTION_SEEN_INDEX,
      visited: new Set(["a", "b"]),
    });
    expect(result).toEqual({ notes: [], pages: [], skips: [] });
    expect(retrieved).toEqual([]);
  });
});
