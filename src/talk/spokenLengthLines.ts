/**
 * The spoken-length lines: the thinking model writes an answer the length of something said, and the voice says it
 * as speech rather than a reading.
 *
 * Why: a voice that reads monotone and boring, like early text to speech, when the same voice model on a phone is
 * expressive and engaging, is not a voice problem. The voice was not what changed: the call opened on `sol`, as all 44
 * realtime calls in the measured window did (the GPT-Live calls have no voice). What changed was what it was handed
 * to say. The voice says the thinking model's answer word
 * for word (`./handedBackAnswerLines.ts`), and nothing bounded that answer's length: the voice's own "one or two
 * sentences" never reached the model writing it. On the call measured, the thinking model's median
 * answer was 398 characters, 18 of 37 over 400, against 159–302 on the 31 calls before it with
 * ten answers or more; the voice's median finished turn was 172 characters, against 160 at most on those 31, and 1 of
 * the 31 over 58. A paragraph written to be read, said whole, is the reading the owner heard. Repro: group the
 * call files under `$SLOPWEAVER_HOME/talk/calls/` by their `open` line, and for each call take the median length of
 * its `wrote` lines, the count over 400, and the median length of the voice's final `segment` lines.
 */

/**
 * The thinking model's bullet, first under "How to answer": a spoken answer is the length of something said. It
 * once told the model the voice says its answer "word for word" and "cannot shorten it"; the voice paraphrases
 * (`slopweaver talk fidelity --call <callId>` counts the claims it dropped and added), so the line says only what is true: the voice speaks from these words.
 */
export const SPOKEN_LENGTH_BACKEND_LINES: readonly string[] = [
  "- On a call the voice speaks your answer from your words. Write it for the ear, the way you would say it",
  "  across a desk: two or three short sentences, about 300 characters at most, no paragraphs and no lists.",
  "  When there is more, say what matters most and that there is more; the owner will ask. This is the",
  "  default, not a cap on the rest: where another line here asks for a list or a fuller answer (the options,",
  '  a draft the owner asked to hear, a walk\'s item, "What can you do", their Slack unreads), that line and its shape win.',
];

/**
 * The voice's paragraph, after its handed-back-answer lines: the words are the model's, the delivery is the voice's.
 * It once said to give the answer "as your own words", an instruction to paraphrase; the voice
 * dropped or reworded claims in most handed messages, so the words stay the model's and only the sound is the voice's.
 */
export const SPOKEN_DELIVERY_VOICE_LINES: readonly string[] = [
  "Say the handed-back answer using the words handed to you. Do not paraphrase, reorder, shorten or embellish it.",
  "Say all of it, even past the short-turn length, which is for your own words. Only an id in it changes: name",
  "the thing in words instead, as the id rule says.",
  "Make those words sound conversational through pace, emphasis and warmth, with the owner's energy bar a quote.",
];
