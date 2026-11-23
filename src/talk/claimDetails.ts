/**
 * The details a claim carries that a faithful summary keeps exactly — the pure reading under `./claimFidelity.ts`.
 *
 * The rule: a summary that drops or swaps key details is information lost before it reaches the owner. A
 * content-word overlap (`./wordDivergence.ts`) cannot say which words were key: on a measured call it flagged 32 of
 * 34 handed messages. These are
 * the parts of a sentence whose change changes what it claims, read with no list of banned or favoured phrases:
 *
 * - a **number**, in digits or spoken words ("three hundred" is 300), never one inside an identifier;
 * - an **identifier**: a `#N`, a commit, a hyphenated slug, a path or a link, which speech keeps out on purpose;
 * - a **quote**: a span in quotation marks, which says the source's own words are being given;
 * - **polarity**: whether the sentence negates ("not", "never", "no", "n't", "without", "cannot").
 *
 * "one" is not read as a number, since "the one that" is not a count. Pure: no filesystem, no clock.
 */
import { contentWords } from "./wordDivergence.js";

/** One clause of a sentence: the unit polarity is read at, since a summary joins and splits sentences freely. */
interface ClaimClause {
  readonly text: string;
  readonly words: ReadonlySet<string>;
  readonly negated: boolean;
}

/** One sentence and what it claims. */
export interface ClaimSentence {
  readonly text: string;
  /** Its content words, each once, cut to their first `STEM_CHARS` letters. */
  readonly words: ReadonlySet<string>;
  readonly numbers: ReadonlySet<string>;
  readonly identifiers: ReadonlySet<string>;
  readonly quotes: readonly string[];
  readonly negated: boolean;
  readonly question: boolean;
  readonly clauses: readonly ClaimClause[];
}

/**
 * How many leading letters of a content word are compared: "assume" and "assumed", "repeat" and "repeating" are one
 * word to a summary. Graded on a measured call: whole words read every reworded ending as a dropped claim.
 */
const STEM_CHARS = 5;

/** The spoken number words, each with its value; "one" deliberately absent (header). */
const UNITS: ReadonlyMap<string, number> = new Map([
  ["two", 2],
  ["three", 3],
  ["four", 4],
  ["five", 5],
  ["six", 6],
  ["seven", 7],
  ["eight", 8],
  ["nine", 9],
  ["ten", 10],
  ["eleven", 11],
  ["twelve", 12],
  ["thirteen", 13],
  ["fourteen", 14],
  ["fifteen", 15],
  ["sixteen", 16],
  ["seventeen", 17],
  ["eighteen", 18],
  ["nineteen", 19],
  ["twenty", 20],
  ["thirty", 30],
  ["forty", 40],
  ["fifty", 50],
  ["sixty", 60],
  ["seventy", 70],
  ["eighty", 80],
  ["ninety", 90],
]);

/** The multipliers a spoken number may carry. */
const SCALES: ReadonlyMap<string, number> = new Map([
  ["hundred", 100],
  ["thousand", 1000],
  ["million", 1_000_000],
]);

/** The words that make a clause negate its claim. */
const NEGATIONS: ReadonlySet<string> = new Set(["not", "never", "no", "none", "nothing", "without", "cannot", "nor"]);

/**
 * An identifier: `#N`, a link, a path, a slug of three or more parts, or a commit-like hex run with a digit. A slug
 * keeps its words for number reading ("three-hundred-line" says 300), so `SLUG` is split out of it.
 */
const IDENTIFIER =
  /#\d+|https?:\/\/\S+|(?:[\w.-]+\/)+[\w.-]+|\b[a-z0-9]+(?:-[a-z0-9]+){2,}\b|\b(?=[0-9a-f]*\d)(?=[0-9a-f]*[a-f])[0-9a-f]{7,40}\b/giu;

/** A slug of three or more parts, which reads as its own words for numbers. */
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+){2,}$/iu;

/** Where a sentence divides into clauses: a semicolon, a colon, a dash, or a joining "but", "so" or "though". */
const CLAUSE_BREAK = /\s*[;:—–]\s*|,?\s+(?:but|so|though|although|whereas)\s+/iu;

