/**
 * PURE parsing of what the Gmail API returns: header lookup, RFC 2047 decoding, MIME body extraction, and
 * the shape a Slopweaver Gmail read hands back. No I/O, no clock, no SDK client — every function here is
 * exercised on synthetic MIME in the unit lane, which is the half of this integration that must not need a
 * mailbox to test.
 *
 * ## Three Gmail edges this file exists to absorb
 *
 * - **Header names are case-insensitive, and Gmail echoes whatever the sender wrote.** A lookup that
 *   compares `header.name === "From"` misses a message whose sender emitted `FROM:`. It is not a rare
 *   shape — bulk senders emit all-caps headers routinely — and the failure is silent: the message parses,
 *   with no sender.
 * - **A subject is frequently RFC 2047 encoded**, so the raw header value reads as `=?UTF-8?B?…?=` rather
 *   than as text. Only the UTF-8 B and Q forms are decoded here; anything else is left verbatim rather than
 *   mangled, because a wrong decode is worse than an undecoded one a reader can still recognise.
 * - **The body is a TREE, and `text/plain` may sit several levels down** — under `multipart/mixed` wrapping
 *   a `multipart/alternative`, with attachments as siblings. The walk is depth-first and first-wins per
 *   media type, so a quoted `text/html` part deeper in the tree cannot displace the plain text above it.
 */
import { attachmentMetadata } from "./attachmentMeta.js";
import { decodeEntities, htmlToText } from "./htmlToText.js";
import { childParts, messageLabelIds } from "./omittedFields.js";

/** One Gmail message header as the API returns it. */
export interface GmailHeader {
  readonly name?: string | null;
  readonly value?: string | null;
}

/** The subset of a Gmail MIME part this file reads. Structural, so a fixture is a plain object literal. */
export interface GmailPart {
  /** Gmail's own address for this part within the message's MIME tree (`0`, `1`, `1.2`). */
  readonly partId?: string | null;
  readonly mimeType?: string | null;
  readonly filename?: string | null;
  readonly headers?: readonly GmailHeader[] | null;
  readonly body?: {
    readonly data?: string | null;
    readonly size?: number | null;
    readonly attachmentId?: string | null;
  } | null;
  readonly parts?: readonly GmailPart[] | null;
}

/** The subset of a Gmail message this file reads. */
export interface GmailMessage {
  readonly id?: string | null;
  readonly threadId?: string | null;
  readonly internalDate?: string | null;
  readonly snippet?: string | null;
  readonly labelIds?: readonly string[] | null;
  readonly payload?: GmailPart | null;
  readonly sizeEstimate?: number | null;
}

/** One attachment Gmail reported on a message, by metadata only — no bytes are ever fetched here. */
export interface GmailAttachment {
  readonly filename: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
}

/**
 * A Gmail message reduced to the fields a Slopweaver read reports.
 *
 * `sentAtIso`, `subject`, `from` and `snippet` are `string | undefined` rather than a string that may be
 * empty, and that is the honest shape rather than a defensive one: a message with no `Subject:` header does
 * not have an empty subject, it has none, and `""` is a value this code would have invented. The renderers
 * say `(no subject)` at the point of display, which is where a stand-in belongs. The house rule against
 * coalescing to `""` is what forced the distinction, and it was right to.
 */
export interface ParsedGmailMessage {
  readonly id: string;
  readonly threadId: string;
  readonly sentAtIso: string | undefined;
  readonly subject: string | undefined;
  readonly from: string | undefined;
  readonly to: readonly string[];
  readonly cc: readonly string[];
  readonly labelIds: readonly string[];
  readonly snippet: string | undefined;
  readonly body: string;
  readonly bodyFormat: "text" | "html" | "none";
  readonly attachments: readonly GmailAttachment[];
  /**
   * The absolute `href` targets of the message's HTML part, deduplicated, in document order and bounded by
   * {@link MAX_HTML_LINKS}.
   *
   * Carried separately from {@link body} because the body is the text/plain part when there is one, and a
   * plain-text alternative renders a link as its LABEL — "Open meeting notes" — with the target nowhere in
   * it. Measured on a real Gemini notes email: the plain part contained zero URLs and the HTML part
   * contained exactly one, the Google Doc holding the meeting's notes and transcript. So a projection that
   * only ever saw {@link body} could not reach the transcript at all, and nothing about that failure would
   * have looked like a failure.
   */
  readonly htmlLinks: readonly string[];
}

