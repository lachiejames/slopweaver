/**
 * What a `talk unread` report says about the gone calls it went past on a quarantine (`src/talk/callQuarantineLedger.ts`)
 * — in both shapes, and on every read, so an accepted loss is never silent.
 */
import type { CallQuarantineRow } from "../../../talk/callQuarantineLedger.js";
import type { UnreadRead } from "../../../talk/unreadWords.js";

/**
 * The most quarantined calls one report names one by one. Every report names them, so an unbounded list would grow
 * past what a batch prints and refuse every mark; the count is always whole, and the ledger holds the rest.
 */
export const QUARANTINE_NAMED_MAX = 5;

/**
 * The plain-text line naming every gone call this read went past on a quarantine, even with nothing unread.
 *
 * @param read the read, carrying what it went past
 * @returns that one line, or none when it went past none
 */
export function quarantineLines({ read }: { read: UnreadRead }): readonly string[] {
  const { quarantined } = read;
  if (quarantined.length === 0) {
    return [];
  }
  const named = quarantined
    .slice(0, QUARANTINE_NAMED_MAX)
    .map((row) => `${row.callId} (accepted ${row.atIso})`)
    .join(", ");
  const rest =
    quarantined.length > QUARANTINE_NAMED_MAX ? `, and ${String(quarantined.length - QUARANTINE_NAMED_MAX)} more` : "";
  return [
    `talk unread: went past ${String(quarantined.length)} gone call(s) whose loss is quarantined on the record, ` +
      `not read: ${named}${rest} — talk/call-quarantine.jsonl says why`,
  ];
}

/**
 * The `--json` report's `quarantined` field: the whole count, and the first rows named.
 *
 * @param read the read, carrying what it went past
 * @returns the count and at most {@link QUARANTINE_NAMED_MAX} rows
 */
export function quarantineJson({ read }: { read: UnreadRead }): {
  readonly count: number;
  readonly named: readonly CallQuarantineRow[];
} {
  return { count: read.quarantined.length, named: read.quarantined.slice(0, QUARANTINE_NAMED_MAX) };
}
