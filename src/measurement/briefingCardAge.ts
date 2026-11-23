/**
 * HOW OLD EACH REACT-NOW CARD'S PREMISE WAS when the page carrying it was rendered.
 *
 * A card was served to the owner 23 hours old, and stale cards on the briefing's "react now" had recurred, so
 * the question was whether that was a one-off. This is the measurement that answered it, and it is committed so the number
 * `../briefing/cardPremise.ts` cites has a command behind it rather than a memory:
 *
 * ```
 * yarn tsx src/measurement/briefingCardAge.entry.ts \
 *   --open-pages ~/.slopweaver/supervisor-scratch/handoff-<n>/open-pages.json \
 *   --briefings '~/.slopweaver/supervisor-scratch/handoff-<n>/briefing-t*.html'
 * ```
 *
 * On the version the owner read: 28 cards, 21 with a datable premise, **all 21 over
 * 12 hours**, 18 over 24, the oldest 261.3 hours. Over the last twenty renders: 534 card-appearances, 420
 * datable, 418 over 12 hours, and 114 — every hand-written card — with no age source at all.
 *
 * ## Why it reads the RENDERED page rather than the form
 *
 * Because the form never carried an age. The number that matters is what reached the owner, and what reached them
 * was HTML: a card's premise was datable only when its subject linked a page the open-artifacts document knew
 * a `landedIso` for. Counting off the form would have measured what a composer intended instead.
 *
 * Pure — the entry point does the reading and supplies the instants.
 */
import { plainText } from "../briefing/text.js";

/**
 * One card on one rendered version, with its premise age when that version was rendered.
 *
 * @internal — the row {@link MeasuredVersion} holds; the entry point reads it through that and nothing else
 * names the type.
 */
export interface MeasuredCard {
  /** 1-based position within the react-now block, which is the number the owner reads on the page. */
  readonly card: number;
  /** The card's question, for naming it. */
  readonly question: string;
  /** Hours between the premise's own instant and the render, or `undefined` when nothing dated it. */
  readonly ageHours: number | undefined;
}

/** What one rendered version measured. */
export interface MeasuredVersion {
  /** Where the bytes came from. */
  readonly source: string;
  /** When that version was rendered. */
  readonly renderedIso: string;
  readonly cards: readonly MeasuredCard[];
}

/** The heading the react-now block opens with, attributes and all. */
const REACT_NOW_HEADING = /<h2[^>]*>\s*react now\s*<\/h2>/i;
const ANY_H2_OPEN = /<h2[ >]/i;
const NEED_DIV_OPEN = /<div class="need"[^>]*>/g;
const DIV_TAG = /<div\b[^>]*>|<\/div>/g;
const QUESTION_DIV = /<div class="q">([\s\S]*?)<\/div>/;
const SUBJECT_LINK = /<div class="bg">\s*<a href="([^"]+)"/;

/** The `<div …>…</div>` starting at `start`, matched by counting nested tags. */
function balancedDiv({ text, start }: { text: string; start: number }): string | undefined {
  const tags = new RegExp(DIV_TAG.source, "g");
  tags.lastIndex = start;
  let depth = 0;
  let match: RegExpExecArray | null;
  while ((match = tags.exec(text)) !== null) {
    depth += match[0].startsWith("</") ? -1 : 1;
    if (depth === 0) {
      return text.slice(start, match.index + match[0].length);
    }
  }
  return undefined;
}

/**
 * Measure one rendered briefing page's react-now cards.
 *
 * @param html the whole rendered page
 * @param source where the bytes came from, for the report
 * @param renderedIso when that version was rendered
 * @param landedByUrl each open page's own landing instant, keyed by its URL
 * @returns one row per card, in page order
 */
export function measureVersion({
  html,
  source,
  renderedIso,
  landedByUrl,
}: {
  html: string;
  source: string;
  renderedIso: string;
  landedByUrl: ReadonlyMap<string, string>;
}): MeasuredVersion {
  const heading = REACT_NOW_HEADING.exec(html);
  if (heading === null) {
    return { cards: [], renderedIso, source };
  }
  const after = html.slice(heading.index + heading[0].length);
  const next = ANY_H2_OPEN.exec(after);
  const block = after.slice(0, next === null ? after.length : next.index);
  const rendered = Date.parse(renderedIso);
  const cards: MeasuredCard[] = [];
  for (const open of block.matchAll(NEED_DIV_OPEN)) {
    const cardHtml = balancedDiv({ start: open.index, text: block });
    if (cardHtml === undefined) {
      continue;
    }
    if (QUESTION_DIV.exec(cardHtml) === null) {
      continue;
    }
    const url = SUBJECT_LINK.exec(cardHtml)?.[1]?.split("#")[0];
    const landed = url === undefined ? undefined : landedByUrl.get(url);
    cards.push({
      ageHours: landed === undefined ? undefined : (rendered - Date.parse(landed)) / 3_600_000,
      card: cards.length + 1,
      // A card with no `.q` block is not a card this measurement can name, so it is skipped above rather
      // than counted with an empty question.
      question: plainText({ html: QUESTION_DIV.exec(cardHtml)![1]! }),
    });
  }
  return { cards, renderedIso, source };
}

/** The totals across every version measured — the four numbers the finding is stated in. */
export interface AgeTotals {
  readonly appearances: number;
  /** How many carried a premise anything could date. */
  readonly datable: number;
  /** How many datable ones were older than the hours asked about. */
  readonly overThreshold: number;
  /** The oldest datable premise seen, in hours, or `undefined` when none was datable. */
  readonly oldestHours: number | undefined;
}

/**
 * Total one set of measured versions.
 *
 * @param versions every version measured, in any order
 * @param thresholdHours the age the count is taken against — 12 in the finding this was written for
 * @returns the four totals
 */
export function totalAges({
  versions,
  thresholdHours,
}: {
  versions: readonly MeasuredVersion[];
  thresholdHours: number;
}): AgeTotals {
  const ages = versions.flatMap((version) =>
    version.cards.map((card) => card.ageHours).filter((age): age is number => age !== undefined),
  );
  return {
    appearances: versions.reduce((total, version) => total + version.cards.length, 0),
    datable: ages.length,
    oldestHours: ages.length === 0 ? undefined : Math.max(...ages),
    overThreshold: ages.filter((age) => age > thresholdHours).length,
  };
}
