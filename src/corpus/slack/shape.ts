/**
 * The PURE shaping core of the Slack read edge: a raw `conversations.history`/`.replies` row in, a clean
 * {@link SlackMessageItem}/{@link SlackReplyItem} out. Split out of `fetch.ts` because it shares nothing with
 * that module's paging and cursor orchestration except the payloads it is handed — every function here is
 * total, defensive and testable with a literal, which is exactly what the crawl around it is not.
 *
 * Defensive by construction: a row that is not an object, or carries no `ts`, is DROPPED rather than
 * synthesised into a record with an invented identity. A Slack payload is unvalidated input, and a shaping
 * step that guesses at a missing field is how an invented id reaches bronze and is then cited.
 */
import { isRecord } from "../../lib/parsers.js";
import { slackTsToIso } from "../../lib/slackTs.js";
import type { SlackAttachmentRef, SlackMessageItem, SlackReplyItem } from "./project.js";

/** The channel-privacy/reach signals `channelPrivacy` reads — the subset of a discovered channel it needs. */
export interface ChannelSignals {
  readonly isPrivate?: boolean;
  readonly isIm?: boolean;
  readonly isMpim?: boolean;
  readonly isMember?: boolean;
  readonly isArchived?: boolean;
}

/**
 * Coerce an unknown to a non-empty string, or undefined. Pure.
 *
 * The single canonical home for this coercion repo-wide — every domain that shapes an untyped SDK/API
 * payload (`corpus/github`, `corpus/members`, `corpus/structures`, `live/github`, as well as the rest of
 * `corpus/slack`) imports it from here rather than keeping its own copy, deliberately, after this exact
 * primitive drifted to 14 duplicate definitions across the repo in one day (code-quality round 2, item 7).
 * It stays in this file rather than moving to `src/lib/` because `shape.ts` was already the corpus-decoder
 * module a plurality of the duplicates were closest kin to, and inventing a new home for a function this
 * small would just be a fifteenth place to look.
 *
 * @param value the unvalidated value
 * @returns the value when it is a non-empty string, else undefined
 */
export function optStr({ value }: { value: unknown }): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/**
 * Slack decimal ts (`epochSeconds.micros`) → ISO-8601, deriving through the canonical `../../lib/slackTs.ts`.
 *
 * The empty string stays this layer's "unparseable" convention because every bronze record's `tsIso` is a
 * plain `string`; the derivation itself is no longer this file's to own.
 *
 * @param ts the Slack timestamp
 * @returns the ISO-8601 string, or an empty string when the value is not a Slack timestamp
 */
function tsToIso({ ts }: { ts: string }): string {
  const iso = slackTsToIso({ ts });
  if (iso === undefined) {
    return "";
  }
  return iso;
}

