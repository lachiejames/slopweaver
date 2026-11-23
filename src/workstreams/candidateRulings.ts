/**
 * Which candidates the owner has ruled on, and the one line that names a ruling — what the console voice reads, so it never
 * walks the owner through a candidate already answered and can say what was said when asked about one.
 *
 * A candidate is RULED when the reactions ledger holds a row for it, whatever the word: a no or a not-sure is the owner's
 * ruling as much as a yes is. Pure.
 */
import type { CandidatesDocument, CandidateView } from "./candidatesDocument.js";

/** Which side of the ruled line a listing keeps. */
export type RulingFilter = "ruled" | "unruled";

/** How much of the owner's words a listing line carries before it cuts, so a whole ruled listing fits one voice read. */
const HEARD_LINE_CHARS = 100;

/**
 * How much of a candidate's name a listing line carries. A name has no length bound in the schema, and it sits ahead
 * of the ruling on the line, so it is cut here rather than letting a long one push the ruling out.
 */
const LISTING_NAME_MAX_CHARS = 80;

/**
 * The most one listing line carries: a safety net past the id's schema bound (80), the name's cut (80) and the ruling
 * (its heard words cut to 100), which together stay under it, so the cut never reaches the ruling. What follows the
 * ruling — the register id it is held as — is what a cut would take.
 */
const LISTING_LINE_MAX_CHARS = 400;

/**
 * A run of whitespace a listing line collapses to one space: JavaScript's `\s` plus U+0085 NEXT LINE, the one
 * Unicode whitespace it leaves out.
 */
const WHITESPACE_RUN = /[\s\u0085]+/gu;

/**
 * Cut text to at most `max` characters, ending on an ellipsis when it was longer. Counted in code points, never UTF-16
 * units, so a cut never splits an emoji into a replacement character.
 *
 * @returns the text, whole or cut
 */
function cutTo({ text, max }: { text: string; max: number }): string {
  const chars = Array.from(text);
  if (chars.length <= max) {
    return text;
  }
  return `${chars.slice(0, max - 1).join("")}…`;
}

/**
 * A name as a listing line carries it: on one line, as the owner's heard words are, so a newline in it cannot split the
 * candidate from its ruling, and cut to {@link LISTING_NAME_MAX_CHARS}.
 *
 * @returns the name on one line, cut with an ellipsis when it was longer
 */
export function listingName({ name }: { name: string }): string {
  return cutTo({ max: LISTING_NAME_MAX_CHARS, text: name.replace(WHITESPACE_RUN, " ") });
}

/**
 * The most of a filtered listing's lines the text form prints, in UTF-8 bytes once JSON-escaped — the measure the
 * voice's answer envelope cuts by. The voice reads a verb answer cut at 20 KiB (`src/talk/verbOutput.ts`'s
 * `VERB_OUTPUT_MAX_BYTES`, which a test holds this under); this leaves room for the totals, the line naming what was
 * left out and the envelope, so what the voice reads is never cut mid-list without saying so. As the ruled half
 * grows, its oldest rulings are the first left out. Measure the live set: `slopweaver workstreams candidates --ruled
 * | wc -c`.
 */
export const LISTING_MAX_BYTES = 17 * 1024;

/**
 * Keep only the candidates on one side of the ruled line; every count still describes the whole set, so a reader
 * of either half knows how many sit on the other. Ruled candidates come newest ruling first, so a listing cut to its
 * budget leaves out the oldest — the ones least likely to be what the owner is asking about.
 *
 * @param filter `unruled` for those with no row from the owner yet, `ruled` for those with one
 * @returns the document with only those candidates
 */
export function candidatesOnly({
  document,
  filter,
}: {
  document: CandidatesDocument;
  filter: RulingFilter;
}): CandidatesDocument {
  const wantRuled = filter === "ruled";
  const kept = document.candidates.filter((one) => (one.reaction !== null) === wantRuled);
  if (!wantRuled) {
    return { ...document, candidates: kept };
  }
  // By instant, never by string: two valid ISO stamps of different fractional precision sort wrongly as text
  // A ruled candidate always carries its stamp.
  const at = (one: CandidateView): number => Date.parse(String(one.reactedIso));
  const candidates = kept.toSorted((a, b) => at(b) - at(a) || a.n - b.n);
  return { ...document, candidates };
}

/**
 * Fit a listing's lines to {@link LISTING_MAX_BYTES}: each cut to {@link LISTING_LINE_MAX_CHARS}, then as many as
 * fit, in order.
 *
 * @param lines the listing's lines, in the order they should be read
 * @returns the lines that fit, and how many were left out
 */
export function fitListing({ lines }: { lines: readonly string[] }): {
  readonly kept: readonly string[];
  readonly left: number;
} {
  const kept: string[] = [];
  let used = 0;
  for (const line of lines) {
    const cut = cutTo({ max: LISTING_LINE_MAX_CHARS, text: line });
    // Escaped as the envelope will escape it, its newline included (two bytes, `\n`).
    const size = Buffer.byteLength(JSON.stringify(`${cut}\n`), "utf8") - 2;
    if (used + size > LISTING_MAX_BYTES) {
      break;
    }
    used += size;
    kept.push(cut);
  }
  return { kept, left: lines.length - kept.length };
}

/**
 * How a ruled candidate's ruling reads in one line: the day it was given and the owner's words as heard, cut to fit; a row
 * written before the words were kept says so rather than reading as silence.
 *
 * @param one a candidate carrying the owner's reaction
 * @returns the ruling's day and words, or `undefined` when the candidate carries no ruling
 */
export function rulingWords({ one }: { one: CandidateView }): string | undefined {
  if (one.reaction === null || one.reactedIso === null) {
    return undefined;
  }
  const day = one.reactedIso.slice(0, 10);
  if (one.heard === null) {
    return `${day}, the owner's words not recorded`;
  }
  const heard = cutTo({ max: HEARD_LINE_CHARS, text: one.heard.replace(WHITESPACE_RUN, " ") });
  return `${day}: "${heard}"`;
}
