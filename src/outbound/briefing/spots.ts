/**
 * A page cut into SPOTS — the blocks a reader's eye lands on, each with the offsets a stamp writes into.
 *
 * This is the half of the corrections mechanism that decides what "where" means. A reader who reacts to a
 * briefing and is then asked to react to the corrected one has to be able to tell where the corrections
 * are. Answering that needs a unit
 * smaller than the page and bigger than a word, and it has to be the same unit on both sides of the compare
 * or the diff is measuring its own segmentation rather than the page.
 *
 * ## Why offsets rather than a parsed tree
 *
 * Every other reader in `../../briefing/` works on the bytes (`../../briefing/text.ts`'s
 * {@link balancedElement} is the shared primitive), and the stamp has to write attributes back into the
 * exact opening tag it read. A tree would have to be re-serialised, which rewrites bytes nobody asked to
 * change and would make a second stamp of the same page a diff against itself. So a spot carries `start` and
 * `end` into the original string and the stamp is a splice.
 *
 * ## A fold is a spot AND a region, which is the whole reason this scan recurses
 *
 * MEASURED on the two consecutive fleet briefings: reading each outermost `<details>`
 * as one opaque block found **19** spots on a 190 KB page, one of which spanned 100 KB. "Something in this
 * 100 KB section moved" is not an answer to "where are the corrections". So a fold contributes a spot for
 * its own SUMMARY — the line the owner actually sees while it is collapsed — and the scan then descends into its
 * body for the blocks inside it. A `<div>` that is not a card or a row is a wrapper rather than a block, so
 * it is descended into rather than emitted.
 *
 * A CARD is the one thing that stays atomic, and deliberately: a card is the unit the owner reacts to, its fields
 * are already capped as one thing by `../../briefing/reactNowCard.ts`, and telling them which of its `<dd>`s
 * moved would be finer than the decision being asked for.
 *
 * ## What is deliberately NOT a spot
 *
 * `<style>` and `<script>` bodies are masked before the scan — the artifact runtime injects a preamble into
 * every published page, and a spot inside it would be a spot in the host rather than in what was written.
 * The eyebrow is skipped by name: its two instants move on every single republish
 * (`./stamp.ts`), so a page marked against it would report a correction every time and the marks would
 * become noise, which is the exact failure this mechanism exists to remove. The corrections strip and its
 * stylesheet are skipped for the same reason from the other direction — they are the mechanism's own output.
 *
 * Pure: bytes in, spots out. No I/O, no clock.
 */
import { balancedElement, plainText } from "../../briefing/text.js";
import { maskNonMarkup, tagAttributes, tagEnd } from "./htmlTokens.js";

/**
 * What kind of block a spot is, which is what its jump label is read out of.
 *
 * @internal — `./corrections.ts` is the only reader; nothing outside the pair names a kind.
 */
export type SpotKind = "heading" | "card" | "row" | "fold" | "block";

/** One block a reader's eye lands on, and where it sits in the bytes. */
export interface PageSpot {
  readonly kind: SpotKind;
  /** The element's own `id`, when it carries one — what makes a match survive a rewrite of its text. */
  readonly id: string | undefined;
  /**
   * The text this spot is COMPARED on. A card's is everything inside it, folds included, because the card
   * is atomic. A fold's is its summary alone — the blocks inside it are spots of their own, and a fold whose
   * summary held while its body moved is reported through {@link enclosingFolds} instead.
   */
  readonly text: string;
  /** A few words naming the spot, for the jump list. */
  readonly label: string;
  /** Index of the `<` opening the element. */
  readonly start: number;
  /** Index one past the element's closing `>`. */
  readonly end: number;
  /** Index one past the `>` that closes the OPENING tag — where the stamp writes its attributes. */
  readonly openEnd: number;
}

/** Every element this file treats as one block a reader meets. `div` is filtered by class below. */
const SPOT_OPEN = /<(h1|h2|h3|h4|p|ul|ol|table|blockquote|pre|details|div)\b([^>]*)>/gi;

/** The two `div` classes that are blocks in their own right — a react-now card and one of the owner's own rows. */
const SPOT_DIV_CLASS = /\bclass="(need|mine)\b/i;

