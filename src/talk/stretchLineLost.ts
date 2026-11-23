/**
 * The one rule both readers of a stretch apply to each line carrying its id — the card fold
 * (`./cardUtterance.ts`) and the `talk-call:` stretch check (`./landingCut.ts`) — so the two can never disagree on
 * whether the owner's words were cut.
 */
import { CALL_TEXT_CHARS, type CallSegment } from "./callRecord.js";
import { printsSnapshot } from "./unreadWords.js";

/**
 * Whether one line of a stretch may hold words the stretch's winning text lost: the call file capped it, the winner
 * does not print it (a take-back or a dropped tail), it is a second final saying other words,
 * which a first-final-wins fold drops whatever its length, or it is under another speaker, which may be
 * the line that finished it. The record cannot tell a correction from a loss, so each reads as cut.
 *
 * @param line one line carrying the stretch's id
 * @param winner the stretch as folded: the text it carries and whose speech it is
 * @returns `true` when the line may hold words the winner does not
 */
export function stretchLineLost({
  line,
  winner,
}: {
  line: Pick<CallSegment, "final" | "text" | "who">;
  winner: Pick<CallSegment, "text" | "who">;
}): boolean {
  return (
    line.who !== winner.who ||
    line.text.length >= CALL_TEXT_CHARS ||
    (line.final && line.text !== winner.text) ||
    !printsSnapshot({ shown: winner.text, snapshot: line.text })
  );
}
