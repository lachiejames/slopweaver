import { absentAsEmpty } from "#lib/absent.js";
import { isRecord } from "../../lib/parsers.js";
import type { CorpusRecord } from "../types.js";
import type { NotionCommentItem, NotionDatabaseItem, NotionPageItem } from "./project.js";
import { projectNotionRecords } from "./project.js";

/**
 * Render a Notion `rich_text` array to plain text, preserving link targets as `text (url)`. Pure.
 *
 * @param richText the raw `rich_text` array (defensively parsed)
 * @returns the rendered plain text
 */
export function renderRichText({ richText }: { richText: unknown }): string {
  if (!Array.isArray(richText)) {
    return "";
  }
  return richText
    .map((span) => {
      if (!isRecord(span)) {
        return "";
      }
      const content = typeof span["plain_text"] === "string" ? span["plain_text"] : "";
      const href = typeof span["href"] === "string" && span["href"].length > 0 ? span["href"] : undefined;
      return href !== undefined ? `${content} (${href})` : content;
    })
    .join("");
}

/** Comma-join the `.name`s of an array of `{name}` objects (multi_select / people). */
function namesOf({ field }: { field: unknown }): string {
  if (!Array.isArray(field)) {
    return "";
  }
  return field
    .map((item) => (isRecord(item) && typeof item["name"] === "string" ? item["name"] : ""))
    .filter((name) => name.length > 0)
    .join(", ");
}

/** Render a Notion `date` property (`start` and optional `end`). */
function dateText({ field }: { field: unknown }): string {
  if (!isRecord(field) || typeof field["start"] !== "string") {
    return "";
  }
  return typeof field["end"] === "string" ? `${field["start"]} → ${field["end"]}` : field["start"];
}

/** Render a rich-text-typed field (title / rich_text). */
function renderRichTextField({ field }: { field: unknown }): string {
  return renderRichText({ richText: field });
}

/** Render a `{name}`-typed field (select / status). */
function renderNameField({ field }: { field: unknown }): string {
  return isRecord(field) && typeof field["name"] === "string" ? field["name"] : "";
}

/** Render a scalar-string field (url / email / phone_number). */
function renderStringField({ field }: { field: unknown }): string {
  return typeof field === "string" ? field : "";
}

/** Render a number field. */
function renderNumberField({ field }: { field: unknown }): string {
  return typeof field === "number" ? String(field) : "";
}

/** Render a checkbox field (`true` ⇒ "yes"). */
function renderCheckboxField({ field }: { field: unknown }): string {
  return field === true ? "yes" : "";
}

/** Render a relation field as a linked-count. */
function renderRelationField({ field }: { field: unknown }): string {
  return Array.isArray(field) ? `${String(field.length)} linked` : "";
}

/** The property-type → renderer dispatch table (replaces the old if-chain; keeps behaviour identical). */
const PROPERTY_RENDERERS: Readonly<Record<string, (args: { field: unknown }) => string>> = {
  checkbox: renderCheckboxField,
  date: (args) => dateText({ field: args.field }),
  email: renderStringField,
  multi_select: (args) => namesOf({ field: args.field }),
  number: renderNumberField,
  people: (args) => namesOf({ field: args.field }),
  phone_number: renderStringField,
  relation: renderRelationField,
  rich_text: renderRichTextField,
  select: renderNameField,
  status: renderNameField,
  title: renderRichTextField,
  url: renderStringField,
};

/**
 * Render one Notion property value to plain text, dispatched on its `type` (title/rich_text/select/
 * status/multi_select/number/checkbox/date/url/email/phone_number/people/relation). Pure.
 *
 * @param value the raw property value object (defensively parsed)
 * @returns the rendered text, or empty for an unknown/empty property
 */
export function renderProperty({ value }: { value: unknown }): string {
  if (!isRecord(value) || typeof value["type"] !== "string") {
    return "";
  }
  const type = value["type"];
  const renderer = PROPERTY_RENDERERS[type];
  return renderer !== undefined ? renderer({ field: value[type] }) : "";
}

/**
 * Flatten a data-source row's `properties` into a title + a `Name: value` text block. Pure — this is
 * what makes a row (a task/decision record) retrievable, not just a database summary.
 *
 * @param properties the raw row `properties` object
 * @returns the row title (the title-typed property) + the rendered property lines
 */
