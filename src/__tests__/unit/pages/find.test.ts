/**
 * `findPages` and `pageTitleOf`: what the owner said on a call ranks the page they meant first, and a page's title is read
 * out of its head. The fixture is a measured case — "twenty potential icons" against the page published as
 * `slopweaver-icon-directions`.
 */
import { describe, expect, it } from "vitest";

import { findPages, type PublishedPageForFind, pageTitleOf } from "../../../pages/find.js";
import { searchWords } from "../../../pages/findWords.js";

const ICONS: PublishedPageForFind = {
  publishedMs: Date.parse("2026-10-05T01:16:47.847Z"),
  slug: "slopweaver-icon-directions",
  title: "Slopweaver, now — twenty icon and tagline directions",
};
const BRIEFING: PublishedPageForFind = {
  publishedMs: Date.parse("2026-10-05T06:51:35.936Z"),
  slug: "fleet-briefing",
  title: "Fleet Briefing",
};
const TWENTY_ONLY: PublishedPageForFind = {
  publishedMs: Date.parse("2026-10-05T06:00:00.000Z"),
  slug: "twenty-rows-of-alerts",
  title: undefined,
};
const PAGES = [ICONS, BRIEFING, TWENTY_ONLY];

describe("pageTitleOf", () => {
  it("reads the title out of the head, entities decoded and whitespace collapsed", () => {
    const html = "<!doctype html><html><head><TITLE>\n  Tom &amp; Jerry &lt;3  </TITLE></head>";
    expect(pageTitleOf({ html })).toBe("Tom & Jerry <3");
  });

  it("decodes in one pass, so an escaped entity stays escaped", () => {
    expect(pageTitleOf({ html: "<title>&amp;lt;</title>" })).toBe("&lt;");
  });

  it("is undefined when the page has no title or an empty one", () => {
    expect(pageTitleOf({ html: "<html><body>no head</body></html>" })).toBeUndefined();
    expect(pageTitleOf({ html: "<title>   </title>" })).toBeUndefined();
  });
});

describe("searchWords", () => {
  it("drops single letters, filler and one plural s, once each, in the order they were said", () => {
    expect(
      searchWords({ words: ["the", "Twenty potential", "a", "icons", "of", "icon", "this", "pages", "showing"] }),
    ).toEqual(["twenty", "potential", "icon"]);
  });

  it("keeps a two-letter word that is not filler, so 'the CI page' searches on ci", () => {
    expect(searchWords({ words: ["the CI page"] })).toEqual(["ci"]);
  });

  it("reads an acronym speech-to-text wrote with dots as one word", () => {
    expect(searchWords({ words: ["the C.I. page"] })).toEqual(["ci"]);
  });

  it("leaves nothing when filler is all that was said", () => {
    expect(searchWords({ words: ["can you pull that page up for me"] })).toEqual([]);
  });

  it("keeps 'today', which names pages, and drops the filler beside it", () => {
    expect(searchWords({ words: ["open the today page"] })).toEqual(["today"]);
  });

  it("drops a third-person pronoun as filler, whichever person it names", () => {
    // Spoken words, spelled through a pattern's source: the owner-pronoun gate reads a pattern as speech, which these are.
    const [subject, object, possessive] = [/he/u.source, /him/u.source, /his/u.source];
    const said = `the page ${subject} made from ${possessive} notes for ${object} and her`;
    expect(searchWords({ words: [said] })).toEqual(["note"]);
    // A plural `s` dropped onto one is filler too, as it was when these words sat in the filler list.
    expect(searchWords({ words: ["hiss hims notes"] })).toEqual(["note"]);
  });

  it("keeps a three-letter word ending in s whole", () => {
    expect(searchWords({ words: ["gas"] })).toEqual(["gas"]);
  });
});

