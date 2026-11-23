/*
 * THE LEVELLING FIT — the one piece of arithmetic the floating note's layout turns on, kept as the JS
 * SOURCE the panel program embeds rather than as a TypeScript function it could not call.
 *
 * `./panel.ts` emits a standalone JXA program that runs in its own process, so nothing in this repository
 * is in scope for it: an algorithm it needs has to arrive as text. Holding that text HERE rather than
 * inline in the program keeps one copy — `panel.test.ts` runs this exact string on exact numbers, so the
 * geometry assertions are on the shipped arithmetic instead of a restatement of it.
 *
 * ANY ROW CAN CARRY THE BUTTON BAND OFF THE DISPLAY, not just the literal, and the band riding the panel's
 * bottom is what turns that into "the buttons do nothing" a second time. `buildHandStep` caps LENGTH and
 * not LINES, so 120 characters of `what`, 200 of `unblocks` or a 2000-character literal are each enough on
 * their own: measured through the real row code, 2000 `x` characters draw 855pt, a thousand one-character
 * lines draw 10,210pt, and a hundred-line `unblocks` draws 1,585pt, against 982pt usable here. The first
 * spelling of this clamp shrank the literal ALONE and Codex's second pre-mortem measured it still
 * overflowing on a multiline `where` — which is why the search below is over every row.
 *
 * It LEVELS rather than taking the whole overflow from one row: each turn lowers the tallest rows — all of
 * them, when they tie — to a common ceiling, stopping at the next row down or at a floor. Taking it all
 * from the tallest instead left a 2000-character command at its 48pt floor while a long `where` kept
 * 813pt, which is the wrong half to keep. Nothing goes below its own floor, so a display too small for the
 * fixed furniture still overflows: it gives back the best it can rather than a negative height.
 */

/**
 * The emitted program's `fitRows`, as source: given one `{ height, gap, floor }` record per row, a fixed
 * furniture height and a budget, it answers the height each row is drawn at so their sum plus the fixed
 * part is at most the budget.
 */
export const FIT_ROWS_JS = `
function fitRows(list, fixed, budget) {
  var heights = [];
  var total = fixed;
  for (var i = 0; i < list.length; i += 1) {
    heights.push(list[i].height);
    total += list[i].height + list[i].gap;
  }
  for (var guard = 0; guard <= list.length * list.length + 2; guard += 1) {
    var over = total - budget;
    if (over <= 0) { return heights; }
    var top = -1;
    for (var j = 0; j < list.length; j += 1) {
      if (heights[j] > list[j].floor && heights[j] > top) { top = heights[j]; }
    }
    if (top < 0) { return heights; }
    // How many rows sit at that ceiling, and the level to stop at: the next row down, or the tallest floor
    // among the tied rows, whichever is higher — so the next turn levels a wider set.
    var tied = 0;
    var next = 0;
    for (var k = 0; k < list.length; k += 1) {
      var shrinkable = heights[k] > list[k].floor;
      if (shrinkable && heights[k] === top) {
        tied += 1;
        if (list[k].floor > next) { next = list[k].floor; }
      } else if (heights[k] < top && heights[k] > next) {
        next = heights[k];
      }
    }
    // Whole points, and the floor is what makes the bound exact rather than nearly exact: dividing the
    // overflow three ways left the fitted content 2.27e-13pt over its budget, which r3 recorded as a real
    // counterexample to "at most MAX_CONTENT_HEIGHT". AppKit also draws text on a fractional row blurrily.
    var target = top - over / tied;
    if (target < next) { target = next; }
    target = Math.floor(target);
    var taken = 0;
    for (var m = 0; m < list.length; m += 1) {
      if (heights[m] === top && heights[m] > list[m].floor) {
        var to = target;
        if (to < list[m].floor) { to = list[m].floor; }
        taken += heights[m] - to;
        heights[m] = to;
      }
    }
    if (taken <= 0) { return heights; }
    total -= taken;
  }
  return heights;
}
`;
