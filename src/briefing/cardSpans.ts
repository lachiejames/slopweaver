/**
 * Where each `.need` card sits in the react-now block, and in what order the card checks number it.
 *
 * One cut, shared: the card checks in `./reactNowCard.ts` and the bare-reference scan in `./pagePlaces.ts` both
 * number cards through {@link reactNowCardSpans}, so "card 3" in one refusal line is card 3 in the other. Two
 * separate cuts of the block would disagree on the numbering.
 */
import { ME_FACING_ID } from "../outbound/briefing/types.js";

/**
 * The me-facing grouping's own heading, which is where the own-hand rule starts applying.
 *
 * Matched on the `id` the renderer emits rather than on the heading's words, because the words are prose the
 * renderer may reword and the id is what an anchor already binds to (`../outbound/briefing/types.ts`). A page
 * carrying no such heading has no me-facing grouping, so every card on it is read as team-facing and the rule
 * never fires — the honest reading, rather than a guess about an unlabelled block.
 */
const ME_FACING_HEADING = new RegExp(`<h3[^>]*\\bid="${ME_FACING_ID}"`, "i");
/** A card's opening tag; `./reactNowCard.ts`'s waiting mark is an attribute on it, so this matches that card too. */
const NEED_DIV_OPEN = /<div class="need"[^>]*>/g;
const DIV_TAG = /<div\b[^>]*>|<\/div>/g;

/**
 * Every card of the react-now block in the order the card checks number them: the team-facing grouping, then
 * the me-facing one, each extracted on its own so a card left open before the split is no card at all. Any
 * other reader that names a card by number goes through this, or its numbers drift from the card checks'.
 *
 * @param block the markup between `<h2>react now</h2>` and the next `<h2>`, from `./reactNowCard.ts`'s
 *   `reactNowRegion`
 * @returns each card's markup, whether it sits in the me-facing grouping, and where in `block` it opens
 */
export function reactNowCardSpans({
  block,
}: {
  block: string;
}): readonly { cardHtml: string; ownHand: boolean; start: number }[] {
  const heading = ME_FACING_HEADING.exec(block);
  const split = heading === null ? block.length : heading.index;
  return [
    ...extractCardSpans({ block: block.slice(0, split) }).map((span) => ({ ...span, ownHand: false })),
    ...extractCardSpans({ block: block.slice(split) }).map((span) => ({
      ...span,
      ownHand: true,
      start: span.start + split,
    })),
  ];
}

/**
 * Every `.need` card's raw HTML within the react-now block, in document order.
 *
 * @param block the markup between `<h2>react now</h2>` and the next `<h2>`, from `./reactNowCard.ts`'s
 *   `reactNowRegion`
 * @returns each card's own markup, in document order
 */
export function extractCards({ block }: { block: string }): readonly string[] {
  return extractCardSpans({ block }).map((span) => span.cardHtml);
}

/**
 * Every `.need` card with the offset it starts at, in document order — for a reader that has to cut the cards
 * OUT of the block, which searching for a card's markup cannot do when two cards are written identically.
 */
function extractCardSpans({ block }: { block: string }): readonly { cardHtml: string; start: number }[] {
  const cards: { cardHtml: string; start: number }[] = [];
  for (const open of block.matchAll(NEED_DIV_OPEN)) {
    const start = open.index;
    const cardHtml = balancedDiv({ start, text: block });
    if (cardHtml !== undefined) {
      cards.push({ cardHtml, start });
    }
  }
  return cards;
}

/** The `<div ...>...</div>` starting at `start`, matched by counting nested `<div>`/`</div>` tags. */
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