/**
 * How many HTML link targets are lifted off one message.
 *
 * A bound rather than a budget: the consumer is looking for ONE document link in a machine-generated
 * email, and a marketing message can carry hundreds of tracking URLs whose only effect here would be to
 * make a parsed message large. Nothing downstream stores this field, so the bound costs nothing real.
 */
export const MAX_HTML_LINKS = 50;

/**
 * Decode Gmail's URL-safe base64 body encoding.
 *
 * @param data the `body.data` field verbatim
 * @returns the decoded UTF-8 text
 */
function decodeBase64Url({ data }: { data: string }): string {
  return Buffer.from(data, "base64url").toString("utf8");
}

/**
 * Find a header's value, comparing names case-insensitively.
 *
 * @param headers the message part's header list
 * @param name the header to find
 * @returns the decoded value, or undefined when the header is absent or empty
 */
export function getHeader({
  headers,
  name,
}: {
  headers: readonly GmailHeader[] | null | undefined;
  name: string;
}): string | undefined {
  const wanted = name.toLowerCase();
  // A part with no header list carries no header of any name, so the search finds nothing and the read below
  // answers undefined, exactly as it does for a list that lacks this one.
  const found = headers?.find((header) => header.name?.toLowerCase() === wanted);
  const value = found?.value;
  if (value == null || value.length === 0) {
    return undefined;
  }
  return decodeEncodedWords({ value });
}

/** Matches one RFC 2047 encoded word: `=?charset?B|Q?text?=`. Both classes are negated, so linear. */
const ENCODED_WORD = /=\?([^?]+)\?([bBqQ])\?([^?]+)\?=/g;

/** Decode the `Q` (quoted-printable) form of an encoded word's payload. */
function decodeQEncoding({ text }: { text: string }): string {
  const bytes = text.replace(/_/g, " ").replace(/=([0-9a-fA-F]{2})/g, (_match, hex: string) => {
    return String.fromCharCode(Number.parseInt(hex, 16));
  });
  return Buffer.from(bytes, "binary").toString("utf8");
}

/**
 * The whitespace separating two ADJACENT encoded-words, which RFC 2047 § 6.2 says a reader ignores.
 *
 * Both sides are required literals, so the one quantifier between them cannot backtrack into anything —
 * the property `htmlToText` (`./htmlToText.ts`) was rewritten to obtain, applied before the fact rather
 * than after three rounds of patches.
 */
const ENCODED_WORD_GAP = /(\?=)\s+(=\?)/g;

/**
 * Decode RFC 2047 encoded words in a header value. Only UTF-8 `B` and `Q` are decoded; any other charset is
 * returned verbatim, because a wrong decode is worse than an undecoded token a reader can still recognise.
 *
 * Whitespace between two adjacent encoded-words is dropped first, per RFC 2047 § 6.2. That whitespace is a
 * FOLD — the sender split one long value across several words because a header line may not exceed 75
 * characters — and it is not part of the text. Keeping it inserted a space or a line break into the middle
 * of every long non-ASCII subject this repo read, which is a corruption that only shows up in scripts
 * needing more bytes per character than ASCII, i.e. never in the tests one writes in English. Whitespace
 * between an encoded-word and ordinary text is untouched, because there it is real.
 *
 * @param value the raw header value
 * @returns the value with every decodable encoded word replaced
 */