export function renderRowProperties({ properties }: { properties: unknown }): { title: string; text: string } {
  if (!isRecord(properties)) {
    return { text: "", title: "" };
  }
  let title = "";
  const lines: string[] = [];
  for (const [name, value] of Object.entries(properties)) {
    const rendered = renderProperty({ value });
    if (isRecord(value) && value["type"] === "title") {
      title = rendered;
    }
    if (rendered.length > 0) {
      lines.push(`${name}: ${rendered}`);
    }
  }
  return { text: lines.join("\n"), title };
}

/** The union of two possibly-absent string lists, deduped and order-preserving; empty inputs yield `[]`. Pure. */
function unionStrings({
  first,
  second,
}: {
  first: readonly string[] | undefined;
  second: readonly string[] | undefined;
}): readonly string[] {
  return [...new Set([...absentAsEmpty({ value: first }), ...absentAsEmpty({ value: second })])];
}

/**
 * Merge a database row with its own shadow appearance in the `pages` lane's unfiltered-by-parent search —
 * a row IS a Notion `page` object, so the general page search finds it too, independently of the
 * `dataSources.query` that discovered it as a row. Row-led: title, parent and properties-derived chunks
 * come from `row`; `page`'s recursively-rendered block-body chunks are appended rather than dropped, since
 * a row can carry real page content beyond its properties. Comments are deduped by id — both lanes fetch
 * the same page's comments independently, so the two sets are expected to be near-identical, not additive.
 * Pure.
 *
 * `partial` is the one field that is NOT row-led, and deliberately: the merged item carries the page
 * lane's block body, so a block tree the page lane had to truncate makes the MERGED record incomplete
 * however cleanly the row itself read. Row-leading it would have marked a truncated record complete, and
 * `seenIndex.ts` would then have let that truncation authorise skipping the re-fetch that would fix it.
 *
 * The same field also carries a TIMESTAMP SKEW between the lanes, which is the subtler half. The pages
 * lane runs first and to exhaustion — hours before the databases lane on a real workspace — so a row
 * edited in between is read at one `last_edited_time` by one lane and a newer one by the other. The merge
 * is row-led, so the record would go to disk carrying the NEWER identity over the OLDER body: both reads
 * succeeded, nothing looked wrong, and the unchanged-index would then match that newer timestamp forever
 * and never re-read the body it never actually had. Skew is therefore a partial capture. The race predates
 * this index — what the index changed is that its staleness stopped being temporary.
 *
 * `bodyDigest` is the OTHER field that is not row-led, for the same reason `partial` is not: the merged
 * item carries the page lane's rendered body, and that body's parsed tree is what the digest names. The row
 * side never has one — the databases lane projects a row from its PROPERTIES and renders no markdown body
 * at all — so row-leading it would drop the digest on every merged row, and re-deriving that page's text
 * would go back to Notion for a tree already sitting on disk.
 *
 * @param row the databases lane's projection of the row (properties, parent, its own comments fetch)
 * @param page the pages lane's projection of the SAME Notion page id (block body, no parent)
 * @returns one item carrying both sides' content under the row's identity
 */
export function mergeDuplicateRowPage({ row, page }: { row: NotionPageItem; page: NotionPageItem }): NotionPageItem {
  const commentsById = new Map<string, NotionCommentItem>();
  for (const comment of [...row.comments, ...page.comments]) {
    commentsById.set(comment.id, comment);
  }
  const fileRefs = unionStrings({ first: row.fileRefs, second: page.fileRefs });
  const mentionTargets = unionStrings({ first: row.mentionTargets, second: page.mentionTargets });
  const relationTargets = unionStrings({ first: row.relationTargets, second: page.relationTargets });
  return {
    ...row,
    chunks: [...row.chunks, ...page.chunks],
    comments: [...commentsById.values()],
    ...(row.partial === true || page.partial === true || row.tsIso !== page.tsIso ? { partial: true } : {}),
    ...(page.bodyDigest !== undefined ? { bodyDigest: page.bodyDigest } : {}),
    ...(fileRefs.length > 0 ? { fileRefs } : {}),
    ...(mentionTargets.length > 0 ? { mentionTargets } : {}),
    ...(relationTargets.length > 0 ? { relationTargets } : {}),
  };
}

