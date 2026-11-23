import { describe, expect, it } from "vitest";

import { checkAlignment } from "../../../briefing/alignment.js";
import { ALIGNMENT_MAX_SENTENCES, ALIGNMENT_MAX_WORDS } from "../../../briefing/caps.js";

const HEADING = "<h2>what we are actually working</h2>";

/** A page carrying an alignment block with the given body, and a following section to close the region. */
function page({ body }: { body: string }): string {
  return `<h2>react now</h2><p>nothing open</p>${HEADING}${body}<h2>done since you last looked</h2><p>x</p>`;
}

/** A sentence of exactly `count` one-syllable words, ending in a full stop. */
function sentenceOfWords({ count }: { count: number }): string {
  return `${Array.from({ length: count }, () => "word").join(" ")}.`;
}

describe("checkAlignment", () => {
  it("passes a page whose alignment line states the comparison", () => {
    const result = checkAlignment({
      html: page({ body: `<p class="align">2 of 3 live sessions are on the board's top 5.</p>` }),
    });

    expect(result.defects).toEqual([]);
    expect(result.aboveFoldWords).toBe(11);
  });

  it("refuses a page with no alignment block at all — the defect that is an absence", () => {
    const result = checkAlignment({ html: `<h2>react now</h2><p>nothing open</p><h2>done</h2>` });

    expect(result.defects.map((defect) => defect.rule)).toEqual(["missing"]);
    expect(result.aboveFoldWords).toBe(0);
  });

  it("refuses an alignment heading with nothing under it", () => {
    const result = checkAlignment({ html: page({ body: "" }) });

    expect(result.defects.map((defect) => defect.rule)).toEqual(["empty"]);
  });

  it("refuses a line over the word cap, naming the count and the cap", () => {
    const result = checkAlignment({
      html: page({ body: `<p class="align">${sentenceOfWords({ count: ALIGNMENT_MAX_WORDS + 1 })}</p>` }),
    });

    expect(result.defects.map((defect) => defect.rule)).toEqual(["words"]);
    expect(result.defects[0]!.reason).toBe(
      `the alignment line runs to ${String(ALIGNMENT_MAX_WORDS + 1)} words, over the cap of ` +
        `${String(ALIGNMENT_MAX_WORDS)}. It is a generated sentence — fold anything you added to it.`,
    );
  });

  it("passes a line sitting exactly on the word cap", () => {
    const result = checkAlignment({
      html: page({ body: `<p class="align">${sentenceOfWords({ count: ALIGNMENT_MAX_WORDS })}</p>` }),
    });

    expect(result.defects).toEqual([]);
  });

  it("refuses a line over the sentence cap", () => {
    const body = `<p class="align">${Array.from({ length: ALIGNMENT_MAX_SENTENCES + 1 }, () => "One thing.").join(" ")}</p>`;
    const result = checkAlignment({ html: page({ body }) });

    expect(result.defects.map((defect) => defect.rule)).toEqual(["sentences"]);
  });

  it("ignores what a composer folded away, because rule 7 caps what a reader cannot avoid", () => {
    const fold = `<details><summary>which sessions</summary><div><p>${sentenceOfWords({ count: 200 })}</p></div></details>`;
    const result = checkAlignment({
      html: page({ body: `<p class="align">Two sessions are on the top five.${fold}</p>` }),
    });

    expect(result.defects).toEqual([]);
    expect(result.aboveFoldWords).toBe(7);
  });

  it("stops reading at the next heading, so the section below the line is not counted as alignment", () => {
    const result = checkAlignment({
      html: page({ body: `<p class="align">Two sessions are on the top five.</p>` }),
    });

    expect(result.aboveFoldWords).toBe(7);
  });
});