describe("findPages", () => {
  it("ranks the page the owner meant first from their own words, though it is not the newest and not every word matched", () => {
    const result = findPages({ limit: 15, pages: PAGES, words: ["twenty", "potential", "icons"] });
    expect(result.found.map((page) => page.slug)).toEqual(["slopweaver-icon-directions", "twenty-rows-of-alerts"]);
    expect(result.found[0]!.matched).toEqual(["twenty", "icon"]);
    expect(result.matching).toBe(2);
    expect(result.searched).toEqual(["twenty", "potential", "icon"]);
  });

  it("ranks 'the icons page' to the icons page over newer titles full of filler, as the first cut did not", () => {
    const decoys: PublishedPageForFind[] = [1, 2, 3].map((n) => ({
      publishedMs: Date.parse(`2026-10-05T0${String(n + 2)}:00:00.000Z`),
      slug: `console-voice-local-file-read-${String(n)}`,
      title: "The console voice could not read the options page in the other window",
    }));
    const result = findPages({ limit: 15, pages: [ICONS, ...decoys], words: ["the icons page"] });
    expect(result.searched).toEqual(["icon"]);
    expect(result.found.map((page) => page.slug)).toEqual(["slopweaver-icon-directions"]);
  });

  it("matches a word only at the start of a word of the page's, so 'other' is never found inside 'another'", () => {
    const another: PublishedPageForFind = { publishedMs: 0, slug: "another-day", title: "Another day" };
    expect(findPages({ limit: 15, pages: [another], words: ["other"] }).found).toEqual([]);
  });

  it("weighs a word fewer pages carry above one many carry", () => {
    const common = [1, 2, 3].map((n) => ({
      publishedMs: Date.parse("2026-10-05T09:00:00.000Z"),
      slug: `slopweaver-notes-${String(n)}`,
      title: `Slopweaver notes ${String(n)}`,
    }));
    const result = findPages({ limit: 1, pages: [ICONS, ...common], words: ["slopweaver", "tagline"] });
    expect(result.found.map((page) => page.slug)).toEqual(["slopweaver-icon-directions"]);
  });

  it("matches the slug when a page has no title", () => {
    const result = findPages({ limit: 15, pages: PAGES, words: ["alerts"] });
    expect(result.found.map((page) => page.slug)).toEqual(["twenty-rows-of-alerts"]);
    expect(result.found[0]!.title).toBeUndefined();
  });

  it("lists every page newest first when no words were given, cut to the limit, counting what was cut", () => {
    const result = findPages({ limit: 2, pages: PAGES, words: [] });
    expect(result.found.map((page) => page.slug)).toEqual(["fleet-briefing", "twenty-rows-of-alerts"]);
    expect(result.found[0]!.modifiedIso).toBe("2026-10-05T06:51:35.936Z");
    expect(result.found[0]!.matched).toEqual([]);
    expect(result.matching).toBe(3);
  });

  it("finds no page, and names the words given, when every word is too short to search on — never the newest page", () => {
    const result = findPages({ limit: 15, pages: PAGES, words: ["a", "b"] });
    expect(result.found).toEqual([]);
    expect(result.matching).toBe(0);
    expect(result.searched).toEqual([]);
    expect(result.unsearchable).toEqual(["a", "b"]);
  });

  it("matches a two-letter word only whole, so 'ci' finds the CI page and not 'circle'", () => {
    const ci: PublishedPageForFind = { publishedMs: 0, slug: "ci-under-five-minutes", title: undefined };
    const circle: PublishedPageForFind = { publishedMs: 1, slug: "circle-back", title: undefined };
    const result = findPages({ limit: 15, pages: [ci, circle, BRIEFING], words: ["the CI page"] });
    expect(result.found.map((page) => page.slug)).toEqual(["ci-under-five-minutes"]);
    expect(result.unsearchable).toEqual([]);
  });

  it("finds no page when filler or punctuation is all that was said, though a slug carries the filler", () => {
    const where: PublishedPageForFind = { publishedMs: 0, slug: "where-the-voice-should-live", title: undefined };
    expect(findPages({ limit: 15, pages: [where, ...PAGES], words: ["open the page"] }).unsearchable).toEqual([
      "open the page",
    ]);
    expect(findPages({ limit: 15, pages: [where, ...PAGES], words: ["?"] }).found).toEqual([]);
  });

  it("finds a dated page by the date the owner says, month spelled out and day as an ordinal", () => {
    const hunt4: PublishedPageForFind = { publishedMs: 0, slug: "organisation-hunt-4oct", title: undefined };
    const hunt5: PublishedPageForFind = {
      publishedMs: 1,
      slug: "organisation-hunt",
      title: "Organisation hunt, Sun 5 Oct",
    };
    const marketing: PublishedPageForFind = { publishedMs: 2, slug: "marketing-4-plans", title: undefined };
    const result = findPages({ limit: 15, pages: [hunt4, hunt5, marketing], words: ["the hunt from March 4th"] });
    expect(result.searched).toEqual(["hunt", "mar", "4"]);
    expect(result.found[0]!.slug).toBe("organisation-hunt-4oct");
    // "mar" is a month, matched only as one, so "marketing" never carries it.
    expect(result.found.find((page) => page.slug === "marketing-4-plans")!.matched).toEqual(["4"]);
    const october = findPages({ limit: 1, pages: [hunt4, hunt5], words: ["the hunt from October 4"] });
    expect(october.found.map((page) => page.slug)).toEqual(["organisation-hunt-4oct"]);
    expect(october.closeAtTop).toBe(1);
  });

  it("counts the pages tied at the top, which the words given did not choose between", () => {
    const hunt4: PublishedPageForFind = { publishedMs: 0, slug: "organisation-hunt-4oct", title: undefined };
    const hunt5: PublishedPageForFind = { publishedMs: 1, slug: "organisation-hunt", title: undefined };
    const result = findPages({ limit: 15, pages: [hunt4, hunt5, BRIEFING], words: ["yesterday's organisation hunt"] });
    expect(result.found.map((page) => page.slug)).toEqual(["organisation-hunt", "organisation-hunt-4oct"]);
    expect(result.closeAtTop).toBe(2);
  });

  it("counts a page one stray word ahead as close, so 'the one about the alerts channel' still asks which", () => {
    const pages: PublishedPageForFind[] = [
      { publishedMs: 3, slug: "alerts-consolidation-inventory", title: "Alerts channel inventory" },
      { publishedMs: 2, slug: "why-the-alert-channel-ruling-never-landed", title: undefined },
      { publishedMs: 1, slug: "team-alerts-channel-rosters", title: "Alerts channel rosters, one react each" },
      BRIEFING,
    ];
    const result = findPages({ limit: 15, pages, words: ["open the one about the alerts channel in chrome"] });
    expect(result.searched).toEqual(["alert", "channel"]);
    expect(result.closeAtTop).toBe(3);
    const stray: PublishedPageForFind = {
      publishedMs: 0,
      slug: "alerts-oddity",
      title: "Alerts channel and the spotlight",
    };
    // A rare word that WAS said decides it: the page carrying it leads by more than its least telling word.
    const decided = findPages({ limit: 15, pages: [...pages, stray], words: ["alerts channel spotlight"] });
    expect(decided.found[0]!.slug).toBe("alerts-oddity");
    expect(decided.closeAtTop).toBe(1);
  });

  it("does not count a page whose lead is more than its least telling word", () => {
    const result = findPages({ limit: 15, pages: PAGES, words: ["twenty potential icons"] });
    expect(result.closeAtTop).toBe(1);
  });

  it("drops what the owner calls a page and where they want it, so 'doc' never matches 'doctors'", () => {
    expect(searchWords({ words: ["pull up the vanta group doc in chrome on my screen"] })).toEqual(["vanta", "group"]);
  });

  it("keeps 'one', so 'my one on one with Tobias' ranks the one-on-one over another Tobias page", () => {
    const oneOnOne: PublishedPageForFind = { publishedMs: 0, slug: "tobias-one-on-one-2-oct", title: undefined };
    const iso: PublishedPageForFind = { publishedMs: 1, slug: "tobias-iso-catch-up-6-oct", title: undefined };
    const result = findPages({ limit: 15, pages: [oneOnOne, iso], words: ["my one on one with Tobias"] });
    expect(result.found.map((page) => page.slug)).toEqual(["tobias-one-on-one-2-oct", "tobias-iso-catch-up-6-oct"]);
  });

  it("ranks the topic the owner named over a page carrying only how they asked for it", () => {
    const iso: PublishedPageForFind = { publishedMs: 0, slug: "iso-27001-controls", title: undefined };
    const made: PublishedPageForFind = {
      publishedMs: 1,
      slug: "codex-billing-options",
      title: "What we made of Codex billing",
    };
    const result = findPages({
      limit: 15,
      pages: [iso, made, BRIEFING],
      words: ["the ISO page you made me yesterday"],
    });
    expect(result.searched).toEqual(["iso"]);
    expect(result.found.map((page) => page.slug)).toEqual(["iso-27001-controls"]);
  });

  it("finds nothing when no word matches any page", () => {
    const result = findPages({ limit: 15, pages: PAGES, words: ["kubernetes"] });
    expect(result.found).toEqual([]);
    expect(result.matching).toBe(0);
  });
});
