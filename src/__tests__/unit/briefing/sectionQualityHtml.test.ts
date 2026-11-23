/**
 * The READER's projection: which regions of a rendered page become sections, what each one's own level
 * holds, and what it refuses to read rather than passing silently.
 *
 * The fixtures here are hand-written HTML rather than rendered forms on purpose — this is the half that has
 * to judge a page a session wrote by hand and an archive rendered before the markers existed. The RENDERED
 * page is covered by `./sectionQualityParity.test.ts`, which asserts both projections agree.
 */
import { describe, expect, it } from "vitest";

import { checkBriefingSections, sectionQualityOfHtml } from "../../../briefing/sectionQualityHtml.js";

/** A whole page, with the sections one test cares about and nothing else. */
function page({ body }: { body: string }): string {
  return ["<main>", '  <div class="eyebrow">supervisor ws:1</div>', "  <h1>Fleet Briefing</h1>", body, "</main>"].join(
    "\n",
  );
}

/** Every section the projection found, as `name :: text`, in page order. */
function sections({ html }: { html: string }): readonly string[] {
  return sectionQualityOfHtml({ html }).scopes.map((scope) => `${scope.section} :: ${scope.text}`);
}

/** Every defect the reader reported, as `rule: reason`, in order. */
function defects({ html, framing = true }: { html: string; framing?: boolean }): readonly string[] {
  return checkBriefingSections({ applyFraming: framing, html }).defects.map(
    (defect) => `${defect.rule}: ${defect.reason}`,
  );
}

describe("the lede is the marked paragraph, never any other contract line", () => {
  it("reads the lede off its own class", () => {
    const html = page({ body: '  <p class="sub lede">One thing needs your word.</p>' });

    expect(sections({ html })).toEqual(["the lede :: One thing needs your word."]);
  });

  it("reads no lede off an unmarked `p.sub`, which is a grouping's contract line", () => {
    const html = page({ body: '  <p class="sub">The next step here is seen by someone other than you.</p>' });

    expect(sections({ html })).toEqual([]);
  });
});

describe("a section's cells are read separately, so two of them cannot manufacture a phrase", () => {
  it("keeps two paragraphs apart rather than running them into one collocation", () => {
    const html = page({
      body: [
        "  <h2>done since you last looked</h2>",
        '  <details data-section="recent"><summary>2 landing(s) since you last looked</summary><div>',
        '  <div class="need"><div class="q">Nothing came off the board</div></div>',
        '  <div class="need"><div class="q">Rows of the table were re-sorted.</div></div>',
        "  </div></details>",
      ].join("\n"),
    });

    expect(sections({ html })).toEqual([
      '"done since you last looked" :: Nothing came off the board · Rows of the table were re-sorted.',
    ]);
    expect(defects({ html })).toEqual([]);
  });

  it("names a collapsed section by the summary its composer wrote, and counts that summary as a cell", () => {
    const html = page({
      body: [
        "  <h2>done since you last looked</h2>",
        "  <details><summary>earlier today, in order</summary><div>",
        '  <div class="need"><div class="q">A quiet hour.</div></div>',
        "  </div></details>",
      ].join("\n"),
    });

    expect(sections({ html })).toEqual(['"earlier today, in order" :: earlier today, in order · A quiet hour.']);
  });

  it("skips the owner's own list entirely, because nobody here composed a word of it", () => {
    const html = page({
      body: [
        "  <h2>done since you last looked</h2>",
        '  <details data-section="your-list"><summary>10 ranked rows</summary><div>',
        '  <div class="mine"><div class="q">1. The fill spawned it.</div></div>',
        "  </div></details>",
      ].join("\n"),
    });

    expect(sections({ html })).toEqual([]);
    expect(defects({ html })).toEqual([]);
  });
});

describe("a fold is its own level, and a gloss travels down into it and never up out of it", () => {
  const nested = ({ outer, inner }: { outer: string; inner: string }): string =>
    page({
      body: [
        "  <h2>done since you last looked</h2>",
        "  <details><summary>earlier today, in order</summary><div>",
        `  <div class="need"><div class="q">${outer}<details><summary>the detail</summary><div><p>${inner}</p></div></details></div></div>`,
        "  </div></details>",
      ].join("\n"),
    });

  it("reads the fold's body as a level under the section's own", () => {
    const html = nested({ inner: "It ran at 21:10.", outer: "A quiet hour." });

    expect(sections({ html })).toEqual([
      '"earlier today, in order" :: earlier today, in order · A quiet hour. · the detail',
      '"earlier today, in order" :: It ran at 21:10.',
    ]);
  });

  it("passes a fleet word inside the fold that the section above it explained", () => {
    const html = nested({ inner: "This tick closed the chair.", outer: "Every tick is one pass of the loop." });

    expect(defects({ html })).toEqual([]);
  });

  it("refuses a fleet word above a fold that only the fold explains", () => {
    const html = nested({ inner: "Every tick is one pass of the loop.", outer: "This tick closed the chair." });

    expect(defects({ html })[0]).toContain('uses the fleet word "This tick" and never says what it means');
  });
});

describe("the ranked index: its ask, its age, and what it refuses to read", () => {
  const line = ({ body }: { body: string }): string =>
    page({ body: ["  <h2>react now</h2>", `  <p class="ranked">${body}</p>`].join("\n") });

  it("reads the marked ask and the age beside it", () => {
    const html = line({
      body:
        '1. <a href="https://example.invalid/p">Scope split</a> — <span class="ask">Your read of the ' +
        'routing.</span> <span class="age" data-landed-iso="2026-09-12T04:00:00Z">landed 6 hours ago</span>',
    });

    expect(sections({ html })).toEqual(["the ranked open-pages index :: Your read of the routing."]);
    expect(defects({ html })).toEqual([]);
  });

  it("never reads the page's own title as prose the fleet composed", () => {
    const html = line({
      body:
        '1. <a href="https://example.invalid/p">The fill spawned it</a> — <span class="ask">Your read.</span> ' +
        '<span class="age" data-landed-iso="2026-09-12T04:00:00Z">landed 6 hours ago</span>',
    });

    expect(defects({ html })).toEqual([]);
  });

  it("reports a line it cannot read rather than judging half of it", () => {
    const html = line({ body: '1. <a href="https://example.invalid/p">Scope split</a> — Your read.' });

    expect(defects({ html })).toEqual([
      "section-parse: line 1 of the ranked open-pages index carries no marked ask or no landing instant, so " +
        "its wording and its age cannot be judged. Re-render the page with `slopweaver briefing render`.",
    ]);
  });

  it("reads an ARCHIVE with the break-glass, which is the page that can carry an unmarked line at all", () => {
    const html = line({ body: '1. <a href="https://example.invalid/p">Scope split</a> — Your read.' });

    expect(defects({ framing: false, html })).toEqual([]);
  });
});

describe("the alignment line and its two folds", () => {
  it("reads the generated headline at the top level and the intake fold beneath it", () => {
    const html = page({
      body: [
        "  <h2>what the fleet is working on</h2>",
        '  <p class="align">2 of 3 live sessions are on the board\'s top 5. ' +
          "<details><summary>owner intake — every turn the owner typed, and whether a row holds it</summary>" +
          "<div><p>Owner turns: 4 read, all witnessed.</p></div></details></p>",
      ].join("\n"),
    });

    expect(sections({ html })).toEqual([
      "the alignment line :: 2 of 3 live sessions are on the board's top 5. · owner intake — every turn the owner " +
        "typed, and whether a row holds it",
      "the alignment line :: Owner turns: 4 read, all witnessed.",
    ]);
  });
});
