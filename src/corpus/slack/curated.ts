/**
 * Pure Slack curated-layer shapers (PR4.3): turn raw `pins.list` / `bookmarks.list` / `files.list`
 * payloads into the ref-only curated items `project.ts` consumes. No I/O.
 *
 * Every shaped item's OWN fields are ref-only: a pin cites its message permalink, a bookmark its link, a
 * canvas its permalink. None of them is `url_private`.
 *
 * What each shaper also does is attach the whole upstream object as `raw`, which therefore DOES carry
 * `url_private`, `url_private_download` and `thumb_*` into bronze. That is deliberate — see the
 * `project.ts` module header for the two reasons — and it is stated here because this docstring used to
 * claim the opposite, twenty lines above `raw: file`.
 */
import { epochSecondsToIso } from "../../lib/date.js";
import { isRecord } from "../../lib/parsers.js";
import { slackTsToIso } from "../../lib/slackTs.js";
import type { SlackBookmarkItem, SlackCanvasItem, SlackHuddleItem, SlackPinItem } from "./project.js";
import { optStr as str } from "./shape.js";

/** Slack decimal ts (`epochSeconds.micros`) → ISO-8601, or "" when unparseable. Pure. */
function tsToIso({ ts }: { ts: string }): string {
  return blankIfUnparseable({ iso: slackTsToIso({ ts }) });
}

/**
 * This layer's "unparseable" convention, as a statement rather than an expression.
 *
 * `?? ""` is banned outright (`house-rules`) and `iso === undefined ? "" : iso` is the same expression
 * spelled longer, which `prefer-nullish-coalescing` then rewrites back into the banned form. One named
 * function ends that loop, and says out loud that the empty string is a CONVENTION of the bronze record's
 * `tsIso: string` field rather than a claim about when something happened.
 */
function blankIfUnparseable({ iso }: { iso: string | undefined }): string {
  if (iso === undefined) {
    return "";
  }
  return iso;
}

/**
 * A stable message permalink (`<workspaceUrl>/archives/<channel>/p<ts>`), the citation for a pin. Pure.
 *
 * `auth.test`'s real `url` field comes back WITH a trailing slash, so the base is normalised to exactly one —
 * `./fetch.ts`'s own `permalinkFor` already guards this, and a caller resolving `workspaceUrl` live and handing
 * it straight here produced a double slash before this guard existed.
 *
 * @param workspaceUrl the workspace's base URL, resolved once per crawl
 * @param channelId the channel the message is in
 * @param ts the message ts, which becomes the `p`-prefixed fragment with its dot removed
 * @returns the permalink used as the citation — built rather than read from the API, so a pin is citable
 *   without a second call per message
 */
export function slackPermalink({
  workspaceUrl,
  channelId,
  ts,
}: {
  workspaceUrl: string;
  channelId: string;
  ts: string;
}): string {
  const base = workspaceUrl.endsWith("/") ? workspaceUrl : `${workspaceUrl}/`;
  return `${base}archives/${channelId}/p${ts.replace(".", "")}`;
}

/**
 * Shape one raw `pins.list` item (a pinned message) into a {@link SlackPinItem}, or undefined for a
 * non-message / ts-less pin. Pure.
 *
 * @param item the raw pin item
 * @param channelId the channel the pin belongs to
 * @param channelName the channel's display name (optional)
 * @param workspaceUrl the workspace base url (for the permalink)
 * @param authorName the resolved display name of the message author (optional)
 * @returns the shaped pin, or undefined
 */
