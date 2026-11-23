/**
 * The whole-page half of the briefing gate: how much of the artifact a reader meets without expanding it.
 *
 * The per-card caps in `./reactNowCard.ts` cannot see this. A react-now block of one well-shaped card (182
 * words) can sit inside a page that has grown to 12,970 words above the fold — 12,351 of them in a single
 * "done since you last looked" section holding 129 unfolded blocks, one added every sweep and none ever
 * folded away. That page
 * violates progressive disclosure however short its cards are.
 *
 * Three rules, all from `./caps.ts`. A count of unfolded blocks outside the react-now block, because that is
 * the shape that accumulates. A total word budget over that same region, because a page can blow past
 * readable with few blocks and long ones. And a count of CARDS in the react-now block.
 *
 * ## Why the word budget stops at the react-now block
 *
 * React-now may run to fifty cards, so a total that counted them would refuse the owner's own design at the
 * eighth. So the two page rules read
 * the SAME region, `reactNowRegion`'s `outside`, and the block is bounded by a card count instead. Each card
 * is still individually held to `CARD_ABOVE_FOLD_MAX_WORDS` by `./reactNowCard.ts`, so nothing about a wall
 * of text inside one card got easier; what changed is that fifty short cards are no longer arithmetic
 * against five long ones.
 *
 * ## What is deliberately not counted
 *
 * `<style>` and `<script>` are removed before anything is measured. The artifact runtime injects a
 * kilobyte-heavy preamble script into every published page, and counting it would make the budget a measure
 * of the host rather than of what the supervisor wrote.
 */
import { base64RunEnd, characterRunEnd } from "#lib/base64Run.js";

import {
  BLOCK_MAX_ENUMERATORS,
  BLOCK_MAX_SENTENCES,
  PAGE_ABOVE_FOLD_MAX_WORDS,
  PAGE_UNFOLDED_BLOCKS_MAX,
  REACT_NOW_MAX_CARDS,
} from "./caps.js";
import { reactNowRegion } from "./reactNowCard.js";
import {
  aboveFoldText,
  balancedElement,
  endsInEllipsis,
  plainText,
  sentenceCount,
  unfolded,
  withoutQuoted,
  wordCount,
} from "./text.js";

/**
 * One page-level budget the artifact broke.
 *
 * @internal — the row shape {@link checkPageBudget} returns; no caller outside the briefing check names it.
 */
export interface PageDefect {
  /** Which budget the page broke. */
  readonly budget:
    | "unfolded-blocks"
    | "above-fold-words"
    | "react-now-cards"
    | "run-on-paragraph"
    | "packed-enumeration"
    | "truncated-ellipsis";
  readonly reason: string;
}

/**
 * What checking one artifact's page budget found.
 *
 * @internal — the shape {@link checkPageBudget} returns and the briefing check's renderer reads.
 */
export interface PageBudgetCheck {
  readonly unfoldedBlocks: number;
  /** Words above the fold OUTSIDE the react-now block — see `./caps.ts`'s `PAGE_ABOVE_FOLD_MAX_WORDS`. */
  readonly aboveFoldWords: number;
  /** How many cards the react-now block carries, across both groupings. */
  readonly reactNowCards: number;
  readonly defects: readonly PageDefect[];
}

const STYLE_OR_SCRIPT = /<(style|script)\b[^>]*>[\s\S]*?<\/\1>/gi;
const NEED_DIV_OPEN = /<div class="need"[^>]*>/g;

/** Every element a reader meets as one paragraph of prose. `div.q` is handled separately — see below. */
const TEXT_BLOCK = /<(p|dd|li|summary)\b[^>]*>([\s\S]*?)<\/\1>/gi;

/** The opening tag of a card or note's own headline block. */
const Q_DIV_OPEN = /<div class="q">/g;

/**
 * The `div.q` blocks, each read to its BALANCED close and each stripped of the elements already counted
 * separately.
 *
 * A lazy `<div class="q">([\s\S]*?)</div>` truncates at the first nested `</div>`, which on a briefing is
 * always the one inside the block's own fold — so the block's text ran on into half a list and welded its
 * `<li>` numbers into one pseudo-paragraph, reporting a packed enumeration nobody wrote. Every nested
 * paragraph, list item and summary is its own block already, so removing them here counts each exactly once.
 */
