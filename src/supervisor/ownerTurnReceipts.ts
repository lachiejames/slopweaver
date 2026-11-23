/**
 * THE BOOT CHECK'S LEDGER — which owner turns a chair has actually read, per session.
 *
 * ## Why a receipt rather than an honour system
 *
 * A chair that reads everything the owner said over the last week knows what is expected of it; one that does
 * not repeats the same misalignment every day. Every supervisor skill and
 * every successor boot block tells the next chair to read the owner's turns; `../supervisor/stateDoc.ts` carries
 * the measurement of what that instruction is worth — eleven chairs read 12.9% of the doc holding it.
 *
 * So reading is RECORDED. `slopweaver supervisor owner-turns` prints the owner's turns verbatim and appends one row
 * here per turn it printed, naming the session that printed them; `slopweaver cmux takeover` refuses to move
 * the pin while any turn in the window has no row for the session taking it. A chair cannot claim to have
 * read them, because nothing here takes a claim — the row is written by the act of printing.
 *
 * ## What a receipt is NOT evidence of
 *
 * That the words went past the chair's eyes, not that it understood them. Stated because the alternative is
 * a reader believing this ledger measures comprehension: it measures delivery, which is the half that was
 * mechanically missing. The other half is judgement and always was.
 *
 * Pure: rows in, rows out. `./ownerTurnReceiptStore.ts` does the I/O.
 */

import { sha256Text } from "#lib/hash.js";
import { isRecord } from "../lib/parsers.js";
import { recordedSupervisorSession, sameSupervisorSession, type VisibleSupervisorSession } from "./session.js";

/** One turn, delivered to one session. */
export interface OwnerTurnReceipt {
  /** `transcript:<session>#<uuid>`, or `ruling:<archive file>#<line>` — whatever addressed the turn. */
  readonly pointer: string;
  /**
   * The session that printed it — a Claude Code session or a Codex thread, matched on host AND id, so a receipt
   * one host's session earned never counts for the other host's session sharing its opaque id. A row written
   * before the chair could be Codex carries `claudeSessionId` and reads as Claude.
   */
  readonly session: VisibleSupervisorSession;
  /** When it was printed. */
  readonly readAtIso: string;
  /** How many bytes of the owner's words the print carried, so a reader can tell a whole turn from a stub. */
  readonly bytes: number;
  /**
   * The SHA-256 of an archived ruling row's exact words, on a `ruling:` receipt only. A ruling is identified by its
   * words, and its pointer by the file and line one copy of it sat on when it was printed; a receipt written before
   * this field carries none and reads no ruling ({@link readTurnPointers}).
   */
  readonly textSha256?: string;
}

/**
 * Parse one journal line.
 *
 * @param line one JSONL line
 * @returns the receipt, or `undefined` for a blank or malformed line — a bad line never costs the rows behind it
 */
export function parseOwnerTurnReceipt({ line }: { line: string }): OwnerTurnReceipt | undefined {
  if (line.trim().length === 0) {
    return undefined;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return undefined;
  }
  if (!isRecord(parsed)) {
    return undefined;
  }
  const pointer = parsed["pointer"];
  const session = recordedSupervisorSession({ record: parsed });
  const readAtIso = parsed["readAtIso"];
  const bytes = parsed["bytes"];
  if (typeof pointer !== "string" || session === undefined || typeof readAtIso !== "string") {
    return undefined;
  }
  const textSha256 = parsed["textSha256"];
  const receipt = { bytes: typeof bytes === "number" ? bytes : 0, pointer, readAtIso, session };
  if (typeof textSha256 === "string") {
    return { ...receipt, textSha256 };
  }
  return receipt;
}

/**
 * Which pointers one session already holds receipts for.
 *
 * @param receipts every row in the journal
 * @param session the session asking, host and id
 * @returns the pointers that session has been shown
 */
export function receiptedPointers({
  receipts,
  session,
}: {
  receipts: readonly OwnerTurnReceipt[];
  session: VisibleSupervisorSession;
}): ReadonlySet<string> {
  return new Set(
    receipts
      .filter((receipt) => sameSupervisorSession({ left: receipt.session, right: session }))
      .map((receipt) => receipt.pointer),
  );
}

