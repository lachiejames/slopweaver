/**
 * The child-page FRONTIER: a queue that replaces the recursive descent, not a smaller version of it.
 *
 * `renderMarkdownBody` returns the child pages a body references and fetches none of them, so something has
 * to fetch them or half the workspace stops being reachable. MEASURED
 * (`docs/notion-coverage.md`): of 98 `child_page` blocks the old recursive walk found, only 48 were also
 * returned by `search`, so **51% were reachable no other way**. That measurement is the whole reason this
 * module exists rather than the ids simply being dropped.
 *
 * The difference from the walk it replaces is the shape, and it is worth stating because "queue" and
 * "recursion" can look like the same thing written twice. A descent inlines the child's bytes into the
 * ancestor's record and its depth is bounded only by a cap. This drains a LIST: `visited` keeps a later wave
 * from revisiting a page an earlier wave already took, which makes a cycle in Notion's page graph terminate
 * instead of recursing forever, one shared `FetchBudget` bounds the total, and every page lands as its own
 * record. No page's body is ever written inside another's.
 */
import type { Client } from "@notionhq/client";
import pLimit from "p-limit";

import { isRecord } from "../../lib/parsers.js";
import { safeProviderCall } from "../../lib/providerCall.js";
import type { FetchBudget } from "./budget.js";
import type { GatedCall } from "./callDeadline.js";
import { lastEditedOf } from "./fetch.js";
import { NOTION_ITEM_CONCURRENCY } from "./liveApiShared.js";
import type { NotionCrawlMeter } from "./meter.js";
import type { NotionPageItem } from "./project.js";
import type { NotionSeenIndex } from "./seenIndex.js";
import type { NotionSkip } from "./skips.js";

/** What one page's own fetch produced, as the lane and this frontier both shape it. */
export interface FetchedNotionPage {
  readonly item: NotionPageItem;
  readonly skips: readonly NotionSkip[];
  readonly notes: readonly string[];
  readonly childPageIds: readonly string[];
}

/**
 * The one client method this frontier calls. Narrowed from the SDK's `Client` so a crawl's real client still
 * fits while a test can hand in a plain object; the call itself stays inside {@link retrieveChildPage}'s
 * `safeProviderCall` door.
 */
interface ChildPageClient {
  readonly pages: {
    readonly retrieve: (args: Parameters<Client["pages"]["retrieve"]>[0]) => Promise<unknown>;
  };
}

/** How the frontier fetches one page, injected so this module never constructs a client of its own. */
export type FetchOnePage = (args: {
  id: string;
  lastEdited: string;
  raw: Record<string, unknown>;
}) => Promise<FetchedNotionPage>;

/**
 * Fetch one page object by id, for a child page discovered in another page's body.
 *
 * A discovered child arrives as a url and a title only, and the record needs its `last_edited_time` to be
 * filed and to be skippable next run, so its object is retrieved. That is one extra request per child page
 * met for the first time, and it is the price of the reachability the old recursion bought by inlining.
 *
 * @param client the crawl's own client
 * @param call the crawl's shared rate-gated caller
 * @param scopeId the provider-door scope these calls are accounted to
 * @param id the child page's id
 * @returns the raw page object with its id and timestamp, or undefined when it cannot be read
 */
async function retrieveChildPage({
  client,
  call,
  scopeId,
  id,
}: {
  client: ChildPageClient;
  call: GatedCall;
  scopeId: string;
  id: string;
}): Promise<{ id: string; lastEdited: string; record: Record<string, unknown> } | undefined> {
  const called = await safeProviderCall({
    execute: () => call(() => client.pages.retrieve({ page_id: id })),
    operation: "notion.pages.retrieve.childPage",
    provider: "notion",
    retryMode: "transient",
    scopeId,
  });
  if (called.isErr() || !isRecord(called.value)) {
    return undefined;
  }
  return { id, lastEdited: lastEditedOf({ raw: called.value }), record: called.value };
}

/**
 * Drain the child pages one batch discovered, and the ones THEY discover, until nothing new is left.
 *
 * This is where the old recursion's one genuine virtue is preserved. MEASURED
 * (`docs/notion-coverage.md`): of 98 `child_page` blocks the recursive walk found, only 48 were also
 * returned by `search`, so **51% were reachable no other way**. Dropping the descent without this loop
 * would lose them outright.
 *
 * It is a QUEUE rather than a descent, and the difference is the whole point. `visited` keeps a later wave
 * from revisiting an id an earlier wave (or the caller) already took, which makes a cycle in Notion's page
 * graph terminate instead of recursing forever; an id repeated WITHIN one wave is not collapsed. The shared
 * `budget` bounds the total. Nothing here inlines one page's body into another.
 *
 * @param seedIds the child page ids the first batch reported
 * @param visited every id already fetched or scheduled in this lane, mutated as the queue drains
 * @returns the additional pages, their skips and their notes
 */
export async function drainChildPages({
  seedIds,
  visited,
  client,
  call,
  scopeId,
  budget,
  seen,
  meter,
  fetchPage,
}: {
  seedIds: readonly string[];
  visited: Set<string>;
  client: ChildPageClient;
  call: GatedCall;
  scopeId: string;
  budget: FetchBudget;
  seen: NotionSeenIndex;
  meter: NotionCrawlMeter;
  fetchPage: FetchOnePage;
}): Promise<{ pages: readonly NotionPageItem[]; skips: readonly NotionSkip[]; notes: readonly string[] }> {
  const limit = pLimit(NOTION_ITEM_CONCURRENCY);
  const collected: FetchedNotionPage[] = [];
  let queue = seedIds.filter((id) => !visited.has(id));
  while (queue.length > 0 && !budget.exhausted()) {
    const wave = queue.filter((id) => !visited.has(id));
    for (const id of wave) {
      visited.add(id);
    }
    const fetched = await Promise.all(
      wave.map((id) =>
        limit(async () => {
          if (budget.exhausted()) {
            return undefined;
          }
          const hit = await retrieveChildPage({ call, client, id, scopeId });
          if (hit === undefined) {
            return undefined;
          }
          if (seen.isUnchanged({ id: hit.id, lastEdited: hit.lastEdited })) {
            meter.countSkippedUnchanged({ id: hit.id });
            return undefined;
          }
          budget.spend({ items: 1 });
          return fetchPage({ id: hit.id, lastEdited: hit.lastEdited, raw: hit.record });
        }),
      ),
    );
    const landed = fetched.filter((one) => one !== undefined);
    collected.push(...landed);
    queue = landed.flatMap((one) => one.childPageIds).filter((id) => !visited.has(id));
  }
  return {
    notes: collected.flatMap((one) => one.notes),
    pages: collected.map((one) => one.item),
    skips: collected.flatMap((one) => one.skips),
  };
}
