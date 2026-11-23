/**
 * Whether a message about to be sent is already THERE — the same words, or the same opening line, from the
 * same identity in the same place. Pure: messages in, one verdict out.
 *
 * ## Why this exists beside the reservation
 *
 * `./sendReservation.ts` hashes identity, target and ARTIFACT, so it can only see a byte-identical repeat.
 * A production finding once went to #defects, and hours later a
 * session hand-composed the older cut of the same finding into a fresh `slack post --as me` to the same
 * channel. The bytes differed, so the reservation passed it; the first line was the same
 * word for word. A repeat has to be structurally impossible, so the question here
 * is asked of what is actually in the channel, not of what this process remembers sending.
 *
 * ## What a message's text is
 *
 * The WORDS, read the same way off an outgoing payload and a message Slack stored: `text` when it has any,
 * otherwise the wrapper's `fallback`. A card, an answer, a turn frame and a poll all send `text: ""` and carry
 * their words in `attachments[0].fallback` (`./types.ts`), and Slack stores both fields as they were sent.
 * Blocks are never compared: the first block of every card is the same author row, and Slack normalises
 * `rich_text` on the way in.
 *
 * ## Two rules, one window each
 *
 * - **Digest**: the whole normalised text, hashed. Any length — "thanks" twice in one place is a repeat.
 * - **First line**: the first non-empty normalised line, counted only at {@link FIRST_LINE_FLOOR_CHARS} or
 *   more, because a short shared opener ("hey", "fyi") is not evidence of anything.
 *
 * Normalisation is what lets two cuts written by different hands compare: mrkdwn links become their label,
 * entities are decoded, emphasis markers dropped, whitespace collapsed, case folded.
 */
import { createHash } from "node:crypto";

import { isRecord } from "../../lib/parsers.js";
import { slackTsToEpochMs } from "../../lib/slackTs.js";
import { slackPermalink } from "./renderCheck.js";

/** How far back a send looks for itself. The window is the last 7 days. */
export const REPEAT_WINDOW_DAYS = 7;

/** Milliseconds in a day. */
export const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The shortest normalised first line the first-line rule counts. Below it only the digest can match.
 *
 * 40 characters clears every short opener and sits well under the incident's 108-character first line.
 * MEASURED, the first 7-day audit over hundreds of places and own messages: ZERO first-line-only
 * collisions at this floor, and every repeat it found was whole-digest. Repro: `slopweaver slack repeats --days 7
 * --as both --json | jq '.groups[] | select(.rule=="first-line") | .firstLine | length'`.
 */
const FIRST_LINE_FLOOR_CHARS = 40;

/** The Slack subtypes that are a person's or an app's own message. Joins, topic changes and the rest are not. */
const MESSAGE_SUBTYPES: ReadonlySet<string> = new Set(["bot_message", "file_share", "thread_broadcast", "me_message"]);

/** What one message is, as far as a repeat is concerned. */
export interface RepeatIdentity {
  /** sha256 of the whole normalised text, 32 hex characters. */
  readonly digest: string;
  /** The first non-empty normalised line. */
  readonly firstLine: string;
  /** Whether {@link firstLine} is long enough for the first-line rule to count. */
  readonly firstLineCounts: boolean;
}

/** Who "the same identity" is: the token's own user, and its bot when it has one. */
export interface RepeatSelf {
  readonly userId?: string | undefined;
  readonly botId?: string | undefined;
}

/** One message already in the place, from the same identity. */
export interface RepeatPrior {
  readonly channel: string;
  readonly ts: string;
  /** The thread root the message sits under, absent for a top-level message or a thread's own root. */
  readonly threadTs?: string | undefined;
  readonly tsMs: number;
  readonly permalink: string;
  readonly identity: RepeatIdentity;
  /** The prior's first line as it reads, for a refusal a person can check at a glance. */
  readonly firstLine: string;
}

/** Which rule fired, against which prior. */
export interface RepeatMatch {
  readonly rule: "digest" | "first-line";
  readonly prior: RepeatPrior;
}

