/**
 * The reservation + ownership ledger for `linear document create|update` — the at-most-once primitive
 * `./issueLedger.ts` proves, applied to a page.
 *
 * `DocumentCreateInput.id` accepts a caller-chosen UUID v4 (confirmed against the pinned `@linear/sdk` type
 * declarations, as for an issue), so the id is reserved here with `O_EXCL` BEFORE the mutation and a lost
 * response becomes something to look up rather than something to guess about. Ownership is local for the
 * reason `./issueLedger.ts` records: under a personal API key Linear attributes every write to the human, so
 * the document itself cannot say slopweaver made it.
 *
 * A document record carries two things a project record does not, and each is there because of a property of
 * the update:
 *
 *  - **The content digest** — `update` is REPLACE-shaped, the whole rendered page standing in for one field,
 *    exactly as `linear issue update` replaces a description. So it carries the same conflict guard:
 *    `./issueLedger.ts`'s `descriptionHash` over the content as Linear STORED it, read back after the write.
 *    A changed digest means a person edited the page since, and a re-render would silently erase them.
 *  - **The destination** — recorded at create, and the update refuses a form that names a different one.
 *    `DocumentUpdateInput` accepts the four parent ids, but what sending a second one, or clearing the first,
 *    does to a document is undocumented and unmeasured, so this lane never moves a document at all.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import type { Result } from "#lib/result.js";
import { createFileExclusive, ensureDirectory, fsyncDirectories, writeFileAtomic } from "#lib/writeAtomic.js";

import { isRecord } from "../../lib/parsers.js";
import { stateHomePaths } from "../../stateHome.js";

import type { LinearDocumentDestination, LinearDocumentDestinationKind } from "./documentTypes.js";
import { descriptionHash } from "./issueLedger.js";
import { type LedgerListing, type LedgerUnreadableError, listLedgerRecords } from "./ledgerListing.js";
import { releaseUnconfirmedRecord } from "./reservationRelease.js";

/** One document slopweaver reserved, and what became of it. */
export interface DocumentRecord {
  /** The caller-chosen Linear document UUID. */
  readonly id: string;
  /** When the id was reserved, before the mutation was attempted. */
  readonly reservedIso: string;
  /** Where the document was created. Recorded at reservation, so even an unconfirmed record names it. */
  readonly destination: LinearDocumentDestination;
  /** Linear's own title for it, present ONLY once a write was confirmed on the wire. */
  readonly title?: string | undefined;
  readonly url?: string | undefined;
  /** When the last write was confirmed. Absent ⇒ the create's outcome is unknown, not that it failed. */
  readonly confirmedIso?: string | undefined;
  /** The `updatedAt` Linear reported at the last write. Recorded, never the conflict signal. */
  readonly lastSeenUpdatedAt?: string | undefined;
  /** The digest of the content Linear stored at our last write — the conflict signal; see the module doc. */
  readonly lastSeenContentHash?: string | undefined;
}

/** Whether this caller now holds the reservation for an id. */
export type DocumentReservation =
  { readonly kind: "fresh" } | { readonly kind: "taken"; readonly record: DocumentRecord | undefined };

const DESTINATION_KINDS: readonly LinearDocumentDestinationKind[] = ["initiative", "issue", "project", "team"];

function ledgerDir({ home }: { home: string }): string {
  return join(stateHomePaths({ home }).ledgers, "linear-documents");
}

/** A UUID is already a safe filename, and it is the only thing that ever names a record here. */
function recordPath({ home, id }: { home: string; id: string }): string {
  return join(ledgerDir({ home }), `${id}.json`);
}

function ensureDir({ home }: { home: string }): void {
  ensureDirectory({ directory: ledgerDir({ home }) });
}

/** A persisted destination, or undefined when it is missing or names a kind this lane does not know. */
function parseDestination({ value }: { value: unknown }): LinearDocumentDestination | undefined {
  if (!isRecord(value) || typeof value["id"] !== "string" || typeof value["kind"] !== "string") {
    return undefined;
  }
  const kind = DESTINATION_KINDS.find((known) => known === value["kind"]);
  return kind === undefined ? undefined : { id: value["id"], kind };
}

