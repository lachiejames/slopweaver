/**
 * The publication audit's Notion door reads every page the ledger holds through a seam a test fakes with plain
 * functions: each page's title and flattened body carry its key and address, and any gap makes the door partial,
 * never clean. Synthetic workspace only.
 */
import { describe, expect, it } from "vitest";

import type { NotionNamedBlockPage, NotionNamedReadApi } from "../../../../corpus/notion/liveApi.js";
import type { IngestError } from "../../../../lib/ingestError.js";
import { err, ok, type Result } from "../../../../lib/result.js";
import { readNotionPublications } from "../../../../live/publicationAudit/notionReader.js";
import {
  NOTION_PUBLICATION_GAPS,
  type NotionPublicationSeam,
  notionNotReadCoverage,
} from "../../../../live/publicationAudit/notionSeam.js";
import type { PageRecord } from "../../../../outbound/notion/pageLedger.js";
import {
  type PageIndexUnlistableError,
  type PageLedgerInventory,
  PageLedgerListingErrors,
} from "../../../../outbound/notion/pageLedgerListing.js";

const PAGE_A = "00000000-0000-0000-0000-00000000a001";
const PAGE_B = "00000000-0000-0000-0000-00000000a002";
const PAGE_C = "00000000-0000-0000-0000-00000000a003";
const LIVE_A = "https://www.notion.so/acme/Widgets-plan-0000000000000000000000000000a001";

type Listing = Result<NotionNamedBlockPage, IngestError>;

/** A failure the nested walk classifies as one unreadable block, carrying a message that must never be kept. */
function unshared({ message }: { message: string }): IngestError {
  return {
    code: "object_not_found",
    kind: "http",
    message,
    operation: "notion.blocks.children.namedObjectRead",
    provider: "notion",
    status: 404,
  };
}

/** A confirmed ledger row for one page, overridable field by field. */
function row(over: Partial<PageRecord> & { pageId: string }): PageRecord {
  return {
    confirmedIso: "2026-11-01T00:00:00.000Z",
    intent: `adopted:${over.pageId}`,
    reservedIso: "2026-11-01T00:00:00.000Z",
    ...over,
  };
}

/** A live page object with one title property. */
function page({ title, url, archived }: { title: string; url: string; archived: boolean }): unknown {
  return {
    archived,
    in_trash: false,
    object: "page",
    properties: { title: { id: "title", title: [{ href: null, plain_text: title, type: "text" }], type: "title" } },
    url,
  };
}

/** A text-bearing block of one type. */
function textBlock({
  id,
  type,
  text,
  hasChildren,
}: {
  id: string;
  type: string;
  text: string;
  hasChildren: boolean;
}): unknown {
  return { has_children: hasChildren, id, object: "block", type, [type]: { rich_text: [{ plain_text: text }] } };
}

/** A paragraph with no children. */
function paragraph({ id, text }: { id: string; text: string }): unknown {
  return textBlock({ hasChildren: false, id, text, type: "paragraph" });
}

/** What each page id answers on `retrievePage`, and what each block id lists; any absent id fails. */
interface FakeWorld {
  readonly pages: Readonly<Record<string, unknown>>;
  readonly children: Readonly<Record<string, Listing>>;
}

/** A seam answering from a fixed table, recording each call in order. */
function fakeSeam({ world }: { world: FakeWorld }): { seam: NotionPublicationSeam; calls: string[] } {
  const calls: string[] = [];
  const api: NotionNamedReadApi = {
    listBlockChildren: ({ id }) => {
      calls.push(`list ${id}`);
      const answer = world.children[id];
      if (answer === undefined) {
        return Promise.resolve(err(unshared({ message: "no listing in the fake" })));
      }
      return Promise.resolve(answer);
    },
    retrieveDatabase: () => Promise.resolve(err(["the audit never reads a database"])),
    retrievePage: ({ id }) => {
      calls.push(`retrieve ${id}`);
      const answer = world.pages[id];
      if (answer === undefined) {
        return Promise.resolve(err(["synthetic outage"]));
      }
      return Promise.resolve(ok(answer));
    },
  };
  return { calls, seam: { api, nowMs: () => 0 } };
}

/** One complete listing page. */
function listed({ results }: { results: readonly unknown[] }): Listing {
  return ok({ hasMore: false, nextCursor: undefined, results });
}