/** The classes this file refuses to call a spot: the freshness eyebrow, and the mechanism's own strip. */
const SKIPPED_DIV_CLASS = /\bclass="(?:eyebrow|corr)\b/i;

/**
 * The FIRST `id` an opening tag declares, or undefined when it declares none.
 *
 * Read through `./htmlTokens.ts` rather than by pattern, because a mint that cannot SEE an id cannot avoid
 * colliding with it and an author writes all three of HTML's spellings. Measured by reviews `r3-inert`,
 * `r3-inert2` and `r3-inert3` on pages carrying `<h2 id='corr-1'>`, `<h2 id = 'corr-1'>` and
 * `<h2 id=corr-1>`: each read as a heading with no id at all, so `./corrections.ts` minted `corr-1` for the
 * paragraph that had moved and the jump landed on the heading instead.
 */
function firstElementId({ tag }: { tag: string }): string | undefined {
  const id = tagAttributes({ tag }).find((attribute) => attribute.name === "id");
  if (id === undefined) {
    return undefined;
  }
  return id.value;
}

/** A card's own headline block, which is what names the card in a jump list. */
const QUESTION_BLOCK = /<div class="q">([\s\S]*?)<\/div>/i;

/** A fold's own summary, which is what names it in a jump list. */
const SUMMARY_BLOCK = /<summary[^>]*>([\s\S]*?)<\/summary>/i;

/** How many words of a spot's own text stand in for a label when it carries no heading, question or summary. */
const LABEL_MAX_WORDS = 8;

/** The first `LABEL_MAX_WORDS` words of `text`, with an ellipsis when it was cut. */
function shorten({ text }: { text: string }): string {
  const words = text.split(/\s+/).filter((word) => word.length > 0);
  if (words.length <= LABEL_MAX_WORDS) {
    return words.join(" ");
  }
  return `${words.slice(0, LABEL_MAX_WORDS).join(" ")}…`;
}

/** The spot's own name: a card's question, a fold's summary, or the opening words of its text. */
function labelOf({ element, kind, text }: { element: string; kind: SpotKind; text: string }): string {
  if (kind === "card" || kind === "row") {
    const question = QUESTION_BLOCK.exec(element)?.[1];
    return shorten({ text: question === undefined ? text : plainText({ html: question }) });
  }
  if (kind === "fold") {
    const summary = SUMMARY_BLOCK.exec(element)?.[1];
    return shorten({ text: summary === undefined ? text : plainText({ html: summary }) });
  }
  return shorten({ text });
}

/** Which kind of spot an opening tag names, or undefined when this element is not a spot at all. */
function kindOf({ tag, attributes }: { tag: string; attributes: string }): SpotKind | undefined {
  const name = tag.toLowerCase();
  if (name === "details") {
    return "fold";
  }
  if (name === "h1" || name === "h2" || name === "h3" || name === "h4") {
    return "heading";
  }
  if (name !== "div") {
    return "block";
  }
  if (SKIPPED_DIV_CLASS.test(attributes)) {
    return undefined;
  }
  const divClass = SPOT_DIV_CLASS.exec(attributes)?.[1]?.toLowerCase();
  if (divClass === "need") {
    return "card";
  }
  if (divClass === "mine") {
    return "row";
  }
  return undefined;
}

/** Where a fold's own body starts: just past its `<summary>`, or just past its opening tag when it has none. */
function foldBodyStart({ element, start, openEnd }: { element: string; start: number; openEnd: number }): number {
  const summary = SUMMARY_BLOCK.exec(element);
  if (summary === null) {
    return openEnd;
  }
  return start + summary.index + summary[0].length;
}

/**
 * A fold's own `<summary>` markup, or the whole element when it has none.
 *
 * The fallback is honest rather than empty: a `<details>` with no summary renders its own default label and
 * a reader still sees SOMETHING move, so comparing the element beats comparing the empty string.
 */
function summaryOf({ element }: { element: string }): string {
  const summary = SUMMARY_BLOCK.exec(element);
  if (summary === null) {
    return element;
  }
  // SUMMARY_BLOCK's one group is not optional, so a match always carries it — `""` for an empty summary.
  return summary[1]!;
}

