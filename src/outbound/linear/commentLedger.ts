/**
 * The record of which append-shaped Linear objects slopweaver created — the at-most-once primitive under
 * `linear comment create`, `linear relation create`, `linear project-update create`,
 * `linear initiative-update create`, `linear initiative link` and `linear label create`.
 *
 * Same design as `./issueLedger.ts` and `./projectLedger.ts`, and here for the same reason: under a personal
 * API key Linear attributes every mutation to the HUMAN who owns the key, so nothing on the object can prove
 * slopweaver made it. Origin is established locally; existence is established remotely.
 *
 * ## What the reservation actually buys on these two objects
 *
 * Every kind here is APPEND-shaped: nothing overwrites, so the failure mode is not a lost
 * edit, it is a DUPLICATE. Post the same comment twice and a colleague is notified twice about one finding;
 * assert the same relation twice and the issue grows two identical edges. Because both ids are derived from
 * their intent (`../../cli/commands/linear/commentCore.ts`), the second attempt computes the id the first
 * one used, finds the reservation, and refuses — which is what makes a retry after a lost response safe.
 *
 * A label is append-shaped too: two creates of one name in one team leave two labels a reader cannot tell
 * apart, and every later `labelIds` copy has to guess which one is meant.
 *
 * ## Why six kinds share one file
 *
 * Their records are the same three fields, and `./projectLedger.ts` already set the precedent of keying one
 * implementation on a kind rather than writing the same reserve/confirm twice. The alternative — a third,
 * fourth and fifth copy of `reserve → O_EXCL → confirm` — is where a subtle divergence in the fail-closed
 * behaviour would eventually live.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { Result } from "#lib/result.js";
import { writeFileAtomic } from "#lib/writeAtomic.js";

import { isRecord } from "../../lib/parsers.js";
import { stateHomePaths } from "../../stateHome.js";
import { type LedgerListing, type LedgerUnreadableError, listLedgerRecords } from "./ledgerListing.js";
import { releaseUnconfirmedRecord } from "./reservationRelease.js";

/** Which append-shaped object a record belongs to. Also the ledger sub-directory name. */
export type AppendKind =
  | "linear-comments"
  | "linear-initiative-links"
  | "linear-initiative-updates"
  | "linear-labels"
  | "linear-project-updates"
  | "linear-relations";

/**
 * One comment or relation slopweaver reserved, and what became of it.
 *
 * `subject` is the object this one hangs off — the comment's issue, the relation's FIRST issue, the status
 * update's project or initiative, the link's initiative, or the label's team (`workspace` for a workspace
 * label). Recorded
 * so a reconciliation pass can answer "what did we append to this ticket?" without re-reading Linear, which
 * is the question anyone asks after a run that ended `unconfirmed`.
 */
export interface AppendRecord {
  readonly id: string;
  readonly reservedIso: string;
  readonly subject?: string | undefined;
  /** When the create was confirmed by read-back. Absent ⇒ the outcome is unknown, not that it failed. */
  readonly confirmedIso?: string | undefined;
}

/** Whether this caller now holds the reservation for an id. */
export type AppendReservation = { readonly kind: "fresh" } | { readonly kind: "taken"; readonly record: AppendRecord };

/** The directory holding one record per reserved id of that kind. */
function ledgerDir({ home, kind }: { home: string; kind: AppendKind }): string {
  return join(stateHomePaths({ home }).ledgers, kind);
}

/** A UUID is already a safe filename, and it is the only thing that ever names a record here. */
function recordPath({ home, kind, id }: { home: string; kind: AppendKind; id: string }): string {
  return join(ledgerDir({ home, kind }), `${id}.json`);
}

/**
 * Parse a record, returning undefined when it is absent or unreadable.
 *
 * @param raw one persisted ledger record
 * @returns the record, or undefined when it is absent or unreadable
 */
function parseAppendRecord({ raw }: { raw: string }): AppendRecord | undefined {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed) || typeof parsed["id"] !== "string" || typeof parsed["reservedIso"] !== "string") {
      return undefined;
    }
    const subject = parsed["subject"];
    const confirmedIso = parsed["confirmedIso"];
    return {
      id: parsed["id"],
      reservedIso: parsed["reservedIso"],
      ...(typeof subject === "string" ? { subject } : {}),
      ...(typeof confirmedIso === "string" ? { confirmedIso } : {}),
    };
  } catch {
    return undefined;
  }
}

