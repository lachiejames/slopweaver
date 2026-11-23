/**
 * The computed half of "a corrected page shows where the corrections are".
 *
 * The property under test is the one the row's own finding named: the marks come out of the diff, so a page
 * cannot claim three corrections while carrying four. Everything here is bytes in, bytes out — the compare,
 * the pairing that reads an LCS removal-plus-addition back as an edit, the propagation that makes a change
 * visible from OUTSIDE a collapsed fold, and the idempotency a third round of reacting depends on.
 */
import { describe, expect, it } from "vitest";

import { pageCorrections, STRIP_MAX_JUMPS, stampCorrections } from "../../../../outbound/briefing/corrections.js";
import { stripCorrections } from "../../../../outbound/briefing/correctionsStrip.js";
import { PLATFORM_SHELL_OPEN, SHELL_CLOSE, SHELL_OPEN, wrapPageFragment } from "../../../../pages/shell.js";

/** One page, built the way the renderer builds one: an eyebrow, then blocks. */
function page({ body }: { body: string }): string {
  return `<main><div class="eyebrow">last refreshed X · ready for review Y</div>${body}</main>`;
}

describe("pageCorrections", () => {
  it("reports an edited paragraph as one change rather than a departure and an arrival", () => {
    const result = pageCorrections({
      next: page({ body: "<p>one</p><p>two changed</p><p>three</p>" }),
      previous: page({ body: "<p>one</p><p>two</p><p>three</p>" }),
    });

    expect(result.changed).toBe(1);
    expect(result.added).toBe(0);
    expect(result.gone).toBe(0);
    expect(result.marked).toBe(1);
    expect(result.spotsCompared).toBe(3);
    expect(result.corrections.filter((row) => row.mark === "changed").map((row) => row.label)).toEqual(["two changed"]);
  });

  it("reports an added block as new and a deleted one as gone, each on its own", () => {
    const result = pageCorrections({
      next: page({ body: "<p>one</p><p>three</p><p>four</p>" }),
      previous: page({ body: "<p>one</p><p>two</p><p>three</p>" }),
    });

    expect(result.changed).toBe(0);
    expect(result.added).toBe(1);
    expect(result.gone).toBe(1);
    expect(result.corrections.filter((row) => row.mark === "gone").map((row) => row.label)).toEqual(["two"]);
    expect(result.corrections.filter((row) => row.mark === "new").map((row) => row.label)).toEqual(["four"]);
  });

  it("calls a card changed when its id held while every field under it was rewritten", () => {
    const result = pageCorrections({
      next: page({ body: '<div class="need" id="c1"><div class="q">1. ship it?</div><p>yes</p></div>' }),
      previous: page({ body: '<div class="need" id="c1"><div class="q">1. hold it?</div><p>no</p></div>' }),
    });

    expect(result.changed).toBe(1);
    expect(result.gone).toBe(0);
    expect(result.added).toBe(0);
  });

  it("ignores the eyebrow, whose instants move on every republish", () => {
    const result = pageCorrections({
      next: '<main><div class="eyebrow">last refreshed LATER</div><p>same</p></main>',
      previous: '<main><div class="eyebrow">last refreshed EARLIER</div><p>same</p></main>',
    });

    expect(result.marked).toBe(0);
    expect(result.spotsCompared).toBe(1);
  });

  it("ignores the review fold, so a new review is never marked as a change the owner must re-read", () => {
    const fold = ({ summary }: { summary: string }) =>
      `\n<details data-page-review="reviewed"><summary>reviewed</summary><ul><li>${summary}</li></ul></details>\n`;
    const result = pageCorrections({
      next: page({ body: `<p>same</p>${fold({ summary: "second pass held" })}` }),
      previous: page({ body: `<p>same</p>${fold({ summary: "first pass held" })}` }),
    });

    expect(result.marked).toBe(0);
    expect(result.spotsCompared).toBe(1);
  });

  it("names the version it compared against, so a reader can re-run it", () => {
    const previous = page({ body: "<p>one</p>" });
    const result = pageCorrections({ next: page({ body: "<p>two</p>" }), previous });

    expect(result.against).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(result.against).toBe(pageCorrections({ next: previous, previous }).against);
  });
});

