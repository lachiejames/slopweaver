/**
 * A pointer to ONE turn in ONE transcript — the anchor form for something the owner typed into a session.
 *
 * ## Why a turn needs an address at all
 *
 * A board row's `anchor:` says where the owner said a thing, and until now the only anchor anyone could write was a
 * Slack permalink or a GitHub URL. An ask typed straight into the supervisor chat had no address, so nothing
 * on the board could point back at it, and nothing reading the board could tell which of the owner's turns had been
 * acted on. Measured (`slopweaver transcripts turns --session <id> --json` over two supervisor
 * sessions): fifteen owner turns, eighty-seven ask rows on the board, and not one row
 * anchored to any of the fifteen — the answer to one of them was composed in the chat and died
 * with that session.
 *
 * ## The shape
 *
 * `transcript:<sessionId>#<turnUuid>`. The session id is the transcript's basename on disk and the uuid is
 * the record's own, so the pointer is CHECKABLE in one read — `../supervisor/chairTranscript.ts` walks the file
 * and either finds the record or refuses the anchor. Both halves are UUID-shaped, which is what the parser
 * insists on: a pointer that names a session by workspace title or a turn by its line number would rot the
 * first time either moved.
 *
 * Pure: strings in, a pointer or `undefined` out.
 */

/** One addressed turn: the transcript it lives in, and the record's own uuid inside it. */
export interface TurnPointer {
  /** The Claude session id — the transcript's basename without `.jsonl`. */
  readonly sessionId: string;
  /** The record's own `uuid`, as the transcript line carries it. */
  readonly turnUuid: string;
}

/** The scheme every turn pointer starts with. */
export const TURN_POINTER_SCHEME = "transcript:";

/** A canonical, lower-case, hyphenated UUID — what Claude Code writes for both a session id and a record uuid. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * Render a pointer as the one string form the board and the intake ledger both store.
 *
 * @param pointer the turn to address
 * @returns `transcript:<sessionId>#<turnUuid>`
 */
export function formatTurnPointer({ pointer }: { pointer: TurnPointer }): string {
  return `${TURN_POINTER_SCHEME}${pointer.sessionId}#${pointer.turnUuid}`;
}

/**
 * Read a pointer back out of its string form, refusing anything that is not exactly one.
 *
 * Strict on purpose: a board anchor that LOOKS like a transcript pointer but carries a workspace name or a
 * line number would silently never match any turn, which is the quiet failure the whole intake check exists
 * to make loud. An anchor this does not parse is simply not a transcript pointer — a Slack permalink, say —
 * and the caller treats it as such rather than as a defect.
 *
 * @param text the candidate anchor
 * @returns the pointer, or `undefined` when the text is not a well-formed turn pointer
 */
export function parseTurnPointer({ text }: { text: string }): TurnPointer | undefined {
  const trimmed = text.trim();
  if (!trimmed.startsWith(TURN_POINTER_SCHEME)) {
    return undefined;
  }
  const body = trimmed.slice(TURN_POINTER_SCHEME.length);
  const hash = body.indexOf("#");
  if (hash === -1) {
    return undefined;
  }
  const sessionId = body.slice(0, hash);
  const turnUuid = body.slice(hash + 1);
  if (!UUID.test(sessionId) || !UUID.test(turnUuid)) {
    return undefined;
  }
  return { sessionId, turnUuid };
}
