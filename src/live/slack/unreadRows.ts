/**
 * One `slack unread` row from one read — a DM past Slack's read marker, or a thread where a person has spoken since
 * the owner's last word — the pure half `./unreadDocument.ts` assembles into the document.
 *
 * Each thread row says whether it is for the owner, with `slack owed`'s own classifier (`directnessOf` in
 * `src/sessionStart/slackLeg.ts`): it asks the owner something, it names the owner, or it is for their information.
 */
import type { SlackNameMaps } from "../../corpus/slack/visibleProse.js";
import { mentionRunsIn } from "../../review/prLink.js";
import { directnessOf, type SlackThread } from "../../sessionStart/slackLeg.js";
import type { ReadMarker } from "./readMarker.js";
import { compareSlackTimestamps } from "./selection.js";
import { messageWords, oneLine } from "./spokenWords.js";
import type { VisibleSlackMessage } from "./types.js";

/** How long one row's line runs, in characters — a breath, not a paragraph. */
const LINE_CHARS = 140;

/** How long a thread's topic runs, in characters. */
const TOPIC_CHARS = 90;

/** Who a person is, as a row needs: a name to say, and whether a word of theirs counts. */
export type PersonOf = (args: { authorId: string }) => { readonly name: string; readonly isHuman: boolean };

/** One unread DM. */
export interface UnreadDmRow {
  readonly kind: "dm" | "group";
  /** Who it is with, by name. */
  readonly with: string;
  /** How many messages are unread: Slack's own count, else the messages past the owner's read marker. */
  readonly unread: number;
  readonly lastFrom: string;
  /** The newest unread message, one line. */
  readonly line: string;
  readonly atIso: string;
  /** Whether an unread message asks something. */
  readonly asks: boolean;
  /** The first unread message — what `talk slack-open` reads from. */
  readonly url: string;
}

/** A DM from an app, a bot or Slackbot: counted by name, never a row. */
export interface UnreadAppDm {
  readonly name: string;
  readonly unread: number;
}

/** One thread where a person has spoken since the owner's last word. */
export interface UnreadThreadRow {
  /** `reply` — a thread the owner spoke in; `tag` — one the owner was tagged in and has not spoken in. */
  readonly kind: "reply" | "tag";
  /** The channel, `#name`, "a DM thread", or "a channel" when the search named none. */
  readonly where: string;
  /** The thread's first message, one short line — what the owner would call the thread. */
  readonly topic: string;
  /** Who has spoken since the owner's last word, by name, in the order they first did. */
  readonly people: readonly string[];
  /** How many messages people have posted since the owner's last word. */
  readonly newReplies: number;
  /** How many replies the whole thread holds. */
  readonly replies: number;
  readonly lastFrom: string;
  /** The newest of them, one line. */
  readonly line: string;
  readonly atIso: string;
  readonly forYou: "asks you" | "names you" | "fyi";
  /** The thread's root — what `talk slack-open` reads whole. */
  readonly url: string;
}

/** One DM whose read marker says something is unread, with the messages past it. */
export interface UnreadDmRead {
  readonly marker: ReadMarker;
  /** The messages past the owner's read marker, oldest first. */
  readonly messages: readonly VisibleSlackMessage[];
}

/** One thread read whole, with what made it a candidate. */
export interface UnreadThreadRead {
  readonly channelId: string;
  readonly channelName: string | undefined;
  /** A thread inside a DM or group DM, said as one rather than as a channel. */
  readonly direct: boolean;
  /** The whole thread, root first. */
  readonly messages: readonly VisibleSlackMessage[];
  /**
   * For a thread the owner has not spoken in: where its news begins — the earliest tag of the owner, or a DM
   * thread's root, a DM being addressed to the owner whole.
   */
  readonly taggedFromTs: string | undefined;
}

/**
 * One unread DM as a row, or as an app DM when the other side is not a person.
 *
 * @param read the DM's marker and the messages past it
 * @param ownerId the owner's own Slack id
 * @param person who an id is
 * @param maps the names mentions are said with
 * @returns the row, the app DM, or `undefined` when nothing past the marker could be read to say
 */
export function dmRowOf({
  read,
  ownerId,
  person,
  maps,
}: {
  read: UnreadDmRead;
  ownerId: string;
  person: PersonOf;
  maps: SlackNameMaps;
}): { readonly row: UnreadDmRow } | { readonly app: UnreadAppDm } | undefined {
  const theirs = read.messages.filter((message) => message.author.userId !== ownerId);
  const newest = theirs.at(-1);
  const first = theirs[0];
  if (newest === undefined || first === undefined) {
    return undefined;
  }
  let unread = theirs.length;
  if (read.marker.unreadCount !== undefined && read.marker.unreadCount > 0) {
    unread = read.marker.unreadCount;
  }
  const other = read.marker.otherUserId;
  if (read.marker.kind === "dm" && other !== undefined && !person({ authorId: other }).isHuman) {
    return { app: { name: person({ authorId: other }).name, unread } };
  }
  return {
    row: {
      asks: theirs.some((message) => message.text.includes("?")),
      atIso: newest.tsIso,
      kind: read.marker.kind,
      lastFrom: nameOf({ message: newest, person }),
      line: oneLine({ maxChars: LINE_CHARS, text: messageWords({ maps, message: newest }) }),
      unread,
      url: first.permalink,
      with: withOf({ ownerId, person, read, theirs }),
    },
  };
}

/**
 * One thread as a row, when a person has spoken there since the owner's last word.
 *
 * @param read the thread read whole
 * @param ownerId the owner's own Slack id
 * @param person who an id is
 * @param maps the names mentions are said with
 * @returns the row, or `undefined` when the owner's is the last human word or nobody has spoken since
 */
