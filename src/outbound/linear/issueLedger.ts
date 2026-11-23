/**
 * The record of which Linear issues slopweaver created — the ownership authority, and the at-most-once
 * primitive underneath `create`.
 *
 * ## Why ownership cannot be read off the issue
 *
 * `update` may only touch issues slopweaver created. The obvious implementation is a live read-back that
 * checks who created it, and it does not work: under a personal API key Linear attributes every mutation to
 * the HUMAN who owns the key, so `creator` is the operator whether slopweaver wrote it or they typed it in
 * themselves. Only OAuth with `actor=app` would make the app the author, and this product deliberately uses
 * the key the operator already has. A marker in the description would be mutable, and a label is someone
 * else's to remove.
 *
 * So origin is established LOCALLY and existence is established remotely. This file is the local half.
 *
 * ## Why the id is chosen before the write
 *
 * `IssueCreateInput.id` accepts a caller-supplied UUID v4, so the identity exists before the request does.
 * That is what makes the create addressable after a lost response: the caller reserves the id here, sends it,
 * and if the acknowledgement never arrives it asks Linear whether that exact id exists rather than guessing
 * from content. Slack has no equivalent, which is why `sendReservation.ts` can only ever say "outcome
 * unknown" — this lane can actually find out.
 *
 * The reservation is taken with `O_EXCL` before the mutation, so two concurrent creates of the same intent
 * cannot both proceed. Evidence direction matches Slack's and is deliberate: a reservation that exists
 * without a confirmation means "outcome unknown", never "safe to send again".
 */
import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { Result } from "#lib/result.js";
import { writeFileAtomic } from "#lib/writeAtomic.js";

import { isRecord } from "../../lib/parsers.js";
import { stateHomePaths } from "../../stateHome.js";
import { type LedgerListing, type LedgerUnreadableError, listLedgerRecords } from "./ledgerListing.js";
import { type ReleaseInterleave, releaseUnconfirmedRecord } from "./reservationRelease.js";

/** One issue slopweaver reserved, and what became of it. */
export interface IssueRecord {
  /** The caller-chosen Linear issue UUID. */
  readonly id: string;
  /** When the id was reserved, before the mutation was attempted. */
  readonly reservedIso: string;
  /** Linear's human identifier, present ONLY once the create was confirmed on the wire. */
  readonly identifier?: string | undefined;
  /** When the create was confirmed. Absent ⇒ the outcome is unknown, not that it failed. */
  readonly confirmedIso?: string | undefined;
  /** The `updatedAt` Linear reported at the last write. Recorded, but NOT the conflict signal — see below. */
  readonly lastSeenUpdatedAt?: string | undefined;
  /**
   * A digest of the description Linear had at our last write, and the actual conflict signal.
   *
   * MEASURED, and the reason the timestamp cannot be used alone: Linear moves `updatedAt` by itself after a
   * create — 43 seconds later in one observed run, with no human involved — because it normalises the stored
   * markdown. For what it actually does to the bytes, see `fidelity.ts`, which is the measured record:
   * `-` bullets are rewritten to `*`, and a bare autolink is EXPANDED to `[url](<url>)` with the angle
   * brackets KEPT. (This comment previously claimed the brackets were stripped and that images were
   * re-hosted; direct measurement refutes the first, and the second was never reproduced.)
   * A timestamp comparison therefore refuses every first update as a phantom conflict.
   *
   * The digest is taken over the description as Linear STORES it, read back after the write, so it already
   * includes that normalisation. An unchanged digest means nobody has touched the prose, whatever the clock
   * says; a changed one means someone has, which is the only case worth refusing.
   */
  readonly lastSeenDescriptionHash?: string | undefined;
}

/**
 * The digest of a stored description.
 *
 * @param description the description as Linear stores it, or undefined when it has none
 * @returns a stable hex digest
 */
