/**
 * Where on a rendered briefing page a stretch of markup sits — the card, or the section heading and folds — so a
 * defect names the place a chair edits rather than a region the chair has to search.
 *
 * A bare-reference scan that says only `(page)` sends the chair guessing at board docs, run journals and
 * captures before it finds the reference in, say, the autonomy ledger's section. A page is split here at its own landmarks — every `<h2>`, `<h3>`, `<summary>` and fold boundary — and
 * never inside prose. Any element a caller excludes (an anchor, a code span, a comment) is stripped BEFORE a
 * piece is split at its landmarks: one that straddles a landmark would otherwise be cut in two and survive its
 * own strip. React-now cards are numbered before that strip, so they keep the card checks' numbers.
 */
import { reactNowCardSpans } from "./cardSpans.js";
import { cardQuestionLabel } from "./reactNowCard.js";
import { plainText } from "./text.js";

/** One stretch of a region's markup, and the place on the page it sits. */
export interface PagePlace {
  readonly html: string;
  /** The card, or the section heading and the folds around it, in the words the page shows the owner. */
  readonly where: string;
}

/**
 * A section heading, a fold's summary, or a fold opening or closing — each one a boundary between two places.
 * Only tags are matched, never the text between them, so no lazy scan across a page is involved.
 */
const LANDMARK = /<(h2|h3|summary|details)\b[^>]*>|<\/details\s*>/gi;

/** The longest heading or summary quoted in a place, so a long fold summary cannot become a wall of text. */
const LABEL_MAX = 60;

/** The headings and open folds above one point on the page. */
interface Landmarks {
  h2: string | undefined;
  h3: string | undefined;
  /** One entry per open fold, outermost first; empty until the fold's summary is read. */
  folds: string[];
}

/**
 * The words a heading or summary opened at `start` shows, capped.
 *
 * @param open the opening tag as matched, which fixes where the text starts
 * @returns the label, empty when the element never closes
 */
function landmarkText({ html, start, open, tag }: { html: string; start: number; open: string; tag: string }): string {
  const from = start + open.length;
  const close = new RegExp(`</${tag}\\s*>`, "gi");
  close.lastIndex = from;
  const end = close.exec(html);
  if (end === null) {
    return "";
  }
  const text = plainText({ html: html.slice(from, end.index) });
  return text.length > LABEL_MAX ? `${text.slice(0, LABEL_MAX - 3)}...` : text;
}

/** How the landmarks above a place read in a defect line. */
function placeLabel({ landmarks }: { landmarks: Landmarks }): string {
  const parts = [landmarks.h2 === undefined ? "the page header" : `section "${landmarks.h2}"`];
  if (landmarks.h3 !== undefined) {
    parts.push(`"${landmarks.h3}"`);
  }
  for (const fold of landmarks.folds) {
    if (fold !== "") {
      parts.push(`fold "${fold}"`);
    }
  }
  return parts.join(" › ");
}

/**
 * Split one region at its landmarks, naming each piece by the section heading and folds it sits under.
 *
 * @param html the region's markup
 * @param section the `<h2>` the region opens under, absent when it starts at the top of the page
 * @returns every non-empty piece, in page order
 */
export function placesOfRegion({ html, section }: { html: string; section: string | undefined }): readonly PagePlace[] {
  const landmarks: Landmarks = { folds: [], h2: section, h3: undefined };
  const places: PagePlace[] = [];
  let cursor = 0;
  for (const match of html.matchAll(LANDMARK)) {
    places.push({ html: html.slice(cursor, match.index), where: placeLabel({ landmarks }) });
    cursor = match.index;
    const tag = match[1]?.toLowerCase();
    if (tag === undefined) {
      landmarks.folds.pop();
    } else if (tag === "details") {
      landmarks.folds.push("");
    } else {
      const text = landmarkText({ html, open: match[0], start: match.index, tag });
      if (tag === "h2") {
        landmarks.h2 = text;
        landmarks.h3 = undefined;
      } else if (tag === "h3") {
        landmarks.h3 = text;
      } else if (landmarks.folds.length === 0) {
        landmarks.folds.push(text);
      } else {
        landmarks.folds[landmarks.folds.length - 1] = text;
      }
    }
  }
  places.push({ html: html.slice(cursor), where: placeLabel({ landmarks }) });
  return places.filter((place) => place.html.length > 0);
}

/**
 * Split the react-now block into its cards, each named by number and question the way the card checks name
 * them, and whatever sits between them, named by the grouping heading above it.
 *
 * Cards are numbered over the RAW block, exactly as the card checks read it, and each is fenced with a numbered
 * mark before `strip` runs over the whole block at once. Stripped before numbering, an anchor wrapping a card
 * would take the card with it and every card after would be named one number early; stripped card by card, a
 * card inside a comment or an anchor would keep text no reader sees. A card whose marks the strip took is
 * scanned as nothing, and keeps its number.
 *
 * @param block the raw markup between `<h2>react now</h2>` and the next `<h2>`
 * @param strip removes whatever the caller excludes from the scan, anchors and code spans for instance
 * @returns every card, then every piece outside a card, each with its place
 */
export function placesOfReactNow({
  block,
  strip,
}: {
  block: string;
  strip: (html: string) => string;
}): readonly PagePlace[] {
  // A mark character the page itself carries is blanked first, one for one so every card offset still holds;
  // left in, a page's own text could fence a stretch of it as a card and name the wrong one.
  const unmarked = block.replace(ANY_MARK_CHARACTER, " ");
  const labels = new Map<string, string>();
  let marked = "";
  let cursor = 0;
  reactNowCardSpans({ block }).forEach(({ cardHtml, start }, index) => {
    // A card inside a card is read with its parent, and keeps its number so the one after it matches the card
    // checks' count; scanned again on its own, one reference would be reported twice.
    if (start < cursor) {
      return;
    }
    const card = String(index + 1);
    labels.set(card, `card ${card} ("${cardQuestionLabel({ cardHtml })}")`);
    const end = start + cardHtml.length;
    marked += `${unmarked.slice(cursor, start)}${OPEN_MARK}${card}${OPEN_MARK}${unmarked.slice(start, end)}${CLOSE_MARK}${card}${CLOSE_MARK}`;
    cursor = end;
  });
  marked += unmarked.slice(cursor);
  const cards: PagePlace[] = [];
  const rest = strip(marked).replace(MARKED_CARD, (_whole, card: string, html: string) => {
    cards.push({ html, where: labels.get(card)! });
    return " ";
  });
  return [...cards, ...placesOfRegion({ html: rest.replace(ANY_MARK, " "), section: "react now" })];
}

/**
 * The marks fencing a card while the block is stripped: private-use characters, blanked out of the page first
 * so only a fence carries one, and neither `<` nor `>`, so no tag pattern a strip runs can match across one.
 */
const OPEN_MARK = "";
const CLOSE_MARK = "";

/** A card whose opening and closing marks both survived the strip. */
const MARKED_CARD = /(\d+)([\s\S]*?)\1/g;

/** Either mark character, wherever the page carries one. */
const ANY_MARK_CHARACTER = /[]/g;

/** A mark whose partner the strip took, which fences nothing. */
const ANY_MARK = /[]\d+[]/g;