/** Construct the stable Slack permalink for a message (no per-message API call). */
function permalinkFor({
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

/** Defensively shape a raw file object into an attachment ref (id is required). */
function shapeFile({ raw }: { raw: unknown }): SlackAttachmentRef | undefined {
  if (!isRecord(raw)) {
    return undefined;
  }
  const id = optStr({ value: raw["id"] });
  if (id === undefined) {
    return undefined;
  }
  const name = optStr({ value: raw["name"] });
  const title = optStr({ value: raw["title"] });
  const mimetype = optStr({ value: raw["mimetype"] });
  const altText = optStr({ value: raw["alt_txt"] });
  const permalink = optStr({ value: raw["permalink"] });
  const user = optStr({ value: raw["user"] });
  return {
    id,
    ...(name !== undefined ? { name } : {}),
    ...(title !== undefined ? { title } : {}),
    ...(mimetype !== undefined ? { mimetype } : {}),
    ...(altText !== undefined ? { altText } : {}),
    ...(user !== undefined ? { user } : {}),
    ...(permalink !== undefined ? { permalink } : {}),
    raw,
  };
}

/** Reaction names + counts as `:name: xN` strings. */
function shapeReactions({ raw }: { raw: unknown }): readonly string[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const out: string[] = [];
  for (const entry of raw) {
    if (isRecord(entry)) {
      const name = optStr({ value: entry["name"] });
      const count = typeof entry["count"] === "number" ? entry["count"] : 1;
      if (name !== undefined) {
        out.push(`:${name}: x${String(count)}`);
      }
    }
  }
  return out;
}

/** Common message fields shared by top-level messages and replies (author omitted when absent). */
function shapeCommon({
  raw,
  workspaceUrl,
  channelId,
}: {
  raw: Record<string, unknown>;
  workspaceUrl: string;
  channelId: string;
}):
  | {
      ts: string;
      tsIso: string;
      text?: string;
      author?: string;
      permalink: string;
      files: readonly SlackAttachmentRef[];
      raw: Readonly<Record<string, unknown>>;
    }
  | undefined {
  const ts = optStr({ value: raw["ts"] });
  if (ts === undefined) {
    return undefined;
  }
  const author = optStr({ value: raw["user"] });
  const text = optStr({ value: raw["text"] });
  const files = Array.isArray(raw["files"])
    ? raw["files"]
        .map((file) => shapeFile({ raw: file }))
        .filter((file): file is SlackAttachmentRef => file !== undefined)
    : [];
  return {
    files,
    permalink: permalinkFor({ channelId, ts, workspaceUrl }),
    raw,
    ts,
    tsIso: tsToIso({ ts }),
    ...(author !== undefined ? { author } : {}),
    ...(text !== undefined ? { text } : {}),
  };
}

/** Common context threaded through the page-shaping cores (the channel + workspace a page belongs to). */
export interface ChannelContext {
  readonly workspaceUrl: string;
  readonly channelId: string;
  readonly channelName: string | undefined;
  readonly isPrivate?: boolean;
  readonly isIm?: boolean;
  readonly isMpim?: boolean;
  readonly isMember?: boolean;
  readonly isArchived?: boolean;
}

/**
 * The privacy + reach booleans of a ref/context, spread-ready (a false/absent flag stays absent). Pure.
 *
 * Membership and archival ride the same helper as privacy because they travel to the same place: projection
 * stamps all four onto every record the channel produces, and a fifth copy of the "only spread a true"
 * discipline is a fifth chance to spread `false` and turn an absent field into a claim.
 *
 * @param channel the discovered channel's signals
 * @returns the flags that are true, each omitted when false or absent
 */
export function channelPrivacy({ channel }: { channel: ChannelSignals }): {
  isPrivate?: boolean;
  isIm?: boolean;
  isMpim?: boolean;
  isMember?: boolean;
  isArchived?: boolean;
} {
  return {
    ...(channel.isPrivate === true ? { isPrivate: true } : {}),
    ...(channel.isIm === true ? { isIm: true } : {}),
    ...(channel.isMpim === true ? { isMpim: true } : {}),
    ...(channel.isMember === true ? { isMember: true } : {}),
    ...(channel.isArchived === true ? { isArchived: true } : {}),
  };
}

/**
 * Shape one `conversations.history` page's raw messages into message items (reactions + files resolved).
 * Pure + defensive — a non-object or ts-less row is dropped, never fatal.
 *
 * @param messages the raw page messages
 * @param ctx the channel context (workspace url, channel id/name)
 * @returns the shaped message items
 */
export function shapeHistoryPage({
  messages,
  ctx,
}: {
  messages: readonly unknown[];
  ctx: ChannelContext;
}): readonly SlackMessageItem[] {
  const items: SlackMessageItem[] = [];
  for (const raw of messages) {
    if (!isRecord(raw)) {
      continue;
    }
    const common = shapeCommon({ channelId: ctx.channelId, raw, workspaceUrl: ctx.workspaceUrl });
    if (common === undefined) {
      continue;
    }
    items.push({
      channelId: ctx.channelId,
      reactions: shapeReactions({ raw: raw["reactions"] }),
      ...common,
      ...(ctx.channelName !== undefined ? { channelName: ctx.channelName } : {}),
    });
  }
  return items;
}

/**
 * The thread parents worth polling from a history page — those with a positive `reply_count`. Pure, so
 * the "which threads to re-read" decision is unit-tested apart from the paging IO.
 *
 * @param messages the raw page messages
 * @returns the thread timestamps to poll
 */
export function planThreadPolls({ messages }: { messages: readonly unknown[] }): readonly { threadTs: string }[] {
  const polls: { threadTs: string }[] = [];
  for (const raw of messages) {
    if (!isRecord(raw)) {
      continue;
    }
    const ts = optStr({ value: raw["ts"] });
    const replyCount = typeof raw["reply_count"] === "number" ? raw["reply_count"] : 0;
    if (ts !== undefined && replyCount > 0) {
      polls.push({ threadTs: ts });
    }
  }
  return polls;
}

/**
 * Shape one `conversations.replies` page into reply items, skipping the parent (captured as the top-level
 * message). Pure + defensive.
 *
 * @param messages the raw page messages
 * @param ctx the channel context
 * @param threadTs the parent thread ts (whose echo is skipped)
 * @returns the shaped reply items
 */
export function shapeRepliesPage({
  messages,
  ctx,
  threadTs,
}: {
  messages: readonly unknown[];
  ctx: ChannelContext;
  threadTs: string;
}): readonly SlackReplyItem[] {
  const replies: SlackReplyItem[] = [];
  for (const raw of messages) {
    if (!isRecord(raw)) {
      continue;
    }
    const common = shapeCommon({ channelId: ctx.channelId, raw, workspaceUrl: ctx.workspaceUrl });
    if (common === undefined || common.ts === threadTs) {
      continue; // skip the parent message; it's captured as the top-level message
    }
    replies.push({
      channelId: ctx.channelId,
      threadTs,
      ...common,
      ...(ctx.channelName !== undefined ? { channelName: ctx.channelName } : {}),
    });
  }
  return replies;
}
