/**
 * The "bronze already holds this, unchanged" index — the pre-fetch check that stops a wider `--since`
 * from re-walking every page it already captured.
 *
 * Notion `search` has no server-side date filter, so a widened window re-discovers every page newer than
 * `since` and the connector then re-renders each one's whole block tree before the writer's fingerprint
 * dedup throws the result away. Measured on a real workspace, chunk 2 of a chunked expansion discarded
 * about three in four of the tens of thousands of records it projected — fetch work that re-pulled content chunk 1 had already
 * landed. This index moves that decision BEFORE the expensive call rather than after it.
 *
 * ## The contract, stated because a wrong skip is invisible
 *
 * A node is skipped only when bronze holds it under the EXACT same `last_edited_time`. Notion advances
 * that field on any edit to the object's own blocks, so an unchanged timestamp means unchanged content.
 * Two deliberate narrowings follow:
 *
 *  - **Only pages and rows, never a data source.** A data source's own `last_edited_time` does not move
 *    when one of its rows is edited, so skipping a matched data source would silently skip every row
 *    change under it. Data-source discovery stays unconditional; only the individual row is skippable.
 *    The read path holds the same belief: `liveApiDatabases.ts`'s `databaseSearchHit` enumerates every
 *    data source regardless of its own timestamp, and the window is applied to its ROWS instead. It did
 *    not always — it filtered the search hit by that timestamp, so an incremental refresh silently lost
 *    every row edited under a table nobody had restructured lately, while `--all` looked correct.
 *  - **Never a capture that is not self-contained.** Such a capture carries `capture: "partial"` in its
 *    bronze attrs (see `project.ts`) and this index refuses to skip it. FOUR things set that marker, and
 *    each was a way the skip could have gone silently wrong:
 *      1. a body truncated by the depth cap, the per-item time budget, or a recoverable read failure —
 *         otherwise the first truncated capture would freeze as the permanent one;
 *      2. a merge whose two lanes read DIFFERENT `last_edited_time`s for the same object, which would
 *         otherwise stamp the newer identity onto the older body;
 *      3. a body that inlines content OWNED by another object — a `child_page`, `child_database` or
 *         `synced_block`. `docs/notion-coverage.md` measures 51% of child pages as invisible to `search`,
 *         so for half of them the parent's body is the corpus's only copy, and a child's edit does not move
 *         the parent's timestamp;
 *      4. the legacy case below, handled by recorded coverage rather than by the marker.
 *
 * ## What a skip does NOT cover, decided rather than overlooked
 *
 * A rich-text MENTION renders the target page's title into this page's text, so renaming the target leaves
 * a stale title behind in an otherwise-unchanged page, and the skip will not re-fetch it. That was raised
 * as a counterexample and is accepted rather than fixed, for three reasons: the target page has its own
 * record carrying its own current title, so nothing is LOST, only stale in one rendering; the mention is
 * separately recorded as a curated edge, so the graph stays correct; and marking every page carrying a
 * mention non-skippable would disable the skip across most of a real workspace to chase a title string.
 * It is also not new — a page outside `--since` was never re-rendered for a renamed mention either.
 *
 * ## The one thing a skip DOES trade away, measured
 *
 * `last_edited_time` tracks edits to the page's own blocks. Notion does not advance it when somebody adds
 * a COMMENT, so a skipped page's comments are not re-read until that page is next edited. This widens a
 * gap the connector already had — a page outside `--since` was never re-read for comments either — rather
 * than opening a new one, but it is a real trade and it is stated here rather than discovered later.
 * Measured on the real workspace over a two-day window: re-fetching everything the index would have
 * skipped produced 777 records, of which **2 were comments**. `--refetch-unchanged` re-reads them all.
 *
 * Bronze written BEFORE that marker existed carries no `capture` attr at all, and would therefore read as
 * complete — which would let the first truncated capture of a page authorise skipping the re-fetch that
 * would repair it, permanently and silently. `captureCoverage.ts` closes that: an unmarked capture is
 * trusted only when a completed, unbounded, gap-free crawl has re-captured everything from at least that
 * far back. Before any such crawl, nothing is skipped at all.
 */
