/**
 * The reservation ledger for `linear milestone` writes — the same at-most-once primitive `./issueLedger.ts` proves,
 * on the `linear-milestones` sub-directory `./projectLedger.ts` names among its reserve-then-confirm kinds.
 *
 * `ProjectMilestoneCreateInput` accepts a caller-chosen UUID v4 `id` (confirmed against the pinned `@linear/sdk` type
 * declarations, same as `IssueCreateInput`), so the id is reserved locally BEFORE the mutation, and a lost response
 * becomes something to look up rather than something to guess about.
 *
 * A milestone ledger record tracks reservation + confirmation only, with no ownership gate at all: this pass ships
 * milestone CREATE only (no update verb), so nothing ever reads milestone ownership. Adding the gate now would be
 * ceremony for a caller that does not exist yet. Releasing a refused reservation, and the audit's fallible listing,
 * go through `./projectLedger.ts`'s kind-generic `releaseObjectReservation` and `listObjectRecords`.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { writeFileAtomic } from "#lib/writeAtomic.js";

import { isRecord } from "../../lib/parsers.js";
import { createObjectRecordExclusively, ensureObjectLedgerDir, objectLedgerDir } from "./projectLedger.js";

/** One milestone slopweaver reserved. No ownership concept — see module doc. */
export interface MilestoneRecord {
  readonly id: string;
  readonly reservedIso: string;
  readonly name?: string | undefined;
  readonly confirmedIso?: string | undefined;
}

/** Whether this caller now holds the reservation for a milestone id. */
export type MilestoneReservation =
  { readonly kind: "fresh" } | { readonly kind: "taken"; readonly record: MilestoneRecord };

/** A UUID is already a safe filename, and it is the only thing that ever names a record here. */
function recordPath({ home, id }: { home: string; id: string }): string {
  return join(objectLedgerDir({ home, kind: "linear-milestones" }), `${id}.json`);
}

/**
 * Parse a milestone record, returning undefined when it is absent or unreadable.
 *
 * @param raw one persisted ledger line
 * @returns the record, or undefined when it is absent or unreadable
 */
export function parseMilestoneRecord({ raw }: { raw: string }): MilestoneRecord | undefined {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed) || typeof parsed["id"] !== "string" || typeof parsed["reservedIso"] !== "string") {
      return undefined;
    }
    const name = parsed["name"];
    const confirmedIso = parsed["confirmedIso"];
    return {
      id: parsed["id"],
      reservedIso: parsed["reservedIso"],
      ...(typeof name === "string" ? { name } : {}),
      ...(typeof confirmedIso === "string" ? { confirmedIso } : {}),
    };
  } catch {
    return undefined;
  }
}

/**
 * Read one milestone record, or undefined.
 *
 * @param home the state home the ledger lives under
 * @param id the milestone id to look up
 * @returns the record, or undefined when there is no such file or it cannot be read
 */
export function readMilestoneRecord({ home, id }: { home: string; id: string }): MilestoneRecord | undefined {
  try {
    return parseMilestoneRecord({ raw: readFileSync(recordPath({ home, id }), "utf8") });
  } catch {
    return undefined;
  }
}

/**
 * Claim a milestone id exclusively, BEFORE the create is attempted.
 *
 * @param home the state home
 * @param id the caller-chosen milestone UUID
 * @param nowIso the instant of the reservation
 * @returns `fresh` when this caller may proceed, `taken` when the id is already claimed
 */
export function reserveMilestone({
  home,
  id,
  nowIso,
}: {
  home: string;
  id: string;
  nowIso: string;
}): MilestoneReservation {
  const record: MilestoneRecord = { id, reservedIso: nowIso };
  if (createObjectRecordExclusively({ contents: JSON.stringify(record), home, id, kind: "linear-milestones" })) {
    return { kind: "fresh" };
  }
  const existing = readMilestoneRecord({ home, id });
  // An unwritable or unparseable slot counts as TAKEN, never as free, holding the record this caller meant.
  if (existing === undefined) {
    return { kind: "taken", record };
  }
  return { kind: "taken", record: existing };
}

/**
 * Record that the milestone create actually landed.
 *
 * @param home the state home
 * @param id the reserved milestone UUID
 * @param name Linear's name for it, as stored
 * @param nowIso when the create was confirmed
 */
export function confirmMilestone({
  home,
  id,
  name,
  nowIso,
}: {
  home: string;
  id: string;
  name: string;
  nowIso: string;
}): void {
  ensureObjectLedgerDir({ home, kind: "linear-milestones" });
  const existing = readMilestoneRecord({ home, id });
  // A confirm with no reservation on disk keeps the confirm instant as its reservation, the project ledger's reading.
  let reservedIso = nowIso;
  if (existing !== undefined) {
    reservedIso = existing.reservedIso;
  }
  const record: MilestoneRecord = { confirmedIso: nowIso, id, name, reservedIso };
  writeFileAtomic({ contents: JSON.stringify(record), path: recordPath({ home, id }) });
}

/**
 * Every milestone id slopweaver has reserved, for reconciliation.
 *
 * @param home the state home the ledger lives under
 * @returns every reserved id — reserved, not necessarily confirmed
 */
export function listMilestoneIds({ home }: { home: string }): readonly string[] {
  try {
    return readdirSync(objectLedgerDir({ home, kind: "linear-milestones" }))
      .filter((name) => name.endsWith(".json"))
      .map((name) => name.slice(0, -".json".length))
      .toSorted();
  } catch {
    return [];
  }
}
