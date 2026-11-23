/**
 * The console's live channel window — what `slack channel-view <channel> --json` prints, and the Workstreams page draws
 * when the owner hovers a channel's chip.
 *
 * Hovering a Slack channel on a workstream timeline (for example `#proj-monitoring`) opens a scrollable
 * window into that channel AS IT IS NOW, what Slack desktop would show, images included, so the owner never
 * leaves localhost. So the read is LIVE, one `conversations.history` page every time, never the corpus — whose
 * copy is as old as its last export — and a failed read is said as one rather than drawn from a cache. Only the
 * pictures are cached (`./channelMedia.ts`), because a preview's bytes never change under their file id.
 *
 * What it is not: `slack read-thread`, which downloads every attachment's ORIGINAL and whose channel mode walks the
 * channel's whole history, nor `slack draft context`, which is keyed on a parked draft and counts files rather than
 * fetching them. Each message keeps its Block Kit verbatim, so the console draws rich text through the components the
 * Queue's draft card already draws with; every file is ACCOUNTED for — a picture by its cached hash, anything else by
 * why it is shown as a file card — never dropped.
 *
 * Pictures are Slack-hosted files only (a top-level file, a Block Kit `slack_file`, or a rich-text file element): `./download.ts` sends
 * a token to Slack's own hosts and nowhere else. A link preview's third-party picture is not fetched here.
 */
import { type ConcurrencyLimiter, createConcurrencyLimiter } from "../../lib/resilience.js";
import { err, ok, type Result } from "../../lib/result.js";
import { type LookupSlackFile, resolveBlockFileRefs } from "./blockFiles.js";
import type { FetchPicture, PictureVariant } from "./channelMedia.js";
import { projectChannelRows } from "./channelRows.js";
import { type ChannelViewError, ChannelViewErrors } from "./channelViewErrors.js";
import { boundedLookup, CHANNEL_VIEW_LOOKUPS, CHANNEL_VIEW_PARALLEL, prefetchedLookup } from "./channelViewLookups.js";
import type { VisibleSlackAuthor, VisibleSlackFile, VisibleSlackMessage } from "./types.js";

/**
 * How many of the channel's newest messages one read draws: one `conversations.history` page, enough to scroll back
 * through what the room has been saying lately, and the read's whole boundary — `earlierWithheld` says when the
 * channel holds more. Slack desktop opens on a page of about this size too.
 */
export const CHANNEL_VIEW_MESSAGES = 30;

/**
 * How many pictures one read fetches, newest first, so the ones the owner sees as the window opens at its newest message
 * are the ones drawn. A picture past it is shown as its file card, saying so. A cached picture counts too: the bound
 * is on what one hover may ask Slack for, and a cold cache is the case it exists for.
 */
export const CHANNEL_VIEW_PICTURES = 16;

/** Why a file is drawn as its card rather than as a picture. Every one is said on the card, never silent. */
export type UnshownReason =
  | "not-a-picture"
  | "deleted"
  | "external"
  | "no-access"
  | "no-preview"
  | "past-the-limit"
  | "fetch-failed"
  | "lookup-failed";

/**
 * One file a message carries, as the window draws it.
 *
 * @internal — part of {@link ChannelViewDocument}'s printed shape; nothing names it on its own.
 */
export type ChannelViewFile =
  | {
      readonly shown: "picture";
      readonly id: string;
      readonly name: string | undefined;
      readonly mimetype: string | undefined;
      readonly sha256: string;
      readonly variant: PictureVariant;
    }
  | {
      readonly shown: "card";
      readonly id: string;
      readonly name: string | undefined;
      readonly mimetype: string | undefined;
      readonly reason: UnshownReason;
      /** The provider's or the store's own words, when the reason came with any. */
      readonly detail: string | undefined;
    };

/**
 * One message as the window draws it: who, when, where it lives, its content as Slack returned it, and its files.
 *
 * @internal — part of {@link ChannelViewDocument}'s printed shape; nothing names it on its own.
 */
export interface ChannelViewMessage {
  readonly ts: string;
  /** The instant `ts` names, derived by the projection — never computed here. */
  readonly tsIso: string;
  readonly permalink: string;
  readonly author: VisibleSlackAuthor;
  readonly subtype?: string;
  readonly text: string;
  readonly blocks: readonly unknown[];
  readonly attachments: readonly unknown[];
  readonly files: readonly ChannelViewFile[];
  readonly replyCount: number;
  readonly edited: boolean;
  /** Each emoji the message carries and how many reacted with it, in Slack's order — the row Slack draws under it. */
  readonly reactions: readonly { readonly name: string; readonly count: number }[];
}

