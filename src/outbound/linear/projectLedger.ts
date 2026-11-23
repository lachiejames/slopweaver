/**
 * The reservation + ownership ledgers for `linear project` and `linear initiative` writes, and the directory of
 * every reserve-then-confirm kind (`linear milestone`'s included) — the same at-most-once primitive
 * `./issueLedger.ts` proves, extended rather than re-invented.
 *
 * The initiative shares the PROJECT record shape and the project reserve/confirm/ownership implementation
 * rather than getting a fourth copy of `reserve → O_EXCL → confirm`. That is the same call
 * `./commentLedger.ts` makes for its three append kinds, and it is made here for the reason that file
 * states: a third and fourth copy of the fail-closed sequence is exactly where a subtle divergence in it
 * would eventually live. What an initiative record needs is what a project record needs — an id, a
 * reservation instant, and Linear's own name and URL once the create is confirmed.
 *
 * Both `ProjectCreateInput` and `ProjectMilestoneCreateInput` accept a caller-chosen UUID v4 `id` (confirmed
 * against the pinned `@linear/sdk` type declarations, same as `IssueCreateInput`), so the same trick applies:
 * reserve the id locally BEFORE the mutation, and a lost response becomes something to look up rather than
 * something to guess about.
 *
 * A project ledger record carries no description-hash conflict guard the way `IssueRecord` does. That guard
 * exists on the issue side because `linear issue update` is REPLACE-shaped against a PATCH-shaped provider
 * endpoint — a whole rendered body stands in for one field. A project write has no such body: every field on
 * `LinearProjectFields` is a scalar sent PATCH-shaped already, so there is nothing to silently clobber that
 * a plain ownership check does not already guard.
 *
 * A milestone's own record, reserve and confirm live in `./milestoneLedger.ts`; it tracks reservation +
 * confirmation only, with no ownership gate. Its sub-directory is still one of this module's kinds, so the
 * kind-generic release and listing below serve it.
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { Result } from "#lib/result.js";
import { writeFileAtomic } from "#lib/writeAtomic.js";

import { isRecord } from "../../lib/parsers.js";
import { stateHomePaths } from "../../stateHome.js";
import { type LedgerListing, type LedgerUnreadableError, listLedgerRecords } from "./ledgerListing.js";
import { releaseUnconfirmedRecord } from "./reservationRelease.js";

/** One project slopweaver reserved, and what became of it. */
export interface ProjectRecord {
  readonly id: string;
  readonly reservedIso: string;
  /** Linear's own name for it, present ONLY once the create was confirmed on the wire. */
  readonly name?: string | undefined;
  readonly url?: string | undefined;
  /** Absent ⇒ the outcome is unknown, not that it failed — same reading as `IssueRecord.confirmedIso`. */
  readonly confirmedIso?: string | undefined;
}

/** Whether this caller now holds the reservation for an id. */
export type ProjectReservation =
  { readonly kind: "fresh" } | { readonly kind: "taken"; readonly record: ProjectRecord };

/** Which reserve-then-confirm object a record belongs to. Also the ledger sub-directory name. */
export type ObjectLedgerKind = "linear-initiatives" | "linear-milestones" | "linear-projects";

/**
 * One reserve-then-confirm kind's ledger directory, `./milestoneLedger.ts`'s included.
 *
 * @param kind which object family, which is also its ledger sub-directory
 * @returns the directory, whether or not it has been created yet
 */
export function objectLedgerDir({ home, kind }: { home: string; kind: ObjectLedgerKind }): string {
  return join(stateHomePaths({ home }).ledgers, kind);
}

/** A UUID is already a safe filename, and it is the only thing that ever names a record here. */
function recordPath({ home, id, kind }: { home: string; id: string; kind: ObjectLedgerKind }): string {
  return join(objectLedgerDir({ home, kind }), `${id}.json`);
}

