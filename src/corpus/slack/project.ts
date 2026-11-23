/**
 * Pure projection: shaped Slack items → `CorpusRecord[]`. No I/O — every network effect already
 * happened in `fetch.ts`. A channel's activity fans out into: one **message** record per top-level
 * message (`<channel>:<ts>`), one **comment** record per thread reply
 * (`<channel>:<threadTs>:reply:<replyTs>`), and one **file** record per attachment reference
 * (`<channel>:<messageTs>:file:<fileId>`). Ids are stable across re-fetches so dedup collapses re-ingested
 * lines.
 *
 * ## What the record's own fields carry, and what `raw` carries — they are NOT the same
 *
 * A record's **own fields** are refs only (filename/mimetype/title/alt/permalink) and never file bytes.
 * `raw` is deliberately different: it keeps the upstream payload's SHAPE — keys are carried through rather
 * than filtered — so it DOES retain `url_private`, `url_private_download`, `thumb_*` and
 * `permalink_public`. This docstring used to deny that of the whole record, which was false: measured, 9,955
 * Slack rows carry a `url_private` in `raw`, and only about half of them are file records.
 *
 * "Shape" rather than "verbatim", because the two differ in a way that matters here. The writer redacts every
 * string LEAF on the way to disk (`redactRecord.redactRawObject`), so an email inside a payload is stored as
 * `[email]` while its key survives. A URL is therefore retained only where no redaction pass happens to
 * match it, which is measurable rather than promised: probed directly, `url_private` and the Notion and
 * issue-tracker signed URLs pass through `redactText` untouched, while `permalink_public` is the instructive
 * exception — 206 of its 11,072 stored values had an all-DIGIT link suffix, which the `\d{9,}` pass rewrote
 * to `[number]`. The other 98.1%, whose suffix contains a letter, are intact. So what follows describes what
 * the redactor does not match; it is not a claim that raw is untouched.
 *
 * Two reasons the retention stays, now stated rather than contradicted:
 *
 *  1. A `files.slack.com` URL is a **locator, not a credential**. Fetching one needs an
 *     `Authorization: Bearer` header with `files:read` (see `live/slack/download.ts`); the URLs themselves
 *     carry no signature — measured, 43 of 43 values in recorded API responses have no query string at all.
 *  2. A shape-preserving `raw` is what lets a secret somebody pasted upstream be FOUND here. That has
 *     already paid for itself once: a live payment-provider key sitting in a tracker ticket was spotted
 *     through the corpus and reported. Scrubbing `raw` at the write edge would have silently destroyed that.
 *
 * Slack markup (`<@Uxxx>`, `<#Cxxx>`, `<!subteam^Sxxx>`, `<url|label>`) is resolved to human text via the
 * id→name maps the fetch edge built, so no opaque `Uxxxx`/`Cxxxx`/`Sxxxx` id ever lands in stored text
 * (`resolveSlackMarkup`). A usergroup has no name map, so a bare one resolves to the generic `@group`.
 */

import { chunkText } from "../chunkText.js";
import { CURATED_CLASS_ATTR } from "../curated/types.js";
import { extractRefs } from "../refs.js";
import type { CorpusAttributeValue, CorpusRecord, CorpusVisibility } from "../types.js";
import { stampVisibility } from "../visibility.js";
import { authorAfterMeToMe, type SlackOwnerBotIdentity } from "./ownerBot.js";
import { flattenSlackVisibleProse, resolveSlackMarkup, type SlackNameMaps } from "./visibleProse.js";

const EMPTY_MAPS: SlackNameMaps = { channelNames: {}, userNames: {} };

/** A referenced Slack file/image attachment — metadata only, no bytes. */
export interface SlackAttachmentRef {
  readonly id: string;
  readonly name?: string;
  readonly title?: string;
  readonly mimetype?: string;
  readonly altText?: string;
  /** The uploader's user id (resolved to a display name for the record's author). */
  readonly user?: string;
  /**
   * Public/permalink metadata for citation. This FIELD never holds a private download URL — the projected
   * record's `url` is this permalink, else the parent message's. `raw` below is where the upstream
   * `url_private`/`thumb_*` do survive; see the module header for why that is deliberate.
   */
  readonly permalink?: string;
  readonly raw?: Readonly<Record<string, unknown>>;
}

