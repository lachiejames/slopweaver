/**
 * The block-POSITION and section-ORDER detectors — the traps prose-level checks cannot see.
 *
 * Every rule here is about where something sits rather than what it says: a hero shot buried at the bottom,
 * every image clustered into a trailing appendix, sections in an order that is not the golden order.
 *
 * ## Why these run at all when the renderer already guarantees them
 *
 * `proposal draft` writes the shape correctly by construction, so a freshly rendered document passes every
 * check here trivially. That is not wasted work: the draft is written to a FILE precisely so a person can
 * edit it, and `proposal publish` lints whatever is on disk rather than whatever the form said. These
 * detectors exist for the edited draft, not the generated one.
 *
 * Pure: blocks in, findings out.
 */
import type { ProposalBlock } from "./blocks.js";
import type { ProposalFinding } from "./findings.js";

/** A figure a reader would expect a citation for: a percentage, a unit-bearing number, or 3+ digits. */
const NUMERIC = /\b\d+(?:[.,]\d+)?\s*%|\b\d{3,}\b|\b\d+(?:[.,]\d+)?\s*(?:x|k|ms|s|hrs?|days?)\b/i;

/** The literal Notion table-of-contents block the golden shape opens with. */
const TOC_BLOCK = /^<table_of_contents\b/i;

/** Phrases that mark the opening blockquote as a discussion-opener rather than a finished answer. */
const STRAWMAN_MARKER = /rough|still iterating|shot at|not final|for agents|ask me anything|discussion/i;

/** Phrases that invite a reader to push back, so the doc does not read as a dictated FAQ. */
const INVITE =
  /tell me where|shot at|shoot holes|pull it apart|what do you reckon|open to|where i (?:have|.?ve) it wrong/i;

/** The golden section order, keyed. A heading maps to at most one key. */
const GOLDEN_SECTIONS: readonly (readonly [string, RegExp])[] = [
  ["tldr", /^tl;?dr\b/i],
  ["data", /what the data shows/i],
  ["fix", /^the fix\b/i],
  ["scope", /scope and trade-?offs/i],
  ["questions", /^open questions\b/i],
];

/** Whether the document carries a figure or a proof heading, so a hero shot is expected. */
function expectsHero({ blocks }: { blocks: readonly ProposalBlock[] }): boolean {
  return blocks.some((block) => block.type === "image") || blocks.some((block) => NUMERIC.test(block.text));
}

/**
 * HARD: a document with figures needs a cropped hero shot in its top third.
 *
 * @param blocks the parsed document
 * @returns the finding, or nothing
 */
export function heroImageInTopThird({ blocks }: { blocks: readonly ProposalBlock[] }): ProposalFinding | undefined {
  if (blocks.length === 0 || !expectsHero({ blocks })) {
    return undefined;
  }
  const firstImage = blocks.findIndex((block) => block.type === "image");
  const topThird = Math.max(1, Math.ceil(blocks.length / 3));
  if (firstImage !== -1 && firstImage < topThird) {
    return undefined;
  }
  return {
    message:
      "no hero proof shot in the top third. A document carrying figures opens 'What the data shows' with a " +
      "cropped, annotated shot, so the finding is visible before the prose argues for it.",
    rule: "no-hero-image",
    severity: "blocker",
  };
}

/**
 * HARD: at least one image must sit beside the claim it backs, rather than every image being an appendix.
 *
 * @param blocks the parsed document
 * @returns the finding, or nothing
 */
export function imagesClusteredAtEnd({ blocks }: { blocks: readonly ProposalBlock[] }): ProposalFinding | undefined {
  const imageIndexes = blocks.flatMap((block, index) => (block.type === "image" ? [index] : []));
  if (imageIndexes.length === 0) {
    return undefined;
  }
  const lastNonImage = blocks.reduce((last, block, index) => (block.type === "image" ? last : index), -1);
  if (lastNonImage === -1 || !imageIndexes.every((index) => index > lastNonImage)) {
    return undefined;
  }
  return {
    line: blocks[imageIndexes[0]!]!.line,
    message: "every image is a trailing appendix. Each shot sits inline beside the exact claim it backs.",
    rule: "images-clustered-at-end",
    severity: "blocker",
  };
}

/**
 * WARN: the document opens with the strawman blockquote that marks it as a discussion-opener.
 *
 * @param blocks the parsed document
 * @returns the finding, or nothing
 */
export function hasStrawman({ blocks }: { blocks: readonly ProposalBlock[] }): ProposalFinding | undefined {
  const head = blocks.slice(0, 4);
  if (head.some((block) => block.type === "blockquote" && STRAWMAN_MARKER.test(block.text))) {
    return undefined;
  }
  return {
    line: 1,
    message:
      "no strawman blockquote up top. Open with the italic line that says this is still iterating and the " +
      "short version is in Slack, so it does not read as a finished answer nobody may argue with.",
    rule: "no-strawman",
    severity: "warning",
  };
}

/**
 * WARN: the real Notion table-of-contents block, rather than a hand-written list of section names.
 *
 * @param blocks the parsed document
 * @returns the finding, or nothing
 */
export function hasTableOfContents({ blocks }: { blocks: readonly ProposalBlock[] }): ProposalFinding | undefined {
  if (blocks.some((block) => block.type === "toc" || TOC_BLOCK.test(block.text))) {
    return undefined;
  }
  return {
    message: `no ${'<table_of_contents color="gray"/>'} block. Notion renders that into a live contents list; a hand-written one goes stale.`,
    rule: "no-table-of-contents",
    severity: "warning",
  };
}

/**
 * WARN: nothing anywhere invites the reader to push back.
 *
 * @param blocks the parsed document
 * @returns the finding, or nothing
 */
export function invitesPushback({ blocks }: { blocks: readonly ProposalBlock[] }): ProposalFinding | undefined {
  if (INVITE.test(blocks.map((block) => block.text).join("\n"))) {
    return undefined;
  }
  return {
    message:
      "nothing here invites a reader to push back. Frame it as putting the idea up to get shot at, not as a " +
      "finished FAQ.",
    rule: "dictate-not-invite",
    severity: "warning",
  };
}

/**
 * HARD: every golden section is present, and in the golden order.
 *
 * A subsequence check over the headings the document actually has, so an extra heading is ignored rather
 * than treated as a violation — but a missing or reordered one is not.
 *
 * @param blocks the parsed document
 * @returns one finding, or nothing
 */
export function sectionOrder({ blocks }: { blocks: readonly ProposalBlock[] }): ProposalFinding | undefined {
  const expected = GOLDEN_SECTIONS.map(([key]) => key);
  const seen: string[] = [];
  for (const block of blocks) {
    if (block.type !== "heading") {
      continue;
    }
    const hit = GOLDEN_SECTIONS.find(([, matcher]) => matcher.test(block.text));
    if (hit !== undefined && !seen.includes(hit[0])) {
      seen.push(hit[0]);
    }
  }
  const missing = expected.filter((key) => !seen.includes(key));
  if (missing.length > 0) {
    return {
      message: `missing golden section(s): ${missing.join(", ")}. The order is ${expected.join(" → ")}.`,
      rule: "section-missing",
      severity: "blocker",
    };
  }
  const outOfOrder = seen.findIndex((key, index) => expected.indexOf(key) !== index);
  return outOfOrder === -1
    ? undefined
    : {
        message: `section "${seen[outOfOrder]!}" is out of the golden order. Expected ${expected.join(" → ")}.`,
        rule: "section-order",
        severity: "blocker",
      };
}
