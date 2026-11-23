/**
 * The media attach PASS: upload each placeholder's file and insert its own block exactly where the
 * placeholder stood, then delete the marker that held the place.
 *
 * Shared by two callers rather than duplicated: `notion page create|update` runs it inside the write it has
 * already admitted, and `notion attach` runs it on its own for a repair or a re-run. Both get the same
 * ordering guarantee and the same idempotence, because there is one implementation.
 *
 * ## Three properties that are the whole point
 *
 *  - **Every file is read and checked BEFORE anything is uploaded.** A page that half-attached is a page a
 *    reader sees mid-edit, and the cheap refusal (a missing file, a 30MB document, a PDF written with the
 *    image sigil) is exactly the one worth making before the first byte leaves.
 *  - **An absent marker means ALREADY ATTACHED, not failure.** That is what makes a second run a no-op, and
 *    it is why a partial failure is recoverable by simply running the pass again.
 *  - **A per-item failure does not sink the batch.** The files that can attach do; the ones that cannot are
 *    reported with their reason and leave their markers in place for the next run.
 */
import type { NotionMediaApi } from "../../../corpus/notion/mediaApi.js";
import {
  type MarkerCandidate,
  type MediaBlockType,
  type MediaPlaceholder,
  markerBlocksOf,
  mediaPlaceholders,
  resolveMediaPath,
  uploadableMedia,
} from "../../../outbound/notion/mediaPlaceholder.js";
import { isPdf } from "../../../pdf/text.js";
import { alreadyInserted, readBlocks } from "./mediaPageRead.js";

/** One file this pass put on the page, and which block it became. */
interface AttachedMedia {
  readonly placeholderId: string;
  readonly source: string;
  readonly blockId: string;
  readonly blockType: MediaBlockType;
  readonly fileUploadId: string;
  readonly bytes: number;
}

/** What one attach pass did. Every arm is reported; nothing is inferred from an exit code. */
export interface AttachReport {
  readonly placeholders: number;
  readonly attached: readonly AttachedMedia[];
  /** Placeholders whose marker was already gone — the page already carries their file. */
  readonly alreadyAttached: readonly string[];
  /** One line per placeholder that could not be attached, naming why. */
  readonly failures: readonly string[];
}

/** The file edge, injected so the pass is exercised without touching a disk. */
export interface MediaFileReader {
  (args: { path: string }): { readonly bytes: Uint8Array<ArrayBuffer> } | { readonly error: string };
}

/** One placeholder, its bytes, the content type they are declared with and the block they become. */
interface ReadyMedia {
  readonly placeholder: MediaPlaceholder;
  readonly path: string;
  readonly contentType: string;
  readonly blockType: MediaBlockType;
  readonly bytes: Uint8Array<ArrayBuffer>;
}

/**
 * Read and check every placeholder's file. All-or-nothing: one bad file refuses the whole pass.
 *
 * The extension decides the BLOCK, and for a `pdf` block the BYTES then have to agree — `%PDF-`, the
 * same five-byte test `src/pdf/attachment.ts` applies on the read side, because a name is a claim and
 * bytes are the fact. The check is one-directional on purpose: a wrong image renders visibly broken and
 * an author sees it, while a `pdf` block holding something else opens as nothing with Notion reporting
 * no error, and there is no single magic to test the twelve image formats against anyway.
 */