/** A top-level Slack message, already shaped + timestamped by the fetch edge (`text` absent ⇒ files-only). */
export interface SlackMessageItem {
  readonly channelId: string;
  readonly channelName?: string;
  readonly ts: string;
  readonly tsIso: string;
  readonly text?: string;
  readonly author?: string;
  readonly permalink: string;
  readonly reactions: readonly string[];
  readonly files: readonly SlackAttachmentRef[];
  readonly raw?: Readonly<Record<string, unknown>>;
}

/** A Slack thread reply (a message with a parent `threadTs`). */
export interface SlackReplyItem {
  readonly channelId: string;
  readonly channelName?: string;
  readonly threadTs: string;
  readonly ts: string;
  readonly tsIso: string;
  readonly text?: string;
  readonly author?: string;
  readonly permalink: string;
  readonly files: readonly SlackAttachmentRef[];
  readonly raw?: Readonly<Record<string, unknown>>;
}

/** One channel's fetched activity: top-level messages + thread replies (+ its privacy signal). */
export interface SlackChannelItems {
  readonly channelId: string;
  readonly channelName?: string;
  readonly messages: readonly SlackMessageItem[];
  readonly replies: readonly SlackReplyItem[];
  /** Privacy signal from `conversations.list` — any true ⇒ the channel's records project to `private`. */
  readonly isPrivate?: boolean;
  readonly isIm?: boolean;
  readonly isMpim?: boolean;
  /** Whether the read token's own identity belongs to this channel (`conversations.list`'s `is_member`). */
  readonly isMember?: boolean;
  /** Whether Slack has archived this channel. */
  readonly isArchived?: boolean;
}

/**
 * The least a conversation has to carry for a curated surface to inherit its visibility: its id plus the
 * privacy flags. Both {@link SlackChannelItems} and a crawl's folded-down summary satisfy it, which is what
 * lets an already-committed conversation keep lending its lane to its pins after its messages are released.
 */
type SlackChannelVisibilitySignal = Pick<SlackChannelItems, "channelId" | "isPrivate" | "isIm" | "isMpim">;

/**
 * The reach facts a channel's records carry, so a citation can say WHERE it came from rather than implying
 * the owner was in the room. Pure.
 *
 * A record from a channel the owner has never joined is perfectly good evidence — a user token reads 321 such
 * public channels in this workspace — but it is a different KIND of evidence from something said in a channel
 * the owner is in, and an answer that cannot tell them apart will eventually assert the owner saw something they did not.
 * Likewise `archived`: a finished project's channel is worth reading precisely because the work concluded, and
 * quoting it as current activity is the mistake that fact prevents.
 *
 * DM and group-DM conversations are skipped: `conversations.list` omits `is_member` for them because the
 * concept does not apply, and stamping `non-member` off an absent field would be a claim the payload never
 * made.
 *
 * @param channel the channel's discovery signals
 * @returns the attrs to merge, spread-ready — empty for a DM/group DM
 */
export function channelReachAttrs({
  channel,
}: {
  channel: Pick<SlackChannelItems, "isMember" | "isArchived" | "isIm" | "isMpim">;
}): { membership?: string; archived?: boolean } {
  if (channel.isIm === true || channel.isMpim === true) {
    return {};
  }
  return {
    membership: channel.isMember === true ? "member" : "non-member",
    ...(channel.isArchived === true ? { archived: true } : {}),
  };
}

/**
 * The visibility a channel's records inherit: `private` for a private channel, a DM (`im`), or a group DM
 * (`mpim`); `public` otherwise (including a channel with no privacy signal). Pure — the projector routes
 * every one of the channel's records through {@link ../visibility.stampVisibility} with this value.
 *
 * @param channel the channel's privacy signal
 * @returns `"private"` iff the channel is private/DM/mpim, else `"public"`
 */
export function slackChannelVisibility({
  channel,
}: {
  channel: Pick<SlackChannelItems, "isPrivate" | "isIm" | "isMpim">;
}): CorpusVisibility {
  return channel.isPrivate === true || channel.isIm === true || channel.isMpim === true ? "private" : "public";
}

