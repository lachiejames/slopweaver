import { parseIsoMs, parseYyyyMmDdUtcMs } from "../../lib/date.js";
import { isRecord } from "../../lib/parsers.js";
import { chunkText } from "../chunkText.js";
import { buildMemberIdentity } from "../members/email.js";
import type { MemberBronzeRow } from "../members/types.js";
import { optStr as notionStr } from "../slack/shape.js";
import { renderBlockText } from "./blockText.js";
import { extractFilePropertyRefs, extractMentions, extractRelationTargets } from "./curated.js";
import { renderRichText, renderRowProperties } from "./fetchRender.js";
import type { NotionCommentItem, NotionDatabaseItem, NotionPageItem } from "./project.js";

/**
 * The title of a page/database object. A top-level `title` array, when present, is rendered and decides the
 * answer even when it is empty; only when it is absent is the first title-typed entry of `properties` read.
 * Pure.
 *
 * @param raw the raw page/database/data-source object
 * @returns the rendered title (empty when the shape found renders nothing), or `(untitled)` when neither shape
 *   is present
 */
export function titleFrom({ raw }: { raw: Record<string, unknown> }): string {
  if (Array.isArray(raw["title"])) {
    return renderRichText({ richText: raw["title"] });
  }
  const properties = raw["properties"];
  if (isRecord(properties)) {
    for (const value of Object.values(properties)) {
      if (isRecord(value) && value["type"] === "title") {
        return renderRichText({ richText: value["title"] });
      }
    }
  }
  return "(untitled)";
}

/**
 * The rendered rich-text line of one raw block (empty when the block has no rich-text body). Pure.
 *
 * @param block one raw block; its body lives under a key named by its own `type` field, so the shape is
 *   read dynamically rather than typed
 * @returns the rendered line, or empty for a block with no rich-text body (an image, a divider)
 */
export function blockTextLine({ block }: { block: Record<string, unknown> }): string {
  return renderBlockText({ block, render: renderRichText });
}

/**
 * The explicit mention target node keys in one raw block's rich text (page/database/user spans). Pure.
 *
 * @param block one raw block, read dynamically via its own `type` key
 * @returns the mention target keys in span order — only EXPLICIT mentions, never a guess from prose text
 */
export function blockMentions({ block }: { block: Record<string, unknown> }): readonly string[] {
  const type = typeof block["type"] === "string" ? block["type"] : undefined;
  const body = type !== undefined ? block[type] : undefined;
  return isRecord(body) ? extractMentions({ richText: body["rich_text"] }) : [];
}

/**
 * Block types whose CONTENT belongs to another Notion object, and is only inlined here.
 *
 * `child_page` is the measured case and the reason this set exists: `docs/notion-coverage.md` records that
 * **51% of child pages are invisible to `search`**, so for half of them the parent's rendered body is the
 * only copy of their text in the corpus. A child's edit does not move the PARENT's `last_edited_time`, so
 * a parent that inlines one can be "unchanged" while the bytes stored under it are stale. `child_database`
 * and `synced_block` carry the same ownership shape for the same reason.
 */
const BORROWED_CONTENT_BLOCK_TYPES: ReadonlySet<string> = new Set(["child_page", "child_database", "synced_block"]);

/**
 * Whether this block inlines content owned by another Notion object (see
 * {@link BORROWED_CONTENT_BLOCK_TYPES}). Pure.
 *
 * @param block one raw block, read dynamically via its own `type` key
 * @returns true when the block's content can change without this page's own timestamp moving
 */
export function blockBorrowsContent({ block }: { block: Record<string, unknown> }): boolean {
  return typeof block["type"] === "string" && BORROWED_CONTENT_BLOCK_TYPES.has(block["type"]);
}

/**
 * The child block id to recurse into (`has_children` + a string id), or undefined. Pure.
 *
 * @param block one raw block
 * @returns the id to recurse into, or undefined when the block is a leaf or its id is not a string
 */
export function blockChildId({ block }: { block: Record<string, unknown> }): string | undefined {
  return block["has_children"] === true && typeof block["id"] === "string" ? block["id"] : undefined;
}

/**
 * The `since` cutoff in epoch-ms, or undefined when `since` means "no cutoff" (the `--all` epoch date).
 *
 * @param since the window's lower bound as `YYYY-MM-DD`; anything at or before the epoch date means `--all`
 * @returns the cutoff in epoch-ms, or undefined to keep everything
 */
