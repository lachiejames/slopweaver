/**
 * The thread reads a channel share's clock rests on, planned and projected here and taken by the Slack leg
 * (`../cli/commands/github/reviewStateReadAround.ts`). A reply to the owner's post can sit under it linking nothing, so
 * neither search leg sees it; `./channelShare.ts` carries the absence of one only through a whole-thread read.
 * {@link shareThreadRootsOf} names each thread to read whole and {@link shareThreadOf} projects what came back.
 *
 * Pure.
 */
import { isRecord } from "#lib/parsers.js";
import { slackTsToIso } from "#lib/slackTs.js";
import { resolveOwnerBotToOwner } from "../corpus/slack/ownerBot.js";
import type { AuthorRole } from "./evidence.js";
import { appPostedAsItself } from "./slackEvidenceRecord.js";
import type { ShareThreadRead, ShareThreadReply, SlackIdentity, SlackMention } from "./slackEvidenceTypes.js";

/**
 * The conversation and root a MESSAGE key names: exactly two non-empty parts, `channel:ts`.
 *
 * @returns the two parts, or `undefined` for any other key — a file, a pin or a canvas (`channel:ts:file:F…`)
 */
function rootPartsOf({ key }: { key: string }): { channelId: string; rootTs: string } | undefined {
  const [channelId, rootTs, ...rest] = key.split(":");
  if (channelId === undefined || rootTs === undefined || rest.length > 0) {
    return undefined;
  }
  if (channelId === "" || rootTs === "") {
    return undefined;
  }
  return { channelId, rootTs };
}

/**
 * Whether one message is a post of the owner's, in a channel, that links the pull request and ROOTS its own thread — a
 * share, before the ask classifier has had its say. Broad on the ask on purpose: planning a read for a post that
 * turns out to be an ask costs one read, while skipping one a share needed leaves its clock unknown.
 *
 * A root, never a reply: the owner's link dropped into somebody else's thread inherits none of that thread's
 * traffic, the same boundary `./reviewConversation.ts` draws for a URL-less reply — only the owner's root lends a thread its pull
 * request. And a MESSAGE root: only a two-part `channel:ts` key is one. A file, a pin or a canvas answers its own
 * id too (`channel:ts:file:F…`), so key equality alone would cite an object no thread sits under.
 *
 * @returns true for a post a share may cite
 */
export function isOwnerChannelLink({ mention }: { mention: SlackMention }): boolean {
  const isMessageRoot = rootPartsOf({ key: mention.messageKey }) !== undefined;
  return (
    mention.association === "linked" &&
    mention.conversation === "channel" &&
    mention.authorRole === "owner" &&
    mention.messageKey === mention.threadKey &&
    isMessageRoot
  );
}

/** One thread to read whole: its key, and the conversation and root it names. */
export interface ShareThreadRoot {
  readonly threadKey: string;
  readonly channelId: string;
  readonly rootTs: string;
}

/**
 * Every thread under a post of the owner's in a channel, once each, whatever pull request it serves.
 *
 * @param grouped every message the legs found, by pull-request key
 * @returns the threads to read whole
 */
export function shareThreadRootsOf({
  grouped,
}: {
  grouped: ReadonlyMap<string, readonly SlackMention[]>;
}): readonly ShareThreadRoot[] {
  const roots = new Map<string, ShareThreadRoot>();
  for (const mentions of grouped.values()) {
    for (const mention of mentions) {
      if (!isOwnerChannelLink({ mention })) {
        continue;
      }
      const parts = rootPartsOf({ key: mention.threadKey });
      if (parts === undefined) {
        continue;
      }
      roots.set(mention.threadKey, { ...parts, threadKey: mention.threadKey });
    }
  }
  return [...roots.values()];
}

/**
 * Who wrote one thread row: the owner by their id or their declared as-me bot, an app when it has no user, is an app
 * posting as itself, or is one of Slopweaver's own ids, anybody else a colleague.
 *
 * An app is decided the way the corpus decides it (`./slackEvidenceRecord.ts`'s `appPostedAsItself`), never by a
 * bare `bot_id` or a `bot_message` subtype: the owner's own post sent with their user token through an app carries
 * that app's `bot_id` beside their `user`, and read as the app's it would unseat the owner's root.
 *
 * The owner's bot first, through the same contract the corpus projection applies (`../corpus/slack/ownerBot.ts`):
 * these rows are raw, and a reply the owner sent as themselves through their bot carries a `bot_id` — read as an app's, it would slip past
 * the unclassified-reply check that withdraws the absence of an ask (`./channelShare.ts`).
 *
 * @returns the role
 */
function roleOf({ raw, identity }: { raw: Readonly<Record<string, unknown>>; identity: SlackIdentity }): AuthorRole {
  const user = raw["user"];
  const author = typeof user === "string" ? user : undefined;
  if (resolveOwnerBotToOwner({ author, ownerBot: identity.ownerBot, raw }) !== undefined) {
    return "owner";
  }
  if (typeof user !== "string" || appPostedAsItself({ raw })) {
    return "app";
  }
  if (identity.selfUserIds.includes(user)) {
    return "app";
  }
  if (user === identity.ownerSlackUserId) {
    return "owner";
  }
  return "other-human";
}

