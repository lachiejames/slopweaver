/**
 * One page's attachment pass, driven through its real `blocks.children.list` door with a plain client object and
 * the injected transport and store — no network, no filesystem.
 */
import type { Client } from "@notionhq/client";
import { describe, expect, it } from "vitest";

import type { AttachmentTransport } from "../../../../corpus/notion/attachmentFetch.js";
import type { GatedCall } from "../../../../corpus/notion/callDeadline.js";
import { createNotionItemBudget } from "../../../../corpus/notion/itemCrawl.js";
import { attachmentRef, fetchPageAttachments } from "../../../../corpus/notion/pageAttachments.js";

const call: GatedCall = (task) => task();
const HOST = "https://prod-files-secure.s3.us-west-2.amazonaws.com";
const SMALL = `${HOST}/small.png?X-Amz-Signature=s`;
const BIG = `${HOST}/big.pdf?X-Amz-Signature=b`;
const FORBIDDEN = `${HOST}/forbidden.pdf?X-Amz-Signature=f`;

/** A Notion-hosted file block of one type, carrying a signed url. */
const hosted = ({ type, url }: { type: string; url: string }): Record<string, unknown> => ({
  type,
  [type]: { file: { expiry_time: "2026-01-01T01:00:00.000Z", url }, type: "file" },
});

/** First listing page: one hosted file, then four blocks the pass must pass over. */
const FIRST_PAGE = {
  next_cursor: "cur-2",
  results: [
    hosted({ type: "image", url: SMALL }),
    hosted({ type: "file", url: "https://example.com/linked.pdf" }),
    { image: { external: { url: "https://example.com/pic.png" }, type: "external" }, type: "image" },
    { paragraph: { rich_text: [] }, type: "paragraph" },
    "not-a-block",
  ],
};
/** Second listing page: a file over the ceiling and one whose probe is refused. */
const SECOND_PAGE = {
  next_cursor: null,
  results: [hosted({ type: "pdf", url: BIG }), hosted({ type: "pdf", url: FORBIDDEN })],
};

/** What one listing call was asked for — the SDK's own parameter type, so the fake fits the real client's slot. */
type ListArgs = Parameters<Client["blocks"]["children"]["list"]>[0];
/** The listing method the pass's client slot declares, so the fake inherits its parameter type. */
type ListBlocks = Parameters<typeof fetchPageAttachments>[0]["client"]["blocks"]["children"]["list"];

/** A client that answers the first listing, then the second, or refuses every listing with a 404. */
const clientOver = ({ listed, refuse }: { listed: ListArgs[]; refuse: boolean }) => {
  const list: ListBlocks = async (args) => {
    listed.push(args);
    if (refuse) {
      throw Object.assign(new Error("Could not find block"), { status: 404 });
    }
    return args.start_cursor === "cur-2" ? SECOND_PAGE : FIRST_PAGE;
  };
  return { blocks: { children: { list } } };
};

/** A transport that sizes and serves the small file, sizes the big one over the ceiling, and refuses the third. */
const transportInto = ({
  asked,
}: {
  asked: { url: string; rangeBytes: number | undefined }[];
}): AttachmentTransport => {
  return async ({ url, rangeBytes }) => {
    asked.push({ rangeBytes, url });
    if (url === FORBIDDEN) {
      return { contentRange: null, contentType: null, ok: false, status: 403 };
    }
    const total = url === BIG ? 5000 : 500;
    if (rangeBytes !== undefined) {
      return { contentRange: `bytes 0-1023/${String(total)}`, contentType: "image/png", ok: true, status: 206 };
    }
    return { body: Buffer.alloc(total), contentRange: null, contentType: "image/png", ok: true, status: 200 };
  };
};

/** A store that records what it was handed and names it by a fixed digest. */
const storeInto =
  ({ stored }: { stored: { bytes: number; contentType: string | undefined }[] }) =>
  ({ bytes, contentType }: { bytes: Buffer; contentType: string | undefined }) => {
    stored.push({ bytes: bytes.byteLength, contentType });
    return { deduped: false, digest: "digest-1", path: "/store/digest-1" };
  };

describe("attachmentRef", () => {
  it("names the stored digest and size, never a url", () => {
    expect(attachmentRef({ bytes: 42, digest: "abc" })).toBe("attachment: sha256:abc (42 bytes)");
  });
});