/** One of the owner's turns as the reader hands it over: addressed, dated, and carrying their own words. */
export interface ReadableTurn {
  readonly pointer: string;
  readonly instantIso: string;
  readonly text: string;
  /** Where it was read from, so a reader can tell a chair transcript from an archived ruling row. */
  readonly source: "chair" | "ruling";
}

/** How every archived ruling row's pointer opens: `ruling:<archive path>#<line>`. */
export const RULING_POINTER_PREFIX = "ruling:";

/**
 * Keep ONE turn per archived ruling's words: the earliest copy, by instant and then pointer.
 *
 * Every `supervisor state-archive` writes a new archive file carrying the live RULINGS block forward, so one
 * ruling sits in many files at many `ruling:<path>#<line>` pointers. MEASURED on a real install: the
 * 7-day window held 15 ruling rows and 2 distinct texts (reproduce with `yarn tsx -e` over
 * `archivedRulings({ archiveDir, sinceMs })` and a `Set` of `.text`). A chair reads each ruling once, not once
 * per archive that carried it. Chair turns pass through untouched: their pointers are transcript uuids.
 *
 * @param turns every turn in the window
 * @returns the chair turns, and one turn per distinct ruling text
 */
export function collapseRulingCopies({ turns }: { turns: readonly ReadableTurn[] }): readonly ReadableTurn[] {
  const earliest = new Map<string, ReadableTurn>();
  for (const turn of turns) {
    if (turn.source !== "ruling") {
      continue;
    }
    const held = earliest.get(turn.text);
    if (held === undefined || earlierCopy({ left: turn, right: held })) {
      earliest.set(turn.text, turn);
    }
  }
  const kept = new Set(earliest.values());
  return turns.filter((turn) => turn.source !== "ruling" || kept.has(turn));
}

/** Whether `left` is the earlier of two copies: by instant, then by pointer, so the pick never depends on order. */
function earlierCopy({ left, right }: { left: ReadableTurn; right: ReadableTurn }): boolean {
  const byInstant = left.instantIso.localeCompare(right.instantIso);
  if (byInstant !== 0) {
    return byInstant < 0;
  }
  return left.pointer < right.pointer;
}

/**
 * The window's pointers one session has read. A chair turn is read by its pointer, which is a transcript uuid and
 * never moves. An archived ruling is read by its WORDS — the `textSha256` on one of this session's `ruling:`
 * receipts — and never by its pointer, because the line a pointer names may since hold other words.
 *
 * The defect this closes: `state-archive` writes a new archive file, the older ruling it carries gets a fresh
 * `ruling:<path>#<line>` pointer, and `cmux takeover` would refuse a chair that had already been shown those
 * exact words under other pointers.
 *
 * A receipt written before `textSha256` existed reads no ruling. Resolving its pointer through the archive is
 * refused: a line can be rewritten and a file's mtime preserved across the rewrite, so nothing on disk proves
 * which words it printed. The cost is bounded and paid once: a chair whose session spans the change re-reads
 * the window's distinct rulings (2 on the measured install), and every print after it writes the hash.
 *
 * @param turns the turns in the window
 * @param receipts every receipt on record; only `session`'s count
 * @param session the session asking, host and id
 * @returns the pointers of the window's turns this session has been shown
 */
export function readTurnPointers({
  turns,
  receipts,
  session,
}: {
  turns: readonly ReadableTurn[];
  receipts: readonly OwnerTurnReceipt[];
  session: VisibleSupervisorSession;
}): ReadonlySet<string> {
  const mine = receipts.filter((receipt) => sameSupervisorSession({ left: receipt.session, right: session }));
  const readWords = new Set<string>();
  for (const receipt of mine) {
    // Only a ruling receipt answers for a ruling's words: a hash on a chair receipt is no claim about the archive
    // The journal itself is written by this verb and authenticates nothing, exactly as a
    // pointer receipt never did — `./ownerTurnReceiptStore.ts`.
    if (receipt.pointer.startsWith(RULING_POINTER_PREFIX) && receipt.textSha256 !== undefined) {
      readWords.add(receipt.textSha256);
    }
  }
  const readPointers = new Set(mine.map((receipt) => receipt.pointer));
  const read = new Set<string>();
  for (const turn of turns) {
    const isRead =
      turn.source === "ruling" ? readWords.has(sha256Text({ text: turn.text })) : readPointers.has(turn.pointer);
    if (isRead) {
      read.add(turn.pointer);
    }
  }
  return read;
}