export function decodeEncodedWords({ value }: { value: string }): string {
  return value
    .replace(ENCODED_WORD_GAP, "$1$2")
    .replace(ENCODED_WORD, (match, charset: string, encoding: string, text: string) => {
      if (!["utf-8", "utf8"].includes(charset.toLowerCase())) {
        return match;
      }
      if (encoding.toLowerCase() === "b") {
        return Buffer.from(text, "base64").toString("utf8");
      }
      return decodeQEncoding({ text });
    });
}

/**
 * Walk a MIME tree for the first `text/plain` and the first `text/html` body.
 *
 * @param part the payload root, or a nested part during the walk
 * @returns whichever of the two bodies were found
 */
export function extractBodies({ part }: { part: GmailPart | null | undefined }): {
  text?: string;
  html?: string;
} {
  if (part == null) {
    return {};
  }
  const data = part.body?.data;
  const decoded = typeof data === "string" && data.length > 0 ? decodeBase64Url({ data }) : undefined;
  const children = childParts({ part }).map((nested) => extractBodies({ part: nested }));
  // First wins per media type, depth-first: this part's own body, then each child's in document order.
  const plain = [part.mimeType === "text/plain" ? decoded : undefined, ...children.map((child) => child.text)];
  const rich = [part.mimeType === "text/html" ? decoded : undefined, ...children.map((child) => child.html)];
  const text = plain.find((body) => body !== undefined);
  const html = rich.find((body) => body !== undefined);
  return {
    ...(text !== undefined ? { text } : {}),
    ...(html !== undefined ? { html } : {}),
  };
}

/**
 * Split an address header into individual addresses, respecting quoted display names that contain commas.
 *
 * @param header the raw `To`/`Cc` header value, or undefined when absent
 * @returns each address as written, trimmed; empty when the header is absent
 */
