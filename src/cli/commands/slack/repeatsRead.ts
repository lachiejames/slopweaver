/**
 * The live read behind `slopweaver slack repeats`: every message one identity sent in the window, read place
 * by place, completely or not at all. Seams are injected, so a test drives it with plain fakes.
 *
 * - **As them**, `search.messages "from:<@self>"` FINDS the places they wrote in — every channel, thread and DM
 *   their token can see — and each is then read whole, because search collapses messages that sit close
 *   together, which is exactly the pair this audit is for.
 * - **As the bot**, a bot token cannot search, so every conversation it is in is listed and read: history
 *   back to {@link BOT_ROOT_HORIZON_DAYS}, so a reply in the window under an older root is still found, and
 *   each root whose latest reply lands in the window has its thread read.
 *
 * A place that cannot be read completely is named in `unread`, never skipped: an audit with a gap in it says so.
 */

import type { SlackApi, SlackChannelRef } from "../../../corpus/slack/fetch.js";
import { slackTsFromEpochMs } from "../../../lib/slackTs.js";
import { fetchCompleteSlackChannels } from "../../../live/slack/channelPagination.js";
import { fetchCompleteSlackHistory, fetchCompleteSlackThread } from "../../../live/slack/pagination.js";
import { type SlackSearchMessages, searchAllPages } from "../../../live/slack/searchMessages.js";
import type { AuditMessage, RepeatActor } from "../../../outbound/slack/repeatAudit.js";
import type { RepeatSelf } from "../../../outbound/slack/repeatMatch.js";
import { DAY_MS } from "../../../outbound/slack/repeatMatch.js";
import { auditMessagesOfRaw, placesOfSearch, type RepeatPlace, threadRootsInWindow } from "./repeatsCore.js";

/** How far back the bot's history is read for thread roots whose replies land in the window. */
const BOT_ROOT_HORIZON_DAYS = 30;

/** Search matches per page, Slack's own maximum. */
const SEARCH_PAGE_SIZE = 100;

/** The most search pages read; a result spanning more is reported unread, never truncated silently. */
const SEARCH_MAX_PAGES = 100;

/** What one identity's read produced. */
export interface ActorRead {
  readonly messages: readonly AuditMessage[];
  readonly placesRead: number;
  readonly unread: readonly string[];
}

/** The seams one identity's read runs over. */
export interface ActorReadSeams {
  readonly api: Pick<SlackApi, "history" | "replies" | "listChannels">;
  readonly self: RepeatSelf;
  readonly workspaceUrl: string;
  /** Present for the as-me read only: the bot token cannot search. */
  readonly search?: SlackSearchMessages | undefined;
}

/** The window one read covers. */
interface ReadWindow {
  readonly sinceMs: number;
  readonly nowMs: number;
}

/** A read's mutable accumulator. */
interface Accumulator {
  readonly messages: AuditMessage[];
  readonly unread: string[];
  placesRead: number;
}

/** One thread to open whole. */
interface ThreadPlace {
  readonly channel: string;
  readonly threadTs: string;
}

/** Read one thread whole and add this identity's messages in it. */
async function readThread({
  seams,
  actor,
  place,
  window,
  into,
}: {
  seams: ActorReadSeams;
  actor: RepeatActor;
  place: ThreadPlace;
  window: ReadWindow;
  into: Accumulator;
}): Promise<void> {
  const read = await fetchCompleteSlackThread({ api: seams.api, channel: place.channel, threadTs: place.threadTs });
  if (read.isErr()) {
    into.unread.push(`${actor} ${place.channel} thread ${place.threadTs}: ${read.error.message}`);
    return;
  }
  into.placesRead += 1;
  into.messages.push(
    ...auditMessagesOfRaw({
      actor,
      channel: place.channel,
      rawMessages: read.value.rawMessages,
      self: seams.self,
      sinceMs: window.sinceMs,
      workspaceUrl: seams.workspaceUrl,
    }),
  );
}

/**
 * Read one conversation's top level from `oldestMs`, add this identity's messages in the window, and answer
 * the thread roots worth opening.
 *
 * @returns the roots to open, empty when the read failed
 */
async function readTopLevel({
  seams,
  actor,
  channel,
  oldestMs,
  window,
  into,
}: {
  seams: ActorReadSeams;
  actor: RepeatActor;
  channel: string;
  oldestMs: number;
  window: ReadWindow;
  into: Accumulator;
}): Promise<readonly string[]> {
  const read = await fetchCompleteSlackHistory({
    api: seams.api,
    channel,
    latest: slackTsFromEpochMs({ ms: window.nowMs }),
    oldest: slackTsFromEpochMs({ ms: oldestMs }),
    paced: true,
  });
  if (read.isErr()) {
    into.unread.push(`${actor} ${channel}: ${read.error.message}`);
    return [];
  }
  into.placesRead += 1;
  into.messages.push(
    ...auditMessagesOfRaw({
      actor,
      channel,
      rawMessages: read.value.rawMessages,
      self: seams.self,
      sinceMs: window.sinceMs,
      workspaceUrl: seams.workspaceUrl,
    }),
  );
  const joinedBy = actor === "me" ? seams.self.userId : undefined;
  return threadRootsInWindow({ joinedBy, rawMessages: read.value.rawMessages, sinceMs: window.sinceMs });
}

