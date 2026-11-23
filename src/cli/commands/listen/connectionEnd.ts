/**
 * Why one Socket Mode connection ended, in the words `listen` prints and journals.
 *
 * Three sources, in order of how truthful each is: Slack's own `disconnect` frame when it sent one, else the
 * socket's close reason, else a sentence saying no reason was stated — never a guessed one.
 */
import type { ConnectionOutcome, SocketConnection } from "../../../live/listen/socket.js";

/**
 * The reason a drained connection ended.
 *
 * @param attempt the connection, asked for its own close reason only when Slack sent none
 * @param outcome the drained connection's outcome, whose `disconnectReason` is Slack's own word
 * @returns Slack's reason, else the socket's, else the stated absence of one
 */
export function connectionEndedReason({
  attempt,
  outcome,
}: {
  attempt: Pick<SocketConnection, "endedBecause">;
  outcome: Pick<ConnectionOutcome, "disconnectReason">;
}): string {
  if (outcome.disconnectReason !== undefined) {
    return outcome.disconnectReason;
  }
  const closed = attempt.endedBecause();
  if (closed === undefined) {
    return "the socket ended without stating a reason";
  }
  return closed;
}
