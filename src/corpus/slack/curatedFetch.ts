/**
 * The best-effort curated-surface fetch for Slack (pins + bookmarks per channel, canvases and huddles
 * workspace-wide). Split out of `fetch.ts` (which stays under the file-size ceiling); every lane here is
 * optional — a missing method or a scope gap warns + skips, so the curated pass NEVER sinks the message
 * crawl.
 *
 * Ref-only with ONE exception, and it is deliberate: a huddle's transcript. Everything else here records
 * that a thing exists and where it lives, because the words are already in the message crawl. A huddle's
 * words are in no crawl at all — they exist only inside Slack's transcription — so this lane fetches them,
 * one `files.info` per huddle that names a transcript. See {@link withTranscripts} for the cost.
 *
 * Pins/bookmarks are Slack Tier-2 rate-limited, so they run ONLY for the few most-active channels (a pin is
 * most likely to matter where the conversation is); the uncapped message crawl in `fetch.ts` is the content
 * that matters.
 */

import { collectCursorPages, pushCursorWarning } from "../../lib/paging.js";
import { isRecord } from "../../lib/parsers.js";
import { renderHuddleTranscript, shapeHuddleTranscript } from "../../live/slack/huddleTranscript.js";
import { isHuddleCanvasFile, shapeBookmark, shapeCanvasFile, shapeHuddleFile, shapePin } from "./curated.js";
import type { SlackApi, SlackChannelSummary } from "./fetch.js";
import type {
  SlackBookmarkItem,
  SlackCanvasItem,
  SlackCuratedItems,
  SlackHuddleItem,
  SlackPinItem,
} from "./project.js";
import type { SlackNameMaps } from "./visibleProse.js";

/**
 * The slice of the Slack seam this lane touches — narrowed rather than taking the whole `SlackApi`, so a
 * caller (a test included) has to supply exactly the four methods and nothing else. The alternative was a
 * whole-seam fake in every test, which is how a test ends up asserting a shape it never exercises.
 */
export type CuratedApi = Pick<SlackApi, "pins" | "bookmarks" | "files" | "filesInfo">;

/** At most this many of the most-active channels get a curated pins/bookmarks fetch (Tier-2 rate cap). */
const CURATED_PIN_CHANNEL_CAP = 10;

/** Slack's `files.list` type filter for canvases and posts — what a canvas and a huddle's notes both are. */
const CANVAS_FILE_TYPES = "spaces";

/**
 * Rank crawled channels by activity (messages + replies), most active first, as `{id, name?}`. Used to pick
 * the handful of channels worth a curated pins/bookmarks fetch. Pure.
 *
 * It takes SUMMARIES rather than items on purpose: a count is the whole of what this ranking ever read, and
 * holding every conversation's messages until the curated lane ran was the crawl's unbounded memory growth
 * (see `fetch.SlackChannelSummary`).
 *
 * @param channels the crawled per-channel summaries
 * @returns the channels as `{id, name?}`, most-active first
 */
export function rankChannelsByActivity({
  channels,
}: {
  channels: readonly SlackChannelSummary[];
}): readonly { id: string; name?: string }[] {
  return [...channels]
    .toSorted((a, b) => b.itemCount - a.itemCount)
    .map((c) => (c.channelName !== undefined ? { id: c.channelId, name: c.channelName } : { id: c.channelId }));
}

/** The resolved display name of a pinned message's author (via the user map), or undefined. Pure. */
function pinAuthor({ item, maps }: { item: unknown; maps: SlackNameMaps }): string | undefined {
  const message = isRecord(item) && isRecord(item["message"]) ? item["message"] : undefined;
  const user = message !== undefined && typeof message["user"] === "string" ? message["user"] : undefined;
  return user !== undefined ? maps.userNames[user] : undefined;
}

/** One channel's pinned messages (best-effort — a scope gap/failure warns + returns none). */
async function channelPins({
  api,
  channel,
  workspaceUrl,
  maps,
  warnings,
}: {
  api: CuratedApi;
  channel: { id: string; name?: string };
  workspaceUrl: string;
  maps: SlackNameMaps;
  warnings: string[];
}): Promise<readonly SlackPinItem[]> {
  if (api.pins === undefined) {
    return [];
  }
  try {
    const res = await api.pins({ channel: channel.id });
    return res.items
      .map((item) => {
        const author = pinAuthor({ item, maps });
        return shapePin({
          channelId: channel.id,
          item,
          workspaceUrl,
          ...(channel.name !== undefined ? { channelName: channel.name } : {}),
          ...(author !== undefined ? { authorName: author } : {}),
        });
      })
      .filter((pin): pin is SlackPinItem => pin !== undefined);
  } catch (error: unknown) {
    warnings.push(`slack pins for ${channel.id} skipped: ${error instanceof Error ? error.message : "unknown"}`);
    return [];
  }
}