export function descriptionHash({ description }: { description: string | undefined }): string {
  // An ABSENT description and an EMPTY one are different states and must not hash alike: the first means
  // Linear returned nothing (a failed or partial read), the second means the issue genuinely has no body.
  // Collapsing them would let a failed read compare equal to an issue somebody emptied.
  const material = description === undefined ? "\u0000absent" : `present:${description}`;
  return createHash("sha256").update(material, "utf8").digest("hex").slice(0, 32);
}

/** Whether this caller now holds the reservation for an id. */
export type IssueReservation = { readonly kind: "fresh" } | { readonly kind: "taken"; readonly record: IssueRecord };

/** The directory holding one record per reserved issue id. */
function ledgerDir({ home }: { home: string }): string {
  return join(stateHomePaths({ home }).ledgers, "linear-issues");
}

/** A UUID is already a safe filename, and it is the only thing that ever names a record here. */
function recordPath({ home, id }: { home: string; id: string }): string {
  return join(ledgerDir({ home }), `${id}.json`);
}

function ensureDir({ home }: { home: string }): void {
  mkdirSync(ledgerDir({ home }), { recursive: true });
}

/**
 * Parse a record, returning undefined when it is absent or unreadable.
 *
 * An unreadable record is deliberately NOT treated as absent by the callers that matter: `ownershipOf`
 * refuses on undefined, so a corrupt ledger fails closed rather than silently granting permission to edit
 * an issue nobody can prove slopweaver wrote.
 *
 * @param raw one persisted ledger line
 * @returns the record, or undefined when it is absent or unreadable — the caller decides what that means,
 *   and `ownershipOf` treats it as a refusal rather than as permission
 */
export function parseIssueRecord({ raw }: { raw: string }): IssueRecord | undefined {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed) || typeof parsed["id"] !== "string" || typeof parsed["reservedIso"] !== "string") {
      return undefined;
    }
    const identifier = parsed["identifier"];
    const confirmedIso = parsed["confirmedIso"];
    const lastSeen = parsed["lastSeenUpdatedAt"];
    const lastHash = parsed["lastSeenDescriptionHash"];
    return {
      id: parsed["id"],
      reservedIso: parsed["reservedIso"],
      ...(typeof identifier === "string" ? { identifier } : {}),
      ...(typeof confirmedIso === "string" ? { confirmedIso } : {}),
      ...(typeof lastSeen === "string" ? { lastSeenUpdatedAt: lastSeen } : {}),
      ...(typeof lastHash === "string" ? { lastSeenDescriptionHash: lastHash } : {}),
    };
  } catch {
    return undefined;
  }
}

/**
 * Read one record, or undefined.
 *
 * @param home the state home the ledger lives under
 * @param id the issue id to look up
 * @returns the record, or undefined when there is no such file or it cannot be read
 */
export function readIssueRecord({ home, id }: { home: string; id: string }): IssueRecord | undefined {
  try {
    return parseIssueRecord({ raw: readFileSync(recordPath({ home, id }), "utf8") });
  } catch {
    return undefined;
  }
}

/**
 * Claim an id exclusively, BEFORE the create is attempted.
 *
 * @param home the state home
 * @param id the caller-chosen issue UUID
 * @param nowIso the instant of the reservation
 * @returns `fresh` when this caller may proceed, `taken` when the id is already claimed
 */
export function reserveIssue({ home, id, nowIso }: { home: string; id: string; nowIso: string }): IssueReservation {
  ensureDir({ home });
  const record: IssueRecord = { id, reservedIso: nowIso };
  try {
    writeFileSync(recordPath({ home, id }), JSON.stringify(record), { flag: "wx" });
    return { kind: "fresh" };
  } catch {
    const existing = readIssueRecord({ home, id });
    // An unwritable or unparseable slot counts as TAKEN, never as free. The safe direction is to refuse a
    // create we cannot record, because an unrecorded create is one `update` can never own afterwards.
    return { kind: "taken", record: existing ?? record };
  }
}

