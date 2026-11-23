/**
 * Whether a drop note RECORDS a send of the row's words, which is the one way a drop may end an approved row without
 * a cut that stands (`./draftApproval.ts`'s `dropLeadsTo`).
 *
 * The note's whole grammar is `sent <ref>[, <ref>…]`, every ref a Slack permalink or a `<channel> <ts>` pair, each in
 * the row's own conversation and posted after the row was parked. A release whose register write failed prints the
 * pair form (`../../cli/commands/slack/releaseRow.ts`); a drip split sends the permalinks
 * (`skills/slack/reference/pre-approved.md`). Matching any permalink or `sent <channel> <ts>` ANYWHERE in prose once
 * passed, so `not sent C… <ts> — invalid_auth`, or a failure note citing the thread that refused it, spent the owner's yes as
 * if it had gone. The note's form is judged here, pure; whether Slack holds THESE words at
 * those refs is {@link sentNoteProven}, which `slack draft drop` reads Slack for before it drops
 * (`../../cli/commands/slack/draftSentProof.ts`).
 */
import { isRecord } from "#lib/parsers.js";
import { slackTsFromPermalink, slackTsToEpochMs } from "#lib/slackTs.js";

import type { SlackDraftItem } from "./draftRegister.js";
import { sentContentProven } from "./draftSentContent.js";
import { isOwnMessage, repeatIdentity, repeatTextOf } from "./repeatMatch.js";

/** One whole permalink token: its channel, and the `p…` segment its message's ts is encoded in. */
const PERMALINK = /^https:\/\/[a-z0-9-]+\.slack\.com\/archives\/([A-Z0-9]+)\/(p\d{7,})(?:\?\S*)?$/;

/** A channel token of a `<channel> <ts>` pair. */
const CHANNEL = /^[A-Z][A-Z0-9]+$/;

/** One place a note says the words went. */
interface SentRef {
  readonly channel: string;
  readonly ts: string | undefined;
}

/**
 * The refs a `sent …` note names, or `undefined` when any token after `sent` is neither a permalink nor a pair.
 *
 * @param note the drop note
 * @returns the refs in order
 */
function sentRefs({ note }: { note: string }): readonly SentRef[] | undefined {
  const [head, ...tokens] = note.trim().split(/[\s,]+/);
  if (head !== "sent" || tokens.length === 0) {
    return undefined;
  }
  const refs: SentRef[] = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]!;
    const link = PERMALINK.exec(token);
    if (link !== null) {
      refs.push({ channel: link[1]!, ts: slackTsFromPermalink({ permalink: link[2]! }) });
      continue;
    }
    const ts = tokens[index + 1];
    if (!CHANNEL.test(token) || ts === undefined) {
      return undefined;
    }
    refs.push({ channel: token, ts });
    index += 1;
  }
  return refs;
}

/**
 * Whether the note is a `sent …` record whose every ref lands in the row's own conversation after it was parked.
 *
 * @param note the drop note
 * @param row the held row about to be dropped
 * @returns true only for a whole, well-formed send record of this row
 */
export function noteRecordsSend({ note, row }: { note: string; row: SlackDraftItem }): boolean {
  return sentRefsOfRow({ note, row }) !== undefined;
}

/**
 * The messages a `sent …` note names, when it is a whole send record of this row — every ref in the row's own
 * conversation, posted after it was parked — else `undefined`.
 *
 * @param note the drop note
 * @param row the held row about to be dropped
 * @returns each ref's channel and ts, in note order
 */
export function sentRefsOfRow({
  note,
  row,
}: {
  note: string;
  row: SlackDraftItem;
}): readonly { readonly channel: string; readonly ts: string }[] | undefined {
  const refs = sentRefs({ note });
  const parked = Date.parse(row.draft.tsIso);
  if (refs === undefined || Number.isNaN(parked)) {
    return undefined;
  }
  const whole: { readonly channel: string; readonly ts: string }[] = [];
  for (const { channel, ts } of refs) {
    const sentMs = ts === undefined ? undefined : slackTsToEpochMs({ ts });
    if (ts === undefined || channel !== row.draft.channel || sentMs === undefined || sentMs < parked) {
      return undefined;
    }
    // One message named twice would stand in for two parts of a split it never was.
    if (whole.some((one) => one.ts === ts)) {
      return undefined;
    }
    whole.push({ channel, ts });
  }
  return whole;
}

/**
 * Whether what Slack holds at a send record's refs IS this row's words: each ref a message by the row's own author at
 * exactly that ts, in the row's thread (or top-level for a row with none), and their texts, joined in note order, the same normalised words the row carries
 * (`./repeatMatch.ts`'s identity, the one the transport's repeat read compares a payload to a posted message by). A
 * well-formed note alone once proved a send, so `sent <channel> <any later ts>` dropped an approved row nobody sent.
 * The words are not the whole row: its media and a card's blocks must stand there too
 * (`./draftSentContent.ts`).
 *
 * @param refs the note's refs, from {@link sentRefsOfRow}
 * @param reads the raw messages read at each ref, in the same order
 * @param row the held row about to be dropped
 * @returns true only when every ref is read and the words are the row's
 */
export function sentNoteProven({
  reads,
  refs,
  row,
}: {
  reads: readonly (readonly unknown[])[];
  refs: readonly { readonly channel: string; readonly ts: string }[];
  row: SlackDraftItem;
}): boolean {
  const authorId = row.draft.authorId;
  const words = repeatTextOf({ message: row.draft.payload });
  if (authorId === undefined || words === undefined || reads.length !== refs.length) {
    return false;
  }
  const messages: Record<string, unknown>[] = [];
  const texts: string[] = [];
  for (const [index, ref] of refs.entries()) {
    const message = reads[index]!.filter(isRecord).find(
      (raw) =>
        raw["ts"] === ref.ts &&
        placedAsRow({ message: raw, row }) &&
        isOwnMessage({ message: raw, self: { userId: authorId } }),
    );
    const text = repeatTextOf({ message });
    if (message === undefined || text === undefined) {
      return false;
    }
    messages.push(message);
    texts.push(text);
  }
  const sameWords = repeatIdentity({ text: texts.join("\n") }).digest === repeatIdentity({ text: words }).digest;
  return sameWords && sentContentProven({ messages, row });
}

/**
 * Whether a message sits where the row was to go: a reply in the row's thread, or a top-level post for a row with no
 * thread. The same words in the same channel but elsewhere are another message, not this row sent.
 */
function placedAsRow({ message, row }: { message: Record<string, unknown>; row: SlackDraftItem }): boolean {
  const threadTs = message["thread_ts"];
  if (row.draft.threadTs !== undefined) {
    return threadTs === row.draft.threadTs && message["ts"] !== row.draft.threadTs;
  }
  return threadTs === undefined || threadTs === message["ts"];
}
