/**
 * Where the private terms (`./privateTerms.ts`) match a text: by line and class for a refusal, by offsets for a hold.
 * Every answer here names offsets, lines, classes and row ids, never the matched text, so a caller that does not read
 * the text itself cannot see what matched.
 */
import type { PrivateTerm, PrivateTermClass } from "./privateTerms.js";

/** The offset each line of a text starts at, line one first. */
function lineStartsOf({ text }: { text: string }): readonly number[] {
  const starts = [0];
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] === "\n") starts.push(index + 1);
  }
  return starts;
}

/** The one-based line an offset sits on. */
function lineOf({ lineStarts, offset }: { lineStarts: readonly number[]; offset: number }): number {
  return lineStarts.findLastIndex((start) => start <= offset) + 1;
}

/**
 * Pure: every line of a text a private term matches, at most once per line and class, in line order. A match lying
 * wholly inside a forgiven span is not a hit: the one span ever forgiven is the write's own target repository's
 * address (`ownAddressRanges`, `./ownRepository.ts`), because an owner's handle is in every link to their own
 * repository. A match reaching outside the span, the bare handle anywhere else, and another repository's address
 * all still hit.
 *
 * @param text the text, its line breaks already `\n`
 * @param terms the loaded terms
 * @param forgiven the spans a match may sit inside without hitting; none for every destination but a repository's own
 * @returns each matching line and the class that matched it; never the matched text
 */
export function privateTermHits({
  text,
  terms,
  forgiven,
}: {
  text: string;
  terms: readonly PrivateTerm[];
  forgiven: readonly { readonly start: number; readonly end: number }[];
}): readonly { readonly line: number; readonly className: PrivateTermClass }[] {
  return privateTermHitsBeside({
    exemptionOf: ({ start, end }) => {
      if (forgiven.some((span) => span.start <= start && end <= span.end)) {
        return "forgiven";
      }
      return undefined;
    },
    terms,
    text,
  }).hits;
}

/** One match of one row, by offsets into the judged text: never the matched text. */
export interface PrivateTermMatch {
  readonly termId: string;
  readonly className: PrivateTermClass;
  /** One-based line the match starts on. */
  readonly line: number;
  readonly start: number;
  readonly end: number;
}

/**
 * Pure: every match of every row in a text, one entry each and never deduplicated, in text order — what a hold
 * needs to name each row and show each match in context. The same forgiveness as {@link privateTermHits}.
 *
 * @param text the text, its line breaks already `\n`
 * @param terms the loaded terms
 * @param forgiven the spans a match may sit wholly inside without counting
 * @returns each counting match with the row that made it
 */
export function privateTermMatches({
  text,
  terms,
  forgiven,
}: {
  text: string;
  terms: readonly PrivateTerm[];
  forgiven: readonly { readonly start: number; readonly end: number }[];
}): readonly PrivateTermMatch[] {
  const lineStarts = lineStartsOf({ text });
  const matches: PrivateTermMatch[] = [];
  for (const { className, re, termId } of terms) {
    for (const match of text.matchAll(re)) {
      const start = match.index;
      const end = start + match[0].length;
      if (forgiven.some((span) => span.start <= start && end <= span.end)) {
        continue;
      }
      matches.push({ className, end, line: lineOf({ lineStarts, offset: start }), start, termId });
    }
  }
  return matches.toSorted((left, right) => left.start - right.start || left.termId.localeCompare(right.termId));
}

/**
 * Pure: {@link privateTermHits}, except that each MATCH is first offered to `exemptionOf` by its offsets, and one it
 * names a reason for is counted under that reason instead of hitting. The decision is per match, never per row or
 * per line: a line holding an exempt match and an unexempt one of the same class still hits.
 *
 * @param text the text, its line breaks already `\n`
 * @param terms the loaded terms
 * @param exemptionOf the reason one match is exempt, or undefined when it counts; handed offsets, the class and the
 *   row's own pattern (so a caller can ask whether the row would also match a canonical spelling there), never the
 *   matched text, so a caller that does not read `text` itself cannot see it
 * @returns the hits left counting, as {@link privateTermHits} returns them, and every exempted match, one entry each
 */
export function privateTermHitsBeside<Reason extends string>({
  text,
  terms,
  exemptionOf,
}: {
  text: string;
  terms: readonly PrivateTerm[];
  exemptionOf: (match: {
    readonly start: number;
    readonly end: number;
    readonly className: PrivateTermClass;
    readonly re: RegExp;
  }) => Reason | undefined;
}): {
  readonly hits: readonly { readonly line: number; readonly className: PrivateTermClass }[];
  readonly exempted: readonly { readonly reason: Reason; readonly className: PrivateTermClass }[];
} {
  const lineStarts = lineStartsOf({ text });
  const seen = new Set<string>();
  const hits: { line: number; className: PrivateTermClass }[] = [];
  const exempted: { reason: Reason; className: PrivateTermClass }[] = [];
  for (const { className, re } of terms) {
    for (const match of text.matchAll(re)) {
      const reason = exemptionOf({ className, end: match.index + match[0].length, re, start: match.index });
      if (reason !== undefined) {
        exempted.push({ className, reason });
        continue;
      }
      const line = lineOf({ lineStarts, offset: match.index });
      const key = `${String(line)}:${className}`;
      if (!seen.has(key)) {
        seen.add(key);
        hits.push({ className, line });
      }
    }
  }
  return { exempted, hits: hits.toSorted((left, right) => left.line - right.line) };
}
