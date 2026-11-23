/**
 * The reader for `slopweaver slack draft context <id> --json` — the conversation a parked draft lands in, read
 * live off Slack when its card opens.
 *
 * A draft drawn alone made the owner step into Slack to see what came before it. The card draws
 * this above the draft instead. The ENVELOPE is strict, as every reader here is — an id, an instant, a scope,
 * a link and every message's ts, time and author, or the whole reading is NOT MEASURED rather than a
 * conversation drawn with a message missing. A message's CONTENT is read leniently
 * (`./readSlackDraftsMessage.ts`'s `messageLines`), because it is somebody else's message in whatever shape their
 * client sent, and Slack's own text of it is always there to fall back on.
 */

import { type Bag, bags, bool, instant, isBag, num, str, strings, sub } from "../../lib/bag";
import type { SlackPeople } from "../../lib/slackPeople";
import { messageLines } from "./readSlackDraftsMessage";
import { peopleOf } from "./readSlackDraftsPeople";
import { type DraftLine } from "./readSlackDraftsRuns";

/** One message of the conversation, as the card draws it. */
export interface ContextMessage {
  readonly ts: string;
  readonly tsIso: string;
  readonly permalink: string;
  /** The member who wrote it — an app's own user id included — when Slack said. */
  readonly userId: string | undefined;
  /**
   * Whether an app posted it AS ITSELF, which Slack badges APP: a bot member by the roster, or an app whose
   * member the roster does not name. A person's own message sent through an app on their user token carries a `botId` too —
   * measured, every message the fleet sends as the owner does — and Slack draws that one as the person, unbadged.
   */
  readonly bot: boolean;
  /** The name an app posted under when no member id names it. */
  readonly username: string | undefined;
  readonly lines: readonly DraftLine[];
  readonly fileCount: number;
  readonly replyCount: number;
  readonly edited: boolean;
}

/**
 * What moved in the conversation since the draft was written, as the verb measured it off the same read
 * (`src/live/slack/draftContextSince.ts`, the release's own classification). Each `ts` list is sorted; the page never
 * derives one itself.
 */
export type DraftSinceDrafted =
  | {
      readonly kind: "measured";
      readonly draftedIso: string;
      readonly added: readonly string[];
      readonly edited: readonly string[];
      readonly removed: readonly string[];
      /** What the read could not see, in plain words; empty when it covers every change since. */
      readonly limits: readonly string[];
    }
  | { readonly kind: "not-measured"; readonly why: string };

/** The conversation a draft lands in, as it stood when the card read it. */
export interface DraftContext {
  readonly id: string;
  readonly observedAtIso: string;
  /** A reply's whole `thread`, or a top-level post's `channel` tail. */
  readonly scope: "thread" | "channel";
  readonly channel: string;
  /** The thread's root permalink, or the channel's own address. */
  readonly link: string;
  /** Whether the channel holds older messages than the tail shows — never true of a thread, read whole. */
  readonly earlierWithheld: boolean;
  /** Oldest first. */
  readonly messages: readonly ContextMessage[];
  readonly people: SlackPeople;
  readonly sinceDrafted: DraftSinceDrafted;
}

/** Whether a list holds each value once. */
function distinct({ values }: { values: readonly string[] }): boolean {
  return new Set(values).size === values.length;
}

/**
 * The verb's "since drafted" measurement, or `undefined` when it will not read: an unknown kind, an instant that is not
 * one, a list that is not strings, a `ts` listed twice, or an added or edited `ts` naming no message the conversation
 * holds (a removed one has none by definition).
 */
function sinceDraftedOf({
  payload,
  messages,
}: {
  payload: Bag;
  messages: readonly ContextMessage[];
}): DraftSinceDrafted | undefined {
  const since = sub({ bag: payload, key: "sinceDrafted" });
  if (since === undefined) {
    return undefined;
  }
  if (since["kind"] === "not-measured") {
    const why = str({ bag: since, key: "why" });
    if (why === undefined || why.trim() === "") {
      return undefined;
    }
    return { kind: "not-measured", why };
  }
  if (since["kind"] !== "measured") {
    return undefined;
  }
  const draftedIso = instant({ bag: since, key: "draftedIso" });
  const added = strings({ bag: since, key: "added" });
  const edited = strings({ bag: since, key: "edited" });
  const removed = strings({ bag: since, key: "removed" });
  const limits = strings({ bag: since, key: "limits" });
  if (
    draftedIso === undefined ||
    added === undefined ||
    edited === undefined ||
    removed === undefined ||
    limits === undefined
  ) {
    return undefined;
  }
  const held = new Set(messages.map((message) => message.ts));
  const named = [...added, ...edited];
  if (!distinct({ values: named }) || !distinct({ values: removed }) || !named.every((ts) => held.has(ts))) {
    return undefined;
  }
  return { added, draftedIso, edited, kind: "measured", limits, removed };
}

/** A count Slack reports: a non-negative whole number. */
function countOf({ bag, key }: { bag: Bag; key: string }): number | undefined {
  const value = num({ bag, key });
  if (value === undefined || !Number.isInteger(value) || value < 0) {
    return undefined;
  }
  return value;
}

