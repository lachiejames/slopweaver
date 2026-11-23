/**
 * The FIGURES a parked draft as the owner states in its own prose — the count `./draftEarnsItsPlace.ts` holds to one.
 *
 * The owner stripped five figures off one parked draft by voice, and the cut they kept states ONE figure with every other number drawn as a red
 * annotation on the attached chart. So this asks one question of a draft's authored text: how many distinct numbers
 * does a reader have to hold?
 *
 * **Why not `../assistant/measuredFigures.ts`.** That criterion is narrow on purpose (a figure there owes a repro
 * command, so every false positive costs a composer an entry): its floor is three digits and its decimal mask eats
 * a decimal amount such as `$12.4k`. Under it a two-digit amount (`$12k`) and a decimal count (`4.2k`) owe nothing,
 * and they are exactly the kind of figure the owner removed. Same
 * mask-then-scan design, a different criterion: anything a reader reads as a quantity.
 *
 * **The criterion.** A figure is a currency amount, a percentage, a `k`/`m`/`b`-suffixed count, a thousands-separated
 * count, a decimal, a number welded to a unit (`500ms`, `5x`) or any run of two or more digits. A single bare digit is
 * a word ("5 PRs" reads as words). Masked out, each mask scanned over the ORIGINAL text on its own and the ranges
 * unioned, so one mask can never half-consume a token another one names (a sequential replace let the welded-word
 * mask eat `v6` out of `v6.1.0` and left `1.0` to count): dates in every spelling the owner writes, clock times, versions,
 * welded identifiers (`p95`, `INC-33`, `BBB-389`), `#N` refs and `PR` references, ordinals, bare ids of five or more digits,
 * a year from 1990 to 2039, `4xx` and a status code with its context word. A figure overlapping any masked range is
 * not counted.
 *
 * **Residue, stated rather than discovered.** "the LB 503 one" counts (a status code with no context word); "Node 22"
 * and "TS 6.0" count (a product's version with no `v`); "2000 requests" is masked as a year; `10-20` counts as two;
 * `200s` meaning seconds is masked as a status code; a spelled-out number never counts. A `code` run is the route for an identifier the matcher misreads, since the gate
 * reads no code run at all.
 */

/** Every token a reader reads as a quantity, longest alternative first. */
const FIGURE =
  /[$£€]\s?\d[\d,]*(?:\.\d+)?(?:\s?[kmb]n?\b)?|\d[\d,]*(?:\.\d+)?\s?%|\d[\d,]*(?:\.\d+)?[kmb]n?\b|\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+\.\d+|\d+(?:ms|s|h|d|w|x)\b|\d{2,}/giu;

/** A month as the owner writes one, whole words only, so "maybe 20" and "marked 12" are not dates. */
const MONTH = String.raw`(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b\.?`;

/** What reads as a number and is not a quantity. Each is scanned over the original text independently. */
const MASKS: readonly RegExp[] = [
  /\d{4}-\d{2}-\d{2}(?:T[\d:.]+Z?)?/g,
  new RegExp(String.raw`\b\d{1,2}(?:st|nd|rd|th)?\s+${MONTH}(?:,?\s+(?:19|20)\d{2}\b)?`, "gi"),
  new RegExp(String.raw`\b${MONTH}\s+\d{1,2}(?:st|nd|rd|th)?\b(?:,?\s+(?:19|20)\d{2}\b)?`, "gi"),
  /\b\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b/g,
  /\b(?:in|since|by|of|from|until|before|after|early|mid|late)\s+(?:19|20)\d{2}\b/gi,
  /\b\d{1,2}(?::\d{2}){1,2}(?:\s?[ap]m)?\b/gi,
  /\b\d{1,2}\s?[ap]m\b/gi,
  /\bv\d+(?:\.\d+)*\b|\b\d+\.\d+\.\d+\b/gi,
  /[A-Za-z_]-?\d+/g,
  /#\d+/g,
  /\b\d+(?:st|nd|rd|th)\b/gi,
  /(?<![\d,.$£€])\d{5,}(?![\d,.%])/g,
  /\b[1-5]xx\b/gi,
  /(?<![\d,.$£€])(?:199\d|20[0-3]\d)(?![\d%]|[,.]\d|\s?[kmb]n?\b)/gi,
  /\b(?:PR|pull request|issue|ticket)s?\s+\d+/gi,
  /\b(?:HTTP|status)\s?[1-5]\d{2}\b|\b[1-5]\d{2}s?(?=\s+(?:errors?|responses?|status(?:es)?|codes?)\b)|\b[1-5]\d{2}s\b/gi,
];

/**
 * Every character range a mask claims, unioned across masks.
 *
 * @returns the half-open `[start, end)` ranges, in no particular order
 */
function maskedRanges({ text }: { text: string }): readonly (readonly [number, number])[] {
  return MASKS.flatMap((mask) =>
    [...text.matchAll(mask)].map((match) => [match.index, match.index + match[0].length] as const),
  );
}

/**
 * The distinct figures a draft's authored text states, in first-seen order. Pure.
 *
 * @param text the authored prose to read — the caller has already left out code runs, link labels and mentions
 * @returns each figure once, trimmed and lowercased, so `$12.4K` and `$12.4k` are one figure
 */
export function figuresInDraftText({ text }: { text: string }): readonly string[] {
  const masked = maskedRanges({ text });
  const seen = new Set<string>();
  for (const match of text.matchAll(FIGURE)) {
    const start = match.index;
    const end = start + match[0].length;
    if (masked.some(([from, to]) => start < to && from < end)) {
      continue;
    }
    seen.add(match[0].trim().toLowerCase());
  }
  return [...seen];
}