/** What `slack channel-view <channel> --json` prints, before the people it names are added. */
export interface ChannelViewDocument {
  readonly kind: "slopweaver.slack.channel-view";
  readonly schemaVersion: 1;
  readonly observedAtIso: string;
  readonly channel: string;
  /** The channel's own name as Slack gives it — `proj-monitoring`, with no `#`. */
  readonly name: string;
  /** The channel itself in Slack. */
  readonly link: string;
  /** Whether the channel holds older messages than this page shows. */
  readonly earlierWithheld: boolean;
  /** Oldest first, the order Slack draws them. */
  readonly messages: readonly ChannelViewMessage[];
}

/** A picture to fetch: which rendition, from where. */
interface PicturePlan {
  readonly kind: "fetch";
  readonly url: string;
  readonly variant: PictureVariant;
}

/**
 * What the window does with one file before any byte is read: fetch Slack's preview of it, or draw it as a card and
 * say why.
 *
 * @param file the file as the projection gave it
 * @returns the preview to fetch, or the reason it is a card
 */
export function picturePlanOf({
  file,
}: {
  file: VisibleSlackFile;
}): PicturePlan | { readonly kind: "card"; readonly reason: UnshownReason } {
  if (file.mode === "tombstone") {
    return { kind: "card", reason: "deleted" };
  }
  if (file.isExternal) {
    return { kind: "card", reason: "external" };
  }
  if (file.fileAccess !== undefined && file.fileAccess !== "visible") {
    return { kind: "card", reason: "no-access" };
  }
  if (file.mimetype === undefined || !file.mimetype.startsWith("image/")) {
    return { kind: "card", reason: "not-a-picture" };
  }
  if (file.thumb480Url !== undefined) {
    return { kind: "fetch", url: file.thumb480Url, variant: "thumb-480" };
  }
  if (file.thumb360Url !== undefined) {
    return { kind: "fetch", url: file.thumb360Url, variant: "thumb-360" };
  }
  return { kind: "card", reason: "no-preview" };
}

/** A file drawn as its card. */
function cardOf({
  file,
  reason,
  detail,
}: {
  file: Pick<VisibleSlackFile, "id" | "mimetype" | "name">;
  reason: UnshownReason;
  detail: string | undefined;
}): ChannelViewFile {
  return { detail, id: file.id, mimetype: file.mimetype, name: file.name, reason, shown: "card" };
}

/** Every file a message carries — its own and the ones its blocks reference — in that order, each one once. */
interface MessageFiles {
  readonly message: VisibleSlackMessage;
  readonly files: readonly VisibleSlackFile[];
  readonly unresolved: readonly { readonly fileId: string; readonly detail: string }[];
}

/**
 * One page's picture plan as it is laid down: the preview fetch started for each file id, and how many more previews
 * it may ask Slack for.
 */
interface PageFetches {
  budget: number;
  readonly fetching: Map<string, Promise<ChannelViewFile>>;
  readonly limiter: ConcurrencyLimiter;
}

/** A file's preview fetched under the page's limiter, and drawn as the picture or as the card saying why not. */
async function fetchedFile({
  file,
  fetchPicture,
  url,
  variant,
}: {
  file: VisibleSlackFile;
  fetchPicture: FetchPicture;
  url: string;
  variant: PictureVariant;
}): Promise<ChannelViewFile> {
  const picture = await fetchPicture({ fileId: file.id, url, variant });
  if (picture.isErr()) {
    return cardOf({ detail: picture.error.message, file, reason: "fetch-failed" });
  }
  return {
    id: file.id,
    mimetype: file.mimetype,
    name: file.name,
    sha256: picture.value.sha256,
    shown: "picture",
    variant,
  };
}

/**
 * One file as the window will draw it. Which pictures are fetched is settled here, synchronously and in the order
 * the page is walked, so the budget and the each-id-once rule are exactly the serial ones; only the fetching itself
 * runs in parallel, under the page's limiter.
 */
async function plannedFile({
  file,
  read,
  fetchPicture,
}: {
  file: VisibleSlackFile;
  read: PageFetches;
  fetchPicture: FetchPicture;
}): Promise<ChannelViewFile> {
  const plan = picturePlanOf({ file });
  if (plan.kind === "card") {
    return cardOf({ detail: undefined, file, reason: plan.reason });
  }
  const seen = read.fetching.get(file.id);
  if (seen !== undefined) {
    return seen;
  }
  if (read.budget === 0) {
    return cardOf({ detail: undefined, file, reason: "past-the-limit" });
  }
  read.budget -= 1;
  const one = read.limiter(() => fetchedFile({ fetchPicture, file, url: plan.url, variant: plan.variant }));
  read.fetching.set(file.id, one);
  return one;
}

/**
 * Turn a page's files into what the window draws: each picture's preview fetched — newest message first, at most
 * {@link CHANNEL_VIEW_PICTURES} of them, each file id once, {@link CHANNEL_VIEW_PARALLEL} at a time — and every other
 * file a card saying why. The answer is one list per message in the order given, keyed by position rather than by
 * `ts`, so two rows sharing a `ts` can never overwrite each other's files.
 */
