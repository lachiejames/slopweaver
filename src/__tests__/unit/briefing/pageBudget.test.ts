import { describe, expect, it } from "vitest";

import { checkPageBudget } from "../../../briefing/pageBudget.js";

/** `count` blocks in the done section, each folded or not, as the real artifact renders them. */
function doneBlocks({ count, folded }: { count: number; folded: boolean }): string {
  const body = Array.from(
    { length: count },
    (_, i) => `<div class="need"><div class="q">landed ${String(i)}.</div></div>`,
  ).join("");
  return folded ? `<details><summary>older landings</summary>${body}</details>` : body;
}

/** A whole page: one short react-now card, then a done section of `count` blocks. */
function page({ count, folded }: { count: number; folded: boolean }): string {
  return (
    "<h1>Fleet Briefing</h1><h2>react now</h2>" +
    '<div class="need"><div class="q">1. Ship it?</div></div>' +
    `<h2>done since you last looked</h2>${doneBlocks({ count, folded })}`
  );
}

describe("checkPageBudget", () => {
  it("passes a page whose unfolded blocks and words are both inside budget", () => {
    const result = checkPageBudget({ html: page({ count: 5, folded: false }) });

    expect(result.unfoldedBlocks).toBe(5);
    expect(result.defects).toEqual([]);
  });

  it("refuses a page carrying more unfolded blocks than the cap", () => {
    const result = checkPageBudget({ html: page({ count: 6, folded: false }) });

    expect(result.defects).toEqual([
      {
        budget: "unfolded-blocks",
        reason:
          "6 blocks outside the react-now section sit outside a details fold, over the cap of 5. Keep the " +
          "newest few open and put the older ones inside a collapsed details, or drop them.",
      },
    ]);
  });

  it("counts a block inside a details fold as folded away", () => {
    const result = checkPageBudget({ html: page({ count: 200, folded: true }) });

    expect(result.unfoldedBlocks).toBe(0);
    expect(result.defects).toEqual([]);
  });

  it("never counts a react-now card against the unfolded-block budget", () => {
    const cards = Array.from({ length: 8 }, () => '<div class="need"><div class="q">1. Ship it?</div></div>').join("");
    const result = checkPageBudget({ html: `<h2>react now</h2>${cards}<h2>done</h2>` });

    expect(result.unfoldedBlocks).toBe(0);
  });

  it("refuses a page over the above-the-fold word budget", () => {
    const words = Array.from({ length: 1200 }, () => "alpha").join(" ");
    const result = checkPageBudget({ html: `<h2>react now</h2><h2>done</h2><p>${words}</p>` });

    expect(result.aboveFoldWords).toBe(1203);
    expect(result.defects).toEqual([
      {
        budget: "above-fold-words",
        reason:
          "the page puts 1203 words above the fold outside the react-now cards, over the cap of 1000 (done 1201, " +
          "react now 2). A page this long is one the owner scrolls past, so the parts they do read are the parts you " +
          "folded away.",
      },
    ]);
  });

  it("charges the react-now block's own words to no budget at all, however many cards it carries", () => {
    const words = Array.from({ length: 1200 }, () => "alpha").join(" ");
    const result = checkPageBudget({ html: `<h2>react now</h2><p>${words}</p><h2>done</h2>` });

    // Three: the two section headings' own words, and nothing at all from the 1,200 inside the block.
    expect(result.aboveFoldWords).toBe(3);
    expect(result.defects).toEqual([]);
  });

  it("refuses a react-now block over the card count the owner sized it at", () => {
    const cards = Array.from({ length: 51 }, () => '<div class="need"><div class="q">1. Ship it?</div></div>').join("");
    const result = checkPageBudget({ html: `<h2>react now</h2>${cards}<h2>done</h2>` });

    expect(result.reactNowCards).toBe(51);
    expect(result.defects).toEqual([
      {
        budget: "react-now-cards",
        reason:
          "react now carries 51 cards, over the cap of 50. A block that long has stopped being a list of " +
          "things to react to — land some of it, or fold it away.",
      },
    ]);
  });

  it("admits fifty cards, which is the block the owner asked for rather than the wall the budget refuses", () => {
    const cards = Array.from({ length: 50 }, () => '<div class="need"><div class="q">1. Ship it?</div></div>').join("");
    const result = checkPageBudget({ html: `<h2>react now</h2>${cards}<h2>done</h2>` });

    expect(result.reactNowCards).toBe(50);
    expect(result.defects).toEqual([]);
  });

  it("never counts the runtime's own style and script blocks", () => {
    const script = `<script>${Array.from({ length: 5000 }, () => "alpha").join(" ")}</script>`;
    const style = `<style>${Array.from({ length: 5000 }, () => "beta").join(" ")}</style>`;
    const result = checkPageBudget({ html: `${style}${script}<h2>react now</h2><h2>done</h2><p>one two three</p>` });

    expect(result.aboveFoldWords).toBe(6);
    expect(result.defects).toEqual([]);
  });

  it("refuses a run-on paragraph above the fold, naming the count and quoting the worst", () => {
    const runOn = "One. Two. Three. Four. Five. Six.";
    const result = checkPageBudget({ html: `<h2>react now</h2><p>${runOn}</p><p>A. B. C. D. E.</p><h2>done</h2>` });

    expect(result.defects).toEqual([
      {
        budget: "run-on-paragraph",
        reason:
          '2 paragraph(s) above the fold run past 4 sentences. The worst carries 6: "One. Two. Three. Four. ' +
          'Five. Six.". Break each one into its own paragraph, or fold it.',
      },
    ]);
  });

  it("never reads a folded paragraph as a run-on", () => {
    const runOn = "One. Two. Three. Four. Five. Six.";
    const html = `<h2>react now</h2><details><summary>more</summary><p>${runOn}</p></details><h2>done</h2>`;

    expect(checkPageBudget({ html }).defects).toEqual([]);
  });

  it("refuses a numbered list packed into one paragraph, folded or not", () => {
    const packed = "1. review the diff 2. run the gate 3. publish the page";
    const html = `<h2>react now</h2><details><summary>more</summary><p>${packed}</p></details><h2>done</h2>`;

    expect(checkPageBudget({ html }).defects).toEqual([
      {
        budget: "packed-enumeration",
        reason:
          '1 paragraph(s) pack a numbered list into running prose. The worst carries 3 numbers: "1. review ' +
          'the diff 2. run the gate 3. publish the page". A numbered set of items is a real list, one item ' +
          "per line, never numbers inside a paragraph.",
      },
    ]);
  });

  it("passes the same numbers as a real list, one item per line", () => {
    const list = "<ol><li>1. review the diff</li><li>2. run the gate</li><li>3. publish the page</li></ol>";

    expect(checkPageBudget({ html: `<h2>react now</h2>${list}<h2>done</h2>` }).defects).toEqual([]);
  });

  it("never reads an issue number or a version as an enumerator", () => {
    const prose = "<p>PR 16360 landed. It bumps 5.2.0 to 5.3.0, and closes 3 threads on 2 reviews.</p>";

    expect(checkPageBudget({ html: `<h2>react now</h2>${prose}<h2>done</h2>` }).defects).toEqual([]);
  });

  it("refuses a run cut with an ellipsis, above the fold", () => {
    const html = `<h2>react now</h2><p>Rotate the password now …</p><h2>done</h2>`;

    expect(checkPageBudget({ html }).defects).toEqual([
      {
        budget: "truncated-ellipsis",
        reason:
          '1 run(s) end in an ellipsis with nothing after it. The worst: "Rotate the password now …". A cut ' +
          "that drops the rest leaves it nowhere on the page to read — write the whole thing, and fold it " +
          "behind a `details` summary if it runs long.",
      },
    ]);
  });

  it("refuses the three-dot spelling of a truncating cut too", () => {
    const html = `<h2>react now</h2><p>Rotate the password now...</p><h2>done</h2>`;

    expect(checkPageBudget({ html }).defects.map((defect) => defect.budget)).toEqual(["truncated-ellipsis"]);
  });

  it("refuses an ellipsis-cut run even folded, since a fold cannot recover what was cut", () => {
    const html = `<h2>react now</h2><details><summary>more</summary><p>It landed as #100 …</p></details><h2>done</h2>`;

    expect(checkPageBudget({ html }).defects.map((defect) => defect.budget)).toEqual(["truncated-ellipsis"]);
  });

  it("never flags an ellipsis that is not the last thing in a run", () => {
    const html = `<h2>react now</h2><p>They said… and then left the room.</p><h2>done</h2>`;

    expect(checkPageBudget({ html }).defects).toEqual([]);
  });
});
