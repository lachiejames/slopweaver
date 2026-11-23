/**
 * The authenticated URLs one raw Slack file object carries: the download, and the preview renditions Slack mints
 * for a picture.
 *
 * Its own module so `./projection.ts`'s file projector stays one rule per field. The download is what
 * `read-thread` fetches; the previews are what the console's channel window draws, since Slack desktop draws a
 * posted picture from its preview too (`./channelView.ts` § `picturePlanOf`). None is ever emitted in output.
 */
import { optStr as optionalString } from "../../corpus/slack/shape.js";
import { isRecord } from "../../lib/parsers.js";
import type { VisibleSlackFile } from "./types.js";

/**
 * Slack's download URL, preferring the explicit download form. A file with no `url_private_download` is read
 * from its in-place `url_private`, which Slack serves some filetypes from alone.
 */
function downloadUrlOf({ raw }: { raw: Readonly<Record<string, unknown>> }): string | undefined {
  const download = optionalString({ value: raw["url_private_download"] });
  if (download === undefined) {
    return optionalString({ value: raw["url_private"] });
  }
  return download;
}

/** A private Slack file URL's team-and-file segment: `files-pri/T0123-F0456/…` names file `F0456`. */
const PRIVATE_FILE_URL = /\/files-pri\/[A-Z0-9]+-(F[A-Z0-9]+)\//u;

/**
 * The file a Block Kit `slack_file` object names. Slack accepts it as `{ id }` or as `{ url }`, so a URL-only
 * reference is read for the id inside it; one whose URL carries no recognisable id is kept AS that URL, so the
 * lookup refuses it and the reader is told a file was there rather than shown a message with none.
 *
 * @param ref the `slack_file` object
 * @returns the file id, the unrecognised URL, or `undefined` when the object names neither
 */
export function slackFileRefId({ ref }: { ref: Readonly<Record<string, unknown>> }): string | undefined {
  const id = optionalString({ value: ref["id"] });
  if (id !== undefined) {
    return id;
  }
  const url = optionalString({ value: ref["url"] });
  if (url === undefined) {
    return undefined;
  }
  const named = PRIVATE_FILE_URL.exec(url);
  if (named === null) {
    return url;
  }
  return named[1];
}

/**
 * The file one Block Kit node names, through either channel Slack offers: an `image` block's `slack_file`
 * object, or a `file` element (`{ type: "file", file_id }`) inside a rich-text section (a message whose only file arrived that way was drawn with none).
 *
 * @param node one object inside a message's blocks or attachments
 * @returns the file id (or unrecognised URL) it names, or `undefined` when it names no file
 */
export function blockFileRefId({ node }: { node: Readonly<Record<string, unknown>> }): string | undefined {
  const ref = node["slack_file"];
  if (isRecord(ref)) {
    return slackFileRefId({ ref });
  }
  if (node["type"] === "file") {
    return optionalString({ value: node["file_id"] });
  }
  return undefined;
}

/**
 * The download URL and the 480 and 360 preview URLs, each present only when Slack gave one.
 *
 * @param raw the raw Slack file object, already known to be a record
 * @returns the URL fields to spread into a projected file
 */
export function slackFileUrls({
  raw,
}: {
  raw: Readonly<Record<string, unknown>>;
}): Pick<VisibleSlackFile, "urlPrivateDownload" | "thumb480Url" | "thumb360Url"> {
  const urlPrivateDownload = downloadUrlOf({ raw });
  const thumb480Url = optionalString({ value: raw["thumb_480"] });
  const thumb360Url = optionalString({ value: raw["thumb_360"] });
  return {
    ...(urlPrivateDownload !== undefined ? { urlPrivateDownload } : {}),
    ...(thumb480Url !== undefined ? { thumb480Url } : {}),
    ...(thumb360Url !== undefined ? { thumb360Url } : {}),
  };
}
