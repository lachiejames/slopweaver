/**
 * The publication audit's Notion door: every page the page ledger says slopweaver created or adopted, read back as
 * it stands now — its title and the visible prose of its whole block tree.
 *
 * ## Why the ledger, and why every row
 *
 * Notion has no listing of "what this integration wrote", and a search would answer only what the token can see
 * today, which is exactly the set a lost share would shrink without saying so. The ledger's `pages` index is the
 * record of every page the fleet confirmed, created or adopted (`../../outbound/notion/pageLedger.ts`), so it is the
 * inventory. A row the ledger cannot resolve to a confirmed page id is a gap, never skipped in silence.
 *
 * ## Reuse, not a second reader
 *
 * A page is read through the same named-object seam `notion read` uses (`../../corpus/notion/liveApi.ts`), its
 * nested blocks expanded by the same breadth-first walk under the same bounds (`../notion/blockTree.ts`), and each
 * block's text projected by the corpus's own per-type renderer (`../../corpus/notion/blockText.ts`) — one table
 * decides what text a Notion block publishes. Nothing here scans arbitrary JSON: a block's signed file address and
 * the page's metadata are never judged as text.
 *
 * ## A partial read is never clean
 *
 * A failed read, an unread nested list, a block shape the renderer cannot read, a child object not itself in the
 * inventory, an address that will not resolve and an uploaded file are each a FIXED gap label from
 * `./notionSeam.ts`'s `NOTION_PUBLICATION_GAPS`, and any gap makes the door `partial`. An explicitly archived or
 * trashed page is no longer published, so it is counted as read and contributes no text and no gap.
 */
import { isRecord } from "#lib/parsers.js";
import type { Result } from "#lib/result.js";

import { blockTextLine, titleFrom } from "../../corpus/notion/fetchProject.js";
import type { NotionNamedReadApi } from "../../corpus/notion/liveApi.js";
import { isValidPageId, type PageRecord } from "../../outbound/notion/pageLedger.js";
import type { PageIndexUnlistableError, PageLedgerInventory } from "../../outbound/notion/pageLedgerListing.js";
import { flattenBlockTree, type NotionLinkedObject } from "../notion/blockShape.js";
import { expandNotionBlocks, NOTION_NESTED_CALLS_DEFAULT, NOTION_NESTED_TIME_MS } from "../notion/blockTree.js";

import {
  NOTION_PUBLICATION_GAPS,
  type NotionPublicationGap,
  type NotionPublicationSeam,
  notionNotReadCoverage,
} from "./notionSeam.js";
import { doorCoverage, type PublicationRead, type PublishedText } from "./types.js";

/** Pages one run reads before it reports a ceiling. */
const NOTION_PUBLICATION_OBJECT_LIMIT = 500;

/** Notion's own maximum page size for a block-children listing. */
const BLOCK_PAGE_SIZE = 100;

/** Top-level block pages one page read lists before it reports the rest unread: 5,000 top-level blocks. */
const TOP_LEVEL_MAX_PAGES = 50;

/** Block types whose content is an uploaded or embedded file a text check cannot judge. */
const FILE_BLOCK_TYPES: ReadonlySet<string> = new Set(["audio", "file", "image", "pdf", "video"]);

/** One confirmed page to read: its id and what the ledger recorded about it. */
interface InventoryPage {
  readonly pageId: string;
  readonly record: PageRecord;
}

/** What reading one page produced. */
interface PageOutcome {
  readonly texts: readonly PublishedText[];
  /** True when the page object itself was read, so its title (or its archived state) was judged. */
  readonly read: boolean;
  readonly gaps: readonly NotionPublicationGap[];
  /** Block ids of the files on the page, ledger-recorded or found in the tree. */
  readonly uploads: readonly string[];
}

/** How one page's top-level listing ended: failed outright, or listed with whether it reached the end. */
type TopLevelListing =
  | { readonly outcome: "failed" }
  | { readonly outcome: "listed"; readonly blocks: readonly unknown[]; readonly complete: boolean };