function readAll({
  placeholders,
  baseDir,
  readMedia,
}: {
  placeholders: readonly MediaPlaceholder[];
  baseDir: string;
  readMedia: MediaFileReader;
}): { readonly ready: readonly ReadyMedia[] } | { readonly errors: readonly string[] } {
  const ready: ReadyMedia[] = [];
  const errors: string[] = [];
  for (const placeholder of placeholders) {
    const path = resolveMediaPath({ baseDir, source: placeholder.source });
    const read = readMedia({ path });
    if ("error" in read) {
      errors.push(`line ${String(placeholder.line)}: ${read.error}`);
      continue;
    }
    const checked = uploadableMedia({ bytes: read.bytes.byteLength, kind: placeholder.kind, path });
    if (!checked.isOk()) {
      errors.push(`line ${String(placeholder.line)}: ${checked.error}`);
      continue;
    }
    if (checked.value.blockType === "pdf" && !isPdf({ bytes: read.bytes })) {
      errors.push(
        `line ${String(placeholder.line)}: ${path} is named like a PDF but does not begin with ` +
          "`%PDF-`, so Notion would hold a `pdf` block nothing can open and report no error at all. " +
          "Check the file is what its name claims.",
      );
      continue;
    }
    ready.push({
      blockType: checked.value.blockType,
      bytes: read.bytes,
      contentType: checked.value.contentType,
      path,
      placeholder,
    });
  }
  return errors.length > 0 ? { errors } : { ready };
}

/** Upload one file and insert its block after its marker, then remove the marker. */
async function attachOne({
  api,
  ready,
  marker,
}: {
  api: NotionMediaApi;
  ready: ReadyMedia;
  marker: { readonly blockId: string; readonly parentId: string };
}): Promise<{ readonly attached: AttachedMedia } | { readonly error: string }> {
  const { placeholder, path, contentType, blockType, bytes } = ready;
  const filename = path.slice(path.lastIndexOf("/") + 1);
  const uploaded = await api.uploadFile({ bytes, contentType, filename });
  if (uploaded.isErr()) {
    return { error: `line ${String(placeholder.line)}: uploading ${path} failed: ${uploaded.error.message}` };
  }
  const inserted = await api.insertMediaAfter({
    afterBlockId: marker.blockId,
    blockType,
    caption: placeholder.caption,
    fileUploadId: uploaded.value,
    parentId: marker.parentId,
  });
  if (inserted.isErr()) {
    return { error: `line ${String(placeholder.line)}: inserting ${path} failed: ${inserted.error.message}` };
  }
  // The marker is deleted LAST and its failure is not fatal: the block is already in the right place, and a
  // leftover marker is a visible line of text rather than a lost file. Reporting it lets a re-run clear it.
  const removed = await api.deleteBlock({ blockId: marker.blockId });
  const attached: AttachedMedia = {
    blockId: inserted.value,
    blockType,
    bytes: bytes.byteLength,
    fileUploadId: uploaded.value,
    placeholderId: placeholder.id,
    source: placeholder.source,
  };
  return removed.isErr()
    ? {
        error: `line ${String(placeholder.line)}: ${path} was attached but its marker could not be removed: ${removed.error.message}`,
      }
    : { attached };
}

/**
 * Clear the marker of a file that is ALREADY on the page.
 *
 * Split out of the pass so the loop reads as one decision per file rather than as a nested repair. The
 * failure is reported rather than thrown because the page is correct either way — what is left is a stray
 * line of text, and the next run will try to clear it again.
 *
 * @param marker the leftover marker block and the parent it sits under
 * @param ready the file whose upload already landed
 * @returns undefined when the marker is gone, else the line saying it could not be removed
 */
async function sweepLeftoverMarker({
  api,
  marker,
  ready,
}: {
  api: NotionMediaApi;
  marker: { readonly blockId: string; readonly parentId: string };
  ready: ReadyMedia;
}): Promise<string | undefined> {
  const swept = await api.deleteBlock({ blockId: marker.blockId });
  if (swept.isErr()) {
    return (
      `line ${String(ready.placeholder.line)}: ${ready.path} is already on the page and its leftover ` +
      `marker still could not be removed: ${swept.error.message}`
    );
  }
  return undefined;
}

/**
 * What one file's attach came to.
 *
 * Three outcomes rather than two, because "already there" is a success that uploaded nothing and a report
 * that folded it into `attached` would claim work the pass did not do.
 */
type SettledMedia =
  | { readonly kind: "attached"; readonly media: AttachedMedia }
  | { readonly kind: "already"; readonly source: string }
  | { readonly kind: "failed"; readonly failure: string };

