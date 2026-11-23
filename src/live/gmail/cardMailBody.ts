/**
 * Where a pinned message's two bodies are, and how much of each a card keeps — the half of `./cardMail.ts` that reads
 * a Gmail `full` message rather than the card's own file.
 *
 * A large body arrives from a `full` read as an attachment id with no inline bytes, so reading only `body.data` would
 * draw a message Gmail plainly has as bodiless; `./cardMailCapture.ts` fetches one of those when its declared size is
 * within {@link MAX_CARD_MAIL_FETCHED_BODY_BYTES}, and records it as cut otherwise.
 */
import type { GmailMessage, GmailPart } from "./parse.js";

/** The most bytes one alternative of one message keeps — so a card's file is bounded at about 20 MiB. */
export const MAX_CARD_MAIL_ALTERNATIVE_BYTES = 512 * 1024;

/**
 * The most DECODED bytes a body Gmail returns as an attachment (`body.attachmentId`, no inline `data`) may declare and
 * still be fetched. Past it the body is recorded as cut with nothing kept, rather than pulling a large part only to
 * keep its first {@link MAX_CARD_MAIL_ALTERNATIVE_BYTES}.
 */
export const MAX_CARD_MAIL_FETCHED_BODY_BYTES = 4 * 1024 * 1024;

/** One alternative after resolution: absent, its text, or declared too large to fetch. */
export type ResolvedCardMailAlternative =
  { readonly kind: "absent" } | { readonly kind: "text"; readonly text: string } | { readonly kind: "too-large" };

/** Where one alternative's bytes are: inline in the `full` read, behind an attachment id, or nowhere. */
export type CardMailBodySource =
  | { readonly kind: "absent" }
  | { readonly kind: "inline"; readonly data: string }
  | { readonly kind: "attachment"; readonly attachmentId: string; readonly declaredBytes: number | undefined };

/**
 * Text cut to at most `maxBytes` of UTF-8, never through the middle of a character.
 *
 * @param text the decoded alternative
 * @param maxBytes the byte cap
 * @returns the kept text and whether anything was cut
 */
export function truncateUtf8({ text, maxBytes }: { text: string; maxBytes: number }): {
  readonly text: string;
  readonly truncated: boolean;
} {
  const bytes = Buffer.from(text, "utf8");
  if (bytes.length <= maxBytes) {
    return { text, truncated: false };
  }
  let end = maxBytes;
  // A continuation byte is 10xxxxxx: step back to the lead byte of the character the cap falls inside.
  while (end > 0 && (bytes[end]! & 0xc0) === 0x80) {
    end -= 1;
  }
  return { text: bytes.subarray(0, end).toString("utf8"), truncated: true };
}

/** Where one MIME part's own bytes are. */
function sourceOfPart({ part }: { part: GmailPart }): CardMailBodySource {
  const data = part.body?.data;
  if (typeof data === "string" && data.length > 0) {
    return { data, kind: "inline" };
  }
  const attachmentId = part.body?.attachmentId;
  if (typeof attachmentId === "string" && attachmentId.length > 0) {
    const size = part.body?.size;
    return { attachmentId, declaredBytes: typeof size === "number" ? size : undefined, kind: "attachment" };
  }
  return { kind: "absent" };
}

/** Whether a part is a body alternative of `mimeType` rather than a file attached to the mail. */
function isBodyPart({ part, mimeType }: { part: GmailPart; mimeType: string }): boolean {
  const named = typeof part.filename === "string" && part.filename.length > 0;
  return !named && part.mimeType === mimeType;
}

/** The first body alternative of `mimeType` in a depth-first walk, the order `extractBodies` reads in. */
function firstBodyPart({ part, mimeType }: { part: GmailPart; mimeType: string }): GmailPart | undefined {
  if (isBodyPart({ mimeType, part })) {
    return part;
  }
  // A leaf part carries no `parts` at all: there is nothing beneath it to walk.
  if (part.parts == null) {
    return undefined;
  }
  for (const nested of part.parts) {
    const found = firstBodyPart({ mimeType, part: nested });
    if (found !== undefined) {
      return found;
    }
  }
  return undefined;
}

/**
 * Where a message's HTML and plain-text bodies are; a part carrying a filename is a file attached to the mail, never
 * its body.
 *
 * @param message the message exactly as Gmail returned it in `full` format
 * @returns each alternative's source
 */
export function cardMailBodySources({ message }: { message: GmailMessage }): {
  readonly html: CardMailBodySource;
  readonly text: CardMailBodySource;
} {
  const payload = message.payload;
  if (payload == null) {
    return { html: { kind: "absent" }, text: { kind: "absent" } };
  }
  const html = firstBodyPart({ mimeType: "text/html", part: payload });
  const text = firstBodyPart({ mimeType: "text/plain", part: payload });
  return {
    html: html === undefined ? { kind: "absent" } : sourceOfPart({ part: html }),
    text: text === undefined ? { kind: "absent" } : sourceOfPart({ part: text }),
  };
}

/**
 * Decode Gmail's base64url body bytes as UTF-8 text.
 *
 * @param data the `body.data` field, or an attachment's `data`, verbatim
 * @returns the text
 */
export function decodeCardMailBody({ data }: { data: string }): string {
  return Buffer.from(data, "base64url").toString("utf8");
}

/**
 * One alternative as a card stores it: absent as `null`, cut at the cap, and flagged cut with nothing kept when it was
 * too large to fetch.
 *
 * @param resolved the alternative after `./cardMailCapture.ts` resolved its source
 * @returns the stored value and whether it was cut
 */
export function storedAlternative({ resolved }: { resolved: ResolvedCardMailAlternative }): {
  readonly value: string | null;
  readonly truncated: boolean;
} {
  if (resolved.kind === "absent") {
    return { truncated: false, value: null };
  }
  if (resolved.kind === "too-large") {
    return { truncated: true, value: null };
  }
  const cut = truncateUtf8({ maxBytes: MAX_CARD_MAIL_ALTERNATIVE_BYTES, text: resolved.text });
  return { truncated: cut.truncated, value: cut.text };
}