/**
 * Record that the create actually landed, with the identity Linear returned.
 *
 * @param home the state home
 * @param id the reserved issue UUID
 * @param identifier Linear's human identifier for it
 * @param nowIso when the create was confirmed
 * @param updatedAt the `updatedAt` Linear reported, for later conflict detection
 * @param description the body as written, stored so a later update can prove what it is replacing
 */
export function confirmIssue({
  home,
  id,
  identifier,
  nowIso,
  updatedAt,
  description,
}: {
  home: string;
  id: string;
  identifier: string;
  nowIso: string;
  updatedAt: string | undefined;
  description: string | undefined;
}): void {
  ensureDir({ home });
  const existing = readIssueRecord({ home, id });
  const record: IssueRecord = {
    confirmedIso: nowIso,
    id,
    identifier,
    lastSeenDescriptionHash: descriptionHash({ description }),
    reservedIso: existing?.reservedIso ?? nowIso,
    ...(updatedAt !== undefined ? { lastSeenUpdatedAt: updatedAt } : {}),
  };
  writeFileAtomic({ contents: JSON.stringify(record), path: recordPath({ home, id }) });
}

/**
 * Release this invocation's own create reservation after the create was refused before the wire
 * (`./reservationRelease.ts`): only an unconfirmed record carrying exactly this id and reservation instant goes.
 *
 * @param home the state home
 * @param id the reserved issue UUID
 * @param reservedIso the instant this invocation reserved it at
 * @param interleave a test's seam, where a concurrent confirm is placed around the claim
 * @returns true when the reservation was removed
 */
export function releaseIssueReservation({
  home,
  id,
  reservedIso,
  interleave,
}: {
  home: string;
  id: string;
  reservedIso: string;
  interleave?: ReleaseInterleave | undefined;
}): boolean {
  return releaseUnconfirmedRecord({
    id,
    interleave,
    parse: parseIssueRecord,
    path: recordPath({ home, id }),
    reservedIso,
  });
}

/** Why an update was refused. A named reason, never a bare false. */
export type Ownership =
  { readonly owned: true; readonly record: IssueRecord } | { readonly owned: false; readonly reason: string };

/**
 * Whether slopweaver may modify this issue.
 *
 * Fails CLOSED on every uncertainty: no record, or a record with no confirmation. An unconfirmed reservation
 * means the create's outcome was never established, and editing an issue we are not sure we made is exactly
 * the case this gate exists for.
 *
 * @param home the state home
 * @param id the issue UUID
 * @returns ownership, or a named refusal
 */
export function ownershipOf({ home, id }: { home: string; id: string }): Ownership {
  const record = readIssueRecord({ home, id });
  if (record === undefined) {
    return {
      owned: false,
      reason:
        `slopweaver has no record of creating issue ${id}, so it will not modify it. Under a personal API ` +
        "key Linear attributes every write to you, so the issue itself cannot prove who made it; this " +
        "ledger is the only evidence, and it is absent.",
    };
  }
  if (record.confirmedIso === undefined) {
    return {
      owned: false,
      reason:
        `issue ${id} was reserved at ${record.reservedIso} but never confirmed, so whether it exists is ` +
        "unknown. Reconcile it with a read-back before editing.",
    };
  }
  return { owned: true, record };
}

/**
 * Every issue id slopweaver has reserved, for reconciliation and for `doctor`.
 *
 * @param home the state home the ledger lives under
 * @returns every reserved id — reserved, not necessarily confirmed, so this is the set to reconcile
 */
export function listIssueIds({ home }: { home: string }): readonly string[] {
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
 * Every issue record slopweaver reserved, failing rather than reading as empty when the ledger cannot be listed —
 * the audit's inventory, where {@link listIssueIds}'s `[]` on any failure would read an unreadable ledger as clean.
 *
 * @param home the state home the ledger lives under
 * @returns the records and the unreadable-row count, empty when nothing was ever reserved, or the listing refusal
 */
export function listIssueRecords({
  home,
}: {
  home: string;
}): Result<LedgerListing<IssueRecord>, LedgerUnreadableError> {
  return listLedgerRecords({ directory: ledgerDir({ home }), parse: parseIssueRecord });
}
