/**
 * The line a triage card's clock hands the voice at zero (`PlanCall.announceTriageDue`), beside the rest of the
 * plan call's scripted words (`./talkPlanWords.ts`) in its own file, so `./talkPlanCall.ts` stays under the line cap.
 * The line names no length: the server never hears one, since a page's words never reach the voice.
 */
import { NEVER_HAND_BACK } from "./talkPlanWords";
import type { VoiceAnnouncement } from "./talkVoiceProvenance";

/**
 * What the voice reads when a triage card's clock is up: a developer message, never spoken itself. The owner
 * wants a timer built in that says when the time they set has passed, and only a suggestion, never an auto park. On a call
 * the clock is this line, beside the countdown by the owner's menu bar item, and it asks for a suggestion and the
 * owner's word, never a verdict of its own. The
 * suggestion is the thinking model's, which holds the card, as every other word about a card is.
 *
 * So this line never asks the voice to hand anything off: the console starts the suggestion's turn itself the moment
 * the line is taken ({@link TRIAGE_SUGGESTION_TURN_TEXT}, `OwedTurnStarts.handingNow`). A line that asks the voice
 * to hand off for one suggested call can hand nothing, and the voice then says "Time's up. Send it. … Is that your
 * call?" and "Send it, then." on a held draft the owner has not approved. The voice says only that time is up and the owner's ways out are coming, and is forbidden every verdict word.
 *
 * The page checks the card is still current, unruled and, once shown, still open before it posts, and the server checks the card is still the
 * one a live answer put up before it hands the line. Neither can take back a line already handed, and the app-server
 * has no call that would: a ruling, a pause, an end or another card arriving while the line is in flight still lets
 * it land. The line's own first sentence closes that: the voice heard that answer too,
 * and says nothing.
 */
export const TRIAGE_DUE_TEXT =
  "The clock is up on the triage card the owner has open. If they have already given their call on that card, or the " +
  "clock on it has been paused, or the pass has ended or moved to another card, say nothing about this at all. " +
  "Otherwise say only, in a few words, that time is up and their ways out are coming. They are " +
  "the thinking model's, already being worked out: never name, imply, endorse, repeat or affirm a call on the card " +
  "yourself, no send, revise, park, skip or any other verdict, and never ask them to approve one that has not " +
  "arrived. " +
  NEVER_HAND_BACK;

/**
 * The thinking model's own turn when the card's clock is up, which the console starts itself the moment the voice
 * took {@link TRIAGE_DUE_TEXT}: the owner's three ways out — decide, name what's missing, park it — each already a
 * triage ruling, with ONE of them suggested, and the owner's word on it, never a ruling: no auto parking.
 */
export const TRIAGE_SUGGESTION_TURN_TEXT =
  "The clock is up on the triage card the owner has open, so this turn is the console's. If they have already given their " +
  "call on that card, or the pass has ended or moved to another card, say nothing about the card. Otherwise name " +
  "their three ways out in one short sentence: decide it (send it, rewrite or drop), name what's missing (needs " +
  "more info), or park it (for a working session or the slow triage hour). Then give ONE of them as your suggested " +
  "call and label on that card with its reason in a sentence, and ask which is their call. It is only a suggestion: " +
  "do not send, park, advance or otherwise rule the card. It stays exactly where it is until they give their call or " +
  "agree to yours.";

/** {@link TRIAGE_DUE_TEXT} as `PlanCall` hands it, named and with the reason its provenance keeps. */
export const TRIAGE_DUE_ANNOUNCEMENT: VoiceAnnouncement = {
  herald: "attention",
  text: TRIAGE_DUE_TEXT,
  what: "the time-up line",
  why: "the triage card in front of the owner ran past the clock they asked to be told about",
};
