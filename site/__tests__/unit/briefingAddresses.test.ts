/*
 * Which briefings a card links (`site/lib/briefingAddresses.ts`), and `site/lib/localPageHref.ts`'s read of one
 * address as a briefing's slug.
 */
import { describe, expect, it } from "vitest";

import { briefingAddressesOf, briefingSlugsOf } from "../../lib/briefingAddresses";
import { briefingSlugOf } from "../../lib/localPageHref";

describe("briefingSlugOf", () => {
  it.each([
    ["file:///Users/someone/.slopweaver/pages/orb-notes/index.html", "orb-notes"],
    // `fileURLToPath` resolves `%70ages` and `index%2Ehtml` to the published page, so they name it too.
    ["file:///Users/someone/.slopweaver/%70ages/orb-notes/index%2Ehtml", "orb-notes"],
    ["file:///Users/someone/.slopweaver/pages%2Forb-notes/index.html", undefined],
    ["http://localhost:3000/api/page/consolidated-briefing/index.html", "consolidated-briefing"],
    ["https://127.0.0.1/api/page/dead-code-audit/index.html#top", "dead-code-audit"],
    ["http://localhost:3000/api/page/orb%2Dnotes/index.html", "orb-notes"],
    ["http://localhost:3000/api/page/orb-notes/index%2Ehtml", "orb-notes"],
    ["http://localhost:3000/api/page/orb%2/index.html", undefined],
    ["http://localhost:3000/api/page/..%2Fsecrets/index.html", undefined],
    ["http://localhost:3000/queue?open=ask%3Aabc", undefined],
    ["http://localhost:3000/api/page/orb/index.html/extra", undefined],
    ["http://localhost:3000/api/page/../index.html", undefined],
    ["https://example.com/api/page/orb/index.html", undefined],
    // The relative route a `page:<slug>` identity is drawn by; another host's protocol-relative one is not.
    ["/api/page/off-cmux-briefing/index.html", "off-cmux-briefing"],
    ["/api/page/off-cmux-briefing/index.html/extra", undefined],
    ["/queue?open=ask%3Aabc", undefined],
    ["//example.com/api/page/orb/index.html", undefined],
  ])("reads %s as %s", (url, slug) => {
    expect(briefingSlugOf({ url })).toBe(slug);
  });
});

describe("briefingAddressesOf", () => {
  // A session-hosting card can name its briefing as `page:off-cmux-briefing`.
  it("reads all three spellings in the order the text spells them, the first spelling of a slug winning", () => {
    expect(
      briefingAddressesOf({
        texts: [
          "page:alpha. Then file:///x/pages/beta/index.html, then /api/page/gamma/index.html and " +
            "http://localhost:3000/api/page/alpha/index.html again.",
        ],
        urls: [],
      }),
    ).toEqual([
      { slug: "alpha", url: "/api/page/alpha/index.html" },
      { slug: "beta", url: "file:///x/pages/beta/index.html" },
      { slug: "gamma", url: "/api/page/gamma/index.html" },
    ]);
  });

  it.each([
    ["page:foo?x", []],
    ["page:foo/bar", []],
    ["See page:foo;bar for details.", []],
    ["See page:foo, then page:bar; done.", ["foo", "bar"]],
    ["<page:foo|the briefing>", ["foo"]],
    ["See page:foo|https://example.com for details.", []],
    ["See /api/page/foo/index.html|https://example.com for details.", []],
    ["See file:///x/pages/foo/index.html|https://example.com for details.", []],
    ["<http://localhost:3000/api/page/foo/index.html|the briefing>", ["foo"]],
    ["<page:foo)|label>", []],
    ["See <page:foo|https://example.com", []],
    ["See `page:foo`—details.", ["foo"]],
    ["See </api/page/foo/index.html|https://example.com", []],
    ["</api/page/foo/index.html)|label>", []],
    ["see page:foo? yes", ["foo"]],
    ["(page:foo)", ["foo"]],
    ["**page:foo**", ["foo"]],
    ["See https://example.com/?next=page:foo", []],
    ["https://example.com/page:foo", []],
    ["See https://example.com/(page:foo)", []],
    ["https://example.com/x,(/api/page/foo/index.html)", []],
    ["https://example.com/x (page:foo)", ["foo"]],
    ["Contact mailto:owner@example.com?body=(/api/page/foo/index.html)", []],
    ["see\n(/api/page/foo/index.html)", ["foo"]],
    ["https://github.com/acme/repo/api/page/foo/index.html", []],
    ["?return_to=/api/page/foo/index.html", []],
  ])("reads %s as %j", (text, slugs) => {
    expect(briefingSlugsOf({ texts: [text], urls: [] })).toEqual(slugs);
  });
});

