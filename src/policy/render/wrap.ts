/**
 * Wrapping one run of text to a column — the line-breaking half of the layout, split from `layout.ts` so
 * the placement there and the breaking here can each be held in a reader's head.
 */
/**
 * How wide a string is at a size, in points, for the font the renderer uses.
 *
 * Injected rather than computed: the widths belong to the font `pdf-lib` embeds, and taking them from
 * anywhere else would wrap text to a width the PDF does not actually use. A test supplies a plain function
 * — a fixed width per character is enough to pin every wrapping decision — which is what keeps this module
 * free of the library.
 */
export type TextWidth = (input: { text: string; size: number; bold: boolean }) => number;

/**
 * Break one word that is wider than the whole column into pieces that fit.
 *
 * A policy's own URLs are what make this necessary: a link to a shared document easily runs wider than the
 * text column. Left whole, a word
 * like that is DRAWN anyway: `pdf-lib` does not clip, so it runs off the right edge of the page and is
 * silently unreadable in the PDF while looking perfectly present in the markdown.
 */
function breakLongWord({
  word,
  size,
  bold,
  width,
  measure,
}: {
  word: string;
  size: number;
  bold: boolean;
  width: number;
  measure: TextWidth;
}): readonly string[] {
  const pieces: string[] = [];
  let piece = "";
  for (const character of word) {
    const candidate = `${piece}${character}`;
    if (piece !== "" && measure({ bold, size, text: candidate }) > width) {
      pieces.push(piece);
      piece = character;
      continue;
    }
    piece = candidate;
  }
  if (piece !== "") {
    pieces.push(piece);
  }
  return pieces;
}

/**
 * Place one word against the line being built: which lines it completed, and what is now in hand.
 *
 * Split out of {@link wrap} because the three cases together scored over the cognitive-complexity ceiling,
 * and they are exactly the three a reader has to hold: the word fits, the word starts a new line, or the
 * word is wider than the whole column and has to be broken.
 */
function placeWord({
  word,
  current,
  size,
  bold,
  width,
  measure,
}: {
  word: string;
  current: string;
  size: number;
  bold: boolean;
  width: number;
  measure: TextWidth;
}): { completed: readonly string[]; current: string } {
  if (measure({ bold, size, text: word }) > width) {
    const pieces = breakLongWord({ bold, measure, size, width, word });
    const before = current === "" ? [] : [current];
    // A word wider than the column is non-empty, so breaking it yields at least one piece.
    return { completed: [...before, ...pieces.slice(0, -1)], current: pieces.at(-1)! };
  }
  const candidate = current === "" ? word : `${current} ${word}`;
  if (current !== "" && measure({ bold, size, text: candidate }) > width) {
    return { completed: [current], current: word };
  }
  return { completed: [], current: candidate };
}

/**
 * Wrap one run of text to a column, greedily, hard-breaking only a word too wide for a line of its own.
 *
 * @param width the column left after the line's indent, in points
 * @param measure how wide a string is in the face the line is set in
 * @returns the wrapped lines, or one empty line for empty text
 */
export function wrap({
  text,
  size,
  bold,
  width,
  measure,
}: {
  text: string;
  size: number;
  bold: boolean;
  width: number;
  measure: TextWidth;
}): readonly string[] {
  const words = text.split(" ").filter((word) => word.length > 0);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const placed = placeWord({ bold, current, measure, size, width, word });
    // A loop, not `push(...)`: one hard-broken word can complete more lines than a call takes arguments.
    for (const completed of placed.completed) {
      lines.push(completed);
    }
    current = placed.current;
  }
  if (current !== "") {
    lines.push(current);
  }
  return lines.length === 0 ? [""] : lines;
}
