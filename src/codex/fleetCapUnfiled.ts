/**
 * A fleet read that tried to file its fleet-cap record and may not have — the marker that keeps the monitor from
 * reading an older record as the fleet's state.
 *
 * ## Why this exists
 *
 * A filing that fails warns and returns, because routing outranks the note. Before this marker the record then stayed
 * whatever an EARLIER read had filed, so a t1 read with one account eligible kept `codex-fleet-capped` clear while a
 * t2 read had already seen every account capped and failed to say so. Measured by a Codex review of the store move;
 * the warn-and-return was on the file store before it too.
 *
 * ## How it is ordered
 *
 * The marker carries the fleet read's own `readAtIso`, never the clock at filing time: a slow read finishing late must
 * not outrank a quicker, later one, exactly as the record's own upsert orders. A marker supersedes the record only
 * when it is STRICTLY later — a record filed at the marker's own instant is that attempt landing. Nothing clears it;
 * the next record filed at or after it settles it. It is only ever written onto a row that already holds a record:
 * with none filed the monitor already reads "absent", which is unmeasurable too.
 *
 * ## What it cannot see
 *
 * A store that refuses the marker as well as the record leaves no trace, so the monitor reads the earlier record
 * again once the store answers, until the next fleet read files. The marker is written BEFORE the record, in the same
 * connection, so the window it leaves is a store that fails before either statement, not one failing between them.
 *
 * Pure: decoded and judged here; `./fleetCapPort.ts` writes it beside the record in the store row.
 */
import { parseIsoMs } from "#lib/date.js";
import { isRecord } from "#lib/parsers.js";

import type { CodexFleetCapRecord } from "./fleetCapRecord.js";

/** One fleet read's attempt to file, at that read's own instant, and why it is not known to have landed. */
export interface CodexFleetCapUnfiled {
  /** The attempting read's `readAtIso`, ISO-8601 as `toISOString` writes it. */
  readonly attemptedAtIso: string;
  /** What is known about the attempt: that it had not finished, or the store's refusal of it. */
  readonly why: string;
}

/** The reason a marker carries before the record's own write has answered. */
export const FILING_UNFINISHED = "the fleet read had not finished filing its record";

/**
 * Decode a stored marker's JSON, or say which field stops it decoding.
 *
 * @param value the stored JSON
 * @returns the marker, or why it is not one
 */
export function decodeCodexFleetCapUnfiled({
  value,
}: {
  value: unknown;
}): { readonly unfiled: CodexFleetCapUnfiled } | { readonly why: string } {
  if (!isRecord(value)) {
    return { why: "is not a JSON object" };
  }
  const { attemptedAtIso, why } = value;
  const ms = typeof attemptedAtIso === "string" ? parseIsoMs({ tsIso: attemptedAtIso }) : undefined;
  if (typeof attemptedAtIso !== "string" || ms === undefined || new Date(ms).toISOString() !== attemptedAtIso) {
    return { why: `carries attemptedAtIso ${JSON.stringify(attemptedAtIso)}, which is not an instant` };
  }
  if (typeof why !== "string" || why.length === 0) {
    return { why: "carries no reason" };
  }
  return { unfiled: { attemptedAtIso, why } };
}

/**
 * Whether a marker means the filed record no longer describes the fleet: the record was judged strictly earlier.
 *
 * @param record the record filed now
 * @param unfiled the latest attempt's marker
 * @returns true when the monitor must not judge the record
 */
export function unfiledSupersedesRecord({
  record,
  unfiled,
}: {
  record: CodexFleetCapRecord;
  unfiled: CodexFleetCapUnfiled;
}): boolean {
  return Date.parse(unfiled.attemptedAtIso) > Date.parse(record.readAtIso);
}