export function shapePin({
  item,
  channelId,
  channelName,
  workspaceUrl,
  authorName,
}: {
  item: unknown;
  channelId: string;
  channelName?: string;
  workspaceUrl: string;
  authorName?: string;
}): SlackPinItem | undefined {
  const message = isRecord(item) && isRecord(item["message"]) ? item["message"] : undefined;
  const ts = message !== undefined ? str({ value: message["ts"] }) : undefined;
  if (message === undefined || ts === undefined) {
    return undefined; // a non-message pin (e.g. a file pin) is skipped — messages carry the curated signal
  }
  const permalink = str({ value: message["permalink"] }) ?? slackPermalink({ channelId, ts, workspaceUrl });
  const text = str({ value: message["text"] });
  return {
    channelId,
    permalink,
    raw: message,
    ts,
    tsIso: tsToIso({ ts }),
    ...(channelName !== undefined ? { channelName } : {}),
    ...(text !== undefined ? { text } : {}),
    ...(authorName !== undefined ? { author: authorName } : {}),
  };
}

/**
 * Shape one raw `bookmarks.list` bookmark into a {@link SlackBookmarkItem}, or undefined for a link-less
 * one. Pure.
 *
 * @param raw the raw bookmark object
 * @param channelId the channel the bookmark belongs to
 * @param channelName the channel's display name (optional)
 * @returns the shaped bookmark, or undefined
 */
export function shapeBookmark({
  raw,
  channelId,
  channelName,
}: {
  raw: unknown;
  channelId: string;
  channelName?: string;
}): SlackBookmarkItem | undefined {
  const id = isRecord(raw) ? str({ value: raw["id"] }) : undefined;
  const link = isRecord(raw) ? str({ value: raw["link"] }) : undefined;
  if (id === undefined || link === undefined || !isRecord(raw)) {
    return undefined;
  }
  const createdIso = epochIso({ value: raw["date_created"] });
  return {
    channelId,
    id,
    link,
    raw,
    title: str({ value: raw["title"] }) ?? link,
    tsIso: blankIfUnparseable({ iso: createdIso }),
    ...(channelName !== undefined ? { channelName } : {}),
  };
}

/**
 * Whether a raw `files.list` file is a canvas (the durable canvas discovery path). Pure.
 *
 * @param file one raw file row, of unvalidated shape
 * @returns true when any of the three canvas markers is present — Slack has used all three, so checking
 *   one would miss real canvases
 */
export function isCanvasFile({ file }: { file: unknown }): boolean {
  if (!isRecord(file)) {
    return false;
  }
  return (
    file["filetype"] === "canvas" || file["mode"] === "canvas" || file["mimetype"] === "application/vnd.slack-docs"
  );
}

/**
 * Shape one raw `files.list` canvas file into a {@link SlackCanvasItem}, or undefined for a non-canvas /
 * id-less file. The item's own fields are refs only; `raw` is the whole file object, `url_private`
 * included. Pure.
 *
 * @param file the raw file object
 * @returns the shaped canvas, or undefined
 */
export function shapeCanvasFile({ file }: { file: unknown }): SlackCanvasItem | undefined {
  if (!isCanvasFile({ file }) || !isRecord(file)) {
    return undefined;
  }
  const id = str({ value: file["id"] });
  const permalink = str({ value: file["permalink"] });
  if (id === undefined || permalink === undefined) {
    return undefined; // no id or no public permalink — nothing safe to cite
  }
  const createdIso = epochIso({ value: file["created"] });
  const channelId =
    Array.isArray(file["channels"]) && typeof file["channels"][0] === "string" ? file["channels"][0] : undefined;
  return {
    id,
    permalink,
    raw: file,
    title: str({ value: file["title"] }) ?? str({ value: file["name"] }) ?? `Canvas ${id}`,
    tsIso: blankIfUnparseable({ iso: createdIso }),
    ...(channelId !== undefined ? { channelId } : {}),
  };
}

/**
 * Whether a raw `files.list` file is a HUDDLE notes canvas rather than an authored one. Pure.
 *
 * One marker, not three. `isCanvasFile` checks three because Slack has spelled a canvas three ways over
 * time; `is_huddle_canvas` is the only signal for this and it is a boolean Slack sets itself. Measured on a
 * real huddle-notes file (`slopweaver slack probe --method files.info file=F0BTACLP1D0`): the
 * flag is present and true, alongside `huddle_date_start`, `huddle_date_end`, `huddle_summary_id` and
 * `huddle_transcript_file_id`. None of the five is in `@slack/web-api` 8.0.0's typings — see
 * `src/live/slack/fileMeta.ts` for why that is a floor rather than a ceiling.
 *
 * @param file one raw file row, of unvalidated shape
 * @returns true when Slack marks the file as a huddle's notes canvas
 */