export function splitAddresses({ header }: { header: string | undefined }): readonly string[] {
  if (header === undefined) {
    return [];
  }
  const parts: string[] = [];
  let current = "";
  let quoted = false;
  for (const char of header) {
    if (char === '"') {
      quoted = !quoted;
    }
    if (char === "," && !quoted) {
      parts.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  parts.push(current);
  return parts.map((part) => part.trim()).filter((part) => part.length > 0);
}

/** A MIME part that is an attachment: it carries both a fetchable `attachmentId` and a non-empty filename. */
export type GmailAttachmentPart = GmailPart & {
  readonly filename: string;
  readonly body: NonNullable<GmailPart["body"]> & { readonly attachmentId: string };
};

/**
 * The one criterion for "this part is an attachment", shared by the metadata walk below and by the
 * `gmail attachment` fetch (`./attachment.ts`), so the verb that downloads a part can never disagree with
 * the read that listed it.
 *
 * @returns whether the part is an attachment
 */
export function isAttachmentPart(part: GmailPart): part is GmailAttachmentPart {
  return typeof part.body?.attachmentId === "string" && typeof part.filename === "string" && part.filename.length > 0;
}

/**
 * Collect attachment METADATA from a MIME tree. Never the bytes: an attachment's content is a separate,
 * explicitly requested fetch (`gmail attachment`), and a read verb that silently pulled megabytes of mail attachments onto disk
 * is exactly the surprise `docs/security.md` exists to prevent.
 *
 * @param part the payload root, or a nested part during the walk
 * @returns every attachment part's filename, media type and size
 */
export function extractAttachments({ part }: { part: GmailPart | null | undefined }): readonly GmailAttachment[] {
  if (part == null) {
    return [];
  }
  const here: GmailAttachment[] = isAttachmentPart(part) ? [attachmentMetadata({ part })] : [];
  const nested = childParts({ part }).flatMap((child) => extractAttachments({ part: child }));
  return [...here, ...nested];
}

/**
 * Every absolute `http`/`https` href in an HTML body, deduplicated, in document order.
 *
 * Matched with a bounded character class rather than a lazy group: `href="([^"]+)"` has exactly one way to
 * match at each position and cannot backtrack, which is what the repo's `redos-check` gate requires of a
 * pattern run over attacker-supplied text — and an email body is exactly that.
 *
 * The target is decoded by {@link decodeEntities}, the same single-pass decoder a body goes through, rather
 * than by a second sequential-replace copy. `&amp;` is the entity that matters here, because every query
 * string in an attribute is escaped that way and an API reading `&amp;` treats it as part of a value — but
 * decoding it with its own `.replaceAll` chain turns `&amp;lt;` in a link into `<` on the following pass.
 *
 * @param html the raw HTML part, when the message carried one
 * @returns the link targets, bounded by {@link MAX_HTML_LINKS}
 */
export function extractHtmlLinks({ html }: { html: string | undefined }): readonly string[] {
  if (html === undefined) {
    return [];
  }
  const seen = new Set<string>();
  for (const match of html.matchAll(/href="(https?:\/\/[^"]+)"/g)) {
    const href = match[1];
    if (href !== undefined) {
      seen.add(decodeEntities({ text: href }));
    }
    if (seen.size >= MAX_HTML_LINKS) {
      break;
    }
  }
  return [...seen];
}

/** Choose the body text and say which representation it came from. */
function chooseBody({ part }: { part: GmailPart | null | undefined }): {
  body: string;
  bodyFormat: "text" | "html" | "none";
} {
  const bodies = extractBodies({ part });
  if (bodies.text !== undefined && bodies.text.trim().length > 0) {
    return { body: bodies.text.trim(), bodyFormat: "text" };
  }
  if (bodies.html !== undefined && bodies.html.trim().length > 0) {
    return { body: htmlToText({ html: bodies.html }), bodyFormat: "html" };
  }
  return { body: "", bodyFormat: "none" };
}

/**
 * Shape one Gmail message into the form a Slopweaver read reports.
 *
 * A message with no id or no `threadId` is `undefined` rather than a partially-filled record: those two are
 * how every other verb addresses it, so a message that cannot be addressed cannot be reported.
 *
 * @param message the message as the Gmail API returned it, in `full` format
 * @returns the parsed message, or undefined when it carries no addressable identity
 */
export function parseGmailMessage({ message }: { message: GmailMessage }): ParsedGmailMessage | undefined {
  const { id, threadId } = message;
  if (typeof id !== "string" || typeof threadId !== "string") {
    return undefined;
  }
  const headers = message.payload?.headers;
  const bodies = extractBodies({ part: message.payload });
  const chosen = chooseBody({ part: message.payload });
  return {
    attachments: extractAttachments({ part: message.payload }),
    body: chosen.body,
    bodyFormat: chosen.bodyFormat,
    htmlLinks: extractHtmlLinks({ html: bodies.html }),
    cc: splitAddresses({ header: getHeader({ headers, name: "Cc" }) }),
    from: getHeader({ headers, name: "From" }),
    id,
    labelIds: messageLabelIds({ message }),
    sentAtIso: sentAtIso({ internalDate: message.internalDate }),
    // Gmail HTML-escapes its snippet, so an apostrophe arrives as `&#39;` and a downstream scan reads a bare
    // numeric entity body as an issue reference. Decoded here, once, so no consumer ever sees the escaped form.
    snippet: typeof message.snippet === "string" ? decodeEntities({ text: message.snippet }) : undefined,
    subject: getHeader({ headers, name: "Subject" }),
    threadId,
    to: splitAddresses({ header: getHeader({ headers, name: "To" }) }),
  };
}

/**
 * Convert Gmail's `internalDate` (epoch milliseconds, as a string) to an ISO instant.
 *
 * @param internalDate the raw field, which the API may omit
 * @returns the ISO instant, or undefined when there is no readable date rather than a stand-in
 */
export function sentAtIso({ internalDate }: { internalDate: string | null | undefined }): string | undefined {
  if (internalDate == null) {
    return undefined;
  }
  const epochMs = Number.parseInt(internalDate, 10);
  return Number.isFinite(epochMs) ? new Date(epochMs).toISOString() : undefined;
}
