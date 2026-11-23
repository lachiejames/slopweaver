import { describe, expect, it } from "vitest";

import type { ProposalBlock } from "../../../../../outbound/proposal/lint/blocks.js";
import {
  hasStrawman,
  hasTableOfContents,
  heroImageInTopThird,
  imagesClusteredAtEnd,
  invitesPushback,
  sectionOrder,
} from "../../../../../outbound/proposal/lint/structure.js";

/** Blocks from `[type, text]` pairs, each on the line after the last. */
const blocksOf = ({ specs }: { specs: readonly (readonly [ProposalBlock["type"], string])[] }): ProposalBlock[] =>
  specs.map(([type, text], index) => ({ line: index + 1, text, type }));

/** `count` plain paragraphs carrying no figure. */
const paras = ({ count }: { count: number }): (readonly [ProposalBlock["type"], string])[] =>
  Array.from({ length: count }, () => ["paragraph", "words only"] as const);

const NO_HERO = {
  message:
    "no hero proof shot in the top third. A document carrying figures opens 'What the data shows' with a " +
    "cropped, annotated shot, so the finding is visible before the prose argues for it.",
  rule: "no-hero-image",
  severity: "blocker",
};

describe("heroImageInTopThird", () => {
  it("accepts an image at index 1 of six blocks and refuses one at index 2, the top-third edge", () => {
    const inside = blocksOf({ specs: [...paras({ count: 1 }), ["image", "![a](a.png)"], ...paras({ count: 4 })] });
    const outside = blocksOf({ specs: [...paras({ count: 2 }), ["image", "![a](a.png)"], ...paras({ count: 3 })] });
    expect(heroImageInTopThird({ blocks: inside })).toBeUndefined();
    expect(heroImageInTopThird({ blocks: outside })).toEqual(NO_HERO);
  });

  it("expects a hero for a percentage, a three-digit number and a unit-bearing number, but not a bare two-digit one", () => {
    expect(heroImageInTopThird({ blocks: blocksOf({ specs: [["paragraph", "rose 40 %"]] }) })).toEqual(NO_HERO);
    expect(heroImageInTopThird({ blocks: blocksOf({ specs: [["paragraph", "took 120 runs"]] }) })).toEqual(NO_HERO);
    expect(heroImageInTopThird({ blocks: blocksOf({ specs: [["paragraph", "p99 is 15ms"]] }) })).toEqual(NO_HERO);
    expect(heroImageInTopThird({ blocks: blocksOf({ specs: [["paragraph", "about 42 of them"]] }) })).toBeUndefined();
  });

  it("finds nothing in an empty document", () => {
    expect(heroImageInTopThird({ blocks: [] })).toBeUndefined();
  });
});

describe("imagesClusteredAtEnd", () => {
  it("refuses images that all trail the last prose block, pointing at the first trailing image's line", () => {
    const blocks = blocksOf({
      specs: [
        ["paragraph", "claim"],
        ["image", "![a](a.png)"],
        ["image", "![b](b.png)"],
      ],
    });
    expect(imagesClusteredAtEnd({ blocks })).toEqual({
      line: 2,
      message: "every image is a trailing appendix. Each shot sits inline beside the exact claim it backs.",
      rule: "images-clustered-at-end",
      severity: "blocker",
    });
  });

  it("accepts an image interleaved with prose, a document of only images, and one with no images", () => {
    const interleaved = blocksOf({
      specs: [
        ["paragraph", "a"],
        ["image", "![a](a.png)"],
        ["paragraph", "b"],
      ],
    });
    const onlyImages = blocksOf({ specs: [["image", "![a](a.png)"]] });
    const noImages = blocksOf({ specs: [["paragraph", "a"]] });
    expect(imagesClusteredAtEnd({ blocks: interleaved })).toBeUndefined();
    expect(imagesClusteredAtEnd({ blocks: onlyImages })).toBeUndefined();
    expect(imagesClusteredAtEnd({ blocks: noImages })).toBeUndefined();
  });
});