export function threadRowOf({
  read,
  ownerId,
  person,
  maps,
}: {
  read: UnreadThreadRead;
  ownerId: string;
  person: PersonOf;
  maps: SlackNameMaps;
}): UnreadThreadRow | undefined {
  const root = read.messages[0];
  if (root === undefined) {
    return undefined;
  }
  const ownerLast = read.messages.findLast((message) => message.author.userId === ownerId);
  const since = read.messages.filter(
    (message) =>
      isPersonOtherThan({ message, ownerId, person }) &&
      isNews({ message, ownerLast, taggedFromTs: read.taggedFromTs }),
  );
  const last = since.at(-1);
  if (last === undefined) {
    return undefined;
  }
  const lastText = messageWords({ maps, message: last });
  const thread: SlackThread = {
    channelId: read.channelId,
    lastAuthorIsHuman: true,
    lastAuthorIsSelf: false,
    lastAuthorName: nameOf({ message: last, person }),
    lastIso: last.tsIso,
    lastNamesAnybody: /<[@!]/u.test(last.text),
    lastText,
    mentionsOwner: since.some((message) => message.text.includes(`<@${ownerId}`)),
    ownerLastIso: ownerLast === undefined ? last.tsIso : ownerLast.tsIso,
    ownerLatestTagsLastAuthor: ownerLast !== undefined && tagsAuthorOf({ message: ownerLast, tagged: last }),
    ownerStartedThread: root.author.userId === ownerId,
    permalink: last.permalink,
    threadTs: root.ts,
    ...(read.channelName === undefined ? {} : { channelName: read.channelName }),
  };
  return {
    atIso: last.tsIso,
    forYou: forYouOf({ thread }),
    kind: ownerLast === undefined ? "tag" : "reply",
    lastFrom: thread.lastAuthorName,
    line: oneLine({ maxChars: LINE_CHARS, text: lastText }),
    newReplies: since.length,
    people: [...new Set(since.map((message) => nameOf({ message, person })))],
    replies: read.messages.length - 1,
    topic: oneLine({ maxChars: TOPIC_CHARS, text: messageWords({ maps, message: root }) }),
    url: root.permalink,
    where: whereOf({ channelName: read.channelName, direct: read.direct }),
  };
}

/** Whether a message is a person's, and not the owner's. */
function isPersonOtherThan({
  message,
  ownerId,
  person,
}: {
  message: VisibleSlackMessage;
  ownerId: string;
  person: PersonOf;
}): boolean {
  const id = message.author.userId;
  return id !== undefined && id !== ownerId && person({ authorId: id }).isHuman;
}

/**
 * Whether one message structurally tags the author of another — the owner's latest word naming whoever spoke last. A
 * mention RUN, by the rule `slack owed`'s corpus reader applies, so a typed `@handle` pings nobody and counts for
 * nothing.
 */
function tagsAuthorOf({ message, tagged }: { message: VisibleSlackMessage; tagged: VisibleSlackMessage }): boolean {
  return mentionRunsIn({ text: message.text }).some((run) => run.id === tagged.author.userId);
}

/**
 * Whether a message is news: after the owner's last word, or — in a thread the owner never spoke in — at or after
 * the first tag.
 */
function isNews({
  message,
  ownerLast,
  taggedFromTs,
}: {
  message: VisibleSlackMessage;
  ownerLast: VisibleSlackMessage | undefined;
  taggedFromTs: string | undefined;
}): boolean {
  if (ownerLast !== undefined) {
    return compareSlackTimestamps({ left: message.ts, right: ownerLast.ts }) > 0;
  }
  if (taggedFromTs === undefined) {
    return false;
  }
  return compareSlackTimestamps({ left: message.ts, right: taggedFromTs }) >= 0;
}

/** The name a message's author is said by. */
function nameOf({ message, person }: { message: VisibleSlackMessage; person: PersonOf }): string {
  const id = message.author.userId;
  if (id === undefined) {
    return "an app";
  }
  return person({ authorId: id }).name;
}

/** Who a DM is with: the other person, or everyone but the owner who spoke in a group DM's unread messages. */
function withOf({
  read,
  theirs,
  ownerId,
  person,
}: {
  read: UnreadDmRead;
  theirs: readonly VisibleSlackMessage[];
  ownerId: string;
  person: PersonOf;
}): string {
  const other = read.marker.otherUserId;
  if (read.marker.kind === "dm" && other !== undefined) {
    return person({ authorId: other }).name;
  }
  const names = [...new Set(theirs.map((message) => nameOf({ message, person })))];
  const others = names.filter((name) => name !== person({ authorId: ownerId }).name);
  if (others.length === 0) {
    return "a group DM";
  }
  return `a group DM with ${others.join(", ")}`;
}

/** The channel as the voice says it. */
function whereOf({ channelName, direct }: { channelName: string | undefined; direct: boolean }): string {
  if (direct) {
    return "a DM thread";
  }
  if (channelName === undefined || channelName.length === 0) {
    return "a channel";
  }
  return channelName.startsWith("#") ? channelName : `#${channelName}`;
}

/** Whether a thread is for the owner, in the words a row carries, off `slack owed`'s own rungs. */
function forYouOf({ thread }: { thread: SlackThread }): UnreadThreadRow["forYou"] {
  const rung = directnessOf({ thread });
  if (rung === "asked") {
    return "asks you";
  }
  if (rung === "addressed") {
    return "names you";
  }
  return "fyi";
}