describe("stampCorrections", () => {
  it("marks exactly the spots the compare found, and says so in the strip", () => {
    const stamped = stampCorrections({
      next: page({ body: "<p>one</p><p>two changed</p>" }),
      previous: page({ body: "<p>one</p><p>two</p>" }),
    });

    expect(stamped.result.marked).toBe(1);
    expect([...stamped.html.matchAll(/\sdata-corr="(?:changed|new)"/g)]).toHaveLength(1);
    expect(stamped.html).toContain('data-corr-marked="1"');
    expect(stamped.html).toContain("1 changed since the version you read");
  });

  it("mints an anchor for a marked spot that carried none, and links to it", () => {
    const stamped = stampCorrections({
      next: page({ body: "<p>one</p><p>two changed</p>" }),
      previous: page({ body: "<p>one</p><p>two</p>" }),
    });

    expect(stamped.html).toContain('<p id="corr-1" data-corr-minted="1" data-corr="changed">two changed</p>');
    expect(stamped.html).toContain('href="#corr-1"');
  });

  it("keeps a spot's own id rather than minting a second one", () => {
    const stamped = stampCorrections({
      next: page({ body: '<h2 id="react-now">react later</h2>' }),
      previous: page({ body: '<h2 id="react-now">react now</h2>' }),
    });

    expect(stamped.html).toContain('<h2 id="react-now" data-corr="changed">react later</h2>');
    expect(stamped.html).toContain('href="#react-now"');
  });

  it("says on the collapsed line that the change is underneath it", () => {
    const body = ({ inner }: { inner: string }): string =>
      `<details><summary>history</summary><div><p>${inner}</p></div></details>`;
    const stamped = stampCorrections({
      next: page({ body: body({ inner: "moved" }) }),
      previous: page({ body: body({ inner: "stood" }) }),
    });

    expect(stamped.html).toContain('data-corr-inside="1 changed inside"');
    expect(stamped.result.marked).toBe(1);
  });

  it("separates the collapsed line's mark from what the fold's opening tag already declares", () => {
    const body = ({ inner }: { inner: string }): string =>
      `<details id="history"><summary>history</summary><div><p>${inner}</p></div></details>`;
    const stamped = stampCorrections({
      next: page({ body: body({ inner: "moved" }) }),
      previous: page({ body: body({ inner: "stood" }) }),
    });

    expect(stamped.html).toContain('<details id="history" data-corr-inside="1 changed inside">');
  });

  it("re-stamps a fold to the same bytes, so its collapsed line never collects a second mark", () => {
    const body = ({ inner }: { inner: string }): string =>
      `<details id="history"><summary>history</summary><div><p>${inner}</p></div></details>`;
    const previous = page({ body: body({ inner: "stood" }) });
    const next = page({ body: body({ inner: "moved" }) });
    const once = stampCorrections({ next, previous });
    const twice = stampCorrections({ next: once.html, previous });

    expect([...twice.html.matchAll(/data-corr-inside="/g)]).toHaveLength(1);
    expect(twice.html).toBe(once.html);
  });

  it("re-stamps to the same bytes when an opening tag carries whitespace of its own before the bracket", () => {
    const body = ({ inner }: { inner: string }): string =>
      `<details id="history" ><summary>history</summary><p id="p1" >${inner}</p></details>`;
    const previous = page({ body: body({ inner: "stood" }) });
    const next = page({ body: body({ inner: "moved" }) });
    const once = stampCorrections({ next, previous });
    const twice = stampCorrections({ next: once.html, previous });

    expect(once.html).toContain('<details id="history"  data-corr-inside="1 changed inside">');
    expect(twice.html).toBe(once.html);
  });

  it("stops the jump list at the cap while still marking every spot on the page", () => {
    const spots = ({ suffix }: { suffix: string }): string =>
      Array.from({ length: STRIP_MAX_JUMPS + 3 }, (_unused, index) => `<p>row ${String(index)}${suffix}</p>`).join("");
    const stamped = stampCorrections({
      next: page({ body: spots({ suffix: " moved" }) }),
      previous: page({ body: spots({ suffix: "" }) }),
    });

    expect(stamped.result.marked).toBe(STRIP_MAX_JUMPS + 3);
    expect([...stamped.html.matchAll(/class="corr-jump"/g)]).toHaveLength(STRIP_MAX_JUMPS);
    expect(stamped.html).toContain("and 3 more, marked on the page");
  });

  it("says so plainly when nothing moved at all", () => {
    const same = page({ body: "<p>one</p>" });
    const stamped = stampCorrections({ next: same, previous: same });

    expect(stamped.result.marked).toBe(0);
    expect(stamped.html).toContain("nothing changed since the version you read");
    expect(stamped.html).toContain('data-corr-marked="0"');
  });

  it("re-stamps to the same bytes, so a third round of reacting is not a diff against last round's marks", () => {
    const previous = page({ body: "<p>one</p><p>two</p>" });
    const next = page({ body: "<p>one</p><p>two changed</p>" });
    const once = stampCorrections({ next, previous });
    const twice = stampCorrections({ next: once.html, previous });

    expect(twice.html).toBe(once.html);
  });

  it("compares content, not marks, when the version the owner read was itself a stamped page", () => {
    const previous = page({ body: "<p>one</p><p>two</p>" });
    const stamped = stampCorrections({ next: page({ body: "<p>one</p><p>two changed</p>" }), previous });
    const round3 = pageCorrections({ next: page({ body: "<p>one</p><p>two changed</p>" }), previous: stamped.html });

    expect(round3.marked).toBe(0);
    expect(round3.gone).toBe(0);
  });
});

describe("stripCorrections", () => {
  it("takes back every trace of a stamp: the strip, its sheet, the marks and the minted anchors", () => {
    const previous = page({ body: "<p>one</p><p>two</p>" });
    const next = page({ body: "<p>one</p><p>two changed</p>" });

    expect(stripCorrections({ html: stampCorrections({ next, previous }).html })).toBe(next);
  });

  it("takes back a fold's collapsed-line mark as well, marked spot and enclosing fold alike", () => {
    const body = ({ inner }: { inner: string }): string =>
      `<details id="history"><summary>history</summary><div><p>${inner}</p></div></details>`;
    const previous = page({ body: body({ inner: "stood" }) });
    const next = page({ body: body({ inner: "moved" }) });

    expect(stripCorrections({ html: stampCorrections({ next, previous }).html })).toBe(next);
  });

  it("mints an anchor the page does not already carry, so the jump lands on the spot that moved", () => {
    const body = ({ inner }: { inner: string }): string => `<h2 id="corr-1">a section</h2><p>${inner}</p>`;
    const stamped = stampCorrections({
      next: page({ body: body({ inner: "moved" }) }),
      previous: page({ body: body({ inner: "stood" }) }),
    });

    expect(stamped.html).toContain('<p id="corr-1-2" data-corr-minted="1" data-corr="changed">moved</p>');
    expect(stamped.html).toContain('href="#corr-1-2"');
    expect([...stamped.html.matchAll(/ id="corr-1"/g)]).toHaveLength(1);
  });

  it("leaves a script whose source quotes a mark alone, editing markup and never a body", () => {
    const body = ({ inner }: { inner: string }): string =>
      `<script>const example = ' data-corr="changed"';</script><p id="p1">${inner}</p>`;
    const previous = page({ body: body({ inner: "stood" }) });
    const next = page({ body: body({ inner: "moved" }) });
    const stamped = stampCorrections({ next, previous });

    expect(stamped.html).toContain(`<script>const example = ' data-corr="changed"';</script>`);
    expect(stripCorrections({ html: stamped.html })).toBe(next);
  });

  it("leaves a script quoting the whole strip element alone, not just one quoted attribute", () => {
    const quoted = `'<div class="corr" data-corr="changed">example</div>'`;
    const body = ({ inner }: { inner: string }): string =>
      `<script>const example = ${quoted};</script><p id="p1">${inner}</p>`;
    const previous = page({ body: body({ inner: "stood" }) });
    const next = page({ body: body({ inner: "moved" }) });
    const stamped = stampCorrections({ next, previous });

    expect(stamped.html).toContain(`<script>const example = ${quoted};</script>`);
    expect(stripCorrections({ html: stamped.html })).toBe(next);
  });

  it("drops its own stylesheet while keeping a script that quotes that stylesheet's opening tag", () => {
    const quoted = `'<style data-corr-style="1">.corr { color: red; }</style>'`;
    const body = ({ inner }: { inner: string }): string =>
      `<script>const sheet = ${quoted};</script><p id="p1">${inner}</p>`;
    const previous = page({ body: body({ inner: "stood" }) });
    const next = page({ body: body({ inner: "moved" }) });
    const stamped = stampCorrections({ next, previous });

    expect(stamped.html).toContain(`<script>const sheet = ${quoted};</script>`);
    expect(stripCorrections({ html: stamped.html })).toBe(next);
  });

  it("leaves an id the page's own author wrote in this file's anchor namespace exactly where it was", () => {
    const body = ({ inner }: { inner: string }): string => `<p id="corr-1">${inner}</p>`;
    const previous = page({ body: body({ inner: "stood" }) });
    const next = page({ body: body({ inner: "moved" }) });
    const stamped = stampCorrections({ next, previous });

    expect(stamped.html).toContain('<p id="corr-1" data-corr="changed">moved</p>');
    expect(stripCorrections({ html: stamped.html })).toBe(next);
  });

  it("mints past an author's id even when the author quoted it with apostrophes", () => {
    const body = ({ inner }: { inner: string }): string => `<h2 id='corr-1'>a section</h2><p>${inner}</p>`;
    const previous = page({ body: body({ inner: "stood" }) });
    const next = page({ body: body({ inner: "moved" }) });
    const stamped = stampCorrections({ next, previous });

    expect(stamped.html).toContain(`<h2 id='corr-1'>a section</h2>`);
    expect(stamped.html).toContain('<p id="corr-1-2" data-corr-minted="1" data-corr="changed">moved</p>');
    expect(stripCorrections({ html: stamped.html })).toBe(next);
  });

  it("splices the strip after the page's own eyebrow, never one a script quotes", () => {
    const quoted = `'<div class="eyebrow">last refreshed X</div>'`;
    const fragment = ({ inner }: { inner: string }): string =>
      `<script>const chrome = ${quoted};</script>\n<p id="p1">${inner}</p>`;
    const previous = fragment({ inner: "stood" });
    const next = fragment({ inner: "moved" });
    const stamped = stampCorrections({ next, previous });

    expect(stamped.html).toContain(`<script>const chrome = ${quoted};</script>`);
    expect(stamped.result.marked).toBe(1);
    expect(stripCorrections({ html: stamped.html })).toBe(next);
  });

  it("reads a script closed with whitespace in its end tag as inert, which HTML says it is", () => {
    const quoted = `'<div class="corr" data-corr="changed">keep</div>'`;
    const body = ({ inner }: { inner: string }): string =>
      `<script>const example = ${quoted};</script >\n<p id="p1">${inner}</p>`;
    const previous = page({ body: body({ inner: "stood" }) });
    const next = page({ body: body({ inner: "moved" }) });
    const stamped = stampCorrections({ next, previous });

    expect(stamped.html).toContain(`<script>const example = ${quoted};</script >`);
    expect(stripCorrections({ html: stamped.html })).toBe(next);
  });

  it("leaves a paragraph that is ABOUT a mark attribute saying what it was written to say", () => {
    const body = ({ inner }: { inner: string }): string => `<p id="p1">Example: data-corr="changed" — ${inner}</p>`;
    const previous = page({ body: body({ inner: "stood" }) });
    const next = page({ body: body({ inner: "moved" }) });
    const stamped = stampCorrections({ next, previous });

    expect(stamped.html).toContain('<p id="p1" data-corr="changed">Example: data-corr="changed" — moved</p>');
    expect(stripCorrections({ html: stamped.html })).toBe(next);
  });

  it("reads an unclosed script as inert to the end of the page, which is what a browser does", () => {
    const quoted = `'<div class="corr" data-corr="changed">keep</div>'`;
    const body = ({ inner }: { inner: string }): string => `<p id="p1">${inner}</p><script>const example = ${quoted};`;
    const previous = page({ body: body({ inner: "stood" }) });
    const next = page({ body: body({ inner: "moved" }) });
    const stamped = stampCorrections({ next, previous });

    expect(stamped.html).toContain(`<script>const example = ${quoted};`);
    expect(stripCorrections({ html: stamped.html })).toBe(next);
  });

  it("mints past an author's id written with whitespace around its equals sign", () => {
    const body = ({ inner }: { inner: string }): string => `<h2 id = 'corr-1'>a section</h2><p>${inner}</p>`;
    const previous = page({ body: body({ inner: "stood" }) });
    const next = page({ body: body({ inner: "moved" }) });
    const stamped = stampCorrections({ next, previous });

    expect(stamped.html).toContain(`<h2 id = 'corr-1'>a section</h2>`);
    expect(stamped.html).toContain('<p id="corr-1-2" data-corr-minted="1" data-corr="changed">moved</p>');
    expect(stripCorrections({ html: stamped.html })).toBe(next);
  });

  it("mints past an author's id written with no quotes at all", () => {
    const body = ({ inner }: { inner: string }): string => `<h2 id=corr-1>a section</h2><p>${inner}</p>`;
    const previous = page({ body: body({ inner: "stood" }) });
    const next = page({ body: body({ inner: "moved" }) });
    const stamped = stampCorrections({ next, previous });

    expect(stamped.html).toContain(`<h2 id=corr-1>a section</h2>`);
    expect(stamped.html).toContain('<p id="corr-1-2" data-corr-minted="1" data-corr="changed">moved</p>');
    expect(stripCorrections({ html: stamped.html })).toBe(next);
  });

  it("leaves a comment holding markup exactly as its author wrote it", () => {
    const comment = `<!-- <div class="corr" data-corr="changed">KEEP</div> -->`;
    const body = ({ inner }: { inner: string }): string => `${comment}<p id="p1">${inner}</p>`;
    const previous = page({ body: body({ inner: "stood" }) });
    const next = page({ body: body({ inner: "moved" }) });
    const stamped = stampCorrections({ next, previous });

    expect(stamped.html).toContain(comment);
    expect(stamped.result.marked).toBe(1);
    expect(stripCorrections({ html: stamped.html })).toBe(next);
  });

  it("leaves an attribute value that quotes a mark attribute whole", () => {
    const title = `title='example data-corr="changed"'`;
    const body = ({ inner }: { inner: string }): string => `<p ${title}>${inner}</p>`;
    const previous = page({ body: body({ inner: "stood" }) });
    const next = page({ body: body({ inner: "moved" }) });
    const stamped = stampCorrections({ next, previous });

    expect(stamped.html).toContain(`<p ${title} id="corr-0" data-corr-minted="1" data-corr="changed">moved</p>`);
    expect(stripCorrections({ html: stamped.html })).toBe(next);
  });

  it("closes a tag on the bracket that closes IT, not on one inside a quoted value", () => {
    const body = ({ inner }: { inner: string }): string => `<p id="p1" title="1 > 0">${inner}</p>`;
    const previous = page({ body: body({ inner: "stood" }) });
    const next = page({ body: body({ inner: "moved" }) });
    const stamped = stampCorrections({ next, previous });

    expect(stamped.html).toContain(`<p id="p1" title="1 > 0" data-corr="changed">moved</p>`);
    expect(stripCorrections({ html: stamped.html })).toBe(next);
  });

  it("marks no spot inside a quoted attribute value, because a title declares no paragraph", () => {
    const body = ({ inner }: { inner: string }): string => `<span title='<p id="p1">${inner}</p>'>visible</span>`;
    const previous = page({ body: body({ inner: "old" }) });
    const next = page({ body: body({ inner: "new" }) });
    const stamped = stampCorrections({ next, previous });

    expect(stamped.result.marked).toBe(0);
    expect(stamped.html).toContain(`<span title='<p id="p1">new</p>'>visible</span>`);
    expect(stripCorrections({ html: stamped.html })).toBe(next);
  });

  it("leaves a div the page's OWN author gave the corrections class, which is not our strip", () => {
    const own = `<div class="corr">my own notes</div>`;
    const body = ({ inner }: { inner: string }): string => `${own}<p id="p1">${inner}</p>`;
    const next = page({ body: body({ inner: "new" }) });
    const stamped = stampCorrections({ next, previous: page({ body: body({ inner: "old" }) }) });

    expect(stamped.html).toContain(own);
    expect(stripCorrections({ html: stamped.html })).toBe(next);
  });

  it("mints past an id declared on a raw-text element's own tag, which a jump can still land on", () => {
    const body = ({ inner }: { inner: string }): string => `<textarea id="corr-0">notes</textarea><p>${inner}</p>`;
    const previous = page({ body: body({ inner: "old" }) });
    const next = page({ body: body({ inner: "new" }) });
    const stamped = stampCorrections({ next, previous });

    expect(stamped.result.marked).toBe(1);
    expect(stamped.html).toContain(`<p id="corr-0-2" data-corr-minted="1" data-corr="changed">new</p>`);
    expect(stripCorrections({ html: stamped.html })).toBe(next);
  });

  it("marks no spot inside a raw-text element, whose body is one text node however it reads", () => {
    const body = ({ name, inner }: { name: string; inner: string }): string =>
      `<${name}><p id="p1" data-corr="changed">${inner}</p></${name}>`;
    const roundTripped = ["textarea", "iframe", "noembed", "xmp"].filter((name) => {
      const next = page({ body: body({ inner: "new", name }) });
      const stamped = stampCorrections({ next, previous: page({ body: body({ inner: "old", name }) }) });
      return stamped.result.marked === 0 && stripCorrections({ html: stamped.html }) === next;
    });

    expect(roundTripped).toEqual(["textarea", "iframe", "noembed", "xmp"]);
  });

  it("keeps the whitespace a page opens with, which the sheet is spliced in front of", () => {
    const indented = ({ inner }: { inner: string }): string =>
      `\n<div class="eyebrow">last refreshed X</div>\n<p id="p1">${inner}</p>\n`;
    const previous = indented({ inner: "stood" });
    const next = indented({ inner: "moved" });
    const stamped = stampCorrections({ next, previous });

    expect(stamped.result.marked).toBe(1);
    expect(stripCorrections({ html: stamped.html })).toBe(next);
  });

  it("round-trips a fragment with no eyebrow, where the strip and its sheet sit at the very front", () => {
    const fragment = ({ inner }: { inner: string }): string => `\n<h2 id="s1">a section</h2>\n<p id="p1">${inner}</p>`;
    const previous = fragment({ inner: "stood" });
    const next = fragment({ inner: "moved" });
    const stamped = stampCorrections({ next, previous });

    expect(stamped.result.marked).toBe(1);
    expect(stripCorrections({ html: stamped.html })).toBe(next);
  });

  it("leaves the page's own whitespace where it was, taking back only the space the stamp added", () => {
    const body = ({ inner }: { inner: string }): string =>
      `<details id="history" ><summary>history</summary><p id="p1" >${inner}</p></details>`;
    const previous = page({ body: body({ inner: "stood" }) });
    const next = page({ body: body({ inner: "moved" }) });

    expect(stripCorrections({ html: stampCorrections({ next, previous }).html })).toBe(next);
  });
});

describe("stampCorrections on a whole published page", () => {
  const fragment = ({ inner }: { inner: string }): string =>
    `<title>t</title>\n<div class="eyebrow">last refreshed X</div>\n<p id="p1">${inner}</p>\n`;

  it("keeps the current shell outermost and stamps inside the fragment, round-tripping", () => {
    const previous = wrapPageFragment({ fragment: fragment({ inner: "stood" }) });
    const next = wrapPageFragment({ fragment: fragment({ inner: "moved" }) });
    const stamped = stampCorrections({ next, previous });

    expect(stamped.result.marked).toBe(1);
    expect(stamped.html.startsWith(`${SHELL_OPEN}<style data-corr-style="1">`)).toBe(true);
    expect(stamped.html.endsWith(SHELL_CLOSE)).toBe(true);
    expect(stripCorrections({ html: stamped.html })).toBe(next);
  });

  it("keeps a platform-shell page in the platform shell, so a correction is not a migration", () => {
    const previous = `${PLATFORM_SHELL_OPEN}${fragment({ inner: "stood" })}${SHELL_CLOSE}`;
    const next = `${PLATFORM_SHELL_OPEN}${fragment({ inner: "moved" })}${SHELL_CLOSE}`;
    const stamped = stampCorrections({ next, previous });

    expect(stamped.html.startsWith(`${PLATFORM_SHELL_OPEN}<style data-corr-style="1">`)).toBe(true);
    expect(stripCorrections({ html: stamped.html })).toBe(next);
  });

  it("puts the strip inside the fragment when the page has no eyebrow", () => {
    const bare = ({ inner }: { inner: string }): string =>
      wrapPageFragment({ fragment: `<title>t</title>\n<p id="p1">${inner}</p>` });
    const next = bare({ inner: "moved" });
    const stamped = stampCorrections({ next, previous: bare({ inner: "stood" }) });

    expect(stamped.html.startsWith(`${SHELL_OPEN}<style data-corr-style="1">`)).toBe(true);
    expect(stamped.html).toContain('</style>\n<div class="corr" data-corr-marked="1"');
    expect(stripCorrections({ html: stamped.html })).toBe(next);
  });

  it("re-stamps a stamped whole page to the same bytes", () => {
    const previous = wrapPageFragment({ fragment: fragment({ inner: "stood" }) });
    const once = stampCorrections({ next: wrapPageFragment({ fragment: fragment({ inner: "moved" }) }), previous });

    expect(stampCorrections({ next: once.html, previous }).html).toBe(once.html);
  });
});
