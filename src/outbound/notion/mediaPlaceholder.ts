/**
 * The media PLACEHOLDER contract: `![caption](file:./shots/hero.png)` or `[caption](file:./dpa.pdf)` in the
 * markdown, a marker paragraph on the page, and the block that replaces the marker exactly where it stood.
 *
 * ## Why a marker at all, rather than uploading first and writing the URL in
 *
 * Notion's write lane sends MARKDOWN and lets Notion build the blocks (see `corpus/notion/writeApi.ts`), and
 * a `file_upload` id is not expressible in markdown. The only way to reference an uploaded file is a
 * block-level `image` or `pdf` block, which means a second pass after the page exists. Left to itself that
 * pass would APPEND, and the owner's constraint is the opposite one: "with Notion the ordering of blocks
 * matters — you don't want all the images appended to the end". So the first pass writes a marker paragraph
 * AT THE PLACEHOLDER'S POSITION, and the second pass inserts the block directly after its own marker and
 * deletes it. Order is preserved from the start rather than reconstructed afterwards.
 *
 * ## The marker token names a POSITION, never a kind
 *
 * `[slopweaver-image:<id>]` is a position SLOT and nothing else. The attach pass re-reads the AUTHORED
 * markdown, so the kind of every placeholder comes from its own sigil and extension and never from the
 * marker — which is why the token did not need renaming when this lane stopped being only about images.
 * Renaming it would in fact be a defect: `markerBlocksOf` is keyed by placeholder id and an UNRECOGNISED
 * marker reads as ALREADY ATTACHED, so a page a half-failed pass left mid-attach would have its file
 * silently skipped and its marker left standing.
 *
 * ## Why `file:` rather than a bare relative path
 *
 * Notion ACCEPTS `![cap](./hero.png)` and silently builds a broken external-image block from it — measured
 * against a real page, not assumed. So a local path cannot be distinguished from a mistake by the provider,
 * and this repo needs a spelling that says "upload this" rather than one that merely fails to be a URL.
 * A bare local path therefore stays REFUSED by `checkMarkdownBody`, and `file:` is the opt-in. The link
 * form carries the same trap and the same refusal, scoped to the extensions this lane could have uploaded.
 *
 * ## The sigil picks the kind, and the extension has to agree
 *
 * `!` means an `image` block and no `!` means a `pdf` block, and a placeholder whose extension disagrees
 * with its sigil is REFUSED naming both. One spelling per kind is what keeps a reader able to tell from the
 * markdown alone what the page will look like — a PDF in an image block renders as a broken image, and
 * Notion reports nothing.
 *
 * `audio` and `video` blocks are DELIBERATELY absent rather than merely unimplemented. Nobody asked for
 * them, and the read lane treats a screen recording as not-a-document (`corpus/notion/attachments.ts`), so
 * writing one would emit a block this repo's own reader skips on purpose.
 *
 * Pure: text in, placeholders and markers out. No I/O, no provider client.
 */
import { createHash } from "node:crypto";
import { isAbsolute, resolve } from "node:path";
import { err, ok, type Result } from "../../lib/result.js";

/** Notion's single-part file-upload ceiling. Beyond this an upload must be multi-part, which this lane refuses. */
export const SINGLE_PART_BYTES_MAX = 20 * 1024 * 1024;

/** Which Notion block an uploaded file becomes. Both are types Notion names itself. */
export type MediaBlockType = "image" | "pdf";

/**
 * The files Notion accepts through this lane, mapped to the content type the upload is declared with and the
 * block it becomes. The `pdf` block is Notion's own type, and `notion read --pdf` already extracts from one.
 */
export const MEDIA_CONTENT_TYPES: Readonly<Record<string, { blockType: MediaBlockType; contentType: string }>> = {
  ".bmp": { blockType: "image", contentType: "image/bmp" },
  ".gif": { blockType: "image", contentType: "image/gif" },
  ".heic": { blockType: "image", contentType: "image/heic" },
  ".ico": { blockType: "image", contentType: "image/x-icon" },
  ".jpeg": { blockType: "image", contentType: "image/jpeg" },
  ".jpg": { blockType: "image", contentType: "image/jpeg" },
  ".pdf": { blockType: "pdf", contentType: "application/pdf" },
  ".png": { blockType: "image", contentType: "image/png" },
  ".svg": { blockType: "image", contentType: "image/svg+xml" },
  ".tif": { blockType: "image", contentType: "image/tiff" },
  ".tiff": { blockType: "image", contentType: "image/tiff" },
  ".webp": { blockType: "image", contentType: "image/webp" },
};

