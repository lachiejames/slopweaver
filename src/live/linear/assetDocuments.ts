/**
 * Open every Linear-hosted file a read's payload addressed, and account for every one of them.
 *
 * ## Nothing about one asset ends the read
 *
 * The object was fetched, and it is there. An attachment that 401s, that turns out to be a screen recording
 * rather than a document, or whose bytes will not parse, is a claim ABOUT that attachment — it says nothing
 * about the issue, its description or its other files. `../slack/fileDownloads.ts`'s header carries the
 * argument in full: the same call was once made the other way, and one missing PDF discarded a whole
 * thread. So every arm here lands in a {@link ProviderReadAttachment} and none of them is an `err`.
 *
 * ## No disk, and therefore no fatal case at all
 *
 * The Slack door writes attachment bytes into a thread directory and has one genuinely fatal failure — a
 * destination that is not a real directory, which invalidates every write the stage would make. Nothing
 * here writes, because `PDF_BYTES_MAX` bounds what is held and the asset URL is permanent, so a caller that
 * wants the file itself still has a durable address to fetch it from. That removes the whole class.
 */
import { pdfAttachmentFrom } from "../../pdf/attachment.js";
import type { ProviderReadAttachment } from "../providerRead.js";
import type { FetchLinearAsset } from "./assetFetch.js";
import { planLinearAssets } from "./assetPlan.js";

/**
 * How many assets one read opens before it stops.
 *
 * Each costs a round trip and a document held in memory, and a read is a foreground command somebody is
 * waiting on. A payload addressing more than this says so in its residue rather than fetching them all.
 * @internal
 */
export const LINEAR_ASSETS_MAX = 10;

/** Open one addressed asset, turning every outcome into a claim rather than a failure. */
async function openOne({
  url,
  token,
  fetchAsset,
}: {
  url: string;
  token: string;
  fetchAsset: FetchLinearAsset;
}): Promise<ProviderReadAttachment> {
  const fetched = await fetchAsset({ token, url });
  if (fetched.isErr()) {
    return { outcome: "unfetched", reason: fetched.error.message, url };
  }
  const bytes = fetched.value.byteLength;
  const attachment = await pdfAttachmentFrom({ bytes: fetched.value });
  if (attachment.isErr()) {
    return { bytes, outcome: "unreadable", reason: attachment.error.join("; "), url };
  }
  if (attachment.value === undefined) {
    return { bytes, outcome: "not-a-document", url };
  }
  return { bytes, outcome: "read", pdf: attachment.value, url };
}

/**
 * Fetch and read every Linear-hosted file the payload addresses.
 *
 * @param data the payload the reader already assembled
 * @param token the Linear API key the assets are fetched with
 * @param fetchAsset the injected byte seam, so this is provable with a plain fake and no network
 * @returns one claim per opened asset, and one residue line per thing the caller should know
 */
export async function openLinearAssets({
  data,
  token,
  fetchAsset,
}: {
  data: unknown;
  token: string;
  fetchAsset: FetchLinearAsset;
}): Promise<{ readonly attachments: readonly ProviderReadAttachment[]; readonly residue: readonly string[] }> {
  const planned = planLinearAssets({ data, max: LINEAR_ASSETS_MAX });
  const attachments: ProviderReadAttachment[] = [];
  for (const url of planned.urls) {
    attachments.push(await openOne({ fetchAsset, token, url }));
  }
  const residue: string[] = [];
  if (planned.found > planned.urls.length) {
    residue.push(
      `the payload addresses ${String(planned.found)} Linear-hosted files; the first ${String(planned.urls.length)} were opened`,
    );
  }
  for (const attachment of attachments) {
    if (attachment.outcome === "unfetched") {
      residue.push(`not fetched — ${attachment.reason}`);
    }
    if (attachment.outcome === "unreadable") {
      residue.push(`${attachment.url}: bytes retrieved, text not — ${attachment.reason}`);
    }
  }
  return { attachments, residue };
}
