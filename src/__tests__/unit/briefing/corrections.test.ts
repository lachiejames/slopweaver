/**
 * The reader half: whether a stamped page's own claims add up, read off the file alone.
 *
 * The row's finding is the test to keep passing. An earlier version claimed three marked places and could have
 * carried four, and the only thing that would have caught it lived in the publishing seat rather than on the
 * page. So the assertions below are all about the page catching itself — including the one that proves the
 * count is not taken over the corrections stylesheet, which contains the literal `[data-corr="new"]` twice
 * and would otherwise make the reader measure itself.
 */
import { describe, expect, it } from "vitest";

import { checkCorrections } from "../../../briefing/corrections.js";
import { stampCorrections } from "../../../outbound/briefing/corrections.js";

/** One page, built the way the renderer builds one: an eyebrow, then blocks. */
function page({ body }: { body: string }): string {
  return `<main><div class="eyebrow">last refreshed X · ready for review Y</div>${body}</main>`;
}

/** A real stamped page: two blocks, one of them moved. */
function stamped(): string {
  return stampCorrections({
    next: page({ body: "<p>one</p><p>two changed</p>" }),
    previous: page({ body: "<p>one</p><p>two</p>" }),
  }).html;
}

describe("checkCorrections", () => {
  it("passes a page it stamped itself, and counts past the stylesheet's own selectors", () => {
    const result = checkCorrections({ html: stamped() });

    expect(result.stamped).toBe(true);
    expect(result.marks).toBe(1);
    expect(result.claimed).toBe(1);
    expect(result.defects).toEqual([]);
  });

  it("counts no mark a paragraph's PROSE spells, so the page that says the truth is not the one refused", () => {
    const prose = `<p>a spot that moved carries data-corr="changed" on its opening tag</p>`;
    const result = checkCorrections({
      html: stampCorrections({
        next: page({ body: `<p>one</p><p>two changed</p>${prose}` }),
        previous: page({ body: `<p>one</p><p>two</p>${prose}` }),
      }).html,
    });

    expect(result.marks).toBe(1);
    expect(result.claimed).toBe(1);
    expect(result.defects).toEqual([]);
  });

  it("refuses a hand-authored page whose mark and jump target are both written on END tags", () => {
    // HTML throws an end tag's attributes away, so neither of these exists as far as a reader is concerned.
    const html =
      `<div class="corr" data-corr-marked="1" ` +
      `data-corr-against="sha256:${"0".repeat(64)}"><a href="#ghost">jump</a></div>` +
      `<p>visible</p id="ghost" data-corr="changed">`;
    const result = checkCorrections({ html });

    expect(result.marks).toBe(0);
    expect(result.claimed).toBe(1);
    expect(result.defects.map((defect) => defect.rule)).toEqual(["jump-does-not-land", "count-mismatch"]);
  });

  it("counts no mark inside a raw-text element, whose body is one text node however it reads", () => {
    const names = ["textarea", "iframe", "noembed", "xmp"];
    const agreeing = names.filter((name) => {
      const typed = `<${name}><p id="ghost" data-corr="changed">example</p></${name}>`;
      const result = checkCorrections({ html: stamped().replace("<p>one</p>", typed) });
      return result.marks === 1 && result.claimed === 1 && result.defects.length === 0;
    });

    expect(agreeing).toEqual(names);
  });

  it("counts no id a COMMENT declares, because a jump cannot land inside one", () => {
    // The jump's only remaining target sits in a comment, which a browser never renders and never scrolls to.
    const hidden = stamped()
      .replace(' id="corr-1"', "")
      .replace("<main>", `<main><!-- an earlier draft had <p id="corr-1">here</p> -->`);
    const result = checkCorrections({ html: hidden });

    expect(result.marks).toBe(1);
    expect(result.defects.map((defect) => defect.rule)).toEqual(["jump-does-not-land"]);
  });

  it("passes an unstamped page, because a first publish has no earlier version to be wrong about", () => {
    const result = checkCorrections({ html: page({ body: "<p>one</p>" }) });

    expect(result.stamped).toBe(false);
    expect(result.marks).toBe(0);
    expect(result.claimed).toBeUndefined();
    expect(result.defects).toEqual([]);
  });

  it("refuses a page whose mark was deleted by hand after the stamp", () => {
    const result = checkCorrections({ html: stamped().replace(' data-corr="changed"', "") });

    expect(result.marks).toBe(0);
    expect(result.claimed).toBe(1);
    expect(result.defects.map((defect) => defect.rule)).toEqual(["count-mismatch"]);
  });

  it("refuses a page whose strip was hand-edited to claim more than it marked", () => {
    const result = checkCorrections({ html: stamped().replace('data-corr-marked="1"', 'data-corr-marked="4"') });

    expect(result.claimed).toBe(4);
    expect(result.marks).toBe(1);
    expect(result.defects.map((defect) => defect.rule)).toEqual(["count-mismatch"]);
  });

  it("refuses marks nobody can navigate to, because the strip is gone", () => {
    const html = stamped().replace(/<div class="corr"[\s\S]*?<\/div>/, "");
    const result = checkCorrections({ html });

    expect(result.stamped).toBe(false);
    expect(result.marks).toBe(1);
    expect(result.defects.map((defect) => defect.rule)).toEqual(["marks-without-strip"]);
  });

  it("refuses a jump that lands nowhere", () => {
    const result = checkCorrections({ html: stamped().replace('<p id="corr-1"', "<p") });

    expect(result.defects.map((defect) => defect.rule)).toEqual(["jump-does-not-land"]);
  });

  it("refuses a strip that will not say which version it compared against", () => {
    const result = checkCorrections({ html: stamped().replace(/ data-corr-against="[^"]*"/, "") });

    expect(result.defects.map((defect) => defect.rule)).toEqual(["strip-without-provenance"]);
  });
});