/**
 * Make one reserve-then-confirm kind's ledger directory. This module is the ledgers' one sanctioned local-state
 * writer, so `./milestoneLedger.ts` makes its directory here rather than holding a second file seam.
 *
 * @param kind which object family, which is also its ledger sub-directory
 */
export function ensureObjectLedgerDir({ home, kind }: { home: string; kind: ObjectLedgerKind }): void {
  mkdirSync(objectLedgerDir({ home, kind }), { recursive: true });
}

/**
 * Create one record file exclusively, its directory made first: the at-most-once claim every kind here rests on,
 * `./milestoneLedger.ts`'s included.
 *
 * @param contents the serialised record written when the slot is free
 * @returns true when this caller created the file; false when it already existed or could not be written
 */
export function createObjectRecordExclusively({
  contents,
  home,
  id,
  kind,
}: {
  contents: string;
  home: string;
  id: string;
  kind: ObjectLedgerKind;
}): boolean {
  ensureObjectLedgerDir({ home, kind });
  try {
    writeFileSync(recordPath({ home, id, kind }), contents, { flag: "wx" });
    return true;
  } catch {
    return false;
  }
}

/**
 * Parse a project record, returning undefined when it is absent or unreadable. An unreadable record is
 * deliberately NOT treated as absent: `ownershipOfProject` refuses on undefined, so a corrupt ledger fails
 * closed rather than silently granting permission to edit a project nobody can prove slopweaver wrote.
 *
 * @param raw one persisted ledger line
 * @returns the record, or undefined when it is absent or unreadable
 */
export function parseProjectRecord({ raw }: { raw: string }): ProjectRecord | undefined {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed) || typeof parsed["id"] !== "string" || typeof parsed["reservedIso"] !== "string") {
      return undefined;
    }
    const name = parsed["name"];
    const url = parsed["url"];
    const confirmedIso = parsed["confirmedIso"];
    return {
      id: parsed["id"],
      reservedIso: parsed["reservedIso"],
      ...(typeof name === "string" ? { name } : {}),
      ...(typeof url === "string" ? { url } : {}),
      ...(typeof confirmedIso === "string" ? { confirmedIso } : {}),
    };
  } catch {
    return undefined;
  }
}

/**
 * Read one project record, or undefined.
 *
 * @param home the state home the ledger lives under
 * @param id the project id to look up
 * @returns the record, or undefined when there is no such file or it cannot be read
 */
export function readProjectRecord({ home, id }: { home: string; id: string }): ProjectRecord | undefined {
  return readObjectRecord({ home, id, kind: "linear-projects" });
}

/**
 * One reserve-then-confirm record of any kind, or undefined when it is absent or unreadable.
 *
 * @param kind which object family the id belongs to, which is also its ledger sub-directory
 * @returns the record, or undefined when it is absent or unreadable
 */
function readObjectRecord({
  home,
  id,
  kind,
}: {
  home: string;
  id: string;
  kind: ObjectLedgerKind;
}): ProjectRecord | undefined {
  try {
    return parseProjectRecord({ raw: readFileSync(recordPath({ home, id, kind }), "utf8") });
  } catch {
    return undefined;
  }
}

/**
 * Claim a project id exclusively, BEFORE the create is attempted.
 *
 * @param home the state home
 * @param id the caller-chosen project UUID
 * @param nowIso the instant of the reservation
 * @returns `fresh` when this caller may proceed, `taken` when the id is already claimed
 */
export function reserveProject({ home, id, nowIso }: { home: string; id: string; nowIso: string }): ProjectReservation {
  return reserveObject({ home, id, kind: "linear-projects", nowIso });
}

/**
 * Claim an id exclusively for one reserve-then-confirm kind, BEFORE the create is attempted.
 *
 * @param kind which object family the id belongs to, which is also its ledger sub-directory
 * @returns `fresh` when this caller may proceed, `taken` when the id is already claimed
 */
