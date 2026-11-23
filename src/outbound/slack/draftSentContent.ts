/**
 * What a `sent …` record must prove BEYOND the words (`./draftSentNote.ts`'s `sentNoteProven`): the row's media, and
 * the structure of a card or no-fold payload, whose text read is only its fallback. Text alone once spent an approved
 * row whose attachment, or whose card blocks, never reached Slack.
 *
 * Media is matched by filename and byte count to a distinct file on the messages read — Slack's message read carries
 * no content hash, so a same-named, same-sized substitute is the stated residue. A structured payload is proven only
 * as ONE message whose blocks hold every field the row's blocks carry, value for value; Slack adds fields of its own
 * (`block_id`, `verbatim`), which a posted block may carry and the row's never needs to. A drip's one block renders its
 * own text, so a drip, split or whole, is proven by its words. Pure.
 */
import { isRecord } from "#lib/parsers.js";

import { parkedPayloadShape, type SlackDraftItem } from "./draftRegister.js";

/**
 * Whether the messages a send record names carry the row's media and, for a structured payload, its blocks.
 *
 * @param messages the posted messages the refs resolved to, in note order
 * @param row the held row about to be dropped
 * @returns true only when nothing the row carries beyond its words is missing from them
 */
export function sentContentProven({
  messages,
  row,
}: {
  messages: readonly Record<string, unknown>[];
  row: SlackDraftItem;
}): boolean {
  return mediaProven({ messages, row }) && blocksProven({ messages, row });
}

/** Whether every medium the row carries is a distinct file, same name and byte count, on the messages. */
function mediaProven({
  messages,
  row,
}: {
  messages: readonly Record<string, unknown>[];
  row: SlackDraftItem;
}): boolean {
  const media = row.draft.media;
  if (media === undefined || media.length === 0) {
    return true;
  }
  const files = messages.flatMap((message) => {
    const listed = message["files"];
    return Array.isArray(listed) ? listed.filter(isRecord) : [];
  });
  const taken = new Set<number>();
  return media.every((one) => {
    const index = files.findIndex(
      (file, at) => !taken.has(at) && file["name"] === one.name && file["size"] === one.bytes,
    );
    taken.add(index);
    return index !== -1;
  });
}

/** Whether a card's wrapper blocks, or a no-fold message's blocks, stand in the one message the record names. */
function blocksProven({
  messages,
  row,
}: {
  messages: readonly Record<string, unknown>[];
  row: SlackDraftItem;
}): boolean {
  const payload = parkedPayloadShape({ payload: row.draft.payload });
  if (payload.kind === "drip") {
    return true;
  }
  const [message] = messages;
  if (message === undefined || messages.length !== 1) {
    return false;
  }
  if (payload.kind === "no-fold") {
    return carries({ posted: message["blocks"], wanted: payload.payload.blocks });
  }
  const attachments = message["attachments"];
  const wrapper: unknown = Array.isArray(attachments) ? attachments[0] : undefined;
  const posted = isRecord(wrapper) ? wrapper["blocks"] : undefined;
  return carries({ posted, wanted: payload.payload.attachments[0].blocks });
}

/**
 * Whether a posted value carries everything a wanted one does: an equal primitive, an array of the same length whose
 * every element carries its counterpart, or a record holding every wanted key with a value carrying it.
 */
function carries({ posted, wanted }: { posted: unknown; wanted: unknown }): boolean {
  if (Array.isArray(wanted)) {
    return (
      Array.isArray(posted) &&
      posted.length === wanted.length &&
      wanted.every((one, index) => carries({ posted: posted[index], wanted: one }))
    );
  }
  if (isRecord(wanted)) {
    return (
      isRecord(posted) &&
      Object.entries(wanted).every(
        ([key, value]) => value === undefined || carries({ posted: posted[key], wanted: value }),
      )
    );
  }
  return posted === wanted;
}