describe("briefingSlugsOf", () => {
  it("takes each slug once, the card's addresses first, then any its words spell, a sentence's full stop dropped", () => {
    expect(
      briefingSlugsOf({
        texts: [
          "See http://localhost:3000/api/page/consolidated-briefing/index.html. And file:///x/pages/orb-notes/index.html",
          "Not https://github.com/acme/repo/pull/7 nor http://example.com/api/page/x/index.html",
        ],
        urls: ["file:///x/pages/orb-notes/index.html", "https://github.com/acme/repo/pull/7"],
      }),
    ).toEqual(["orb-notes", "consolidated-briefing"]);
  });

  it("stops each address at its index.html, whatever Markdown or query follows it", () => {
    expect(
      briefingSlugsOf({
        texts: [
          "Read **http://localhost:3000/api/page/orb-notes/index.html** and _file:///x/pages/lint-rules/index.html_",
          "then http://127.0.0.1:3000/api/page/dead-code/index.html?tab=1#top, twice: file:///x/pages/orb-notes/index.html",
        ],
        urls: [],
      }),
    ).toEqual(["orb-notes", "lint-rules", "dead-code"]);
  });

  // A `)` in an ancestor directory is a legal path, and a Markdown link's `)` follows the index.html.
  it("reads through a bracket in an ancestor directory, and stops before a Markdown link's own bracket", () => {
    expect(
      briefingSlugsOf({
        texts: [
          "Read file:///Users/alice)/.slopweaver/pages/orb-notes/index.html first.",
          "[the plan](file:///Users/alice/.slopweaver/pages/plan/index.html) and (see file:///x/pages/dead-code/index.html)",
        ],
        urls: [],
      }),
    ).toEqual(["orb-notes", "plan", "dead-code"]);
  });

  // The publisher writes an apostrophe or `|` in a home directory unescaped, and the run stopped at it.
  it("reads through an apostrophe or bar in an ancestor directory, and stops before a quote or Slack label after", () => {
    expect(
      briefingSlugsOf({
        texts: [
          "Read file:///tmp/O'Brien/.slopweaver/pages/orb-notes/index.html first.",
          "Then 'file:///tmp/a|b/.slopweaver/pages/plan/index.html' and <file:///x/pages/dead-code/index.html|the audit>",
        ],
        urls: [],
      }),
    ).toEqual(["orb-notes", "plan", "dead-code"]);
  });

  // An ancestor directory called index.html once ended the address there, and it named nothing.
  it("reads past an ancestor directory called index.html, and finds an address after a run that names none", () => {
    expect(
      briefingSlugsOf({
        texts: [
          "Read file:///Users/alice/index.html/archive/.slopweaver/pages/orb-notes/index.html now",
          "[pr](file:///x/notes.txt)(file:///x/pages/dead-code/index.html)",
        ],
        urls: [],
      }),
    ).toEqual(["orb-notes", "dead-code"]);
  });

  // A path carried on past index.html is another address that merely contains the page's route.
  it("reads no briefing from an address whose path goes on past its index.html", () => {
    expect(
      briefingSlugsOf({
        texts: [
          "See /api/page/foo/index.html/extra and http://localhost:3000/api/page/bar/index.html/more",
          "then file:///x/pages/baz/index.htmlx and /api/page/qux/index.html;jsessionid=123",
          "while /api/page/kept/index.html. still reads, as does [label](http://localhost:3000/api/page/also/index.html).",
        ],
        urls: [],
      }),
    ).toEqual(["kept", "also"]);
  });

  // A scheme and host are case-insensitive and a URL may carry userinfo, and the run matched neither.
  it("reads the console's page route in any spelling the URL parser resolves to it, and no other host's", () => {
    expect(
      briefingSlugsOf({
        texts: [
          "Read http://LOCALHOST:3000/api/page/orb-notes/index.html",
          "and HTTP://127.0.0.1/api/page/plan/index.html",
          "then http://user@localhost:3000/api/page/dead-code/index.html",
          "and http://[::1]:3000/api/page/ipv6-notes/index.html",
          "and http://localhost.:3000/api/page/fqdn-notes/index.html",
          "never https://acme.example/api/page/elsewhere/index.html",
        ],
        urls: [],
      }),
    ).toEqual(["orb-notes", "plan", "dead-code", "ipv6-notes", "fqdn-notes"]);
  });

  it("is empty for a card that links no briefing", () => {
    expect(briefingSlugsOf({ texts: [], urls: [] })).toEqual([]);
  });
});
