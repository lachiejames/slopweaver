/**
 * Whether the owner's words, as one record read them, stand whole enough to bind as a yes — the judgement
 * `./draftApprovalResolve.ts` makes of every `--approved` anchor once its record has been read.
 *
 * A record cut at either end may have lost the "no, wait" around the yes; a record written before it said whether it
 * was cut never says it is whole; and a yes the register could not date is one no later read would see. Each refusal
 * names why, and where it can, the anchor that holds every word around the yes instead.
 */
import { parseStrictIsoInstantMs } from "#lib/date.js";

import type { RawWords } from "../../../handover/hisWordsResolve.js";
import { carriesWords } from "../../../outbound/slack/carriesWords.js";

/** Where a refused yes is anchored instead: the call's own stretch, which holds every word around it. */
const NAME_THE_STRETCH = "name the call's own stretch instead (talk-call:<call>#<segment>)";

/** Which record predates saying whether its words were cut: the only two that can are a relay and a card landing. */
function unknownCutWhy({ headKnown, kind }: { headKnown: boolean; kind: RawWords["context"]["kind"] }): string {
  if (kind === "card-landing") {
    return "the card landing predates the record of whether its words were cut";
  }
  if (headKnown) {
    return "the relay predates the record of whether the owner was still speaking";
  }
  return "the relay predates the record of whether its start was cut";
}

/**
 * Why these words cannot stand as the owner's whole, dated yes, or `undefined` when they can.
 *
 * @param words the record as read at the anchor
 * @returns the refusal's reason, or `undefined`
 */
export function partialWordsWhy({ words }: { words: RawWords }): string | undefined {
  // A relay made mid-sentence: the call holds what the owner went on to say, so its stretch is the anchor.
  if (words.tailLost && words.context.kind === "relay") {
    return `the relay was made while the owner was still speaking, so it cannot stand as a yes — ${NAME_THE_STRETCH}`;
  }
  // A stretch the record cut short may hold the "no, wait" that follows the yes, so only whole words stand — a card
  // landing included, which a call that closed or dropped can write off a stretch it never finished.
  if (words.headLost || words.tailLost || !carriesWords({ text: words.text })) {
    return "the record holds only part of what the owner said there, so it cannot stand as their yes";
  }
  // A relay written before it stored whether its head was cut, or whether the call stretch it carries was
  // still open, and a card landing written before it stored whether its words were cut, never
  // say they are whole.
  if (!words.headKnown || !words.tailKnown) {
    const why = unknownCutWhy({ headKnown: words.headKnown, kind: words.context.kind });
    return `${why}, so it is never read as whole — ${NAME_THE_STRETCH}`;
  }
  // The register refuses an approval it cannot date, so one written would be a yes no read sees.
  if (parseStrictIsoInstantMs({ text: words.atIso }) === undefined) {
    return `the record does not date the owner's words as an instant (${words.atIso}), so the register could not read the yes back`;
  }
  return undefined;
}
