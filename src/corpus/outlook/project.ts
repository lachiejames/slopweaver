/**
 * Project Outlook messages into `CorpusRecord`s, and settle what an Outlook mail record may carry. Pure: the
 * same message always projects to the same record, which is what makes a re-read a no-op at the write path.
 *
 * The Gmail lane's hygiene ruling holds here unchanged (`../gmail/project.ts` says why): `author` is a display
 * name, never an address; `raw` is never kept; recipient lists are bounded with the total always counted; the
 * quoted tail is stripped and the drop counted; every record is private twice over.
 *
 * ## Nothing that changes without the message changing
 *
 * Bronze dedups on a content fingerprint, so a field the owner changes by FILING — `isRead`, `categories`, the
 * folder a message sits in — would append a fresh line per click for zero content change. None of them is
 * carried. The container obeys the same rule, which is why it is read off the SENDER and never the folder: an
 * immutable message id is stable across a move between folders, so a folder-derived container would mint a
 * second version of the same message every time the owner filed it.
 *
 * The sender test compares the address against the one connected account. Its stated residue: mail sent from
 * an alias, as another identity or from a delegated mailbox reads `mail/received`, because the grant names
 * one address and nothing else.
 */
import type { GraphMessage } from "../../live/outlook/graphWire.js";
import { MAX_STORED_RECIPIENTS } from "../gmail/project.js";
import { stripQuotedTail } from "../gmail/quoted.js";
import { personName } from "../personName.js";
import { extractRefs } from "../refs.js";
import type { CorpusAttributeValue, CorpusRecord } from "../types.js";
import { stampVisibility } from "../visibility.js";

/** Graph's `recipient` as the door reads it. */
type GraphRecipient = NonNullable<GraphMessage["from"]>;

/** Why a message produced no record. */
type DeclineReason = "draft" | "undated";

/** One message, projected or declined. */
export type OutlookMessageProjection =
  | { readonly kind: "record"; readonly record: CorpusRecord; readonly htmlBody: boolean; readonly linkless: boolean }
  | { readonly kind: "declined"; readonly reason: DeclineReason };

/**
 * One recipient as a single header-shaped string, `Name <address>`, so the writer's scrub reaches the address.
 * Pure.
 *
 * @param recipient the Graph recipient
 * @returns the header string, or undefined when it names nobody
 */
function recipientLine({ recipient }: { recipient: GraphRecipient }): string | undefined {
  const name = recipient.emailAddress.name?.trim();
  const address = recipient.emailAddress.address?.trim();
  const hasName = name !== undefined && name.length > 0;
  const hasAddress = address !== undefined && address.length > 0;
  if (hasName && hasAddress) {
    return `${name} <${address}>`;
  }
  if (hasAddress) {
    return address;
  }
  return hasName ? name : undefined;
}

/**
 * Who a message is from: `from`, else `sender` — they differ only when one person sends on another's behalf,
 * and a message Graph answers with neither names nobody. Pure.
 */
function whoSent({ message }: { message: GraphMessage }): GraphRecipient | undefined {
  if (message.from != null) {
    return message.from;
  }
  if (message.sender != null) {
    return message.sender;
  }
  return undefined;
}

/** Every recipient line of one list, nameless ones dropped. */
function recipientLines({ list }: { list: readonly GraphRecipient[] | undefined }): string[] {
  if (list === undefined) {
    return [];
  }
  return list.flatMap((recipient) => {
    const line = recipientLine({ recipient });
    return line === undefined ? [] : [line];
  });
}

/**
 * The low-cardinality container: `mail/sent` when the connected account sent it, else `mail/received`. Read off
 * `from`, else `sender`, never the folder (this file's header says why). Pure.
 *
 * @param message the Graph message
 * @param account the connected account's address
 * @returns the container
 */
export function outlookMailContainer({
  message,
  account,
}: {
  message: GraphMessage;
  account: string;
}): "mail/sent" | "mail/received" {
  const address = whoSent({ message })?.emailAddress.address?.trim().toLowerCase();
  return address !== undefined && address === account.trim().toLowerCase() ? "mail/sent" : "mail/received";
}

/**
 * The instant a message is dated by: when it was sent, else when it arrived, as a canonical ISO string. Pure.
 *
 * @param message the Graph message
 * @returns the instant, or undefined when neither stamp parses
 */
export function outlookMessageTsIso({ message }: { message: GraphMessage }): string | undefined {
  for (const stamp of [message.sentDateTime, message.receivedDateTime]) {
    if (stamp == null) {
      continue;
    }
    const ms = Date.parse(stamp);
    if (!Number.isNaN(ms)) {
      return new Date(ms).toISOString();
    }
  }
  return undefined;
}

/** A Graph string with `null` read as absent, the way the shared helpers take one. */
function absentWhenNull({ value }: { value: string | null | undefined }): string | undefined {
  if (value == null) {
    return undefined;
  }
  return value;
}

/** The record's `url`: Graph's `webLink`, or empty for a message Graph gave none (the record says so). */
function webLinkOf({ message }: { message: GraphMessage }): string {
  if (message.webLink == null) {
    return "";
  }
  return message.webLink;
}