function questionBlocks({ html }: { html: string }): readonly string[] {
  const blocks: string[] = [];
  for (const open of html.matchAll(Q_DIV_OPEN)) {
    const element = balancedElement({ html, start: open.index, tag: "div" });
    if (element !== undefined) {
      blocks.push(element.replace(TEXT_BLOCK, " ").replace(/<details\b[^>]*>[\s\S]*/i, " "));
    }
  }
  return blocks;
}

/**
 * One inline enumerator: a one or two digit number with a full stop or bracket, then a space, then a word.
 *
 * Anchored to the start of the block or to whitespace, so a version, a price or an issue number never
 * matches. A real `<ol>` renders its own numbers and puts each item in its own block, so a correctly-built
 * list carries at most one of these per block and can never trip the cap.
 */
const INLINE_ENUMERATOR = /(?:^|\s)\d{1,2}[.)]\s+(?=[a-zA-Z])/g;

/**
 * Check one fleet-briefing artifact against the whole-page budget.
 *
 * @param html the whole artifact file
 * @returns the three counts and one defect per budget broken
 */
export function checkPageBudget({ html }: { html: string }): PageBudgetCheck {
  const page = html.replace(STYLE_OR_SCRIPT, " ");
  const { block, outside } = reactNowRegion({ html: page });
  const unfoldedBlocks = [...unfolded({ html: outside }).matchAll(NEED_DIV_OPEN)].length;
  // Measured over `outside`, not over the whole page, because react-now may run to fifty cards: the block
  // is bounded by a COUNT of cards each already inside its own word cap, and this is what bounds the rest.
  const aboveFoldWords = wordCount({ text: aboveFoldText({ html: outside }) });
  const regions = aboveFoldRegions({ html: outside });
  const reactNowCards = block === undefined ? 0 : [...block.matchAll(NEED_DIV_OPEN)].length;
  return {
    aboveFoldWords,
    defects: [
      ...pageDefects({ aboveFoldWords, reactNowCards, regions, unfoldedBlocks }),
      ...runOnDefects({ page }),
      // The two rules that read INSIDE a fold read every fold except a quoted one. Both are worded as an
      // instruction to a composer — "a numbered set of items is a real list", "write the whole thing" —
      // and neither is an act available over the owner's own recorded words. See `./text.ts`'s `withoutQuoted` for
      // what was measured on the live ledger and for why the writer's side scopes the same two rules out.
      // `runOnDefects` needs no such call: it reads `unfolded`, where no fold's contents survive at all.
      ...enumerationDefects({ page: withoutQuoted({ html: page }) }),
      ...ellipsisDefects({ page: withoutQuoted({ html: page }) }),
    ],
    reactNowCards,
    unfoldedBlocks,
  };
}

/** One `<h2>` section of the page, and how many words it puts above the fold. */
interface AboveFoldRegion {
  readonly region: string;
  readonly words: number;
}

/** Where a page section begins: its heading. */
const H2_ELEMENT = /<h2\b[^>]*>([\s\S]*?)<\/h2>/gi;

/**
 * The above-fold words of one region, split by the `<h2>` section each sits under, largest first.
 *
 * The folds come off BEFORE the split, so a fold that spans a heading is removed whole rather than cut in
 * two, and the regions sum to exactly the total the budget measures. What sits above the first heading is
 * the eyebrow, the title and the lede.
 */
function aboveFoldRegions({ html }: { html: string }): readonly AboveFoldRegion[] {
  const open = unfolded({ html });
  const headings = [...open.matchAll(H2_ELEMENT)];
  const starts = [0, ...headings.map((heading) => heading.index)];
  const names = ["top of page", ...headings.map((heading) => plainText({ html: heading[1]! }))];
  return starts
    .map((start, index) => ({
      region: names[index]!,
      words: wordCount({ text: plainText({ html: open.slice(start, starts[index + 1]) }) }),
    }))
    .filter((one) => one.words > 0)
    .toSorted((left, right) => right.words - left.words);
}

/** One paragraph of prose, as its plain text. */
interface TextBlock {
  readonly text: string;
}