function reserveObject({
  home,
  id,
  kind,
  nowIso,
}: {
  home: string;
  id: string;
  kind: ObjectLedgerKind;
  nowIso: string;
}): ProjectReservation {
  const record: ProjectRecord = { id, reservedIso: nowIso };
  if (createObjectRecordExclusively({ contents: JSON.stringify(record), home, id, kind })) {
    return { kind: "fresh" };
  }
  const existing = readObjectRecord({ home, id, kind });
  // An unwritable or unparseable slot counts as TAKEN, never as free — the fail-closed direction
  // `./issueLedger.ts` takes, and for the same reason: an unrecorded create is one nobody can reconcile.
  return { kind: "taken", record: existing ?? record };
}

/**
 * Record that the project create actually landed, with the identity Linear returned.
 *
 * @param home the state home
 * @param id the reserved project UUID
 * @param name Linear's name for it, as stored
 * @param url Linear's URL for it
 * @param nowIso when the create was confirmed
 */
export function confirmProject({
  home,
  id,
  name,
  url,
  nowIso,
}: {
  home: string;
  id: string;
  name: string;
  url: string;
  nowIso: string;
}): void {
  confirmObject({ home, id, kind: "linear-projects", name, nowIso, url });
}

/**
 * Record that a reserve-then-confirm create actually landed, with the identity Linear returned.
 *
 * @param kind which object family the id belongs to, which is also its ledger sub-directory
 * @param name Linear's own name for it, as stored
 * @param url Linear's URL for it
 */
function confirmObject({
  home,
  id,
  kind,
  name,
  url,
  nowIso,
}: {
  home: string;
  id: string;
  kind: ObjectLedgerKind;
  name: string;
  url: string;
  nowIso: string;
}): void {
  ensureObjectLedgerDir({ home, kind });
  const existing = readObjectRecord({ home, id, kind });
  const record: ProjectRecord = { confirmedIso: nowIso, id, name, reservedIso: existing?.reservedIso ?? nowIso, url };
  writeFileAtomic({ contents: JSON.stringify(record), path: recordPath({ home, id, kind }) });
}

/**
 * Release this invocation's own project, initiative or milestone create reservation after the create was refused
 * before the wire (`./reservationRelease.ts`): only an unconfirmed record carrying exactly this id and reservation
 * instant goes. Every kind's record carries those three fields, so one read serves all three.
 *
 * @param kind which object family the id belongs to, which is also its ledger sub-directory
 * @param reservedIso the instant this invocation reserved it at; undefined for an update, which took none, so
 *   nothing is released
 * @returns true when the reservation was removed
 */
export function releaseObjectReservation({
  home,
  id,
  kind,
  reservedIso,
}: {
  home: string;
  id: string;
  kind: ObjectLedgerKind;
  reservedIso: string | undefined;
}): boolean {
  return releaseUnconfirmedRecord({ id, parse: parseProjectRecord, path: recordPath({ home, id, kind }), reservedIso });
}

/** Why a project update was refused. A named reason, never a bare false. */
export type ProjectOwnership =
  { readonly owned: true; readonly record: ProjectRecord } | { readonly owned: false; readonly reason: string };

/**
 * Whether slopweaver may modify this project. Fails CLOSED on every uncertainty, same posture as
 * `ownershipOf` for issues: no record, or a record with no confirmation, both refuse.
 *
 * @param home the state home
 * @param id the project UUID
 * @returns ownership, or a named refusal
 */
export function ownershipOfProject({ home, id }: { home: string; id: string }): ProjectOwnership {
  return ownershipOfObject({ home, id, kind: "linear-projects", noun: "project" });
}

/**
 * Whether slopweaver may modify one reserve-then-confirm object. Fails CLOSED on every uncertainty.
 *
 * @param kind which object family the id belongs to, which is also its ledger sub-directory
 * @param noun what the refusal calls the object, so the reason a human reads names the right thing
 * @returns ownership, or a named refusal
 */
