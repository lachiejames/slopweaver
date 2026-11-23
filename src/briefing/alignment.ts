/**
 * The reader half of the forced alignment line: does this page state what the fleet is actually working
 * against what the board says is most urgent, and does it state it in one breath?
 *
 * `../outbound/briefing/schema.ts` makes the field non-optional, so a page RENDERED from the form always
 * carries one. This exists for the other direction — a page a session hand-wrote, or an older page being
 * re-checked — because the two halves of this gate have to agree about what a briefing must contain. Without
 * it, `briefing check` would pass a hand-written page missing the one section the whole mechanism is about,
 * and the mechanism would be exactly as skippable as the prose it replaced.
 *
 * ## Absence is the defect this is FOR
 *
 * Every other rule in this gate refuses something a composer wrote. This one refuses something a composer
 * did not write, which is the only shape that can catch a sweep quietly dropping the comparison — and
 * dropping it is precisely what a session under time pressure will do, because nothing above it hurts.
 *
 * Pure: HTML in, defects out.
 */
import { ALIGNMENT_MAX_SENTENCES, ALIGNMENT_MAX_WORDS } from "./caps.js";
import { aboveFoldText, sentenceCount, wordCount } from "./text.js";

/** Which alignment rule the page broke. */
type AlignmentRule = "missing" | "empty" | "words" | "sentences";

/** One alignment defect the page carries. */
interface AlignmentDefect {
  readonly rule: AlignmentRule;
  readonly reason: string;
}

/** What checking one artifact's alignment line found. */
export interface AlignmentCheck {
  /** The words the line puts above the fold, zero when there is no line. */
  readonly aboveFoldWords: number;
  readonly defects: readonly AlignmentDefect[];
}

/**
 * The alignment heading, attributes and all — see `./reactNowCard.ts`'s own heading for why.
 *
 * TWO spellings, and the older one is not deprecation debt. The heading "what we are actually working" is
 * not grammatical, so the page emits "what the fleet is working on". This file is part of the READER, so it has to judge the pages that
 * already exist as well as what `../outbound/briefing/render.ts` emits today — matching only the new text
 * would report every page rendered before the rename as carrying no alignment block at all.
 */
const ALIGNMENT_HEADING = /<h2[^>]*>\s*(?:what we are actually working|what the fleet is working on)\s*<\/h2>/i;
const ANY_H2_OPEN = /<h2[ >]/i;

/**
 * The markup between the alignment heading and the next `<h2>`, absent when the page carries no such
 * heading.
 *
 * Same extraction `./reactNowCard.ts`'s `reactNowRegion` makes, and deliberately the same shape rather than
 * a shared helper: the two regions are found by different headings and a generalised "region by heading"
 * helper would invite a third caller to point it at a heading the page does not actually structure by.
 *
 * @internal — the region {@link checkAlignment} measures; no caller outside this module names it.
 *
 * @param html the whole artifact file
 * @returns the block, or `undefined` when the heading is absent
 */
export function alignmentRegion({ html }: { html: string }): string | undefined {
  const heading = ALIGNMENT_HEADING.exec(html);
  if (heading === null) {
    return undefined;
  }
  const after = html.slice(heading.index + heading[0].length);
  const next = ANY_H2_OPEN.exec(after);
  return next === null ? after : after.slice(0, next.index);
}

/**
 * Check one fleet-briefing artifact's alignment line.
 *
 * @param html the whole artifact file
 * @returns the line's above-the-fold word count and one defect per rule broken
 */
export function checkAlignment({ html }: { html: string }): AlignmentCheck {
  const block = alignmentRegion({ html });
  if (block === undefined) {
    return {
      aboveFoldWords: 0,
      defects: [
        {
          reason:
            "the page carries no alignment block. Every briefing states what the fleet is actually working " +
            "against the board's top rows — run `slopweaver handover reconcile` and put its headline here.",
          rule: "missing",
        },
      ],
    };
  }
  const text = aboveFoldText({ html: block });
  const words = wordCount({ text });
  if (words === 0) {
    return {
      aboveFoldWords: 0,
      defects: [
        {
          reason: "the alignment block is empty above the fold — the comparison is the part the owner has to read.",
          rule: "empty",
        },
      ],
    };
  }
  const defects: AlignmentDefect[] = [];
  if (words > ALIGNMENT_MAX_WORDS) {
    defects.push({
      reason:
        `the alignment line runs to ${String(words)} words, over the cap of ${String(ALIGNMENT_MAX_WORDS)}. ` +
        "It is a generated sentence — fold anything you added to it.",
      rule: "words",
    });
  }
  const sentences = sentenceCount({ text });
  if (sentences > ALIGNMENT_MAX_SENTENCES) {
    defects.push({
      reason:
        `the alignment line runs to ${String(sentences)} sentences, over the cap of ` +
        `${String(ALIGNMENT_MAX_SENTENCES)}.`,
      rule: "sentences",
    });
  }
  return { aboveFoldWords: words, defects };
}
