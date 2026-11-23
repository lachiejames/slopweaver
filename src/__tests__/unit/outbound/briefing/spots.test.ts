/**
 * The segmentation the corrections mechanism rests on: what counts as a place a reader's eye lands.
 *
 * The load-bearing property is the recursion. Reading each outermost `<details>` as one opaque block found
 * 19 spots on the 190 KB briefing, one of them spanning 100 KB — an answer to "where are the
 * corrections" that is no answer. These tests pin the two halves of the fix apart: a fold contributes its
 * own summary AND descends, while a card stays atomic because it is the unit the owner reacts to.
 */
import { describe, expect, it } from "vitest";

import { enclosingFolds, pageSpots } from "../../../../outbound/briefing/spots.js";

describe("pageSpots", () => {
  it("descends into a fold and still emits the fold's own summary", () => {
    const spots = pageSpots({
      html: "<main><details><summary>history</summary><div><p>one</p><p>two</p></div></details></main>",
    });

    expect(spots.map((spot) => spot.kind)).toEqual(["fold", "block", "block"]);
    expect(spots[0]!.text).toBe("history");
    expect(spots[1]!.text).toBe("one");
    expect(spots[2]!.text).toBe("two");
  });

  it("keeps a card atomic, fold and all, because the card is the unit the owner reacts to", () => {
    const spots = pageSpots({
      html: '<main><div class="need"><div class="q">1. ship it?</div><details><summary>why</summary><p>because</p></details></div></main>',
    });

    expect(spots).toHaveLength(1);
    expect(spots[0]!.kind).toBe("card");
    expect(spots[0]!.label).toBe("1. ship it?");
    expect(spots[0]!.text).toBe("1. ship it? why because");
  });

  it("descends through a wrapper div, which is not a block a reader lands on", () => {
    const spots = pageSpots({ html: "<main><div><div><p>buried</p></div></div></main>" });

    expect(spots).toHaveLength(1);
    expect(spots[0]!.text).toBe("buried");
  });

  it("skips the eyebrow, whose two instants move on every single republish", () => {
    const spots = pageSpots({ html: '<main><div class="eyebrow">last refreshed X</div><p>real</p></main>' });

    expect(spots.map((spot) => spot.text)).toEqual(["real"]);
  });

  it("skips the mechanism's own strip and stylesheet", () => {
    const spots = pageSpots({
      html: '<style data-corr-style="1">p { color: red; }</style><main><div class="corr"><span>2 changed</span></div><p>real</p></main>',
    });

    expect(spots.map((spot) => spot.text)).toEqual(["real"]);
  });

  it("reads an element's own id, which is what survives a rewrite of the text under it", () => {
    const spots = pageSpots({ html: '<main><h2 id="react-now">react now</h2><p>free</p></main>' });

    expect(spots[0]!.id).toBe("react-now");
    expect(spots[1]!.id).toBeUndefined();
  });

  it("points openEnd at the byte after the opening tag, which is where a stamp writes", () => {
    const html = '<main><p class="sub">hi</p></main>';
    const spot = pageSpots({ html })[0]!;

    expect(html.slice(spot.start, spot.openEnd)).toBe('<p class="sub">');
    expect(html.slice(spot.start, spot.end)).toBe('<p class="sub">hi</p>');
  });

  it("skips an element that never closes rather than guessing where it ends", () => {
    const spots = pageSpots({ html: "<main><p>open forever<h2>after</h2></main>" });

    expect(spots.map((spot) => spot.kind)).toEqual(["heading"]);
  });
});

describe("enclosingFolds", () => {
  it("names every collapsed section a reader would have to open to reach the spot", () => {
    const spots = pageSpots({
      html: "<main><details><summary>outer</summary><div><details><summary>inner</summary><p>deep</p></details></div></details></main>",
    });
    const deep = spots.findIndex((spot) => spot.text === "deep");

    expect(spots.map((spot) => spot.text)).toEqual(["outer", "inner", "deep"]);
    expect(enclosingFolds({ index: deep, spots })).toEqual([0, 1]);
  });

  it("names none for a spot that sits above every fold", () => {
    const spots = pageSpots({
      html: "<main><p>visible</p><details><summary>s</summary><p>hidden</p></details></main>",
    });

    expect(enclosingFolds({ index: 0, spots })).toEqual([]);
  });
});
