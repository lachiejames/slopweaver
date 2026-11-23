/**
 * The Notion MEDIA lane — file uploads, block listing, positioned insertion, and marker removal.
 *
 * Separate from `./writeApi.ts` because it is a BLOCK-level lane and that one is a markdown lane. It shares
 * that lane's client, scheduler and 429 scope (see {@link ../notion/writeApi.NotionWriteSeam}) rather than
 * building a second one: Notion's 3 req/s allowance is per-integration, and a page write followed by an
 * attach pass is one caller.
 *
 * ## What was measured before this was written, against a real page
 *
 *  - `fileUploads.create` → `send` returns `status: "uploaded"` for a single-part file in one round trip;
 *    the poll below exists for the `pending` case rather than because one was observed.
 *  - `blocks.children.append` with `position: { type: "after_block" }` inserts EXACTLY after the named
 *    block and leaves every following block in place. That is the ordering guarantee the whole feature
 *    rests on, and the reason `after` (deprecated in this SDK) is not used.
 *  - A PDF goes in Notion's own `pdf` block, not a generic `file` one, and `notion read --pdf` already
 *    extracts from that block type (`./attachments.ts`'s `FILE_BLOCK_TYPES`) — so what this lane writes
 *    is read back by a reader that shipped before it.
 *  - `pages.retrieveMarkdown` renders an uploaded image as a PRE-SIGNED S3 URL that changes on every read,
 *    which is why the update-safety digest normalises it (see `outbound/notion/markdownBody.stableCanonical`).
 *
 * ## Retry posture
 *
 * An `append` may NOT be retried: Notion assigns the block id, so a retried append that already landed
 * inserts a SECOND block. `create`/`send`/`delete` are the same shape and take the same posture. Only the
 * two READS — listing children and polling an upload — keep the transient retry, since repeating them
 * cannot change anything.
 *
 * ## Every write is judged before the wire
 *
 * The seam's client sends through `./guardedFetch.ts`, so `fileUploads.create`, `fileUploads.send`, the append
 * and the delete are each refused before the network on a dead Datadog host or a privacy finding. An upload is
 * also judged whole first, before any provider state changes; see {@link preflightUpload}.
 */
import { toIngestError } from "../../lib/ingestError.js";
import { isRecord } from "../../lib/parsers.js";
import { safeProviderCall } from "../../lib/providerCall.js";
import { err, ok, type Result } from "../../lib/result.js";
import type { MediaBlockType } from "../../outbound/notion/mediaPlaceholder.js";
import { refuseNotionWrite } from "../../outbound/notion/writePrivacy.js";
import { notionUploadRequest } from "../../outbound/notion/writePrivacyPayload.js";
import type { NotionWriteSeam } from "./writeApi.js";
import { type NotionApiError, type NotionWriteError, NotionWriteErrors } from "./writeErrors.js";

/** One block as the marker search needs it: what it is, what it says, and who its parent is. */
export interface PageBlock {
  readonly id: string;
  readonly type: string;
  /** Every rich-text run of the block, concatenated. Empty for a block that carries no text. */
  readonly text: string;
  /** The block this one is a child of — the id an insertion after it must be addressed to. */
  readonly parentId: string;
  readonly hasChildren: boolean;
}

/** The block-level seam one media attach pass needs. */
export interface NotionMediaApi {
  /** One page of a parent's children. `cursor` is undefined for the first page. */
  listChildren(args: {
    parentId: string;
    cursor: string | undefined;
  }): Promise<
    Result<{ readonly blocks: readonly PageBlock[]; readonly nextCursor: string | undefined }, NotionApiError>
  >;
  /** Reserve, send and confirm one single-part upload, returning the `file_upload` id to reference. */
  uploadFile(args: {
    filename: string;
    contentType: string;
    bytes: Uint8Array<ArrayBuffer>;
  }): Promise<Result<string, NotionApiError>>;
  /** Insert one media block directly after `afterBlockId`, under `parentId`. Returns the new block's id. */
  insertMediaAfter(args: {
    parentId: string;
    afterBlockId: string;
    fileUploadId: string;
    caption: string;
    blockType: MediaBlockType;
  }): Promise<Result<string, NotionApiError>>;
  /** Remove one block — used only ever on a marker this lane published itself. */
  deleteBlock(args: { blockId: string }): Promise<Result<undefined, NotionApiError>>;
}

/** The string at `field`, or undefined when it is absent or not a string. */
function stringField({
  record,
  field,
}: {
  record: Readonly<Record<string, unknown>>;
  field: string;
}): string | undefined {
  const value = record[field];
  return typeof value === "string" ? value : undefined;
}

/** Every `plain_text` run of whichever typed body a block carries, concatenated. */
function blockText({ block, type }: { block: Readonly<Record<string, unknown>>; type: string }): string {
  const body = block[type];
  const runs = isRecord(body) ? body["rich_text"] : undefined;
  if (!Array.isArray(runs)) {
    return "";
  }
  return runs
    .flatMap((run: unknown) => {
      const text = isRecord(run) ? stringField({ field: "plain_text", record: run }) : undefined;
      return text === undefined ? [] : [text];
    })
    .join("");
}