/** Every paragraph in one region, in document order, each already reduced to plain text. */
function textBlocks({ html }: { html: string }): readonly TextBlock[] {
  const blocks: TextBlock[] = [];
  for (const match of html.matchAll(TEXT_BLOCK)) {
    const inner = match[2];
    const text = inner === undefined ? "" : plainText({ html: inner });
    if (text.length > 0) {
      blocks.push({ text });
    }
  }
  for (const block of questionBlocks({ html })) {
    const text = plainText({ html: block });
    if (text.length > 0) {
      blocks.push({ text });
    }
  }
  return blocks;
}

/** At most one defect, naming how many paragraphs run on and quoting the worst of them. */
function runOnDefects({ page }: { page: string }): readonly PageDefect[] {
  const over = textBlocks({ html: unfolded({ html: page }) })
    .map((block) => ({ sentences: sentenceCount({ text: block.text }), text: block.text }))
    .filter((block) => block.sentences > BLOCK_MAX_SENTENCES)
    .toSorted((left, right) => right.sentences - left.sentences);
  const worst = over[0];
  if (worst === undefined) {
    return [];
  }
  return [
    {
      budget: "run-on-paragraph",
      reason:
        `${String(over.length)} paragraph(s) above the fold run past ${String(BLOCK_MAX_SENTENCES)} sentences. ` +
        `The worst carries ${String(worst.sentences)}: "${excerpt({ text: worst.text })}". ` +
        "Break each one into its own paragraph, or fold it.",
    },
  ];
}

/** At most one defect, naming how many paragraphs pack a numbered list and quoting the worst of them. */
function enumerationDefects({ page }: { page: string }): readonly PageDefect[] {
  const over = textBlocks({ html: page })
    .map((block) => ({ marks: [...block.text.matchAll(INLINE_ENUMERATOR)].length, text: block.text }))
    .filter((block) => block.marks > BLOCK_MAX_ENUMERATORS)
    .toSorted((left, right) => right.marks - left.marks);
  const worst = over[0];
  if (worst === undefined) {
    return [];
  }
  return [
    {
      budget: "packed-enumeration",
      reason:
        `${String(over.length)} paragraph(s) pack a numbered list into running prose. ` +
        `The worst carries ${String(worst.marks)} numbers: "${excerpt({ text: worst.text })}". ` +
        "A numbered set of items is a real list, one item per line, never numbers inside a paragraph.",
    },
  ];
}

/**
 * At most one defect, naming how many runs above the fold end in an ellipsis and quoting the worst of them.
 *
 * Applies wherever the run sits, folded or not — the same reach {@link enumerationDefects} already has and
 * for the same reason: being folded recovers the whole cell when a reader opens it, but a run cut with an
 * ellipsis has nothing left to recover. A headline cut mid-sentence leaves the rest nowhere on the page: a
 * rendered page never truncates.
 */
function ellipsisDefects({ page }: { page: string }): readonly PageDefect[] {
  const over = textBlocks({ html: page }).filter((block) => endsInEllipsis({ text: block.text }));
  const worst = over[0];
  if (worst === undefined) {
    return [];
  }
  return [
    {
      budget: "truncated-ellipsis",
      reason:
        `${String(over.length)} run(s) end in an ellipsis with nothing after it. The worst: "${excerpt({ text: worst.text })}". ` +
        "A cut that drops the rest leaves it nowhere on the page to read — write the whole thing, and fold it " +
        "behind a `details` summary if it runs long.",
    },
  ];
}

/** The opening of one block, short enough to identify it without restating it. */
function excerpt({ text }: { text: string }): string {
  return text.length > 70 ? `${text.slice(0, 67)}...` : text;
}

