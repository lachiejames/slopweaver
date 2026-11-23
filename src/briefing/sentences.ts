/**
 * Where a sentence ends, and the sentences a text splits into. A leaf with no imports, so the site lane's mirror test
 * (`site/__tests__/unit/queueHeadingMirror.test.ts`) can reach the gate's own splitter without typechecking the rest
 * of `src/`. `./text.ts` re-exports both functions for the briefing callers.
 */

/** Terminal `.`/`!`/`?` runs followed by whitespace or end-of-string. */
const SENTENCE_END = /[.!?]+(?=\s|$)/g;

/**
 * How many sentences `text` reads as.
 *
 * @param text plain text, already stripped of markup
 * @returns the sentence count
 */
export function sentenceCount({ text }: { text: string }): number {
  return [...text.matchAll(SENTENCE_END)].length;
}

/**
 * `text` split into its sentences, each keeping its own terminator and none of the space between them.
 *
 * It splits on {@link sentenceCount}'s own `SENTENCE_END` rather than a second opinion about where a
 * sentence ends, so a caller building one-sentence bullets and the counter reading them back agree by
 * construction. Text carrying no terminator at all comes back as one item, so a caller never has to handle
 * an empty list.
 *
 * @param text plain text, already stripped of markup
 * @returns the sentences, in order, with empty fragments dropped
 */
export function splitSentences({ text }: { text: string }): readonly string[] {
  const parts: string[] = [];
  let cursor = 0;
  for (const match of text.matchAll(SENTENCE_END)) {
    const end = match.index + match[0].length;
    const sentence = text.slice(cursor, end).trim();
    if (sentence.length > 0) {
      parts.push(sentence);
    }
    cursor = end;
  }
  const tail = text.slice(cursor).trim();
  if (tail.length > 0) {
    parts.push(tail);
  }
  return parts;
}
