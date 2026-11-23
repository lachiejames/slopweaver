/**
 * The ONE spelling of a Notion page id the corpus keys on: lowercase, dashed 8-4-4-4-12.
 *
 * Notion writes the same id two ways — dashed in every API object and search hit, undashed at the end of a
 * page url — and bronze keys identity on the literal `sourceId`, so the two spellings are two identities for
 * one page. MEASURED on the live home: 34,767 Notion bronze rows carried an undashed `page:<32hex>` id at
 * one reading and 35,652 two days later, all minted by the child-page frontier reading ids off urls, and none of
 * them could be superseded by a re-pull, which writes the API's dashed form (a heal pass had to repair 9 of them
 * offline). The frontier now mints the dashed form, the bronze writer admits every record through
 * {@link canonicalNotionRecord} so no other write path can mint the undashed one, and compaction re-keys the
 * rows already on disk the same way.
 *
 * Reproduce the census: `grep -rcE '"sourceId":"page:[0-9a-f]{32}[":]' ~/.slopweaver/corpus/bronze/notion`.
 */
import type { CorpusRecord } from "../types.js";

/** A page `sourceId` whose id is spelled undashed: the id, then end, `:chunk:<n>` or `:comment:<id>`. */
const UNDASHED_PAGE_SOURCE_ID = /^page:([0-9a-fA-F]{32})(?=$|:)/;

/** A page `sourceId` already keyed on the canonical dashed id. */
const DASHED_PAGE_SOURCE_ID = /^page:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?=$|:)/;

/**
 * The canonical dashed, lowercase spelling of a Notion id written either way. Pure.
 *
 * @param id a Notion id, dashed or undashed, any case
 * @returns the `8-4-4-4-12` lowercase id, or undefined when the input is not 32 hex digits once undashed
 */
export function canonicalNotionId({ id }: { id: string }): string | undefined {
  const bare = id.replaceAll("-", "").toLowerCase();
  if (!/^[0-9a-f]{32}$/.test(bare)) {
    return undefined;
  }
  return [bare.slice(0, 8), bare.slice(8, 12), bare.slice(12, 16), bare.slice(16, 20), bare.slice(20)].join("-");
}

/**
 * A Notion `sourceId` with an undashed leading page id re-spelled dashed; every other id returned as given.
 * Pure.
 *
 * Only the leading `page:<32hex>` segment moves: a chunk index and a comment id are already API-spelled, and a
 * `database:` id or an already-dashed page id has nothing to fix.
 *
 * @param sourceId a Notion record's `sourceId`
 * @returns the same id keyed on the canonical page id
 */
export function canonicalNotionSourceId({ sourceId }: { sourceId: string }): string {
  const match = UNDASHED_PAGE_SOURCE_ID.exec(sourceId);
  const undashed = match?.[1];
  if (undashed === undefined) {
    return sourceId;
  }
  return `page:${canonicalNotionId({ id: undashed })!}${sourceId.slice(match![0].length)}`;
}

/**
 * Both spellings a Notion `sourceId` may sit on disk under — canonical first, then the undashed one when it
 * names a page — for a reader that pre-filters raw lines before parsing them. Pure.
 *
 * @param sourceId a Notion record's `sourceId`, in either spelling
 * @returns the distinct spellings, canonical first
 */
export function notionSourceIdSpellings({ sourceId }: { sourceId: string }): readonly string[] {
  const canonical = canonicalNotionSourceId({ sourceId });
  const dashed = DASHED_PAGE_SOURCE_ID.exec(canonical)?.[1];
  if (dashed === undefined) {
    return [canonical];
  }
  return [canonical, `page:${dashed.replaceAll("-", "")}${canonical.slice("page:".length + dashed.length)}`];
}

/**
 * A bronze record re-keyed onto its canonical Notion page id — the input itself when it is not a Notion
 * record or already canonical. Pure.
 *
 * @param record any bronze record
 * @returns the record, its `sourceId` re-spelled when it named an undashed Notion page id
 */
export function canonicalNotionRecord({ record }: { record: CorpusRecord }): CorpusRecord {
  if (record.source !== "notion") {
    return record;
  }
  const sourceId = canonicalNotionSourceId({ sourceId: record.sourceId });
  return sourceId === record.sourceId ? record : { ...record, sourceId };
}