/** One channel's bookmarks (best-effort — a scope gap/failure warns + returns none). */
async function channelBookmarks({
  api,
  channel,
  warnings,
}: {
  api: CuratedApi;
  channel: { id: string; name?: string };
  warnings: string[];
}): Promise<readonly SlackBookmarkItem[]> {
  if (api.bookmarks === undefined) {
    return [];
  }
  try {
    const res = await api.bookmarks({ channel: channel.id });
    return res.bookmarks
      .map((raw) =>
        shapeBookmark({
          channelId: channel.id,
          raw,
          ...(channel.name !== undefined ? { channelName: channel.name } : {}),
        }),
      )
      .filter((bookmark): bookmark is SlackBookmarkItem => bookmark !== undefined);
  } catch (error: unknown) {
    warnings.push(`slack bookmarks for ${channel.id} skipped: ${error instanceof Error ? error.message : "unknown"}`);
    return [];
  }
}

/**
 * Every workspace canvas AND every huddle via one `files.list` walk (best-effort, paged; anything that is
 * neither is dropped).
 *
 * One walk, two lists. A huddle's notes file passes `isCanvasFile` — it IS a canvas structurally — so the
 * split is by `is_huddle_canvas` FIRST and canvas-hood second, and a huddle therefore never reaches
 * `shapeCanvasFile` at all. Doing it the other way round is what let a private 1:1 call land in bronze as a
 * `canvas` record indistinguishable from a team's strategy doc.
 *
 * @param api the injected Slack seam
 * @param maps the id→name maps, so a transcript's speakers render as people rather than as ids
 * @param warnings the accumulating best-effort warning list
 * @param maxItems the per-lane fetch cap
 * @returns the canvases and the huddles, kept apart
 */
async function workspaceCanvasesAndHuddles({
  api,
  maps,
  warnings,
  maxItems,
}: {
  api: CuratedApi;
  maps: SlackNameMaps;
  warnings: string[];
  maxItems?: number;
}): Promise<{ canvases: readonly SlackCanvasItem[]; huddles: readonly SlackHuddleItem[] }> {
  const fetchFiles = api.files;
  if (fetchFiles === undefined) {
    return { canvases: [], huddles: [] };
  }
  try {
    const files = await collectCursorPages({
      fetchPage: ({ cursor, pageSize }) =>
        // `types: "spaces"` is Slack's canvas/post filter, and it is what makes this walk find anything at
        // all. Unfiltered, `files.list` returns a workspace's files newest-first and they are overwhelmingly
        // images: measured, the first 400 held 3 canvases and no huddle, while one filtered page
        // held 197 canvases with the huddle notes among them.
        fetchFiles({ pageSize, types: CANVAS_FILE_TYPES, ...(cursor !== undefined ? { cursor } : {}) }).then(
          (page) => ({ items: page.files, nextCursor: page.nextCursor }),
        ),
      ...(maxItems !== undefined ? { maxItems } : {}),
    });
    pushCursorWarning({ end: files.end, lane: "slack canvases", warnings });
    const shaped = files.items
      .map((file) => shapeHuddleFile({ file }))
      .filter((huddle): huddle is SlackHuddleItem => huddle !== undefined);
    const huddles = await withTranscripts({ api, huddles: shaped, maps, warnings });
    const canvases = files.items
      .filter((file) => !isHuddleCanvasFile({ file }))
      .map((file) => shapeCanvasFile({ file }))
      .filter((canvas): canvas is SlackCanvasItem => canvas !== undefined);
    return { canvases, huddles };
  } catch (error: unknown) {
    warnings.push(`slack canvases skipped: ${error instanceof Error ? error.message : "unknown"}`);
    return { canvases: [], huddles: [] };
  }
}