/** Slack's three mrkdwn entities, the only ones it escapes. */
const ENTITIES: readonly (readonly [RegExp, string])[] = [
  [/&lt;/gu, "<"],
  [/&gt;/gu, ">"],
  [/&amp;/gu, "&"],
];

/**
 * Slack mrkdwn reduced to the words a reader sees: `<url|label>` → label, `<url>` → url, `<@U…|name>` →
 * `<@U…>`, entities decoded, emphasis and code markers dropped. Line breaks are kept so the first line can
 * still be found.
 */
function readableText({ text }: { text: string }): string {
  const linked = text
    .replace(/<(@[UW][A-Z0-9]+)\|[^>]*>/gu, "<$1>")
    .replace(/<((?:https?|mailto):[^|>]+)\|([^>]+)>/gu, "$2")
    .replace(/<((?:https?|mailto):[^>]+)>/gu, "$1");
  const decoded = ENTITIES.reduce((acc, [pattern, to]) => acc.replace(pattern, to), linked);
  return decoded.replace(/[*_~`]/gu, "");
}

/**
 * One line's comparable form: whitespace collapsed, case folded, trimmed.
 *
 * @param line one line of readable text
 * @returns the line as the rules compare it
 */
function foldLine({ line }: { line: string }): string {
  return line.replace(/\s+/gu, " ").trim().toLowerCase();
}

/**
 * The comparable form of a message's whole text: readable, every line folded, blank lines dropped.
 *
 * @param text the message's text, raw mrkdwn or plain
 * @returns the normalised text, one folded line per non-blank line
 */
export function normaliseRepeatText({ text }: { text: string }): string {
  return readableText({ text })
    .split("\n")
    .map((line) => foldLine({ line }))
    .filter((line) => line.length > 0)
    .join("\n");
}

/**
 * The digest and first line one text is compared by.
 *
 * @param text the message's text
 * @returns its identity under both rules
 */
export function repeatIdentity({ text }: { text: string }): RepeatIdentity {
  const normalised = normaliseRepeatText({ text });
  const [firstLine = ""] = normalised.split("\n");
  return {
    digest: createHash("sha256").update(normalised).digest("hex").slice(0, 32),
    firstLine,
    firstLineCounts: firstLine.length >= FIRST_LINE_FLOOR_CHARS,
  };
}

/**
 * The words a message carries — `text` when it has any, else the first wrapper's `fallback` — read the same
 * way off an outgoing payload and a stored message.
 *
 * @param message a `chat.postMessage` payload, or a raw message Slack returned
 * @returns the text, or `undefined` when the message carries none
 */
export function repeatTextOf({ message }: { message: unknown }): string | undefined {
  if (!isRecord(message)) {
    return undefined;
  }
  const text = message["text"];
  if (typeof text === "string" && text.trim().length > 0) {
    return text;
  }
  const attachments = message["attachments"];
  const wrapper: unknown = Array.isArray(attachments) ? attachments[0] : undefined;
  const fallback = isRecord(wrapper) ? wrapper["fallback"] : undefined;
  if (typeof fallback === "string" && fallback.trim().length > 0) {
    return fallback;
  }
  return undefined;
}

/** A string field off a raw record, or `undefined`. */
function field({ record, key }: { record: Record<string, unknown>; key: string }): string | undefined {
  const value = record[key];
  return typeof value === "string" ? value : undefined;
}

/**
 * Whether a raw message was written by this identity: its bot when it has one, or its user.
 *
 * @param message the raw message
 * @param self the token's own identity
 * @returns true iff the message is this identity's own
 */
export function isOwnMessage({ message, self }: { message: Record<string, unknown>; self: RepeatSelf }): boolean {
  const botId = field({ key: "bot_id", record: message });
  const user = field({ key: "user", record: message });
  const byBot = self.botId !== undefined && botId === self.botId;
  const byUser = self.userId !== undefined && user === self.userId;
  return byBot || byUser;
}

/** Whether a raw message is a message rather than a join, a topic change or another system row. */
function isMessageRow({ message }: { message: Record<string, unknown> }): boolean {
  const subtype = field({ key: "subtype", record: message });
  return subtype === undefined || MESSAGE_SUBTYPES.has(subtype);
}

/**
 * The priors a place holds: this identity's own messages, each with its identity and permalink.
 *
 * `threadTs` is carried per message from its own `thread_ts`, so a thread's root is top-level (its
 * `thread_ts` is its own `ts`) and a reply points at its root.
 *
 * @param rawMessages every message the complete read returned
 * @param self the token's own identity
 * @param channel the conversation the messages were read from
 * @param workspaceUrl the workspace base a permalink is built on
 * @returns this identity's messages that carry text, in the order read
 */
export function priorsFromRaw({
  rawMessages,
  self,
  channel,
  workspaceUrl,
}: {
  rawMessages: readonly unknown[];
  self: RepeatSelf;
  channel: string;
  workspaceUrl: string;
}): readonly RepeatPrior[] {
  const priors: RepeatPrior[] = [];
  for (const message of rawMessages) {
    if (!isRecord(message) || !isOwnMessage({ message, self }) || !isMessageRow({ message })) {
      continue;
    }
    const ts = field({ key: "ts", record: message });
    const text = repeatTextOf({ message });
    const tsMs = ts === undefined ? undefined : slackTsToEpochMs({ ts });
    if (ts === undefined || text === undefined || tsMs === undefined) {
      continue;
    }
    const root = field({ key: "thread_ts", record: message });
    const threadTs = root === undefined || root === ts ? undefined : root;
    const identity = repeatIdentity({ text });
    priors.push({
      channel,
      firstLine: identity.firstLine,
      identity,
      permalink: slackPermalink({ channel, threadTs, ts, workspaceUrl }),
      threadTs,
      ts,
      tsMs,
    });
  }
  return priors;
}

/**
 * Which rule, if either, one prior matches the outgoing message under.
 *
 * @returns the rule, or `undefined`
 */
function ruleFor({
  outgoing,
  prior,
  ageMs,
  digestWindowMs,
  firstLineWindowMs,
}: {
  outgoing: RepeatIdentity;
  prior: RepeatPrior;
  ageMs: number;
  digestWindowMs: number;
  firstLineWindowMs: number;
}): RepeatMatch["rule"] | undefined {
  if (ageMs < digestWindowMs && prior.identity.digest === outgoing.digest) {
    return "digest";
  }
  const sameLine = outgoing.firstLineCounts && prior.identity.firstLine === outgoing.firstLine;
  if (ageMs < firstLineWindowMs && sameLine) {
    return "first-line";
  }
  return undefined;
}

/**
 * The EARLIEST prior the outgoing message repeats, and which rule caught it.
 *
 * A prior dated after `nowMs` still counts — a message a clock-skewed peer posted "in the future" is in the
 * place all the same.
 *
 * @param outgoing the identity of the message about to be sent
 * @param priors this identity's messages already in the place
 * @param nowMs the reference instant
 * @param digestWindowMs how far back the digest rule looks
 * @param firstLineWindowMs how far back the first-line rule looks
 * @returns the match, or `undefined` when the message is not a repeat
 */
export function findRepeat({
  outgoing,
  priors,
  nowMs,
  digestWindowMs,
  firstLineWindowMs,
}: {
  outgoing: RepeatIdentity;
  priors: readonly RepeatPrior[];
  nowMs: number;
  digestWindowMs: number;
  firstLineWindowMs: number;
}): RepeatMatch | undefined {
  let found: RepeatMatch | undefined;
  for (const prior of priors) {
    const rule = ruleFor({ ageMs: nowMs - prior.tsMs, digestWindowMs, firstLineWindowMs, outgoing, prior });
    if (rule !== undefined && (found === undefined || prior.tsMs < found.prior.tsMs)) {
      found = { prior, rule };
    }
  }
  return found;
}