export function isHuddleCanvasFile({ file }: { file: unknown }): boolean {
  return isRecord(file) && file["is_huddle_canvas"] === true;
}

/** Slack epoch SECONDS off an unknown field → ISO-8601, or undefined. Pure. */
function epochIso({ value }: { value: unknown }): string | undefined {
  return typeof value === "number" ? epochSecondsToIso({ seconds: value }) : undefined;
}

/**
 * Undo the three entities Slack escapes in a text field, so a huddle title carries the `<@U…>` mentions a
 * resolver recognises rather than `&lt;@U…&gt;`. Pure; the same decoder as `live/slack/fileMeta.ts`, stated
 * twice rather than shared because the two layers must be able to move independently.
 */
function unescapeSlack({ text }: { text: string }): string {
  return text.replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&amp;", "&");
}

/**
 * Shape one raw `files.list` huddle-notes canvas into a {@link SlackHuddleItem}, or undefined for anything
 * that is not one. Ref-only in its own fields; `raw` is the whole file object. Pure.
 *
 * `files.list` gives this shaper the transcript's file ID and nothing of what was said, so what comes out of
 * here is a POINTER. A `huddle_transcript` file's BYTES are
 * cookie-only (`files-pri` answers 302 to the workspace root with `files:read` granted and
 * `file_access: visible`) — and it is no longer the end of it: the WORDS come back inline on a second
 * `files.info` under `include_transcription=true`, which `curatedFetch.ts` makes and folds into
 * `transcriptText`. This function stays pure and body-less; the call that costs a request lives there.
 *
 * @param file the raw file object
 * @returns the shaped huddle, or undefined
 */
export function shapeHuddleFile({ file }: { file: unknown }): SlackHuddleItem | undefined {
  if (!isHuddleCanvasFile({ file }) || !isRecord(file)) {
    return undefined;
  }
  const id = str({ value: file["id"] });
  const permalink = str({ value: file["permalink"] });
  if (id === undefined || permalink === undefined) {
    return undefined; // no id or no permalink — nothing safe to cite
  }
  const startedIso = epochIso({ value: file["huddle_date_start"] });
  const endedIso = epochIso({ value: file["huddle_date_end"] });
  // The huddle's OWN start time, falling back to when Slack wrote the notes. A huddle's identity in time is
  // when people talked, not when the artefact appeared a minute later.
  const tsIso = startedIso ?? epochIso({ value: file["created"] });
  if (tsIso === undefined) {
    // Refused rather than defaulted to "". A record with no timestamp falls out of every export window and
    // out of the watermark, so it would be ingested and then invisible — the silent-loss shape this repo
    // refuses. A huddle Slack dated neither way is not something to guess a date for.
    return undefined;
  }
  const transcriptFileId = str({ value: file["huddle_transcript_file_id"] });
  const summaryId = str({ value: file["huddle_summary_id"] });
  const channelId =
    Array.isArray(file["channels"]) && typeof file["channels"][0] === "string" ? file["channels"][0] : undefined;
  return {
    id,
    permalink,
    raw: file,
    title: unescapeSlack({ text: str({ value: file["title"] }) ?? str({ value: file["name"] }) ?? `Huddle ${id}` }),
    tsIso,
    ...(channelId !== undefined ? { channelId } : {}),
    ...(startedIso !== undefined ? { startedIso } : {}),
    ...(endedIso !== undefined ? { endedIso } : {}),
    ...(transcriptFileId !== undefined ? { transcriptFileId } : {}),
    ...(summaryId !== undefined ? { summaryId } : {}),
  };
}