/** Whether a value is an https address on a Notion host, the only shape a Notion page link may take. */
function isNotionAddress(value: unknown): value is string {
  if (typeof value !== "string") {
    return false;
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  const host = url.hostname.toLowerCase();
  const notionHost =
    host === "notion.so" ||
    host.endsWith(".notion.so") ||
    host === "notion.site" ||
    host.endsWith(".notion.site") ||
    host === "app.notion.com";
  return url.protocol === "https:" && notionHost;
}

/** The page's address: the live `url`, else the one the ledger recorded, else the id-only address, flagged. */
function pageLink({ page, record, pageId }: { page: Record<string, unknown>; record: PageRecord; pageId: string }): {
  readonly link: string;
  readonly unresolved: boolean;
} {
  const live = page["url"];
  if (isNotionAddress(live)) {
    return { link: live, unresolved: false };
  }
  if (isNotionAddress(record.url)) {
    return { link: record.url, unresolved: false };
  }
  return { link: `https://www.notion.so/${pageId.replaceAll("-", "")}`, unresolved: true };
}

/** Whether a page object carries a title in either shape `titleFrom` reads, so its `(untitled)` is never judged. */
function hasTitleShape({ page }: { page: Record<string, unknown> }): boolean {
  if (Array.isArray(page["title"])) {
    return true;
  }
  const properties = page["properties"];
  return (
    isRecord(properties) && Object.values(properties).some((value) => isRecord(value) && value["type"] === "title")
  );
}

/** Every top-level block of one page, a listing page at a time, and whether the listing reached its end. */
async function listTopLevel({ api, pageId }: { api: NotionNamedReadApi; pageId: string }): Promise<TopLevelListing> {
  const blocks: unknown[] = [];
  const cursors = new Set<string>();
  let after: string | undefined;
  for (let listed = 0; listed < TOP_LEVEL_MAX_PAGES; listed += 1) {
    const page = await api.listBlockChildren({ after, id: pageId, limit: BLOCK_PAGE_SIZE });
    if (page.isErr()) {
      return { outcome: "failed" };
    }
    blocks.push(...page.value.results);
    if (!page.value.hasMore) {
      return { blocks, complete: true, outcome: "listed" };
    }
    const next = page.value.nextCursor;
    if (next === undefined || cursors.has(next)) {
      return { blocks, complete: false, outcome: "listed" };
    }
    cursors.add(next);
    after = next;
  }
  return { blocks, complete: false, outcome: "listed" };
}

/** The projected body of one flattened tree: its visible prose in display order, its files, and any shape gap. */
function projectBody({ blocks }: { blocks: readonly unknown[] }): {
  readonly body: string;
  readonly uploads: readonly string[];
  readonly unreadable: boolean;
} {
  const lines: string[] = [];
  const uploads: string[] = [];
  let unreadable = false;
  for (const block of blocks) {
    if (!isRecord(block)) {
      unreadable = true;
      continue;
    }
    const type = block["type"];
    if (typeof type !== "string" || type === "unsupported" || !isRecord(block[type])) {
      unreadable = true;
      continue;
    }
    if (FILE_BLOCK_TYPES.has(type) && typeof block["id"] === "string") {
      uploads.push(block["id"]);
    }
    const line = blockTextLine({ block });
    if (line.trim().length > 0) {
      lines.push(line);
    }
  }
  return { body: lines.join("\n"), unreadable, uploads };
}

/**
 * Whether the tree names a child object nothing else in this run reads: a database (never in the page ledger), or
 * a child page outside the inventory.
 */
function namesUnreadChild({
  linked,
  inventoryIds,
}: {
  linked: readonly NotionLinkedObject[];
  inventoryIds: ReadonlySet<string>;
}): boolean {
  return linked.some((object) => object.kind === "database" || !inventoryIds.has(object.id.toLowerCase()));
}

/** The title text of one page, or the gap naming why it could not be judged. */
function titleTexts({ page, base }: { page: Record<string, unknown>; base: Omit<PublishedText, "field" | "text"> }): {
  readonly texts: readonly PublishedText[];
  readonly gaps: readonly NotionPublicationGap[];
} {
  if (!hasTitleShape({ page })) {
    return { gaps: [NOTION_PUBLICATION_GAPS.pageTitleUnreadable], texts: [] };
  }
  const title = titleFrom({ raw: page });
  if (title.trim().length === 0) {
    return { gaps: [], texts: [] };
  }
  return { gaps: [], texts: [{ ...base, field: "title", text: title }] };
}

/** Read one page's block tree: its prose, its files and every gap the listing and the walk left. */
async function readPageBody({
  pageId,
  seam,
  inventoryIds,
}: {
  pageId: string;
  seam: NotionPublicationSeam;
  inventoryIds: ReadonlySet<string>;
}): Promise<{ readonly body: string; readonly uploads: readonly string[]; readonly gaps: NotionPublicationGap[] }> {
  const gaps: NotionPublicationGap[] = [];
  const topLevel = await listTopLevel({ api: seam.api, pageId });
  if (topLevel.outcome === "failed") {
    return { body: "", gaps: [NOTION_PUBLICATION_GAPS.pageReadFailed], uploads: [] };
  }
  if (!topLevel.complete) {
    gaps.push(NOTION_PUBLICATION_GAPS.topLevelBlocksNotFullyRead);
  }
  const expanded = await expandNotionBlocks({
    api: seam.api,
    blocks: topLevel.blocks,
    maxCalls: NOTION_NESTED_CALLS_DEFAULT,
    maxMs: NOTION_NESTED_TIME_MS,
    nowMs: seam.nowMs,
  });
  if (expanded.isErr()) {
    // A token-level failure mid-walk: the tree it had built is not handed back, so the whole body is unread.
    return { body: "", gaps: [...gaps, NOTION_PUBLICATION_GAPS.pageReadFailed], uploads: [] };
  }
  if (!expanded.value.nested.complete) {
    gaps.push(NOTION_PUBLICATION_GAPS.nestedBlocksNotFullyRead);
  }
  if (namesUnreadChild({ inventoryIds, linked: expanded.value.nested.linkedObjects })) {
    gaps.push(NOTION_PUBLICATION_GAPS.childObjectNotRead);
  }
  const projected = projectBody({ blocks: flattenBlockTree({ tree: expanded.value.tree }) });
  if (projected.unreadable) {
    gaps.push(NOTION_PUBLICATION_GAPS.blockShapeUnreadable);
  }
  return { body: projected.body, gaps, uploads: projected.uploads };
}

/** Read one page as it stands now: its title, its whole block tree's prose, and every gap the read left. */
async function readOnePage({
  target,
  seam,
  inventoryIds,
}: {
  target: InventoryPage;
  seam: NotionPublicationSeam;
  inventoryIds: ReadonlySet<string>;
}): Promise<PageOutcome> {
  const { pageId, record } = target;
  const retrieved = await seam.api.retrievePage({ id: pageId });
  if (retrieved.isErr()) {
    return { gaps: [NOTION_PUBLICATION_GAPS.pageReadFailed], read: false, texts: [], uploads: [] };
  }
  const page = retrieved.value;
  if (!isRecord(page)) {
    return { gaps: [NOTION_PUBLICATION_GAPS.pageShapeUnreadable], read: false, texts: [], uploads: [] };
  }
  if (page["archived"] === true || page["in_trash"] === true) {
    return { gaps: [], read: true, texts: [], uploads: [] };
  }
  const gaps: NotionPublicationGap[] = [];
  const { link, unresolved } = pageLink({ page, pageId, record });
  if (unresolved) {
    gaps.push(NOTION_PUBLICATION_GAPS.objectAddressUnresolved);
  }
  // A Notion address carries the page's title slug, so the link is judged as text too.
  const base = { door: "notion" as const, link, linkCarriesNoText: false, objectKey: `page ${pageId}` };
  const title = titleTexts({ base, page });
  gaps.push(...title.gaps);
  const body = await readPageBody({ inventoryIds, pageId, seam });
  gaps.push(...body.gaps);
  const texts: PublishedText[] = [...title.texts];
  if (body.body.length > 0) {
    texts.push({ ...base, field: "body", text: body.body });
  }
  const recordedUploads = record.images === undefined ? [] : record.images.map((image) => image.blockId);
  return { gaps, read: true, texts, uploads: [...recordedUploads, ...body.uploads] };
}

/** The inventory's confirmed pages, deduplicated and sorted by id, and the gaps the rows themselves leave. */
function resolveInventory({ inventory }: { inventory: PageLedgerInventory }): {
  readonly pages: readonly InventoryPage[];
  readonly gaps: readonly NotionPublicationGap[];
} {
  const gaps: NotionPublicationGap[] = [];
  if (inventory.unreadableRows > 0) {
    gaps.push(NOTION_PUBLICATION_GAPS.inventoryRowUnreadable);
  }
  const byId = new Map<string, InventoryPage>();
  for (const record of inventory.rows) {
    const { pageId, confirmedIso } = record;
    if (pageId === undefined || confirmedIso === undefined || !isValidPageId({ id: pageId })) {
      gaps.push(NOTION_PUBLICATION_GAPS.inventoryRowUnresolved);
      continue;
    }
    const key = pageId.toLowerCase();
    if (!byId.has(key)) {
      byId.set(key, { pageId: key, record });
    }
  }
  const pages = [...byId.values()].toSorted((left, right) => left.pageId.localeCompare(right.pageId));
  return { gaps, pages };
}

/**
 * Read every page the Notion page ledger holds, as it stands now, one page at a time.
 *
 * @param inventory the ledger listing (`listPageRecords`); an `err` is the gap `inventory unreadable`, never an
 *   empty door
 * @param seam the named-object read seam (`productionNotionPublicationSeam` live, plain functions in a test)
 * @param objectLimit pages read before the ceiling gap is reported
 * @returns the texts to judge and the door's coverage
 */
export async function readNotionPublications({
  inventory,
  seam,
  objectLimit = NOTION_PUBLICATION_OBJECT_LIMIT,
}: {
  inventory: Result<PageLedgerInventory, PageIndexUnlistableError>;
  seam: NotionPublicationSeam;
  objectLimit?: number;
}): Promise<PublicationRead> {
  if (inventory.isErr()) {
    return { coverage: notionNotReadCoverage({ gap: NOTION_PUBLICATION_GAPS.inventoryUnreadable }), texts: [] };
  }
  const resolved = resolveInventory({ inventory: inventory.value });
  const gaps: NotionPublicationGap[] = [...resolved.gaps];
  const inventoryIds = new Set(resolved.pages.map((page) => page.pageId));
  if (resolved.pages.length > objectLimit) {
    gaps.push(NOTION_PUBLICATION_GAPS.objectCeilingReached);
  }
  const texts: PublishedText[] = [];
  const uploads = new Set<string>();
  let objects = 0;
  for (const target of resolved.pages.slice(0, objectLimit)) {
    const outcome = await readOnePage({ inventoryIds, seam, target });
    texts.push(...outcome.texts);
    gaps.push(...outcome.gaps);
    for (const upload of outcome.uploads) {
      uploads.add(upload);
    }
    if (outcome.read) {
      objects += 1;
    }
  }
  if (uploads.size > 0) {
    gaps.push(NOTION_PUBLICATION_GAPS.uploadedFilesNotRead);
  }
  return {
    coverage: doorCoverage({ attachmentsNotSwept: uploads.size, door: "notion", gaps, objects, texts: texts.length }),
    texts,
  };
}