describe("fetchPageAttachments", () => {
  it("pages the top-level blocks by cursor and fetches only the hosted files under the ceiling", async () => {
    const listed: ListArgs[] = [];
    const asked: { url: string; rangeBytes: number | undefined }[] = [];
    const stored: { bytes: number; contentType: string | undefined }[] = [];
    const itemBudget = createNotionItemBudget({ maxCalls: 10, nowMs: () => 0 });
    const result = await fetchPageAttachments({
      call,
      ceilingBytes: 1000,
      client: clientOver({ listed, refuse: false }),
      itemBudget,
      pageId: "page-1",
      scopeId: "test-scope",
      store: storeInto({ stored }),
      transport: transportInto({ asked }),
    });
    expect(result).toEqual({
      fetched: 1,
      refs: ["attachment: sha256:digest-1 (500 bytes)"],
      refused: 2,
      skips: [
        { operation: "notion.files.download", reason: "result-limit", subject: "attachment" },
        { operation: "notion.files.download", reason: "unknown", subject: "attachment" },
      ],
    });
    expect(listed).toEqual([
      { block_id: "page-1", page_size: 100 },
      { block_id: "page-1", page_size: 100, start_cursor: "cur-2" },
    ]);
    expect(asked).toEqual([
      { rangeBytes: 1024, url: SMALL },
      { rangeBytes: undefined, url: SMALL },
      { rangeBytes: 1024, url: BIG },
      { rangeBytes: 1024, url: FORBIDDEN },
    ]);
    expect(stored).toEqual([{ bytes: 500, contentType: "image/png" }]);
    // Two listings and three hosted attachments, each one call against the page's allowance.
    expect(itemBudget.spent()).toBe(5);
  });

  it("stops at the first listing failure and records it under the listing's own operation", async () => {
    const listed: ListArgs[] = [];
    const asked: { url: string; rangeBytes: number | undefined }[] = [];
    const result = await fetchPageAttachments({
      call,
      ceilingBytes: 1000,
      client: clientOver({ listed, refuse: true }),
      itemBudget: createNotionItemBudget({ maxCalls: 10, nowMs: () => 0 }),
      pageId: "page-1",
      scopeId: "test-scope",
      store: storeInto({ stored: [] }),
      transport: transportInto({ asked }),
    });
    expect(result).toEqual({
      fetched: 0,
      refs: [],
      refused: 0,
      skips: [{ operation: "notion.blocks.children.attachments", reason: "unknown", subject: "page attachments" }],
    });
    expect(listed).toEqual([{ block_id: "page-1", page_size: 100 }]);
    expect(asked).toEqual([]);
  });

  it("lists nothing with an allowance of 0, and lists one page but fetches nothing with an allowance of 1", async () => {
    const noneListed: ListArgs[] = [];
    const none = await fetchPageAttachments({
      call,
      ceilingBytes: 1000,
      client: clientOver({ listed: noneListed, refuse: false }),
      itemBudget: createNotionItemBudget({ maxCalls: 0, nowMs: () => 0 }),
      pageId: "page-1",
      scopeId: "test-scope",
      store: storeInto({ stored: [] }),
      transport: transportInto({ asked: [] }),
    });
    expect(none).toEqual({
      fetched: 0,
      refs: [],
      refused: 0,
      skips: [{ operation: "notion.blocks.children.list", reason: "item-deadline", subject: "page attachments" }],
    });
    expect(noneListed).toEqual([]);

    const oneListed: ListArgs[] = [];
    const oneAsked: { url: string; rangeBytes: number | undefined }[] = [];
    const one = await fetchPageAttachments({
      call,
      ceilingBytes: 1000,
      client: clientOver({ listed: oneListed, refuse: false }),
      itemBudget: createNotionItemBudget({ maxCalls: 1, nowMs: () => 0 }),
      pageId: "page-1",
      scopeId: "test-scope",
      store: storeInto({ stored: [] }),
      transport: transportInto({ asked: oneAsked }),
    });
    expect(one).toEqual({
      fetched: 0,
      refs: [],
      refused: 0,
      skips: [
        { operation: "notion.files.download", reason: "item-deadline", subject: "attachment" },
        { operation: "notion.blocks.children.list", reason: "item-deadline", subject: "page attachments" },
      ],
    });
    expect(oneListed).toEqual([{ block_id: "page-1", page_size: 100 }]);
    expect(oneAsked).toEqual([]);
  });
});
