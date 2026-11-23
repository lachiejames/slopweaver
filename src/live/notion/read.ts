/** A current, single-object Notion read through the official SDK and the shared provider door. */

import type { AttachmentTransport } from "../../corpus/notion/attachmentFetch.js";
import type { NotionNamedBlockPage, NotionNamedReadApi } from "../../corpus/notion/liveApi.js";
import type { IngestError } from "../../lib/ingestError.js";
import { err, ok, type Result } from "../../lib/result.js";
import type { ProviderReadAttachment, ProviderReadDocument, ProviderReadTarget } from "../providerRead.js";
import { openNotionAssets } from "./assetDocuments.js";
import { flattenBlockTree, type NotionBlockNode, type NotionNestedExpansion } from "./blockShape.js";
import { expandNotionBlocks, NOTION_NESTED_TIME_MS } from "./blockTree.js";
import { type NotionLiveError, NotionLiveErrors } from "./errors.js";
import { notionNestedResidue, notionPageCoverageDetail } from "./nestedResidue.js";

/**
 * What opening this page's files needs: the byte seam, and the door scope the calls are accounted to.
 *
 * Absent means no file is opened, which is a different answer from opening none and is reported as one —
 * see {@link ProviderReadDocument.attachments}.
 */
export interface NotionAssetSeam {
  readonly transport: AttachmentTransport;
  readonly scopeId: string;
}

/** The named Notion objects whose current shape this first live reader can distinguish. */
export type NotionObjectKind = "page" | "database";

interface NotionAddress extends ProviderReadTarget {
  readonly kind: NotionObjectKind;
  readonly id: string;
}

/** The injected official-SDK seams. Every production method is safe-wrapped and shares one scheduler. */
export type NotionReadApi = NotionNamedReadApi;

/** Format a canonical UUID from Notion's 32 hexadecimal URL suffix. */
function notionUuid({ compact }: { compact: string }): string {
  return `${compact.slice(0, 8)}-${compact.slice(8, 12)}-${compact.slice(12, 16)}-${compact.slice(16, 20)}-${compact.slice(20)}`;
}

/** Extract a canonical Notion object id from a bare id or notion.so URL. */
function notionIdFrom({ address }: { address: string }): { address: string; id: string } | undefined {
  const urlCandidates = [
    ...new Set(
      [...address.matchAll(/https:\/\/(?:(?:[A-Za-z0-9-]+\.)*notion\.so|app\.notion\.com)\/[^\s)>\]"']+/giu)].map(
        (match) => match[0].replace(/[.,;:!?]+$/u, ""),
      ),
    ),
  ];
  if (urlCandidates.length === 0 && /https?:\/\//iu.test(address)) {
    return undefined;
  }
  if (urlCandidates.length > 1) {
    return undefined;
  }
  const idCandidates = [
    ...new Set([...address.matchAll(/\b[0-9a-f]{8}(?:-?[0-9a-f]{4}){3}-?[0-9a-f]{12}\b/giu)].map((match) => match[0])),
  ];
  if (urlCandidates.length === 0 && idCandidates.length > 1) {
    return undefined;
  }
  const candidate = urlCandidates[0] ?? idCandidates[0] ?? address;
  const compactBare = candidate.replaceAll("-", "");
  if (/^[0-9a-f]{32}$/i.test(compactBare)) {
    return { address: candidate, id: notionUuid({ compact: compactBare.toLowerCase() }) };
  }
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return undefined;
  }
  if (url.protocol !== "https:" || (!/(^|\.)notion\.so$/.test(url.hostname) && url.hostname !== "app.notion.com")) {
    return undefined;
  }
  const segment = url.pathname.replace(/\/+$/, "").split("/").at(-1);
  const compact = segment === undefined ? undefined : /(?:^|-)([0-9a-f]{32})$/i.exec(segment)?.[1];
  return compact === undefined ? undefined : { address: candidate, id: notionUuid({ compact: compact.toLowerCase() }) };
}

/**
 * Parse one Notion address without reading a token.
 *
 * @param address a bare UUID or notion.so URL
 * @param kind whether to call the page or database endpoint
 * @returns the canonical target, or an actionable refusal
 */
