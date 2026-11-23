/**
 * RARE-TOKEN OVERLAP — deciding whether two texts are about the same subject, with no model involved.
 *
 * Pure: no filesystem, no clock, no network, no model (AGENTS.md rule 2). Every input is passed in.
 *
 * ## Why rarity, and not plain overlap
 *
 * Plain overlap is useless on a real corpus. MEASURED on this installation's 120-doc handover board,
 * requiring two shared five-letter tokens between a subject and a doc matched 90 of the 120, because
 * `review`, `probe`, `session` and `board` appear in nearly every doc written here. So a token only counts
 * when it is RARE across the sources being matched against — present in at most
 * {@link MAX_DOCUMENT_FREQUENCY} of them — which is document frequency computed over the corpus in hand
 * rather than a stop-word list somebody guessed.
 *
 * ## Why it lives in `lib/` rather than in the pass that needed it first
 *
 * `reflect/crossRef.ts` wrote it and kept the tokeniser private. `memory/hygiene/` needs exactly the same
 * question answered — twice, for near-duplicate memories and for memories restating an always-on doc — and
 * `src/memory` sits BELOW `judgement` in this tree's layering (see `memory/types.ts`), so reaching sideways
 * into the reflection pipeline for a tokeniser would invert that for the sake of one function. The code moved
 * here unchanged; behaviour is identical, which is why the reflect tests that cover it did not move with it.
 *
 * Conservative in both directions, and MISSING is the safe one: a missed match leaves a caller to report
 * something a reader can dismiss in one word, while a false match silently suppresses or demotes something
 * real and nobody ever learns it existed.
 */

/**
 * How many RARE tokens two texts must share before they are called the same subject.
 *
 * @internal
 */
export const COVERAGE_TOKEN_MATCHES = 2;

/**
 * The shortest token that counts towards a match. Short words match everything and mean nothing.
 *
 * @internal
 */
export const DISTINCTIVE_TOKEN_LENGTH = 5;

/**
 * The largest share of sources a token may appear in and still count as evidence of the same subject.
 *
 * A tenth. Measured on this installation's 120-doc board, dropping to this from "every token counts" took a
 * single finding's match set from 90 docs to a handful, which is the difference between an annotation and a
 * wall of text nobody reads.
 *
 * @internal
 */
export const MAX_DOCUMENT_FREQUENCY = 0.1;

/** One text a subject might already be covered by: a board doc, a memory, an always-on rule. */
export interface CoverageSource {
  /** What to print — a doc slug, a memory name, a rule filename. */
  readonly id: string;
  /** The text to match against: a title, a summary, a first paragraph. */
  readonly text: string;
}

/**
 * The distinctive tokens of a text, lowercased and deduped.
 *
 * @param text the text to tokenise
 * @returns every token of at least {@link DISTINCTIVE_TOKEN_LENGTH} characters, once each
 */
export function distinctiveTokens({ text }: { text: string }): ReadonlySet<string> {
  return new Set(
    text
      .toLowerCase()
      .replaceAll(/[^a-z0-9]+/g, " ")
      .split(" ")
      .filter((token) => token.length >= DISTINCTIVE_TOKEN_LENGTH),
  );
}

/** Each source's token set, plus the tokens too common across them to mean anything. */
export interface SourceTokenIndex {
  /** Index-aligned with the sources that were given. */
  readonly tokens: readonly ReadonlySet<string>[];
  /** Tokens appearing in more than the permitted share of sources, which therefore count for nothing. */
  readonly tooCommon: ReadonlySet<string>;
}

/**
 * The tokens of each source, plus the set that is too common across them to mean anything.
 *
 * Computed once per corpus rather than per subject: document frequency is a property of the sources, and
 * recomputing it for every subject would be the same answer taken sixty times.
 *
 * @param sources the corpus to index
 * @param maxFrequency the share of sources above which a token stops counting
 * @returns each source's token set, and the tokens ruled out as too common
 */
export function indexSources({
  sources,
  maxFrequency = MAX_DOCUMENT_FREQUENCY,
}: {
  sources: readonly CoverageSource[];
  maxFrequency?: number;
}): SourceTokenIndex {
  const tokens = sources.map((source) => distinctiveTokens({ text: source.text }));
  const seen = new Map<string, number>();
  for (const set of tokens) {
    for (const token of set) {
      const already = seen.get(token);
      seen.set(token, already === undefined ? 1 : already + 1);
    }
  }
  const ceiling = sources.length * maxFrequency;
  const tooCommon = new Set([...seen.entries()].filter(([, count]) => count > ceiling).map(([token]) => token));
  return { tokens, tooCommon };
}

/**
 * How many of a subject's tokens one source shares, counting only tokens that are rare across the corpus.
 *
 * Split out from the matching loop so a caller that wants the STRENGTH of a match — to rank by, or to print —
 * does not have to re-derive it from a boolean answer.
 *
 * @param subject the subject's own tokens
 * @param source the candidate source's tokens
 * @param tooCommon the tokens the corpus ruled out
 * @returns the count of shared rare tokens
 */
export function sharedRareTokens({
  subject,
  source,
  tooCommon,
}: {
  subject: ReadonlySet<string>;
  source: ReadonlySet<string>;
  tooCommon: ReadonlySet<string>;
}): number {
  let shared = 0;
  for (const token of subject) {
    if (source.has(token) && !tooCommon.has(token)) {
      shared += 1;
    }
  }
  return shared;
}
