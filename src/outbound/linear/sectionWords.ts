/**
 * The word cap on a Linear form's human-visible text, and the counter every Linear form measures it with.
 *
 * Its own module because the issue form, the comment form and both status-update forms all cap a region by
 * the same measured rule, and the counter is pure arithmetic over blocks: it carries no schema and refuses
 * nothing itself. `./schema.ts` decides which regions are capped and what the refusal says.
 */
import type { FreeformBlock } from "./types.js";

/**
 * How many words the rendered `## Problem` and `## Solution` sections may each carry.
 *
 * Matches a companion enforced guard elsewhere in the org (`packages/work-console/dist/guard/linearIssueFormat.js`),
 * measured against 12,508 real issue bodies, not invented here — see the `slopweaver-pr6-linear-write` memory.
 * This repo's own typed Linear form never enforced it: the schema shipped before rule 7 ("no walls of text,
 * ever, on any outbound surface") did, and was never revisited once rule 7 landed. Human supporting detail
 * belongs in a `details` fold and the agent brief in `aiPrompt`, both of which render collapsed — not in a
 * longer Problem or Solution.
 */
export const SECTION_MAX_WORDS = 50;

/**
 * A markdown link construct, greedy enough to span `label` and `url` but never a whole paragraph — the same
 * shape {@link countSectionWords} strips.
 *
 * The url group tolerates ONE level of balanced parens (`(?:[^()]|\([^()]*\))*`) rather than stopping at the
 * first `)`. A plain `[^)]*` — found BROKEN by an adversarial Codex review pass — treats a valid link whose
 * url itself contains a parenthesised segment (`[label](https://example.test/a(b))`, a real shape real URLs
 * take) as closing early, leaving the url's own trailing `)` behind as leftover text that then counts as a
 * word.
 *
 * The label group (`(?:[^\]\\]|\\.)*`) is escape-aware for the same reason — found BROKEN a second time,
 * separately: a plain `[^\]]*` stops at a backslash-ESCAPED `]` (`[la\]bel](url)`, a valid CommonMark link
 * whose label contains a literal `]`) as if it were the closing bracket, so the construct never matches at
 * all and survives unstripped.
 *
 * This is not a CommonMark parser and is not trying to be one: two levels of paren nesting, reference-style
 * links (`[label][ref]`), and anything else past what these two fixes cover is accepted as out of scope — no
 * measured real Linear body has needed it, and closing every markdown edge case by hand is a losing game a
 * real parser exists to end.
 */
const MARKDOWN_LINK = /\[(?:[^\]\\]|\\.)*\]\((?:[^()]|\([^()]*\))*\)/g;

/**
 * Word-count one string the way the real enforced guard does: a markdown link — `[label](url)`, brackets AND
 * url both — contributes ZERO words. This is the OPPOSITE of `src/prformat`'s GitHub counter, where a bare
 * link's label counts. The two rules are measured against two different real validators and genuinely
 * differ — do not merge them.
 *
 * @param text the raw text to count
 * @returns the word count after stripping every markdown link construct
 */
export function countSectionWords({ text }: { text: string }): number {
  return text
    .replace(MARKDOWN_LINK, " ")
    .split(/\s+/)
    .filter((word) => word.length > 0).length;
}

/**
 * Every word one block contributes to its section's cap — recursing into a bullet's nested blocks, because a
 * caller could otherwise dodge the cap by nesting the actual prose one level down. A `media` block's alt
 * text and a `code` block's verbatim content are excluded: neither is prose a reader is asked to read
 * through, the same reasoning GitHub's own Proof-notes cap uses for evidence and collapsed detail.
 *
 * @param block one section, freeform or nested block
 * @returns the words this block (and anything nested under it) contributes
 */
function wordsOfBlock({ block }: { block: FreeformBlock }): number {
  if (block.kind === "para" || block.kind === "heading") {
    return countSectionWords({ text: block.text });
  }
  if (block.kind === "media" || block.kind === "code") {
    return 0;
  }
  if (block.kind === "checklist") {
    return block.items.reduce((total, item) => total + countSectionWords({ text: item.text }), 0);
  }
  // `nested` is optional on a list item and never empty when present: an item with none adds only its own line.
  return block.items.reduce(
    (total, item) =>
      total +
      countSectionWords({ text: item.text }) +
      (item.nested === undefined ? 0 : wordsOfSection({ blocks: item.nested })),
    0,
  );
}

/**
 * Every word an ordered block array contributes to its section's cap.
 *
 * @param blocks the section's ordered blocks
 * @returns the total word count across every block
 */
export function wordsOfSection({ blocks }: { blocks: readonly FreeformBlock[] }): number {
  return blocks.reduce((total, block) => total + wordsOfBlock({ block }), 0);
}

/**
 * The refusal when a section is over {@link SECTION_MAX_WORDS}, naming the count, the cap and the way out.
 *
 * @param section the section name, for the message
 * @param words the section's measured word count
 * @returns the message
 */
export function sectionOverCapMessage({ section, words }: { section: string; words: number }): string {
  return (
    `${section} is ${String(words)} words, over the ${String(SECTION_MAX_WORDS)}-word cap — a ticket's ` +
    "human-visible section stays short by construction. Move the supporting detail into a details fold, " +
    "which renders collapsed, and the agent brief into aiPrompt."
  );
}