/** A pinned message — the channel-curated knowledge a channel deliberately keeps (ref-only). */
export interface SlackPinItem {
  readonly channelId: string;
  readonly channelName?: string;
  readonly ts: string;
  readonly tsIso: string;
  readonly text?: string;
  readonly author?: string;
  readonly permalink: string;
  readonly raw?: Readonly<Record<string, unknown>>;
}

/** A channel bookmark — a curated link the channel keeps. */
export interface SlackBookmarkItem {
  readonly channelId: string;
  readonly channelName?: string;
  readonly id: string;
  readonly title: string;
  readonly link: string;
  readonly tsIso: string;
  readonly raw?: Readonly<Record<string, unknown>>;
}

/** A Slack canvas — a deliberately-authored doc (ref-only: title + permalink, never bytes/signed URLs). */
export interface SlackCanvasItem {
  readonly id: string;
  readonly title: string;
  readonly tsIso: string;
  readonly permalink: string;
  readonly channelId?: string;
  readonly author?: string;
  readonly raw?: Readonly<Record<string, unknown>>;
}

/**
 * A Slack HUDDLE: its auto-generated notes canvas, POINTERS to the transcript and AI summary Slack generated
 * beside it, and — when the fetch lane could read them — the transcript's WORDS.
 *
 * The pointers come out of the `files.list` walk (`curated.shapeHuddleFile`); `transcriptText` costs a
 * second `files.info` per huddle and is filled in by `curatedFetch.withTranscripts`. The AI summary stays a
 * pointer and is never followed: it is Slack's paraphrase, not what was said.
 */
export interface SlackHuddleItem {
  readonly id: string;
  readonly title: string;
  /** The huddle's start time when Slack reported one, else the notes file's creation time. */
  readonly tsIso: string;
  readonly permalink: string;
  readonly channelId?: string;
  /** When people actually started talking, when Slack reported it. */
  readonly startedIso?: string;
  readonly endedIso?: string;
  /** The auto-generated transcript file's id — the argument for `slopweaver slack read-file`. */
  readonly transcriptFileId?: string;
  /** Slack's AI summary id, recorded and never followed (it is a paraphrase, not what was said). */
  readonly summaryId?: string;
  /**
   * The transcript's WORDS, rendered `[mm:ss] speaker: line`, when the fetch lane got them.
   *
   * Absent means the lane could not read them — no transcript was generated, the call failed, or this
   * projection ran on items shaped before the words were reachable at all. It never means "empty huddle".
   */
  readonly transcriptText?: string;
  readonly raw?: Readonly<Record<string, unknown>>;
}

/** The curated Slack surfaces gathered by the best-effort curated lane. */
export interface SlackCuratedItems {
  readonly pins: readonly SlackPinItem[];
  readonly bookmarks: readonly SlackBookmarkItem[];
  readonly canvases: readonly SlackCanvasItem[];
  /**
   * Huddles, kept APART from `canvases` even though both arrive on the same `files.list` walk. A huddle's
   * notes file IS a canvas by every structural marker, so one list would have been the smaller change — and
   * it is exactly the sweeping-into-a-shared-bucket the huddle kind exists to prevent.
   */
  readonly huddles: readonly SlackHuddleItem[];
}

/** `slack/<channelId>` container (channel name folded into text/title, never the low-cardinality key). */
function containerFor({ channelId }: { channelId: string }): string {
  return `slack/${channelId}`;
}

/** A one-line reaction summary (`:emoji: x3`) appended to a message's text, when any. */
function reactionSummary({ reactions }: { reactions: readonly string[] }): string {
  return reactions.length > 0 ? `Reactions: ${reactions.join(", ")}` : "";
}

/** File attachment refs rendered as citable metadata text (never a signed URL). */
function fileSummary({ files }: { files: readonly SlackAttachmentRef[] }): string {
  if (files.length === 0) {
    return "";
  }
  const names = files.map((file) => file.title ?? file.name ?? file.id);
  return `Attachments: ${names.join(", ")}`;
}

/** Attachment display names (title→name→id) — reused for the file summary text and the rich attrs. */
function fileNames({ files }: { files: readonly SlackAttachmentRef[] }): readonly string[] {
  return files.map((file) => file.title ?? file.name ?? file.id);
}

