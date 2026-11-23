/**
 * Open every Notion-hosted file a page read addresses, and account for every one of them.
 *
 * ## Nothing about one attachment ends the read
 *
 * The page was fetched, and it is there. A file that 403s, that turns out to be a screen recording rather
 * than a document, or whose bytes will not parse, is a claim ABOUT that file — it says nothing about the
 * page or its other attachments. `../slack/fileDownloads.ts`'s header carries the argument in full: the
 * same call was once made the other way, and one missing PDF discarded a whole thread. So every arm here
 * lands in a {@link ProviderReadAttachment} and none of them is an `err`.
 *
 * ## Which ceiling binds, and why only one probe happens
 *
 * There are two, and they are two different claims. `NOTION_ATTACHMENT_CEILING_BYTES` is what this machine
 * will accept from Notion at all — a page carrying a file of a terabyte is not one to download.
 * `PDF_BYTES_MAX`
 * (`../../pdf/limits.ts`) is what the pdfjs extractor will hold in memory.
 *
 * The extractor's is the SMALLER of the two, so it is the one this lane passes to `downloadAttachment` and
 * the corpus ceiling can never be the binding one here. That is deliberate rather than an oversight: one
 * ranged probe then enforces both, and a file the extractor could never read costs a probe instead of a
 * download. Neither number is changed to match the other — the corpus pass still stores files this lane
 * would refuse, because storing bytes and parsing them are different budgets.
 */
import {
  type AttachmentTransport,
  type DownloadedAttachment,
  downloadAttachment,
} from "../../corpus/notion/attachmentFetch.js";
import { pdfAttachmentFrom } from "../../pdf/attachment.js";
import { PDF_BYTES_MAX } from "../../pdf/limits.js";
import type { ProviderReadAttachment } from "../providerRead.js";
import { planNotionAssets } from "./assetPlan.js";

/**
 * How many attachments one read opens before it stops.
 *
 * Each costs a probe, a download and a document held in memory, and a read is a foreground command
 * somebody is waiting on. A read addressing more than this says so in its residue rather than fetching
 * them all.
 * @internal
 */
export const NOTION_ASSETS_MAX = 10;

/** What one refusal or failure from the download lane says to a reader. */
function reasonFor({ outcome }: { outcome: Exclude<DownloadedAttachment, { kind: "fetched" }> }): string {
  if (outcome.kind === "too-large") {
    return `it is ${String(outcome.bytes)} bytes, past the ${String(PDF_BYTES_MAX)}-byte ceiling this reader holds in memory`;
  }
  if (outcome.kind === "size-unknown") {
    return "the ranged probe reported no total, so the ceiling could not be enforced without reading it first";
  }
  return outcome.reason;
}

/** Open one addressed attachment, turning every outcome into a claim rather than a failure. */
async function openOne({
  url,
  transport,
  scopeId,
}: {
  url: string;
  transport: AttachmentTransport;
  scopeId: string;
}): Promise<ProviderReadAttachment> {
  const downloaded = await downloadAttachment({ ceilingBytes: PDF_BYTES_MAX, scopeId, transport, url });
  if (downloaded.kind !== "fetched") {
    return { outcome: "unfetched", reason: reasonFor({ outcome: downloaded }), url };
  }
  const bytes = downloaded.bytes;
  const attachment = await pdfAttachmentFrom({ bytes: new Uint8Array(downloaded.body) });
  if (attachment.isErr()) {
    return { bytes, outcome: "unreadable", reason: attachment.error.join("; "), url };
  }
  if (attachment.value === undefined) {
    return { bytes, outcome: "not-a-document", url };
  }
  return { bytes, outcome: "read", pdf: attachment.value, url };
}

/**
 * Fetch and read every Notion-hosted file this read addresses — the page's properties and its block slice.
 *
 * @param page the raw page object, whose `files` properties carry a database row's own attachments
 * @param blocks every raw block the reader already has in hand, nested ones flattened in, still carrying their signed urls
 * @param transport the injected HTTP seam, so this is provable with a plain fake and no network
 * @param scopeId the provider-door scope these calls are accounted to
 * @returns one claim per opened attachment, and one residue line per thing the caller should know
 */
export async function openNotionAssets({
  page,
  blocks,
  transport,
  scopeId,
}: {
  page: unknown;
  blocks: readonly unknown[];
  transport: AttachmentTransport;
  scopeId: string;
}): Promise<{ readonly attachments: readonly ProviderReadAttachment[]; readonly residue: readonly string[] }> {
  const planned = planNotionAssets({ blocks, max: NOTION_ASSETS_MAX, page });
  const attachments: ProviderReadAttachment[] = [];
  for (const url of planned.urls) {
    attachments.push(await openOne({ scopeId, transport, url }));
  }
  const residue: string[] = [
    "files were opened from the page's own properties and every block this slice returned, nested ones included",
  ];
  if (planned.found > planned.urls.length) {
    residue.push(
      `this read addresses ${String(planned.found)} Notion-hosted files; the first ${String(planned.urls.length)} were opened`,
    );
  }
  if (planned.external > 0) {
    // "reference", not "block": an off-host file is as likely to be a `files` property entry as a block,
    // and naming the wrong one tells a reader to go looking in the wrong half of the page.
    residue.push(
      `${String(planned.external)} file reference(s) point at another site and were left alone, never fetched`,
    );
  }
  for (const attachment of attachments) {
    if (attachment.outcome === "unfetched") {
      residue.push(`${attachment.url}: not fetched — ${attachment.reason}`);
    }
    if (attachment.outcome === "unreadable") {
      residue.push(`${attachment.url}: bytes retrieved, text not — ${attachment.reason}`);
    }
  }
  return { attachments, residue };
}
