/**
 * How an email-born card lays its mail thread out, the way Gmail lays out a conversation: the newest message the owner
 * has received drawn open, the few before it as one-line rows, everything older folded behind a count, and the
 * thread's first message kept as its opener — then the owner's unsent draft UNDER all of it, where Gmail draws one.
 *
 * Rule 7 holds as on any card: what the owner has to answer is open, and the history is one click away, never a wall.
 */
import { dateTimeFormatOf } from "./dateTimeFormat";

/** The fields the layout needs of a message — the reader's `MailMessage` satisfies it. */
export interface LaidMessage {
  readonly id: string;
  readonly draft: boolean;
}

/** How many one-line rows sit between the folded history and the open message. */
export const RECENT_ROWS = 2;

/** The thread, placed. */
export interface MailThreadLayout<M extends LaidMessage> {
  /** The thread's first message, as a one-line row — absent when it is the open one. */
  readonly opener: M | undefined;
  /** Everything between the opener and the recent rows, folded behind its count. */
  readonly folded: readonly M[];
  /** The rows just above the open message, oldest first. */
  readonly recent: readonly M[];
  /** The newest message that is not a draft — what the card is asking the owner about. */
  readonly open: M | undefined;
  /** The owner's unsent drafts on the thread, drawn open beneath it. */
  readonly drafts: readonly M[];
}

/**
 * Place a thread's messages.
 *
 * @param messages the thread, oldest first
 * @returns which message is open, which are rows, which fold, and the drafts beneath
 */
export function mailThreadLayout<M extends LaidMessage>({ messages }: { messages: readonly M[] }): MailThreadLayout<M> {
  const sent = messages.filter((message) => !message.draft);
  const drafts = messages.filter((message) => message.draft);
  const open = sent.at(-1);
  const before = sent.slice(0, -1);
  if (before.length === 0) {
    return { drafts, folded: [], open, opener: undefined, recent: [] };
  }
  const opener = before[0];
  const rest = before.slice(1);
  const cut = Math.max(0, rest.length - RECENT_ROWS);
  return { drafts, folded: rest.slice(0, cut), open, opener, recent: rest.slice(cut) };
}

/**
 * A message's one-line preview: its authored words with the line breaks run together, cut at a word near `limit`.
 *
 * @param text the authored text
 * @param limit the longest the line may run before it is cut
 * @returns the line, ending in an ellipsis when it was cut
 */
export function oneLine({ text, limit }: { text: string; limit: number }): string {
  const flat = text.replaceAll(/\s+/gu, " ").trim();
  if (flat.length <= limit) {
    return flat;
  }
  // One character past the limit, so a word ending exactly at it is kept whole.
  const space = flat.slice(0, limit + 1).lastIndexOf(" ");
  let kept = flat.slice(0, limit);
  if (space > limit / 2) {
    kept = flat.slice(0, space);
  }
  return `${kept}…`;
}

/**
 * A header field as a mail row draws it: the value, or the words saying what its absence means — never a blank.
 *
 * @param value the field as the stored copy holds it
 * @param whenAbsent what to draw for a message that carried no such header, such as "no sender"
 * @returns the text to draw
 */
export function shownOr({ value, whenAbsent }: { value: string | undefined; whenAbsent: string }): string {
  if (value === undefined) {
    return whenAbsent;
  }
  return value;
}

/**
 * The name Gmail shows for a sender: the display name of `Name <address>`, else the bare address.
 *
 * @param from the `From` header as the verb printed it
 * @returns the name to draw, or `undefined` when the message named no sender
 */
export function senderName({ from }: { from: string | undefined }): string | undefined {
  if (from === undefined) {
    return undefined;
  }
  const match = /^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/u.exec(from);
  if (match === null) {
    return from.trim();
  }
  const name = match.at(1);
  if (name !== undefined && name.length > 0) {
    return name;
  }
  return match.at(2);
}

/**
 * When a message arrived, the way Gmail's header reads it: `Mon D, YYYY, h:mm PM`. A value that is no instant reads
 * as such, since formatting an invalid date throws and would take the whole card down with it.
 *
 * @param iso the received instant as the verb printed it
 * @param timeZone the IANA zone to read it in, the reader's own as the caller resolved it
 * @returns the date to draw
 */
export function receivedAt({ iso, timeZone }: { iso: string; timeZone: string }): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) {
    return "date unreadable";
  }
  return dateTimeFormatOf({
    locale: "en-US",
    options: { day: "numeric", hour: "numeric", minute: "2-digit", month: "short", timeZone, year: "numeric" },
  }).format(at);
}