/**
 * The receipt for one printed turn. A ruling's carries the hash of its words, which is what {@link readTurnPointers}
 * reads it by under any other archive file's pointer; a chair turn's pointer is a transcript uuid and needs nothing
 * more.
 *
 * @param turn the turn just printed
 * @param session the session it was printed to
 * @param readAtIso the instant it was printed
 * @returns the row to append
 */
export function receiptForTurn({
  turn,
  session,
  readAtIso,
}: {
  turn: ReadableTurn;
  session: VisibleSupervisorSession;
  readAtIso: string;
}): OwnerTurnReceipt {
  const receipt = { bytes: turn.text.length, pointer: turn.pointer, readAtIso, session };
  if (turn.source === "ruling") {
    return { ...receipt, textSha256: sha256Text({ text: turn.text }) };
  }
  return receipt;
}

/**
 * How many bytes of the owner's words one call of the verb prints.
 *
 * MEASURED on a real install: seven days of the owner's turns through the widened chain read is
 * **238 turns, 488,214 bytes** (reproduce with `slopweaver supervisor intake --since <7d ago> --json | jq
 * '[.finding.turns[].turn.text|length]|add'`). A chunk of 60 KiB is about fifteen thousand tokens, so the
 * whole week is eight calls — bounded, resumable, and each one a page a chair can actually hold. A single
 * print of the week would not fit in one tool result at all, which is the failure mode this replaces: a
 * verb that cannot deliver is a gate nobody can pass.
 */
export const OWNER_TURN_CHUNK_BYTES = 61_440;

/** What one call of the verb should deliver, and what remains after it. */
export interface TurnChunk {
  /** The turns to print now, oldest first. */
  readonly turns: readonly ReadableTurn[];
  /** How many unread turns remain after this chunk. */
  readonly remaining: number;
  /** How many bytes of the owner's words remain after this chunk. */
  readonly remainingBytes: number;
}

/**
 * Take the next chunk of unread turns, oldest first.
 *
 * A turn larger than the whole budget is delivered ALONE rather than split or skipped: the owner's long voice dumps
 * are the ones that carry the rulings, and half of one is worse than one whole one a call later. A budget of
 * ZERO takes nothing at all, which is how `cmux takeover` counts what is unread without spending a receipt
 * on turns nobody has been shown.
 *
 * @param turns every turn in the window, in any order
 * @param alreadyRead the pointers this session has receipts for
 * @param budgetBytes how many bytes of the owner's words this call may carry, defaulting to {@link OWNER_TURN_CHUNK_BYTES}
 * @returns the chunk and what is left behind it
 */
export function nextTurnChunk({
  turns,
  alreadyRead,
  budgetBytes = OWNER_TURN_CHUNK_BYTES,
}: {
  turns: readonly ReadableTurn[];
  alreadyRead: ReadonlySet<string>;
  budgetBytes?: number;
}): TurnChunk {
  const unread = turns
    .filter((turn) => !alreadyRead.has(turn.pointer))
    .toSorted((left, right) => left.instantIso.localeCompare(right.instantIso));
  const taken: ReadableTurn[] = [];
  let spent = 0;
  for (const turn of unread) {
    const fits = taken.length === 0 ? budgetBytes > 0 : spent + turn.text.length <= budgetBytes;
    if (!fits) {
      break;
    }
    taken.push(turn);
    spent += turn.text.length;
  }
  const left = unread.slice(taken.length);
  return {
    remaining: left.length,
    remainingBytes: left.reduce((total, turn) => total + turn.text.length, 0),
    turns: taken,
  };
}
