/**
 * The nested-block expansion behind `notion read`, driven over a RECORDED page and plain fakes.
 *
 * `fixtures/notion/nestedPage.json` is every raw `blocks.children.list` answer under a disposable page made
 * for this — a toggle heading, a toggle two deep, columns, a callout and a quote with children,
 * a table, a synced DUPLICATE and a child page — keyed by the id that was listed. It carries the measured
 * synced-block fact too: the duplicate's own id answered `[]`, and its original's id answered the content.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import type { NotionNamedBlockPage, NotionNamedReadApi } from "../../../../corpus/notion/liveApi.js";
import type { IngestError } from "../../../../lib/ingestError.js";
import { err, ok, type Result, unwrap, unwrapErr } from "../../../../lib/result.js";
import { flattenBlockTree, type NotionBlockNode } from "../../../../live/notion/blockShape.js";
import { expandNotionBlocks } from "../../../../live/notion/blockTree.js";

interface RecordedPage {
  readonly pageId: string;
  readonly listings: Readonly<Record<string, readonly unknown[]>>;
}

const RECORDED: RecordedPage = JSON.parse(
  readFileSync(join(import.meta.dirname, "../../../fixtures/notion/nestedPage.json"), "utf8"),
) as RecordedPage;

type Answer = Result<NotionNamedBlockPage, IngestError>;

/** A seam answering from a per-id list of pages, keyed by the cursor each was asked with; it counts calls. */
function fakeApi({ pages }: { pages: Readonly<Record<string, readonly Answer[]>> }): {
  api: NotionNamedReadApi;
  calls: string[];
} {
  const calls: string[] = [];
  return {
    api: {
      listBlockChildren: ({ id, after }) => {
        calls.push(`${id}@${String(after)}`);
        const index = after === undefined ? 0 : Number(after.replace("cursor-", ""));
        return Promise.resolve(pages[id]![index]!);
      },
      retrieveDatabase: () => Promise.resolve(ok({})),
      retrievePage: () => Promise.resolve(ok({})),
    },
    calls,
  };
}

/** The recorded page's listings as one-page answers. */
function recordedPages(): Record<string, readonly Answer[]> {
  return Object.fromEntries(
    Object.entries(RECORDED.listings).map(([id, results]) => [
      id,
      [ok({ hasMore: false, nextCursor: undefined, results })],
    ]),
  );
}

/** One node's shape as `type:expansion` with its children, so a tree assertion reads like the page. */
interface Shape {
  readonly node: string;
  readonly children: readonly Shape[];
}

function shapeOf({ tree }: { tree: readonly NotionBlockNode[] }): readonly Shape[] {
  return tree.map((node) => ({
    children: shapeOf({ tree: node.children }),
    node: `${(node.block as { type: string }).type}:${node.expansion}`,
  }));
}

function block({ id, type, hasChildren }: { id: string; type: string; hasChildren: boolean }): unknown {
  return { has_children: hasChildren, id, object: "block", type };
}

function page({ results, next }: { results: readonly unknown[]; next?: string }): Answer {
  return ok({ hasMore: next !== undefined, nextCursor: next, results });
}

const unshared: IngestError = {
  code: "object_not_found",
  kind: "http",
  message: "Could not find block",
  operation: "notion.blocks.children.namedObjectRead",
  provider: "notion",
  status: 404,
};

const BOUNDS = { maxCalls: 400, maxMs: 300_000, nowMs: () => 0 };

