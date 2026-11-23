/**
 * The owner's turns as a held rollover waits them out (`pageRolloverHold`, `./callRolloverFloor.ts`): which are still
 * open, and the newest ended one the voice has not spoken words since. Pure, folded inside the activity fold
 * (`./voiceActivity.ts`) off the session's ordered turn stream and the owner's typed turns, never by comparing a voice
 * clock value with the owner's.
 *
 * Why: a held ask went ahead on a breath inside a 72s turn of the owner's.
 */

/**
 * How far an event on the server's stream may trail what the realtime session carried before it: a Codex turn's end
 * after the voice's answer (`END_SKEW_MS`, `./voiceActivity.ts`), or the owner's typed turn after words the voice said
 * first. A judgement, not a measurement — the probe that measured the rest stopped its turn before it completed.
 */
export const STREAM_SKEW_MS = 5_000;

/**
 * Ended turns of the owner's the voice owes words to: when the newest ended, which the hold is bounded from, and the
 * instant from which the voice's words answer every one of them — the latest any of them needs, so a spoken final
 * after a typed turn never waives the typed turn's skew.
 */
export interface OwnerAwaiting {
  readonly sinceMs: number;
  readonly answerFromMs: number;
}

/** The owner's turns as the fold carries them. */
export interface OwnerTurns {
  /**
   * Each turn of the owner's still open, by its id, to when its newest segment arrived; a turn leaves once its own
   * final came, so neither a typed turn nor another turn's final closes it.
   */
  readonly open: ReadonlyMap<string, number>;
  /**
   * The owner's newest ended turn the voice has not spoken words since, `undefined` once it has: set by the turn's
   * final, spoken or typed, and cleared by the next `spoke` folded after it.
   */
  readonly awaiting: OwnerAwaiting | undefined;
  /**
   * The open turns a LATER spoken turn of the owner's has ended past — open when their newest spoken final was folded,
   * and given no segment since. Judged by fold order, never by comparing clock values, since two events can share one.
   * A typed turn supersedes nothing: the composer takes one while the owner is still speaking.
   */
  readonly superseded: ReadonlySet<string>;
}

/** No turn of the owner's yet. */
export const NO_OWNER_TURNS: OwnerTurns = { awaiting: undefined, open: new Map(), superseded: new Set() };

/** What moves the owner's turns: a segment of a spoken one, a typed one, or the voice speaking words. */
export type OwnerTurnEvent =
  | { readonly kind: "segment"; readonly id: string; readonly final: boolean }
  | { readonly kind: "typed" }
  | { readonly kind: "spoke" };

/**
 * The owner's turns after one event. A spoken turn ends on the same ordered stream the voice's words arrive on, so the
 * next `spoke` answers it. A typed one arrives over the server's stream, so words the voice said before it can still
 * land after it: only words {@link STREAM_SKEW_MS} past it answer it.
 *
 * @param turns the owner's turns before the event
 * @param event what arrived
 * @param nowMs when it was folded, on the fold's clock
 * @returns the owner's turns after it
 */
export function foldVoiceOwnerTurns({
  turns,
  event,
  nowMs,
}: {
  turns: OwnerTurns;
  event: OwnerTurnEvent;
  nowMs: number;
}): OwnerTurns {
  if (event.kind === "typed") {
    // Supersedes nothing: the owner can type while a spoken turn of theirs is still open, so a typed turn proves no
    // final lost.
    return { ...turns, awaiting: ended({ answerFromMs: nowMs + STREAM_SKEW_MS, awaiting: turns.awaiting, nowMs }) };
  }
  if (event.kind === "spoke") {
    if (turns.awaiting === undefined || nowMs < turns.awaiting.answerFromMs) {
      return turns;
    }
    return { ...turns, awaiting: undefined };
  }
  const open = new Map(turns.open);
  if (!event.final) {
    open.set(event.id, nowMs);
    const superseded = new Set(turns.superseded);
    superseded.delete(event.id);
    return { ...turns, open, superseded };
  }
  open.delete(event.id);
  return {
    awaiting: ended({ answerFromMs: nowMs, awaiting: turns.awaiting, nowMs }),
    open,
    superseded: new Set(open.keys()),
  };
}

/** What awaits the voice once one more turn of the owner's ends at `nowMs`, its words answering it from `answerFromMs`. */
function ended({
  awaiting,
  answerFromMs,
  nowMs,
}: {
  awaiting: OwnerAwaiting | undefined;
  answerFromMs: number;
  nowMs: number;
}): OwnerAwaiting {
  if (awaiting === undefined) {
    return { answerFromMs, sinceMs: nowMs };
  }
  return { answerFromMs: Math.max(awaiting.answerFromMs, answerFromMs), sinceMs: nowMs };
}

/**
 * When the newest segment of any turn of the owner's still open arrived: the newest, so an older turn whose final never
 * came cannot age a growing one out.
 *
 * @param turns the owner's turns
 * @returns that instant, on the fold's clock, or `undefined` when no turn of the owner's is open
 */
export function ownerOpenAtOf({ turns }: { turns: OwnerTurns }): number | undefined {
  let newest: number | undefined;
  for (const atMs of turns.open.values()) {
    if (newest === undefined || atMs > newest) {
      newest = atMs;
    }
  }
  return newest;
}

/**
 * When the newest segment of a turn the owner is in NOW arrived: an open turn no later spoken turn of theirs has ended
 * past ({@link OwnerTurns.superseded}). The owner speaks one turn at a time, so an open turn a later spoken one ended
 * past lost its own final, and saying "still talking" over it would hide a quiet nothing is answering. The rollover's
 * hold keeps {@link ownerOpenAtOf}, which waits out every open turn.
 *
 * @param turns the owner's turns
 * @returns that instant, on the fold's clock, or `undefined` when every open turn of the owner's has been ended past
 */
export function ownerCurrentOpenAtOf({ turns }: { turns: OwnerTurns }): number | undefined {
  let newest: number | undefined;
  for (const [id, atMs] of turns.open) {
    if (!turns.superseded.has(id) && (newest === undefined || atMs > newest)) {
      newest = atMs;
    }
  }
  return newest;
}
