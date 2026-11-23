/**
 * Where `session watch` starts folding, decided purely from the stored state and the `--since` it was given.
 *
 * The fold and its cursor are one fact, so `--since` can no longer move one without the other. With no stored
 * row there is nothing to disagree with, and `--since` starts an empty fold there. With one, a `--since` naming
 * the stored cursor is a resume, and any other value is refused: folding events after N into a fold complete up
 * to M counts the events between them twice, or never. `--reset-state` is the way to move both deliberately.
 */
import { err, ok, type Result } from "#lib/result.js";

import { type CmuxEventSinceConflictError, CmuxEventStateErrors } from "./errors.js";
import type { SessionWatchState } from "./port.js";

/**
 * Resolve the state a drain starts from.
 *
 * @param since the sequence the caller asked to fold after; a resume only when it equals the stored cursor
 * @param state the state the port read
 * @returns the state to fold on from, its cursor being where the drain resumes — or the conflict
 */
export function sessionWatchStart({
  since,
  state,
}: {
  since: number | undefined;
  state: SessionWatchState;
}): Result<SessionWatchState, CmuxEventSinceConflictError> {
  if (since === undefined) {
    return ok(state);
  }
  if (state.cursorSeq === undefined) {
    return ok({ ...state, cursorSeq: since });
  }
  if (state.cursorSeq === since) {
    return ok(state);
  }
  return err(CmuxEventStateErrors.sinceConflict({ since, storedSeq: state.cursorSeq }));
}
