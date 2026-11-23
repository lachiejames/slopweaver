/**
 * `proposal sync`'s pure discovery half: turning one Notion page's top-level blocks into candidate register
 * entries. What this deliberately does NOT do is decide a candidate's lifecycle status, decision, successor,
 * audience or Slack announcement — those are prose inside each child page, not structured Notion properties,
 * so a P1 pass measured them as a judgement call no unattended tool can make safely. This module finds WHAT
 * exists; a human (or the session driving this CLI) reads each candidate and calls `proposal status`/`decide`/
 * `supersede`/`record-slack`/`follow-up` to classify it — the same separation `docs/proposals.md` already
 * draws between what pure code renders and what a gate judges.
 */
import { isRecord } from "../../../lib/parsers.js";

/** One `child_page` block discovered directly under a scanned Notion page. */
export interface SyncCandidate {
  readonly pageId: string;
  readonly title: string;
}

/** Canonical UUID → the bare 32-hex form Notion's own URLs and page ids share. */
function compactPageId({ pageId }: { pageId: string }): string {
  return pageId.replaceAll("-", "");
}

/**
 * The canonical, always-resolvable URL for a Notion page id.
 *
 * Notion redirects a bare-id URL to the page's own titled slug, so this is a stable link even though it is
 * not byte-identical to the URL a human would copy from the app.
 *
 * @param pageId the canonical UUID
 * @returns the bare-id `https://www.notion.so/<32-hex>` URL
 */
export function canonicalNotionUrl({ pageId }: { pageId: string }): string {
  return `https://www.notion.so/${compactPageId({ pageId })}`;
}

/** One raw block, narrowed only far enough to say whether it is a `child_page` and read its id/title. */
function asChildPage({ block }: { block: unknown }): SyncCandidate | undefined {
  if (!isRecord(block) || block["type"] !== "child_page" || typeof block["id"] !== "string") {
    return undefined;
  }
  const childPage = block["child_page"];
  const title = isRecord(childPage) && typeof childPage["title"] === "string" ? childPage["title"] : undefined;
  return title === undefined ? undefined : { pageId: block["id"], title };
}

/**
 * Every `child_page` block found directly under a scanned page's top-level blocks.
 *
 * Direct children only — this does not recurse into nested pages, matching the same bounded, single-request
 * shape `notion read` already uses rather than adding a second, deeper crawler.
 *
 * @param results the raw top-level blocks a `listBlockChildren` call returned
 * @returns every discovered candidate, in the order Notion returned them
 */
export function childPagesOf({ results }: { results: readonly unknown[] }): readonly SyncCandidate[] {
  return results
    .map((block) => asChildPage({ block }))
    .filter((candidate): candidate is SyncCandidate => candidate !== undefined);
}