describe("hasStrawman", () => {
  const NO_STRAWMAN = {
    line: 1,
    message:
      "no strawman blockquote up top. Open with the italic line that says this is still iterating and the " +
      "short version is in Slack, so it does not read as a finished answer nobody may argue with.",
    rule: "no-strawman",
    severity: "warning",
  };

  it("accepts a strawman blockquote at index 3 and refuses the same one at index 4", () => {
    const atThree = blocksOf({ specs: [...paras({ count: 3 }), ["blockquote", "a rough cut"]] });
    const atFour = blocksOf({ specs: [...paras({ count: 4 }), ["blockquote", "a rough cut"]] });
    expect(hasStrawman({ blocks: atThree })).toBeUndefined();
    expect(hasStrawman({ blocks: atFour })).toEqual(NO_STRAWMAN);
  });

  it("refuses a marker phrase in a paragraph rather than a blockquote, and a blockquote with no marker", () => {
    expect(hasStrawman({ blocks: blocksOf({ specs: [["paragraph", "a rough cut"]] }) })).toEqual(NO_STRAWMAN);
    expect(hasStrawman({ blocks: blocksOf({ specs: [["blockquote", "the final answer"]] }) })).toEqual(NO_STRAWMAN);
  });
});

describe("hasTableOfContents", () => {
  const NO_TOC = {
    message:
      'no <table_of_contents color="gray"/> block. Notion renders that into a live contents list; a hand-written one goes stale.',
    rule: "no-table-of-contents",
    severity: "warning",
  };

  it("accepts a typed toc block and a literal toc tag at the start of a block's text", () => {
    expect(hasTableOfContents({ blocks: blocksOf({ specs: [["toc", ""]] }) })).toBeUndefined();
    expect(
      hasTableOfContents({ blocks: blocksOf({ specs: [["paragraph", '<table_of_contents color="gray"/>']] }) }),
    ).toBeUndefined();
  });

  it("refuses a toc tag that does not open the block, and a document with none", () => {
    expect(
      hasTableOfContents({ blocks: blocksOf({ specs: [["paragraph", "see <table_of_contents/> below"]] }) }),
    ).toEqual(NO_TOC);
    expect(hasTableOfContents({ blocks: [] })).toEqual(NO_TOC);
  });
});

describe("invitesPushback", () => {
  it("accepts an invitation anywhere in the text and refuses a document with none", () => {
    expect(
      invitesPushback({
        blocks: blocksOf({
          specs: [
            ["paragraph", "intro"],
            ["paragraph", "Tell me where I'm off"],
          ],
        }),
      }),
    ).toBeUndefined();
    expect(invitesPushback({ blocks: blocksOf({ specs: [["paragraph", "This is the answer."]] }) })).toEqual({
      message:
        "nothing here invites a reader to push back. Frame it as putting the idea up to get shot at, not as a " +
        "finished FAQ.",
      rule: "dictate-not-invite",
      severity: "warning",
    });
  });
});

describe("sectionOrder", () => {
  it("accepts every golden section in order with an extra heading between them", () => {
    const blocks = blocksOf({
      specs: [
        ["heading", "TL;DR"],
        ["heading", "What the data shows"],
        ["heading", "An aside"],
        ["heading", "The fix"],
        ["heading", "Scope and tradeoffs"],
        ["heading", "Open questions"],
      ],
    });
    expect(sectionOrder({ blocks })).toBeUndefined();
  });

  it("names every missing section, and does not count a matching paragraph as a heading", () => {
    const blocks = blocksOf({
      specs: [
        ["heading", "TLDR"],
        ["paragraph", "The fix"],
        ["heading", "Open questions"],
      ],
    });
    expect(sectionOrder({ blocks })).toEqual({
      message: "missing golden section(s): data, fix, scope. The order is tldr → data → fix → scope → questions.",
      rule: "section-missing",
      severity: "blocker",
    });
  });

  it("names the first section out of the golden order", () => {
    const blocks = blocksOf({
      specs: [
        ["heading", "TL;DR"],
        ["heading", "The fix"],
        ["heading", "What the data shows"],
        ["heading", "Scope and trade-offs"],
        ["heading", "Open questions"],
      ],
    });
    expect(sectionOrder({ blocks })).toEqual({
      message: 'section "fix" is out of the golden order. Expected tldr → data → fix → scope → questions.',
      rule: "section-order",
      severity: "blocker",
    });
  });
});
