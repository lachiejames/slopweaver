/**
 * The shared subject rules: what counts as a link back into this page, and what counts as `no page`.
 *
 * The self-link fixture is the owner's own measured url rather than an invented one, so a
 * test passing means the card the owner actually read would now be refused.
 */
import { describe, expect, it } from "vitest";

import {
  briefingTargetOfSubjectUrl,
  isAbsoluteSubjectUrl,
  isNoPageSubjectText,
  isPlainSubjectUrl,
  renderedCardSubject,
  subjectEncodedLinkRefusal,
  subjectRelativeLinkRefusal,
  subjectSelfLinkRefusal,
} from "../../../briefing/cardSubject.js";
import { escapeAttribute } from "../../../outbound/briefing/render.js";

// register-class: decision-ask-arrives-unanswerable (docs/recurring-failure-register/bindings.md)

/** The exact url on the first me-facing card of one chair's `form.pre-t<n>-3.json`. */
const HIS_URL = "https://claude.ai/code/artifact/af415a0a-f9cd-43b1-aac2-187e71642592#react-now";

describe("briefingTargetOfSubjectUrl", () => {
  it("names the section the url the owner clicked pointed at", () => {
    expect(briefingTargetOfSubjectUrl({ url: HIS_URL })).toBe("react-now");
  });

  it("sees through a percent-encoded fragment, which scrolls to the same heading", () => {
    const encoded = "https://claude.ai/code/artifact/af415a0a#react%2Dnow";

    expect(briefingTargetOfSubjectUrl({ url: encoded })).toBe("react-now");
  });

  it("leaves a url with no fragment alone", () => {
    expect(briefingTargetOfSubjectUrl({ url: "https://github.com/acme/acme-admin/pull/16415" })).toBe(undefined);
  });

  it("leaves a fragment this page does not render alone", () => {
    expect(briefingTargetOfSubjectUrl({ url: "https://example.invalid/doc#installation" })).toBe(undefined);
  });

  it("treats a malformed escape as plain bytes rather than throwing on a hand-written page", () => {
    expect(briefingTargetOfSubjectUrl({ url: "https://example.invalid/doc#%E0%A4%A" })).toBe(undefined);
  });

  it("leaves a composer's own section id alone, so a link to ANOTHER page's section survives", () => {
    expect(briefingTargetOfSubjectUrl({ url: "https://claude.ai/code/artifact/abc#the-queue-saga" })).toBe(undefined);
  });

  it("catches every fixed briefing section, not just the one the owner met", () => {
    const sections = [
      "alignment",
      "recent",
      "your-list",
      "react-now-team",
      "react-now-me",
      "react-now-waiting",
      "react-now-artifacts",
    ];

    expect(
      sections.map((id) => briefingTargetOfSubjectUrl({ url: `https://claude.ai/code/artifact/b#${id}` })),
    ).toEqual(sections);
  });
});

describe("isNoPageSubjectText", () => {
  it("accepts the words a page-less card says", () => {
    expect(isNoPageSubjectText({ text: "no page — the row that fixes the class" })).toBe(true);
  });

  it("refuses a capitalised near-miss", () => {
    expect(isNoPageSubjectText({ text: "No page — the row that fixes the class" })).toBe(false);
  });

  it("refuses a longer word that merely starts the same way", () => {
    expect(isNoPageSubjectText({ text: "no pages were published tonight" })).toBe(false);
  });

  it("refuses the words anywhere but the start", () => {
    expect(isNoPageSubjectText({ text: "the row has no page of its own" })).toBe(false);
  });
});

describe("renderedCardSubject", () => {
  it("reads a linked subject's url and its words", () => {
    const card = `<div class="need"><div class="q">1. Ship it?</div><div class="bg"><a href="${HIS_URL}">the board's top row</a></div></div>`;

    expect(renderedCardSubject({ cardHtml: card })).toEqual({ text: "the board's top row", url: HIS_URL });
  });

  it("reads a plain subject as words with no url", () => {
    const card = '<div class="need"><div class="q">1. Ship it?</div><div class="bg">no page — this row</div></div>';

    expect(renderedCardSubject({ cardHtml: card })).toEqual({ text: "no page — this row", url: undefined });
  });

  it("answers nothing for a card carrying no subject line", () => {
    const card = '<div class="need"><div class="q">1. Ship it?</div><dl class="f"></dl></div>';

    expect(renderedCardSubject({ cardHtml: card })).toBe(undefined);
  });
});