/** Project one message into its `message` record plus a `file` record per attachment. */
function messageRecords({
  message,
  maps,
  ownerBot,
}: {
  message: SlackMessageItem;
  maps: SlackNameMaps;
  ownerBot: SlackOwnerBotIdentity | undefined;
}): CorpusRecord[] {
  const container = containerFor({ channelId: message.channelId });
  const resolved = message.text !== undefined ? resolveSlackMarkup({ maps, text: message.text }) : undefined;
  const parts = [resolved, reactionSummary({ reactions: message.reactions }), fileSummary({ files: message.files })];
  // Block Kit and attachment prose come LAST, deduped against everything already assembled: an app message
  // routinely leaves `text` empty and puts the whole body here, so without this the record indexes as a
  // placeholder while its content sits unread in `raw`.
  const text = [
    ...parts,
    ...flattenSlackVisibleProse({ dedupeAgainst: parts.filter((part) => part !== undefined), maps, raw: message.raw }),
  ]
    .filter((part): part is string => part !== undefined && part.length > 0)
    .join("\n\n");
  const channelLabel = message.channelName !== undefined ? `#${message.channelName}` : message.channelId;
  const author = authorAfterMeToMe({ author: message.author, ownerBot, raw: message.raw });
  const attrs: Record<string, CorpusAttributeValue> = { channel: channelLabel };
  if (message.reactions.length > 0) {
    attrs["reactions"] = message.reactions;
  }
  if (message.files.length > 0) {
    attrs["files"] = fileNames({ files: message.files });
  }
  const records: CorpusRecord[] = [
    {
      attrs,
      container,
      kind: "message",
      refs: resolved !== undefined ? extractRefs({ text: resolved }) : [],
      source: "slack",
      sourceId: `${message.channelId}:${message.ts}`,
      text: text.length > 0 ? text : `(empty message in ${channelLabel})`,
      title: `${channelLabel} message`,
      tsIso: message.tsIso,
      url: message.permalink,
      ...(author !== undefined ? { author } : {}),
      ...(message.raw !== undefined ? { raw: message.raw } : {}),
    },
  ];
  records.push(
    ...fileRecords({
      channelId: message.channelId,
      container,
      files: message.files,
      maps,
      parentTs: message.ts,
      permalink: message.permalink,
      tsIso: message.tsIso,
    }),
  );
  return records;
}

/** Project a thread reply into a `comment` record plus a `file` record per attachment. */
function replyRecords({
  reply,
  maps,
  ownerBot,
}: {
  reply: SlackReplyItem;
  maps: SlackNameMaps;
  ownerBot: SlackOwnerBotIdentity | undefined;
}): CorpusRecord[] {
  const container = containerFor({ channelId: reply.channelId });
  const resolved = reply.text !== undefined ? resolveSlackMarkup({ maps, text: reply.text }) : undefined;
  const parts = [resolved, fileSummary({ files: reply.files })];
  // Same recovery as a top-level message — a reply can be an app post too, and wiring only the message path
  // is a defect a projection test over a single message cannot see.
  const text = [
    ...parts,
    ...flattenSlackVisibleProse({ dedupeAgainst: parts.filter((part) => part !== undefined), maps, raw: reply.raw }),
  ]
    .filter((part): part is string => part !== undefined && part.length > 0)
    .join("\n\n");
  const channelLabel = reply.channelName !== undefined ? `#${reply.channelName}` : reply.channelId;
  const author = authorAfterMeToMe({ author: reply.author, ownerBot, raw: reply.raw });
  const attrs: Record<string, CorpusAttributeValue> = { channel: channelLabel, threadTs: reply.threadTs };
  if (reply.files.length > 0) {
    attrs["files"] = fileNames({ files: reply.files });
  }
  const records: CorpusRecord[] = [
    {
      attrs,
      container,
      kind: "comment",
      refs: resolved !== undefined ? extractRefs({ text: resolved }) : [],
      source: "slack",
      sourceId: `${reply.channelId}:${reply.threadTs}:reply:${reply.ts}`,
      text: text.length > 0 ? text : "(empty reply)",
      tsIso: reply.tsIso,
      url: reply.permalink,
      ...(author !== undefined ? { author } : {}),
      ...(reply.raw !== undefined ? { raw: reply.raw } : {}),
    },
  ];
  records.push(
    ...fileRecords({
      channelId: reply.channelId,
      container,
      files: reply.files,
      maps,
      parentTs: reply.ts,
      permalink: reply.permalink,
      tsIso: reply.tsIso,
    }),
  );
  return records;
}