function ownershipOfObject({
  home,
  id,
  kind,
  noun,
}: {
  home: string;
  id: string;
  kind: ObjectLedgerKind;
  noun: string;
}): ProjectOwnership {
  const record = readObjectRecord({ home, id, kind });
  if (record === undefined) {
    return {
      owned: false,
      reason:
        `slopweaver has no record of creating ${noun} ${id}, so it will not modify it. Under a personal API ` +
        `key Linear attributes every write to you, so the ${noun} itself cannot prove who made it; this ` +
        "ledger is the only evidence, and it is absent.",
    };
  }
  if (record.confirmedIso === undefined) {
    return {
      owned: false,
      reason:
        `${noun} ${id} was reserved at ${record.reservedIso} but never confirmed, so whether it exists is ` +
        "unknown. Reconcile it with a read-back before editing.",
    };
  }
  return { owned: true, record };
}

/**
 * One initiative's ledger record, or undefined when it is absent or unreadable.
 *
 * @param home the state home
 * @param id the initiative UUID
 * @returns the record, or undefined when it is absent or unreadable
 */
export function readInitiativeRecord({ home, id }: { home: string; id: string }): ProjectRecord | undefined {
  return readObjectRecord({ home, id, kind: "linear-initiatives" });
}

/**
 * Claim an initiative id exclusively, BEFORE the create is attempted.
 *
 * @param home the state home
 * @param id the caller-chosen initiative UUID
 * @param nowIso the instant of the reservation
 * @returns `fresh` when this caller may proceed, `taken` when the id is already claimed
 */
export function reserveInitiative({
  home,
  id,
  nowIso,
}: {
  home: string;
  id: string;
  nowIso: string;
}): ProjectReservation {
  return reserveObject({ home, id, kind: "linear-initiatives", nowIso });
}

/**
 * Record that the initiative create actually landed, with the identity Linear returned.
 *
 * @param home the state home
 * @param id the reserved initiative UUID
 * @param name Linear's name for it, as stored
 * @param url Linear's URL for it
 * @param nowIso when the create was confirmed
 */
export function confirmInitiative({
  home,
  id,
  name,
  url,
  nowIso,
}: {
  home: string;
  id: string;
  name: string;
  url: string;
  nowIso: string;
}): void {
  confirmObject({ home, id, kind: "linear-initiatives", name, nowIso, url });
}

/**
 * Whether slopweaver may modify this initiative. Fails CLOSED on every uncertainty, the same posture
 * {@link ownershipOfProject} takes.
 *
 * @param home the state home
 * @param id the initiative UUID
 * @returns ownership, or a named refusal
 */
export function ownershipOfInitiative({ home, id }: { home: string; id: string }): ProjectOwnership {
  return ownershipOfObject({ home, id, kind: "linear-initiatives", noun: "initiative" });
}

/**
 * Every project id slopweaver has reserved, for reconciliation.
 *
 * @param home the state home the ledger lives under
 * @returns every reserved id — reserved, not necessarily confirmed
 */
export function listProjectIds({ home }: { home: string }): readonly string[] {
  try {
    return readdirSync(objectLedgerDir({ home, kind: "linear-projects" }))
      .filter((name) => name.endsWith(".json"))
      .map((name) => name.slice(0, -".json".length))
      .toSorted();
  } catch {
    return [];
  }
}

/**
 * Every record of one reserve-then-confirm kind slopweaver reserved, failing rather than reading as empty when the
 * ledger cannot be listed — the publication audit's inventory. A milestone record reads through the project parser,
 * whose shape is a superset of it (a milestone simply carries no `url`).
 *
 * @param home the state home the ledger lives under
 * @param kind which object family, which is also its ledger sub-directory
 * @returns the records and the unreadable-row count, empty when nothing was ever reserved, or the listing refusal
 */
export function listObjectRecords({
  home,
  kind,
}: {
  home: string;
  kind: ObjectLedgerKind;
}): Result<LedgerListing<ProjectRecord>, LedgerUnreadableError> {
  return listLedgerRecords({ directory: objectLedgerDir({ home, kind }), parse: parseProjectRecord });
}
