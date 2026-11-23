/**
 * PURE projections of a card's stored mail into what the Queue draws, in two reads so a card never carries every body
 * at once:
 *
 * - **the index** — every pinned message's headers and no body, what a folded card lists;
 * - **one message** — that message's ONE body, read when its row is opened: the sanitised HTML when the sender wrote
 *   one that shows anything, else the plain text, else none.
 *
 * Sanitising happens here on every read (`./mailHtml.ts`), so a sanitiser fix reaches mail stored before it, and the
 * raw alternatives never leave this module.
 */
import type { CardMailStore, StoredCardMailMessage } from "./cardMail.js";
import { sanitizeMailHtml } from "./mailHtml.js";

/** The one body a card draws for a message; `none` is `truncated` when there was one, too large to keep. */
export type RenderedCardMailBody =
  | {
      readonly kind: "html";
      /** A whole inert document for an iframe's `srcdoc`. */
      readonly document: string;
      readonly remoteImagesBlocked: number;
      readonly truncated: boolean;
    }
  | { readonly kind: "text"; readonly text: string; readonly truncated: boolean }
  | { readonly kind: "none"; readonly truncated: boolean };

/** One pinned message's headers, as a folded card lists it. */
type CardMailHeader =
  | {
      readonly kind: "message";
      readonly id: string;
      readonly threadId: string;
      readonly from: string | null;
      readonly to: readonly string[];
      readonly cc: readonly string[];
      readonly receivedAtIso: string | null;
      readonly subject: string | null;
    }
  | { readonly kind: "gone"; readonly id: string };

/** What `gmail card-mail <slug> --json` prints: every stored message's headers, no body. */
export interface CardMailIndex {
  readonly schemaVersion: 1;
  readonly slug: string;
  readonly key: string;
  readonly storedAtIso: string;
  readonly pinnedCount: number;
  readonly omittedCount: number;
  readonly mails: readonly CardMailHeader[];
}

/**
 * What `gmail card-mail <slug> --json` prints, with exit 3, for a card that pinned nothing: a board row whose slug
 * starts `inbox-triage-` without a pin behind it has no mail to draw, which is an answer, not a failed read.
 */
export interface CardMailUnpinned {
  readonly schemaVersion: 1;
  readonly slug: string;
  readonly pinned: false;
}

/** What `gmail card-mail <slug> --message <id> --json` prints: one message's headers and its one body. */
export interface RenderedCardMail {
  readonly schemaVersion: 1;
  readonly slug: string;
  readonly header: CardMailHeader & { readonly kind: "message" };
  readonly body: RenderedCardMailBody;
}

/** One stored message's headers. */
function headerOf({ mail }: { mail: StoredCardMailMessage }): CardMailHeader & { readonly kind: "message" } {
  return {
    cc: mail.cc,
    from: mail.from,
    id: mail.id,
    kind: "message",
    receivedAtIso: mail.receivedAtIso,
    subject: mail.subject,
    threadId: mail.threadId,
    to: mail.to,
  };
}

/**
 * The body a message is drawn with: HTML only when it SHOWS something once sanitised, since a body that was a
 * tracking pixel and layout would otherwise hide a readable plain-text alternative behind a blank page.
 */
function renderedBodyOf({ mail }: { mail: StoredCardMailMessage }): RenderedCardMailBody {
  const { html, text, htmlTruncated, textTruncated } = mail.body;
  if (html !== null) {
    const sanitized = sanitizeMailHtml({ html });
    if (sanitized.hasVisibleContent) {
      return {
        document: sanitized.document,
        kind: "html",
        remoteImagesBlocked: sanitized.remoteImagesBlocked,
        truncated: htmlTruncated,
      };
    }
  }
  if (text !== null && text.trim().length > 0) {
    return { kind: "text", text, truncated: textTruncated };
  }
  return { kind: "none", truncated: htmlTruncated || textTruncated };
}

/**
 * The headers a folded card lists, for every message the store holds.
 *
 * @param store a snapshot already checked against its pin
 * @returns the index, with no body in it
 */
export function renderCardMailIndex({ store }: { store: CardMailStore }): CardMailIndex {
  return {
    key: store.key,
    mails: store.mails.map((mail) => (mail.kind === "gone" ? mail : headerOf({ mail }))),
    omittedCount: store.omittedCount,
    pinnedCount: store.pinnedCount,
    schemaVersion: 1,
    slug: store.slug,
    storedAtIso: store.storedAtIso,
  };
}

/**
 * One stored message with its sanitised body; undefined when the store holds no readable message by that id — not
 * pinned, past the cap, or gone from Gmail before it was captured.
 *
 * @param store a snapshot already checked against its pin
 * @param id the Gmail message id to draw
 * @returns the message, or undefined
 */
export function renderCardMailMessage({
  store,
  id,
}: {
  store: CardMailStore;
  id: string;
}): RenderedCardMail | undefined {
  const mail = store.mails.find((candidate) => candidate.id === id);
  if (mail === undefined || mail.kind === "gone") {
    return undefined;
  }
  return { body: renderedBodyOf({ mail }), header: headerOf({ mail }), schemaVersion: 1, slug: store.slug };
}