export function cutoffMs({ since }: { since: string }): number | undefined {
  if (since <= "1970-01-01") {
    return undefined;
  }
  return parseYyyyMmDdUtcMs({ date: since });
}

/**
 * Whether a result's `last_edited_time` is at/after the cutoff (undated or no-cutoff ⇒ keep).
 *
 * @param lastEdited the result's raw `last_edited_time`; an unparseable or empty value is KEPT, never dropped
 * @param cutoff the epoch-ms cutoff from {@link cutoffMs}, or undefined to keep everything
 * @returns true when the result falls inside the window
 */
export function withinCutoff({ lastEdited, cutoff }: { lastEdited: string; cutoff: number | undefined }): boolean {
  if (cutoff === undefined) {
    return true;
  }
  const ms = parseIsoMs({ tsIso: lastEdited });
  return ms === undefined ? true : ms >= cutoff;
}

// The Notion `next_cursor` off a raw search/list response — non-empty string ⇒ another page, else stop.
// Re-exported under this name: the shared decoder is `optStr` in `corpus/slack/shape.ts`.
export { optStr as notionNextCursor } from "../slack/shape.js";

/**
 * The `last_edited_time` of a raw Notion object (empty when absent). Pure.
 *
 * @param raw any raw Notion object — page, database or row
 * @returns the ISO timestamp, or empty when the field is absent or not a string
 */
export function lastEditedOf({ raw }: { raw: Record<string, unknown> }): string {
  return typeof raw["last_edited_time"] === "string" ? raw["last_edited_time"] : "";
}

/**
 * Project a raw Notion `data_source` search hit into a database summary item (title + url). Pure.
 *
 * @param raw the search hit, kept verbatim on the item so nothing is lost to the projection
 * @param id the resolved data-source id — taken from the caller, not re-read from `raw`
 * @param lastEdited the timestamp the record is filed under
 * @returns the database item, with an empty description (Notion does not return one on a search hit)
 */
export function projectDatabaseItem({
  raw,
  id,
  lastEdited,
}: {
  raw: Record<string, unknown>;
  id: string;
  lastEdited: string;
}): NotionDatabaseItem {
  return {
    description: "",
    id,
    raw,
    title: titleFrom({ raw }),
    tsIso: lastEdited,
    url: typeof raw["url"] === "string" ? raw["url"] : "",
  };
}

/**
 * Project a raw Notion page into a page item (its rendered text chunked, comments + curated refs attached). Pure.
 *
 * @param raw the raw page, kept verbatim on the item
 * @param id the page id, supplied by the caller rather than re-read from `raw`
 * @param lastEdited the timestamp the record is filed under
 * @param text the already-rendered body, which this chunks — block fetching happens upstream
 * @param comments the page's comments, already fetched and projected
 * @param mentionTargets explicit mention targets from the body; omitted keys are left off the item entirely
 * @param fileRefs file references found in the body; omitted keys are left off the item entirely
 * @param partial whether the block crawl was cut short (depth cap or per-item budget), so the text is a
 *   PART of the page — recorded on the item so the record can say so and `seenIndex.ts` never skips it
 * @param bodyDigest names the parsed body a run put in the sidecar; omitted when no body store was given
 * @returns the page item, with relation targets extracted from its properties
 */
export function projectPageItem({
  raw,
  id,
  lastEdited,
  text,
  comments,
  mentionTargets = [],
  fileRefs = [],
  partial = false,
  bodyDigest,
}: {
  raw: Record<string, unknown>;
  id: string;
  lastEdited: string;
  text: string;
  comments: readonly NotionCommentItem[];
  mentionTargets?: readonly string[];
  fileRefs?: readonly string[];
  partial?: boolean;
  bodyDigest?: string;
}): NotionPageItem {
  const relationTargets = extractRelationTargets({ properties: raw["properties"] });
  return {
    chunks: chunkText({ text }),
    comments,
    id,
    raw,
    title: titleFrom({ raw }),
    tsIso: lastEdited,
    url: typeof raw["url"] === "string" ? raw["url"] : "",
    ...(partial ? { partial: true } : {}),
    ...(relationTargets.length > 0 ? { relationTargets } : {}),
    ...(mentionTargets.length > 0 ? { mentionTargets } : {}),
    ...(fileRefs.length > 0 ? { fileRefs } : {}),
    ...(bodyDigest !== undefined ? { bodyDigest } : {}),
  };
}

