/**
 * The readers for `slopweaver gmail card-mail <slug> --json` and its `--message <id>` form — the mail an inbox-triage
 * card pinned, read from the copy stored beside the pin (the owner sees the message someone already sent, since a steer given without knowing what is in the email may be wrong).
 *
 * The ENVELOPE is strict, as every reader here is: a document that is not the verb's own reads as NOT MEASURED, never
 * as a card drawn with a message missing. The headers a message may lack — a sender, a date, a subject — are `null`
 * on the wire and read as absent, never invented.
 */

import { type Bag, bags, bool, isBag, nullableStr, num, str, strings, sub } from "../../lib/bag";

/** One pinned message's headers, as a folded card lists it; `gone` is pinned, but Gmail no longer had it. */
export type CardMailHeader =
  | {
      readonly kind: "message";
      readonly id: string;
      readonly from: string | undefined;
      readonly to: readonly string[];
      readonly cc: readonly string[];
      readonly receivedAtIso: string | undefined;
      readonly subject: string | undefined;
    }
  | { readonly kind: "gone"; readonly id: string };

/** Every pinned message's headers. */
export interface CardMailIndex {
  readonly slug: string;
  readonly storedAtIso: string;
  readonly pinnedCount: number;
  /** Pinned but not stored — only a card pinned before pins were capped at the stored count has any. */
  readonly omittedCount: number;
  readonly mails: readonly CardMailHeader[];
}

/** The one body a message is drawn with. */
export type CardMailBody =
  | {
      readonly kind: "html";
      readonly document: string;
      readonly remoteImagesBlocked: number;
      readonly truncated: boolean;
    }
  | { readonly kind: "text"; readonly text: string; readonly truncated: boolean }
  | { readonly kind: "none"; readonly truncated: boolean };

/** A header's three nullable fields, or `undefined` when one is the wrong type. */
function nullableHeaders({
  row,
}: {
  row: Bag;
}): { from: string | undefined; receivedAtIso: string | undefined; subject: string | undefined } | undefined {
  const from = nullableStr({ bag: row, key: "from" });
  const receivedAtIso = nullableStr({ bag: row, key: "receivedAtIso" });
  const subject = nullableStr({ bag: row, key: "subject" });
  if (from === false || receivedAtIso === false || subject === false) {
    return undefined;
  }
  return { from, receivedAtIso, subject };
}

/** One header row, or `undefined` when its envelope will not read. */
function headerOf({ row }: { row: Bag }): CardMailHeader | undefined {
  const id = str({ bag: row, key: "id" });
  const kind = str({ bag: row, key: "kind" });
  if (id === undefined) {
    return undefined;
  }
  if (kind === "gone") {
    return { id, kind: "gone" };
  }
  const to = strings({ bag: row, key: "to" });
  const cc = strings({ bag: row, key: "cc" });
  const nullable = nullableHeaders({ row });
  if (kind !== "message" || to === undefined || cc === undefined || nullable === undefined) {
    return undefined;
  }
  return { cc, id, kind: "message", to, ...nullable };
}

/**
 * Read a `gmail card-mail <slug> --json` document.
 *
 * @param payload the parsed document
 * @returns every header, or `undefined` when the document is not the verb's own
 */
export function readCardMailIndex({ payload }: { payload: unknown }): CardMailIndex | undefined {
  if (!isBag(payload) || num({ bag: payload, key: "schemaVersion" }) !== 1) {
    return undefined;
  }
  const slug = str({ bag: payload, key: "slug" });
  const storedAtIso = str({ bag: payload, key: "storedAtIso" });
  const pinnedCount = num({ bag: payload, key: "pinnedCount" });
  const omittedCount = num({ bag: payload, key: "omittedCount" });
  const rows = bags({ bag: payload, key: "mails" });
  if (
    slug === undefined ||
    storedAtIso === undefined ||
    pinnedCount === undefined ||
    omittedCount === undefined ||
    rows === undefined
  ) {
    return undefined;
  }
  const mails = rows.map((row) => headerOf({ row }));
  if (mails.some((mail) => mail === undefined)) {
    return undefined;
  }
  return { mails: mails.filter((mail) => mail !== undefined), omittedCount, pinnedCount, slug, storedAtIso };
}

/** What a card's mail read answers: the stored headers, or that the card pinned nothing and has no mail to draw. */
export type CardMailIndexAnswer =
  { readonly kind: "stored"; readonly index: CardMailIndex } | { readonly kind: "unpinned"; readonly slug: string };

/**
 * Read what `gmail card-mail <slug> --json` printed: the index, or its `pinned: false` document for a board row whose
 * slug starts `inbox-triage-` with no pin behind it.
 *
 * @param payload the parsed document
 * @param slug the card the read was for, which the document must be about, so one card's answer never hides another's
 * @returns the answer, or `undefined` when the document is neither of the verb's own, or is about another card
 */
export function readCardMailIndexAnswer({
  payload,
  slug,
}: {
  payload: unknown;
  slug: string;
}): CardMailIndexAnswer | undefined {
  if (
    isBag(payload) &&
    num({ bag: payload, key: "schemaVersion" }) === 1 &&
    bool({ bag: payload, key: "pinned" }) === false
  ) {
    return str({ bag: payload, key: "slug" }) === slug ? { kind: "unpinned", slug } : undefined;
  }
  const index = readCardMailIndex({ payload });
  if (index === undefined || index.slug !== slug) {
    return undefined;
  }
  return { index, kind: "stored" };
}

/** The body object off one message document, or `undefined` when it will not read. */
function bodyOf({ body }: { body: Bag }): CardMailBody | undefined {
  const kind = str({ bag: body, key: "kind" });
  const truncated = bool({ bag: body, key: "truncated" });
  if (truncated === undefined) {
    return undefined;
  }
  if (kind === "html") {
    const document = str({ bag: body, key: "document" });
    const remoteImagesBlocked = num({ bag: body, key: "remoteImagesBlocked" });
    if (document === undefined || remoteImagesBlocked === undefined) {
      return undefined;
    }
    return { document, kind, remoteImagesBlocked, truncated };
  }
  if (kind === "text") {
    const text = str({ bag: body, key: "text" });
    return text === undefined ? undefined : { kind, text, truncated };
  }
  if (kind === "none") {
    return { kind, truncated };
  }
  return undefined;
}

/**
 * Read a `gmail card-mail <slug> --message <id> --json` document.
 *
 * @param payload the parsed document
 * @param id the message id the card asked for, which the document must be about
 * @returns that message's body, or `undefined` when the document is not the verb's own or is about another message
 */
export function readCardMailBody({ payload, id }: { payload: unknown; id: string }): CardMailBody | undefined {
  if (!isBag(payload) || num({ bag: payload, key: "schemaVersion" }) !== 1) {
    return undefined;
  }
  const header = sub({ bag: payload, key: "header" });
  const body = sub({ bag: payload, key: "body" });
  if (header === undefined || body === undefined || str({ bag: header, key: "id" }) !== id) {
    return undefined;
  }
  return bodyOf({ body });
}
