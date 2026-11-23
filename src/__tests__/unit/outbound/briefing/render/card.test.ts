/*
 * One react-now card: the exact skeleton the gate parses, its subject line with and without a page, the number
 * it takes from its position, and how every caller string and link run is escaped into it.
 */
import { describe, expect, it } from "vitest";

import { escapeText, renderCard } from "../../../../../outbound/briefing/render.js";
import type { BriefingContent } from "../../../../../outbound/briefing/types.js";
import { CARD, NOW_ISO } from "./harness.js";

describe("the briefing renderer", () => {
  it("renders a card into the exact skeleton the gate parses", () => {
    expect(renderCard({ card: CARD, nowIso: NOW_ISO, position: 1 })).toBe(
      '<div class="need"><div class="q">1. Are you happy with the draft?</div>' +
        '<div class="age" data-premise-kind="composed" data-premise-iso="2026-09-11T21:18:59Z">premise 2 hours old</div>' +
        '\n    <dl class="f">\n' +
        "      <dt>what</dt><dd>The draft adds a template and a doc. It also adds a check that only reports.</dd>\n" +
        "      <dt>why you</dt><dd>It is a post to the team under your name.</dd>\n" +
        '      <dt>options</dt><dd><ul class="opts">' +
        '<li><span class="ol">A:</span> Send it as written.</li>' +
        '<li><span class="ol">B:</span> Send it with edits.</li></ul></dd>\n' +
        "      <dt>lean</dt><dd>A.</dd>\n" +
        "      <dt>if silent</dt><dd>The draft stays unsent.</dd>\n" +
        "    </dl></div>",
    );
  });

  it("links a subject that has a page of its own", () => {
    const subject = { text: "acme-admin#16415 — the stacked conflicts", url: "https://github.com/e/a/pull/16415" };

    expect(renderCard({ card: { ...CARD, subject }, nowIso: NOW_ISO, position: 1 })).toContain(
      '<div class="bg"><a href="https://github.com/e/a/pull/16415">acme-admin#16415 — the stacked conflicts</a></div>',
    );
  });

  it("renders a `no page` subject as words with no anchor of any kind", () => {
    const subject = { text: "no page — this decision exists only here" };
    const html = renderCard({ card: { ...CARD, subject }, nowIso: NOW_ISO, position: 1 });

    expect(html).toContain('<div class="bg">no page — this decision exists only here</div>');
    expect(html).not.toContain("<a ");
  });

  it("escapes a `no page` subject's words, which are still a composer's prose", () => {
    const subject = { text: 'no page — the <b>"queue"</b> & its saga' };

    expect(renderCard({ card: { ...CARD, subject }, nowIso: NOW_ISO, position: 1 })).toContain(
      '<div class="bg">no page — the &lt;b&gt;"queue"&lt;/b&gt; &amp; its saga</div>',
    );
  });

  it("numbers a card from its position, so the composer never writes the sequence", () => {
    expect(renderCard({ card: CARD, nowIso: NOW_ISO, position: 3 })).toContain(
      '<div class="q">3. Are you happy with the draft?</div>',
    );
  });

  it("escapes every caller string, so a form can never emit markup of its own", () => {
    expect(escapeText({ text: "</details><b>&" })).toBe("&lt;/details&gt;&lt;b&gt;&amp;");
    expect(renderCard({ card: { ...CARD, question: "Is </details> safe?" }, nowIso: NOW_ISO, position: 1 })).toContain(
      "1. Is &lt;/details&gt; safe?",
    );
  });

  it("renders a link's label as text and its url as an attribute", () => {
    const what: BriefingContent = [
      { kind: "text", text: "The draft is here. " },
      { kind: "link", text: "#100", url: "https://example.com/pull/100" },
      { kind: "text", text: " and it is green." },
    ];

    expect(renderCard({ card: { ...CARD, what }, nowIso: NOW_ISO, position: 1 })).toContain(
      '<dd>The draft is here. <a href="https://example.com/pull/100">#100</a> and it is green.</dd>',
    );
  });
});