/**
 * Reconcile the `pages` and `databases` lanes into one page item per distinct Notion page id — merging a
 * database row with its `pages`-lane shadow (see {@link mergeDuplicateRowPage}) instead of emitting both
 * under the identical `sourceId: page:<id>` (`project.ts#pageChunkRecord`), which otherwise silently splits
 * one row's properties and body across two competing, undeduped records. Pure.
 *
 * @param pages the pages lane's projections (may include database-row shadows the search happened to find)
 * @param rows the databases lane's row projections
 * @returns one item per distinct id: merged rows first (in row order), then any standalone page the
 *   databases lane never independently discovered as a row
 */
export function reconcileRowDuplicates({
  pages,
  rows,
}: {
  pages: readonly NotionPageItem[];
  rows: readonly NotionPageItem[];
}): readonly NotionPageItem[] {
  const pagesById = new Map(pages.map((page) => [page.id, page]));
  const reconciled = rows.map((row) => {
    const shadow = pagesById.get(row.id);
    if (shadow === undefined) {
      return row;
    }
    pagesById.delete(row.id);
    return mergeDuplicateRowPage({ page: shadow, row });
  });
  return [...reconciled, ...pagesById.values()];
}

/**
 * The same merge {@link reconcileRowDuplicates} does, decomposed for ONE batch of newly-discovered rows —
 * so a long databases-lane crawl can flush merged records as it goes rather than only once at the very
 * end. Pure. Does not replace {@link reconcileRowDuplicates}: `fetchNotionActivity` still runs that over
 * the complete in-memory result regardless, so this is a durability side-channel, not the source of truth.
 *
 * @param pagesById every pages-lane item, keyed by id — built ONCE, since the pages lane always finishes
 *   before the databases lane starts and never changes across batches
 * @param alreadyConsumed ids an earlier batch already merged, so a row cannot double-claim a page
 * @param rows this batch's newly-discovered rows
 * @returns this batch's ready-to-write items (merged rows first, in row order), and the ids this batch
 *   consumed — fold into the caller's running `alreadyConsumed` before the next batch
 */
export function reconcileRowBatch({
  pagesById,
  alreadyConsumed,
  rows,
}: {
  pagesById: ReadonlyMap<string, NotionPageItem>;
  alreadyConsumed: ReadonlySet<string>;
  rows: readonly NotionPageItem[];
}): { items: readonly NotionPageItem[]; consumedIds: readonly string[] } {
  const items: NotionPageItem[] = [];
  const consumedIds: string[] = [];
  for (const row of rows) {
    const shadow = alreadyConsumed.has(row.id) ? undefined : pagesById.get(row.id);
    if (shadow === undefined) {
      items.push(row);
      continue;
    }
    items.push(mergeDuplicateRowPage({ page: shadow, row }));
    consumedIds.push(row.id);
  }
  return { consumedIds, items };
}

/**
 * Build the `onBatch` callback {@link fetchNotionActivity} passes into the databases lane: reconcile one
 * search page's rows against the (complete, static) pages lane, project, and forward to the caller's own
 * `onBatch`. The `pagesById`/`consumed` bookkeeping lives in this closure so each batch sees the running
 * state of the one before it.
 *
 * @param pageLanePages every pages-lane item — built ONCE, since that lane always finishes first
 * @param onBatch the caller's own durability sink
 * @returns the callback to pass as `pageAllDatabases`'s `onBatch`
 */
export function reconcilingBatchFlush({
  pageLanePages,
  onBatch,
}: {
  pageLanePages: readonly NotionPageItem[];
  onBatch: (args: { records: readonly CorpusRecord[] }) => void;
}): (args: { databases: readonly NotionDatabaseItem[]; rows: readonly NotionPageItem[] }) => void {
  const pagesById = new Map(pageLanePages.map((page) => [page.id, page]));
  const consumed = new Set<string>();
  return ({ databases, rows }) => {
    const reconciled = reconcileRowBatch({ alreadyConsumed: consumed, pagesById, rows });
    for (const id of reconciled.consumedIds) {
      consumed.add(id);
    }
    onBatch({ records: projectNotionRecords({ databases, pages: reconciled.items }) });
  };
}
