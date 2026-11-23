/**
 * THE OWNER'S OWN LIST — the one section of this page that is a projection of `slopweaver session-start`.
 *
 * Split out of `./schema.ts` for the reason `./handStepsSchema.ts` and `./autonomySchema.ts` were: that file
 * sits at the code-line cap `file-size-ratchet` enforces, and this is a real seam in it — one row shape, its
 * above-fold arithmetic, and the section that holds them, reading nothing else the form declares.
 */
import { z } from "zod";

import {
  YOUR_LIST_ABOVE_FOLD_MAX_WORDS,
  YOUR_LIST_HEADLINE_MAX_WORDS,
  YOUR_LIST_MAX_ROWS,
  YOUR_LIST_WHO_MAX_CHARS,
} from "../../briefing/caps.js";
import { wordCount } from "../../briefing/text.js";
import { CODE_OWNER_SLICE_PATHS_MAX, codeOwnerSliceLine } from "../../review/codeOwnerSlice.js";
import { strictForm } from "../strictForm.js";
import type { BriefingYourRow } from "./types.js";
import { cappedContent, quotedFoldSchema, textOfContent } from "./vocabulary.js";

/**
 * The instant the list was read, which its section summary states its own age from.
 *
 * The same four lines `./handStepsSchema.ts` spells for the same reason: importing `./schema.ts`'s copy
 * would make the two modules circular.
 */
const instant = z
  .string()
  .min(1)
  .max(40)
  .refine((value) => !Number.isNaN(new Date(value).getTime()), {
    message: "your list's `readIso` must be an ISO-8601 timestamp a clock can parse, as in `2026-09-25T10:49:08Z`.",
  });

/** A count a slice carries: a whole number from zero up. */
const count = z.number().int().min(0);

/**
 * The owner's code-owner share of a review ask. Strict, and its arithmetic checked, because it is a CLAIM about how big
 * the ask is: a slice naming more paths than it counts, or counting more files than the pull request has, is a
 * producer defect the page refuses rather than shows.
 */
const codeOwnerSliceSchema = strictForm({
  additions: count,
  deletions: count,
  omittedPaths: count,
  ownedFiles: count,
  shownPaths: z.array(z.string().min(1).max(500)).max(CODE_OWNER_SLICE_PATHS_MAX),
  totalFiles: count,
})
  .refine((slice) => slice.shownPaths.length + slice.omittedPaths === slice.ownedFiles, {
    message:
      "a code-owner slice must name or count every file it says the owner holds: shownPaths plus omittedPaths is ownedFiles.",
  })
  .refine((slice) => slice.ownedFiles <= slice.totalFiles, {
    message: "a code-owner slice cannot own more files than the pull request changes.",
  });

/**
 * One row of the owner's list.
 *
 * Only `headline` is BUDGETED, and only in words: every other field is a fact the session-start verb
 * supplied rather than prose anyone here composed, so budgeting one would mean refusing the owner's own list.What
 * bounds the rest is {@link YOUR_LIST_ABOVE_FOLD_MAX_WORDS} over the whole section — the same
 * per-field-plus-backstop shape a card already has.
 *
 * The character `max()`es below are a different thing and the distinction is load-bearing: they are sanity
 * bounds on a wire value, sized so far above anything the verb produces that they never arbitrate what a reader
 * sees. MEASURED, when one stopped being that: a board row built `who` out of a 110-character
 * run slug, reached 122 against the 120 here, and `briefing render` refused the whole page at
 * `yourList.rows.N.who` — this form refusing the owner's own list, which is exactly what the paragraph above says it
 * must not do. The producer was the defect and was fixed there (`../../sessionStart/boardLeg.ts` names the
 * session's role, not its slug); the cap is unchanged and now reads {@link YOUR_LIST_WHO_MAX_CHARS} so the
 * number a producer has to respect is stated where this page's numbers live. A bound one of these refuses
 * is a signal to go and look at the verb, never a number to raise — and the form still REFUSES rather than
 * truncating (rule 7).
 */
const yourRowSchema = strictForm({
  closing: z.boolean(),
  codeOwnerSlice: codeOwnerSliceSchema.optional(),
  // `quotedFoldSchema`, not `foldSchema`: this fold is the owner's own recorded question with its references
  // linkified, not prose anyone here composed — see the type's own note on the bare-key-link rule.
  detail: quotedFoldSchema.optional(),
  headline: cappedContent({ field: "a row on your list", words: YOUR_LIST_HEADLINE_MAX_WORDS }),
  identity: z.string().min(1).max(200),
  link: z.boolean(),
  rank: z.number().int().min(1),
  score: z.number().int().min(0),
  title: z.string().min(1).max(300).optional(),
  whenIso: z.string().min(1).max(40),
  where: z.string().min(1).max(500),
  who: z.string().min(1).max(YOUR_LIST_WHO_MAX_CHARS),
  why: z.string().min(1).max(300),
});

/**
 * Every word one row of the owner's list puts above the fold: its rank, its headline, its code-owner slice and its title.
 *
 * @internal — the counter this file's own section budget shares with `../../briefing/oneIndex.ts`'s reader.
 *
 * @param row the row to measure
 * @returns the word count a reader cannot avoid
 */
export function yourRowAboveFoldWords({ row }: { row: BriefingYourRow }): number {
  const rank = `${String(row.rank)}.`;
  const mark = row.closing ? "CLOSE —" : "";
  const title = row.title === undefined ? [] : [row.title];
  const slice = row.codeOwnerSlice === undefined ? [] : [codeOwnerSliceLine({ slice: row.codeOwnerSlice })];
  return wordCount({ text: [rank, mark, textOfContent({ content: row.headline }), ...slice, ...title].join(" ") });
}

/**
 * The owner's list: at most {@link YOUR_LIST_MAX_ROWS} rows, ranked from one with no gaps, inside its own word budget.
 *
 * It was EXPORTED while a second gated page validated the same projection, and stopped being
 * when that page folded back in here. It stays one schema rather than two for the reason the export existed:
 * a second copy of these caps is the two-halves-disagreeing failure this whole pair exists to remove.
 *
 * The rank check is the same class as the option letters' no-gap rule: the section is a PROJECTION of an
 * ordered list, so a page showing rows 1, 2 and 4 is showing a list nobody ranked. `notShown` is what makes
 * the projection honest rather than a truncation — see {@link BriefingYourList}.
 */
export const yourListSchema = strictForm({
  cutShort: z.array(z.string().min(1).max(60)).min(1).max(5).optional(),
  notShown: z.number().int().min(0),
  readIso: instant,
  rows: z
    .array(yourRowSchema)
    .max(YOUR_LIST_MAX_ROWS)
    .refine((rows) => rows.every((row, index) => row.rank === index + 1), {
      message: "your list's rows must be ranked from 1 with no gaps — it is a projection of an ordered list.",
    }),
  source: z.string().min(1).max(200),
}).refine(
  (list) =>
    list.rows.reduce((total, row) => total + yourRowAboveFoldWords({ row }), 0) <= YOUR_LIST_ABOVE_FOLD_MAX_WORDS,
  {
    message:
      `your list runs over the cap of ${String(YOUR_LIST_ABOVE_FOLD_MAX_WORDS)} words above the fold. ` +
      "Show fewer rows — the count it is not showing is stated either way.",
  },
);
