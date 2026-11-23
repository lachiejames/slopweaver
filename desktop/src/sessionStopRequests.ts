/**
 * The two ways somebody asks a hosted session to end — a press on its card's Stop, and a `close` or `launch.abort`
 * a verb sends — and what each owes the asker: a press always stops the session, and a verb's request is refused
 * unless the stop finished whole, so the ledger never records a close the app could not prove or journal.
 */
import { err, type Result, type ResultAsync } from "neverthrow";

import {
  closeSettled,
  hostedSessions,
  noteSession,
  type SessionEnded,
  SessionRefusal,
  stopSession,
} from "./sessionHosting";

/** How long a card's Stop waits on the close verb before stopping the session here — past the helper's own 60s. */
const STOP_VERB_MS = 75_000;

/** Close a session through the `slopweaver` verb, so the ledger records the close the card's Stop made. */
export type CloseThroughVerb = (options: {
  readonly handle: string;
  readonly ledgerHome: string | undefined;
}) => ResultAsync<void, string>;

/**
 * A press on a card's Stop, or the card closed: closed through the verb so the ledger records it, and ended here
 * regardless if the verb could not — a Stop the owner pressed always stops.
 *
 * @param sessionId the control plane's id
 * @param closeThroughVerb the verb the close goes through first, so the ledger records it
 * @param ledgerHome the state home the spawn recorded the session's ledger row under, when it named one
 * @returns once the session has stopped, or the press found nothing left to stop
 */
export async function stopFromCard({
  sessionId,
  closeThroughVerb,
  ledgerHome,
}: {
  sessionId: string;
  closeThroughVerb: CloseThroughVerb;
  ledgerHome: string | undefined;
}): Promise<void> {
  const entry = hostedSessions().get(sessionId);
  if (entry === undefined || closeSettled({ sessionId })) {
    return;
  }
  // Already stopping, ended failed, or reading closed while a stop or a crash's sweep still ends the group or its row
  // is owed: the Stop JOINS that stop,
  // or asks for one of its own, so a crash or failure the press lands on becomes an end the owner asked for and is
  // journalled closed, and the press answers once that stop settles, never while the session is still going down.
  const { state } = entry.snapshot;
  const live = state === "idle" || state === "running" || state === "starting";
  if (!live) {
    await stopSession({ sessionId }).then(
      () => undefined,
      () => undefined,
    );
    return;
  }
  // Raced against the app's own clock, not only the helper's: a SIGKILLed helper whose descendant still holds its
  // pipes never calls back, and a Stop that waits on it would never reach the stop below.
  let timer: NodeJS.Timeout | undefined;
  const closed = await Promise.race<Result<void, string>>([
    closeThroughVerb({ handle: entry.snapshot.handle, ledgerHome }),
    new Promise((resolve) => {
      timer = setTimeout(() => {
        resolve(err(`the close verb did not answer within ${String(STOP_VERB_MS / 1000)}s`));
      }, STOP_VERB_MS);
    }),
  ]);
  clearTimeout(timer);
  if (closed.isOk()) {
    return;
  }
  // Read again, never the worker: a crash while the verb hung took the worker with it, and this press must still
  // join that crash's cleanup, or pay the row it owes, so the stop the owner asked for is journalled closed.
  if (hostedSessions().has(sessionId) && !closeSettled({ sessionId })) {
    noteSession({ note: `Stopped here; the ledger did not record the close: ${closed.error}`, sessionId });
    await stopSession({ sessionId });
  }
}

/**
 * Stop a session somebody asked to end, and refuse the request unless the stop finished whole, so the verb records
 * no close for one that did not: a group that outlived SIGKILL is still running, and a close the journal never
 * recorded is one a later run would resume.
 *
 * @param sessionId the control plane's id
 * @returns how the session's group ended, once it is gone and its closed row is on disk
 */
export async function stoppedWhole({ sessionId }: { sessionId: string }): Promise<SessionEnded> {
  const ended = await stopSession({ sessionId });
  if (!ended.gone) {
    throw new SessionRefusal(
      "OPERATION_FAILED",
      `session ${sessionId}'s process group outlived SIGKILL; the app ends it again at quit`,
    );
  }
  if (ended.unrecorded !== undefined) {
    throw new SessionRefusal(
      "OPERATION_FAILED",
      `session ${sessionId} stopped, but the journal could not record it closed: ${ended.unrecorded}`,
    );
  }
  return ended;
}