describe("expandNotionBlocks over the recorded nested page", () => {
  it("expands every container a reader sees, and names the child page rather than reading it", async () => {
    const { api, calls } = fakeApi({ pages: recordedPages() });
    const expanded = unwrap(await expandNotionBlocks({ api, blocks: RECORDED.listings[RECORDED.pageId]!, ...BOUNDS }));

    expect(shapeOf({ tree: expanded.tree })).toEqual([
      { children: [], node: "paragraph:leaf" },
      { children: [{ children: [], node: "paragraph:leaf" }], node: "heading_2:complete" },
      {
        children: [
          { children: [], node: "paragraph:leaf" },
          { children: [{ children: [], node: "paragraph:leaf" }], node: "toggle:complete" },
        ],
        node: "toggle:complete",
      },
      {
        children: [
          { children: [{ children: [], node: "paragraph:leaf" }], node: "column:complete" },
          { children: [{ children: [], node: "paragraph:leaf" }], node: "column:complete" },
        ],
        node: "column_list:complete",
      },
      { children: [{ children: [], node: "paragraph:leaf" }], node: "callout:complete" },
      { children: [{ children: [], node: "paragraph:leaf" }], node: "quote:complete" },
      {
        children: [
          { children: [], node: "table_row:leaf" },
          { children: [], node: "table_row:leaf" },
        ],
        node: "table:complete",
      },
      { children: [{ children: [], node: "paragraph:leaf" }], node: "synced_block:complete" },
      { children: [], node: "child_page:linked-object" },
    ]);
    expect(expanded.nested).toEqual({
      calls: 10,
      callLimit: 400,
      complete: true,
      linkedObjects: [
        {
          id: "3f400000-0000-81f4-a636-fd87704d2894",
          kind: "page",
          title: "Fixture child page",
          url: "https://www.notion.so/3f400000000081f4a636fd87704d2894",
        },
      ],
      stoppedBy: null,
      unexpanded: [],
    });
    expect(calls).toHaveLength(10);
  });

  it("lists a synced duplicate through its original, because its own id answers an empty list", async () => {
    const { api, calls } = fakeApi({ pages: recordedPages() });
    const expanded = unwrap(await expandNotionBlocks({ api, blocks: RECORDED.listings[RECORDED.pageId]!, ...BOUNDS }));
    const synced = expanded.tree[7]!;
    const child = synced.children[0]!.block as { paragraph: { rich_text: { plain_text: string }[] } };

    expect(RECORDED.listings["c4735481-57dd-47b7-9a39-6306870f514e"]).toEqual([]);
    expect(child.paragraph.rich_text[0]!.plain_text).toBe("synced original line");
    expect(calls).toContain("7597f82e-35cf-4810-a7af-1d8f6af0160c@undefined");
    expect(calls).not.toContain("c4735481-57dd-47b7-9a39-6306870f514e@undefined");
  });

  it("flattens the tree parent-first so the file opener sees nested blocks", async () => {
    const { api } = fakeApi({ pages: recordedPages() });
    const expanded = unwrap(await expandNotionBlocks({ api, blocks: RECORDED.listings[RECORDED.pageId]!, ...BOUNDS }));
    const types = flattenBlockTree({ tree: expanded.tree }).map((raw) => (raw as { type: string }).type);

    expect(types.slice(0, 7)).toEqual([
      "paragraph",
      "heading_2",
      "paragraph",
      "toggle",
      "paragraph",
      "toggle",
      "paragraph",
    ]);
    expect(types).toHaveLength(22);
  });
});

