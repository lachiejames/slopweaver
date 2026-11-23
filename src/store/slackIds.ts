/**
 * What a caller typed, read as an address: a store uuid, or Slack's own coordinates for one message.
 *
 * `store around` used to take a uuid and nothing else, which meant a detective holding the thing a human
 * actually has — a message link copied out of Slack — had to run a query first to turn it into one. This
 * module is the parse that removes that step, and it is PURE so the whole accepted grammar is a table of
 * cases rather than a behaviour of the database.
 *
 * ## The four spellings, and why each is a shape this store already holds
 *
 * `src/corpus/slack/project.ts` builds a record's `sourceId` as `<channel>:<ts>` for a top-level message
 * and `` `${reply.channelId}:${reply.threadTs}:reply:${reply.ts}` `` for a reply, and its `url` as Slack's
 * own permalink. So a caller can paste any of them and mean exactly one row:
 *
 * | what a caller has            | example                                         | what it addresses  |
 * | ---------------------------- | ----------------------------------------------- | ------------------ |
 * | a store uuid                 | `<store uuid>`                                  | that row           |
 * | a message's own `source_id`  | `C0SYN4E1234567:1789717308.365179`                 | that message       |
 * | a reply's own `source_id`    | `C0SYN4E1234567:1789717300.100000:reply:…365179`   | the REPLY          |
 * | a Slack permalink            | `https://x.slack.com/archives/C0SY…/p1789…179`  | the message linked |
 *
 * A reply's id carries TWO timestamps and the one this returns is the reply's own, never the thread's —
 * the anchor a detective pasted is the message they were looking at, and the thread is what the read goes
 * and finds. Getting that backwards would silently re-anchor the page on somebody else's message.
 *
 * ## Why the timestamp is carried as TEXT and never parsed into a number
 *
 * A Slack `ts` is an identity, not a measurement: `1789717308.365179` addresses one message and
 * `1789717308.365180` addresses a different one. Its fixed `[0-9]{10}.[0-9]{6}` width is also what makes it
 * sort correctly as text, which is the channel walk's total order. Turning it into a float would lose the
 * low digits to binary rounding and turn an identity into a near-miss — the class
 * `.claude/rules/typescript-patterns.md` bans `new Date(x * 1000)` for, one layer down.
 */
import { err, ok, type Result } from "../lib/result.js";

import { type StoreError, StoreErrors } from "./errors.js";

/**
 * A Slack timestamp as Slack writes it: ten epoch seconds, a dot, six more digits.
 *
 * Anchored whole rather than searched for, because this is a validation of something a caller typed — a
 * value with a digit too many is a typo to report, not a substring to find.
 */
const SLACK_TS = /^[0-9]{10}\.[0-9]{6}$/;

/**
 * A Slack conversation id: `C` for a channel, `D` for a direct message, `G` for a private group.
 *
 * The three prefixes are Slack's own and all three appear in this store — `store facets --facet
 * slack.channel` is what lists them. The body is upper-case alphanumeric.
 */
const SLACK_CONVERSATION = /^[CDG][A-Z0-9]{2,}$/;

/** A canonical store uuid, in the 8-4-4-4-12 layout every disclosure verb prints. */
const STORE_UUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

/**
 * A Slack permalink, as `src/corpus/slack/project.ts` stores it in `content.url`.
 *
 * The `p` number is the ts with its dot removed, so it is always sixteen digits; a link carrying anything
 * else is a link to something that is not a message and is refused by name rather than searched for.
 */
const SLACK_PERMALINK = /^https?:\/\/[^/]+\.slack\.com\/archives\/([CDG][A-Z0-9]{2,})\/p([0-9]+)/;

/** How many digits a permalink's `p` number carries: a ten-second epoch plus six more. */
const PERMALINK_DIGITS = 16;

/** One address, resolved to the thing it names. */
export type SlackAddress =
  | { readonly kind: "uuid"; readonly id: string }
  | { readonly kind: "slack"; readonly channelId: string; readonly messageTs: string };

/**
 * Split a `source_id` into its colon-separated parts, so the two Slack layouts are read by shape.
 *
 * @param value the id a caller typed
 * @returns the parts, in order
 */
function partsOf({ value }: { value: string }): readonly string[] {
  return value.split(":");
}

/**
 * Read a Slack `source_id` — a message's `<channel>:<ts>` or a reply's `<channel>:<thread>:reply:<ts>`.
 *
 * @param value the id a caller typed
 * @returns the channel and the addressed message's own timestamp, or nothing when the shape is not one
 */
