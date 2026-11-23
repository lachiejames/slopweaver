/**
 * What an ask card offers off its row's draft: the sends it would make, and the recorded options it may fall back
 * to — pure, the row's action in. Its own module so `./queueRows.ts` stays under the line cap.
 */
import type { BoardRowOption } from "../components/live/read";
import type { BoardRowActionRead } from "../components/live/readAction";
import { destinationWhere, draftMessages, sendCommand } from "./askAction";
import type { AskRecordSend } from "./queueCard";

/**
 * The recorded options a card may fall back to — NONE of them when the row's draft will not read.
 *
 * The second half of the same rule {@link offeredSends} states, and it is the half a reader misses: the
 * card's fallback is `row.options`, and on an offered ask those were DERIVED from the very destinations
 * that just failed to decode. Handing them back prints a takeable decision — "DM Tobias" — over a draft the
 * panel is simultaneously reporting as malformed. Empty falls the card through to the generic
 * answer-it/leave-it pair every option-less ask already carries, which names no destination and so cannot
 * be the wrong one; `SlackActionPreview` is what says the draft will not read.
 *
 * @param options the row's own recorded options
 * @returns them unchanged for a row with a readable draft or no draft, and none for a malformed one
 */
export function askedOptions({
  action,
  options,
}: {
  action: BoardRowActionRead;
  options: readonly BoardRowOption[];
}): readonly BoardRowOption[] {
  if (action.kind === "invalid") {
    return [];
  }
  return options;
}

/**
 * The destinations of an offered draft, each resolved to the line that would send it.
 *
 * `undefined` rather than an empty list for a row that offers no draft, and for one whose draft will not
 * READ: the card renders options off this, and an empty list there would silently become the unoffered
 * card. The panel reads `row.action` itself to say which of those two happened — a malformed draft is
 * named, never drawn as an absent one.
 *
 * @param action the row's action, in whichever of the three states it arrived
 * @returns one send per destination, or `undefined` when the row offers no readable draft
 */
export function offeredSends({ action }: { action: BoardRowActionRead }): readonly AskRecordSend[] | undefined {
  if (action.kind !== "action") {
    return undefined;
  }
  return action.action.destinations.map((destination) => ({
    command: sendCommand({ destination, messages: draftMessages({ action: action.action }) }),
    label: destination.label,
    tradeoff: destination.tradeoff,
    where: destinationWhere({ destination }),
  }));
}