/** The sender's name for `author`: `from`, else `sender`, through `personName` so no address lands there. */
function authorName({ message }: { message: GraphMessage }): string | undefined {
  const from = whoSent({ message });
  if (from === undefined) {
    return undefined;
  }
  const { address, name } = from.emailAddress;
  return personName({
    address: absentWhenNull({ value: address }),
    displayName: absentWhenNull({ value: name }),
  });
}

/** The attribute bag for one message, with absent fields omitted rather than emptied. */
function outlookMailAttrs({
  message,
  droppedChars,
}: {
  message: GraphMessage;
  droppedChars: number;
}): Readonly<Record<string, CorpusAttributeValue>> {
  const to = recipientLines({ list: message.toRecipients });
  const cc = recipientLines({ list: message.ccRecipients });
  const from = message.from == null ? undefined : recipientLine({ recipient: message.from });
  return {
    hasAttachments: message.hasAttachments === true,
    quotedCharsDropped: droppedChars,
    // Unconditional, so a bounded list is never mistaken for a complete one.
    recipientCount: to.length + cc.length,
    ...(from !== undefined ? { from } : {}),
    ...(to.length > 0 ? { to: to.slice(0, MAX_STORED_RECIPIENTS) } : {}),
    ...(cc.length > 0 ? { cc: cc.slice(0, MAX_STORED_RECIPIENTS) } : {}),
    ...(message.conversationId != null ? { conversationId: message.conversationId } : {}),
    ...(message.internetMessageId != null ? { internetMessageId: message.internetMessageId } : {}),
  };
}

/**
 * Project one message, or decline it: a draft is not mail yet, and a message with no parseable stamp would be
 * dated from nowhere (`../gmail/project.ts`'s `projectGmailMessage` says why a guessed date is worse than none).
 * A body Graph answered as HTML despite the text preference is never stored: the record keeps an empty text and
 * says so. Pure.
 *
 * @param message the Graph message, never a tombstone
 * @param account the connected account's address, which decides the container
 * @returns the record, or why there is none
 */
export function projectOutlookMessage({
  message,
  account,
}: {
  message: GraphMessage;
  account: string;
}): OutlookMessageProjection {
  if (message.isDraft === true) {
    return { kind: "declined", reason: "draft" };
  }
  const tsIso = outlookMessageTsIso({ message });
  if (tsIso === undefined) {
    return { kind: "declined", reason: "undated" };
  }
  const htmlBody = message.body?.contentType === "html";
  const body = message.body === undefined || htmlBody ? "" : message.body.content;
  const stripped = stripQuotedTail({ body });
  const author = authorName({ message });
  const linkless = message.webLink == null;
  const url = webLinkOf({ message });
  const record: CorpusRecord = {
    attrs: outlookMailAttrs({ droppedChars: stripped.droppedChars, message }),
    container: outlookMailContainer({ account, message }),
    kind: "message",
    refs: extractRefs({ text: stripped.text }),
    source: "outlook",
    sourceId: message.id,
    text: stripped.text,
    tsIso,
    url,
    ...(author !== undefined ? { author } : {}),
    ...(message.subject != null ? { title: message.subject } : {}),
  };
  return { htmlBody, kind: "record", linkless, record: stampVisibility({ record, visibility: "private" }) };
}

/**
 * Project a batch, counting every decline and every lossy step into one warning each.
 *
 * @param messages the changed messages of one delta page, tombstones already set aside
 * @param account the connected account's address
 * @returns the records, and the warnings naming what was declined or stored without a body or link
 */
export function projectOutlookMessages({ messages, account }: { messages: readonly GraphMessage[]; account: string }): {
  records: readonly CorpusRecord[];
  warnings: readonly string[];
} {
  const records: CorpusRecord[] = [];
  const counts = { draft: 0, html: 0, linkless: 0, undated: 0 };
  for (const message of messages) {
    const projected = projectOutlookMessage({ account, message });
    if (projected.kind === "declined") {
      counts[projected.reason] += 1;
      continue;
    }
    records.push(projected.record);
    counts.html += projected.htmlBody ? 1 : 0;
    counts.linkless += projected.linkless ? 1 : 0;
  }
  return { records, warnings: projectionWarnings({ counts }) };
}

/** One warning line per non-zero count. Pure. */
function projectionWarnings({
  counts,
}: {
  counts: { draft: number; html: number; linkless: number; undated: number };
}): readonly string[] {
  const lines: string[] = [];
  if (counts.undated > 0) {
    lines.push(
      `${String(counts.undated)} Outlook message(s) carried no usable sent or received time and were not stored`,
    );
  }
  if (counts.html > 0) {
    lines.push(
      `${String(counts.html)} Outlook message(s) came back as HTML despite the text preference and were stored with no body`,
    );
  }
  if (counts.linkless > 0) {
    lines.push(
      `${String(counts.linkless)} Outlook message(s) carried no web link; re-read them by id with \`slopweaver outlook read\``,
    );
  }
  if (counts.draft > 0) {
    lines.push(`${String(counts.draft)} Outlook draft(s) outside the Drafts folder were not stored`);
  }
  return lines;
}
