/**
 * Which record a `transcript:` intake mark may name — one `supervisor intake` would ever credit — judged against what
 * the transcript holds. Apart from `./intake.ts` because it judges the WRITE, where that module reads the ledger.
 *
 * Pure: the parsed pointer and the transcript's records in, a refusal or nothing out. The read is
 * `./chairTranscript.ts`'s `readMarkableRecords`.
 */
import type { Result } from "../lib/result.js";
import { formatTurnPointer, type TurnPointer } from "../transcripts/pointer.js";

/** The records of one transcript a `transcript:` mark can witness — the only two kinds intake reads a mark on. */
export interface MarkableRecords {
  /** The owner's turns, typed or queued mid-turn: what the owner-turn check reads a mark on. */
  readonly ownerTurnUuids: ReadonlySet<string>;
  /** Every record of a message another session sent: what `./inbound.ts` clears on a mark naming any of them. */
  readonly inboundUuids: ReadonlySet<string>;
}

/**
 * Why a `transcript:` mark would witness nothing, or `undefined` when it names a record intake reads.
 *
 * A pointer that parses is not one that lands. MEASURED on one chair: it
 * found uuids with `grep … | tail -1 | jq .uuid`, which returned its own assistant records; both marks were
 * written, exited 0 and witnessed nothing, so two of the owner's turns stayed
 * unwitnessed. Reproduce the read with `slopweaver supervisor intake --session
 * <session-id> --json`. A transcript that will not read refuses too: "could not check"
 * must never read as "names the owner's turn".
 *
 * @param pointer the parsed `transcript:` pointer being marked
 * @param records what that transcript holds, or why it would not read
 * @returns the one-line refusal, or `undefined` when the mark may be written
 */
export function markTargetRefusal({
  pointer,
  records,
}: {
  pointer: TurnPointer;
  records: Result<MarkableRecords>;
}): string | undefined {
  const named = formatTurnPointer({ pointer });
  if (records.isErr()) {
    return `${named} cannot be checked — its transcript would not read: ${records.error.join("; ")}`;
  }
  if (records.value.ownerTurnUuids.has(pointer.turnUuid) || records.value.inboundUuids.has(pointer.turnUuid)) {
    return undefined;
  }
  return (
    `${named} names neither one of the owner's turns nor a message another session sent, so a mark on it witnesses ` +
    `nothing — list the owner's turns with \`slopweaver supervisor intake --session ${pointer.sessionId}\``
  );
}
