/**
 * Fetching the attachments ON one page, given that the body read cannot supply them.
 *
 * MEASURED, and this module exists entirely because of it: `pages.retrieveMarkdown` does NOT put a
 * fetchable url in a media tag. It puts `file://` plus a percent-encoded envelope whose `source` is almost
 * always an `attachment:<uuid>` handle carrying no url, and on the rare occasion it is a storage url that url
 * is UNSIGNED and answers 403. On the attachment-richest real pages the handles outnumbered urls seventy to
 * one, and the single url was refused.
 *
 * The signed url lives only in the BLOCK json. So a page that references attachments takes ONE extra
 * `blocks.children.list` pass, top level only, to collect its file blocks. That is not the recursion coming
 * back: there is no descent here, no depth parameter and no cap to lift, and it runs only on the pages whose
 * body said they have attachments — measured at 425 of the workspace's pages rather than all of them.
 */
import type { Client } from "@notionhq/client";

import { isRecord } from "../../lib/parsers.js";
import { safeProviderCall } from "../../lib/providerCall.js";
import { type AttachmentTransport, fetchAttachment } from "./attachmentFetch.js";
import type { StoredAttachment } from "./attachmentStore.js";
import { classifyAttachment, signedUrlOf } from "./attachments.js";
import type { GatedCall } from "./callDeadline.js";
import type { NotionItemBudget } from "./itemCrawl.js";
import type { NotionSkip } from "./skips.js";

/** What one page's attachment pass produced. */
export interface PageAttachments {
  /** One line per attachment that landed, carrying the digest a reader resolves to bytes with. */
  readonly refs: readonly string[];
  readonly skips: readonly NotionSkip[];
  readonly fetched: number;
  readonly refused: number;
}

/**
 * The one client method this pass calls. Narrowed from the SDK's `Client` so a crawl's real client still fits
 * while a test can hand in a plain object; the call itself stays inside {@link listBlockPage}'s
 * `safeProviderCall` door.
 */
interface BlockChildrenClient {
  readonly blocks: {
    readonly children: {
      readonly list: (
        args: Parameters<Client["blocks"]["children"]["list"]>[0],
      ) => Promise<{ results: unknown[]; next_cursor: string | null }>;
    };
  };
}

/**
 * One page of a page's top-level blocks. The ONLY provider boundary in this module's own listing path.
 *
 * @param cursor the page to resume at, or undefined for the first
 * @returns the raw results and the next cursor, or the typed failure
 */
function listBlockPage({
  client,
  call,
  scopeId,
  pageId,
  cursor,
}: {
  client: BlockChildrenClient;
  call: GatedCall;
  scopeId: string;
  pageId: string;
  cursor: string | undefined;
}): ReturnType<typeof safeProviderCall<{ results: unknown[]; next_cursor: string | null }>> {
  return safeProviderCall({
    execute: () =>
      call(() =>
        client.blocks.children.list({
          block_id: pageId,
          page_size: 100,
          ...(cursor !== undefined ? { start_cursor: cursor } : {}),
        }),
      ),
    operation: "notion.blocks.children.attachments",
    provider: "notion",
    retryMode: "transient",
    scopeId,
  });
}

/**
 * The ref line one stored attachment gets on its page's record. Pure.
 *
 * The DIGEST rather than the url, because a signed url expires inside the hour and a stale one in bronze
 * would look live while pointing at nothing.
 *
 * @param digest the stored bytes' sha256
 * @param bytes how large the file is
 * @returns the ref line
 */
export function attachmentRef({ digest, bytes }: { digest: string; bytes: number }): string {
  return `attachment: sha256:${digest} (${String(bytes)} bytes)`;
}

/** The accumulator one page's attachment pass fills. */
interface AttachmentSink {
  readonly refs: string[];
  readonly skips: NotionSkip[];
  fetched: number;
  refused: number;
}

/**
 * Pull every fetchable attachment named on ONE page of block results, into the sink.
 *
 * @param results the raw blocks from one `blocks.children.list` page
 * @param sink the accumulator, mutated in place
 * @returns nothing; everything it learned is on the sink
 */
async function pullFromBlockPage({
  results,
  sink,
  ceilingBytes,
  transport,
  store,
  scopeId,
  itemBudget,
}: {
  results: readonly unknown[];
  sink: AttachmentSink;
  ceilingBytes: number;
  transport: AttachmentTransport;
  store: (args: { bytes: Buffer; contentType: string | undefined }) => StoredAttachment;
  scopeId: string;
  itemBudget: NotionItemBudget;
}): Promise<void> {
  for (const raw of results) {
    if (!isRecord(raw)) {
      continue;
    }
    const url = signedUrlOf({ block: raw });
    if (url === undefined || classifyAttachment({ src: url }).kind !== "hosted") {
      continue;
    }
    if (itemBudget.exhausted()) {
      sink.skips.push({ operation: "notion.files.download", reason: "item-deadline", subject: "attachment" });
      return;
    }
    itemBudget.spendCall();
    const outcome = await fetchAttachment({ ceilingBytes, scopeId, store, transport, url });
    if (outcome.kind === "fetched" && outcome.digest !== undefined) {
      sink.fetched += 1;
      sink.refs.push(attachmentRef({ bytes: outcome.bytes, digest: outcome.digest }));
      continue;
    }
    sink.refused += 1;
    sink.skips.push({
      operation: "notion.files.download",
      reason: outcome.kind === "too-large" ? "result-limit" : "unknown",
      subject: "attachment",
    });
  }
}

/**
 * Fetch every attachment on one page, under the ceiling, and return what to record.
 *
 * @param pageId the page whose file blocks are read
 * @param ceilingBytes the per-file ceiling this run operates under
 * @param itemBudget the page's shared allowance, so an attachment-heavy page cannot run away
 * @param store where the bytes go
 * @returns the ref lines, the skips, and how many were fetched versus refused
 */
export async function fetchPageAttachments({
  client,
  call,
  scopeId,
  pageId,
  ceilingBytes,
  transport,
  store,
  itemBudget,
}: {
  client: BlockChildrenClient;
  call: GatedCall;
  scopeId: string;
  pageId: string;
  ceilingBytes: number;
  transport: AttachmentTransport;
  store: (args: { bytes: Buffer; contentType: string | undefined }) => StoredAttachment;
  itemBudget: NotionItemBudget;
}): Promise<PageAttachments> {
  const sink: AttachmentSink = { fetched: 0, refs: [], refused: 0, skips: [] };
  let cursor: string | undefined;
  do {
    if (itemBudget.exhausted()) {
      sink.skips.push({
        operation: "notion.blocks.children.list",
        reason: "item-deadline",
        subject: "page attachments",
      });
      break;
    }
    itemBudget.spendCall();
    const listed = await listBlockPage({ call, client, cursor, pageId, scopeId });
    if (listed.isErr()) {
      sink.skips.push({ operation: listed.error.operation, reason: "unknown", subject: "page attachments" });
      break;
    }
    await pullFromBlockPage({
      ceilingBytes,
      itemBudget,
      results: listed.value.results,
      scopeId,
      sink,
      store,
      transport,
    });
    cursor = typeof listed.value.next_cursor === "string" ? listed.value.next_cursor : undefined;
  } while (cursor !== undefined);
  return { fetched: sink.fetched, refs: sink.refs, refused: sink.refused, skips: sink.skips };
}
