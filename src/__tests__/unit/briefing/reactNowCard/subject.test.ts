/*
 * A card's subject, read off the rendered page: a link back to a briefing page's own react-now section, an empty
 * or page-relative link, a fragment delimiter spelled as a character reference, a bare title with no link, and a
 * markdown document are refused; a real page, a fragment this page carries no id for, and `no page` pass.
 */
import { describe, expect, it } from "vitest";

import { card, check } from "./harness.js";

describe("a card's subject, read off the rendered page", () => {
  /** The exact url on the first me-facing card of one chair's `form.pre-t<n>-3.json`. */
  const HIS_URL = "https://claude.ai/code/artifact/af415a0a-f9cd-43b1-aac2-187e71642592#react-now";

  /** One well-shaped card with a subject line under its question, as the renderer emits it. */
  function withSubject({ line }: { line: string }): string {
    return card().replace('</div><dl class="f">', `</div>${line}<dl class="f">`);
  }

  /** The page with real section ids on its headings, which is what the reader judges a fragment against. */
  function page({ cards }: { cards: readonly string[] }): string {
    return (
      '<h1>Fleet Briefing</h1><h2 id="react-now">react now</h2>' +
      `${cards.join("")}<h2 id="recent">done since you last looked</h2><div id="the-queue-saga">ignored</div>`
    );
  }

  it("refuses the very card that sent the owner back to the page they were reading", () => {
    const html = page({ cards: [withSubject({ line: `<div class="bg"><a href="${HIS_URL}">the top row</a></div>` })] });

    expect(check({ html }).defects).toEqual([
      {
        card: 1,
        field: "subject",
        question: "Ship the thing: are you happy with the draft?",
        reason:
          "points at a briefing page's own `#react-now` section, which is a block of cards rather than " +
          "anything a card is about — and when it is this page, it sends you back to what you are already " +
          "reading. Use an `anchor` run to move you within this page; otherwise drop the url, begin the " +
          "subject's text with `no page`, and put the deciding detail in `detail`.",
      },
    ]);
  });

  it("passes a fragment naming a composer's own collapsed section, which another page may also carry", () => {
    const url = "https://claude.ai/code/artifact/abc#the-queue-saga";
    const html = page({ cards: [withSubject({ line: `<div class="bg"><a href="${url}">the saga</a></div>` })] });

    expect(check({ html }).defects).toEqual([]);
  });

  it("refuses every spelling of a fragment delimiter written as a character reference", () => {
    const spellings = ["&#35;", "&#35", "&#x23;", "&num;"];
    const fields = spellings.map((run) => {
      const url = `https://example.invalid/current${run}react-now`;
      const html = page({ cards: [withSubject({ line: `<div class="bg"><a href="${url}">the row</a></div>` })] });
      return check({ html }).defects.map((defect) => defect.field);
    });

    expect(fields).toEqual(spellings.map(() => ["subject"]));
  });

  it("passes a subject pointing at a fragment this page carries no id for", () => {
    const url = "https://example.invalid/doc#installation";
    const html = page({ cards: [withSubject({ line: `<div class="bg"><a href="${url}">the doc</a></div>` })] });

    expect(check({ html }).defects).toEqual([]);
  });

  it("refuses an empty link, which a browser resolves to the page it is on", () => {
    const html = page({ cards: [withSubject({ line: '<div class="bg"><a href="">the rollout</a></div>' })] });

    expect(check({ html }).defects).toEqual([
      {
        card: 1,
        field: "subject",
        question: "Ship the thing: are you happy with the draft?",
        reason:
          "carries a link with no page of its own — a browser resolves it against the page it is already " +
          "on, which is the self-link with nothing on it to see. Drop the url, begin the subject's text " +
          "with `no page`, and put the deciding detail in `detail`.",
      },
    ]);
  });

  it("refuses every other link a browser resolves against this page, which the form refuses too", () => {
    const hrefs = ["#", "#react-now", "#anything", "/path/to/thing", "//example.invalid/doc"];
    const fields = hrefs.map((href) => {
      const html = page({ cards: [withSubject({ line: `<div class="bg"><a href="${href}">x</a></div>` })] });
      return check({ html }).defects.map((defect) => defect.field);
    });

    expect(fields).toEqual(hrefs.map(() => ["subject"]));
  });

  it("judges the subject of a card that carries no `dl.f` at all", () => {
    const bare =
      '<div class="need"><div class="q">1. Ship it?</div>' +
      '<div class="bg"><a href="https://claude.ai/code/artifact/b#react-now-artifacts">the index</a></div></div>';

    expect(check({ html: page({ cards: [bare] }) }).defects.map((defect) => defect.field)).toContain("subject");
  });

  it("passes a link-less subject that says it has no page", () => {
    const html = page({ cards: [withSubject({ line: '<div class="bg">no page — this row</div>' })] });

    expect(check({ html }).defects).toEqual([]);
  });

  it("refuses a link-less subject that reads as a link that failed to render", () => {
    const html = page({ cards: [withSubject({ line: '<div class="bg">the stale-ready fix</div>' })] });

    expect(check({ html }).defects).toEqual([
      {
        card: 1,
        field: "subject",
        question: "Ship the thing: are you happy with the draft?",
        reason:
          "carries no link, so it must begin with `no page` — a bare title with nothing to open reads as a " +
          "link that failed to render.",
      },
    ]);
  });

  it("says nothing about a card that renders no subject line at all", () => {
    expect(check({ html: page({ cards: [card()] }) }).defects).toEqual([]);
  });

  it("refuses the finding card whose page was its own handover doc", () => {
    const doc =
      "file:///Users/ada.owner/.slopweaver/handovers/slack-ingest-stalls-on-poll-known-threads-corpus-a-day-behind.md";
    const html = page({ cards: [withSubject({ line: `<div class="bg"><a href="${doc}">the finding</a></div>` })] });

    expect(check({ html }).defects).toEqual([
      {
        card: 1,
        field: "subject",
        question: "Ship the thing: are you happy with the draft?",
        reason:
          "links a markdown document, which opens as raw text you have to read top to bottom rather than a " +
          "page you can react to. Publish the finding as a page — `slopweaver page publish " +
          "<slug> --page <fragment>.html --review <id>` — carrying what was measured, why it matters, the candidate causes, " +
          "and the options with their cost, and link that page instead; or drop the card until the page exists.",
      },
    ]);
  });

  it("passes the published page a finding should link instead", () => {
    const url = "file:///Users/ada.owner/.slopweaver/pages/slack-ingest-stall/index.html";
    const html = page({ cards: [withSubject({ line: `<div class="bg"><a href="${url}">the finding</a></div>` })] });

    expect(check({ html }).defects).toEqual([]);
  });
});
