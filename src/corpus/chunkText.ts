/**
 * The one paragraph-boundary chunker every source lane splits a long body with.
 *
 * ## Why this is a shared module rather than a function inside one lane
 *
 * It lived in `corpus/notion/fetchRender.ts` while Notion was the only source with bodies long enough to
 * need it. The Slack huddle lane then needed exactly the same split for exactly the same reason — a 23,000
 * character transcript is one atom that retrieval can only return whole — and a second copy of a chunker is
 * a second set of boundaries, so two lanes' records would drift apart on nothing but which file they were
 * projected in. Moving it here is what makes "same text ⇒ same chunks" a property of the corpus rather than
 * a coincidence between two files.
 */

/** The soft chunk size in characters. Paragraph boundaries win, so a chunk may exceed it by one paragraph. */
const MAX_CHUNK_CHARS = 1500;

/**
 * Split rendered text into stable ~`maxChars` section chunks on paragraph boundaries, so a long
 * body becomes several retrievable records rather than one giant atom. Pure + deterministic.
 *
 * @param text the full rendered text
 * @param maxChars the soft chunk size (defaults to the module cap)
 * @returns the ordered chunks (empty input ⇒ no chunks)
 */
export function chunkText({
  text,
  maxChars = MAX_CHUNK_CHARS,
}: {
  text: string;
  maxChars?: number;
}): readonly string[] {
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    return [];
  }
  const paragraphs = trimmed.split(/\n{2,}/);
  const chunks: string[] = [];
  let current = "";
  for (const paragraph of paragraphs) {
    const candidate = current.length === 0 ? paragraph : `${current}\n\n${paragraph}`;
    if (candidate.length > maxChars && current.length > 0) {
      chunks.push(current);
      current = paragraph;
    } else {
      current = candidate;
    }
  }
  if (current.length > 0) {
    chunks.push(current);
  }
  return chunks;
}