export function parseNotionReadAddress({
  address,
  kind,
}: {
  address: string;
  kind: NotionObjectKind;
}): Result<NotionAddress, NotionLiveError> {
  const resolved = notionIdFrom({ address });
  if (resolved === undefined) {
    return err(
      NotionLiveErrors.invalidAddress({
        message:
          "Notion read needs a bare object UUID or a full https://*.notion.so/...<32-hex-id> or https://app.notion.com/...<32-hex-id> URL",
      }),
    );
  }
  return ok({ address: resolved.address, id: resolved.id, identity: resolved.id, kind });
}

/**
 * Fold `NotionNamedReadApi`'s untyped `readonly string[]` page and database failures into this module's
 * domain error at the point it is consumed — those two seams have not been migrated onto a typed error, so
 * the messages are joined rather than lost. The block-children seam answers an `IngestError`, mapped by
 * {@link fromIngestError}.
 */
function toReadFailed({ messages }: { messages: readonly string[] }): NotionLiveError {
  return NotionLiveErrors.readFailed({ cause: messages, message: messages.join("; ") });
}

/** The block-children seam's typed boundary failure, carried as the cause of this domain's read failure. */
function fromIngestError({ error }: { error: IngestError }): NotionLiveError {
  return NotionLiveErrors.readFailed({ cause: error, message: error.message });
}

/** Read database metadata without implying that rows or linked objects were traversed. */
async function readDatabase({
  api,
  nowIso,
  target,
}: {
  api: NotionReadApi;
  nowIso: () => string;
  target: NotionAddress;
}): Promise<Result<ProviderReadDocument, NotionLiveError>> {
  const database = await api.retrieveDatabase({ id: target.id });
  return database.isOk()
    ? ok({
        coverage: {
          detail: "one database object; rows and linked data sources are not traversed by this named-object read",
          kind: "bounded",
          residue: ["database rows, linked pages and data-source contents were not requested"],
        },
        data: database.value,
        readAtIso: nowIso(),
        source: "notion",
        target,
      })
    : err(toReadFailed({ messages: database.error }));
}

/**
 * The residue lines for one top-level block slice, resumed or not.
 *
 * Pure so the continuation instruction is a unit test rather than a live read. The wording must never say
 * "first" for a RESUMED slice: a reader told it holds the first N blocks of a page it entered part-way
 * through has been told something false, which is the class this flag exists to remove.
 *
 * @param limit how many top-level blocks were requested
 * @param after the cursor this slice resumed from, or undefined for the opening slice
 * @param hasMore whether Notion says another slice follows
 * @param nextCursor the token that reaches the next slice, when there is one
 * @returns the residue lines, the continuation instruction first when there is one
 */
export function notionBlockSliceResidue({
  limit,
  after,
  hasMore,
  nextCursor,
}: {
  limit: number;
  after: string | undefined;
  hasMore: boolean;
  nextCursor: string | undefined;
}): readonly string[] {
  const opening = `only the page object and first ${String(limit)} top-level blocks were requested`;
  const resumed = `only the page object and up to ${String(limit)} top-level blocks continuing from the supplied cursor were requested`;
  const residue = [after === undefined ? opening : resumed];
  if (hasMore && nextCursor !== undefined) {
    residue.push(`more top-level blocks remain: read the next slice with --after ${nextCursor}`);
  }
  if (hasMore && nextCursor === undefined) {
    residue.push(
      "the page reports more top-level blocks but returned no cursor, so the rest cannot be reached by " +
        "continuing — a provider inconsistency, and NOT a complete read",
    );
  }
  return residue;
}

/**
 * The bounds on one page read's nested expansion: the child-list call ceiling and the clock its limit on
 * starting calls reads. A database read lists no blocks and ignores both.
 */
export interface NotionNestedBounds {
  readonly maxCalls: number;
  readonly nowMs: () => number;
}

/**
 * The files this read opened, and what it says about them.
 *
 * Opened only once the whole tree is in hand, and from every block in it — a file inside a toggle is as much
 * the page's as one at the top. A signed Notion url is live inside the response that produced it and nowhere
 * else, so this is the one moment its bytes are reachable at all.
 */
async function pageAssets({
  assets,
  tree,
  page,
}: {
  assets: NotionAssetSeam | undefined;
  tree: readonly NotionBlockNode[];
  page: unknown;
}): Promise<{ attachments?: readonly ProviderReadAttachment[]; residue: readonly string[] }> {
  if (assets === undefined) {
    return { residue: [] };
  }
  const opened = await openNotionAssets({ blocks: flattenBlockTree({ tree }), page, ...assets });
  return { attachments: opened.attachments, residue: opened.residue };
}