/** Narrow one SDK block response into {@link PageBlock}, dropping a partial arm that carries no type. */
function pageBlockOf({ value, parentId }: { value: unknown; parentId: string }): PageBlock | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const id = stringField({ field: "id", record: value });
  const type = stringField({ field: "type", record: value });
  if (id === undefined || type === undefined) {
    return undefined;
  }
  return { hasChildren: value["has_children"] === true, id, parentId, text: blockText({ block: value, type }), type };
}

/** `blocks.children.list` — one page of children, narrowed. Retried transiently: a read changes nothing. */
function listChildrenMethod({ client, call, scopeId }: NotionWriteSeam): NotionMediaApi["listChildren"] {
  return async ({ parentId, cursor }) => {
    const called = await safeProviderCall({
      execute: () =>
        call(() =>
          client.blocks.children.list({
            block_id: parentId,
            page_size: 100,
            ...(cursor === undefined ? {} : { start_cursor: cursor }),
          }),
        ),
      operation: "notion.blocks.children.mediaAttach",
      provider: "notion",
      retryMode: "transient",
      scopeId,
    });
    if (called.isErr()) {
      return err(called.error);
    }
    const blocks = called.value.results.flatMap((value) => {
      const block = pageBlockOf({ parentId, value });
      return block === undefined ? [] : [block];
    });
    return ok({ blocks, nextCursor: called.value.next_cursor ?? undefined });
  };
}

/** How many times an upload left `pending` by `send` is re-read before it is called a failure. */
const UPLOAD_POLL_MAX = 10;

/** `fileUploads.create` — reserve the upload. NEVER retried: a retry reserves a second upload. */
async function reserveUpload({
  seam,
  filename,
  contentType,
}: {
  seam: NotionWriteSeam;
  filename: string;
  contentType: string;
}): Promise<Result<string, NotionApiError>> {
  const called = await safeProviderCall({
    execute: () =>
      seam.call(() => seam.client.fileUploads.create({ content_type: contentType, filename, mode: "single_part" })),
    operation: "notion.fileUploads.create",
    provider: "notion",
    retryMode: "never",
    scopeId: seam.scopeId,
  });
  return called.isErr() ? err(called.error) : ok(called.value.id);
}

/** `fileUploads.send` — the multipart body. NEVER retried: a retry re-sends the bytes against a used slot. */
async function sendUpload({
  seam,
  uploadId,
  filename,
  contentType,
  bytes,
}: {
  seam: NotionWriteSeam;
  uploadId: string;
  filename: string;
  contentType: string;
  bytes: Uint8Array<ArrayBuffer>;
}): Promise<Result<string, NotionApiError>> {
  const called = await safeProviderCall({
    execute: () =>
      seam.call(() =>
        seam.client.fileUploads.send({
          file: { data: new Blob([bytes], { type: contentType }), filename },
          file_upload_id: uploadId,
        }),
      ),
    operation: "notion.fileUploads.send",
    provider: "notion",
    retryMode: "never",
    scopeId: seam.scopeId,
  });
  return called.isErr() ? err(called.error) : ok(called.value.status);
}

/** `fileUploads.retrieve` — the status poll. Retried transiently: a read changes nothing. */
async function readUploadStatus({
  seam,
  uploadId,
}: {
  seam: NotionWriteSeam;
  uploadId: string;
}): Promise<Result<string, NotionApiError>> {
  const called = await safeProviderCall({
    execute: () => seam.call(() => seam.client.fileUploads.retrieve({ file_upload_id: uploadId })),
    operation: "notion.fileUploads.retrieve",
    provider: "notion",
    retryMode: "transient",
    scopeId: seam.scopeId,
  });
  return called.isErr() ? err(called.error) : ok(called.value.status);
}

/**
 * Judge the whole upload BEFORE its slot is reserved: `fileUploads.create` carries only the name and type, so
 * without this a text file whose bytes the policy refuses would leave an unused slot behind in Notion. Both
 * requests are still judged again at the transport, each under a policy loaded afresh. The refusal is mapped
 * into an `IngestError` whose `cause` is the guard's own error, exactly as a transport refusal arrives.
 */
async function preflightUpload({
  seam,
  filename,
  contentType,
  bytes,
}: {
  seam: NotionWriteSeam;
  filename: string;
  contentType: string;
  bytes: Uint8Array;
}): Promise<Result<undefined, NotionApiError>> {
  try {
    await refuseNotionWrite({ privacy: seam.privacy, request: notionUploadRequest({ bytes, contentType, filename }) });
    return ok(undefined);
  } catch (error: unknown) {
    return err(toIngestError({ error, operation: "notion.fileUploads.preflight", provider: "notion" }));
  }
}

