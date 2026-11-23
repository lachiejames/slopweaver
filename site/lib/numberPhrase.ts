/*
 * Numbers in one phrase read one way. On the Queue card: 1.7K beside 5.9K, or 1,734 beside 5,977,
 * never one of each. A card's prose is written by many producers, and every card already queued has to obey it
 * (render-time, ruling 10), so the rule is applied where a sentence is drawn rather than where it was written.
 *
 * Only one direction is possible at render time: 1.7K cannot become an exact count nobody recorded, so a sentence that
 * mixes the two shortens its exact thousands. A short form TRUNCATES to one decimal — 5,977 is 5.9K, never a rounded
 * 6K that overstates it. A bare 2026 is a year as often as a count, so only a comma-grouped number counts as exact,
 * and a number under a thousand reads the same either way. The owner's own words are never rewritten: a quote is verbatim.
 */

/** How the numbers in one phrase are written: shortened to thousands and millions, or grouped in full. */
export type NumberPhraseNotation = "compact" | "exact";

/** A shortened count as prose writes one: `1.7K`, `12K`, `3.4M`. */
const COMPACT = /\b\d+(?:\.\d+)?[KkMm]\b/u;

/** A comma-grouped count, the exact form: `1,734`, `12,000,000`, `5,977.5`. */
const GROUPED = /\b\d{1,3}(?:,\d{3})+(?:\.\d+)?\b/gu;

/**
 * The gap after a sentence's terminal stop and any closing quote or bracket after it, captured so splitting on it keeps
 * it, and each sentence is judged alone.
 */
const SENTENCE = /((?<=[.!?]["'”’)]*)\s+)/u;

/**
 * A quoted span in a producer's prose — someone's words, which are never rewritten — captured so a split keeps it. A
 * `’` with a letter after it is an apostrophe (`That’s`), so it never closes a `‘` span.
 */
const QUOTED = /("[^"]*"|“[^”]*”|‘(?:[^’]|’(?=\p{L}))*’)/u;

/**
 * One count shortened the way the rest of its phrase is: one decimal, truncated, a trailing `.0` dropped.
 *
 * @returns the short form, or the count grouped in full when it is under a thousand
 */
function compactOf({ value }: { value: number }): string {
  const size = Math.abs(value);
  let scale = 1;
  let unit = "";
  if (size >= 1_000_000) {
    scale = 1_000_000;
    unit = "M";
  } else if (size >= 1000) {
    scale = 1000;
    unit = "K";
  }
  if (unit === "") {
    return value.toLocaleString("en-US");
  }
  // Scale up before dividing, so 4,100 is 41,000 / 1,000 — exactly 41 — never 4.1 * 10 landing a hair under it.
  const tenths = Math.trunc((value * 10) / scale) / 10;
  return `${String(tenths)}${unit}`;
}

/**
 * Every number in one phrase written the same way, so two of them are never one of each.
 *
 * @param values the numbers the phrase names, in order
 * @param notation `compact` for 1.7K, `exact` for 1,734 — applied to every value alike
 * @returns each value as the phrase draws it, in the order given
 */
export function formatNumberPhrase({
  values,
  notation,
}: {
  values: readonly number[];
  notation: NumberPhraseNotation;
}): readonly string[] {
  if (notation === "exact") {
    return values.map((value) => value.toLocaleString("en-US"));
  }
  return values.map((value) => compactOf({ value }));
}

/** A quote whose last words end a sentence, `"… rows."` — the prose after it opens the next one. */
const ENDS_SENTENCE = /[.!?]["”’]$/u;

/** One run of a sentence: prose the producer wrote, or a quote or gap drawn exactly as it is. */
interface SentencePart {
  readonly text: string;
  readonly kept: boolean;
}

/**
 * One sentence with its exact thousands shortened when its own prose already shortens another — and untouched
 * otherwise. A quoted span is someone's words: it neither decides the notation nor is rewritten.
 *
 * @returns the sentence as it should read
 */
function coordinated({ parts }: { parts: readonly SentencePart[] }): string {
  const shortens = parts.some((part) => !part.kept && COMPACT.test(part.text));
  return parts
    .map((part) => {
      if (part.kept || !shortens) {
        return part.text;
      }
      return part.text.replace(GROUPED, (grouped) => {
        const value = Number(grouped.replaceAll(",", ""));
        // Past 2^53 a count no longer reads back exactly, so its short form could overstate it: leave it as written.
        if (!Number.isSafeInteger(Math.trunc(value))) {
          return grouped;
        }
        return compactOf({ value });
      });
    })
    .join("");
}

/**
 * A card's sentence with its numbers written one way per sentence: a sentence naming both a shortened count and an
 * exact one reads every thousand shortened. Prose the producer wrote, never a quote — a quote is drawn as it was said.
 *
 * Quotes are cut out BEFORE sentences are found, so a stop inside one never ends the sentence around it.
 *
 * @param text the prose as the producer wrote it
 * @returns the prose, each sentence's numbers in one notation
 */
export function oneNumberNotation({ text }: { text: string }): string {
  const sentences: SentencePart[][] = [[]];
  let afterStop = false;
  // The split captures each quote, so the pieces alternate prose, quote, prose: an odd index is a quote kept as is.
  for (const [index, piece] of text.split(QUOTED).entries()) {
    if (index % 2 === 1) {
      sentences.at(-1)!.push({ kept: true, text: piece });
      afterStop = ENDS_SENTENCE.test(piece);
      continue;
    }
    let prose = piece;
    const opening = /^\s+/u.exec(prose);
    if (afterStop && opening !== null) {
      sentences.at(-1)!.push({ kept: true, text: opening[0] });
      sentences.push([]);
      prose = prose.slice(opening[0].length);
    }
    afterStop = false;
    // Likewise each gap is captured, so an odd index here is the gap that ends a sentence.
    for (const [at, part] of prose.split(SENTENCE).entries()) {
      if (at % 2 === 1) {
        sentences.at(-1)!.push({ kept: true, text: part });
        sentences.push([]);
        continue;
      }
      sentences.at(-1)!.push({ kept: false, text: part });
    }
  }
  return sentences.map((parts) => coordinated({ parts })).join("");
}
