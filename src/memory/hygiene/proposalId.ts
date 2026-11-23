/**
 * A proposal's stable identity — the one thing that makes a refused proposal stay refused.
 *
 * ## Why it is a hash of exactly two fields
 *
 * `reflect/finding.ts`'s header states this as a ship condition rather than a nicety: a loop that re-mints
 * ids re-proposes what the owner already dropped. So the id is derived from the CHECK and the SUBJECT and
 * from nothing else. A summary moves the moment a count in it moves; a timestamp moves every run; the
 * recommendation itself moves when the adversarial arm demotes a drop to an adjust — and none of those is a
 * different decision, so none of them may mint a different id.
 *
 * The recommendation being excluded is the subtle one and it is deliberate. If the owner refuses "drop
 * `foo.md` as a duplicate", and next week the arm demotes the same finding to "adjust `foo.md`", that is the
 * same conversation the owner already ended. A fresh id there would put it back in front of the owner.
 *
 * Pure: no filesystem, no clock, no randomness.
 */
import { createHash } from "node:crypto";

/**
 * How many hex characters of the digest an id carries.
 *
 * Twelve. The corpus this runs over is measured in tens of files and the ledger in hundreds of rows, so
 * collision is not the constraint — legibility is: an id a human can read out of a card and paste into
 * `memory grade` without a copy-paste is the whole point of shortening it at all.
 *
 * @internal
 */
export const PROPOSAL_ID_LENGTH = 12;

/**
 * The byte that separates the fields inside the hashed string.
 *
 * A zero byte rather than a printable character, because no filename, check id or joined pair can contain
 * one — so no pair of (check, subject) values can be spelled two ways and collide. A hyphen would let
 * `("duplicate-a", "b")` and `("duplicate", "a-b")` hash identically.
 */
const FIELD_SEPARATOR = "\u0000";

/**
 * The stable id for one proposal.
 *
 * @param check the check that produced it
 * @param subject what the proposal is about — a leaf basename, a separator-joined sorted pair, or `MEMORY.md`
 * @returns the first {@link PROPOSAL_ID_LENGTH} hex characters of the digest
 */
export function proposalId({ check, subject }: { check: string; subject: string }): string {
  return createHash("sha256").update(`${check}${FIELD_SEPARATOR}${subject}`).digest("hex").slice(0, PROPOSAL_ID_LENGTH);
}

/**
 * The subject for a proposal about a PAIR of memories, spelled so it cannot depend on iteration order.
 *
 * @param files the two basenames, in any order
 * @returns the sorted pair, separator-joined
 */
export function pairSubject({ files }: { files: readonly string[] }): string {
  return [...files].toSorted().join(FIELD_SEPARATOR);
}

/**
 * The subject for a proposal about one REFERENT inside one memory.
 *
 * Two dead paths named by one memory are two decisions — the owner may well want one fixed and the other left — so
 * the referent is part of the subject rather than only of the summary.
 *
 * @param file the memory's basename
 * @param referent the referent as it was written in the memory
 * @returns the separator-joined subject
 */
export function referentSubject({ file, referent }: { file: string; referent: string }): string {
  return `${file}${FIELD_SEPARATOR}${referent}`;
}

/**
 * A subject rendered for a human — the separator is invisible in a terminal, so it must never be printed raw.
 *
 * @param subject a subject that may carry the field separator
 * @returns the same subject with each separator shown as ` + `
 */
export function readableSubject({ subject }: { subject: string }): string {
  return subject.split(FIELD_SEPARATOR).join(" + ");
}