/** Judge, create, send, then confirm `uploaded` — the whole upload, reported as one id or one refusal. */
function uploadFileMethod(seam: NotionWriteSeam): NotionMediaApi["uploadFile"] {
  return async ({ filename, contentType, bytes }) => {
    const judged = await preflightUpload({ bytes, contentType, filename, seam });
    if (judged.isErr()) {
      return err(judged.error);
    }
    const reserved = await reserveUpload({ contentType, filename, seam });
    if (reserved.isErr()) {
      return err(reserved.error);
    }
    const uploadId = reserved.value;
    const sent = await sendUpload({ bytes, contentType, filename, seam, uploadId });
    if (sent.isErr()) {
      return err(sent.error);
    }
    let status = sent.value;
    for (let poll = 0; poll < UPLOAD_POLL_MAX && status === "pending"; poll += 1) {
      const read = await readUploadStatus({ seam, uploadId });
      if (read.isErr()) {
        return err(read.error);
      }
      status = read.value;
    }
    return uploadConfirmed({ filename, status, uploadId }).mapErr((error): NotionApiError => error);
  };
}

/**
 * The upload id once Notion reports it `uploaded`, or the refusal naming the status it was left in. Pure.
 *
 * @returns the upload id to reference, or `UPLOAD_UNFINISHED` naming the status Notion left it in
 */
export function uploadConfirmed({
  uploadId,
  filename,
  status,
}: {
  uploadId: string;
  filename: string;
  status: string;
}): Result<string, NotionWriteError> {
  return status === "uploaded" ? ok(uploadId) : err(NotionWriteErrors.uploadUnfinished({ filename, status, uploadId }));
}

/**
 * The one block literal, branched rather than keyed dynamically.
 *
 * A computed key (`{ [blockType]: body, type: blockType }`) does not typecheck: the SDK types `children`
 * as a discriminated union, so the two arms have to be spelled. Written side by side rather than behind a
 * cast, because the cast is what would let a body and a type drift apart.
 */
function mediaBlock({
  blockType,
  fileUploadId,
  caption,
}: {
  blockType: MediaBlockType;
  fileUploadId: string;
  caption: string;
}): Parameters<NotionWriteSeam["client"]["blocks"]["children"]["append"]>[0]["children"][number] {
  const body = {
    ...(caption === "" ? {} : { caption: [{ text: { content: caption }, type: "text" as const }] }),
    file_upload: { id: fileUploadId },
  };
  if (blockType === "pdf") {
    return { object: "block", pdf: body, type: "pdf" };
  }
  return { image: body, object: "block", type: "image" };
}

/** `blocks.children.append` at an explicit position. NEVER retried: a retry inserts a second block. */
function insertMediaAfterMethod({ client, call, scopeId }: NotionWriteSeam): NotionMediaApi["insertMediaAfter"] {
  return async ({ parentId, afterBlockId, fileUploadId, caption, blockType }) => {
    const called = await safeProviderCall({
      execute: () =>
        call(() =>
          client.blocks.children.append({
            block_id: parentId,
            children: [mediaBlock({ blockType, caption, fileUploadId })],
            position: { after_block: { id: afterBlockId }, type: "after_block" },
          }),
        ),
      operation: "notion.blocks.children.append",
      provider: "notion",
      retryMode: "never",
      scopeId,
    });
    if (called.isErr()) {
      return err(called.error);
    }
    return insertedBlockId({ results: called.value.results }).mapErr((error): NotionApiError => error);
  };
}

/**
 * The new block's id off an append response, or the refusal when Notion returned none. Pure.
 *
 * @param results the append response's `results`, whose first entry is the inserted block
 * @returns the block id, or `RESPONSE_INCOMPLETE` when the first result carries none
 */
export function insertedBlockId({ results }: { results: readonly unknown[] }): Result<string, NotionWriteError> {
  const first = results[0];
  const id = isRecord(first) ? stringField({ field: "id", record: first }) : undefined;
  return id === undefined ? err(NotionWriteErrors.blockIdMissing()) : ok(id);
}

/** `blocks.delete` — the marker's removal. NEVER retried: a second delete would target someone else's block. */
function deleteBlockMethod({ client, call, scopeId }: NotionWriteSeam): NotionMediaApi["deleteBlock"] {
  return async ({ blockId }) => {
    const called = await safeProviderCall({
      execute: () => call(() => client.blocks.delete({ block_id: blockId })),
      operation: "notion.blocks.delete",
      provider: "notion",
      retryMode: "never",
      scopeId,
    });
    return called.isErr() ? err(called.error) : ok(undefined);
  };
}

/**
 * Build the Notion media seam over an existing write seam.
 *
 * @param seam the write lane's client, paced runner and 429 scope
 * @returns the block-level methods one attach pass needs
 */
export function makeNotionMediaApi({ seam }: { seam: NotionWriteSeam }): NotionMediaApi {
  return {
    deleteBlock: deleteBlockMethod(seam),
    insertMediaAfter: insertMediaAfterMethod(seam),
    listChildren: listChildrenMethod(seam),
    uploadFile: uploadFileMethod(seam),
  };
}