/** One `![caption](file:…)` or `[caption](file:…)` placeholder, in document order. */
export interface MediaPlaceholder {
  /** A stable id derived from the placeholder's position and source, safe inside a marker and a filename. */
  readonly id: string;
  /** The block this placeholder's sigil asks for, which its extension then has to agree with. */
  readonly kind: MediaBlockType;
  /** The caption, empty when the placeholder carried none. */
  readonly caption: string;
  /** The path exactly as written after `file:`, before it is resolved against a base directory. */
  readonly source: string;
  /** The marker paragraph text this placeholder is published as. */
  readonly marker: string;
  /** 1-indexed line the placeholder sat on. */
  readonly line: number;
}

/** A whole markdown body rewritten for publication, plus the placeholders that were substituted. */
export interface MarkedBody {
  readonly markdown: string;
  readonly placeholders: readonly MediaPlaceholder[];
}

/**
 * A placeholder image line: `![caption](file:<path>)` alone on its line.
 *
 * Anchored to the whole line on purpose. An inline image inside a paragraph would not become a block of its
 * own, so there would be no position to insert at — and a marker spliced mid-sentence would publish visible
 * junk. A placeholder that is not alone on its line simply is not one, and stays refused as a local path.
 */
const IMAGE_PLACEHOLDER_LINE = /^!\[([^\]]*)\]\(file:([^)\s]+)\)[ \t]*$/;

/** A placeholder document line: `[caption](file:<path>)` alone on its line, anchored for the same reason. */
const FILE_PLACEHOLDER_LINE = /^\[([^\]]*)\]\(file:([^)\s]+)\)[ \t]*$/;

/** The marker paragraph's shape. Plain ASCII, measured to survive Notion's markdown round trip verbatim. */
const MARKER = /^\[slopweaver-image:([0-9a-f]{16})\]$/;

/**
 * The marker paragraph text for one placeholder id.
 *
 * @param id the placeholder id
 * @returns the exact paragraph text to publish at the placeholder's position
 */
export function placeholderMarker({ id }: { id: string }): string {
  return `[slopweaver-image:${id}]`;
}

/**
 * The placeholder id a block's plain text names, or undefined when the text is not a marker.
 *
 * @param text the block's concatenated plain text, as Notion reads it back
 * @returns the placeholder id, or undefined
 */
export function markerIdOf({ text }: { text: string }): string | undefined {
  return MARKER.exec(text.trim())?.[1];
}

/**
 * The stable id for one placeholder.
 *
 * Derived from the POSITION as well as the source, because a document may legitimately place the same file
 * twice and two identical markers would give the attach pass no way to tell the positions apart.
 */
function placeholderId({ index, source, caption }: { index: number; source: string; caption: string }): string {
  return createHash("sha256").update(JSON.stringify({ caption, index, source }), "utf8").digest("hex").slice(0, 16);
}

/** The kind and parts one line asks for, or undefined when the line is not a placeholder at all. */
function placeholderOnLine({
  line,
}: {
  line: string;
}): { readonly caption: string; readonly kind: MediaBlockType; readonly source: string } | undefined {
  const image = IMAGE_PLACEHOLDER_LINE.exec(line);
  if (image !== null) {
    return { caption: image[1]!, kind: "image", source: image[2]! };
  }
  const file = FILE_PLACEHOLDER_LINE.exec(line);
  if (file !== null) {
    return { caption: file[1]!, kind: "pdf", source: file[2]! };
  }
  return undefined;
}

/**
 * Rewrite a body for publication: every `file:` placeholder becomes its marker paragraph, in place.
 *
 * The line count is preserved, so a lint finding's line number still points at the right place, and every
 * other byte of the body is untouched.
 *
 * @param markdown the authored body, carrying `![caption](file:…)` and `[caption](file:…)` placeholders
 * @returns the body Notion is sent, and the placeholders in document order
 */
export function withMediaMarkers({ markdown }: { markdown: string }): MarkedBody {
  const placeholders: MediaPlaceholder[] = [];
  const lines = markdown.split("\n").map((line, at) => {
    const matched = placeholderOnLine({ line });
    if (matched === undefined) {
      return line;
    }
    const { caption, kind, source } = matched;
    const id = placeholderId({ caption, index: placeholders.length, source });
    const marker = placeholderMarker({ id });
    placeholders.push({ caption, id, kind, line: at + 1, marker, source });
    return marker;
  });
  return { markdown: lines.join("\n"), placeholders };
}

/**
 * The placeholders a body carries, without rewriting it.
 *
 * @param markdown the authored body
 * @returns the placeholders in document order
 */
export function mediaPlaceholders({ markdown }: { markdown: string }): readonly MediaPlaceholder[] {
  return withMediaMarkers({ markdown }).placeholders;
}

