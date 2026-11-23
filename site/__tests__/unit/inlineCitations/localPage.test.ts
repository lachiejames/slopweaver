import { describe, expect, it } from "vitest";

import { inlinePlain, inlineSegments, NO_CARD_REFERENCES, resolveInline } from "../../../lib/inlineCitations";

/*
 * An eval-harness ask card showed its HTML page as a plain text link rather than a chip. That card's page sat in its
 * recorded PROBLEM rather than its question, so it reached the card verbatim and only an `https://` address was ever
 * a chip there.
 */
describe("a local page's file:// address is its chip wherever a sentence names it", () => {
  const page = "file:///Users/someone/.slopweaver/pages/eval-harness-for-us-294-74/index.html";

  it("chips the eval-harness card's PROBLEM, page in brackets, as the page's slug", () => {
    const text = `A fleet change is only proven by waiting for the situation to recur, because nothing checks model behaviour today (page: ${page})`;
    expect(inlineSegments({ text })).toEqual([
      {
        kind: "text",
        text: "A fleet change is only proven by waiting for the situation to recur, because nothing checks model behaviour today (page: ",
      },
      { kind: "cite", label: "eval-harness-for-us-294-74", url: page },
      { kind: "text", text: ")" },
    ]);
  });

  it("leaves a sentence's closing full stop out, and keeps the page's own query and fragment in", () => {
    const anchored = "file:///u/.slopweaver/pages/alpha/index.html?tab=a|b#finding";
    expect(inlineSegments({ text: `open ${anchored}. Then ${page}.` })).toEqual([
      { kind: "text", text: "open " },
      { kind: "cite", label: "alpha", url: anchored },
      { kind: "text", text: ". Then " },
      { kind: "cite", label: "eval-harness-for-us-294-74", url: page },
      { kind: "text", text: "." },
    ]);
  });

  it("chips every spelling the page route accepts: an encoded slug, a dot segment, a capital scheme", () => {
    const encoded = "file:///Users/me/.slopweaver/pages/%41lpha/index.html";
    const dotted = "file:///Users/me/.slopweaver/pages/beta/./index.html";
    const capital = "FILE:///Users/me/.slopweaver/pages/gamma/index.html";
    expect(inlineSegments({ text: `open ${encoded}, then ${dotted}, then ${capital}.` })).toEqual([
      { kind: "text", text: "open " },
      { kind: "cite", label: "Alpha", url: encoded },
      { kind: "text", text: ", then " },
      { kind: "cite", label: "beta", url: dotted },
      { kind: "text", text: ", then " },
      { kind: "cite", label: "gamma", url: capital },
      { kind: "text", text: "." },
    ]);
  });

  it("leaves a file:// address that is not a published page as the words it is, reporting nothing inside it", () => {
    const text =
      "read file:///etc/passwd and file:///u/notes/index.html, not file:///u/pages/a%2Fb/index.html " +
      "nor file://remote-host/u/pages/secu-134/index.html, nor profile:///u/pages/alpha/index.html " +
      "nor prefix/file:///u/pages/alpha/index.html";
    expect(resolveInline({ known: [], references: NO_CARD_REFERENCES, text })).toEqual({
      segments: [{ kind: "text", text }],
      unlinked: [],
    });
  });

  it("folds the page to its slug where the sentence is itself a link", () => {
    expect(inlinePlain({ text: `see ${page}` })).toBe("see eval-harness-for-us-294-74");
  });
});
