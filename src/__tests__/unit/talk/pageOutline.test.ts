/**
 * A published page's outline: each `<h1>`–`<h3>` and the byte offset it opens at, which the console voice reads
 * beside every `file_read` window so a question about one section is answered from that section.
 */
import { describe, expect, it } from "vitest";

import {
  outlineShortened,
  PAGE_OUTLINE_MAX_ENTRIES,
  PAGE_OUTLINE_TEXT_MAX_CHARS,
  type PageHeading,
  pageOutline,
} from "../../../talk/pageOutline.js";

/**
 * The mask that changes nothing, for every case that is not about masking: a span reads back as its own bytes.
 *
 * @param bytes the page the spans are of
 * @returns a mask leaving every heading as it is
 */
function unmasked({ bytes }: { bytes: Uint8Array }): Parameters<typeof pageOutline>[0]["mask"] {
  return {
    markup: ({ start, end }) => Buffer.from(bytes.subarray(start, end)).toString("utf8"),
    words: (text) => text,
  };
}

/**
 * A page's outline with nothing masked.
 *
 * @param html the page's text
 * @returns its outline
 */
function outlineOf({ html }: { html: string }): readonly PageHeading[] {
  const bytes = Buffer.from(html, "utf8");
  return pageOutline({ bytes, mask: unmasked({ bytes }) }).headings;
}

/**
 * Whether a page's outline says a heading was left out.
 *
 * @param html the page's text
 * @returns the cut flag
 */
function cutOf({ html }: { html: string }): boolean {
  const bytes = Buffer.from(html, "utf8");
  return pageOutline({ bytes, mask: unmasked({ bytes }) }).cut;
}

/**
 * A page of `count` headings at one level.
 *
 * @param level the heading level
 * @param count how many
 * @returns the markup
 */
function headings({ level, count }: { level: number; count: number }): string {
  return Array.from({ length: count }, (_, at) => `<h${String(level)}>H${String(at)}</h${String(level)}>`).join("");
}