/** One defect per budget broken, each naming the count and the cap in plain words. */
function pageDefects({
  unfoldedBlocks,
  aboveFoldWords,
  reactNowCards,
  regions,
}: {
  unfoldedBlocks: number;
  aboveFoldWords: number;
  reactNowCards: number;
  /** Where the above-fold words sit, named in the refusal so the reader sees what was counted. */
  regions: readonly AboveFoldRegion[];
}): readonly PageDefect[] {
  const defects: PageDefect[] = [];
  if (reactNowCards > REACT_NOW_MAX_CARDS) {
    defects.push({
      budget: "react-now-cards",
      reason:
        `react now carries ${String(reactNowCards)} cards, over the cap of ${String(REACT_NOW_MAX_CARDS)}. ` +
        "A block that long has stopped being a list of things to react to — land some of it, or fold it away.",
    });
  }
  if (unfoldedBlocks > PAGE_UNFOLDED_BLOCKS_MAX) {
    defects.push({
      budget: "unfolded-blocks",
      reason:
        `${String(unfoldedBlocks)} blocks outside the react-now section sit outside a details fold, over the ` +
        `cap of ${String(PAGE_UNFOLDED_BLOCKS_MAX)}. Keep the newest few open and put the older ones inside a ` +
        "collapsed details, or drop them.",
    });
  }
  if (aboveFoldWords > PAGE_ABOVE_FOLD_MAX_WORDS) {
    defects.push({
      budget: "above-fold-words",
      reason:
        `the page puts ${String(aboveFoldWords)} words above the fold outside the react-now cards, over the ` +
        `cap of ${String(PAGE_ABOVE_FOLD_MAX_WORDS)} (${regions.map((one) => `${one.region} ${String(one.words)}`).join(", ")}). ` +
        "A page this long is one the owner scrolls past, so the parts " +
        "they do read are the parts you folded away.",
    });
  }
  return defects;
}

const DATA_SCHEME = "data:";
const BASE64_MARKER = ";base64,";

/**
 * The page's weight in bytes with every `data:` URI removed — what a reader of the file actually pays for
 * the supervisor's own words and markup. Images are bounded by their own cap.
 *
 * A `data:` URI is a `data:<type>/<subtype>;base64,` header — `<type>` a run of `[a-z]`, `<subtype>` a run of
 * `[a-z0-9.+-]` — and the non-empty run of base64 characters after it. No part of it is a quantified regular
 * expression, the header included: each run is walked with `characterRunEnd`, because a regex quantified over
 * a run of millions of characters throws `RangeError: Maximum call stack size exceeded` in a long-lived
 * process (`#lib/base64Run.js` carries the mechanism and its repro). Neither header run can be backtracked
 * into, since the character that ends each (`/`, `;`) is outside its class, so the walk cuts exactly what
 * `/data:[a-z]+\/[a-z0-9.+-]+;base64,[A-Za-z0-9+/=]+/g` would.
 *
 * @internal
 *
 * @param html the rendered page
 * @returns the UTF-8 byte count with every `data:` URI replaced by nothing
 */
export function pageTextBytes({ html }: { html: string }): number {
  // Joined before counting rather than counted per slice: a cut URI between the two halves of a surrogate
  // pair rejoins them into one four-byte character, where two lone halves would count three bytes each.
  const keptSlices: string[] = [];
  let kept = 0;
  let at = html.indexOf(DATA_SCHEME);
  while (at !== -1) {
    const runStart = dataUriHeaderEnd({ at, html });
    if (runStart === undefined) {
      at = html.indexOf(DATA_SCHEME, at + 1);
      continue;
    }
    const runEnd = base64RunEnd({ from: runStart, text: html });
    if (runEnd > runStart) {
      keptSlices.push(html.slice(kept, at));
      kept = runEnd;
    }
    at = html.indexOf(DATA_SCHEME, runEnd);
  }
  keptSlices.push(html.slice(kept));
  return Buffer.byteLength(keptSlices.join(""), "utf8");
}

/**
 * Where a `data:<type>/<subtype>;base64,` header starting at `at` ends, each run walked rather than matched.
 *
 * @returns the index just past `;base64,`, or `undefined` when no such header starts at `at`
 */
function dataUriHeaderEnd({ html, at }: { html: string; at: number }): number | undefined {
  const typeStart = at + DATA_SCHEME.length;
  const typeEnd = characterRunEnd({ from: typeStart, outside: /[^a-z]/, text: html });
  if (typeEnd === typeStart || html[typeEnd] !== "/") {
    return undefined;
  }
  const subtypeStart = typeEnd + 1;
  const subtypeEnd = characterRunEnd({ from: subtypeStart, outside: /[^a-z0-9.+-]/, text: html });
  if (subtypeEnd === subtypeStart || !html.startsWith(BASE64_MARKER, subtypeEnd)) {
    return undefined;
  }
  return subtypeEnd + BASE64_MARKER.length;
}
