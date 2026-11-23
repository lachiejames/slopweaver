import { parseFragment } from "parse5";
import { describe, expect, it } from "vitest";

import { annotates, childrenOf, conceals, isElement, shownChildren } from "../../../prformat/drawnNodes.js";

/** The element nodes a fragment parses to, in order. */
function elementsOf({ html }: { html: string }): readonly string[] {
  return childrenOf({ node: parseFragment(html) }).map((node) => (isElement(node) ? node.tagName : node.nodeName));
}

describe("drawnNodes", () => {
  it("reads a template's inert content as its children", () => {
    const [template] = childrenOf({ node: parseFragment("<template><b>x</b></template>") });
    expect(childrenOf({ node: template! }).map((node) => node.nodeName)).toStrictEqual(["b"]);
  });

  it("hides what carries hidden, a template and an <rp>, and annotates with an <rt> alone", () => {
    const nodes = childrenOf({
      node: parseFragment("<span hidden>a</span><template>b</template><rp>(</rp><rt>c</rt><span>d</span>"),
    });
    expect(nodes.map((node) => [conceals({ node }), annotates({ node })])).toStrictEqual([
      [true, false],
      [true, false],
      [true, false],
      [false, true],
      [false, false],
    ]);
  });

  it("shows a closed <details> as its first <summary> alone, and an open one whole", () => {
    const shown = [
      "<details><summary>a</summary><summary>b</summary>c</details>",
      "<details open><summary>a</summary>c</details>",
    ].map((html) => shownChildren({ node: childrenOf({ node: parseFragment(html) })[0]! }).length);
    expect(shown).toStrictEqual([1, 2]);
  });

  it("tells an element from text", () => {
    expect(elementsOf({ html: "a<b>c</b>" })).toStrictEqual(["#text", "b"]);
  });
});
