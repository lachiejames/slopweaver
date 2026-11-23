/**
 * The matching half of `slopweaver talk fidelity`'s claim reading: what a finding is, how a summary sentence finds the
 * source sentence it restates, and the per-sentence checks both hops share (a misquote, a polarity flip, a swapped
 * number). `./claimFidelity.ts` composes them into each hop's findings.
 */
import { parseJson } from "../lib/jsonParse.js";
import { type ClaimSentence, claimSentencesRead, foldedForQuote } from "./claimDetails.js";

/** What one finding says changed. */
export type ClaimFindingKind =
  | "dropped-claim"
  | "dropped-detail"
  | "swapped-detail"
  | "polarity-flip"
  | "added-claim"
  | "added-question"
  | "unsourced-detail"
  | "misquote";

/** One candidate change. */
export interface ClaimFinding {
  readonly kind: ClaimFindingKind;
  /** The sentence it is in: the summary's, or the source's for a drop. */
  readonly sentence: string;
  /** What changed, in a few words: `14 → 13`, `"local page"`, `negated in the source only: …`. */
  readonly detail: string;
}

/** Sentences with fewer content words than this are never a dropped or added claim: "Got it." says nothing. */
export const CLAIM_WORDS = 3;

/** The share of a summary sentence's words its best source sentence must hold to be the sentence it restates. */
export const ALIGNED_SHARE = 0.4;

/** The sources a summary is read against, read once. */
export interface ClaimSources {
  readonly sentences: readonly ClaimSentence[];
  readonly numbers: ReadonlySet<string>;
  /** Every source folded for a verbatim test, one space-joined text. */
  readonly folded: string;
}

/**
 * How many of a sentence's content words a set holds, as a share of the sentence's.
 *
 * @param words the sentence's content words
 * @param held the words the other text holds
 * @returns the share, 1 for a sentence with no content words
 */
export function shareHeld({ words, held }: { words: ReadonlySet<string>; held: ReadonlySet<string> }): number {
  if (words.size === 0) {
    return 1;
  }
  return [...words].filter((word) => held.has(word)).length / words.size;
}

/**
 * Every value of one detail across some sentences.
 *
 * @param pick which detail: words, numbers or identifiers
 * @returns the union
 */
export function unionOf({
  sentences,
  pick,
}: {
  sentences: readonly ClaimSentence[];
  pick: (sentence: ClaimSentence) => ReadonlySet<string>;
}): ReadonlySet<string> {
  return new Set(sentences.flatMap((sentence) => [...pick(sentence)]));
}

/**
 * The source unit a summary unit restates: the best overlap, when it holds enough of the summary's words.
 *
 * @param sentence the summary sentence or clause
 * @param sources the source sentences or clauses
 * @param share the least share of the summary's words the best source must hold
 * @returns the source it restates, or undefined when none holds enough
 */
export function alignedOf<Unit extends { readonly words: ReadonlySet<string> }>({
  sentence,
  sources,
  share,
}: {
  sentence: { readonly words: ReadonlySet<string> };
  sources: readonly Unit[];
  share: number;
}): Unit | undefined {
  let best: Unit | undefined;
  let bestOverlap = 0;
  for (const source of sources) {
    const overlap = [...sentence.words].filter((word) => source.words.has(word)).length;
    if (overlap > bestOverlap) {
      best = source;
      bestOverlap = overlap;
    }
  }
  if (best === undefined || bestOverlap < 2 || bestOverlap < share * sentence.words.size) {
    return undefined;
  }
  return best;
}

/**
 * Whether a folded text holds a phrase whole.
 *
 * @param folded the text, folded for a verbatim test
 * @param phrase the words to find, folded here
 * @returns true when every word stands there in order
 */
export function holdsWhole({ folded, phrase }: { folded: string; phrase: string }): boolean {
  const needle = foldedForQuote({ text: phrase });
  return needle !== "" && ` ${folded} `.includes(` ${needle} `);
}