/**
 * Decide and perform ONE file's attach, given the page as it stands.
 *
 * The whole per-file decision lives here so the pass itself is a loop over outcomes: a missing marker, a
 * marker whose file already landed, and a marker with work still to do are three readings of the same page
 * state, and reading them inside the accumulation loop is what made that loop unreviewable.
 *
 * @param blocks the page as it was read, for deciding whether a marker's file already landed
 * @param markers every marker still standing, by placeholder id
 * @param ready the file and the placeholder it belongs to
 * @returns which of the three outcomes this file reached
 */
async function settleOne({
  api,
  blocks,
  markers,
  ready,
}: {
  api: NotionMediaApi;
  blocks: readonly MarkerCandidate[];
  markers: ReadonlyMap<string, { readonly blockId: string; readonly parentId: string }>;
  ready: ReadyMedia;
}): Promise<SettledMedia> {
  const marker = markers.get(ready.placeholder.id);
  if (marker === undefined) {
    return { kind: "already", source: ready.placeholder.source };
  }
  if (alreadyInserted({ blocks, marker })) {
    const swept = await sweepLeftoverMarker({ api, marker, ready });
    if (swept !== undefined) {
      return { failure: swept, kind: "failed" };
    }
    return { kind: "already", source: ready.placeholder.source };
  }
  const done = await attachOne({ api, marker, ready });
  if ("error" in done) {
    return { failure: done.error, kind: "failed" };
  }
  return { kind: "attached", media: done.attached };
}

/**
 * Run one attach pass over a published page.
 *
 * @param api the block-level Notion seam
 * @param pageId the page the markers were published to
 * @param markdown the AUTHORED body, still carrying its `file:` placeholders
 * @param baseDir the directory relative paths in those placeholders resolve against
 * @param readMedia the file edge
 * @returns what was attached, what was already there, and what could not be
 */
export async function attachMedia({
  api,
  pageId,
  markdown,
  baseDir,
  readMedia,
}: {
  api: NotionMediaApi;
  pageId: string;
  markdown: string;
  baseDir: string;
  readMedia: MediaFileReader;
}): Promise<AttachReport> {
  const placeholders = mediaPlaceholders({ markdown });
  const empty = { alreadyAttached: [], attached: [], placeholders: placeholders.length } as const;
  if (placeholders.length === 0) {
    return { ...empty, failures: [] };
  }
  const files = readAll({ baseDir, placeholders, readMedia });
  if ("errors" in files) {
    return { ...empty, failures: files.errors };
  }
  const read = await readBlocks({ api, pageId });
  if ("error" in read) {
    return { ...empty, failures: [read.error] };
  }
  const markers = markerBlocksOf({ blocks: read.blocks });
  const attached: AttachedMedia[] = [];
  const alreadyAttached: string[] = [];
  const failures: string[] = [];
  for (const ready of files.ready) {
    const settled = await settleOne({ api, blocks: read.blocks, markers, ready });
    if (settled.kind === "attached") {
      attached.push(settled.media);
      continue;
    }
    if (settled.kind === "already") {
      alreadyAttached.push(settled.source);
      continue;
    }
    failures.push(settled.failure);
  }
  return { alreadyAttached, attached, failures, placeholders: placeholders.length };
}

/**
 * The operator-facing lines for one attach pass.
 *
 * @param report what the pass did
 * @returns the lines to print, empty when the body carried no placeholders at all
 */
export function attachReportLines({ report }: { report: AttachReport }): readonly string[] {
  if (report.placeholders === 0) {
    return [];
  }
  return [
    `files: ${String(report.attached.length)} attached, ${String(report.alreadyAttached.length)} already in place, ` +
      `${String(report.failures.length)} failed, of ${String(report.placeholders)} placeholder(s)`,
    ...report.attached.map(
      (media) => `  + ${media.source} → ${media.blockType} block ${media.blockId} (${String(media.bytes)} bytes)`,
    ),
    ...report.alreadyAttached.map((source) => `  = ${source} (its marker is gone, so the file is already there)`),
    ...report.failures.map((failure) => `  ! ${failure}`),
  ];
}
