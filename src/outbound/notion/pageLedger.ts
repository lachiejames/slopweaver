/**
 * The record of which Notion pages slopweaver created, and the at-most-once primitive under `create`.
 *
 * ## Why this is shaped differently from the Linear ledger
 *
 * Linear lets the caller CHOOSE the issue id, so its ledger keys on that id and a lost response is settled
 * by asking Linear whether that exact id exists. Notion assigns the page id server-side, so there is no id
 * to reserve and no way to ask "did the page I meant to create get created". A retried `pages.create` that
 * already landed produces a second, indistinguishable page.
 *
 * So the reservation keys on the INTENT — parent ⊕ title ⊕ rendered body — exactly as `linear issue`
 * derives its id from the intent, but here the digest names the RECORD rather than the object. The same
 * intent therefore finds its own reservation on a second run and refuses instead of publishing twice.
 *
 * Two indexes, because the two questions are different:
 *   - `intents/<digest>.json` answers "have I already tried to publish this exact thing?" (at-most-once);
 *   - `pages/<pageId>.json` answers "did I create this page, and what did I last write to it?" (ownership).
 *
 * A confirmed create writes both, so either question can be answered without scanning.
 *
 * A third file, `external-edit-overrides.jsonl`, is append-only rather than keyed: a page can be overridden
 * more than once, and each one is its own audit fact rather than a slot a second override could silently
 * replace the evidence in. See `resolveExternalEdit` (`../../cli/commands/notion/authorship.ts`) for what
 * writes to it and why.
 */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { writeFileAtomic } from "#lib/writeAtomic.js";

import { appendLines } from "../../lib/appendSeparator.js";
import { isRecord } from "../../lib/parsers.js";
import { stateHomePaths } from "../../stateHome.js";

/**
 * One FILE this tooling uploaded into Notion's own file storage and placed on a page — an image or a PDF.
 *
 * The interface, its fields and the persisted `images` key all still say image, and that is deliberate: the
 * key is written into every record already on disk, so renaming it would orphan them. Read `images` as
 * "the files the attach pass placed", and `blockId` as the `image` or `pdf` block Notion built for one.
 *
 * Recorded for AUDIT rather than for reuse, and the distinction is the decision it encodes: an `update`
 * REPLACES the page's whole content, which deletes every block including these, so `blockId` is dead the
 * moment the next update runs and the file is UPLOADED AGAIN from the local source. Re-referencing the old
 * `fileUploadId` was considered and rejected — the local file is the source of truth, a re-upload is
 * unambiguous, and an id whose attachment lifecycle Notion owns is not something to build update-safety on.
 * What this record IS good for is answering "which blocks on this page are tooling-owned files, and which
 * local file is each one".
 */
export interface PageImageRecord {
  /** The placeholder id the marker carried — stable for a given position and source. */
  readonly placeholderId: string;
  /** The path exactly as written after `file:` in the authored markdown. */
  readonly source: string;
  /** The `image` or `pdf` block Notion created, as of the write that recorded this. */
  readonly blockId: string;
  /** The `file_upload` the block references. */
  readonly fileUploadId: string;
}

