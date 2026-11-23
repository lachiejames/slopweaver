/**
 * Whether the chair HAS a relay of the owner's, read off what the chair received rather than off the screen the relay
 * typed into — the grade the sweep's never-reached count rests on, and `talk log --turn --json` prints.
 *
 * A console call once told the owner that a steer was on the board but had not reached the supervisor chat, several
 * times in one call, while the steers were in fact getting through. MEASURED on the chair transcript:
 *
 * - one relay was recorded `stranded` a moment after the chair had already absorbed its line mid-turn, as a queued
 *   `attachment` ("The user sent a new message while you were working: [voice relay <slug>] …"). The screen read after
 *   the Enter graded a line the chair already held.
 * - another relay was `skipped (composer-busy)` and never typed, and the chair read the owner's words about a minute
 *   later through `talk unread`, whose supervisor cursor it then marked.
 *
 * Repro: `slopweaver talk log --turn <turn-id> --json`, then `grep -c '\[voice relay <slug>\]' <that chair transcript>`.
 *
 * So the chair has a relay on two pieces of evidence, in order of strength. A `line`: one of the chair chain's own
 * turns, typed or queued, IS the relay's delivery line (`./relayLine.ts`'s `relayLineSlug`, which refuses a marker that
 * is only mentioned), or is the quiet batch that listed it (`./chairBatchLine.ts`). A `read-unread`: the supervisor's `talk unread` cursor has read past the relay's OWN call line —
 * the `relay` line the page writes into the call file, carrying the turn id and the owner's words, queued after the speech it
 * relays. Neither an instant nor a coverage of instants is enough: a
 * mark records one batch that fits a tool result (`./unreadBatch.ts`), and the page posts transcript lines in batches of
 * their own (`site/lib/talkTranscript.ts`), so a cursor marked after the owner spoke can stop short of their words, or
 * be marked before they landed at all.
 *
 * The turns must be the chair CHAIN's (`../supervisor/intakeRead.ts`), never a search of every transcript, or a relay
 * line in some other session would read as the chair's.
 *
 * A chat line is matched by SLUG, which is the relay's identity everywhere already: the slug keys its board row, and
 * the delivery line and its `talk log` verify step carry nothing else (`./relayDraft.ts` `relaySlug`). The slug is
 * DERIVED here from the turn id, never taken from the row, so a row whose stored slug names another relay cannot
 * borrow that relay's line. Two turn ids
 * sharing their first 12 hex would share one board row before any receipt was read, so the residue is stated rather
 * than closed here: those 12 hex are 48 random bits of a v4 UUID, and closing it means a turn id in the
 * line the chair parses. The cursor half matches the whole turn id.
 *
 * The trust boundary, stated rather than discovered: the home's own files — call files, the cursor, the
 * chain journal, the turn rows — are read as this system writes them. A malformed or mismatched record withholds a
 * receipt; a process that FORGES a well-formed call line could as easily forge the turn row, the board and the chain,
 * so nothing a receipt read checks could defend against it — the same residue `.claude/rules/journalled-grants.md`
 * names for a grant row.
 */
import type { OwnerTurn } from "../supervisor/intake.js";
import { parseTurnPointer } from "../transcripts/pointer.js";

import { chairBatchMembers } from "./chairBatchLine.js";
import { relaySlug } from "./relayDraft.js";
import { relayLineSlug } from "./relayLine.js";
import type { UnreadRead } from "./unreadWords.js";

/** How far the supervisor cursor has read: when it was marked, and every relay whose own call line is behind it. */
export interface CursorCoverage {
  readonly recordedAtIso: string;
  /** The turn id of every relay line behind the cursor's frontier, in any call. */
  readonly relaysRead: ReadonlySet<string>;
}

/**
 * How the chair has a relay: its delivery line in a chair turn, or its words read through `talk unread`. Either arm
 * names the relay turn it was read for, stamped where it was read, so no later step can hand it to another relay.
 */
export type ChairReceipt =
  | {
      readonly kind: "line";
      readonly turnId: string;
      /** The chair turn carrying the line, `transcript:<sessionId>#<turnUuid>`. */
      readonly pointer: string;
      /** The turn's instant; a turn whose record carries none gives no receipt at all. */
      readonly atIso: string;
    }
  | {
      readonly kind: "read-unread";
      readonly turnId: string;
      /** When the supervisor cursor was marked. */
      readonly atIso: string;
    };

/**
 * Whether a chair turn can carry a receipt: a canonical instant, the round trip the console's `instant` read applies,
 * and a pointer naming a real session and turn. A malformed record withholds a
 * receipt rather than supplying one.
 */
function isWellFormed({ turn }: { turn: OwnerTurn }): boolean {
  const at = Date.parse(turn.timestamp);
  const canonical = !Number.isNaN(at) && new Date(at).toISOString() === turn.timestamp;
  return canonical && parseTurnPointer({ text: turn.pointer }) !== undefined;
}

/**
 * Whether a chair turn is a line that carried one relay: its own delivery line, or a quiet batch
 * (`./chairBatchLine.ts`) that lists its slug. A batch that only COUNTS it under `+N more` carries no receipt.
 */
function carriesRelay({ slug, text }: { slug: string; text: string }): boolean {
  if (relayLineSlug({ text }) === slug) {
    return true;
  }
  const batch = chairBatchMembers({ text });
  return batch?.listed.some((anchor) => anchor.kind === "relay" && anchor.slug === slug) === true;
}

/**
 * How far one read of the call files says the cursor has read.
 *
 * @param read one `talk unread` read of the supervisor cursor
 * @returns the coverage, or `undefined` when the cursor was never marked
 */
export function cursorCoverageOf({ read }: { read: UnreadRead }): CursorCoverage | undefined {
  if (read.cursor === undefined) {
    return undefined;
  }
  return {
    recordedAtIso: read.cursor.recordedAtIso,
    relaysRead: new Set(read.tails.flatMap((tail) => tail.relaysBefore)),
  };
}

/**
 * The receipt the chair holds for one relay, or `undefined` when it holds none.
 *
 * @param turnId the relay's whole turn id, which its call line carries and its delivery line's slug derives from
 * @param turns the chair chain's turns, typed and queued, from at least when the owner said it
 * @param cursor how far the supervisor's unread cursor has read, `undefined` when it never was marked or could not
 *   be read
 * @returns a `line` receipt when a chair turn is its delivery line, else a `read-unread` one, else `undefined`
 */
export function chairReceiptOf({
  turnId,
  turns,
  cursor,
}: {
  turnId: string;
  turns: readonly OwnerTurn[];
  cursor: CursorCoverage | undefined;
}): ChairReceipt | undefined {
  const slug = relaySlug({ turnId });
  const line = turns.find((turn) => carriesRelay({ slug, text: turn.text }) && isWellFormed({ turn }));
  if (line !== undefined) {
    return { atIso: line.timestamp, kind: "line", pointer: line.pointer, turnId };
  }
  if (cursor === undefined || !cursor.relaysRead.has(turnId)) {
    return undefined;
  }
  return { atIso: cursor.recordedAtIso, kind: "read-unread", turnId };
}