describe("pageOutline", () => {
  it("names every h1 to h3 in order with the byte offset its tag opens at, attributes and case aside", () => {
    const html = '<h1>Title</h1>\n<p>x</p>\n<H2 id="options">Options</H2>\n<h3>A. One</h3>\n<h4>skip</h4>';
    expect(outlineOf({ html })).toEqual([
      { from: 0, level: 1, text: "Title" },
      { from: 24, level: 2, text: "Options" },
      { from: 54, level: 3, text: "A. One" },
    ]);
    expect(html.slice(24, 28)).toBe("<H2 ");
    expect(html.slice(54, 58)).toBe("<h3>");
  });

  it("counts offsets in UTF-8 bytes, so a multi-byte character before a heading moves it", () => {
    const before = "<p>“quoted” — dash</p>";
    const html = `${before}<h2>Next</h2>`;
    const outline = outlineOf({ html });
    expect(outline).toEqual([{ from: Buffer.byteLength(before, "utf8"), level: 2, text: "Next" }]);
    expect(outline[0]!.from).toBe(before.length + 6);
    expect(
      Buffer.from(html, "utf8")
        .subarray(outline[0]!.from, outline[0]!.from + 4)
        .toString("utf8"),
    ).toBe("<h2>");
  });

  it("counts a byte-order mark and an invalid byte as the bytes they are", () => {
    // Decoded first, the mark was stripped and the invalid byte widened to U+FFFD.
    const bytes = Buffer.concat([
      Buffer.from([0xef, 0xbb, 0xbf]),
      Buffer.from("<h1>Title</h1><p>", "utf8"),
      Buffer.from([0xe9]),
      Buffer.from("</p><h2>Café</h2>", "utf8"),
    ]);
    const outline = pageOutline({ bytes, mask: unmasked({ bytes }) }).headings;
    expect(outline).toEqual([
      { from: 3, level: 1, text: "Title" },
      { from: 25, level: 2, text: "Café" },
    ]);
    expect(bytes.subarray(3, 7).toString("latin1")).toBe("<h1>");
    expect(bytes.subarray(25, 29).toString("latin1")).toBe("<h2>");
  });

  it("strips inner tags, decodes the five entities once and collapses whitespace", () => {
    const html = "<h2>Your script + yaml &amp; <code>CI</code>\n   &quot;alt&quot; &#39;x&#39; &lt;b&gt; &amp;lt;</h2>";
    expect(outlineOf({ html })[0]!.text).toBe(`Your script + yaml & CI "alt" 'x' <b> &lt;`);
  });

  it("reads a control character as a space, so no heading costs JSON more than two characters per one", () => {
    const html = `<h2>a\u0001b\u007f\u0085c\u0000</h2><h2>${"\u0001".repeat(80)}</h2>`;
    const outline = outlineOf({ html });
    expect(outline).toEqual([{ from: 0, level: 2, text: "a b c" }]);
    expect(JSON.stringify(outline[0]!.text)).toBe('"a b c"');
  });

  it("never reads a heading out of a style block, a script block or a comment", () => {
    const html =
      "<style>.x::after { content: '<h2>no</h2>'; }</style><script>'<h1>no</h1>'</script><!-- <h3>no</h3> --><h2>Yes</h2>";
    expect(outlineOf({ html }).map((entry) => entry.text)).toEqual(["Yes"]);
  });

  it("cuts a long heading to the cap in code points, with nothing appended", () => {
    const text = outlineOf({ html: `<h2>${"😀".repeat(200)}</h2>` })[0]!.text;
    expect(Array.from(text).length).toBe(PAGE_OUTLINE_TEXT_MAX_CHARS);
    expect(text).toBe("😀".repeat(PAGE_OUTLINE_TEXT_MAX_CHARS));
  });

  it("hands the mask a heading's WHOLE markup as a byte span, then its whole shown words, and cuts what it returns", () => {
    const secret = "q".repeat(PAGE_OUTLINE_TEXT_MAX_CHARS + 20);
    const bytes = Buffer.from(`<p>é</p><h1 id="k">key <b>${secret}</b></h1>`, "utf8");
    const spans: { start: number; end: number }[] = [];
    const words: string[] = [];
    const outline = pageOutline({
      bytes,
      mask: {
        markup: (span) => {
          spans.push(span);
          return unmasked({ bytes }).markup(span).replace(secret, "[redacted]");
        },
        words: (text) => {
          words.push(text);
          return text;
        },
      },
    }).headings;
    expect(spans).toEqual([{ end: 20 + 11 + secret.length, start: 20 }]);
    expect(bytes.subarray(20, 20 + 11 + secret.length).toString("utf8")).toBe(`key <b>${secret}</b>`);
    expect(words).toEqual(["key [redacted]"]);
    expect(outline).toEqual([{ from: 9, level: 1, text: "key [redacted]" }]);
  });

  it("masks only the headings it keeps", () => {
    const html = headings({ count: PAGE_OUTLINE_MAX_ENTRIES + 4, level: 3 });
    const bytes = Buffer.from(html, "utf8");
    let masked = 0;
    const outline = pageOutline({
      bytes,
      mask: {
        markup: (span) => {
          masked += 1;
          return unmasked({ bytes }).markup(span);
        },
        words: (text) => text,
      },
    }).headings;
    expect(outline.length).toBe(PAGE_OUTLINE_MAX_ENTRIES);
    expect(masked).toBe(PAGE_OUTLINE_MAX_ENTRIES);
  });

  it("says a heading was left out only when the page has one past the cap", () => {
    expect(cutOf({ html: headings({ count: PAGE_OUTLINE_MAX_ENTRIES, level: 3 }) })).toBe(false);
    expect(cutOf({ html: headings({ count: PAGE_OUTLINE_MAX_ENTRIES + 1, level: 3 }) })).toBe(true);
    expect(cutOf({ html: headings({ count: PAGE_OUTLINE_MAX_ENTRIES + 1, level: 1 }) })).toBe(true);
  });

  it("does not count a heading with no shown words as one left out", () => {
    const html = `${headings({ count: PAGE_OUTLINE_MAX_ENTRIES, level: 2 })}<h2>   </h2>`;
    expect(cutOf({ html })).toBe(false);
  });

  it("keeps the h3s when the page has exactly the cap of headings", () => {
    const outline = outlineOf({ html: headings({ count: PAGE_OUTLINE_MAX_ENTRIES, level: 3 }) });
    expect(outline.length).toBe(PAGE_OUTLINE_MAX_ENTRIES);
    expect(outline.every((entry) => entry.level === 3)).toBe(true);
  });

  it("keeps every top-level section past the cap and fills the slots left with the first h3s, in page order", () => {
    const sections = Array.from(
      { length: 6 },
      (_, at) =>
        `<h2>S${String(at)}</h2>${["a", "b", "c", "d", "e"].map((s) => `<h3>${String(at)}${s}</h3>`).join("")}`,
    );
    const outline = outlineOf({ html: sections.join("") });
    expect(outline.map((entry) => entry.text)).toEqual([
      "S0",
      "0a",
      "0b",
      "0c",
      "0d",
      "0e",
      "S1",
      "1a",
      "1b",
      "1c",
      "1d",
      "1e",
      "S2",
      "S3",
      "S4",
      "S5",
    ]);
  });

  it("gives a page of only h3s past the cap its first ones, never an empty outline", () => {
    const outline = outlineOf({ html: headings({ count: PAGE_OUTLINE_MAX_ENTRIES + 1, level: 3 }) });
    expect(outline.map((entry) => entry.text)).toEqual(
      Array.from({ length: PAGE_OUTLINE_MAX_ENTRIES }, (_, at) => `H${String(at)}`),
    );
  });

  it("leaves the h3s out once the top-level headings alone fill the cap, wherever the h3s sit", () => {
    const html = `<h3>first</h3>${headings({ count: PAGE_OUTLINE_MAX_ENTRIES, level: 1 })}`;
    const outline = outlineOf({ html });
    expect(outline.length).toBe(PAGE_OUTLINE_MAX_ENTRIES);
    expect(outline.every((entry) => entry.level === 1)).toBe(true);
  });

  it("cuts a page of only top-level headings past the cap to the first ones", () => {
    const outline = outlineOf({ html: headings({ count: PAGE_OUTLINE_MAX_ENTRIES * 4, level: 2 }) });
    expect(outline.length).toBe(PAGE_OUTLINE_MAX_ENTRIES);
    expect(outline.at(-1)!.text).toBe(`H${String(PAGE_OUTLINE_MAX_ENTRIES - 1)}`);
  });

  it("sheds the last heading of the deepest level first, keeping page order", () => {
    const outline = outlineOf({ html: "<h1>T</h1><h2>A</h2><h3>a1</h3><h3>a2</h3><h2>B</h2>" });
    const once = outlineShortened({ outline });
    expect(once.map((entry) => entry.text)).toEqual(["T", "A", "a1", "B"]);
    const thrice = outlineShortened({ outline: outlineShortened({ outline: once }) });
    expect(thrice.map((entry) => entry.text)).toEqual(["T", "A"]);
    expect(outlineShortened({ outline: [] })).toEqual([]);
  });

  it("is empty for a page with no headings, and skips an empty one", () => {
    expect(outlineOf({ html: "<p>nothing</p><h2> <b></b> </h2>" })).toEqual([]);
  });
});
