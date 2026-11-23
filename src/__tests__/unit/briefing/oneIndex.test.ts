/**
 * The reader half of the one-index budgets, over pages this gate did not render.
 *
 * Every fixture is a page fragment rather than a whole artifact, because each rule reads one shape: a
 * `div.mine` row, a `p.await` line, a `p.ranked` line, an `id` and an `href="#…"`. The two artifact bands
 * carry two classes and two counts on purpose — see the module header. The dead-anchor rule is the one only
 * this half can make — the form knows the sections it is about to render, a page has already rendered them.
 */
import { describe, expect, it } from "vitest";

import { AWAITING_MAX_ITEMS, OPEN_ARTIFACTS_MAX_ITEMS, YOUR_LIST_MAX_ROWS } from "../../../briefing/caps.js";
import { checkOneIndex } from "../../../briefing/oneIndex.js";

/** `count` rows of the owner's list, each carrying `words` words above the fold. */
function rows({ count, words = 3 }: { count: number; words?: number }): string {
  const body = Array.from({ length: words }, () => "alpha").join(" ");
  return Array.from({ length: count }, () => `<div class="mine"><div class="q">${body}</div></div>`).join("\n");
}

/** `count` artifact lines. */
function artifacts({ count }: { count: number }): string {
  return Array.from({ length: count }, () => '<p class="await">a link — a reason</p>').join("\n");
}

/** `count` lines of the ranked open-artifact index, as the renderer emits them. */
function ranked({ count }: { count: number }): string {
  return Array.from({ length: count }, () => '<p class="ranked">1. a page — an ask</p>').join("\n");
}

describe("the one-index budgets, read off a rendered page", () => {
  it("counts the owner's rows, their words above the fold, and the artifacts linked", () => {
    const result = checkOneIndex({ html: `<main>${rows({ count: 3, words: 4 })}${artifacts({ count: 2 })}</main>` });

    expect(result.yourListRows).toBe(3);
    expect(result.yourListWords).toBe(12);
    expect(result.awaitingItems).toBe(2);
    expect(result.defects).toEqual([]);
  });

  it("does not charge a row's folded detail against its words above the fold", () => {
    const folded =
      '<div class="mine"><div class="q">alpha</div><details><summary>s</summary><div><p>beta gamma delta</p></div></details></div>';

    expect(checkOneIndex({ html: folded }).yourListWords).toBe(1);
  });

  it("refuses more rows of the owner's list than the cap allows", () => {
    const result = checkOneIndex({ html: rows({ count: YOUR_LIST_MAX_ROWS + 1 }) });

    expect(result.defects).toEqual([
      {
        reason:
          `your list carries ${String(YOUR_LIST_MAX_ROWS + 1)} rows, over the cap of ${String(YOUR_LIST_MAX_ROWS)}. ` +
          "Show fewer, and state the count it is not showing rather than dropping them silently.",
        rule: "your-list-rows",
      },
    ]);
  });

  it("refuses a list inside the row cap that still puts too many words above the fold", () => {
    const result = checkOneIndex({ html: rows({ count: YOUR_LIST_MAX_ROWS, words: 40 }) });

    expect(result.yourListWords).toBe(400);
    expect(result.defects.map((defect) => defect.rule)).toEqual(["your-list-words"]);
  });

  it("refuses a page sending the owner to more artifacts than the cap allows", () => {
    const result = checkOneIndex({ html: artifacts({ count: AWAITING_MAX_ITEMS + 1 }) });

    expect(result.defects.map((defect) => defect.rule)).toEqual(["awaiting-items"]);
  });

  it("counts the ranked index separately from the standing band", () => {
    const result = checkOneIndex({ html: `<main>${artifacts({ count: 2 })}${ranked({ count: 9 })}</main>` });

    expect(result.awaitingItems).toBe(2);
    expect(result.rankedItems).toBe(9);
    expect(result.defects).toEqual([]);
  });

  it("does not charge the ranked index against the standing band's cap of three", () => {
    const result = checkOneIndex({ html: ranked({ count: AWAITING_MAX_ITEMS + 12 }) });

    expect(result.awaitingItems).toBe(0);
    expect(result.defects).toEqual([]);
  });

  it("refuses a ranked index over its own cap", () => {
    const result = checkOneIndex({ html: ranked({ count: OPEN_ARTIFACTS_MAX_ITEMS + 1 }) });

    expect(result.defects).toEqual([
      {
        reason:
          `the ranked open-artifact index carries ${String(OPEN_ARTIFACTS_MAX_ITEMS + 1)} pages, over the ` +
          `cap of ${String(OPEN_ARTIFACTS_MAX_ITEMS)}. An index longer than the card list it sits above has ` +
          "stopped being an index of what to react to next.",
        rule: "ranked-items",
      },
    ]);
  });

  it("refuses an in-page anchor naming an element the page does not carry, listing every dead target", () => {
    const html =
      '<h2 id="recent">r</h2><p><a href="#recent">here</a> <a href="#gone">there</a> <a href="#missing">and</a></p>';

    expect(checkOneIndex({ html }).defects).toEqual([
      {
        reason:
          "2 in-page anchor target(s) name no element on this page: #gone, #missing. A link that scrolls " +
          "nowhere reads as a page that ignored the click — give the section an `id`, or point the anchor at " +
          "one that exists.",
        rule: "dead-anchor",
      },
    ]);
  });

  it("accepts an anchor into a collapsed section that carries the id", () => {
    const html =
      '<p><a href="#todays-rulings">today</a></p><details id="todays-rulings"><summary>s</summary><div>x</div></details>';

    expect(checkOneIndex({ html }).defects).toEqual([]);
  });

  it("reads no rows, no artifacts and no anchors off a page carrying none", () => {
    const result = checkOneIndex({ html: "<main><h1>Fleet Briefing</h1></main>" });

    expect(result.yourListRows).toBe(0);
    expect(result.awaitingItems).toBe(0);
    expect(result.defects).toEqual([]);
  });
});