/** Read one page object, one bounded top-level block page, and every block nested beneath that page. */
async function readPage({
  api,
  limit,
  after,
  nowIso,
  nested,
  target,
  assets,
}: {
  api: NotionReadApi;
  limit: number;
  after: string | undefined;
  nowIso: () => string;
  nested: NotionNestedBounds;
  target: NotionAddress;
  assets?: NotionAssetSeam;
}): Promise<Result<ProviderReadDocument, NotionLiveError>> {
  const page = await api.retrievePage({ id: target.id });
  if (page.isErr()) {
    return err(toReadFailed({ messages: page.error }));
  }
  const blocks = await api.listBlockChildren({ after, id: target.id, limit });
  if (blocks.isErr()) {
    return err(fromIngestError({ error: blocks.error }));
  }
  const expanded = await expandNotionBlocks({
    api,
    blocks: blocks.value.results,
    maxCalls: nested.maxCalls,
    maxMs: NOTION_NESTED_TIME_MS,
    nowMs: nested.nowMs,
  });
  if (expanded.isErr()) {
    return err(fromIngestError({ error: expanded.error }));
  }
  const opened = await pageAssets({ assets, page: page.value, tree: expanded.value.tree });
  return ok(
    pageDocument({
      after,
      blocks: blocks.value,
      expanded: expanded.value,
      limit,
      opened,
      nowIso,
      page: page.value,
      target,
    }),
  );
}

/** Assemble one page read's document: Notion's raw slice untouched, the expanded tree and its claims beside it. */
function pageDocument({
  after,
  blocks,
  expanded,
  limit,
  nowIso,
  opened,
  page,
  target,
}: {
  after: string | undefined;
  blocks: NotionNamedBlockPage;
  expanded: { tree: readonly NotionBlockNode[]; nested: NotionNestedExpansion };
  limit: number;
  opened: { attachments?: readonly ProviderReadAttachment[]; residue: readonly string[] };
  nowIso: () => string;
  page: unknown;
  target: NotionAddress;
}): ProviderReadDocument {
  const residue = [
    ...notionBlockSliceResidue({ after, hasMore: blocks.hasMore, limit, nextCursor: blocks.nextCursor }),
    ...notionNestedResidue({ nested: expanded.nested }),
    ...opened.residue,
  ];
  return {
    ...(opened.attachments === undefined ? {} : { attachments: opened.attachments }),
    coverage: {
      detail: notionPageCoverageDetail({ after, complete: expanded.nested.complete }),
      kind: "bounded",
      residue,
    },
    data: {
      blockTree: expanded.tree,
      blocks: { hasMore: blocks.hasMore, nextCursor: blocks.nextCursor, results: blocks.results },
      nested: expanded.nested,
      page,
    },
    // Read last, exactly where the inline document read it, so the freshness stamp follows every field.
    readAtIso: nowIso(),
    source: "notion",
    target,
  };
}

/**
 * Read one current Notion page or database.
 *
 * @param address the Notion URL or id
 * @param kind the explicit endpoint to use
 * @param api the safe official-SDK seams
 * @param limit the maximum top-level blocks to request for a page
 * @param after Notion's own opaque cursor from a previous slice, to continue a page past `limit`
 * @param nowIso the freshness clock
 * @param nested the call ceiling and clock bounding a page's nested expansion
 * @param assets the byte seam for opening the files this page's blocks address; omitted means none are
 *   opened, which a database read can never do at all
 * @returns a bounded provider document, or a named read failure
 */
export async function readNotionObject({
  address,
  kind,
  api,
  limit,
  after,
  nowIso,
  nested,
  assets,
}: {
  address: string;
  kind: NotionObjectKind;
  api: NotionReadApi;
  limit: number;
  after: string | undefined;
  nowIso: () => string;
  nested: NotionNestedBounds;
  assets?: NotionAssetSeam;
}): Promise<Result<ProviderReadDocument, NotionLiveError>> {
  const parsed = parseNotionReadAddress({ address, kind });
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  if (kind === "database") {
    return readDatabase({ api, nowIso, target: parsed.value });
  }
  return readPage({
    after,
    api,
    ...(assets === undefined ? {} : { assets }),
    limit,
    nested,
    nowIso,
    target: parsed.value,
  });
}