/**
 * The address a file record cites: the file's own permalink, else the message it was attached to. Pure.
 *
 * Slack sends some files in a message as a stub with no permalink of its own — a deleted file
 * (`mode: "tombstone"`), or one shared from another workspace that says only `file_access: "check_file_info"`.
 * The message that carried it is then the citation, as {@link SlackAttachmentRef.permalink} says.
 */
function fileCitation({ file, messagePermalink }: { file: SlackAttachmentRef; messagePermalink: string }): string {
  const { permalink } = file;
  if (permalink === undefined) {
    return messagePermalink;
  }
  return permalink;
}

/** One `file` record per attachment ref — cites the parent message permalink (files' own URLs expire). */
function fileRecords({
  files,
  container,
  parentTs,
  channelId,
  permalink,
  tsIso,
  maps,
}: {
  files: readonly SlackAttachmentRef[];
  container: string;
  parentTs: string;
  channelId: string;
  permalink: string;
  tsIso: string;
  maps: SlackNameMaps;
}): CorpusRecord[] {
  return files.map((file): CorpusRecord => {
    const label = file.title ?? file.name ?? file.id;
    const descriptor = [file.mimetype, file.altText].filter(
      (part): part is string => part !== undefined && part.length > 0,
    );
    const text = [`File: ${label}`, ...descriptor].join(" · ");
    const author = file.user !== undefined ? maps.userNames[file.user] : undefined;
    return {
      container,
      kind: "file",
      refs: [],
      source: "slack",
      sourceId: `${channelId}:${parentTs}:file:${file.id}`,
      text,
      title: label,
      tsIso,
      url: fileCitation({ file, messagePermalink: permalink }),
      ...(author !== undefined ? { author } : {}),
      ...(file.raw !== undefined ? { raw: file.raw } : {}),
    };
  });
}

/** The empty curated surfaces (so the default is stable). */
const EMPTY_CURATED: SlackCuratedItems = { bookmarks: [], canvases: [], huddles: [], pins: [] };

/** One `pin` record — a channel-curated pinned message, resolved + cited by its permalink. Pure. */
function pinRecord({ pin, maps }: { pin: SlackPinItem; maps: SlackNameMaps }): CorpusRecord {
  const channelLabel = pin.channelName !== undefined ? `#${pin.channelName}` : pin.channelId;
  const resolved = pin.text !== undefined ? resolveSlackMarkup({ maps, text: pin.text }) : undefined;
  return {
    attrs: { channel: channelLabel },
    container: containerFor({ channelId: pin.channelId }),
    kind: "pin",
    refs: resolved !== undefined ? extractRefs({ text: resolved }) : [],
    source: "slack",
    sourceId: `${pin.channelId}:pin:${pin.ts}`,
    text: resolved !== undefined && resolved.length > 0 ? resolved : `Pinned message in ${channelLabel}`,
    title: `${channelLabel} pinned`,
    tsIso: pin.tsIso,
    url: pin.permalink,
    ...(pin.author !== undefined ? { author: pin.author } : {}),
    ...(pin.raw !== undefined ? { raw: pin.raw } : {}),
  };
}

/** One `bookmark` record — a curated channel link (ref-only). Pure. */
function bookmarkRecord({ bookmark }: { bookmark: SlackBookmarkItem }): CorpusRecord {
  const channelLabel = bookmark.channelName !== undefined ? `#${bookmark.channelName}` : bookmark.channelId;
  return {
    attrs: { channel: channelLabel },
    container: containerFor({ channelId: bookmark.channelId }),
    kind: "bookmark",
    refs: extractRefs({ text: bookmark.link }),
    source: "slack",
    sourceId: `${bookmark.channelId}:bookmark:${bookmark.id}`,
    text: bookmark.title.length > 0 ? bookmark.title : bookmark.link,
    title: bookmark.title.length > 0 ? bookmark.title : "bookmark",
    tsIso: bookmark.tsIso,
    url: bookmark.link,
    ...(bookmark.raw !== undefined ? { raw: bookmark.raw } : {}),
  };
}

