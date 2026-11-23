/**
 * Shared constants + call-shaping helpers for the live Notion seam, split out of `liveApi.ts` purely to keep
 * that file under the repo's file-size ratchet. Both lane files (`liveApiDatabases.ts` and
 * `liveApiPagesLane.ts`) need the same `client.search` wrapper and the same "push a skip only if one was
 * produced" helper, so they live here rather than being duplicated or forcing a circular import between the
 * two lane files.
 */
import type { Client } from "@notionhq/client";

import { safeProviderCall } from "../../lib/providerCall.js";
import { orThrow } from "../../lib/safeBoundary.js";
import { type GatedCall, NOTION_FATAL_SEAM_ATTEMPTS } from "./callDeadline.js";
import { notionNextCursor } from "./fetch.js";
import type { NotionSkip } from "./skips.js";

/** The page size used by every paged Notion list/query/search call in this seam. */
export const PAGE_SIZE = 100;

/**
 * How many ITEMS (pages, or rows' comment fetches) one lane keeps in flight.
 *
 * The rate cap is unchanged and is still the only thing that decides how fast requests leave: every call
 * still passes through the one `NOTION_RATE_PER_SEC` scheduler, which paces call STARTS globally. What
 * this changes is how many calls are ready to be paced. Serially awaited, the achieved rate was
 * `1 / (interval + latency)` — measured well under half the cap — because the scheduler spent most of
 * every interval with nothing to hand out. Six in flight keeps the queue non-empty for a per-call latency
 * of up to ~2s, beyond which the cap binds again, which is the intended ceiling.
 */
export const NOTION_ITEM_CONCURRENCY = 6;

// Notion `search` has no server-side date filter, so we sort by `last_edited_time` DESCENDING and stop
// paging once a result older than `since` appears (all subsequent are older). `--all` ⇒ no cutoff.
const SORT_NEWEST_FIRST = { direction: "descending", timestamp: "last_edited_time" } as const;

/**
 * The page's next cursor, suppressed once the `since` cutoff was reached mid-page (stop paging). Pure.
 *
 * @param nextCursor the raw `next_cursor` value from the page just fetched
 * @param reachedCutoff whether this page already reached the `since` cutoff
 * @returns the cursor to keep paging with, or `undefined` to stop
 */
export function searchNextCursor({
  nextCursor,
  reachedCutoff,
}: {
  nextCursor: unknown;
  reachedCutoff: boolean;
}): string | undefined {
  return reachedCutoff ? undefined : notionNextCursor({ value: nextCursor });
}

/**
 * One `search` call for a given object type — the sole `client.search` boundary, gated + safe-wrapped. A
 * failure here loses the whole lane, so it carries {@link NOTION_FATAL_SEAM_ATTEMPTS} rather than the door's four.
 *
 * @param client the live Notion client
 * @param call the shared rate-gated caller
 * @param scopeId the token's provider-door scope id
 * @param objectType which kind of object to search for
 * @param operation the operation label recorded against this call
 * @param cursor the `start_cursor` to resume from, or undefined for the first page
 * @returns the raw search results, the raw next cursor, and the raw request status
 */
export async function notionSearch({
  client,
  call,
  scopeId,
  objectType,
  operation,
  cursor,
}: {
  client: Client;
  call: GatedCall;
  scopeId: string;
  objectType: "page" | "data_source";
  operation: string;
  cursor: string | undefined;
}): Promise<{ results: readonly unknown[]; nextCursor: unknown; requestStatus: unknown }> {
  const res = orThrow({
    result: await safeProviderCall({
      execute: () =>
        call(() =>
          client.search({
            filter: { property: "object", value: objectType },
            page_size: PAGE_SIZE,
            sort: SORT_NEWEST_FIRST,
            ...(cursor !== undefined ? { start_cursor: cursor } : {}),
          }),
        ),
      maxAttempts: NOTION_FATAL_SEAM_ATTEMPTS,
      operation,
      provider: "notion",
      retryMode: "transient",
      scopeId,
    }),
  });
  return { nextCursor: res.next_cursor, requestStatus: res.request_status, results: res.results };
}

/**
 * Append a value to a list when it is present. Keeps an optional-skip push from needing a branch inline.
 *
 * @param into the list to push onto, mutated in place
 * @param value the value to push, or undefined to do nothing
 */
export function pushIfDefined({ into, value }: { into: NotionSkip[]; value: NotionSkip | undefined }): void {
  if (value !== undefined) {
    into.push(value);
  }
}
