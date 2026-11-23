/**
 * The sentences a Queue card's heading is drawn from, and the one it heads with. A leaf importing only the sentence
 * splitter, so `site/__tests__/unit/queueHeadingMirror.test.ts` drives the gate's own pick against the card's
 * (`site/lib/queueCardAsk.ts`'s `leadQuestion`) without typechecking the rest of `src/`.
 */
import { splitSentences } from "../briefing/sentences.js";

/** How many opening sentences the card's heading looks in for a `?` — `LEAD_SENTENCES` in `site/lib/queueCardAsk.ts`. */
export const LEAD_SENTENCES = 2;

/**
 * The opening sentences of a question, the ones the card's heading is chosen from.
 *
 * @param question the question text a verb is about to record
 * @returns at most {@link LEAD_SENTENCES} sentences, in order
 */
export function cardLead({ question }: { question: string }): readonly string[] {
  return splitSentences({ text: question.trim() }).slice(0, LEAD_SENTENCES);
}

/**
 * The sentence the card heads with: the first of its lead to ask.
 *
 * @param lead the sentences {@link cardLead} returned
 * @returns the asking sentence, `undefined` when neither asks
 */
export function cardHeading({ lead }: { lead: readonly string[] }): string | undefined {
  return lead.find((sentence) => sentence.endsWith("?"));
}
