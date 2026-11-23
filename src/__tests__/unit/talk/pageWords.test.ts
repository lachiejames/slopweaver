/*
 * A briefing's words as the voice is handed them (`src/talk/pageWords.ts`): the voice
 * once read raw markup in 10 KiB windows and the page shell's style block alone ate most of the first one.
 */
import { describe, expect, it } from "vitest";

import { pageWords } from "../../../talk/pageWords.js";

describe("pageWords", () => {
  it("keeps the body's words and drops the head, its style and every script", () => {
    const html =
      "<!doctype html><html><head><title>t</title><style>body{color:red}</style></head>" +
      "<body><h1>Storage key</h1><script>alert(1)</script><p>Read it <b>whole</b>.</p></body></html>";
    expect(pageWords({ html })).toBe("Storage key\nRead it whole.");
  });

  it("reads list items as bullets, table cells as columns and an image as its alt text", () => {
    const html =
      '<ul><li>one</li><li>two</li></ul><table><tr><td>a</td><td>b</td></tr></table><img src="x.png" alt="the orb">';
    expect(pageWords({ html })).toBe("- one\n- two\na | b |\n[image: the orb]");
  });

  it("decodes entities once, so an escaped entity reads as written", () => {
    expect(pageWords({ html: "<p>a &amp;lt; b &mdash; &#8217;s &#x2192; &bogus;</p>" })).toBe(
      "a &lt; b — ’s → &bogus;",
    );
  });

  // A `<` HTML reads as text was cut out with everything up to the next `>`, and the read called whole.
  it("keeps a visible < and > as words, cutting only what HTML itself opens as a tag", () => {
    expect(pageWords({ html: "<p>Comparison: 2 < 3 > 1.</p><p>x <3 y</p>" })).toBe("Comparison: 2 < 3 > 1.\nx <3 y");
    expect(pageWords({ html: "<p>a <b>bold</b> <?pi?> c</p>" })).toBe("a bold c");
  });

  // A block element off a hand-written list ran two lines of words together.
  it("breaks a line at every element that is not inline, so no two blocks' words are joined", () => {
    expect(pageWords({ html: "<address>First</address><address>Second</address><x-note>Third</x-note>" })).toBe(
      "First\nSecond\nThird",
    );
    expect(pageWords({ html: "<p>a <em>b</em><code>c</code> d</p>" })).toBe("a bc d");
  });

  // A named entity off a hand-written list reached the voice as markup spelling.
  it("decodes every entity HTML names, not only a list of them", () => {
    expect(pageWords({ html: "<p>Copyright &copy; 2026 &euro;5 &frac12; &NotEqualTilde;</p>" })).toBe(
      "Copyright © 2026 €5 ½ ≂̸",
    );
  });

  it("keeps no blank line between blocks and drops a comment", () => {
    expect(pageWords({ html: "<p>one</p><!-- hidden --><div></div><div></div><p>two</p>" })).toBe("one\ntwo");
  });

  // CodeQL alert 147 (js/incomplete-multi-character-sanitization): nothing is removed and re-joined, since the parser
  // reads the halves as a browser does — `<scr<script>` is one element of that odd name, its text shown.
  it("never re-forms a tag from the halves either side of a removed block", () => {
    expect(pageWords({ html: "<p>ok</p><scr<script>x</script>ipt>evil()</script><p>end</p>" })).toBe(
      "ok\nxipt>evil()\nend",
    );
    expect(pageWords({ html: "<p>ok</p><!<!-- a -->-- b --><p>end</p>" })).toBe("ok\n-- b -->\nend");
  });

  // A browser reads an unclosed script or comment to the end of the page, never as words.
  it("reads nothing after a script or comment that is never closed", () => {
    expect(pageWords({ html: "<body><p>Visible</p><script>HIDDEN IN SCRIPT</body></html>" })).toBe("Visible");
    expect(pageWords({ html: "<p>Visible</p><!-- HIDDEN IN COMMENT <p>more</p>" })).toBe("Visible");
    expect(pageWords({ html: "<html><head><title>HEAD ONLY</title><body><p>Visible</p>" })).toBe("Visible");
    expect(pageWords({ html: "<html><head><title>HEAD ONLY</title>" })).toBe("");
    expect(pageWords({ html: "<script>a</script><p>between</p><script>b</script><p>after</p>" })).toBe(
      "between\nafter",
    );
  });

  it("is empty for a page with no words", () => {
    expect(
      pageWords({ html: "<html><head><style>x{}</style></head><body><svg><text>x</text></svg></body></html>" }),
    ).toBe("");
  });
});
