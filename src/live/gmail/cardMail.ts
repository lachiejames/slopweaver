/**
 * The mail a triage card pinned, kept beside the pin so the Queue can draw it inside the card. The owner cannot tell
 * from a notice card what the notice said, and a steer given without the mail in view can be the wrong one.
 *
 * `gmail triage --key <k> --pin <slug>` fetches the pinned messages in full and writes this file BEFORE it writes the
 * pin (`../../cli/commands/gmail/triageRun.ts`), so a card is never registered without its mail. A card pinned before
 * this existed is backfilled by `gmail card-mail <slug> --fetch`. The Queue then reads it through `gmail card-mail
 * <slug> --json`, which never touches Gmail.
 *
 * What is kept, and why each bound:
 *
 * - **The RAW alternatives**, `text/html` and `text/plain` as the sender wrote them, never a sanitised copy. Both hold
 *   the same private content, so raw is no wider an exposure — and sanitising on every READ (`./cardMailRender.ts`)
 *   means a sanitiser fix reaches every stored mail without a re-fetch.
 * - **At most {@link MAX_CARD_MAIL_MESSAGES} messages**, and `gmail triage --pin` never pins more, so a card acts on
 *   exactly the mail it draws; the group's older messages stay in the inbox for the next reading. Only a pin written
 *   before that cap can hold more, and then the card says how many it does not draw.
 * - **Each alternative cut at `MAX_CARD_MAIL_ALTERNATIVE_BYTES`** on a UTF-8 boundary, and flagged when it was
 *   (`./cardMailBody.ts`, which also finds where a `full` message keeps its two bodies).
 *
 * PRIVATE and UNREDACTED, like `attachments` beside it: `0600` in a directory tightened to `0700` on every write, and
 * classed `scratch`, so it stays on the machine that read it. Never copied into a card's text, a commit, a pull
 * request or a fixture (`docs/security/mail-boundary.md`).
 *
 * The pin and this file are two writes, not one transaction. What makes that safe is that a read checks this file
 * against the pin by CONTENT — slug, key and ids — not by which process wrote it, so a snapshot either is the pinned
 * mail or is refused with `gmail card-mail <slug> --fetch` as the repair.
 */
import { chmodSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import type { IngestError } from "../../lib/ingestError.js";
import { err, ok, type Result } from "../../lib/result.js";
import { safeFs } from "../../lib/safeBoundary.js";
import { safeJsonParse, safeJsonStringify } from "../../lib/safeJson.js";
import { ensureDirectory, writeFileAtomic } from "../../lib/writeAtomic.js";
import { stateHomePaths } from "../../stateHome.js";
import {
  MAX_CARD_MAIL_ALTERNATIVE_BYTES,
  type ResolvedCardMailAlternative,
  storedAlternative,
} from "./cardMailBody.js";
import { type GmailMessage, getHeader, sentAtIso, splitAddresses } from "./parse.js";
import type { GmailTriageCard } from "./triageCards.js";

/** The most messages one card's snapshot holds. A Queue card is read, not scrolled through. */
export const MAX_CARD_MAIL_MESSAGES = 20;

/** One message's two bodies as the sender wrote them, each cut at the byte cap. */
interface StoredCardMailBody {
  readonly html: string | null;
  readonly text: string | null;
  readonly htmlTruncated: boolean;
  readonly textTruncated: boolean;
}

/** One pinned message as the card draws it. */
export interface StoredCardMailMessage {
  readonly kind: "message";
  readonly id: string;
  readonly threadId: string;
  readonly from: string | null;
  readonly to: readonly string[];
  readonly cc: readonly string[];
  /** When Gmail received it (`internalDate`) — not the sender-written `Date:` header. */
  readonly receivedAtIso: string | null;
  readonly subject: string | null;
  readonly body: StoredCardMailBody;
}

/**
 * A pinned id Gmail no longer has (a 404 on the read) — deleted, or moved out of reach since the reading. Kept as an
 * entry rather than failing the capture, so one vanished message does not stop the card the rest of the group needs,
 * and the card still says the pin holds it.
 */
export interface StoredCardMailGone {
  readonly kind: "gone";
  readonly id: string;
}

/** One card's stored mail. */
export interface CardMailStore {
  readonly schemaVersion: 1;
  readonly slug: string;
  readonly key: string;
  readonly storedAtIso: string;
  /** How many ids the pin holds. */
  readonly pinnedCount: number;
  /** How many of them are pinned but not stored — past {@link MAX_CARD_MAIL_MESSAGES}. */
  readonly omittedCount: number;
  readonly mails: readonly (StoredCardMailMessage | StoredCardMailGone)[];
}

const BODY_SCHEMA = z.strictObject({
  html: z.string().max(MAX_CARD_MAIL_ALTERNATIVE_BYTES).nullable(),
  htmlTruncated: z.boolean(),
  text: z.string().max(MAX_CARD_MAIL_ALTERNATIVE_BYTES).nullable(),
  textTruncated: z.boolean(),
});

const MESSAGE_SCHEMA = z.strictObject({
  body: BODY_SCHEMA,
  cc: z.array(z.string()),
  from: z.string().nullable(),
  id: z.string().min(1),
  kind: z.literal("message"),
  receivedAtIso: z.iso.datetime().nullable(),
  subject: z.string().nullable(),
  threadId: z.string().min(1),
  to: z.array(z.string()),
});

const GONE_SCHEMA = z.strictObject({ id: z.string().min(1), kind: z.literal("gone") });

const STORE_SCHEMA = z.strictObject({
  key: z.string().min(1),
  mails: z.array(z.discriminatedUnion("kind", [MESSAGE_SCHEMA, GONE_SCHEMA])).max(MAX_CARD_MAIL_MESSAGES),
  omittedCount: z.number().int().min(0),
  pinnedCount: z.number().int().min(1),
  schemaVersion: z.literal(1),
  slug: z.string().min(1),
  storedAtIso: z.string().min(1),
});

/** No mail is stored for that card — it was pinned before cards kept their mail, or the slug is wrong. */
interface CardMailNotStoredError {
  readonly code: "CARD_MAIL_NOT_STORED";
  readonly message: string;
  readonly slug: string;
}

/** The file is there and is not a card's mail. */
interface CardMailMalformedError {
  readonly code: "CARD_MAIL_MALFORMED";
  readonly message: string;
  readonly slug: string;
}

/** The file is a card's mail, but not the mail THIS pin holds. */
interface CardMailPinMismatchError {
  readonly code: "CARD_MAIL_PIN_MISMATCH";
  readonly message: string;
  readonly slug: string;
  readonly why: string;
}

/** The filesystem refused the read or the write. */
interface CardMailIoError {
  readonly code: "CARD_MAIL_IO";
  readonly message: string;
  readonly cause: IngestError;
}

/** Every way reading or writing a card's stored mail fails. */
export type CardMailStoreError =
  CardMailNotStoredError | CardMailMalformedError | CardMailPinMismatchError | CardMailIoError;

/** How to raise one. */
export const CardMailStoreErrors = {
  io: ({ cause }: { cause: IngestError }): CardMailIoError => ({ cause, code: "CARD_MAIL_IO", message: cause.message }),
  malformed: ({ slug }: { slug: string }): CardMailMalformedError => ({
    code: "CARD_MAIL_MALFORMED",
    message: `the stored mail for card ${slug} is not a card's mail — re-fetch it with gmail card-mail ${slug} --fetch`,
    slug,
  }),
  notStored: ({ slug }: { slug: string }): CardMailNotStoredError => ({
    code: "CARD_MAIL_NOT_STORED",
    message: `no stored mail for ${slug} — run slopweaver gmail card-mail ${slug} --fetch`,
    slug,
  }),
  pinMismatch: ({ slug, why }: { slug: string; why: string }): CardMailPinMismatchError => ({
    code: "CARD_MAIL_PIN_MISMATCH",
    message: `the stored mail for card ${slug} is not what its pin holds (${why}) — re-fetch it with gmail card-mail ${slug} --fetch`,
    slug,
    why,
  }),
} as const;

/** A header absent by design, as the stored copy records it: `null`, so a reader sees "none" rather than a lost key. */
function storedAsNull({ value }: { value: string | undefined }): string | null {
  if (value === undefined) {
    return null;
  }
  return value;
}

/**
 * One Gmail message, fetched in `full` format, as a card stores it; undefined when it carries no id or thread id —
 * the two every other verb addresses it by, so a message without them cannot be drawn as the one pinned.
 *
 * @param message the message exactly as Gmail returned it
 * @param html the HTML alternative, already resolved from `cardMailBodySources`
 * @param text the plain-text alternative, resolved the same way
 * @returns the stored shape, or undefined when it is not addressable
 */
export function storedCardMailMessageOf({
  message,
  html,
  text,
}: {
  message: GmailMessage;
  html: ResolvedCardMailAlternative;
  text: ResolvedCardMailAlternative;
}): StoredCardMailMessage | undefined {
  const { id, threadId } = message;
  if (typeof id !== "string" || id.length === 0 || typeof threadId !== "string" || threadId.length === 0) {
    return undefined;
  }
  const headers = message.payload?.headers;
  const keptHtml = storedAlternative({ resolved: html });
  const keptText = storedAlternative({ resolved: text });
  // A sender, a date and a subject are each absent BY DESIGN on some real mail — a bounce, a draft-shaped notice —
  // and the stored copy says so as `null`, which the card draws as "no sender"/"no date"/"(no subject)".
  const from = getHeader({ headers, name: "From" });
  const receivedAtIso = sentAtIso({ internalDate: message.internalDate });
  const subject = getHeader({ headers, name: "Subject" });
  return {
    body: {
      html: keptHtml.value,
      htmlTruncated: keptHtml.truncated,
      text: keptText.value,
      textTruncated: keptText.truncated,
    },
    cc: splitAddresses({ header: getHeader({ headers, name: "Cc" }) }),
    from: storedAsNull({ value: from }),
    id,
    kind: "message",
    receivedAtIso: storedAsNull({ value: receivedAtIso }),
    subject: storedAsNull({ value: subject }),
    threadId,
    to: splitAddresses({ header: getHeader({ headers, name: "To" }) }),
  };
}

/**
 * The pinned ids a card's snapshot stores: the first {@link MAX_CARD_MAIL_MESSAGES}, newest first as the pin holds them.
 *
 * @param pin the card's pin
 * @returns the ids to fetch and store
 */
export function cardMailSelection({ pin }: { pin: GmailTriageCard }): readonly string[] {
  return pin.ids.slice(0, MAX_CARD_MAIL_MESSAGES);
}

/** Why a stored snapshot is not the mail this pin holds, or undefined when it is. */
function cardMailMismatch({ store, pin }: { store: CardMailStore; pin: GmailTriageCard }): string | undefined {
  if (store.slug !== pin.slug) {
    return `stored for ${store.slug}`;
  }
  if (store.key !== pin.key) {
    return `stored for key ${store.key}, pinned for ${pin.key}`;
  }
  if (store.pinnedCount !== pin.ids.length) {
    return `stored over ${String(store.pinnedCount)} pinned id(s), the pin holds ${String(pin.ids.length)}`;
  }
  if (store.omittedCount !== store.pinnedCount - store.mails.length) {
    return "its counts disagree";
  }
  const stored = store.mails.map((mail) => mail.id);
  const selected = cardMailSelection({ pin });
  if (stored.length !== selected.length || stored.some((id, at) => id !== selected[at])) {
    return "it holds other messages than the pin's first ones";
  }
  return undefined;
}

/** The file one card's mail lives in. */
function cardMailPath({ home, slug }: { home: string; slug: string }): string {
  return join(stateHomePaths({ home }).live.gmail.cardMail, `${slug}.json`);
}

/**
 * Replace one card's stored mail, atomically: a failed write leaves the previous file standing.
 *
 * @param store the snapshot to write; its slug names the file
 * @param home the state home
 * @returns the path written, or why nothing was
 */
export function writeCardMailStore({
  store,
  home,
}: {
  store: CardMailStore;
  home: string;
}): Result<{ readonly path: string }, CardMailStoreError> {
  const directory = stateHomePaths({ home }).live.gmail.cardMail;
  const path = cardMailPath({ home, slug: store.slug });
  const contents = `${safeJsonStringify({ label: "gmail card mail", value: store })}\n`;
  const written = safeFs({
    execute: () => {
      ensureDirectory({ directory });
      chmodSync(directory, 0o700);
      writeFileAtomic({ contents, fileMode: 0o600, path });
      return { path };
    },
    operation: "writeCardMailStore",
    path,
  });
  if (written.isErr()) {
    return err(CardMailStoreErrors.io({ cause: written.error }));
  }
  return ok(written.value);
}

/**
 * Remove one card's stored mail — what `gmail triage --pin` does when the pin it captured for could not be written,
 * so private mail is not left behind a card that never stood. Absent already is success.
 *
 * @param slug the card whose mail to remove
 * @param home the state home
 * @returns nothing, or why the file could not be removed
 */
export function removeCardMailStore({ slug, home }: { slug: string; home: string }): Result<void, CardMailStoreError> {
  const path = cardMailPath({ home, slug });
  const removed = safeFs({
    execute: () => {
      rmSync(path, { force: true });
    },
    operation: "removeCardMailStore",
    path,
  });
  if (removed.isErr()) {
    return err(CardMailStoreErrors.io({ cause: removed.error }));
  }
  return ok(undefined);
}

/**
 * Read one card's stored mail and check it is the mail its pin holds.
 *
 * @param pin the card's pin, read first by the caller
 * @param home the state home
 * @returns the snapshot, or which of absent, malformed, mismatched or unreadable it was
 */
export function readCardMailStore({
  pin,
  home,
}: {
  pin: GmailTriageCard;
  home: string;
}): Result<CardMailStore, CardMailStoreError> {
  const path = cardMailPath({ home, slug: pin.slug });
  const text = safeFs({ execute: () => readFileSync(path, "utf8"), operation: "readCardMailStore", path });
  if (text.isErr()) {
    if (text.error.code === "ENOENT") {
      return err(CardMailStoreErrors.notStored({ slug: pin.slug }));
    }
    return err(CardMailStoreErrors.io({ cause: text.error }));
  }
  const parsed = safeFs({
    execute: () => safeJsonParse({ label: "gmail card mail", text: text.value }),
    operation: "readCardMailStore",
    path,
  });
  if (parsed.isErr()) {
    return err(CardMailStoreErrors.malformed({ slug: pin.slug }));
  }
  const store = STORE_SCHEMA.safeParse(parsed.value);
  if (!store.success) {
    return err(CardMailStoreErrors.malformed({ slug: pin.slug }));
  }
  const why = cardMailMismatch({ pin, store: store.data });
  if (why !== undefined) {
    return err(CardMailStoreErrors.pinMismatch({ slug: pin.slug, why }));
  }
  return ok(store.data);
}