async function drawnFiles({
  messages,
  fetchPicture,
}: {
  messages: readonly MessageFiles[];
  fetchPicture: FetchPicture;
}): Promise<readonly (readonly ChannelViewFile[])[]> {
  const read: PageFetches = {
    budget: CHANNEL_VIEW_PICTURES,
    fetching: new Map(),
    limiter: createConcurrencyLimiter({ concurrency: CHANNEL_VIEW_PARALLEL }),
  };
  const planned: Promise<readonly ChannelViewFile[]>[] = [];
  for (const entry of messages.toReversed()) {
    const out: Promise<ChannelViewFile>[] = [];
    for (const file of entry.files) {
      out.push(plannedFile({ fetchPicture, file, read }));
    }
    for (const missing of entry.unresolved) {
      out.push(
        Promise.resolve(
          cardOf({
            detail: missing.detail,
            file: { id: missing.fileId },
            reason: "lookup-failed",
          }),
        ),
      );
    }
    planned.push(Promise.all(out));
  }
  const drawn = await Promise.all(planned);
  return drawn.toReversed();
}

/** The window's view of one projected message, with the files it draws. */
function viewMessageOf({
  message,
  replyCount,
  files,
}: {
  message: VisibleSlackMessage;
  replyCount: number;
  files: readonly ChannelViewFile[];
}): ChannelViewMessage {
  return {
    attachments: message.attachments,
    author: message.author,
    blocks: message.blocks,
    edited: message.editedTs !== undefined,
    files,
    permalink: message.permalink,
    reactions: message.reactions.map((reaction) => ({ count: reaction.count, name: reaction.name })),
    replyCount,
    text: message.text,
    ts: message.ts,
    tsIso: message.tsIso,
    ...(message.subtype === undefined ? {} : { subtype: message.subtype }),
  };
}

/**
 * Shape one live read into the window's document: the page projected oldest first, every Block Kit file reference
 * resolved through `files.info`, and each picture's preview fetched through the injected seam.
 *
 * @param channel the conversation id the window shows
 * @param name the channel's name off `conversations.info`
 * @param rows one `conversations.history` page, unparsed, newest first
 * @param hasMore Slack's `has_more` on that page
 * @param workspace the workspace origin off `auth.test`, which every permalink is built from
 * @param lookupFile the `files.info` seam a Block Kit file reference is resolved through
 * @param fetchPicture the seam a picture's preview is fetched through — cache first, then Slack
 * @returns the document, or the refusal when a row is not one the projection can vouch for
 */
export async function channelViewDocument({
  channel,
  name,
  rows,
  hasMore,
  workspace,
  observedAtIso,
  lookupFile,
  fetchPicture,
}: {
  channel: string;
  name: string;
  rows: readonly unknown[];
  hasMore: boolean;
  workspace: string;
  observedAtIso: string;
  lookupFile: LookupSlackFile;
  fetchPicture: FetchPicture;
}): Promise<Result<ChannelViewDocument, ChannelViewError>> {
  const projected = projectChannelRows({ channel, rows, workspace });
  if (projected.isErr()) {
    return err(ChannelViewErrors.rowsUnprojectable({ cause: projected.error.message, channel }));
  }
  // Newest first, so the bound spends its lookups where the window opens; started four at a time ahead of the serial
  // resolver, so the lookups' wall time is rounds of four rather than one after another.
  const newestFirst = projected.value.map((row) => row.message).toReversed();
  const blockFiles = await resolveBlockFileRefs({
    lookup: prefetchedLookup({
      ids: newestFirst.flatMap((message) => message.blockFileRefs),
      lookup: boundedLookup({ limit: CHANNEL_VIEW_LOOKUPS, lookup: lookupFile }),
      parallel: CHANNEL_VIEW_PARALLEL,
    }),
    messages: newestFirst,
  });
  const entries: MessageFiles[] = projected.value.map((row) => ({
    files: [
      ...row.message.files,
      ...blockFiles.resolved.filter((one) => one.messageTs === row.message.ts).map((one) => one.file),
    ],
    message: row.message,
    unresolved: blockFiles.unresolved
      .filter((one) => one.messageTs === row.message.ts)
      .map((one) => ({ detail: one.detail, fileId: one.fileId })),
  }));
  const drawn = await drawnFiles({ fetchPicture, messages: entries });
  const messages = projected.value.map((row, index) =>
    viewMessageOf({ files: drawn[index]!, message: row.message, replyCount: row.replyCount }),
  );
  return ok({
    channel,
    earlierWithheld: hasMore,
    kind: "slopweaver.slack.channel-view",
    link: `${workspace}/archives/${channel}`,
    messages,
    name,
    observedAtIso,
    schemaVersion: 1,
  });
}