describe("expandNotionBlocks paging and gaps", () => {
  const toggle = block({ hasChildren: true, id: "t1", type: "toggle" });

  it("pages a child list past 100 to its end", async () => {
    const first = Array.from({ length: 100 }, (_, n) =>
      block({ hasChildren: false, id: `a${String(n)}`, type: "paragraph" }),
    );
    const second = Array.from({ length: 50 }, (_, n) =>
      block({ hasChildren: false, id: `b${String(n)}`, type: "paragraph" }),
    );
    const { api, calls } = fakeApi({
      pages: { t1: [page({ next: "cursor-1", results: first }), page({ results: second })] },
    });
    const expanded = unwrap(await expandNotionBlocks({ api, blocks: [toggle], ...BOUNDS }));

    expect(expanded.tree[0]!.children).toHaveLength(150);
    expect(expanded.tree[0]!.expansion).toBe("complete");
    expect(calls).toEqual(["t1@undefined", "t1@cursor-1"]);
  });

  it("keeps what it read and says so when more is promised with no cursor", async () => {
    const kept = block({ hasChildren: false, id: "p1", type: "paragraph" });
    const { api } = fakeApi({ pages: { t1: [ok({ hasMore: true, nextCursor: undefined, results: [kept] })] } });
    const expanded = unwrap(await expandNotionBlocks({ api, blocks: [toggle], ...BOUNDS }));

    expect(expanded.tree[0]!.children).toHaveLength(1);
    expect(expanded.nested.complete).toBe(false);
    expect(expanded.nested.unexpanded).toEqual([
      {
        expansion: "inconsistent",
        id: "t1",
        reason: "Notion reported more children but gave no new cursor to reach them",
        type: "toggle",
      },
    ]);
  });

  it("stops on a repeated cursor instead of re-reading the same page", async () => {
    const { api, calls } = fakeApi({
      pages: { t1: [page({ next: "cursor-1", results: [] }), page({ next: "cursor-1", results: [] })] },
    });
    const expanded = unwrap(await expandNotionBlocks({ api, blocks: [toggle], ...BOUNDS }));

    expect(expanded.tree[0]!.expansion).toBe("inconsistent");
    expect(calls).toEqual(["t1@undefined", "t1@cursor-1"]);
  });

  it("names a block it cannot see, keeps its first page, and still expands its sibling", async () => {
    const sibling = block({ hasChildren: true, id: "t2", type: "toggle" });
    const kept = block({ hasChildren: false, id: "p1", type: "paragraph" });
    const { api } = fakeApi({
      pages: {
        t1: [page({ next: "cursor-1", results: [kept] }), err(unshared)],
        t2: [page({ results: [kept] })],
      },
    });
    const expanded = unwrap(await expandNotionBlocks({ api, blocks: [toggle, sibling], ...BOUNDS }));

    expect(shapeOf({ tree: expanded.tree })).toEqual([
      { children: [{ children: [], node: "paragraph:leaf" }], node: "toggle:unreadable" },
      { children: [{ children: [], node: "paragraph:leaf" }], node: "toggle:complete" },
    ]);
    expect(expanded.nested.unexpanded[0]!.reason).toBe("unshared: Could not find block");
  });

  it("fails the whole read on a rejected token rather than returning a partial page", async () => {
    const rejected: IngestError = { ...unshared, code: "unauthorized", message: "API token is invalid.", status: 401 };
    const { api } = fakeApi({ pages: { t1: [err(rejected)] } });

    expect(unwrapErr(await expandNotionBlocks({ api, blocks: [toggle], ...BOUNDS })).message).toBe(
      "API token is invalid.",
    );
  });

  it("spends the call ceiling breadth first, so every section opens before any grandchild", async () => {
    const inner = block({ hasChildren: true, id: "inner", type: "toggle" });
    const sibling = block({ hasChildren: true, id: "t2", type: "toggle" });
    const { api } = fakeApi({ pages: { t1: [page({ results: [inner] })], t2: [page({ results: [] })] } });
    const expanded = unwrap(
      await expandNotionBlocks({ api, blocks: [toggle, sibling], maxCalls: 2, maxMs: 300_000, nowMs: () => 0 }),
    );

    expect(shapeOf({ tree: expanded.tree })).toEqual([
      { children: [{ children: [], node: "toggle:budget" }], node: "toggle:complete" },
      { children: [], node: "toggle:complete" },
    ]);
    expect(expanded.nested.stoppedBy).toBe("calls");
    expect(expanded.nested.calls).toBe(2);
  });

  it("reads a sibling's first page before a wide block's second, so a long list cannot starve a section", async () => {
    const sibling = block({ hasChildren: true, id: "t2", type: "toggle" });
    const kept = block({ hasChildren: false, id: "p1", type: "paragraph" });
    const { api, calls } = fakeApi({
      pages: {
        t1: [page({ next: "cursor-1", results: [kept] }), page({ next: "cursor-2", results: [kept] })],
        t2: [page({ results: [kept] })],
      },
    });
    const expanded = unwrap(
      await expandNotionBlocks({ api, blocks: [toggle, sibling], maxCalls: 2, maxMs: 300_000, nowMs: () => 0 }),
    );

    expect(calls).toEqual(["t1@undefined", "t2@undefined"]);
    expect(shapeOf({ tree: expanded.tree })).toEqual([
      { children: [{ children: [], node: "paragraph:leaf" }], node: "toggle:budget" },
      { children: [{ children: [], node: "paragraph:leaf" }], node: "toggle:complete" },
    ]);
  });

  it("starts no call past the time limit, lets the one in flight finish, and says which bound ended it", async () => {
    let now = 0;
    const { api } = fakeApi({
      pages: {
        t1: [page({ results: [] })],
      },
    });
    const slowApi: NotionNamedReadApi = {
      ...api,
      listBlockChildren: (args) => {
        now += 400_000;
        return api.listBlockChildren(args);
      },
    };
    const sibling = block({ hasChildren: true, id: "t2", type: "toggle" });
    const expanded = unwrap(
      await expandNotionBlocks({
        api: slowApi,
        blocks: [toggle, sibling],
        maxCalls: 400,
        maxMs: 300_000,
        nowMs: () => now,
      }),
    );

    expect(shapeOf({ tree: expanded.tree })).toEqual([
      { children: [], node: "toggle:complete" },
      { children: [], node: "toggle:budget" },
    ]);
    expect(expanded.nested.stoppedBy).toBe("time");
  });

  it("keeps a time stop once taken, even when the clock then steps backward", async () => {
    const clock = [0, 300_000, 0, 0, 0];
    const { api, calls } = fakeApi({ pages: { b: [page({ results: [] })] } });
    const expanded = unwrap(
      await expandNotionBlocks({
        api,
        blocks: ["a", "b", "c"].map((id) => block({ hasChildren: true, id, type: "toggle" })),
        maxCalls: 1,
        maxMs: 300_000,
        nowMs: () => clock.shift()!,
      }),
    );

    expect(calls).toEqual([]);
    expect(expanded.nested.stoppedBy).toBe("time");
  });

  it("lists one original once however many duplicates point at it", async () => {
    const duplicate = ({ id }: { id: string }): unknown => ({
      has_children: true,
      id,
      synced_block: { synced_from: { block_id: "orig", type: "block_id" } },
      type: "synced_block",
    });
    const { api, calls } = fakeApi({
      pages: { orig: [page({ results: [block({ hasChildren: false, id: "p", type: "paragraph" })] })] },
    });
    const expanded = unwrap(
      await expandNotionBlocks({ api, blocks: [duplicate({ id: "d1" }), duplicate({ id: "d2" })], ...BOUNDS }),
    );

    expect(shapeOf({ tree: expanded.tree })).toEqual([
      { children: [{ children: [], node: "paragraph:leaf" }], node: "synced_block:complete" },
      { children: [{ children: [], node: "paragraph:leaf" }], node: "synced_block:complete" },
    ]);
    expect(calls).toEqual(["orig@undefined"]);
  });

  it("refuses to descend a synced reference back into its own ancestry", async () => {
    const loop = {
      has_children: true,
      id: "d2",
      synced_block: { synced_from: { block_id: "orig" } },
      type: "synced_block",
    };
    const outer = {
      has_children: true,
      id: "d1",
      synced_block: { synced_from: { block_id: "orig" } },
      type: "synced_block",
    };
    const { api } = fakeApi({ pages: { orig: [page({ results: [loop] })] } });
    const expanded = unwrap(await expandNotionBlocks({ api, blocks: [outer], ...BOUNDS }));

    expect(shapeOf({ tree: expanded.tree })).toEqual([
      { children: [{ children: [], node: "synced_block:cycle" }], node: "synced_block:complete" },
    ]);
    expect(expanded.nested.complete).toBe(false);
  });

  it("names a block claiming children with no id instead of skipping it", async () => {
    const { api, calls } = fakeApi({ pages: {} });
    const expanded = unwrap(
      await expandNotionBlocks({ api, blocks: [{ has_children: true, type: "toggle" }], ...BOUNDS }),
    );

    expect(expanded.nested.unexpanded).toEqual([
      {
        expansion: "unreadable",
        id: "(no id)",
        reason: "the block is not an object carrying an id, so its children cannot be listed",
        type: "toggle",
      },
    ]);
    expect(calls).toEqual([]);
  });
});
