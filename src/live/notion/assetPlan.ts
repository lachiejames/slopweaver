/**
 * Which files a Notion block slice addresses — the pure half of `notion read --pdf`.
 *
 * ## Why this reads the TYPED blocks, where the Linear planner walks the payload
 *
 * The two look like the same job and are not. Linear has no schema for where a file lives: an asset url
 * sits under `description`, `body`, `content` or an `Attachment.url` across four object kinds, so naming
 * those fields buys a fifth branch the first time Linear adds a kind, and silently misses the one nobody
 * was told about. `../linear/assetPlan.ts` walks the string leaves for that reason.
 *
 * Notion is the opposite. A file reaches a page in exactly two typed ways — as one of five block types, or
 * as an entry of a `files` PROPERTY on a database row — and `../../corpus/notion/attachments.ts` holds both
 * readers plus a classifier measured across the whole workspace. Those two ways are not
 * equally common: `filePropertyUrls`'s header carries the measurement, and a planner that read the block
 * half alone found a file on 1 of 40 real pdf-bearing pages.
 *
 * The failure directions are what settle it. A typed read that meets a shape it does not know reports
 * nothing and says so in the residue. A WALK over a Notion payload fails OPEN: it would sweep up
 * `pages.retrieveMarkdown`'s `file://` envelopes and its unsigned urls that answer 403, and — the part
 * that matters — it would fetch the author's EXTERNAL links, which that same measurement found to be the
 * largest group by far. Those are a video host's or a course platform's content, and refusing to fetch
 * them is the whole reason `classifyAttachment` exists. Walking here bypasses it by construction.
 */
import { classifyAttachment, filePropertyUrls, signedUrlOf } from "../../corpus/notion/attachments.js";
import { isRecord } from "../../lib/parsers.js";

/** Every file the slice addresses, split by what each one turned out to be. */
export interface NotionAssetPlan {
  /** The Notion-hosted urls this read may fetch, capped, in the order the blocks appear. */
  readonly urls: readonly string[];
  /** How many hosted urls the slice addressed before the cap bit. */
  readonly found: number;
  /** How many file blocks pointed at somebody else's site, and are therefore left alone. */
  readonly external: number;
}

/**
 * Every Notion-hosted file url one read addresses: its page's `files` properties, then its block slice.
 *
 * The properties come FIRST because a database row is where almost every real file in this workspace
 * lives — the measurement is on {@link filePropertyUrls}. Within each half the order is the page's own
 * rather than sorted, so a caller reporting "the first 3 of 7" names the three a reader would have met
 * first.
 *
 * @param page the raw page object, whose `files` properties a database row carries its attachments on
 * @param blocks the raw block results exactly as `blocks.children.list` returned them
 * @param max how many urls to return, because each one costs a round trip and a document held in memory
 * @returns the fetchable urls, the count before the cap, and how many were somebody else's site
 */
export function planNotionAssets({
  page,
  blocks,
  max,
}: {
  page: unknown;
  blocks: readonly unknown[];
  max: number;
}): NotionAssetPlan {
  const hosted: string[] = [];
  let external = 0;
  const addressed = isRecord(page) ? [...filePropertyUrls({ page })] : [];
  for (const block of blocks) {
    if (isRecord(block)) {
      const url = signedUrlOf({ block });
      if (url !== undefined) {
        addressed.push(url);
      }
    }
  }
  for (const src of addressed) {
    const verdict = classifyAttachment({ src });
    if (verdict.kind === "hosted") {
      hosted.push(verdict.url);
    }
    if (verdict.kind === "external") {
      external += 1;
    }
  }
  const distinct = [...new Set(hosted)];
  return { external, found: distinct.length, urls: distinct.slice(0, max) };
}