/** One page slopweaver reserved, and what became of it. */
export interface PageRecord {
  /** The intent digest that reserved it — the key of the `intents` index. */
  readonly intent: string;
  /** When the intent was reserved, before the create was attempted. */
  readonly reservedIso: string;
  /** Notion's page id, present ONLY once the create was confirmed by a read-back. */
  readonly pageId?: string | undefined;
  /** The page's canonical URL, recorded so a re-publish can prove the URL was kept. */
  readonly url?: string | undefined;
  /** When the create was confirmed. Absent ⇒ the outcome is unknown, not that it failed. */
  readonly confirmedIso?: string | undefined;
  /**
   * A digest of the page's CANONICAL markdown as Notion read it back after the last confirmed write.
   *
   * Over the read-back rather than over what was sent, and that distinction is the whole check. Notion
   * normalises on ingest — a pipe table comes back as `<table>`, blank lines are dropped — so a digest of
   * the input would differ from the page on every comparison and refuse every legitimate re-publish. The
   * canonical form was MEASURED to be stable: the same source re-sent produces a byte-identical canonical
   * string, and feeding that string back produces the same one again.
   */
  readonly lastCanonicalHash?: string | undefined;
  /** The files the last attach pass placed on this page. Absent for a page that carries none. */
  readonly images?: readonly PageImageRecord[] | undefined;
  /**
   * The parent this page was last MOVED under, and when.
   *
   * Recorded for audit rather than for a decision: `move` reads the page's live parent back off the provider
   * before and after, so nothing branches on this. What it answers is the question the provider cannot —
   * "did slopweaver relocate this page, or did a person" — which is exactly the question a reader asks when
   * a document has stopped being where a colleague left it.
   */
  readonly lastParentId?: string | undefined;
  readonly movedIso?: string | undefined;
}

/** Whether this caller now holds the reservation for an intent, and when a fresh one was taken. */
export type PageReservation =
  { readonly kind: "fresh"; readonly reservedIso: string } | { readonly kind: "taken"; readonly record: PageRecord };

/** Notion ids are UUIDs; anything else must never reach a ledger filename. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Whether a string is a well-formed Notion object id.
 *
 * Notion's own ids do not pin the version nibble the way Linear's do, so this checks the layout only. It
 * still closes the hole that matters: the value is interpolated into a ledger FILENAME, and `../../x` would
 * escape the state home entirely.
 *
 * @param id the candidate id
 * @returns true iff it is a canonical dashed UUID
 */
export function isValidPageId({ id }: { id: string }): boolean {
  return UUID.test(id);
}

/**
 * The intent digest for one publish: the destination and the exact bytes, and nothing else.
 *
 * @param parentPageId the parent the page is created under — the same body under a different parent is a
 *   different intent, and collapsing them would refuse a legitimate second page
 * @param title the page title
 * @param body the rendered markdown body
 * @returns a stable hex digest, safe as a filename
 */
export function intentDigest({
  parentPageId,
  title,
  body,
}: {
  parentPageId: string;
  title: string;
  body: string;
}): string {
  return createHash("sha256").update(JSON.stringify({ body, parentPageId, title }), "utf8").digest("hex").slice(0, 32);
}

function ledgerDir({ home, index }: { home: string; index: "intents" | "pages" }): string {
  return join(stateHomePaths({ home }).ledgers, "notion-pages", index);
}

/**
 * The `pages` index directory, one `<page id>.json` per created or adopted page, for a reader that lists it whole
 * (`./pageLedgerListing.ts`).
 *
 * @returns the directory, whether or not it has been created yet
 */
export function pageIndexDir({ home }: { home: string }): string {
  return ledgerDir({ home, index: "pages" });
}

function recordPath({ home, index, key }: { home: string; index: "intents" | "pages"; key: string }): string {
  return join(ledgerDir({ home, index }), `${key}.json`);
}

/**
 * The file one intent's record lives in, for the one module that may remove it (`./reservationRelease.ts`).
 *
 * @param intent the intent digest
 * @returns the record's path under the home
 */
export function intentRecordPath({ home, intent }: { home: string; intent: string }): string {
  return recordPath({ home, index: "intents", key: intent });
}

/** Parse the persisted image list, dropping any entry that is not a whole record. */
function parseImages({ value }: { value: unknown }): readonly PageImageRecord[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const images = value.flatMap((entry: unknown) => {
    if (!isRecord(entry)) {
      return [];
    }
    const fields = ["placeholderId", "source", "blockId", "fileUploadId"] as const;
    return fields.every((field) => typeof entry[field] === "string")
      ? [
          {
            blockId: String(entry["blockId"]),
            fileUploadId: String(entry["fileUploadId"]),
            placeholderId: String(entry["placeholderId"]),
            source: String(entry["source"]),
          },
        ]
      : [];
  });
  return images.length > 0 ? images : undefined;
}