/**
 * Parse a document record, returning undefined when it is absent or unreadable.
 *
 * A record with no readable destination is unreadable, not a record with a blank one: the update's
 * destination check has nothing to compare against, and `ownershipOfDocument` refuses on undefined, so a
 * corrupt ledger fails closed.
 *
 * @param raw one persisted ledger record
 * @returns the record, or undefined when it is absent or unreadable
 */
export function parseDocumentRecord({ raw }: { raw: string }): DocumentRecord | undefined {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed) || typeof parsed["id"] !== "string" || typeof parsed["reservedIso"] !== "string") {
      return undefined;
    }
    const destination = parseDestination({ value: parsed["destination"] });
    if (destination === undefined) {
      return undefined;
    }
    const { title, url, confirmedIso, lastSeenUpdatedAt, lastSeenContentHash } = parsed;
    return {
      destination,
      id: parsed["id"],
      reservedIso: parsed["reservedIso"],
      ...(typeof title === "string" ? { title } : {}),
      ...(typeof url === "string" ? { url } : {}),
      ...(typeof confirmedIso === "string" ? { confirmedIso } : {}),
      ...(typeof lastSeenUpdatedAt === "string" ? { lastSeenUpdatedAt } : {}),
      ...(typeof lastSeenContentHash === "string" ? { lastSeenContentHash } : {}),
    };
  } catch {
    return undefined;
  }
}

/**
 * Read one document record, or undefined.
 *
 * @param home the state home the ledger lives under
 * @param id the document id to look up
 * @returns the record, or undefined when there is no such file, it cannot be read, or it names another id
 */
