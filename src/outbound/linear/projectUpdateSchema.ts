/**
 * The FORM `linear project-update create` validates against.
 *
 * Same doctrine as `./schema.ts` and `./commentSchema.ts` — structure is refused, words never are. It reuses
 * the comment form's summary rule wholesale, because "how long may the one visible line be?" is the same
 * question measured against the same corpus, and adds the one field a status update has that no other form
 * here does: a required, closed `health`.
 *
 * `health` is required rather than optional even though Linear's own `ProjectUpdateCreateInput` leaves it
 * optional. An update posted with no health leaves the project reading whatever it read before, which is the
 * silent-staleness this whole verb exists to end — so the form refuses to let a caller skip the field by
 * accident. A caller who genuinely means "unchanged" states the current value.
 */
import { z } from "zod";

import { strictForm } from "../strictForm.js";

import type {
  LinearProjectUpdateArtifact,
  LinearProjectUpdateFields,
  LinearProjectUpdateForm,
} from "./projectUpdateTypes.js";
import { checkBlocks, sectionBlockSchema } from "./schema.js";
import { countSectionWords, SECTION_MAX_WORDS } from "./sectionWords.js";
import {
  anyLineMatches,
  FENCE_LINE,
  hasLineBreak,
  hasRawHtml,
  RAW_HTML_CORRECTION,
  SUMMARY_FENCE_CORRECTION,
} from "./structuralEscapes.js";

/** Linear's collapsible delimiter at the start of a line — see `./schema.ts` for the measured reason. */
const DELIMITER_LINE = /^[ \t]*\+\+\+(?:[ \t].*)?$/;

/** The update's lead: one line, within the word cap, and no delimiter. Same rule as a comment's summary. */
const summarySchema = z
  .string()
  .min(1)
  .refine(
    (text) => !hasLineBreak({ text }),
    "a project update summary is ONE line — put the rest in detail, which folds",
  )
  .refine(
    (text) => !anyLineMatches({ pattern: DELIMITER_LINE, text }),
    'a line beginning with "+++" is Linear\'s collapsible delimiter and would close the detail block early',
  )
  .refine((text) => !hasRawHtml({ text }), RAW_HTML_CORRECTION)
  .refine((text) => !anyLineMatches({ pattern: FENCE_LINE, text }), SUMMARY_FENCE_CORRECTION)
  .refine(
    (text) => countSectionWords({ text }) <= SECTION_MAX_WORDS,
    `a project update summary is the whole report above the fold, so it is capped at ${String(SECTION_MAX_WORDS)} words — move the rest into detail, which renders collapsed`,
  );

/**
 * One evidence link. Same refusals as the comment form's, for the same rendering reason. Raw HTML is not one of
 * them: the renderer escapes a label's angle brackets, so `Array<string>` renders as written.
 */
const evidenceSchema = strictForm({
  label: z
    .string()
    .min(1)
    .refine(
      (text) => !hasLineBreak({ text }),
      "an evidence label renders as ONE list item; the newline would break it",
    ),
  url: z.url().refine((u) => !/[<>\s]/.test(u), "an evidence URL may not contain whitespace or angle brackets"),
});

/**
 * The project update's body.
 *
 * `detail` renders inside the update's own `+++` fold, so it owes the structural refinement a comment's
 * detail gets, via `./schema.ts`'s `checkBlocks`: the block schema carries the shape only, and until this
 * refinement a plain `+++` line in a detail paragraph parsed cleanly and closed the fold early.
 */
const linearProjectUpdateArtifactSchema = strictForm({
  detail: z.array(sectionBlockSchema).min(1).optional(),
  evidence: z.array(evidenceSchema).min(1).optional(),
  summary: summarySchema,
}).superRefine((artifact, ctx) => {
  // `detail` is optional: an update whose summary says it all has no folded block to check.
  if (artifact.detail !== undefined) {
    checkBlocks({ blocks: artifact.detail, ctx, field: "detail" });
  }
}) satisfies z.ZodType<LinearProjectUpdateArtifact>;

/** Which project the update lands on, and what health it declares. */
const linearProjectUpdateFieldsSchema = strictForm({
  health: z.union([z.literal("atRisk"), z.literal("offTrack"), z.literal("onTrack")]),
  overdueSince: z.iso.datetime({ offset: true }).optional(),
  projectId: z.string().min(1),
}) satisfies z.ZodType<LinearProjectUpdateFields>;

/** A complete `linear project-update create` write. */
export const linearProjectUpdateFormSchema = strictForm({
  artifact: linearProjectUpdateArtifactSchema,
  fields: linearProjectUpdateFieldsSchema,
}) satisfies z.ZodType<LinearProjectUpdateForm>;
