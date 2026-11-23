/*
 * The block render, driven through its real `blocks.children.list` door with a plain client object: no network,
 * and every fixture synthetic.
 */
import type { Client } from "@notionhq/client";
import { describe, expect, it } from "vitest";

import type { GatedCall } from "../../../../corpus/notion/callDeadline.js";
import { createNotionItemBudget } from "../../../../corpus/notion/itemCrawl.js";
import { renderBlocks } from "../../../../corpus/notion/liveBlocks.js";

const call: GatedCall = (task) => task();

/** A paragraph block reading `text`, optionally carrying children under `id`. */
const paragraph = ({ text, childId }: { text: string; childId?: string }): Record<string, unknown> => ({
  has_children: childId !== undefined,
  ...(childId !== undefined ? { id: childId } : {}),
  paragraph: { rich_text: [{ plain_text: text }] },
  type: "paragraph",
});

/** One listing page: the blocks it returns and the cursor to the next page, if there is one. */
interface ListedPage {
  readonly results: readonly unknown[];
  readonly next_cursor: string | null;
}

/**
 * A client answering from a map of `<blockId>` or `<blockId>:<cursor>` to a page, recording every listing it serves.
 * A key holding an HTTP status number refuses that listing with that status.
 */
const clientOver = ({ pages, listed }: { pages: Record<string, ListedPage | number>; listed: string[] }): Client => {
  const list = async (args: { block_id: string; start_cursor?: string }): Promise<ListedPage> => {
    const key = args.start_cursor === undefined ? args.block_id : `${args.block_id}:${args.start_cursor}`;
    listed.push(key);
    const page = pages[key]!;
    if (typeof page === "number") {
      throw Object.assign(new Error("refused"), { status: page });
    }
    return page;
  };
  return { blocks: { children: { list } } } as unknown as Client;
};

describe("renderBlocks", () => {
  it("joins a page's blocks across listing pages and recurses into a block's children", async () => {
    const listed: string[] = [];
    const client = clientOver({
      listed,
      pages: {
        "child-1": { next_cursor: null, results: [paragraph({ text: "nested" })] },
        "page-1": { next_cursor: "cur-2", results: [paragraph({ childId: "child-1", text: "first" })] },
        "page-1:cur-2": { next_cursor: null, results: [paragraph({ text: "second" }), "not-a-block"] },
      },
    });

    const rendered = await renderBlocks({
      blockId: "page-1",
      call,
      client,
      depth: 0,
      itemBudget: createNotionItemBudget(),
      scopeId: "scope",
    });

    expect(rendered.text).toBe("first\n\nnested\n\nsecond");
    expect(rendered.skips).toEqual([]);
    expect(listed).toEqual(["page-1", "child-1", "page-1:cur-2"]);
  });

  it("names a skip and spends no call on a descent past the depth cap", async () => {
    const listed: string[] = [];

    const rendered = await renderBlocks({
      blockId: "page-1",
      call,
      client: clientOver({ listed, pages: {} }),
      depth: 2,
      itemBudget: createNotionItemBudget(),
      maxDepth: 1,
      scopeId: "scope",
    });

    expect(rendered.text).toBe("");
    expect(rendered.skips).toEqual([
      { operation: "notion.blocks.children.list", reason: "depth-cap", subject: "nested block" },
    ]);
    expect(listed).toEqual([]);
  });

  it("keeps what it rendered and names the skip when a nested block is unshared", async () => {
    const rendered = await renderBlocks({
      blockId: "page-1",
      call,
      client: clientOver({
        listed: [],
        pages: {
          "child-1": 404,
          "page-1": { next_cursor: null, results: [paragraph({ childId: "child-1", text: "kept" })] },
        },
      }),
      depth: 0,
      itemBudget: createNotionItemBudget(),
      scopeId: "scope",
    });

    expect(rendered.text).toBe("kept");
    expect(rendered.skips).toEqual([
      { operation: "notion.blocks.children.list", reason: "unshared", subject: "nested block" },
    ]);
  });

  it("aborts the run on a rejected token rather than skipping the page", async () => {
    const rendering = renderBlocks({
      blockId: "page-1",
      call,
      client: clientOver({ listed: [], pages: { "page-1": 401 } }),
      depth: 0,
      itemBudget: createNotionItemBudget(),
      scopeId: "scope",
    });

    await expect(rendering).rejects.toThrow("refused");
  });

  it("stops at a spent request budget, naming the bound and keeping the earlier text", async () => {
    const listed: string[] = [];

    const rendered = await renderBlocks({
      blockId: "page-1",
      call,
      client: clientOver({
        listed,
        pages: { "page-1": { next_cursor: "cur-2", results: [paragraph({ text: "kept" })] } },
      }),
      depth: 0,
      itemBudget: createNotionItemBudget({ maxCalls: 1 }),
      scopeId: "scope",
    });

    expect(rendered.text).toBe("kept");
    expect(rendered.skips).toEqual([
      { operation: "notion.blocks.children.list", reason: "item-deadline", subject: "page body" },
    ]);
    expect(listed).toEqual(["page-1"]);
  });
});