/**
 * Resolve a placeholder's source against the directory the markdown was authored in.
 *
 * @param source the path exactly as written after `file:`
 * @param baseDir the directory the markdown file lives in
 * @returns the absolute path to read
 */
export function resolveMediaPath({ source, baseDir }: { source: string; baseDir: string }): string {
  return isAbsolute(source) ? source : resolve(baseDir, source);
}

/**
 * The lowercased extension of a path, INCLUDING its dot, which is the key `MEDIA_CONTENT_TYPES` is written in.
 *
 * @returns the extension lowercased with its dot, or an empty string for a path carrying none
 */
export function extensionOf({ path }: { path: string }): string {
  const dot = path.lastIndexOf(".");
  return dot === -1 ? "" : path.slice(dot).toLowerCase();
}

/** What an oversized file should be done about, which is not the same advice for a shot and a document. */
function oversizeRemedy({ blockType }: { blockType: MediaBlockType }): string {
  if (blockType === "pdf") {
    return "Split the document, or link it from a hosted URL instead";
  }
  return "Crop or recompress the shot";
}

/**
 * Whether a file is one this lane can upload, and as what.
 *
 * @param path the resolved media path
 * @param bytes the file's size in bytes
 * @param kind the block the placeholder's own sigil asked for
 * @returns the content type and block type to send, or the refusal naming why the file cannot be sent
 */
export function uploadableMedia({
  path,
  bytes,
  kind,
}: {
  path: string;
  bytes: number;
  kind: MediaBlockType;
}): Result<{ readonly blockType: MediaBlockType; readonly contentType: string }, string> {
  const extension = extensionOf({ path });
  const accepted = MEDIA_CONTENT_TYPES[extension];
  if (accepted === undefined) {
    return err(
      `${path} has extension ${JSON.stringify(extension)}, which Notion does not accept through this lane. ` +
        `Accepted: ${Object.keys(MEDIA_CONTENT_TYPES).join(", ")}.`,
    );
  }
  if (accepted.blockType !== kind) {
    return err(
      `${path} is a ${accepted.blockType} and the placeholder's sigil asks for an ${kind} block. ` +
        "Write an image as `![caption](file:./shot.png)` and a document as `[caption](file:./doc.pdf)`; " +
        "a PDF in an image block renders as a broken image and Notion reports nothing.",
    );
  }
  if (bytes === 0) {
    return err(`${path} is empty, so there is nothing to upload`);
  }
  if (bytes > SINGLE_PART_BYTES_MAX) {
    return err(
      `${path} is ${String(bytes)} bytes and Notion's single-part upload ceiling is ` +
        `${String(SINGLE_PART_BYTES_MAX)}. ${oversizeRemedy({ blockType: accepted.blockType })}; ` +
        "this lane does not do multi-part uploads.",
    );
  }
  return ok({ blockType: accepted.blockType, contentType: accepted.contentType });
}

/** The block types this lane writes, derived from the one registry so the two cannot drift apart. */
export const MEDIA_BLOCK_TYPES: ReadonlySet<string> = new Set(
  Object.values(MEDIA_CONTENT_TYPES).map((accepted) => accepted.blockType),
);

/**
 * The minimum a block must expose for the marker search.
 *
 * `type` is here because a surviving marker has TWO possible meanings — the file never landed, or it
 * landed and only the marker's deletion failed — and the block listed after it is what tells them apart.
 * Without it the second case reads as the first and a re-run attaches a second copy.
 */
export interface MarkerCandidate {
  readonly id: string;
  readonly parentId: string;
  readonly text: string;
  readonly type: string;
}

/** One marker found on a page: which placeholder it stands for, and where a block goes beside it. */
export interface MarkerBlock {
  readonly placeholderId: string;
  readonly blockId: string;
  /** The block the marker is a child of — the id an `after_block` insertion must be addressed to. */
  readonly parentId: string;
}

/**
 * The markers a page carries, keyed by placeholder id.
 *
 * A Map rather than a list because the attach pass walks the PLACEHOLDERS in document order and asks each
 * one whether its marker is still there; a placeholder whose marker is gone was already attached, which is
 * what makes re-running the pass a no-op rather than a second insertion.
 *
 * @param blocks every block read off the page, at any depth
 * @returns placeholder id → the marker block standing for it
 */
export function markerBlocksOf({ blocks }: { blocks: readonly MarkerCandidate[] }): ReadonlyMap<string, MarkerBlock> {
  const found = new Map<string, MarkerBlock>();
  for (const block of blocks) {
    const id = markerIdOf({ text: block.text });
    if (id !== undefined && !found.has(id)) {
      found.set(id, { blockId: block.id, parentId: block.parentId, placeholderId: id });
    }
  }
  return found;
}