/** Parse a persisted record, returning undefined when it is absent or unreadable. */
function parseRecord({ raw }: { raw: string }): PageRecord | undefined {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed) || typeof parsed["intent"] !== "string" || typeof parsed["reservedIso"] !== "string") {
      return undefined;
    }
    const read = ({ field }: { field: string }): string | undefined => {
      const value = parsed[field];
      return typeof value === "string" ? value : undefined;
    };
    const parsedImages = parseImages({ value: parsed["images"] });
    return {
      intent: parsed["intent"],
      reservedIso: parsed["reservedIso"],
      ...(read({ field: "pageId" }) === undefined ? {} : { pageId: read({ field: "pageId" }) }),
      ...(read({ field: "url" }) === undefined ? {} : { url: read({ field: "url" }) }),
      ...(read({ field: "confirmedIso" }) === undefined ? {} : { confirmedIso: read({ field: "confirmedIso" }) }),
      ...(read({ field: "lastCanonicalHash" }) === undefined
        ? {}
        : { lastCanonicalHash: read({ field: "lastCanonicalHash" }) }),
      ...(read({ field: "lastParentId" }) === undefined ? {} : { lastParentId: read({ field: "lastParentId" }) }),
      ...(read({ field: "movedIso" }) === undefined ? {} : { movedIso: read({ field: "movedIso" }) }),
      ...(parsedImages === undefined ? {} : { images: parsedImages }),
    };
  } catch {
    return undefined;
  }
}

/**
 * Read a record from one file the release has claimed by renaming it aside (`./reservationRelease.ts`).
 *
 * @param path the claimed file, no longer at its ledger path
 * @returns the record, or undefined when it cannot be read
 */
export function readClaimedRecord({ path }: { path: string }): PageRecord | undefined {
  try {
    return parseRecord({ raw: readFileSync(path, "utf8") });
  } catch {
    return undefined;
  }
}

/**
 * Read the record for one intent digest, or undefined.
 *
 * @param home the state home the ledger lives under
 * @param intent the intent digest
 * @returns the record, or undefined when there is none or it cannot be read
 */
export function readIntentRecord({ home, intent }: { home: string; intent: string }): PageRecord | undefined {
  try {
    return parseRecord({ raw: readFileSync(recordPath({ home, index: "intents", key: intent }), "utf8") });
  } catch {
    return undefined;
  }
}

/**
 * Read the record for one page id, or undefined.
 *
 * @param home the state home the ledger lives under
 * @param pageId the Notion page id
 * @returns the record, or undefined when there is none or it cannot be read
 */
export function readPageRecord({ home, pageId }: { home: string; pageId: string }): PageRecord | undefined {
  if (!isValidPageId({ id: pageId })) {
    return undefined;
  }
  try {
    return parseRecord({ raw: readFileSync(recordPath({ home, index: "pages", key: pageId }), "utf8") });
  } catch {
    return undefined;
  }
}

/**
 * Claim an intent exclusively, BEFORE the create is attempted.
 *
 * @param home the state home
 * @param intent the intent digest
 * @param nowIso the instant of the reservation
 * @returns `fresh` when this caller may proceed, `taken` when the intent is already claimed
 */
export function reserveIntent({
  home,
  intent,
  nowIso,
}: {
  home: string;
  intent: string;
  nowIso: string;
}): PageReservation {
  mkdirSync(ledgerDir({ home, index: "intents" }), { recursive: true });
  const record: PageRecord = { intent, reservedIso: nowIso };
  try {
    writeFileSync(recordPath({ home, index: "intents", key: intent }), JSON.stringify(record), { flag: "wx" });
    return { kind: "fresh", reservedIso: nowIso };
  } catch {
    // An unwritable or unparseable slot counts as TAKEN, never as free: an unrecorded create is one no later
    // update can ever prove it owns, and Notion offers no way to look the page up after the fact.
    return { kind: "taken", record: readIntentRecord({ home, intent }) ?? record };
  }
}