/** A span in straight or curly double quotation marks. */
const QUOTED = /["“]([^"”]{3,400})["”]/gu;

/** A text cut into sentences at `.`, `!`, `?` or `…` followed by space, or a line break: trimmed, none empty. */
function claimSentencesOf({ text }: { text: string }): readonly string[] {
  return text
    .split(/(?<=[.!?…])\s+|\n+/u)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence !== "");
}

/**
 * A text folded for a verbatim comparison: lowercase, straight apostrophes, letters and digits only, single spaces.
 *
 * @param text a quote or a source
 * @returns the folded text
 */
export function foldedForQuote({ text }: { text: string }): string {
  return text
    .toLowerCase()
    .replaceAll(/[’‘]/gu, "'")
    .replaceAll(/[^a-z0-9']+/gu, " ")
    .trim();
}

/** The value of a run of spoken number words, or `undefined` when it holds none. */
function spokenValue({ run }: { run: readonly string[] }): number | undefined {
  let total = 0;
  let current = 0;
  let seen = false;
  for (const word of run) {
    const unit = UNITS.get(word);
    const scale = SCALES.get(word);
    if (unit !== undefined) {
      current += unit;
      seen = true;
    } else if (scale !== undefined) {
      current = Math.max(current, 1) * scale;
      if (scale >= 1000) {
        total += current;
        current = 0;
      }
      seen = true;
    }
  }
  return seen ? total + current : undefined;
}

/** Every number a text states, digits and spoken words alike, identifiers already blanked out. */
function numbersOf({ text }: { text: string }): ReadonlySet<string> {
  const numbers = new Set<string>();
  for (const match of text.matchAll(/\b\d[\d,]*(?:\.\d+)?\b/gu)) {
    numbers.add(String(Number(match[0].replaceAll(",", ""))));
  }
  let run: string[] = [];
  const flush = (): void => {
    const value = spokenValue({ run });
    if (value !== undefined) {
      numbers.add(String(value));
    }
    run = [];
  };
  for (const word of text.toLowerCase().split(/[^a-z]+/u)) {
    if (UNITS.has(word) || SCALES.has(word) || (word === "a" && run.length === 0)) {
      run.push(word);
    } else {
      flush();
    }
  }
  flush();
  return numbers;
}

/** Whether a sentence negates: a negation word, or a "n't" contraction. */
function negates({ text }: { text: string }): boolean {
  const words = text
    .toLowerCase()
    .replaceAll("’", "'")
    .split(/[^a-z']+/u);
  return words.some((word) => NEGATIONS.has(word) || word.endsWith("n't"));
}

/**
 * One sentence, read for the details it claims.
 *
 * @param text the sentence
 * @returns its words, numbers, identifiers, quotes, polarity and whether it asks
 */
export function claimSentence({ text }: { text: string }): ClaimSentence {
  const identifiers = new Set([...text.matchAll(IDENTIFIER)].map((match) => match[0].toLowerCase()));
  const blanked = text.replaceAll(IDENTIFIER, " ");
  const spelled = text.replaceAll(IDENTIFIER, (match) => (SLUG.test(match) ? match.replaceAll("-", " ") : " "));
  const quotes = [...text.matchAll(QUOTED)].map((match) => match[1]!.trim());
  const clauses = blanked
    .split(CLAUSE_BREAK)
    .map((clause) => clause.trim())
    .filter((clause) => clause !== "")
    .map((clause) => ({ negated: negates({ text: clause }), text: clause, words: stemsOf({ text: clause }) }));
  return {
    clauses,
    identifiers,
    negated: negates({ text: blanked }),
    numbers: numbersOf({ text: spelled }),
    question: text.trimEnd().endsWith("?"),
    quotes,
    text,
    words: stemsOf({ text: blanked }),
  };
}

/** A text's content words, each cut to its first `STEM_CHARS` letters, each once. */
function stemsOf({ text }: { text: string }): ReadonlySet<string> {
  return new Set(contentWords({ text }).map((word) => word.slice(0, STEM_CHARS)));
}

/**
 * Every sentence of a text, read.
 *
 * @param text what was written, said or read
 * @returns its sentences in order
 */
export function claimSentencesRead({ text }: { text: string }): readonly ClaimSentence[] {
  return claimSentencesOf({ text }).map((sentence) => claimSentence({ text: sentence }));
}