function sourceIdAddress({ value }: { value: string }): SlackAddress | null {
  const parts = partsOf({ value });
  const [channelId, first, marker, replyTs] = parts;
  if (channelId === undefined || !SLACK_CONVERSATION.test(channelId)) {
    return null;
  }
  if (parts.length === 2 && first !== undefined && SLACK_TS.test(first)) {
    return { channelId, kind: "slack", messageTs: first };
  }
  // A reply's own timestamp is the LAST field, never the thread root in the second — see this module's
  // header for why re-anchoring on the root would move the page off the message the caller pasted.
  if (parts.length === 4 && marker === "reply" && replyTs !== undefined && SLACK_TS.test(replyTs)) {
    return { channelId, kind: "slack", messageTs: replyTs };
  }
  return null;
}

/**
 * Read a Slack permalink back into the coordinates it was built from.
 *
 * @param value the URL a caller pasted
 * @returns the coordinates, or the refusal naming what was wrong with the link
 */
function permalinkAddress({ value }: { value: string }): Result<SlackAddress, StoreError> | null {
  const matched = SLACK_PERMALINK.exec(value);
  if (matched === null) {
    return null;
  }
  const channelId = matched[1];
  const digits = matched[2];
  if (channelId === undefined || digits === undefined) {
    return null;
  }
  if (digits.length !== PERMALINK_DIGITS) {
    return err(
      StoreErrors.addressNotAMessageLink({ digits: digits.length, spelling: value, wanted: PERMALINK_DIGITS }),
    );
  }
  const seconds = digits.slice(0, 10);
  const micros = digits.slice(10);
  return ok({ channelId, kind: "slack", messageTs: `${seconds}.${micros}` });
}

/** A Slack row's two timestamps, as its own id carries them. */
export interface SlackTimestamps {
  /** The message's own timestamp — a reply's own, never its thread's. */
  readonly messageTs: string;
  /** The root of the thread it sits in; equal to `messageTs` for a top-level message. */
  readonly threadTs: string;
}

/**
 * The two timestamps a Slack record's own id carries.
 *
 * ## Why the id, when `content_slack` has a column for each of them
 *
 * `redactRecord.ts`'s `redactRecord` runs `redactText` over a record's `text`, `title`, `attrs` and
 * `raw` — and that pass rewrites any run of nine or more digits as `[number]`, so a `ts` arrives in the
 * payload as `[number].857509`. It does NOT run over `sourceId`, `url` or `container`, structurally
 * rather than incidentally. MEASURED on a live store: over nine in ten of hundreds of thousands
 * of `message_ts` values and 100% of the non-null `thread_ts` values were carved up, against zero `source_id` values —
 * `corpus/redact.ts`'s {@link ../corpus/redact} `SLACK_TS_SPAN` is what stops the next one, and this is
 * what heals the ones already on disk, because a re-ingest of the same bronze recovers both columns
 * with no provider refetch.
 *
 * Returning nothing rather than a guess is the point for the layouts that are not messages: a `pin` is
 * `<channel>:pin:<ts>` and a `file` is `<channel>:<ts>:file:<id>`, so part two is not always a timestamp
 * and a caller handed one that is not would key a thread on the word `pin`.
 *
 * @param sourceId the record's own id, as `corpus/slack/project.ts` built it
 * @returns the two timestamps, or nothing when the id is not one of the two message layouts
 */
export function slackTimestampsOf({ sourceId }: { sourceId: string }): SlackTimestamps | null {
  const address = sourceIdAddress({ value: sourceId });
  if (address?.kind !== "slack") {
    return null;
  }
  const parts = partsOf({ value: sourceId });
  const threadTs = parts[1];
  if (threadTs === undefined || !SLACK_TS.test(threadTs)) {
    return null;
  }
  return { messageTs: address.messageTs, threadTs };
}

/**
 * Read what a caller typed as the address of one record.
 *
 * Every refusal names what it saw rather than returning nothing, because the failure this replaces is a
 * mistyped id that reads exactly like a record the store does not hold.
 *
 * @param value the `--id` a caller supplied
 * @returns the address, or the reason it is not one
 */
export function parseSlackAddress({ value }: { value: string }): Result<SlackAddress, StoreError> {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return err(StoreErrors.addressEmpty());
  }
  if (STORE_UUID.test(trimmed)) {
    return ok({ id: trimmed, kind: "uuid" });
  }
  const permalink = permalinkAddress({ value: trimmed });
  if (permalink !== null) {
    return permalink;
  }
  const sourceId = sourceIdAddress({ value: trimmed });
  if (sourceId !== null) {
    return ok(sourceId);
  }
  return err(StoreErrors.addressUnreadable({ spelling: trimmed }));
}