/** One `canvas` record — a deliberately-authored doc (ref-only), classified `strategy`. Pure. */
function canvasRecord({ canvas }: { canvas: SlackCanvasItem }): CorpusRecord {
  return {
    attrs: { [CURATED_CLASS_ATTR]: "strategy" },
    container: canvas.channelId !== undefined ? containerFor({ channelId: canvas.channelId }) : "slack",
    kind: "canvas",
    refs: [],
    source: "slack",
    sourceId: `canvas:${canvas.id}`,
    text: canvas.title.length > 0 ? canvas.title : `Canvas ${canvas.id}`,
    title: canvas.title.length > 0 ? canvas.title : "canvas",
    tsIso: canvas.tsIso,
    url: canvas.permalink,
    ...(canvas.author !== undefined ? { author: canvas.author } : {}),
    ...(canvas.raw !== undefined ? { raw: canvas.raw } : {}),
  };
}

/** The `[start → end]` window line for a huddle's own text, or undefined when Slack dated neither end. */
function huddleWindow({ huddle }: { huddle: SlackHuddleItem }): string | undefined {
  return huddle.startedIso !== undefined && huddle.endedIso !== undefined
    ? `${huddle.startedIso} → ${huddle.endedIso}`
    : undefined;
}

/**
 * The huddle attrs every one of its records carries — they describe the CALL, not the chunk. Pure.
 *
 * `huddleTranscriptChars` is the one that is not just metadata: it is present exactly when this projection
 * put the words in bronze, so a reader (and `atlas slack`'s census) can tell "Slack named a transcript file"
 * apart from "its words are here". They are different facts.
 */
function huddleAttrs({ huddle }: { huddle: SlackHuddleItem }): Record<string, CorpusAttributeValue> {
  return {
    [CURATED_CLASS_ATTR]: "strategy",
    ...(huddle.transcriptFileId !== undefined ? { huddleTranscriptFileId: huddle.transcriptFileId } : {}),
    ...(huddle.transcriptText !== undefined ? { huddleTranscriptChars: huddle.transcriptText.length } : {}),
    ...(huddle.summaryId !== undefined ? { huddleSummaryId: huddle.summaryId } : {}),
    ...(huddle.startedIso !== undefined ? { huddleStartedIso: huddle.startedIso } : {}),
    ...(huddle.endedIso !== undefined ? { huddleEndedIso: huddle.endedIso } : {}),
  };
}

/**
 * The `huddle` records for one recorded conversation — its words when the fetch lane got them, else the
 * pointer alone. ALWAYS private: `stampVisibility` derives that from the kind, so these do not have to
 * remember to ask for it (`corpus/visibility.ts`'s `ALWAYS_PRIVATE_KINDS`). Pure.
 *
 * ## One huddle, several records, and which one the census counts
 *
 * A transcript measured 23,391 characters for a 26-minute call on the owner's workspace
 * (`slopweaver slack probe --method files.info file=<id> include_transcription=true
 * --count-field file.huddle_transcription.lines` reported 141 lines). One record that size is an atom
 * retrieval can only return whole, so the words are split by the corpus-wide `chunkText` exactly as a long
 * Notion page is, and each chunk is its own record: a call short enough to fit one chunk keeps the bare
 * `huddle:<id>` source id, and a longer one suffixes every chunk, exactly as `notion/project.ts` does. What
 * keeps `atlas slack`'s census counting huddles rather than chunks is the `chunkIndex` attr, not the id —
 * see `cli/commands/atlas/slackRun.ts`'s `asHuddleRow`.
 *
 * A huddle with no readable transcript still projects exactly ONE record, unchanged from the lane that
 * shipped before the words were reachable: the title, the window and the `read-file` command. That is the
 * honest answer when nothing was said into the corpus, and it is why the pointer line is not appended to a
 * record that already carries the words.
 *
 * @param huddle the shaped huddle
 * @returns the corpus records, in chunk order
 */