/** The places the as-me read opens, from their search; none, with the gap recorded, when it cannot search. */
async function placesOfOwnerSearch({
  seams,
  window,
  into,
}: {
  seams: ActorReadSeams;
  window: ReadWindow;
  into: Accumulator;
}): Promise<readonly RepeatPlace[]> {
  if (seams.search === undefined || seams.self.userId === undefined) {
    into.unread.push("me: no search seam or no user id — nothing they sent was read");
    return [];
  }
  // `after:` is exclusive of the date it names, so the day before the window's start.
  const after = new Date(window.sinceMs - DAY_MS).toISOString().slice(0, 10);
  const found = await searchAllPages({
    count: SEARCH_PAGE_SIZE,
    maxPages: SEARCH_MAX_PAGES,
    query: `from:<@${seams.self.userId}> after:${after}`,
    search: seams.search,
  });
  if (!found.receipt.complete) {
    into.unread.push(`me: search incomplete — ${found.receipt.stoppedBecause}`);
  }
  return placesOfSearch({ matches: found.matches });
}

/** Whether the bot can read a listed conversation's history. */
function botCanRead({ channel }: { channel: SlackChannelRef }): boolean {
  return channel.isIm === true || channel.isMpim === true || channel.isMember === true;
}

/** The conversations the bot is in; none, with the gap recorded, when the list failed. */
async function botConversations({
  seams,
  into,
}: {
  seams: ActorReadSeams;
  into: Accumulator;
}): Promise<readonly string[]> {
  const listed = await fetchCompleteSlackChannels({ api: seams.api });
  if (listed.isErr()) {
    into.unread.push(`bot: conversations.list failed — ${listed.error.message}`);
    return [];
  }
  return listed.value.channels.filter((channel) => botCanRead({ channel })).map((channel) => channel.id);
}

/** What one identity's read opens: conversations from a floor, and threads found directly. */
interface PlacesToRead {
  readonly channels: readonly string[];
  readonly threads: readonly ThreadPlace[];
  readonly oldestMs: number;
}

/** The as-me read opens what their search found; the bot's opens every conversation it is in, further back. */
async function placesToRead({
  actor,
  seams,
  window,
  into,
}: {
  actor: RepeatActor;
  seams: ActorReadSeams;
  window: ReadWindow;
  into: Accumulator;
}): Promise<PlacesToRead> {
  if (actor !== "me") {
    const channels = await botConversations({ into, seams });
    return { channels, oldestMs: window.nowMs - BOT_ROOT_HORIZON_DAYS * DAY_MS, threads: [] };
  }
  const channels: string[] = [];
  const threads: ThreadPlace[] = [];
  for (const place of await placesOfOwnerSearch({ into, seams, window })) {
    if (place.threadTs === undefined) {
      channels.push(place.channel);
    } else {
      threads.push({ channel: place.channel, threadTs: place.threadTs });
    }
  }
  return { channels, oldestMs: window.sinceMs, threads };
}

/**
 * Read every message one identity sent in the window.
 *
 * @param actor which identity
 * @param seams its read client, own identity, permalink base, and (as them) search
 * @param days the window
 * @param nowMs the window's end
 * @returns its messages, the places read, and every place that could not be
 */
export async function readActor({
  actor,
  seams,
  days,
  nowMs,
}: {
  actor: RepeatActor;
  seams: ActorReadSeams;
  days: number;
  nowMs: number;
}): Promise<ActorRead> {
  const window = { nowMs, sinceMs: nowMs - days * DAY_MS };
  const into: Accumulator = { messages: [], placesRead: 0, unread: [] };
  const threads = new Map<string, ThreadPlace>();
  const addThread = ({ channel, threadTs }: ThreadPlace): void => {
    threads.set(`${channel} ${threadTs}`, { channel, threadTs });
  };
  const { channels, oldestMs, threads: found } = await placesToRead({ actor, into, seams, window });
  found.forEach((place) => {
    addThread(place);
  });
  for (const channel of channels) {
    const roots = await readTopLevel({ actor, channel, into, oldestMs, seams, window });
    roots.forEach((threadTs) => {
      addThread({ channel, threadTs });
    });
  }
  for (const place of threads.values()) {
    await readThread({ actor, into, place, seams, window });
  }
  return { messages: dedupe({ messages: into.messages }), placesRead: into.placesRead, unread: into.unread };
}

/** One copy of each message: a thread's root is read by both the history and the thread walk. */
function dedupe({ messages }: { messages: readonly AuditMessage[] }): readonly AuditMessage[] {
  const seen = new Map<string, AuditMessage>();
  for (const message of messages) {
    const key = `${message.actor} ${message.channel} ${message.ts}`;
    if (!seen.has(key)) {
      seen.set(key, message);
    }
  }
  return [...seen.values()];
}
