/**
 * Splitting a page at its own landmarks, and naming each piece the way a chair finds it on screen.
 */
import { describe, expect, it } from "vitest";

import { placesOfReactNow, placesOfRegion } from "../../../briefing/pagePlaces.js";

describe("placesOfRegion", () => {
  it("names text above every heading as the page header", () => {
    expect(placesOfRegion({ html: "<p>top</p>", section: undefined })).toEqual([
      { html: "<p>top</p>", where: "the page header" },
    ]);
  });

  it("names a piece by its section, grouping heading and open fold, outermost first", () => {
    const places = placesOfRegion({
      html: "<h2>done</h2><h3>merged</h3><details><summary>three</summary><p>x</p></details><p>y</p>",
      section: undefined,
    });

    expect(places.map((place) => place.where)).toEqual([
      'section "done"',
      'section "done" › "merged"',
      'section "done" › "merged"',
      'section "done" › "merged" › fold "three"',
      'section "done" › "merged"',
    ]);
  });

  it("caps a long summary at sixty characters", () => {
    const long = "a".repeat(80);
    const places = placesOfRegion({ html: `<details><summary>${long}</summary><p>x</p></details>`, section: "s" });

    expect(places.map((place) => place.where)).toEqual([
      'section "s"',
      `section "s" › fold "${"a".repeat(57)}..."`,
      'section "s"',
    ]);
  });

  it("finds nothing in an empty region", () => {
    expect(placesOfRegion({ html: "", section: undefined })).toEqual([]);
  });
});

describe("placesOfReactNow", () => {
  const card = '<div class="need"><div class="q">Send it?</div><p>body</p></div>';

  it("names each card by number and question, and the text between cards by the react-now section", () => {
    const places = placesOfReactNow({ block: `<p>lead</p>${card}`, strip: (html) => html });

    expect(places).toEqual([
      { html: card, where: 'card 1 ("Send it?")' },
      { html: "<p>lead</p> ", where: 'section "react now"' },
    ]);
  });

  it("gives a card the strip removed no place, while the card after it keeps its number", () => {
    const places = placesOfReactNow({
      block: `<!-- ${card} -->${card}`,
      // Cuts the block's one comment out by position — a fake strip, standing in for the caller's real one.
      strip: (html) => html.slice(0, html.indexOf("<!--")) + html.slice(html.indexOf("-->") + "-->".length),
    });

    expect(places).toEqual([
      { html: card, where: 'card 2 ("Send it?")' },
      { html: " ", where: 'section "react now"' },
    ]);
  });
});