/**
 * Record that a create landed, writing both indexes so ownership and at-most-once are both answerable.
 *
 * @param home the state home
 * @param intent the intent digest that reserved it
 * @param pageId Notion's page id
 * @param url the page's canonical URL
 * @param nowIso when the create was confirmed
 * @param canonical the digest of the page's canonical markdown, read back after the write
 * @param images the images the attach pass placed on the page, empty when it placed none
 */
export function confirmPage({
  home,
  intent,
  pageId,
  url,
  nowIso,
  canonical,
  images,
}: {
  home: string;
  intent: string;
  pageId: string;
  url: string;
  nowIso: string;
  canonical: string;
  images: readonly PageImageRecord[];
}): void {
  const existing = readIntentRecord({ home, intent });
  const record: PageRecord = {
    confirmedIso: nowIso,
    ...(images.length > 0 ? { images } : {}),
    intent,
    lastCanonicalHash: canonical,
    pageId,
    reservedIso: existing?.reservedIso ?? nowIso,
    url,
  };
  const serialised = JSON.stringify(record);
  writeFileAtomic({ contents: serialised, path: recordPath({ home, index: "intents", key: intent }) });
  if (isValidPageId({ id: pageId })) {
    writeFileAtomic({ contents: serialised, path: recordPath({ home, index: "pages", key: pageId }) });
  }
}

/**
 * Record that an update replaced a page's body, so the next re-publish can see identical bytes as a no-op.
 *
 * @param home the state home
 * @param pageId the page that was rewritten
 * @param nowIso when the update was confirmed
 * @param canonical the digest of the page's canonical markdown, read back after the write
 * @param images the images now on the page — they REPLACE the previous list, because an update deletes
 *   every block the page had, so a merged list would name blocks that no longer exist
 */
export function confirmPageUpdate({
  home,
  pageId,
  nowIso,
  canonical,
  images,
}: {
  home: string;
  pageId: string;
  nowIso: string;
  canonical: string;
  images: readonly PageImageRecord[];
}): void {
  const existing = readPageRecord({ home, pageId });
  if (existing === undefined) {
    return;
  }
  const record: PageRecord = {
    ...existing,
    confirmedIso: nowIso,
    ...(images.length > 0 ? { images } : { images: undefined }),
    lastCanonicalHash: canonical,
  };
  const serialised = JSON.stringify(record);
  writeFileAtomic({ contents: serialised, path: recordPath({ home, index: "pages", key: pageId }) });
  writeFileAtomic({ contents: serialised, path: recordPath({ home, index: "intents", key: existing.intent }) });
}

/**
 * Record that a page was re-parented, keeping every other field of its record intact.
 *
 * A move sends no content, so `lastCanonicalHash` is deliberately NOT touched here: the digest still
 * describes the page's body, which the move did not change, and rewriting it with a fresh read would fold a
 * content check into an operation that read no content.
 *
 * Silently does nothing for a page the ledger does not hold, exactly as {@link confirmPageUpdate} does —
 * `move` refuses an unowned page long before reaching this, so a write here would be inventing a record for
 * a page nothing proved was ours.
 *
 * @param home the state home
 * @param pageId the page that was moved
 * @param parentPageId the parent it now hangs under, read back off the provider
 * @param nowIso when the move was confirmed
 */
export function confirmPageMove({
  home,
  pageId,
  parentPageId,
  nowIso,
}: {
  home: string;
  pageId: string;
  parentPageId: string;
  nowIso: string;
}): void {
  const existing = readPageRecord({ home, pageId });
  if (existing === undefined) {
    return;
  }
  const record: PageRecord = { ...existing, lastParentId: parentPageId, movedIso: nowIso };
  const serialised = JSON.stringify(record);
  writeFileAtomic({ contents: serialised, path: recordPath({ home, index: "pages", key: pageId }) });
  writeFileAtomic({ contents: serialised, path: recordPath({ home, index: "intents", key: existing.intent }) });
}

