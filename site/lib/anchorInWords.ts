/**
 * Where a board row's anchor points, as a card's sentence names it — the kind of record, never its id.
 *
 * IDs are not human-friendly, so the card never draws one. An anchor such as `talk-call:<call-id>#<turn-id>` or
 * `transcript:<uuid>#<uuid>` is how a session FINDS the owner's words. The sentence names the record by its kind, and
 * the anchor itself rides the line's hover (`./sourceBlock.ts`).
 *
 * Pure: a string in, a string out.
 */
import { carriesMachineId } from "./machineIds";

/**
 * Where an anchor points, in words. An address with no machine id in it — a Slack thread, a pull request — reads as
 * itself, because the line draws it as a link.
 *
 * @param anchor the row's `anchor:` as stored
 * @returns the words, ready to follow "your words" or "it points"
 */
export function anchorInWords({ anchor }: { anchor: string }): string {
  if (anchor.startsWith("talk-call:") || anchor.startsWith("call:")) {
    return "on a console call";
  }
  if (anchor.startsWith("talk:")) {
    return "to the console voice";
  }
  if (anchor.startsWith("transcript:")) {
    return "in a Claude session";
  }
  if (carriesMachineId({ text: anchor })) {
    return "in a record the fleet keeps";
  }
  return `at ${anchor}`;
}