function huddleRecords({ huddle }: { huddle: SlackHuddleItem }): readonly CorpusRecord[] {
  const window = huddleWindow({ huddle });
  const attrs = huddleAttrs({ huddle });
  const chunks = huddle.transcriptText === undefined ? [] : chunkText({ text: huddle.transcriptText });
  if (chunks.length === 0) {
    const pointer =
      huddle.transcriptFileId !== undefined
        ? `Transcript: slopweaver slack read-file ${huddle.transcriptFileId}`
        : "No transcript was generated for this huddle.";
    return [
      {
        attrs,
        container: huddle.channelId !== undefined ? containerFor({ channelId: huddle.channelId }) : "slack",
        kind: "huddle",
        refs: [],
        source: "slack",
        sourceId: `huddle:${huddle.id}`,
        text: [huddle.title, window, pointer].filter((part) => part !== undefined).join("\n"),
        title: huddle.title,
        tsIso: huddle.tsIso,
        url: huddle.permalink,
        ...(huddle.raw !== undefined ? { raw: huddle.raw } : {}),
      },
    ];
  }
  return chunks.map((chunk, index) => huddleChunkRecord({ chunk, chunkCount: chunks.length, huddle, index, window }));
}

/**
 * One chunk of a huddle's transcript as a record. Pure.
 *
 * The window is folded into the FIRST chunk's text and the title carries `(n/N)` on every chunk of a
 * multi-chunk call, so a retrieval hit in the middle of a long huddle still says which call it came from
 * without repeating the header into every chunk's embedding.
 *
 * @param chunk this chunk's transcript text
 * @param chunkCount how many chunks the transcript split into
 * @param huddle the shaped huddle
 * @param index this chunk's zero-based position
 * @param window the `start → end` line, when Slack dated both ends
 * @returns the corpus record
 */
function huddleChunkRecord({
  chunk,
  chunkCount,
  huddle,
  index,
  window,
}: {
  chunk: string;
  chunkCount: number;
  huddle: SlackHuddleItem;
  index: number;
  window: string | undefined;
}): CorpusRecord {
  const single = chunkCount === 1;
  const head = index === 0 ? [huddle.title, window].filter((part) => part !== undefined) : [];
  const text = [...head, chunk].join("\n\n");
  return {
    attrs: {
      ...huddleAttrs({ huddle }),
      ...(single ? {} : { chunkCount, chunkIndex: index }),
    },
    container: huddle.channelId !== undefined ? containerFor({ channelId: huddle.channelId }) : "slack",
    kind: "huddle",
    refs: extractRefs({ text: chunk }),
    source: "slack",
    sourceId: single ? `huddle:${huddle.id}` : `huddle:${huddle.id}:chunk:${String(index)}`,
    text,
    title: single ? huddle.title : `${huddle.title} (${String(index + 1)}/${String(chunkCount)})`,
    tsIso: huddle.tsIso,
    url: huddle.permalink,
    ...(huddle.raw !== undefined ? { raw: huddle.raw } : {}),
  };
}

/**
 * The channelId → visibility map for the crawled channels, so curated surfaces inherit their lane. Pure.
 *
 * Keyed off the privacy SIGNALS rather than the items, so a conversation the crawl has already committed and
 * folded to a summary still lends its visibility to its pins and bookmarks. Without that, a public channel's
 * pin would fail closed to `private` (see the caller) purely because its messages were no longer in memory.
 */
function channelVisibilityMap({
  channels,
}: {
  channels: readonly SlackChannelVisibilitySignal[];
}): ReadonlyMap<string, CorpusVisibility> {
  return new Map(channels.map((channel) => [channel.channelId, slackChannelVisibility({ channel })]));
}

/**
 * The curated surfaces — pins, bookmarks, canvases and huddles — as visibility-stamped records. Pure.
 *
 * Split out of {@link projectSlackRecords} so each stays one readable pass; the message/reply walk and the
 * curated walk share nothing but the output array.
 *
 * @param channels the channels whose privacy signals the curated items inherit
 * @param curated the curated surfaces
 * @param maps the id→name maps, for a pin's markup
 * @returns the stamped curated records
 */