/**
 * Project a raw data-source ROW into a page item (properties flattened + chunked, relations/files/comments). Pure.
 *
 * @param raw the raw row, kept verbatim on the item
 * @param id the row id
 * @param lastEdited the timestamp the record is filed under
 * @param dataSourceId the owning data source, recorded as the item's `parent`
 * @param comments the row's comments, already fetched and projected
 * @param partial whether the row's own crawl was cut short (its comment paging hit the per-item budget)
 * @returns the page item; a row whose properties render no title falls back to `(row)`
 */
export function projectRowItem({
  raw,
  id,
  dataSourceId,
  lastEdited,
  comments = [],
  partial = false,
}: {
  raw: Record<string, unknown>;
  id: string;
  dataSourceId: string;
  lastEdited: string;
  comments?: readonly NotionCommentItem[];
  partial?: boolean;
}): NotionPageItem {
  const { title, text } = renderRowProperties({ properties: raw["properties"] });
  const relationTargets = extractRelationTargets({ properties: raw["properties"] });
  const fileRefs = extractFilePropertyRefs({ properties: raw["properties"] });
  return {
    chunks: chunkText({ text }),
    comments,
    id,
    parent: dataSourceId,
    raw,
    title: title.length > 0 ? title : "(row)",
    tsIso: lastEdited,
    url: typeof raw["url"] === "string" ? raw["url"] : "",
    ...(partial ? { partial: true } : {}),
    ...(relationTargets.length > 0 ? { relationTargets } : {}),
    ...(fileRefs.length > 0 ? { fileRefs } : {}),
  };
}

/**
 * Project one raw Notion `users.list` object into a {@link MemberBronzeRow}. Email is captured ONLY for a
 * `type === "person"` (bots have none) AND only when the integration's user-email capability granted it
 * (else a warning + `missing` trust — never a guessed email). The full raw user is kept. Pure.
 *
 * @param raw the raw user object
 * @param fetchedAtIso the hydration timestamp
 * @returns the member row, or `undefined` when id-less
 */
export function projectNotionUser({
  raw,
  fetchedAtIso,
}: {
  raw: unknown;
  fetchedAtIso: string;
}): MemberBronzeRow | undefined {
  const id = isRecord(raw) ? notionStr({ value: raw["id"] }) : undefined;
  if (!isRecord(raw) || id === undefined) {
    return undefined;
  }
  const isBot = raw["type"] === "bot";
  const person = isRecord(raw["person"]) ? raw["person"] : {};
  const email = isBot ? undefined : notionStr({ value: person["email"] });
  const name = notionStr({ value: raw["name"] });
  const avatarUrl = notionStr({ value: raw["avatar_url"] });
  return {
    fetchedAtIso,
    identity: buildMemberIdentity({
      nativeId: id,
      source: "notion",
      ...(name !== undefined ? { name } : {}),
      ...(email !== undefined ? { email } : {}),
    }),
    profile: { bot: isBot, ...(avatarUrl !== undefined ? { avatarUrl } : {}) },
    provenance: ["notion.users.list"],
    raw,
    source: "notion",
    sourceId: id,
    version: 1,
    warnings:
      !isBot && email === undefined ? ["no email — the Notion integration lacks the read-user-email capability"] : [],
  };
}

/**
 * Project a raw Notion comment into a comment item (its rich text rendered). Pure; undefined if id-less.
 *
 * @param raw one entry from a comments response, of unvalidated shape
 * @returns the comment item, or undefined when it is not a record or has no string id — a comment that
 *   cannot be identified is dropped rather than filed under a synthesised key
 */
export function projectCommentItem({ raw }: { raw: unknown }): NotionCommentItem | undefined {
  if (!isRecord(raw) || typeof raw["id"] !== "string") {
    return undefined;
  }
  // `author` was declared on the item and never populated, so every Notion comment reached the corpus
  // anonymous — which makes "who discussed this" unanswerable for the one record kind that IS a discussion.
  // The native user id is the convention the other connectors use (Slack files `raw.user` verbatim); the
  // members store resolves it to a person, and an EXPLICIT id is the only identity signal allowed here.
  const createdBy = raw["created_by"];
  const author = isRecord(createdBy) ? notionStr({ value: createdBy["id"] }) : undefined;
  return {
    body: renderRichText({ richText: raw["rich_text"] }),
    id: raw["id"],
    raw,
    tsIso: typeof raw["created_time"] === "string" ? raw["created_time"] : "",
    ...(author !== undefined ? { author } : {}),
  };
}
