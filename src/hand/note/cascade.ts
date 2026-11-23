/*
 * THE CASCADE — where each floating note sits when several are up at once, kept as the JS SOURCE the panel
 * program embeds, the same way `./fitRows.ts` holds the layout arithmetic.
 *
 * The owner can have multiple floating notes on screen at once, stacked on top of each other and draggable, and
 * they overlap slightly in the style of cascading windows. So every note is its own window, and the raiser
 * hands each one a SLOT (`./raise.ts`): slot 0 is the top-right corner every note used to share, and each slot
 * after it steps {@link CASCADE_DX} left and {@link CASCADE_DY} down, so a newer note covers the older one's
 * body and leaves its eyebrow and the first line of its sentence showing above it.
 *
 * A column holds as many slots as fit the visible frame with a {@link CASCADE_NOMINAL_HEIGHT} note on screen; the
 * next slot starts a new column one note-width further left, back at the top. Past the last column it wraps to
 * slot 0's place: a finite display cannot keep an unbounded number of titles visible, so a note past that count
 * shares an origin with an earlier one — drawn in front of it, and dragged off by hand. Nothing is ever dropped.
 *
 * ## The grid is the display's, never the note's
 *
 * Every note measures its own height, and the grid used to be counted from it, so two notes of different heights
 * read a different number of slots per column and could put two neighbouring slots at nearly one place, the newer
 * hiding the older's title on a screen holding four. So every note counts the same grid
 * off the frame and one nominal height, and two slots below the wrap are always a step or a column apart. A note
 * taller than the room below its place is lifted until its buttons are on screen, which can cover the title of
 * the note above it in that column: the residue, since a button off the bottom of the screen is the worse loss.
 *
 * ## The newest note always takes the slot past every live one
 *
 * A title shows only while the note one slot up is BEHIND the note below it, and the newest window is in front.
 * So a new note never fills a gap a closed note left under a live one: drawn in front of the note one slot down,
 * it would cover that note's title. It takes the slot past the highest live one, and the
 * stack returns to slot 0 once every note in it has closed. A replaced note keeps its place only while it is the
 * highest; under a live note it moves to the top of the stack too.
 *
 * ## Each window level is its own cascade, from its own corner
 *
 * A note on a higher window level stays in front of every later note on a lower one, so sharing one grid would put
 * it over the title of an ordinary note in the next slot. The meeting-prep note cascades from the top LEFT, down and
 * right, in its own slots; ordinary notes keep the top right. The two first columns meet only on a frame narrower
 * than both side by side.
 */

/** How far left each slot steps from the one before it, in points. */
export const CASCADE_DX = 24;

/**
 * How far down each slot steps from the one before it, in points.
 *
 * The note's eyebrow sits 20pt in, 13pt tall, then 8pt, then the 16pt sentence's first line at about 20pt: 61pt
 * from the top. 64 leaves that whole strip of every older note visible above the newer one in front of it.
 */
export const CASCADE_DY = 64;

/** The inset from the visible frame's top and right edges, matching where the single note always sat. */
export const CASCADE_MARGIN = 24;

/**
 * The note height every note counts the grid from, in points, whatever its own: tall enough that a folded note
 * at the last row of a column keeps its buttons on screen, short enough that a 944pt display still holds eight
 * notes to a column.
 */
export const CASCADE_NOMINAL_HEIGHT = 400;

/**
 * The emitted program's `cascadeOrigin`, as source: given a slot, the visible frame (`x`, `y`, `width`, `height`
 * in AppKit's bottom-left coordinates), this panel's size and whether its cascade runs from the left corner, it
 * answers the top-left point to pass to `setFrameTopLeftPoint`. The grid reads only the frame and the panel's
 * width, which every note shares; its own height decides only whether it is lifted to keep its bottom on screen.
 */
export const CASCADE_JS = `
function cascadeOrigin(slot, frame, panelWidth, panelHeight, fromLeft) {
  var DX = ${String(CASCADE_DX)};
  var DY = ${String(CASCADE_DY)};
  var MARGIN = ${String(CASCADE_MARGIN)};
  var NOMINAL = ${String(CASCADE_NOMINAL_HEIGHT)};
  var perColumn = Math.floor((frame.height - MARGIN * 2 - NOMINAL) / DY) + 1;
  if (perColumn < 1) { perColumn = 1; }
  var columnWidth = panelWidth + (perColumn - 1) * DX + MARGIN;
  var columns = Math.floor((frame.width - MARGIN) / columnWidth);
  if (columns < 1) { columns = 1; }
  var place = slot % (perColumn * columns);
  var column = Math.floor(place / perColumn);
  var row = place % perColumn;
  var top = frame.y + frame.height - MARGIN - row * DY;
  var lowestTop = frame.y + MARGIN + panelHeight;
  if (top < lowestTop) { top = Math.min(lowestTop, frame.y + frame.height - MARGIN); }
  var inset = MARGIN + row * DX + column * columnWidth;
  return {
    x: fromLeft ? frame.x + inset : frame.x + frame.width - inset - panelWidth,
    y: top,
  };
}
`;

/**
 * The slot a new note takes: its own live slot when it replaces its step's note in place and no live note sits
 * past it, else the slot past the highest one a live note holds — never a gap under a live note, whose title the
 * new note, drawn in front, would cover.
 *
 * @param occupied the slots every live note and reservation of its cascade holds, the replaced note's own included
 * @param preferred the slot of the note this raise replaces, when that note is still up
 * @returns the slot to reserve
 */
export function cascadeSlot({ occupied, preferred }: { occupied: readonly number[]; preferred?: number }): number {
  const highest = Math.max(-1, ...occupied);
  if (preferred !== undefined && Number.isInteger(preferred) && preferred >= highest) {
    return preferred;
  }
  return highest + 1;
}
