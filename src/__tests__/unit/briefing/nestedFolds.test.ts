/**
 * A fold inside a fold, which is the shape `briefing render` produces and a lazy regex could not read.
 *
 * Both defects here were found by rendering a live briefing from a typed form and running the
 * shipped gate over the result: the page reported 149 unfolded blocks and 13,155 words above the fold when
 * every one of them sat inside a collapsed section, and it reported a packed enumeration nobody wrote. They
 * are two instances of the same mistake — a non-greedy match closing an element at the first close tag of
 * the same name it meets, which on a nested structure is a tag belonging to a CHILD.
 */
import { describe, expect, it } from "vitest";

import { checkPageBudget } from "../../../briefing/pageBudget.js";
import { balancedElement, unfolded } from "../../../briefing/text.js";

/** A page whose one section is folded, and whose entry inside it carries a fold of its own. */
function nestedPage({ entry }: { entry: string }): string {
  return (
    "<h2>react now</h2><h2>done</h2>" +
    "<details><summary>earlier today</summary><div>" +
    `<div class="need"><div class="q">${entry}</div></div>` +
    "</div></details>"
  );
}

describe("nested folds", () => {
  it("removes a whole outer fold, not just up to its first child's close tag", () => {
    const html = "before<details>a<details>b</details>c</details>after";

    expect(unfolded({ html }).replace(/\s+/g, "")).toBe("beforeafter");
  });

  it("returns the balanced element, and undefined when it never closes", () => {
    const html = "<details>a<details>b</details>c</details>tail";

    expect(balancedElement({ html, start: 0, tag: "details" })).toBe("<details>a<details>b</details>c</details>");
    expect(balancedElement({ html: "<details>a", start: 0, tag: "details" })).toBeUndefined();
  });

  it("counts a block inside a nested fold as folded, not as sitting above the fold", () => {
    const entry = "It landed. <details><summary>the rest</summary><div><p>Every detail.</p></div></details>";
    const result = checkPageBudget({ html: nestedPage({ entry }) });

    expect(result.unfoldedBlocks).toBe(0);
    // Three: the two `<h2>` headings, and nothing at all from inside the fold.
    expect(result.aboveFoldWords).toBe(3);
    expect(result.defects).toEqual([]);
  });

  it("does not weld a nested list's items into one packed-enumeration paragraph", () => {
    const list = "<ul><li>1. first thing</li><li>2. second thing</li><li>3. third thing</li></ul>";
    const entry = `The five, ranked. <details><summary>the detail</summary><div>${list}</div></details>`;

    expect(checkPageBudget({ html: nestedPage({ entry }) }).defects).toEqual([]);
  });

  it("still refuses a real packed enumeration inside a fold, so the fix did not blind the rule", () => {
    const entry =
      "The five, ranked. <details><summary>the detail</summary><div>" +
      "<p>Take 1) this 2) then 3) that.</p></div></details>";

    expect(checkPageBudget({ html: nestedPage({ entry }) }).defects.map((defect) => defect.budget)).toEqual([
      "packed-enumeration",
    ]);
  });
});
