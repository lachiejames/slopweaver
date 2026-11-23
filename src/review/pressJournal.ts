/**
 * The press register: every merge-queue press `slopweaver github landing --press` made, WITH its subject — the
 * pure half. Where it lives is `./pressJournalPort.ts`: the `landing_press` table in the store.
 *
 * ## Why this exists rather than the door ledger
 *
 * MEASURED: the door ledger holds 280 enqueue records and **no target**. By design it stores never a target id
 * and never a word of content, so the door ledger proves an enqueue happened at an instant and can never say which pull request it was. A press that a session makes
 * on the owner's behalf needs a register that names its subject — otherwise "what did we press today" is
 * unanswerable, and so is the question that actually matters: was this pull request already pressed and
 * silently evicted.
 *
 * ## The one thing it is for
 *
 * `github enqueue --dequeue` reverses a press in one command and is judged by nothing, so this register's
 * job is telling the owner a press HAPPENED, never gating one. Its load-bearing field is `headOid`: the
 * queue tests a branch merged with current base, which the pull request's own CI never built, so an entry
 * can be evicted minutes after it is taken. A press pinned to a head, compared against the head a later read
 * sees, is what turns *"it is not queued"* into *"we pressed it and GitHub dropped it, and nothing has
 * changed since"* — the one state where re-pressing re-runs the same failure forever.
 *
 * ## Strict on both sides
 *
 * A record that does not decode is a refusal naming it, on the one-time import of the old
 * `landing-presses.jsonl` and on a stored row alike. Dropping it would make a press that happened read as one
 * that did not, and the register's whole job is the opposite.
 */

import { parseStrictIsoInstantMs } from "#lib/date.js";
import { err, ok, type Result } from "#lib/result.js";

import { isRecord } from "../lib/parsers.js";
import { sha256Hex } from "../store/registerImport.js";
import type { RecordedPress } from "./landing.js";
import { type PressDecodeError, PressDecodeErrors } from "./pressJournalErrors.js";

/** One recorded press. */
export interface PressRecord {
  /** When the press was made. */
  readonly atIso: string;
  readonly repoSlug: string;
  readonly number: number;
  /** The head the press was pinned to — what makes a later eviction a comparison rather than a guess. */
  readonly headOid: string;
  /** The queue entry GitHub reported on the read-back, or the empty string when it reported none. */
  readonly entryState: string;
}

/** The one spelling of a repository a landing lookup uses: `owner/name`, no whitespace, exactly two segments. */
const PRESS_SLUG = /^[^\s/]+\/[^\s/]+$/u;

/** The key one pull request's presses are filed under. */
function subjectKey({ repoSlug, number }: { repoSlug: string; number: number }): string {
  return `${repoSlug}#${String(number)}`;
}

/**
 * The press's idempotency key: the sha-256 of its canonical tuple.
 *
 * A JSON array rather than a delimited string, so no repository slug or head can collide with another tuple by
 * containing the delimiter. Nothing is lower-cased: the register keeps every value as it was recorded.
 *
 * @param record the press
 * @returns the lower-case hex key `landing_press.press_key` holds
 */
export function pressKey({ record }: { record: PressRecord }): string {
  return sha256Hex({ text: JSON.stringify([record.repoSlug, record.number, record.headOid, record.atIso]) });
}

/**
 * Decode one record, strictly: every field present and well-formed, or the sentence saying which is not.
 *
 * Used for a line of the old file and for a stored row alike, so the two cannot disagree about what a press is.
 *
 * @param value the parsed line, or a stored row's fields
 * @returns the record, or why it is not one
 */
export function decodePressRecord({ value }: { value: unknown }): Result<PressRecord, PressDecodeError> {
  if (!isRecord(value)) {
    return err(PressDecodeErrors.notAnObject());
  }
  const { atIso, repoSlug, number, headOid, entryState } = value;
  // Strict, never `Date.parse`: that rolls a day past the end of February into March and would key the press on a guessed instant.
  if (typeof atIso !== "string" || parseStrictIsoInstantMs({ text: atIso }) === undefined) {
    return err(PressDecodeErrors.fieldInvalid({ field: "atIso", qualifier: "parseable" }));
  }
  // Only the `owner/name` a lookup spells: a slug with a space or a third segment files under a key no landing
  // read asks for, so the press would read as never made.
  if (typeof repoSlug !== "string" || !PRESS_SLUG.test(repoSlug)) {
    return err(PressDecodeErrors.fieldInvalid({ field: "repoSlug", qualifier: "owner/name" }));
  }
  if (typeof number !== "number" || !Number.isInteger(number) || number <= 0) {
    return err(PressDecodeErrors.fieldInvalid({ field: "number", qualifier: "positive integer" }));
  }
  if (typeof headOid !== "string" || headOid === "") {
    return err(PressDecodeErrors.fieldInvalid({ field: "headOid" }));
  }
  if (typeof entryState !== "string") {
    return err(PressDecodeErrors.fieldInvalid({ field: "entryState" }));
  }
  return ok({ atIso, entryState, headOid, number, repoSlug });
}

/**
 * The LATEST press for each pull request, keyed `owner/name#number`.
 *
 * Latest rather than first, because a head that moved and was pressed again is a different act: an eviction
 * is only interesting against the press that is still current. An equal instant goes to the later record,
 * which is why the store reads in insertion order.
 *
 * @param records every record the register holds, in insertion order
 * @returns one entry per pull request that has ever been pressed
 */
export function latestPresses({ records }: { records: readonly PressRecord[] }): ReadonlyMap<string, RecordedPress> {
  const latest = new Map<string, RecordedPress>();
  for (const record of records) {
    const key = subjectKey({ number: record.number, repoSlug: record.repoSlug });
    const existing = latest.get(key);
    if (existing === undefined || record.atIso >= existing.atIso) {
      latest.set(key, { atIso: record.atIso, headOid: record.headOid });
    }
  }
  return latest;
}

/**
 * The recorded press for one pull request, when the register holds one.
 *
 * @param presses the latest press per pull request
 * @param repoSlug the repository the pull request lives in
 * @param number the pull request number
 * @returns the press, or undefined when none was ever recorded
 */
export function pressFor({
  presses,
  repoSlug,
  number,
}: {
  presses: ReadonlyMap<string, RecordedPress>;
  repoSlug: string;
  number: number;
}): RecordedPress | undefined {
  return presses.get(subjectKey({ number, repoSlug }));
}