/**
 * Gather the curated Slack surfaces best-effort: pins + bookmarks for the most-active channels (ranked +
 * capped here), and canvases + huddles via a workspace-wide `files.list`, each huddle then asked for its
 * transcript. Every lane is optional (a missing method or a scope gap warns + skips), so this NEVER sinks
 * the message crawl. Ref-only except a huddle's transcript — see this module's own header.
 *
 * @param api the injected Slack seam
 * @param channels the crawled per-channel summaries (ranked here to pick the pin/bookmark targets)
 * @param workspaceUrl the workspace base URL (for permalinks)
 * @param maps the id→name maps (to resolve pin authors)
 * @param maxItems per-lane fetch cap (`--fetch-cap`), applied after the channels are ranked
 * @returns the curated items — pins, bookmarks, canvases and huddles — plus best-effort warnings
 */
export async function fetchSlackCurated({
  api,
  channels,
  workspaceUrl,
  maps,
  maxItems,
}: {
  api: CuratedApi;
  channels: readonly SlackChannelSummary[];
  workspaceUrl: string;
  maps: SlackNameMaps;
  maxItems?: number;
}): Promise<{ items: SlackCuratedItems; warnings: readonly string[] }> {
  const selected = rankChannelsByActivity({ channels }).slice(0, CURATED_PIN_CHANNEL_CAP);
  const pins: SlackPinItem[] = [];
  const bookmarks: SlackBookmarkItem[] = [];
  const warnings: string[] = [];
  for (const channel of selected) {
    pins.push(...(await channelPins({ api, channel, maps, warnings, workspaceUrl })));
    bookmarks.push(...(await channelBookmarks({ api, channel, warnings })));
  }
  const { canvases, huddles } = await workspaceCanvasesAndHuddles({
    api,
    maps,
    warnings,
    ...(maxItems !== undefined ? { maxItems } : {}),
  });
  return { items: { bookmarks, canvases, huddles, pins }, warnings };
}

/**
 * Fetch each huddle's TRANSCRIPT and fold its words into the item. Best-effort, per huddle.
 *
 * ## Why this is one extra call per huddle rather than free
 *
 * `files.list` returns a huddle's notes with the transcript's file id and nothing of what was said. The
 * words come back only on `files.info` for the transcript FILE, with Slack's undeclared
 * `include_transcription=true` — see `live/slack/huddleTranscript.ts` for the measurement. So the cost is
 * one `files.info` per huddle that names a transcript: MEASURED on the owner's workspace, 40 of
 * 197 `types=spaces` files named one, at roughly a second each
 * (`slopweaver slack probe --method files.list types=spaces count=200
 * --count-where 'files:huddle_transcript_file_id~F'` reports the 40).
 *
 * Serial and unpaced, matching `blockFiles.ts`: `files.info` is `tier4` in `OPERATION_ENDPOINT_CLASS` and is
 * absent from `PACED_CLASSES`, and it still waits on the shared 429 block. One huddle's failure warns and
 * leaves that huddle body-less rather than sinking the lane, so a single unreadable call cannot cost a run
 * the other thirty-nine.
 *
 * @param api the injected Slack seam
 * @param huddles the shaped huddles, transcript-less
 * @param maps the id→name maps, so a speaker renders as a person
 * @param warnings the accumulating best-effort warning list
 * @returns the same huddles, each carrying `transcriptText` when its words could be read
 */
async function withTranscripts({
  api,
  huddles,
  maps,
  warnings,
}: {
  api: CuratedApi;
  huddles: readonly SlackHuddleItem[];
  maps: SlackNameMaps;
  warnings: string[];
}): Promise<readonly SlackHuddleItem[]> {
  const out: SlackHuddleItem[] = [];
  for (const huddle of huddles) {
    const fileId = huddle.transcriptFileId;
    if (fileId === undefined) {
      out.push(huddle);
      continue;
    }
    try {
      const { file } = await api.filesInfo({ fileId, includeTranscription: true });
      const transcript = shapeHuddleTranscript({ file });
      out.push(
        transcript === undefined
          ? huddle
          : { ...huddle, transcriptText: renderHuddleTranscript({ speakerNames: maps.userNames, transcript }) },
      );
    } catch (error: unknown) {
      warnings.push(`slack huddle transcript ${fileId} skipped: ${error instanceof Error ? error.message : "unknown"}`);
      out.push(huddle);
    }
  }
  return out;
}
