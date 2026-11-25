/**
 * What a session's snapshot keeps of its words, as pure functions the registry folds its events through: the head of
 * the last message submitted and the tail of what the agent last said. Every snapshot echoes both for the session's
 * whole life, so each is bounded here, and neither ever reaches a worker: the registry sends the whole message.
 */
import { type AppSessionSnapshot, boundedSubmittedText } from "./sessionControlProtocol";

/** How much of the agent's last words a snapshot keeps, in characters: the card shows a tail, never a transcript. */
export const AGENT_TEXT_TAIL = 2_000;

/**
 * A snapshot once a message is submitted: a new turn, so the agent text shown starts again and the card shows this
 * turn's words alone, beside the message's bounded head (`boundedSubmittedText`).
 *
 * @param snapshot the session's snapshot before the message
 * @param text the whole message submitted
 * @param atIso when it was submitted
 * @returns the running snapshot, echoing the message's head and no agent text
 */
export function echoOnSubmitted({
  snapshot,
  text,
  atIso,
}: {
  snapshot: AppSessionSnapshot;
  text: string;
  atIso: string;
}): AppSessionSnapshot {
  const { lastAgentText: _previousTurn, ...rest } = snapshot;
  return { ...rest, lastSubmittedAtIso: atIso, lastSubmittedText: boundedSubmittedText({ text }), state: "running" };
}

/**
 * A snapshot once the agent says more: its words so far this turn, kept to the last {@link AGENT_TEXT_TAIL}.
 *
 * @param snapshot the session's snapshot before the words
 * @param text the words the agent just reported
 * @returns the snapshot with the tail of this turn's agent text
 */
export function echoOnAgentText({
  snapshot,
  text,
}: {
  snapshot: AppSessionSnapshot;
  text: string;
}): AppSessionSnapshot {
  const said = snapshot.lastAgentText === undefined ? text : `${snapshot.lastAgentText}${text}`;
  return { ...snapshot, lastAgentText: said.slice(-AGENT_TEXT_TAIL) };
}