import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { slopweaverHome } from "../../config.js";
import { isRecord } from "../../lib/parsers.js";
import { err, ok, type Result } from "../../lib/result.js";
import type { OwnerProtectionResolver } from "../bronzeProtection.js";
import { listBronzeFiles } from "../bronzeStorage.js";
import { CAPTURE_ATTR, CAPTURE_PARTIAL } from "../types.js";
import { readNotionCaptureCoverage } from "./captureCoverage.js";

/** One bronze row as the index reads it — the three fields that decide skippability. */
export interface NotionSeenRow {
  /** The record's `sourceId`, e.g. `page:<uuid>` or `page:<uuid>:chunk:3`. */
  readonly sourceId: string;
  /** The record's `tsIso`, which for a Notion page IS its `last_edited_time`. */
  readonly tsIso: string;
  /** The record's `capture` attr, when it carries one. */
  readonly capture?: string;
}

/** The built index: one question, asked once per candidate before any block fetch happens. */
export interface NotionSeenIndex {
  /** Whether bronze already holds this page/row at this exact `last_edited_time`, completely captured. */
  readonly isUnchanged: (args: { id: string; lastEdited: string }) => boolean;
  /** How many distinct page ids the index covers — reported so a run can say what it was working from. */
  readonly size: number;
  /**
   * Every page id bronze holds at least one capture of, regardless of freshness or partiality — the
   * "already reachable" half of grant-delta detection (`reach.ts`). Deliberately broader than what
   * {@link isUnchanged} would skip: a page we hold even a PARTIAL capture of is still a page we already
   * knew was shared with the integration, so it must never be reported as newly granted.
   */
  readonly heldPageIds: ReadonlySet<string>;
  /** Every database (data-source) id bronze holds a `database:<id>` record for. */
  readonly heldDatabaseIds: ReadonlySet<string>;
}

/** An index that skips nothing — what `--refetch-unchanged` installs, and what an empty corpus yields. */
export const EMPTY_NOTION_SEEN_INDEX: NotionSeenIndex = {
  heldDatabaseIds: new Set(),
  heldPageIds: new Set(),
  isUnchanged: () => false,
  size: 0,
};

/** The page id a bronze `sourceId` names, or undefined when the record is not a page/row record. */
function pageIdOf({ sourceId }: { sourceId: string }): string | undefined {
  const match = /^page:([0-9a-fA-F-]{36})(?::chunk:\d+)?$/.exec(sourceId);
  return match?.[1];
}

/** The database id a bronze `sourceId` names, or undefined when the record is not a database record. */
function databaseIdOf({ sourceId }: { sourceId: string }): string | undefined {
  const match = /^database:([0-9a-fA-F-]{36})$/.exec(sourceId);
  return match?.[1];
}

/** What the index remembers per page: its newest capture, and whether that capture was truncated. */
interface SeenEntry {
  tsIso: string;
  partial: boolean;
}

/**
 * Build the index from already-parsed bronze rows. Pure — the file reading lives in
 * {@link buildNotionSeenIndex}, so the whole decision is unit-testable without a corpus on disk.
 *
 * Only a page's NEWEST `tsIso` is retained: an older capture of the same page describes content Notion
 * has since replaced, so it can never authorise a skip. Partiality is folded across every record sharing
 * that newest timestamp, since a page fans out into one record per chunk and only some carry the marker.
 *
 * @param rows every bronze row for the Notion source, in any order
 * @param coveredSinceIso the oldest instant from which an UNMARKED capture may be trusted as complete (see
 *   `captureCoverage.ts`); omitted ⇒ no unmarked capture is trusted, so the index skips nothing
 * @returns the index; a row that names no page id is ignored rather than rejected
 */