/** An inventory holding exactly these rows. */
function inventoryOf({
  rows,
  unreadableRows,
}: {
  rows: readonly PageRecord[];
  unreadableRows: number;
}): Result<PageLedgerInventory, PageIndexUnlistableError> {
  return ok({ rows, unreadableRows });
}

/** A one-page world: the page, its top-level blocks, and any nested listings. */
function onePageWorld({
  pageObject,
  blocks,
  nested,
}: {
  pageObject: unknown;
  blocks: readonly unknown[];
  nested: Readonly<Record<string, Listing>>;
}): FakeWorld {
  return { children: { [PAGE_A]: listed({ results: blocks }), ...nested }, pages: { [PAGE_A]: pageObject } };
}

const LIVE_PAGE = page({ archived: false, title: "Widgets plan", url: LIVE_A });

/** The inventory of the one confirmed page most cases read. */
const ONE_ROW = inventoryOf({ rows: [row({ pageId: PAGE_A })], unreadableRows: 0 });

describe("readNotionPublications", () => {
  it("projects the title and the whole block tree's prose, in display order, keyed and linked", async () => {
    const world = onePageWorld({
      blocks: [
        paragraph({ id: "b1", text: "first line" }),
        textBlock({ hasChildren: true, id: "b2", text: "second line", type: "toggle" }),
        paragraph({ id: "b3", text: "third line" }),
      ],
      nested: { b2: listed({ results: [paragraph({ id: "b2a", text: "nested line" })] }) },
      pageObject: LIVE_PAGE,
    });
    const { seam, calls } = fakeSeam({ world });
    const read = await readNotionPublications({ inventory: ONE_ROW, seam });
    expect(
      read.texts.map((text) => [text.door, text.objectKey, text.field, text.link, text.linkCarriesNoText, text.text]),
    ).toEqual([
      ["notion", `page ${PAGE_A}`, "title", LIVE_A, false, "Widgets plan"],
      ["notion", `page ${PAGE_A}`, "body", LIVE_A, false, "first line\nsecond line\nnested line\nthird line"],
    ]);
    expect(read.coverage).toEqual({
      attachmentsNotSwept: 0,
      door: "notion",
      gaps: [],
      objects: 1,
      state: "complete",
      texts: 2,
    });
    expect(calls).toEqual([`retrieve ${PAGE_A}`, `list ${PAGE_A}`, "list b2"]);
  });

  it("counts an archived page as read with no text and no gap, and lists none of its blocks", async () => {
    const archived = page({ archived: true, title: "gone", url: LIVE_A });
    const { seam, calls } = fakeSeam({ world: onePageWorld({ blocks: [], nested: {}, pageObject: archived }) });
    const read = await readNotionPublications({ inventory: ONE_ROW, seam });
    expect(read.texts).toEqual([]);
    expect(read.coverage).toEqual({
      attachmentsNotSwept: 0,
      door: "notion",
      gaps: [],
      objects: 1,
      state: "complete",
      texts: 0,
    });
    expect(calls).toEqual([`retrieve ${PAGE_A}`]);
  });

  it("reports a page Notion would not return as a fixed gap, never as clean", async () => {
    const { seam } = fakeSeam({ world: { children: {}, pages: {} } });
    const read = await readNotionPublications({ inventory: ONE_ROW, seam });
    expect(read.texts).toEqual([]);
    expect(read.coverage).toEqual({
      attachmentsNotSwept: 0,
      door: "notion",
      gaps: ["page read failed"],
      objects: 0,
      state: "partial",
      texts: 0,
    });
  });

  it("names a ledger row with no confirmed page id, and still reads the rows that resolve", async () => {
    const { seam, calls } = fakeSeam({ world: onePageWorld({ blocks: [], nested: {}, pageObject: LIVE_PAGE }) });
    const unconfirmed: PageRecord = { intent: "f".repeat(32), reservedIso: "2026-11-01T00:00:00.000Z" };
    const rows = [unconfirmed, row({ confirmedIso: undefined, pageId: PAGE_B }), row({ pageId: PAGE_A })];
    const read = await readNotionPublications({ inventory: inventoryOf({ rows, unreadableRows: 0 }), seam });
    expect(read.coverage.gaps).toEqual(["inventory row unresolved"]);
    expect(read.coverage.objects).toBe(1);
    expect(read.coverage.state).toBe("partial");
    expect(calls).toEqual([`retrieve ${PAGE_A}`, `list ${PAGE_A}`]);
  });

  it("names unreadable ledger files", async () => {
    const { seam } = fakeSeam({ world: onePageWorld({ blocks: [], nested: {}, pageObject: LIVE_PAGE }) });
    const inventory = inventoryOf({ rows: [row({ pageId: PAGE_A })], unreadableRows: 2 });
    const read = await readNotionPublications({ inventory, seam });
    expect(read.coverage.gaps).toEqual(["inventory row unreadable"]);
    expect(read.coverage.state).toBe("partial");
  });

  it("reads nothing from an unlistable ledger and says so", async () => {
    const { seam, calls } = fakeSeam({ world: { children: {}, pages: {} } });
    const read = await readNotionPublications({ inventory: err(PageLedgerListingErrors.unlistable()), seam });
    expect(read).toEqual({
      coverage: {
        attachmentsNotSwept: 0,
        door: "notion",
        gaps: ["inventory unreadable"],
        objects: 0,
        state: "partial",
        texts: 0,
      },
      texts: [],
    });
    expect(calls).toEqual([]);
  });

  it("reads pages in id order up to the ceiling, and names the ceiling", async () => {
    const empty = listed({ results: [] });
    const { seam, calls } = fakeSeam({
      world: {
        children: { [PAGE_A]: empty, [PAGE_B]: empty, [PAGE_C]: empty },
        pages: { [PAGE_A]: LIVE_PAGE, [PAGE_B]: LIVE_PAGE, [PAGE_C]: LIVE_PAGE },
      },
    });
    const rows = [row({ pageId: PAGE_C }), row({ pageId: PAGE_A }), row({ pageId: PAGE_B })];
    const inventory = inventoryOf({ rows, unreadableRows: 0 });
    const read = await readNotionPublications({ inventory, objectLimit: 2, seam });
    expect(calls).toEqual([`retrieve ${PAGE_A}`, `list ${PAGE_A}`, `retrieve ${PAGE_B}`, `list ${PAGE_B}`]);
    expect(read.coverage.objects).toBe(2);
    expect(read.coverage.gaps).toEqual(["object ceiling reached"]);
  });

  it("counts every file on the page once, the ledger's included, and never judges a signed file address", async () => {
    const image = {
      has_children: false,
      id: "img-1",
      image: { caption: [], file: { url: "https://files.example.com/signed?X-Amz-Signature=abc" }, type: "file" },
      object: "block",
      type: "image",
    };
    const pdf = { has_children: false, id: "pdf-1", object: "block", pdf: { caption: [], type: "file" }, type: "pdf" };
    const blocks = [paragraph({ id: "b1", text: "prose line" }), image, pdf];
    const { seam } = fakeSeam({ world: onePageWorld({ blocks, nested: {}, pageObject: LIVE_PAGE }) });
    const images = [
      { blockId: "img-1", fileUploadId: "u1", placeholderId: "p1", source: "a.png" },
      { blockId: "img-2", fileUploadId: "u2", placeholderId: "p2", source: "b.png" },
    ];
    const inventory = inventoryOf({ rows: [row({ images, pageId: PAGE_A })], unreadableRows: 0 });
    const read = await readNotionPublications({ inventory, seam });
    expect(read.texts.map((text) => [text.field, text.text])).toEqual([
      ["title", "Widgets plan"],
      ["body", "prose line"],
    ]);
    expect(read.coverage.attachmentsNotSwept).toBe(3);
    expect(read.coverage.gaps).toEqual(["uploaded files not read"]);
    expect(read.coverage.state).toBe("partial");
  });

  it("links the ledger's address when the live one is not a Notion address", async () => {
    const recorded = "https://app.notion.com/p/Widgets-plan-0000000000000000000000000000a001";
    const offHost = page({ archived: false, title: "t", url: "https://example.com/x" });
    const { seam } = fakeSeam({ world: onePageWorld({ blocks: [], nested: {}, pageObject: offHost }) });
    const inventory = inventoryOf({ rows: [row({ pageId: PAGE_A, url: recorded })], unreadableRows: 0 });
    const read = await readNotionPublications({ inventory, seam });
    expect(read.texts.map((text) => text.link)).toEqual([recorded]);
    expect(read.coverage.gaps).toEqual([]);
  });

  it("falls back to the id-only address, and names it unresolved, when neither address is a Notion one", async () => {
    const plainHttp = page({ archived: false, title: "t", url: "http://www.notion.so/x" });
    const { seam } = fakeSeam({ world: onePageWorld({ blocks: [], nested: {}, pageObject: plainHttp }) });
    const read = await readNotionPublications({ inventory: ONE_ROW, seam });
    expect(read.texts.map((text) => text.link)).toEqual(["https://www.notion.so/0000000000000000000000000000a001"]);
    expect(read.coverage.gaps).toEqual(["object address unresolved"]);
  });

  it("names a nested list it could not read with a fixed label, never the page's text or the provider's message", async () => {
    const phrase = "acme synthetic phrase";
    const { seam } = fakeSeam({
      world: onePageWorld({
        blocks: [
          paragraph({ id: "b1", text: phrase }),
          textBlock({ hasChildren: true, id: "b2", text: "toggle", type: "toggle" }),
        ],
        nested: { b2: err(unshared({ message: phrase })) },
        pageObject: LIVE_PAGE,
      }),
    });
    const read = await readNotionPublications({ inventory: ONE_ROW, seam });
    // The input carries the phrase in both the body and the provider's message, so its absence below is evidence.
    expect(read.texts.map((text) => text.text)).toEqual(["Widgets plan", `${phrase}\ntoggle`]);
    expect(read.coverage.gaps).toEqual(["nested blocks not fully read"]);
    expect(read.coverage.gaps.some((gap) => gap.includes(phrase))).toBe(false);
  });

  it("names a block shape the renderer cannot read", async () => {
    const unsupported = { has_children: false, id: "u1", object: "block", type: "unsupported", unsupported: {} };
    const { seam } = fakeSeam({ world: onePageWorld({ blocks: [unsupported], nested: {}, pageObject: LIVE_PAGE }) });
    const read = await readNotionPublications({ inventory: ONE_ROW, seam });
    expect(read.coverage.gaps).toEqual(["block shape unreadable"]);
  });

  it("names a child page outside the inventory, and not one the run reads itself", async () => {
    const child = {
      child_page: { title: "child" },
      has_children: true,
      id: PAGE_B,
      object: "block",
      type: "child_page",
    };
    const world: FakeWorld = {
      children: { [PAGE_A]: listed({ results: [child] }), [PAGE_B]: listed({ results: [] }) },
      pages: { [PAGE_A]: LIVE_PAGE, [PAGE_B]: LIVE_PAGE },
    };
    const both = inventoryOf({ rows: [row({ pageId: PAGE_A }), row({ pageId: PAGE_B })], unreadableRows: 0 });
    const inInventory = await readNotionPublications({ inventory: both, seam: fakeSeam({ world }).seam });
    const outside = await readNotionPublications({ inventory: ONE_ROW, seam: fakeSeam({ world }).seam });
    expect(inInventory.coverage.gaps).toEqual([]);
    expect(outside.coverage.gaps).toEqual(["child page or database not read"]);
  });

  it("names a top-level listing that reports more blocks but gives no cursor", async () => {
    const truncated: Listing = ok({
      hasMore: true,
      nextCursor: undefined,
      results: [paragraph({ id: "b1", text: "x" })],
    });
    const { seam } = fakeSeam({ world: { children: { [PAGE_A]: truncated }, pages: { [PAGE_A]: LIVE_PAGE } } });
    const read = await readNotionPublications({ inventory: ONE_ROW, seam });
    expect(read.coverage.gaps).toEqual(["top-level blocks not fully read"]);
  });
});

describe("notionNotReadCoverage", () => {
  it("is a partial row carrying only the one reason", () => {
    expect(notionNotReadCoverage({ gap: NOTION_PUBLICATION_GAPS.credentialMissing })).toEqual({
      attachmentsNotSwept: 0,
      door: "notion",
      gaps: ["credential missing"],
      objects: 0,
      state: "partial",
      texts: 0,
    });
  });
});
