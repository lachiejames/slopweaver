/**
 * The ONE projection of a chat-history conversation into bronze {@link CorpusRecord}s, shared by every
 * chat-history provider (`./types.ts` says why the split sits here).
 *
 * ## One record per visible message
 *
 * A conversation is the unit the owner remembers, but a MESSAGE is the unit a question lands on: "what did I decide
 * about the lease" is answered by one turn of a forty-turn chat, and a whole-conversation record would hand a
 * reader forty turns to find it in. Each record carries the conversation's title and id, so grouping back up is a
 * filter rather than a re-fetch. A message's id is the provider's own, so re-ingesting a newer export of the same
 * conversation dedups onto the same records and appends only what is new.
 *
 * No text cap: a message is already record-sized — one reply, one turn — so its whole text is the record.
 * Truncating it would be a successful record that quietly lies about what was said.
 *
 * ## Private, twice over
 *
 * The owner's chats are the most personal text this corpus can hold — the owner's own words to an assistant, written for
 * nobody else. So the source is always-private (`../visibility.ts`) AND every record is stamped, for the reason
 * Fathom's projection gives: the default is public, and one path that forgot would leak with nothing to show it.
 *
 * Pure: no I/O, no clock.
 */
import { extractRefs } from "../refs.js";
import type { CorpusAttributeValue, CorpusRecord, CorpusSource } from "../types.js";
import { stampVisibility } from "../visibility.js";
import type { ChatHistoryConversation, ChatHistoryMessage } from "./types.js";

/** The chat-history sources — the providers whose archives project through here. */
export type ChatHistorySource = Extract<CorpusSource, "chatgpt">;

/**
 * The bronze `container` every record of one provider sits in.
 *
 * One bucket per provider rather than one per conversation, because `container` is a LOW-cardinality grouping and
 * a heavy account holds thousands of conversations; the conversation id rides in `attrs` and in `sourceId`.
 *
 * @param source the chat-history source
 * @returns the container, e.g. `chatgpt/conversations`
 */
export function chatHistoryContainer({ source }: { source: ChatHistorySource }): string {
  return `${source}/conversations`;
}

/**
 * The typed facts a later reader filters on without re-reading the archive. Only facts OF THE MESSAGE: attrs are part
 * of bronze's dedup fingerprint, so a conversation-wide fact that moves whenever the owner adds a turn (its update time)
 * would re-append every message already held each time the chat grew.
 */
function messageAttrs({
  conversation,
  message,
}: {
  conversation: ChatHistoryConversation;
  message: ChatHistoryMessage;
}): Readonly<Record<string, CorpusAttributeValue>> {
  return {
    branch: message.branch,
    conversationId: conversation.id,
    modality: message.modality,
    role: message.role,
    turnIndex: message.turnIndex,
    ...(message.model !== undefined ? { model: message.model } : {}),
    ...(message.parentMessageId !== undefined ? { parentMessageId: message.parentMessageId } : {}),
    ...(message.attachments > 0 ? { attachments: message.attachments } : {}),
  };
}

/** The message's own instant, else its conversation's start; `undefined` when neither was recorded. */
function messageInstant({
  conversation,
  message,
}: {
  conversation: ChatHistoryConversation;
  message: ChatHistoryMessage;
}): string | undefined {
  const own = message.createdIso;
  if (own !== undefined) {
    return own;
  }
  return conversation.createdIso;
}

/**
 * Project one message into a bronze record.
 *
 * Dated by the MESSAGE's own instant, falling back to the conversation's start when the provider recorded none,
 * so a three-month-old chat that gained one line yesterday puts that line on yesterday and the rest where they
 * were said.
 *
 * @param source the chat-history source
 * @param conversation the conversation the message belongs to
 * @returns the record, or `undefined` when neither the message nor its conversation carries an instant
 */
function projectChatMessage({
  source,
  conversation,
  message,
}: {
  source: ChatHistorySource;
  conversation: ChatHistoryConversation;
  message: ChatHistoryMessage;
}): CorpusRecord | undefined {
  const tsIso = messageInstant({ conversation, message });
  if (tsIso === undefined) {
    return undefined;
  }
  const record: CorpusRecord = {
    attrs: messageAttrs({ conversation, message }),
    // The role, not a person: the account's owner is the only `user`, and the assistant is named by model in
    // attrs. A display name here would have to be guessed, and a guessed author is worse than an honest role.
    author: message.role,
    container: chatHistoryContainer({ source }),
    kind: "message",
    refs: extractRefs({ text: message.text }),
    source,
    sourceId: `${conversation.id}:${message.id}`,
    text: message.text,
    tsIso,
    url: conversation.url,
    ...(conversation.title !== undefined ? { title: conversation.title } : {}),
  };
  return stampVisibility({ record, visibility: "private" });
}

/** What projecting one conversation produced, and what it could not place. */
export interface ChatHistoryProjection {
  readonly records: readonly CorpusRecord[];
  /** Messages with no instant on them or their conversation — counted, never silently dropped. */
  readonly undated: number;
}

/**
 * Project every visible message of one conversation.
 *
 * @param source the chat-history source
 * @returns the records, and how many messages had nowhere to sit on a timeline
 */
export function projectChatConversation({
  source,
  conversation,
}: {
  source: ChatHistorySource;
  conversation: ChatHistoryConversation;
}): ChatHistoryProjection {
  const records: CorpusRecord[] = [];
  let undated = 0;
  for (const message of conversation.messages) {
    const record = projectChatMessage({ conversation, message, source });
    if (record === undefined) {
      undated += 1;
      continue;
    }
    records.push(record);
  }
  return { records, undated };
}
