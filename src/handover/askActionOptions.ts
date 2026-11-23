/**
 * The options an OFFERED ask carries — derived from its destinations, never authored beside them.
 *
 * The card shows a draft written out to look at, and the choices are to post it, to DM it, or to hold it for
 * now. Those choices are not
 * independent prose: each one IS a destination on the action, so authoring them separately is the shape
 * that lets a card print "post to #delivery" over a draft that no longer goes there.
 *
 * So `handover ask --action` and `handover offer` refuse `--options` and derive them here instead. One
 * option per destination, in the order the action declares them, then {@link HOLD_OPTION} last — and the
 * hold is a real option rather than an implied absence, because silence the owner did not choose is the state this
 * whole card exists to make visible (`AGENTS.md` rule 6).
 *
 * The arithmetic that makes this fit: `./askAction.ts`'s `ACTION_MAX_DESTINATIONS` is three and
 * `../briefing/caps.ts`'s `MAX_OPTIONS` is four, so three destinations plus the hold is exactly the cap.
 * {@link actionOptionsFitCap} is the witness that the two numbers still agree — a cap changed on one side
 * would otherwise make every offered ask unrecordable at the last step, with nothing naming why.
 *
 * Letters are assigned by `askOptionsFrom`, which is the one place in this tree that knows the alphabet.
 *
 * Pure: no filesystem, no clock.
 */

import { MAX_OPTIONS } from "../briefing/caps.js";

import { ACTION_MAX_DESTINATIONS, type AskAction, MAIL_ACTION_VERSION } from "./askAction.js";
import { type AskOption, askOptionsFrom } from "./askShape.js";

/**
 * The option that posts nothing.
 *
 * Its trade-off names what holding actually costs rather than "none" — `./askShape.ts` calls a trade-off of
 * "none" the absence of one stated as one, and a hold is never free: the thread moves on.
 */
export const HOLD_OPTION: { readonly option: string; readonly tradeoff: string } = {
  option: "Hold it — send nothing for now",
  tradeoff: "the thread moves on without our answer, and the draft goes stale",
};

/**
 * The one option a MAIL action offers beside the hold. Its trade-off says what pressing really does — a
 * draft in the owner's own mailbox and nothing sent — because "create" read quickly is easy to mistake for "send".
 */
export const MAIL_DRAFT_OPTION: { readonly option: string; readonly tradeoff: string } = {
  option: "Create this as a Gmail draft in my mailbox",
  tradeoff: "nothing is sent — the draft waits in Gmail for my own read and send",
};

/**
 * The options one action offers — a Slack action's destinations in order, or a mail action's one draft
 * option, then the hold.
 *
 * @param action the recorded action
 * @returns the options, lettered by position
 */
export function actionOptions({ action }: { action: AskAction }): readonly AskOption[] {
  if (action.version === MAIL_ACTION_VERSION) {
    return askOptionsFrom({ value: [MAIL_DRAFT_OPTION, HOLD_OPTION] });
  }
  const rows = [
    ...action.destinations.map((destination) => ({
      option: destination.label,
      tradeoff: destination.tradeoff,
    })),
    HOLD_OPTION,
  ];
  return askOptionsFrom({ value: rows });
}

/**
 * Whether the two caps still agree — the most destinations an action may carry, plus the hold, against the
 * most options an ask may offer.
 *
 * @returns true while a full action's derived options are recordable
 */
export function actionOptionsFitCap(): boolean {
  return ACTION_MAX_DESTINATIONS + 1 <= MAX_OPTIONS;
}
