/**
 * What a QUOTED fold is exempt from on the rendered page, and what it is emphatically not.
 *
 * Every assertion here is falsifiable in the one way that matters: the input CARRIES the thing being called
 * absent. A composed copy of the same words is asserted to REFUSE in the same test, so an exemption that
 * quietly grew to cover the whole page would redden rather than pass.
 */
import { describe, expect, it } from "vitest";

import { checkBareRefs } from "../../../briefing/bareRef.js";
import { checkPageBudget } from "../../../briefing/pageBudget.js";
import { withoutQuoted } from "../../../briefing/text.js";

/** One note, with its fold marked as a record or left as composed prose. */
function note({ words, quoted }: { words: string; quoted: boolean }): string {
  const role = quoted ? ' data-section="quoted"' : "";
  return (
    '<div class="need"><div class="q">what was recorded ' +
    `<details${role}><summary>each one, as recorded</summary><div><p>${words}</p></div></details></div></div>`
  );
}

/** A whole page around one note, with the headings the readers find their regions by. */
function page({ body }: { body: string }): string {
  return ["<main>", "<h1>Fleet Briefing</h1>", "<h2>done since you last looked</h2>", body, "</main>"].join("\n");
}

describe("removing the quoted folds from a page", () => {
  it("takes the fold's contents out and leaves everything around it", () => {
    const stripped = withoutQuoted({ html: page({ body: note({ quoted: true, words: "their own sentence" }) }) });

    expect(stripped).toContain("what was recorded");
    expect(stripped).toContain("Fleet Briefing");
    expect(stripped).not.toContain("their own sentence");
    expect(stripped).not.toContain("each one, as recorded");
  });

  it("leaves a composed fold exactly where it is", () => {
    const composed = page({ body: note({ quoted: false, words: "a sentence a session wrote" }) });

    expect(withoutQuoted({ html: composed })).toBe(composed);
  });
});

describe("the page budgets over a record", () => {
  const packed = "they wrote 1. this 2. that 3. and the other";

  it("refuses a packed enumeration a session composed", () => {
    const budget = checkPageBudget({ html: page({ body: note({ quoted: false, words: packed }) }) });

    expect(budget.defects.map((defect) => defect.budget)).toEqual(["packed-enumeration"]);
  });

  it("passes the identical words inside a quoted fold", () => {
    const budget = checkPageBudget({ html: page({ body: note({ quoted: true, words: packed }) }) });

    expect(budget.defects).toEqual([]);
  });

  it("refuses a composed run cut with an ellipsis, and passes a recorded one", () => {
    const cut = "they trailed off…";

    expect(checkPageBudget({ html: page({ body: note({ quoted: false, words: cut }) }) }).defects.length).toBe(1);
    expect(checkPageBudget({ html: page({ body: note({ quoted: true, words: cut }) }) }).defects).toEqual([]);
  });
});

describe("the bare-reference scan over a record", () => {
  // No repository link anywhere on these pages, so the reference resolves against nothing — which is the
  // shape the scan actually refuses, and the one a recorded turn citing another repo's ticket would hit.
  const bare = "look at #728 again";

  it("refuses a bare reference a session composed", () => {
    const html = page({ body: note({ quoted: false, words: bare }) });

    expect(checkBareRefs({ html }).defects.length).toBeGreaterThan(0);
  });

  it("passes the identical reference inside a quoted fold", () => {
    const html = page({ body: note({ quoted: true, words: bare }) });

    expect(checkBareRefs({ html }).defects).toEqual([]);
  });

  it("still refuses one in the note's own HEADLINE, which the projection composed", () => {
    const html = page({
      body:
        '<div class="need"><div class="q">what #728 did ' +
        '<details data-section="quoted"><summary>as recorded</summary><div><p>their words</p></div></details>' +
        "</div></div>",
    });

    expect(checkBareRefs({ html }).defects.length).toBeGreaterThan(0);
  });
});