function curatedRecords({
  channels,
  curated,
  maps,
}: {
  channels: readonly SlackChannelVisibilitySignal[];
  curated: SlackCuratedItems;
  maps: SlackNameMaps;
}): readonly CorpusRecord[] {
  const byChannel = channelVisibilityMap({ channels });
  // Curated surfaces inherit their channel's visibility. Pins/bookmarks always come from a crawled channel
  // (so it's in the map), but canvases come from the workspace-wide `files.list` and may belong to a
  // channel NOT in `channels` (or none at all) — an unknown channel FAILS CLOSED to `private` so a private
  // channel's canvas can never leak as public. The owner still sees it via the owner lens.
  const visibilityFor = ({ channelId }: { channelId: string | undefined }): CorpusVisibility =>
    channelId !== undefined ? (byChannel.get(channelId) ?? "private") : "private";
  return [
    ...curated.pins.map((pin) =>
      stampVisibility({ record: pinRecord({ maps, pin }), visibility: visibilityFor({ channelId: pin.channelId }) }),
    ),
    ...curated.bookmarks.map((bookmark) =>
      stampVisibility({
        record: bookmarkRecord({ bookmark }),
        visibility: visibilityFor({ channelId: bookmark.channelId }),
      }),
    ),
    ...curated.canvases.map((canvas) =>
      stampVisibility({
        record: canvasRecord({ canvas }),
        visibility: visibilityFor({ channelId: canvas.channelId }),
      }),
    ),
    // A huddle asks for `private` explicitly AND is derived private from its kind. Belt and braces on
    // purpose: the explicit argument says what this call site intends, and the derivation is what survives a
    // future call site that forgets to.
    ...curated.huddles.flatMap((huddle) =>
      huddleRecords({ huddle }).map((record) => stampVisibility({ record, visibility: "private" })),
    ),
  ];
}

/**
 * Project every channel's messages + replies (+ their attachment refs) and the curated surfaces
 * (pins/bookmarks/canvases) into corpus records, resolving Slack markup via the id→name maps. PR4.5:
 * every record is routed through the single {@link ../visibility.stampVisibility} choke-point with its
 * channel's visibility (private channel / DM / mpim ⇒ `private`), and the owner's own bot posts resolve
 * back to the owner (me-to-me). Curated surfaces inherit their channel's visibility (unknown ⇒ public).
 *
 * @param channels the fetched per-channel items to project
 * @param crawledChannels every conversation the crawl read, as visibility signals — the lane a curated
 *   surface inherits. Defaults to `channels`, which is right whenever the run holds every conversation's
 *   items; a run that committed per-conversation passes its summaries, because the items are gone
 * @param maps the id→name maps for markup resolution (defaults to empty — renders generic names)
 * @param curated the curated surfaces gathered by the best-effort lane (defaults to empty)
 * @param ownerBot the owner's declared bot identity for me-to-me resolution (default: none ⇒ no-op)
 * @returns the flattened, visibility-stamped corpus records
 */
export function projectSlackRecords({
  channels,
  crawledChannels = channels,
  maps = EMPTY_MAPS,
  curated = EMPTY_CURATED,
  ownerBot,
}: {
  channels: readonly SlackChannelItems[];
  crawledChannels?: readonly SlackChannelVisibilitySignal[];
  maps?: SlackNameMaps;
  curated?: SlackCuratedItems;
  ownerBot?: SlackOwnerBotIdentity;
}): readonly CorpusRecord[] {
  const records: CorpusRecord[] = [];
  for (const channel of channels) {
    const visibility = slackChannelVisibility({ channel });
    const reach = channelReachAttrs({ channel });
    const stamp = (record: CorpusRecord): CorpusRecord =>
      stampVisibility({ record: { ...record, attrs: { ...record.attrs, ...reach } }, visibility });
    for (const message of channel.messages) {
      records.push(...messageRecords({ maps, message, ownerBot }).map(stamp));
    }
    for (const reply of channel.replies) {
      records.push(...replyRecords({ maps, ownerBot, reply }).map(stamp));
    }
  }
  records.push(...curatedRecords({ channels: crawledChannels, curated, maps }));
  return records;
}
