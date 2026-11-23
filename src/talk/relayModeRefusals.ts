/**
 * Why a spoken relay's mode cannot stand: words-alone carrying something the voice supplied, or heard-only naming a
 * read the voice has not got or carrying a reading beside it. Its own file so `relayDraft.ts` stays under the line cap.
 */

/**
 * Why a words-alone relay's inputs cannot stand, or `undefined` when they can (or the relay is not one).
 *
 * Words-alone is the page's one retry after a refused relay, so it carries the owner's words and nothing the voice
 * supplied: a reading or a read beside it means the caller has not done what the mode means.
 *
 * @param words the voice's reading, normalised
 * @param heard the owner's transcribed words, normalised
 * @returns the refusal, or `undefined`
 */
export function wordsAloneRefusal({
  wordsAlone,
  readsAfter,
  words,
  heard,
}: {
  wordsAlone: boolean;
  readsAfter: readonly string[];
  words: string;
  heard: string;
}): string | undefined {
  if (!wordsAlone) {
    return undefined;
  }
  if (words !== "" || readsAfter.length > 0) {
    return "--words-alone carries the owner's words only: it takes neither --say nor --read-after";
  }
  if (heard === "") {
    return "--words-alone needs the owner's words: a relay of the owner's words alone with none carries nothing of theirs";
  }
  return undefined;
}

/**
 * Why a heard-only relay's inputs cannot stand, or `undefined` when they can (or the relay is in full mode).
 *
 * Heard-only exists so the voice's reading never travels after a read, so a reading beside the reads is
 * refused rather than dropped here — the caller that sent it has not done what the mode means.
 *
 * @param sources every read a relay may name (`relayDraft.ts`'s `RELAY_READ_SOURCES`)
 * @param words the voice's reading, normalised
 * @param heard the owner's transcribed words, normalised
 * @returns the refusal, or `undefined`
 */
export function readsAfterRefusal({
  sources,
  readsAfter,
  words,
  heard,
}: {
  sources: readonly string[];
  readsAfter: readonly string[];
  words: string;
  heard: string;
}): string | undefined {
  if (readsAfter.length === 0) {
    return undefined;
  }
  const unknown = readsAfter.filter((source) => !sources.includes(source));
  if (unknown.length > 0) {
    return `--read-after names ${unknown.join(", ")}, which is not one of the voice's reads (${sources.join(", ")})`;
  }
  if (words !== "") {
    return "--say cannot travel with --read-after: after a read the voice's reading is dropped and only the owner's words go";
  }
  if (heard === "") {
    return "--read-after needs the owner's words: a heard-only relay with none carries nothing of theirs";
  }
  return undefined;
}