/**
 * Every string a tool answer's JSON holds, depth first, so a field's text reads as its own sentences; an answer that is
 * not JSON is its own one string.
 *
 * @param text a tool answer as the model was handed it
 * @returns its strings, in document order
 */
export function textsOf({ text }: { text: string }): readonly string[] {
  const parsed = parseJson({ text });
  if (parsed.isErr()) {
    return [text];
  }
  const out: string[] = [];
  const walk = (value: unknown): void => {
    if (typeof value === "string") {
      out.push(value);
    } else if (Array.isArray(value)) {
      value.forEach(walk);
    } else if (value !== null && typeof value === "object") {
      Object.values(value).forEach(walk);
    }
  };
  walk(parsed.value);
  return out;
}

/**
 * Read some source texts once, for every summary checked against them.
 *
 * @param texts the sources: tool answers, the owner's words, the model's earlier messages
 * @returns their sentences, numbers and folded text
 */
export function claimSourcesOf({ texts }: { texts: readonly string[] }): ClaimSources {
  const sentences = texts.flatMap((text) => claimSentencesRead({ text }));
  return {
    folded: texts.map((text) => foldedForQuote({ text })).join(" "),
    numbers: unionOf({ pick: (sentence) => sentence.numbers, sentences }),
    sentences,
  };
}

/**
 * A summary sentence's quotes that no source holds verbatim.
 *
 * @param folded every source, folded for a verbatim test
 * @returns one `misquote` per quote no source holds
 */
export function misquotes({ sentence, folded }: { sentence: ClaimSentence; folded: string }): readonly ClaimFinding[] {
  return sentence.quotes
    .filter((quote) => !holdsWhole({ folded, phrase: quote }))
    .map((quote) => ({ detail: `"${quote}"`, kind: "misquote", sentence: sentence.text }));
}

/**
 * The polarity flips in a summary sentence: each clause against the source clause it restates. Read by clause, not
 * sentence, because a summary joins and splits sentences freely: a graded call showed a voice joining "…a local
 * file. I haven't checked…" into one sentence read as a negation it added.
 *
 * @param sources the source sentences whose clauses the summary's are aligned to
 * @param sourceName how a finding names the source side
 * @returns one `polarity-flip` per clause negated on one side only
 */
export function polarityOf({
  sentence,
  sources,
  sourceName,
}: {
  sentence: ClaimSentence;
  sources: readonly ClaimSentence[];
  sourceName: string;
}): readonly ClaimFinding[] {
  const clauses = sources.flatMap((source) => source.clauses);
  return sentence.clauses.flatMap((clause) => {
    if (clause.words.size < CLAIM_WORDS) {
      return [];
    }
    const aligned = alignedOf({ sentence: clause, share: ALIGNED_SHARE, sources: clauses });
    if (aligned === undefined || aligned.negated === clause.negated) {
      return [];
    }
    const side = aligned.negated ? `the ${sourceName} only` : "the summary only";
    return [{ detail: `negated in ${side}: ${aligned.text}`, kind: "polarity-flip", sentence: sentence.text }];
  });
}

/**
 * The numbers of an aligned pair traded for others: left out of the summary while ones the source lacks are said.
 *
 * @param aligned the source sentence the summary sentence restates
 * @param summaryAll every number the whole summary says
 * @param sourceAll every number the whole source holds
 * @returns the numbers lost and said, both empty unless both are present
 */
export function swapOf({
  aligned,
  sentence,
  summaryAll,
  sourceAll,
}: {
  aligned: ClaimSentence;
  sentence: ClaimSentence;
  summaryAll: ReadonlySet<string>;
  sourceAll: ReadonlySet<string>;
}): { readonly lost: readonly string[]; readonly said: readonly string[] } {
  const lost = [...aligned.numbers].filter((value) => !summaryAll.has(value));
  const said = [...sentence.numbers].filter((value) => !sourceAll.has(value));
  if (lost.length === 0 || said.length === 0) {
    return { lost: [], said: [] };
  }
  return { lost, said };
}
