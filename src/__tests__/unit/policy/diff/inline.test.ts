import { describe, expect, it } from "vitest";

import { inlineAtoms, renderInline, wordDiffHtml } from "../../../../policy/diff/inline.js";

const images = new Map<string, string>([["topology.png", "data:image/png;base64,AAAA"]]);

describe("inlineAtoms", () => {
  it("keeps a link, code span and bold run whole, and joins back to the input", () => {
    const markdown = "See [NET-38](https://x.test/n) in `a b.ts` **now**.";
    const atoms = inlineAtoms({ markdown });
    expect(atoms.map((atom) => atom.kind)).toEqual([
      "word",
      "space",
      "link",
      "space",
      "word",
      "space",
      "code",
      "space",
      "strong",
      "word",
    ]);
    expect(atoms.map((atom) => atom.raw).join("")).toBe(markdown);
  });
});

describe("renderInline", () => {
  it("renders links, code, bold and an inlined image, escaping text", () => {
    expect(renderInline({ images, markdown: "a<b [x](https://x.test/?a=1&b=2) `c` **d** ![t](topology.png)" })).toBe(
      'a&lt;b <a href="https://x.test/?a=1&amp;b=2">x</a> <code>c</code> <strong>d</strong> <img src="data:image/png;base64,AAAA" alt="t">',
    );
  });

  it("makes a bare public web address the link it reads as, never one inside a link or at no public host", () => {
    const markdown =
      "on https://acme.com/a?b=1&c=2. **https://acme.com/s** [https://acme.com/x](https://acme.com/y) http://localhost/z";
    expect(renderInline({ images, markdown })).toBe(
      [
        'on <a href="https://acme.com/a?b=1&amp;c=2">https://acme.com/a?b=1&amp;c=2</a>.',
        '<strong><a href="https://acme.com/s">https://acme.com/s</a></strong>',
        '<a href="https://acme.com/y">https://acme.com/x</a>',
        "http://localhost/z",
      ].join(" "),
    );
  });

  it("links the whole address a document wrote, less only what the sentence put after it", () => {
    const markdown = [
      "(https://en.wikipedia.org/wiki/Policy_(disambiguation))",
      "“https://acme.com/q”",
      "https://acme.com/e…",
      "https://acme.com/d—then",
      "https://groups.google.com/g/x#!topic/abc",
      "https://acme.com/a*b[c]",
    ].join(" ");
    expect(renderInline({ images, markdown })).toBe(
      [
        `(${anchor({ url: "https://en.wikipedia.org/wiki/Policy_(disambiguation)" })})`,
        `“${anchor({ url: "https://acme.com/q" })}”`,
        `${anchor({ url: "https://acme.com/e" })}…`,
        `${anchor({ url: "https://acme.com/d" })}—then`,
        anchor({ url: "https://groups.google.com/g/x#!topic/abc" }),
        anchor({ url: "https://acme.com/a*b[c]" }),
      ].join(" "),
    );
  });

  it("leaves emphasis around an address out of it, and markup glued after it its own meaning", () => {
    const markdown = [
      "_Read https://acme.com/p._",
      "*https://acme.com/s*",
      "~~https://acme.com/t~~",
      "HTTPS://ACME.COM/a*b",
      "https://acme.com/x[docs](https://acme.com/y)`c`**d**|next|",
    ].join(" ");
    expect(renderInline({ images, markdown })).toBe(
      [
        `_Read ${anchor({ url: "https://acme.com/p" })}._`,
        `*${anchor({ url: "https://acme.com/s" })}*`,
        `~~${anchor({ url: "https://acme.com/t" })}~~`,
        anchor({ url: "HTTPS://ACME.COM/a*b" }),
        `${anchor({ url: "https://acme.com/x" })}<a href="https://acme.com/y">docs</a><code>c</code><strong>d</strong>|next|`,
      ].join(" "),
    );
  });

  it("keeps an address short of markup that follows its scheme at once, and a word short of an address", () => {
    expect(inlineAtoms({ markdown: "https://**x** see:https://acme.com/z" }).map((atom) => atom.raw)).toEqual([
      "h",
      "ttps://",
      "**x**",
      " ",
      "see:",
      "https://acme.com/z",
    ]);
  });
});

/** The anchor a bare address renders as. */
function anchor({ url }: { url: string }): string {
  return `<a href="${url}">${url}</a>`;
}

describe("wordDiffHtml", () => {
  it("wraps a whole link in ins, never half of one", () => {
    const diffed = wordDiffHtml({ after: "see [NET-38](https://x.test/n) now", before: "see now", images });
    expect(diffed.after).toBe('see <ins><a href="https://x.test/n">NET-38</a> </ins>now');
    expect(diffed.before).toBe("see now");
  });

  it("marks a reworded word on both sides", () => {
    const diffed = wordDiffHtml({ after: "confirmed in June", before: "confirmed on 9 Jun", images });
    expect(diffed.before).toBe("confirmed <del>on</del> <del>9 Jun</del>");
    expect(diffed.after).toBe("confirmed <ins>in</ins> <ins>June</ins>");
  });

  it("does not highlight a label that only became bold", () => {
    const diffed = wordDiffHtml({ after: "**Owner** platform", before: "Owner platform", images });
    expect(diffed.after).toBe("<strong>Owner</strong> platform");
    expect(diffed.before).toBe("Owner platform");
  });
});
