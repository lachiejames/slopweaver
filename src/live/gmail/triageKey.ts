/**
 * The sender key one inbox message groups under, and what its own headers say about that sender — the half of
 * `gmail triage` (`./triage.ts`) that reads ONE message, before any group is folded.
 *
 * The key is the lower-cased `From` address, except for a Google Group relay, which rewrites `From` to the GROUP's
 * address and names the original sender only in the display name, so a relayed message is keyed by both
 * (`./triage.ts` § The group key). Pure: no fetch, no clock.
 */
import { senderAddress } from "../../corpus/gmail/geminiNotes.js";
import { senderName } from "../../corpus/gmail/project.js";
import { type GmailMessage, getHeader, sentAtIso } from "./parse.js";
import { listUnsubscribeTargets, promisesOneClick } from "./unsubscribe.js";

/**
 * What a sender offers as a way out, read off its own headers.
 *
 * `one-click` is RFC 8058: an https target AND `List-Unsubscribe-Post: List-Unsubscribe=One-Click` — the one kind
 * `gmail unsubscribe` performs (`./unsubscribe.ts`, which also reads a target written without brackets). `link` is an
 * https target without that promise, so following it opens a page. `mailto` is an address to write to, which from
 * here is a SEND under the owner's name. `none` is a sender that offers nothing — archive is the only lever.
 */
export type GmailUnsubscribeKind = "one-click" | "link" | "mailto" | "none";

/** One inbox message as a triage group carries it — ids, time, read state and subject, never a body. */
export interface GmailTriageEntry {
  readonly id: string;
  readonly threadId: string;
  /** When Gmail received it (`internalDate`) — for ordering and a card's span, never to select what is acted on. */
  readonly receivedAtIso: string | undefined;
  readonly unread: boolean;
  readonly subject: string | undefined;
}

/** Local-part fragments that mark an address nobody reads replies to, compared with separators removed. */
const AUTOMATED_LOCAL_PARTS: readonly string[] = [
  "noreply",
  "donotreply",
  "notification",
  "notify",
  "alert",
  "mailerdaemon",
  "bounce",
];

/** The separator Google Groups puts between the original sender and the group in a relayed display name. */
const RELAY_SEPARATOR = " via ";

/**
 * Split a Google Group relay's display name into the original sender and the group. Pure, by index — a display
 * name is text anyone who can send mail chooses, and a pattern over it is what the `redos-check` gate refuses.
 *
 * @param display the display name, outer double quotes already removed
 * @returns both halves, or undefined when the name is not a relay's
 */
export function splitRelayName({ display }: { display: string }): { original: string; group: string } | undefined {
  const at = display.indexOf(RELAY_SEPARATOR);
  if (at <= 0) {
    return undefined;
  }
  const original = display.slice(0, at).trim().replace(/^'/, "").replace(/'$/, "").trim();
  const group = display.slice(at + RELAY_SEPARATOR.length).trim();
  if (original.length === 0 || group.length === 0) {
    return undefined;
  }
  return { group, original };
}

/**
 * What a sender's `List-Unsubscribe` pair offers. Pure.
 *
 * @param listUnsubscribe the `List-Unsubscribe` value, when present
 * @param listUnsubscribePost the `List-Unsubscribe-Post` value, when present
 * @returns the strongest way out the headers promise
 */
export function unsubscribeKindOf({
  listUnsubscribe,
  listUnsubscribePost,
}: {
  listUnsubscribe: string | undefined;
  listUnsubscribePost: string | undefined;
}): GmailUnsubscribeKind {
  if (listUnsubscribe === undefined) {
    return "none";
  }
  const targets = listUnsubscribeTargets({ value: listUnsubscribe });
  const https = targets.https.length > 0;
  if (https && promisesOneClick({ value: listUnsubscribePost })) {
    return "one-click";
  }
  if (https) {
    return "link";
  }
  if (targets.mailto.length > 0) {
    return "mailto";
  }
  return "none";
}

/**
 * Whether an address, or the list headers beside it, mark mail sent on a schedule rather than written to the owner. Pure.
 *
 * @param address the lower-cased `From` address
 * @param listed whether the message carried `List-Id` or `List-Unsubscribe`
 * @returns true for a sender whose mail is a notification
 */
export function isAutomatedSender({ address, listed }: { address: string; listed: boolean }): boolean {
  if (listed) {
    return true;
  }
  const local = address.split("@")[0]!.replace(/[-_.+]/g, "");
  return AUTOMATED_LOCAL_PARTS.some((fragment) => local.includes(fragment));
}

/** The bare list id inside a `List-Id` value (`"Name" <id>`), lower-cased. */
function bareListId({ value }: { value: string | undefined }): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  const open = value.lastIndexOf("<");
  const close = value.lastIndexOf(">");
  const bare = open !== -1 && close > open ? value.slice(open + 1, close) : value;
  const trimmed = bare.trim().toLowerCase();
  return trimmed.length === 0 ? undefined : trimmed;
}

/** One message reduced to what grouping reads, or undefined when it has no id or no usable `From`. */
export interface KeyedMessage {
  readonly key: string;
  readonly sender: string;
  readonly address: string;
  readonly relayedBy: string | undefined;
  readonly listId: string | undefined;
  readonly automated: boolean;
  /** Whether it came through a list its members post to (RFC 2369 `List-Post`, other than `NO`). */
  readonly discussion: boolean;
  readonly unsubscribe: GmailUnsubscribeKind;
  readonly entry: GmailTriageEntry;
}

/**
 * Key one message. Pure.
 *
 * @param message the message as a `metadata` fetch returned it
 * @returns the keyed message, or undefined when it carries no id, no thread or no `From` address
 */
export function keyTriageMessage({ message }: { message: GmailMessage }): KeyedMessage | undefined {
  const headers = message.payload?.headers;
  const from = getHeader({ headers, name: "From" });
  const address = senderAddress({ header: from });
  if (typeof message.id !== "string" || typeof message.threadId !== "string" || address === undefined) {
    return undefined;
  }
  const listIdHeader = getHeader({ headers, name: "List-Id" });
  const listUnsubscribe = getHeader({ headers, name: "List-Unsubscribe" });
  const listPost = getHeader({ headers, name: "List-Post" });
  const name = senderName({ header: from });
  const relay = name === undefined ? undefined : splitRelayName({ display: name });
  let sender = address;
  if (relay !== undefined) {
    sender = relay.original;
  } else if (name !== undefined) {
    sender = name;
  }
  return {
    address,
    automated: isAutomatedSender({ address, listed: listIdHeader !== undefined || listUnsubscribe !== undefined }),
    // RFC 2369 spells an announce-only list `List-Post: NO`, optionally followed by a comment.
    discussion: listPost !== undefined && !listPost.trim().toUpperCase().startsWith("NO"),
    entry: {
      id: message.id,
      receivedAtIso: sentAtIso({ internalDate: message.internalDate }),
      subject: getHeader({ headers, name: "Subject" }),
      threadId: message.threadId,
      unread: message.labelIds?.includes("UNREAD") === true,
    },
    key: relay === undefined ? `from:${address}` : `relay:${address}:${relay.original.toLowerCase()}`,
    listId: bareListId({ value: listIdHeader }),
    relayedBy: relay?.group,
    sender,
    unsubscribe: unsubscribeKindOf({
      listUnsubscribe,
      listUnsubscribePost: getHeader({ headers, name: "List-Unsubscribe-Post" }),
    }),
  };
}
