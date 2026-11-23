/**
 * The page-READ half of the attach pass: the bounded walk, and the already-inserted witness.
 */
import { describe, expect, it } from "vitest";
import { alreadyInserted, readBlocks } from "../../../../../cli/commands/notion/mediaPageRead.js";
import type { NotionMediaApi, PageBlock } from "../../../../../corpus/notion/mediaApi.js";
import type { NotionApiError } from "../../../../../corpus/notion/writeErrors.js";
import { ok, type Result } from "../../../../../lib/result.js";
import type { MarkerCandidate } from "../../../../../outbound/notion/mediaPlaceholder.js";

const PAGE = "page-1";

const block = (over: Partial<PageBlock> & { id: string }): PageBlock => ({
  hasChildren: false,
  parentId: PAGE,
  text: "",
  type: "paragraph",
  ...over,
});

/** A fake seam whose children are a plain map — a passed-in function, not a mock. */
function fakeApi({ children }: { children: Readonly<Record<string, readonly PageBlock[]>> }): NotionMediaApi {
  return {
    deleteBlock: (): Promise<Result<undefined, NotionApiError>> => Promise.resolve(ok(undefined)),
    insertMediaAfter: (): Promise<Result<string, NotionApiError>> => Promise.resolve(ok("new")),
    listChildren: ({
      parentId,
    }): Promise<
      Result<{ readonly blocks: readonly PageBlock[]; readonly nextCursor: string | undefined }, NotionApiError>
    > => {
      const found = children[parentId];
      if (found === undefined) {
        return Promise.resolve(ok({ blocks: [], nextCursor: undefined }));
      }
      return Promise.resolve(ok({ blocks: found, nextCursor: undefined }));
    },
    uploadFile: (): Promise<Result<string, NotionApiError>> => Promise.resolve(ok("upload")),
  };
}

/** The blocks of a read that succeeded — throws rather than putting a branch inside an assertion. */
function blocksOf({ read }: { read: Awaited<ReturnType<typeof readBlocks>> }): readonly MarkerCandidate[] {
  if (!("blocks" in read)) {
    throw new Error(`readBlocks failed: ${read.error}`);
  }
  return read.blocks;
}

describe("readBlocks", () => {
  it("descends into a block that has children, because a placeholder can sit inside a toggle", async () => {
    const api = fakeApi({
      children: {
        [PAGE]: [block({ hasChildren: true, id: "toggle", type: "toggle" })],
        toggle: [block({ id: "inside", parentId: "toggle", text: "[slopweaver-image:abc]" })],
      },
    });
    const read = await readBlocks({ api, pageId: PAGE });
    expect(blocksOf({ read }).map((found) => found.id)).toEqual(["toggle", "inside"]);
  });

  it("carries each block's TYPE, which is what tells an already-inserted marker from a never-attached one", async () => {
    const api = fakeApi({ children: { [PAGE]: [block({ id: "the-pdf", type: "pdf" })] } });
    const read = await readBlocks({ api, pageId: PAGE });
    expect(blocksOf({ read }).map((found) => found.type)).toEqual(["pdf"]);
  });
});

describe("alreadyInserted", () => {
  const marker = { blockId: "marker", parentId: PAGE };

  it("says yes when the marker's next sibling is a media block", () => {
    const blocks = [block({ id: "marker" }), block({ id: "the-pdf", type: "pdf" })];
    expect(alreadyInserted({ blocks, marker })).toBe(true);
  });

  it("says no when the marker is the last block on the page", () => {
    expect(alreadyInserted({ blocks: [block({ id: "marker" })], marker })).toBe(false);
  });

  it("says no when the block after the marker is ordinary prose", () => {
    const blocks = [block({ id: "marker" }), block({ id: "prose", text: "and so on" })];
    expect(alreadyInserted({ blocks, marker })).toBe(false);
  });

  it("says no when the media block that follows belongs to a DIFFERENT parent", () => {
    const blocks = [block({ id: "marker" }), block({ id: "elsewhere", parentId: "toggle", type: "pdf" })];
    expect(alreadyInserted({ blocks, marker })).toBe(false);
  });

  it("says no when the marker is not on the page at all", () => {
    const blocks = [block({ id: "the-pdf", type: "pdf" })];
    expect(alreadyInserted({ blocks, marker })).toBe(false);
  });
});