export function readDocumentRecord({ home, id }: { home: string; id: string }): DocumentRecord | undefined {
  try {
    const record = parseDocumentRecord({ raw: readFileSync(recordPath({ home, id }), "utf8") });
    // A record filed under another id is not evidence about this one: a copied or renamed file
    // would otherwise lend one page's ownership to an unrelated page.
    return record?.id === id ? record : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Claim a document id exclusively, BEFORE the create is attempted, recording where it is going.
 *
 * @param home the state home
 * @param id the caller-chosen document UUID
 * @param destination where the create will put it
 * @param nowIso the instant of the reservation
 * @returns `fresh` when this caller may proceed; `taken` when the id is already claimed, carrying the existing
 *   record or undefined when the slot cannot be read — which still counts as taken, never as free
 */
export function reserveDocument({
  home,
  id,
  destination,
  nowIso,
}: {
  home: string;
  id: string;
  destination: LinearDocumentDestination;
  nowIso: string;
}): DocumentReservation {
  ensureDir({ home });
  // Flushed whoever made them: `ensureDirectory` flushes only what THIS call created,
  // so a concurrent run that lost the mkdir race would otherwise build its reservation on a directory entry the
  // winner had not yet made durable.
  fsyncDirectories({ paths: [ledgerDir({ home }), stateHomePaths({ home }).ledgers] });
  const record: DocumentRecord = { destination, id, reservedIso: nowIso };
  try {
    // Durable, not merely exclusive: the create is sent the moment this returns, so a reservation
    // a power loss could erase would let an identical retry send a second `documentCreate`.
    createFileExclusive({ contents: JSON.stringify(record), path: recordPath({ home, id }) });
    return { kind: "fresh" };
  } catch {
    // An unwritable or unparseable slot counts as TAKEN, never as free — an unrecorded create is one
    // `update` can never own afterwards.
    return { kind: "taken", record: readDocumentRecord({ home, id }) };
  }
}

/**
 * Record that a create or update actually landed, with what Linear stored.
 *
 * @param home the state home
 * @param id the document UUID
 * @param reservedIso the reservation instant to keep — the record's own, never re-stamped by an update
 * @param destination where the document lives, carried forward unchanged
 * @param title Linear's title for it, as stored
 * @param url Linear's URL for it
 * @param updatedAt the `updatedAt` Linear reported
 * @param content the content as Linear STORED it, read back after the write — the digest's input
 * @param nowIso when the write was confirmed
 */
export function confirmDocument({
  home,
  id,
  reservedIso,
  destination,
  title,
  url,
  updatedAt,
  content,
  nowIso,
}: {
  home: string;
  id: string;
  reservedIso: string;
  destination: LinearDocumentDestination;
  title: string;
  url: string;
  updatedAt: string;
  content: string | undefined;
  nowIso: string;
}): void {
  ensureDir({ home });
  const record: DocumentRecord = {
    confirmedIso: nowIso,
    destination,
    id,
    lastSeenContentHash: descriptionHash({ description: content }),
    lastSeenUpdatedAt: updatedAt,
    reservedIso,
    title,
    url,
  };
  writeFileAtomic({ contents: JSON.stringify(record), path: recordPath({ home, id }) });
}

/**
 * Release this invocation's own document create reservation after the create was refused before the wire
 * (`./reservationRelease.ts`): only an unconfirmed record carrying exactly this id and reservation instant goes.
 *
 * @param home the state home
 * @param id the reserved document UUID
 * @param reservedIso the instant this invocation reserved it at
 * @returns true when the reservation was removed
 */
export function releaseDocumentReservation({
  home,
  id,
  reservedIso,
}: {
  home: string;
  id: string;
  reservedIso: string;
}): boolean {
  return releaseUnconfirmedRecord({ id, parse: parseDocumentRecord, path: recordPath({ home, id }), reservedIso });
}

/** Why a document update was refused. A named reason, never a bare false. */
export type DocumentOwnership =
  { readonly owned: true; readonly record: DocumentRecord } | { readonly owned: false; readonly reason: string };

/**
 * Whether slopweaver may modify this document. Fails CLOSED on every uncertainty, the posture `ownershipOf`
 * takes for an issue: no record, an unreadable one, or one with no confirmation all refuse.
 *
 * @param home the state home
 * @param id the document UUID
 * @returns ownership, or a named refusal
 */
export function ownershipOfDocument({ home, id }: { home: string; id: string }): DocumentOwnership {
  const record = readDocumentRecord({ home, id });
  if (record === undefined) {
    return {
      owned: false,
      reason:
        `slopweaver has no readable record of creating document ${id}, so it will not modify it. Under a ` +
        "personal API key Linear attributes every write to you, so the document itself cannot prove who made " +
        "it; this ledger is the only evidence, and it is absent.",
    };
  }
  if (record.confirmedIso === undefined) {
    return {
      owned: false,
      reason:
        `document ${id} was reserved at ${record.reservedIso} but never confirmed, so whether it exists is ` +
        "unknown. Reconcile it with a read-back before editing.",
    };
  }
  return { owned: true, record };
}

/**
 * Every document id slopweaver has reserved, for reconciliation.
 *
 * @param home the state home the ledger lives under
 * @returns every reserved id — reserved, not necessarily confirmed
 */
export function listDocumentIds({ home }: { home: string }): readonly string[] {
  try {
    return readdirSync(ledgerDir({ home }))
      .filter((name) => name.endsWith(".json"))
      .map((name) => name.slice(0, -".json".length))
      .toSorted();
  } catch {
    return [];
  }
}

/**
 * Every document record slopweaver reserved, failing rather than reading as empty when the ledger cannot be listed
 * — the publication audit's inventory. A record filed under another id counts as unreadable, as
 * {@link readDocumentRecord} refuses it.
 *
 * @param home the state home the ledger lives under
 * @returns the records and the unreadable-row count, empty when nothing was ever reserved, or the listing refusal
 */
export function listDocumentRecords({
  home,
}: {
  home: string;
}): Result<LedgerListing<DocumentRecord>, LedgerUnreadableError> {
  return listLedgerRecords({ directory: ledgerDir({ home }), parse: parseDocumentRecord });
}
