/**
 * The word-level half of `slopweaver talk fidelity` (`./voiceFidelity.ts` pairs a handed message with what the voice
 * said; this reads the pair): which content words the voice ADDED (in no handed sentence) and RELOCATED (handed, but
 * from a sentence other than the one the spoken sentence says).
 *
 * The owner's top-priority case: the thinking model wrote that uploading needs "a service key", and in an
 * option's trade-off "the powerful key"; the voice said uploading "needs a powerful service key", opening on "Right
 * now". Here that reads as `powerful` relocated and `right`, `now` added.
 *
 * **A candidate, never a verdict.** Word overlap cannot read meaning: a synonym is "added", and a voice sentence
 * merging two handed ones could relocate the words of the one it matched less well. A handed sentence contributing at
 * least {@link JOINED_CONTRIBUTION} content words the best match lacks joins the match, which keeps a merge out; a
 * qualifier moved by itself, the P0's shape, contributes one.
 */

/**
 * How many content words another handed sentence must CONTRIBUTE to a spoken one — shared with it, and absent from the
 * best-matching sentence — to count as part of what it says. Measured on the P0 call: the spoken "uploading it needs a
 * powerful service key" shares {powerful, key, uploading} with option A's trade-off sentence, but only "powerful" is
 * not already in the problem sentence it says, so a bare shared-word threshold of three hid the very word moved.
 * Repro: `slopweaver talk fidelity --call <call id>` lists it under `moved`.
 */
const JOINED_CONTRIBUTION = 2;

/**
 * Words that carry no claim of their own, so neither their addition nor their move is a divergence. Short words (two
 * letters or fewer) are dropped before this list is read. "now" and "right" are deliberately NOT here: "right now" is
 * the time qualifier the P0 call added.
 */
const GLUE_WORDS: ReadonlySet<string> = new Set([
  "about",
  "after",
  "all",
  "also",
  "and",
  "any",
  "are",
  "because",
  "been",
  "before",
  "but",
  "can",
  "could",
  "did",
  "does",
  "for",
  "from",
  "has",
  "have",
  "her",
  "how",
  "i'm",
  "i've",
  "into",
  "it's",
  "its",
  "just",
  "more",
  "one",
  "only",
  "other",
  "our",
  "out",
  "said",
  "say",
  "says",
  "some",
  "than",
  "that",
  "that's",
  "the",
  "their",
  "them",
  "then",
  "there",
  "there's",
  "these",
  "they",
  "this",
  "those",
  "through",
  "too",
  "very",
  "was",
  "were",
  "what",
  "what's",
  "when",
  "where",
  "which",
  "while",
  "who",
  "will",
  "with",
  "would",
  "yeah",
  "yes",
  "you",
  "you're",
  "your",
]);

/**
 * The masculine possessive, glue exactly as "her" is. Kept as a pattern rather than in {@link GLUE_WORDS}: the
 * owner-pronoun gate (`../devLint/ownerPronouns.ts`) reads a regular-expression literal as a recogniser of speech, never
 * as prose about the owner.
 */
const PERSON_GLUE = /^his$/u;

/**
 * A text's content words, lowercased, with a plural or possessive `s` dropped so "needs" meets "need": the same
 * reduction on both sides, so it only has to be consistent, never correct English.
 *
 * @param text what was written or said
 * @returns its content words, in order, repeats kept
 */
export function contentWords({ text }: { text: string }): readonly string[] {
  const words = text
    .toLowerCase()
    .replaceAll("’", "'")
    .match(/[a-z0-9']+/gu);
  if (words === null) {
    return [];
  }
  return words
    .map((word) => word.replace(/^'+|'+$/gu, ""))
    .filter((word) => word.length > 2 && !GLUE_WORDS.has(word) && !PERSON_GLUE.test(word))
    .map((word) => stem({ word }));
}

/** One word with its possessive or plural `s` dropped. */
function stem({ word }: { word: string }): string {
  if (word.endsWith("'s")) {
    return word.slice(0, -2);
  }
  if (word.length > 3 && word.endsWith("s") && !word.endsWith("ss")) {
    return word.slice(0, -1);
  }
  return word;
}

/** A text cut into sentences at `.`, `!`, `?` or `:` followed by space. */
function sentencesOf({ text }: { text: string }): readonly string[] {
  return text
    .split(/(?<=[.!?:…])\s+/u)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence !== "");
}

/**
 * Which content words each spoken sentence added to, and moved within, a handed text — so a caller can find the very
 * sentence that moved a word, not only that one was moved.
 *
 * @param handed what the thinking model wrote
 * @param spoken what the voice said for it
 * @returns one row per spoken sentence, in order: its trimmed text, and its added and relocated content words, each once
 */
export function sentenceDivergence({ handed, spoken }: { handed: string; spoken: string }): readonly {
  readonly added: readonly string[];
  readonly relocated: readonly string[];
  readonly sentence: string;
}[] {
  const handedSentences = sentencesOf({ text: handed }).map((sentence) => new Set(contentWords({ text: sentence })));
  const handedAll = new Set(handedSentences.flatMap((words) => [...words]));
  return sentencesOf({ text: spoken }).map((sentence) => {
    const words = contentWords({ text: sentence });
    const matched = matchedWords({ handedSentences, words });
    const added: string[] = [];
    const relocated: string[] = [];
    for (const word of words) {
      if (!handedAll.has(word)) {
        pushOnce({ list: added, word });
      } else if (!matched.has(word)) {
        pushOnce({ list: relocated, word });
      }
    }
    return { added, relocated, sentence };
  });
}

/**
 * Which content words a spoken text added to, and moved within, a handed one.
 *
 * @param handed what the thinking model wrote
 * @param spoken what the voice said for it
 * @returns the added and relocated content words, each once, in the order said
 */
export function divergence({ handed, spoken }: { handed: string; spoken: string }): {
  readonly added: readonly string[];
  readonly relocated: readonly string[];
} {
  const added: string[] = [];
  const relocated: string[] = [];
  for (const row of sentenceDivergence({ handed, spoken })) {
    for (const word of row.added) {
      pushOnce({ list: added, word });
    }
    for (const word of row.relocated) {
      pushOnce({ list: relocated, word });
    }
  }
  return { added, relocated };
}

/** The words of the handed sentence(s) a spoken sentence says: its best overlap, plus any sharing enough to join. */
function matchedWords({
  handedSentences,
  words,
}: {
  handedSentences: readonly ReadonlySet<string>[];
  words: readonly string[];
}): ReadonlySet<string> {
  const spoken = new Set(words);
  const overlaps = handedSentences.map((sentence) => [...sentence].filter((word) => spoken.has(word)).length);
  const best = Math.max(0, ...overlaps);
  const matched = new Set<string>();
  if (best === 0) {
    return matched;
  }
  const bestSentence = handedSentences[overlaps.indexOf(best)]!;
  bestSentence.forEach((word) => matched.add(word));
  for (const sentence of handedSentences) {
    const contributed = [...sentence].filter((word) => spoken.has(word) && !bestSentence.has(word)).length;
    if (contributed >= JOINED_CONTRIBUTION) {
      sentence.forEach((word) => matched.add(word));
    }
  }
  return matched;
}

/** Add a word to a list unless it is already there. */
function pushOnce({ list, word }: { list: string[]; word: string }): void {
  if (!list.includes(word)) {
    list.push(word);
  }
}
