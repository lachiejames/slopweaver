/**
 * What a flip of the owner's `openCards` switch did, said to the model in `set_stage_setting`'s own answer, so the
 * answer can never be read as having opened anything: turning automatic Queue opening back on opens nothing by
 * itself, and a voice that says a card "should be open now" after a flip misleads. The switch does not govern
 * `browser` reads, so a complaint about those is not a reason to flip it. An off is reached only past
 * `../../lib/openCardsOffGuard.ts`, which refuses one the owner's own words did not ask for.
 */
import type { StageSwitch } from "../../lib/voiceStage";

/** One sentence per way the switch can go, each true of the flip alone. */
const NOTES: Readonly<Record<StageSwitch, string>> = {
  off: "open_card opens nothing now, and never browser_open a card's links instead; browser reads still open tabs in the owner's Chrome while they read",
  on: "nothing has opened yet; the card the call is on opens only if open_card's own rules would open it and you call open_card now",
};

/**
 * The note `set_stage_setting` answers with for an `openCards` flip.
 *
 * @param state which way the switch was just set
 * @returns the sentence naming what the flip did not do
 */
export function openCardsSettingNote({ state }: { readonly state: StageSwitch }): string {
  return NOTES[state];
}
