/**
 * Turns-per-ask: how many `dispatched` cycles an ask went through (a lease expiring and being re-dispatched,
 * a recovery pass re-picking it up) before it reached a terminal reply. Read straight off the ask-lifecycle
 * log (`../live/ask/lifecycle.js`), which already owns "what counts as terminal" — this module adds nothing
 * to that contract, it only counts against it.
 *
 * Pure: the caller supplies the already-parsed event list.
 */
import { type AskLifecycleEvent, askLifecycleKey, terminalAskEventsByKey } from "../live/ask/lifecycle.js";

/**
 * One terminated ask's dispatch count.
 *
 * @internal — the exported functions below return it; nothing outside this file names the shape.
 */
export interface AskTurns {
  readonly key: string;
  readonly terminalTsIso: string;
  readonly turns: number;
}

/**
 * Turns-per-ask for every ask that has ever reached a terminal event.
 *
 * @param events the parsed ask-lifecycle log, in file order
 * @returns one entry per terminated ask, unordered
 */
export function askTurns({ events }: { events: readonly AskLifecycleEvent[] }): readonly AskTurns[] {
  const terminals = terminalAskEventsByKey({ events });
  const dispatchCounts = new Map<string, number>();
  // A terminated ask has been through exactly as many dispatch cycles as this same log holds `dispatched`
  // events for it, so each opens its tally at zero before those events are counted.
  for (const key of terminals.keys()) {
    dispatchCounts.set(key, 0);
  }
  for (const event of events) {
    if (event.kind !== "dispatched") {
      continue;
    }
    const key = askLifecycleKey({ askIdentity: event });
    // An ask that never terminated opens its tally at its first dispatch.
    if (!dispatchCounts.has(key)) {
      dispatchCounts.set(key, 0);
    }
    dispatchCounts.set(key, dispatchCounts.get(key)! + 1);
  }
  // Every terminal key was seeded above and nothing is deleted, so each one's tally is there.
  return Array.from(terminals.entries()).map(([key, terminal]) => ({
    key,
    terminalTsIso: terminal.tsIso,
    turns: dispatchCounts.get(key)!,
  }));
}

/**
 * Asks whose terminal event falls inside `[sinceIso, untilIso)`.
 *
 * @param turns every terminated ask's turn count
 * @param sinceIso the period's start (inclusive)
 * @param untilIso the period's end (exclusive)
 * @returns turns within the period, unordered
 */
export function askTurnsInSpan({
  turns,
  sinceIso,
  untilIso,
}: {
  turns: readonly AskTurns[];
  sinceIso: string;
  untilIso: string;
}): readonly AskTurns[] {
  return turns.filter((turn) => turn.terminalTsIso >= sinceIso && turn.terminalTsIso < untilIso);
}
