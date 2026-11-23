/**
 * The form half of the page's above-the-fold word budget, measured region by region.
 *
 * A total alone was once the whole report, and a sweep pass lost forty minutes to it: the form
 * refused as "over the cap of 1000 words above the fold" while the page it would have rendered measured 297,
 * and the refusal named no number and no section, so the chair could not see what was being counted. The
 * regions are what make the refusal readable — which section carries the words, largest first.
 */
import { PAGE_ABOVE_FOLD_MAX_WORDS } from "../../briefing/caps.js";
import { wordCount } from "../../briefing/text.js";
import { autonomyRowAboveFoldWords } from "./autonomySchema.js";
import { handStepRowAboveFoldWords } from "./handStepsSchema.js";
import { ownerBeliefRowAboveFoldWords } from "./ownerBeliefsSchema.js";
import { quizAboveFoldWords } from "./quizSchema.js";
import type { BriefingForm } from "./types.js";
import { textOfContent } from "./vocabulary.js";

/** One section of the page, and how many of its words a reader meets without expanding anything. */
export interface PageAboveFoldRegion {
  /** The section's name as the page renders it. */
  readonly region: string;
  readonly words: number;
}

/**
 * Every region the page puts above the fold OUTSIDE the react-now block, each with its word count.
 *
 * The lede, the correction block, the quiz, the hand steps, the alignment line and the autonomy ledger: each
 * renders its headline outside any `<details>`, so every word of it is a word the rendered-bytes half
 * (`../../briefing/pageBudget.ts`) already counts, and leaving one out would be the two halves of one gate
 * disagreeing.
 *
 * ## Why the owner's list and the recent notes are absent
 *
 * Both render inside a `<details>` — the recent notes, and the owner's list since `renderYourList`
 * folded its rows — and the rendered-bytes half removes every fold, summary included, before it counts a
 * word. This sum once charged them anyway, so the two halves disagreed by exactly those words:
 * MEASURED on a form with its list and ledger projected, 1043 words charged, 695 of them recent
 * headlines and 238 the owner's list's rows, while the page it would have rendered measured 297. One
 * fourteen-word sentence in the newest note tipped the phantom total past the cap. Repro:
 * `slopweaver briefing render --form - --your-list run.json --autonomy-ledger --out <html> < form.json`
 * over a form of four refused sentences. What bounds
 * the two folded sections is their own caps — `YOUR_LIST_ABOVE_FOLD_MAX_WORDS`, and `PAGE_UNFOLDED_BLOCKS_MAX`
 * notes of at most `BLOCK_MAX_SENTENCES` sentences each — never this page total.
 *
 * @param form the whole form
 * @returns one row per region, in page order, zero-word regions included
 */
export function pageAboveFoldRegions({ form }: { form: BriefingForm }): readonly PageAboveFoldRegion[] {
  return [
    { region: "lede", words: wordCount({ text: textOfContent({ content: form.header.lede }) }) },
    {
      region: "correction block",
      words: form.ownerBeliefs.rows.reduce((total, row) => total + ownerBeliefRowAboveFoldWords({ row }), 0),
    },
    { region: "quiz", words: form.quiz === undefined ? 0 : quizAboveFoldWords({ quiz: form.quiz }) },
    {
      region: "hand steps",
      words: form.handSteps.rows.reduce((total, row) => total + handStepRowAboveFoldWords({ row }), 0),
    },
    { region: "alignment", words: wordCount({ text: textOfContent({ content: form.alignment.headline }) }) },
    {
      region: "autonomy ledger",
      words: form.autonomy.rows.reduce((total, row) => total + autonomyRowAboveFoldWords({ row }), 0),
    },
  ];
}

/**
 * The refusal for a form over {@link PAGE_ABOVE_FOLD_MAX_WORDS}, naming the measured count and every region
 * that carries words, largest first.
 *
 * @param regions what {@link pageAboveFoldRegions} measured
 * @returns the refusal's one line
 */
export function pageAboveFoldRefusal({ regions }: { regions: readonly PageAboveFoldRegion[] }): string {
  const total = regions.reduce((sum, one) => sum + one.words, 0);
  const counted = regions
    .filter((one) => one.words > 0)
    .toSorted((left, right) => right.words - left.words)
    .map((one) => `${one.region} ${String(one.words)}`)
    .join(", ");
  return (
    `the page puts ${String(total)} words above the fold outside the react-now cards, over the cap of ` +
    `${String(PAGE_ABOVE_FOLD_MAX_WORDS)} (${counted}). A page this long is one the owner scrolls past, so the ` +
    "parts the owner does read are the parts you folded away."
  );
}

/**
 * Every word the page puts above the fold OUTSIDE the react-now block, the sum of {@link pageAboveFoldRegions}.
 *
 * @param form the whole form
 * @returns the word count a reader meets without expanding anything, cards excluded
 */
export function pageAboveFoldWords({ form }: { form: BriefingForm }): number {
  return pageAboveFoldRegions({ form }).reduce((total, one) => total + one.words, 0);
}