/**
 * When Slack says a row was last edited. The classifier read one VERSION of a message, and an edit keeps its key,
 * so the share has to see the edit to know the version it holds may be newer than the one classified.
 *
 * @returns `{ editedAtIso }` for an edited row, `{}` for one never edited, or `null` when Slack marks it edited
 *   with no readable instant — a row that cannot be dated reads no thread, as an undated `ts` does
 */
function editedOf({ raw }: { raw: Readonly<Record<string, unknown>> }): { editedAtIso?: string } | null {
  const edited = raw["edited"];
  if (edited === undefined) {
    return {};
  }
  if (!isRecord(edited) || typeof edited["ts"] !== "string") {
    return null;
  }
  const editedAtIso = slackTsToIso({ ts: edited["ts"] });
  if (editedAtIso === undefined) {
    return null;
  }
  return { editedAtIso };
}

/** One thread row, dated and attributed: its `ts`, when it was sent and last edited, and who wrote it. */
interface ThreadRow {
  readonly ts: string;
  readonly atIso: string;
  readonly edited: { editedAtIso?: string };
  readonly role: AuthorRole;
  /** The raw Slack author, so two copies naming different people contradict even when both are colleagues. */
  readonly user: unknown;
}

/**
 * One raw row as the share reads it.
 *
 * @returns the row, or `undefined` when it is not a record or cannot be dated
 */
function threadRowOf({ raw, identity }: { raw: unknown; identity: SlackIdentity }): ThreadRow | undefined {
  if (!isRecord(raw)) {
    return undefined;
  }
  const ts = raw["ts"];
  if (typeof ts !== "string") {
    return undefined;
  }
  const atIso = slackTsToIso({ ts });
  const edited = editedOf({ raw });
  if (atIso === undefined || edited === null) {
    return undefined;
  }
  return { atIso, edited, role: roleOf({ identity, raw }), ts, user: raw["user"] };
}

/**
 * The newest of some edit instants.
 *
 * @returns the newest, or `undefined` when none was given — an earlier one never displaces a later one read first
 */
function newestEditOf({ isos }: { isos: readonly (string | undefined)[] }): string | undefined {
  let newest: string | undefined;
  for (const iso of isos) {
    if (iso !== undefined && (newest === undefined || Date.parse(iso) > Date.parse(newest))) {
      newest = iso;
    }
  }
  return newest;
}

/**
 * The replies among a thread's rows, one per message, each copy keeping the newest edit.
 *
 * @param rows every row but the root
 * @param channelId the conversation the replies' message keys name
 * @returns the replies in first-seen order, or `undefined` when two copies disagree on who wrote one
 */
function repliesOf({
  rows,
  channelId,
}: {
  rows: readonly ThreadRow[];
  channelId: string;
}): ShareThreadReply[] | undefined {
  const byKey = new Map<string, { reply: ShareThreadReply; user: unknown }>();
  for (const row of rows) {
    const messageKey = `${channelId}:${row.ts}`;
    const reply: ShareThreadReply = { atIso: row.atIso, authorRole: row.role, messageKey, ...row.edited };
    const seen = byKey.get(messageKey);
    if (seen === undefined) {
      byKey.set(messageKey, { reply, user: row.user });
      continue;
    }
    if (seen.reply.authorRole !== reply.authorRole || seen.user !== row.user) {
      return undefined;
    }
    if (newestEditOf({ isos: [seen.reply.editedAtIso, reply.editedAtIso] }) !== seen.reply.editedAtIso) {
      byKey.set(messageKey, { reply, user: row.user });
    }
  }
  return [...byKey.values()].map((one) => one.reply);
}

/**
 * One thread's rows as the share reads them: every message but the root, with who wrote it.
 *
 * The read is authoritative for its own rows, the root's included: one that returned no root, or a root it
 * places as somebody else's, disagrees with the legs about what the share is, and carries nothing. Slack
 * answers the root again on every page, so a root seen twice keeps its NEWEST edit — an older copy read later
 * never hides a version the corpus did not classify. A reply seen twice keeps its newest edit the same way, and
 * two copies that disagree on who wrote it — the role, or the raw Slack author — contradict the read, which then carries nothing.
 *
 * @param rawMessages every row the complete thread read returned, the root included
 * @param root the thread they came from
 * @param readAtIso when the read was taken
 * @returns the thread, or `undefined` when a row is unreadable, the root is missing, or the root is not the owner's — a
 *   half-read or contradicted thread carries no absence
 */
export function shareThreadOf({
  rawMessages,
  root,
  identity,
  readAtIso,
}: {
  rawMessages: readonly unknown[];
  root: ShareThreadRoot;
  identity: SlackIdentity;
  readAtIso: string;
}): ShareThreadRead | undefined {
  const rows: ThreadRow[] = [];
  for (const raw of rawMessages) {
    const row = threadRowOf({ identity, raw });
    if (row === undefined) {
      return undefined;
    }
    rows.push(row);
  }
  const roots = rows.filter((row) => row.ts === root.rootTs);
  if (roots.length === 0 || roots.some((row) => row.role !== "owner")) {
    return undefined;
  }
  const replies = repliesOf({ channelId: root.channelId, rows: rows.filter((row) => row.ts !== root.rootTs) });
  if (replies === undefined) {
    return undefined;
  }
  const rootEditedAtIso = newestEditOf({ isos: roots.map((row) => row.edited.editedAtIso) });
  if (rootEditedAtIso === undefined) {
    return { readAtIso, replies };
  }
  return { readAtIso, replies, rootEditedAtIso };
}
