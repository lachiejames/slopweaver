/**
 * The FORMS `linear initiative create|update|link` and `linear initiative-update create` validate against.
 *
 * Same doctrine as every other schema on this noun: structure is refused, words never are. Two halves,
 * because an initiative and a report posted to one are different objects — the initiative's fields are
 * scalars with no markdown body at all (exactly as `./projectSchema.ts` describes for a project), while the
 * update carries the summary + folded-detail arrangement rule 7 requires and a required, closed `health`.
 *
 * `health` is required here for the reason `./projectUpdateSchema.ts` records for its own: Linear leaves it
 * optional, and an update posted with no health leaves the initiative reading whatever it read before,
 * which is the silent staleness the verb exists to end.
 */
import { z } from "zod";

import { strictForm } from "../strictForm.js";

import type {
  LinearInitiativeFields,
  LinearInitiativeForm,
  LinearInitiativeLinkFields,
  LinearInitiativeLinkForm,
  LinearInitiativeUpdateArtifact,
  LinearInitiativeUpdateFields,
  LinearInitiativeUpdateForm,
} from "./initiativeTypes.js";
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

/** Linear's `TimelessDate` scalar wire format. */
const TIMELESS_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Refuse a newline in a field Linear renders/stores as a single line. */
function isSingleLine(text: string): boolean {
  return !hasLineBreak({ text });
}

/** The initiative's own short summary: single line, the same call `./projectSchema.ts` makes for a project. */
const initiativeDescriptionSchema = z
  .string()
  .refine(isSingleLine, "an initiative description renders as ONE line; the newline would be dropped silently");

/** The five values Linear's `InitiativeStatus` enum admits, spelled as the wire spells them. */
const initiativeStatusSchema = z.union([
  z.literal("Active"),
  z.literal("Canceled"),
  z.literal("Completed"),
  z.literal("Planned"),
  z.literal("Proposed"),
]);

/** The `linear initiative create|update` fields. `name` is required on BOTH, mirroring the project form. */
const linearInitiativeFieldsSchema = strictForm({
  description: initiativeDescriptionSchema.optional(),
  leadTeamId: z.string().min(1).optional(),
  name: z
    .string()
    .min(1)
    .refine(isSingleLine, "an initiative name is a single line; a newline would be dropped silently"),
  ownerId: z.string().min(1).optional(),
  status: initiativeStatusSchema.optional(),
  targetDate: z
    .string()
    .regex(TIMELESS_DATE, "a target date is YYYY-MM-DD (Linear's TimelessDate wire format)")
    .optional(),
}) satisfies z.ZodType<LinearInitiativeFields>;

/** The complete `linear initiative create|update` form — fields only, since an initiative has no body here. */
export const linearInitiativeFormSchema = strictForm({
  fields: linearInitiativeFieldsSchema,
}) satisfies z.ZodType<LinearInitiativeForm>;

/** The `linear initiative link` fields: the two endpoints, and nothing else. */
const linearInitiativeLinkFieldsSchema = strictForm({
  initiativeId: z.string().min(1),
  projectId: z.string().min(1),
}) satisfies z.ZodType<LinearInitiativeLinkFields>;

/** The complete `linear initiative link` form. */
export const linearInitiativeLinkFormSchema = strictForm({
  fields: linearInitiativeLinkFieldsSchema,
}) satisfies z.ZodType<LinearInitiativeLinkForm>;

/** The update's lead: one line, within the word cap, and no delimiter. Same rule as a project update's. */
const summarySchema = z
  .string()
  .min(1)
  .refine(
    (text) => !hasLineBreak({ text }),
    "an initiative update summary is ONE line — put the rest in detail, which folds",
  )
  .refine(
    (text) => !anyLineMatches({ pattern: DELIMITER_LINE, text }),
    'a line beginning with "+++" is Linear\'s collapsible delimiter and would close the detail block early',
  )
  .refine((text) => !hasRawHtml({ text }), RAW_HTML_CORRECTION)
  .refine((text) => !anyLineMatches({ pattern: FENCE_LINE, text }), SUMMARY_FENCE_CORRECTION)
  .refine(
    (text) => countSectionWords({ text }) <= SECTION_MAX_WORDS,
    `an initiative update summary is the whole report above the fold, so it is capped at ${String(SECTION_MAX_WORDS)} words — move the rest into detail, which renders collapsed`,
  );

/** One evidence link. Same refusals as the project-update form's, for the same rendering reason. */
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
 * The initiative update's body. `detail` renders inside the update's `+++` fold, so it gets `checkBlocks`
 * for the reason `./projectUpdateSchema.ts` records on its own.
 */
const linearInitiativeUpdateArtifactSchema = strictForm({
  detail: z.array(sectionBlockSchema).min(1).optional(),
  evidence: z.array(evidenceSchema).min(1).optional(),
  summary: summarySchema,
}).superRefine((artifact, ctx) => {
  // `detail` is optional: an update whose summary says it all has no folded block to check.
  if (artifact.detail !== undefined) {
    checkBlocks({ blocks: artifact.detail, ctx, field: "detail" });
  }
}) satisfies z.ZodType<LinearInitiativeUpdateArtifact>;

/** Which initiative the update lands on, and what health it declares. */
const linearInitiativeUpdateFieldsSchema = strictForm({
  health: z.union([z.literal("atRisk"), z.literal("offTrack"), z.literal("onTrack")]),
  initiativeId: z.string().min(1),
}) satisfies z.ZodType<LinearInitiativeUpdateFields>;

/** A complete `linear initiative-update create` write. */
export const linearInitiativeUpdateFormSchema = strictForm({
  artifact: linearInitiativeUpdateArtifactSchema,
  fields: linearInitiativeUpdateFieldsSchema,
}) satisfies z.ZodType<LinearInitiativeUpdateForm>;