export function notionSeenIndexFrom({
  rows,
  coveredSinceIso,
}: {
  rows: Iterable<NotionSeenRow>;
  coveredSinceIso?: string;
}): NotionSeenIndex {
  const seen = new Map<string, SeenEntry>();
  const heldDatabaseIds = new Set<string>();
  for (const row of rows) {
    const id = pageIdOf({ sourceId: row.sourceId });
    if (id === undefined) {
      const databaseId = databaseIdOf({ sourceId: row.sourceId });
      if (databaseId !== undefined) {
        heldDatabaseIds.add(databaseId);
      }
      continue;
    }
    const partial = row.capture === CAPTURE_PARTIAL;
    const previous = seen.get(id);
    if (previous === undefined || row.tsIso > previous.tsIso) {
      seen.set(id, { partial, tsIso: row.tsIso });
      continue;
    }
    if (row.tsIso === previous.tsIso && partial) {
      previous.partial = true;
    }
  }
  return {
    heldDatabaseIds,
    heldPageIds: new Set(seen.keys()),
    isUnchanged: ({ id, lastEdited }) => {
      const entry = seen.get(id);
      if (entry === undefined || entry.partial || entry.tsIso !== lastEdited) {
        return false;
      }
      // The capture carries no `partial` marker — but a capture written before the marker existed carries
      // none either, whether or not it was truncated. Only a capture inside recorded coverage proves the
      // difference.
      return coveredSinceIso !== undefined && entry.tsIso >= coveredSinceIso;
    },
    size: seen.size,
  };
}

/** The `sourceId`/`tsIso`/`capture` of one bronze line, or undefined when the line is not a usable record. */
function seenRowOf({ line }: { line: string }): NotionSeenRow | undefined {
  if (line.length === 0) {
    return undefined;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return undefined; // a truncated tail line from a killed run — the reader tolerates it, so does this
  }
  if (!isRecord(parsed)) {
    return undefined;
  }
  const sourceId = parsed["sourceId"];
  const tsIso = parsed["tsIso"];
  if (typeof sourceId !== "string" || typeof tsIso !== "string") {
    return undefined;
  }
  const attrs = parsed["attrs"];
  const capture = isRecord(attrs) ? attrs[CAPTURE_ATTR] : undefined;
  return {
    sourceId,
    tsIso,
    ...(typeof capture === "string" ? { capture } : {}),
  };
}

/**
 * Stream every Notion bronze file and build the index. Line-at-a-time rather than a whole-file read: the
 * real corpus is a couple of hundred MB of Notion alone, and this runs before every crawl.
 *
 * The recorded capture coverage is read here rather than passed in, because the two always come from the
 * same home and separating them is how a caller ends up trusting one install's markers against another's
 * bronze.
 *
 * Notion bronze is judged by the owner's protect list before any of it is read, the coverage sidecar beside it
 * included: a refusal is an `Err`, never an empty index, because an empty index re-fetches the whole workspace and
 * then appends it to the very directory the list protects.
 *
 * @param home the Slopweaver home whose bronze is read (defaults to {@link slopweaverHome})
 * @param protection an injected resolver, which a test supplies so it never reads the owner's own registry
 * @returns the index — empty when Notion has never been ingested — or the refusal
 */
export async function buildNotionSeenIndex({
  home = slopweaverHome(),
  protection,
}: { home?: string; protection?: OwnerProtectionResolver | undefined } = {}): Promise<Result<NotionSeenIndex>> {
  const listed = listBronzeFiles({ home, protection, source: "notion" });
  if (listed.isErr()) {
    return err([listed.error.message]);
  }
  const coveredSinceIso = readNotionCaptureCoverage({ home });
  const rows: NotionSeenRow[] = [];
  for (const file of listed.value) {
    const lines = createInterface({ crlfDelay: Infinity, input: createReadStream(file.path) });
    for await (const line of lines) {
      const row = seenRowOf({ line });
      if (row !== undefined) {
        rows.push(row);
      }
    }
  }
  return ok(notionSeenIndexFrom({ rows, ...(coveredSinceIso !== undefined ? { coveredSinceIso } : {}) }));
}