/** One element's opening tag length, from the match that found it. */
function emit({
  html,
  mask,
  kind,
  start,
  element,
  openLength,
  out,
}: {
  html: string;
  mask: string;
  kind: SpotKind;
  start: number;
  element: string;
  openLength: number;
  out: PageSpot[];
}): void {
  const original = html.slice(start, start + element.length);
  const openEnd = start + openLength;
  const compared = plainText({ html: kind === "fold" ? summaryOf({ element: original }) : original });
  out.push({
    end: start + element.length,
    id: firstElementId({ tag: html.slice(start, openEnd) }),
    kind,
    label: labelOf({ element: original, kind, text: compared }),
    openEnd,
    start,
    text: compared,
  });
  if (kind === "fold") {
    scanRegion({ from: foldBodyStart({ element, openEnd, start }), html, mask, out, to: start + element.length });
  }
}

/** Scan one half-open byte range for the spots it directly contains, descending through wrappers and folds. */
function scanRegion({
  html,
  mask,
  from,
  to,
  out,
}: {
  html: string;
  mask: string;
  from: number;
  to: number;
  out: PageSpot[];
}): void {
  const open = new RegExp(SPOT_OPEN.source, "gi");
  open.lastIndex = from;
  let match: RegExpExecArray | null;
  while ((match = open.exec(mask)) !== null) {
    const start = match.index;
    if (start >= to) {
      return;
    }
    const tag = match[1]!;
    // `SPOT_OPEN` stops at the first `>`, which is one byte early on `<p title="1 > 0">`. The scan knows
    // where the tag really closes, and that offset is where the stamp writes — so it is read from there.
    const openEnd = tagEnd({ from: start, html: mask });
    const attributes = mask.slice(start + 1 + tag.length, openEnd - 1);
    const element = balancedElement({ html: mask, start, tag });
    if (element === undefined || start + element.length > to) {
      continue;
    }
    const kind = kindOf({ attributes, tag });
    if (kind === undefined) {
      // A wrapper, the eyebrow or the mechanism's own strip: not a block a reader lands on, but the blocks
      // inside a wrapper are. Descending and then resuming past it is what keeps every spot disjoint.
      scanRegion({ from: openEnd, html, mask, out, to: start + element.length });
    } else {
      emit({ element, html, kind, mask, openLength: openEnd - start, out, start });
    }
    open.lastIndex = start + element.length;
  }
}

/**
 * Cut one page into the blocks a reader's eye lands on, in document order and never overlapping at the same
 * level.
 *
 * A card swallows everything inside it — its fields, its fold — because the card is the unit the owner reacts to. A
 * FOLD does not: it contributes its own summary and then the blocks inside it, so a correction three folds
 * deep still has a spot of its own to be marked at.
 *
 * An element that never closes is skipped rather than guessed at: a spot with no end has no text to compare
 * and no opening tag a stamp could safely write into.
 *
 * @param html the whole page
 * @returns every spot, ordered by the position it opens at
 */
export function pageSpots({ html }: { html: string }): readonly PageSpot[] {
  const mask = maskNonMarkup({ html });
  const out: PageSpot[] = [];
  scanRegion({ from: 0, html, mask, out, to: html.length });
  return out.toSorted((left, right) => left.start - right.start);
}

/**
 * Every fold that ENCLOSES the spot at `index` — the collapsed lines a reader would have to open to reach
 * it.
 *
 * This is what stops a fine-grained scan from hiding its own answer. A paragraph 100 KB inside a collapsed
 * section is marked precisely, and marked invisibly, unless the sections above it say something moved
 * underneath them.
 *
 * @param spots every spot on the page, as {@link pageSpots} returns them
 * @param index which spot to walk outwards from
 * @returns the indexes of the enclosing folds, outermost first
 */
export function enclosingFolds({ spots, index }: { spots: readonly PageSpot[]; index: number }): readonly number[] {
  const target = spots[index];
  if (target === undefined) {
    return [];
  }
  const out: number[] = [];
  spots.forEach((spot, at) => {
    if (spot.kind === "fold" && at !== index && spot.start <= target.start && spot.end >= target.end) {
      out.push(at);
    }
  });
  return out;
}