describe("isPlainSubjectUrl", () => {
  it("accepts a url written plainly", () => {
    expect(isPlainSubjectUrl({ url: "https://example.invalid/c#installation" })).toBe(true);
  });

  it("accepts every reference the renderer itself emits, so it never refuses a page it just produced", () => {
    const urls = [
      "https://example.invalid/c?a=1&amp;b=2",
      "https://example.invalid/a&quot;b",
      "https://example.invalid/a&lt;b",
      "https://example.invalid/a&gt;b",
    ];

    expect(urls.map((url) => isPlainSubjectUrl({ url }))).toEqual(urls.map(() => true));
  });

  it("refuses every spelling the eight review rounds found, and any other", () => {
    const spellings = ["&#35;", "&#35", "&#x23;", "&#x23", "&num;", "&#035;", "&sol;", "&period;", "&whatever;"];
    const urls = spellings.map((run) => `https://example.invalid/c${run}react-now`);

    expect(urls.map((url) => isPlainSubjectUrl({ url }))).toEqual(spellings.map(() => false));
  });

  it("passes a reference behind the one the renderer emits, which a browser decodes only once", () => {
    // A doubly-escaped hash resolves to the literal entity text in the href, not to a `#`, so the link really does
    // point off this page — the honest reading rather than a conservative guess.
    expect(isPlainSubjectUrl({ url: "https://example.invalid/c&amp;#35;react-now" })).toBe(true);
    expect(briefingTargetOfSubjectUrl({ url: "https://example.invalid/c&amp;#35;react-now" })).toBe(undefined);
  });
});

describe("the renderer and the reader agree on an escaped href", () => {
  it("passes whatever `escapeAttribute` makes of a url carrying all four escaped characters", () => {
    const raw = 'https://example.invalid/a"b&c<d>e';

    expect(isPlainSubjectUrl({ url: escapeAttribute({ text: raw }) })).toBe(true);
  });

  it("still finds the fragment through that escaping, so escaping is not a way past the rule", () => {
    const raw = "https://example.invalid/a?x=1&y=2#react-now";

    expect(briefingTargetOfSubjectUrl({ url: escapeAttribute({ text: raw }) })).toBe("react-now");
  });
});

describe("subjectEncodedLinkRefusal", () => {
  it("names what a character reference does to a link, and the way out", () => {
    expect(subjectEncodedLinkRefusal()).toBe(
      "carries an HTML character reference, so what a browser resolves is not what the link says — the way " +
        "`&#35;` and `&num;` spell a `#` that lands back on this page. Write the url plainly, or drop it, " +
        "begin the subject's text with `no page`, and put the deciding detail in `detail`.",
    );
  });
});

describe("isAbsoluteSubjectUrl", () => {
  it("accepts a page of its own", () => {
    expect(isAbsoluteSubjectUrl({ url: "https://github.com/acme/acme-admin/pull/16415" })).toBe(true);
  });

  it("refuses every shape a browser resolves against the page it is already on", () => {
    const resolved = ["", "   ", "#", "#react-now", "#anything", "/path/to/thing", "//example.invalid/doc"];

    expect(resolved.map((url) => isAbsoluteSubjectUrl({ url }))).toEqual(resolved.map(() => false));
  });
});

describe("subjectRelativeLinkRefusal", () => {
  it("names what such a link actually does, and the way out", () => {
    expect(subjectRelativeLinkRefusal()).toBe(
      "carries a link with no page of its own — a browser resolves it against the page it is already on, " +
        "which is the self-link with nothing on it to see. Drop the url, begin the subject's text with " +
        "`no page`, and put the deciding detail in `detail`.",
    );
  });
});

describe("subjectSelfLinkRefusal", () => {
  it("names the section, why it is wrong, and both legal replacements", () => {
    expect(subjectSelfLinkRefusal({ target: "react-now" })).toBe(
      "points at a briefing page's own `#react-now` section, which is a block of cards rather than anything " +
        "a card is about — and when it is this page, it sends you back to what you are already reading. Use " +
        "an `anchor` run to move you within this page; otherwise drop the url, begin the subject's text " +
        "with `no page`, and put the deciding detail in `detail`.",
    );
  });
});