/**
 * Each member the roster names, mapped to whether it is a bot, or `undefined` when a row's `bot` is present
 * and not a flag.
 *
 * @param payload the parsed document, whose `people` is the roster
 * @returns the flags, or `undefined`
 */
export function botFlagsOf({ payload }: { payload: Bag }): ReadonlyMap<string, boolean> | undefined {
  const rows = bags({ bag: payload, key: "people" });
  const out = new Map<string, boolean>();
  if (rows === undefined) {
    return out;
  }
  for (const row of rows) {
    const flag = row["bot"];
    const nativeId = str({ bag: row, key: "nativeId" });
    if (flag !== undefined && typeof flag !== "boolean") {
      return undefined;
    }
    if (nativeId !== undefined) {
      out.set(nativeId, flag === true);
    }
  }
  return out;
}

/**
 * One message's envelope — everything but how its files are told — or `undefined` when it will not read. Shared with
 * the channel hover window's reader (`./readSlackChannel.ts`), whose messages carry the same envelope and draw their
 * files rather than count them.
 *
 * @param row one entry of the document's `messages`
 * @param botFlags each rostered member's bot flag, off {@link botFlagsOf}
 * @returns the envelope, or `undefined`
 */
export function messageEnvelopeOf({
  row,
  botFlags,
}: {
  row: Bag;
  botFlags: ReadonlyMap<string, boolean>;
}): Omit<ContextMessage, "fileCount"> | undefined {
  const ts = str({ bag: row, key: "ts" });
  const tsIso = str({ bag: row, key: "tsIso" });
  const permalink = str({ bag: row, key: "permalink" });
  const text = str({ bag: row, key: "text" });
  const author = sub({ bag: row, key: "author" });
  const blocks = bags({ bag: row, key: "blocks" });
  const attachments = bags({ bag: row, key: "attachments" });
  const replyCount = countOf({ bag: row, key: "replyCount" });
  const edited = bool({ bag: row, key: "edited" });
  if (
    ts === undefined ||
    tsIso === undefined ||
    permalink === undefined ||
    text === undefined ||
    author === undefined ||
    blocks === undefined ||
    attachments === undefined ||
    replyCount === undefined ||
    edited === undefined
  ) {
    return undefined;
  }
  const userId = str({ bag: author, key: "userId" });
  let bot = str({ bag: author, key: "botId" }) !== undefined;
  const rostered = userId === undefined ? undefined : botFlags.get(userId);
  if (rostered !== undefined) {
    bot = rostered;
  }
  return {
    bot,
    edited,
    lines: messageLines({ attachments, blocks, text }),
    permalink,
    replyCount,
    ts,
    tsIso,
    userId,
    username: str({ bag: author, key: "username" }),
  };
}

/** One message off the document, or `undefined` when its envelope or its file count will not read. */
function messageOf({
  row,
  botFlags,
}: {
  row: Bag;
  botFlags: ReadonlyMap<string, boolean>;
}): ContextMessage | undefined {
  const envelope = messageEnvelopeOf({ botFlags, row });
  const fileCount = countOf({ bag: row, key: "fileCount" });
  if (envelope === undefined || fileCount === undefined) {
    return undefined;
  }
  return { ...envelope, fileCount };
}

/**
 * Read a `slack draft context --json` payload.
 *
 * @param payload the parsed stdout
 * @returns the conversation, or `undefined` when the payload is not one this card can draw truthfully
 */
export function readDraftContext(payload: unknown): DraftContext | undefined {
  if (!isBag(payload) || payload["kind"] !== "slopweaver.slack.draft-context" || payload["schemaVersion"] !== 2) {
    return undefined;
  }
  const id = str({ bag: payload, key: "id" });
  const observedAtIso = str({ bag: payload, key: "observedAtIso" });
  const scope = payload["scope"];
  const channel = str({ bag: payload, key: "channel" });
  const link = str({ bag: payload, key: "link" });
  const earlierWithheld = bool({ bag: payload, key: "earlierWithheld" });
  const rows = bags({ bag: payload, key: "messages" });
  const people = peopleOf({ payload });
  const botFlags = botFlagsOf({ payload });
  if (
    id === undefined ||
    observedAtIso === undefined ||
    (scope !== "thread" && scope !== "channel") ||
    channel === undefined ||
    link === undefined ||
    earlierWithheld === undefined ||
    rows === undefined ||
    people === undefined ||
    botFlags === undefined
  ) {
    return undefined;
  }
  const messages: ContextMessage[] = [];
  for (const row of rows) {
    const message = messageOf({ botFlags, row });
    if (message === undefined) {
      return undefined;
    }
    messages.push(message);
  }
  const sinceDrafted = sinceDraftedOf({ messages, payload });
  if (sinceDrafted === undefined) {
    return undefined;
  }
  return { channel, earlierWithheld, id, link, messages, observedAtIso, people, scope, sinceDrafted };
}