/**
 * Read one record, or undefined.
 *
 * @param home the state home the ledger lives under
 * @param kind which append-shaped object
 * @param id the id to look up
 * @returns the record, or undefined when there is no such file or it cannot be read
 */
export function readAppendRecord({
  home,
  kind,
  id,
}: {
  home: string;
  kind: AppendKind;
  id: string;
}): AppendRecord | undefined {
  try {
    return parseAppendRecord({ raw: readFileSync(recordPath({ home, id, kind }), "utf8") });
  } catch {
    return undefined;
  }
}

/**
 * Claim an id exclusively, BEFORE the create is attempted.
 *
 * @param home the state home
 * @param kind which append-shaped object
 * @param id the caller-chosen UUID
 * @param subject the issue this object hangs off
 * @param nowIso the instant of the reservation
 * @returns `fresh` when this caller may proceed, `taken` when the id is already claimed
 */
export function reserveAppend({
  home,
  kind,
  id,
  subject,
  nowIso,
}: {
  home: string;
  kind: AppendKind;
  id: string;
  subject: string;
  nowIso: string;
}): AppendReservation {
  mkdirSync(ledgerDir({ home, kind }), { recursive: true });
  const record: AppendRecord = { id, reservedIso: nowIso, subject };
  try {
    writeFileSync(recordPath({ home, id, kind }), JSON.stringify(record), { flag: "wx" });
    return { kind: "fresh" };
  } catch {
    const existing = readAppendRecord({ home, id, kind });
    // An unwritable or unparseable slot counts as TAKEN, never as free — the same fail-closed direction
    // `./issueLedger.ts` takes, and for the same reason: an unrecorded append is one nobody can reconcile.
    return { kind: "taken", record: existing ?? record };
  }
}

/**
 * Release this invocation's own append reservation after the create was refused before the wire
 * (`./reservationRelease.ts`): only an unconfirmed record carrying exactly this id and reservation instant goes.
 *
 * @param home the state home
 * @param kind which append-shaped object
 * @param id the reserved UUID
 * @param reservedIso the instant this invocation reserved it at
 * @returns true when the reservation was removed
 */
export function releaseAppendReservation({
  home,
  kind,
  id,
  reservedIso,
}: {
  home: string;
  kind: AppendKind;
  id: string;
  reservedIso: string;
}): boolean {
  return releaseUnconfirmedRecord({ id, parse: parseAppendRecord, path: recordPath({ home, id, kind }), reservedIso });
}

/**
 * Record that the create actually landed.
 *
 * @param home the state home
 * @param kind which append-shaped object
 * @param id the reserved UUID
 * @param subject the issue this object hangs off
 * @param nowIso when the create was confirmed
 */
export function confirmAppend({
  home,
  kind,
  id,
  subject,
  nowIso,
}: {
  home: string;
  kind: AppendKind;
  id: string;
  subject: string;
  nowIso: string;
}): void {
  mkdirSync(ledgerDir({ home, kind }), { recursive: true });
  const existing = readAppendRecord({ home, id, kind });
  writeFileAtomic({
    contents: JSON.stringify({ confirmedIso: nowIso, id, reservedIso: existing?.reservedIso ?? nowIso, subject }),
    path: recordPath({ home, id, kind }),
  });
}

/**
 * Every record of one append kind slopweaver reserved, failing rather than reading as empty when the ledger
 * cannot be listed — the publication audit's inventory of what the fleet appended.
 *
 * @param home the state home the ledger lives under
 * @param kind which append-shaped object, which is also its ledger sub-directory
 * @returns the records and the unreadable-row count, empty when nothing was ever reserved, or the listing refusal
 */
export function listAppendRecords({
  home,
  kind,
}: {
  home: string;
  kind: AppendKind;
}): Result<LedgerListing<AppendRecord>, LedgerUnreadableError> {
  return listLedgerRecords({ directory: ledgerDir({ home, kind }), parse: parseAppendRecord });
}