/**
 * Record ownership of a page that is NOT in the ledger, on the caller's `--adopt` and the provider's own
 * authorship evidence.
 *
 * This is the recovery path for the one failure Notion cannot otherwise settle: a create whose response was
 * lost leaves a page nothing local can name. The caller finds it in Notion, confirms the integration is its
 * last editor, and records that here. It is deliberately a separate, explicitly-requested step rather than
 * something `update` infers, because inferring it would make every bot-touched page in the workspace
 * silently rewritable.
 *
 * @param home the state home
 * @param pageId the page being adopted
 * @param url its canonical URL
 * @param nowIso when it was adopted
 * @param canonical the digest of its canonical markdown right now
 */
export function adoptPage({
  home,
  pageId,
  url,
  nowIso,
  canonical,
}: {
  home: string;
  pageId: string;
  url: string;
  nowIso: string;
  canonical: string;
}): void {
  if (!isValidPageId({ id: pageId })) {
    return;
  }
  const record: PageRecord = {
    confirmedIso: nowIso,
    // An adopted page has no create intent of its own: nothing local ever reserved it. The page id stands in
    // so the record is still self-describing, rather than borrowing a digest that would claim a create this
    // ledger never made.
    intent: `adopted:${pageId}`,
    lastCanonicalHash: canonical,
    pageId,
    reservedIso: nowIso,
    url,
  };
  writeFileAtomic({ contents: JSON.stringify(record), path: recordPath({ home, index: "pages", key: pageId }) });
}

/** One break-glass overwrite of a page a human touched since slopweaver last wrote it. */
export interface ExternalEditOverride {
  readonly pageId: string;
  /** The operator's stated reason — required, never empty (`parseNotionPageArgs`/`parseNotionAttachArgs` enforce it). */
  readonly reason: string;
  readonly lastEditedBy: string;
  readonly lastEditedTime: string;
  /** The page's canonical digest at the moment of the override, so the journal names what was overwritten. */
  readonly canonicalHash: string;
  readonly nowIso: string;
}

/** Where the append-only external-edit-override journal lives. */
function overridesJournalPath({ home }: { home: string }): string {
  return join(stateHomePaths({ home }).ledgers, "notion-pages", "external-edit-overrides.jsonl");
}

/**
 * Journal a break-glass overwrite of a page a human touched since slopweaver last wrote it.
 *
 * Called by `resolveExternalEdit` (`../../cli/commands/notion/authorship.ts`), never directly by a verb —
 * the decision of whether an override is even warranted lives there, alongside the byte-identical check that
 * this journal exists specifically NOT to run for.
 *
 * @param home the state home
 * @param override what was overridden, and why
 */
export function recordExternalEditOverride({ home, override }: { home: string; override: ExternalEditOverride }): void {
  mkdirSync(join(stateHomePaths({ home }).ledgers, "notion-pages"), { recursive: true });
  appendLines({ path: overridesJournalPath({ home }), text: `${JSON.stringify(override)}\n` });
}

/** Whether a parsed value is a whole {@link ExternalEditOverride}. Pure. */
function isExternalEditOverride(value: unknown): value is ExternalEditOverride {
  const fields = ["pageId", "reason", "lastEditedBy", "lastEditedTime", "canonicalHash", "nowIso"] as const;
  return isRecord(value) && fields.every((field) => typeof value[field] === "string");
}

/**
 * Read every journaled override, tolerant of a missing or corrupt file — an audit read must never be fatal
 * to a caller that is only trying to display history.
 *
 * @param home the state home
 * @returns every override journaled for this home, in the order they were written
 */
export function readExternalEditOverrides({ home }: { home: string }): readonly ExternalEditOverride[] {
  let raw: string;
  try {
    raw = readFileSync(overridesJournalPath({ home }), "utf8");
  } catch {
    return [];
  }
  return raw
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .flatMap((line) => {
      try {
        const parsed: unknown = JSON.parse(line);
        return isExternalEditOverride(parsed) ? [parsed] : [];
      } catch {
        return [];
      }
    });
}
