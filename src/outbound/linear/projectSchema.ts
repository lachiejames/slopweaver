/**
 * The FORMS `linear project create|update` and `linear milestone create` validate against — schema-enforced
 * structure, same doctrine as `./schema.ts`, scaled down to what a project/milestone actually is.
 *
 * A project has no concatenated markdown body: `ProjectCreateInput`/`ProjectUpdateInput`'s `description` is
 * a short, single-line summary (confirmed against the pinned `@linear/sdk` type declarations, not assumed —
 * the long-form project brief lives in the separate `content` field, which this form deliberately does not
 * expose; see the module doc on `projectTypes.ts`). So there is no block array, no collapsible, no heading
 * escape to refuse for a project — only the single-line rule a title-like field already needs.
 *
 * A milestone's `description` IS genuine markdown per Linear's own field doc ("in markdown format"), so it
 * gets the same two structural refusals `./schema.ts` uses for an issue body: a `+++` line would close a
 * collapsible early, and this repo has no collapsible in a milestone body to close — but Linear's `+++`
 * grammar is global to any markdown field it renders, so a milestone description that happened to contain a
 * literal `+++` line would still mangle whatever Linear renders after it. The two checks are duplicated
 * here rather than imported from `./schema.ts` because they are two small pure regexes with no shared state,
 * and `./schema.ts` does not export them — copying four lines is safer than reopening a trust-critical,
 * fully-tested module to add exports it does not otherwise need.
 */
import { z } from "zod";

import { strictForm } from "../strictForm.js";

import type {
  LinearMilestoneFields,
  LinearMilestoneForm,
  LinearProjectFields,
  LinearProjectForm,
} from "./projectTypes.js";
import { anyLineMatches, hasLineBreak, hasRawHtml, RAW_HTML_CORRECTION } from "./structuralEscapes.js";

/** A markdown heading line — see `./schema.ts` for why this is refused in a rendered markdown field. */
const HEADING_LINE = /^[ \t]*#{1,6}(?:[ \t]|$)/;

/** Linear's collapsible delimiter at the start of a line — see `./schema.ts` for the measured reason. */
const DELIMITER_LINE = /^[ \t]*\+\+\+(?:[ \t].*)?$/;

/** Linear's `TimelessDate` scalar wire format. */
const TIMELESS_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Refuse a newline in a field Linear renders/stores as a single line. */
function isSingleLine(text: string): boolean {
  return !hasLineBreak({ text });
}

/** The project's own short summary: single line, no markdown structure to escape (see module doc). */
const projectDescriptionSchema = z
  .string()
  .refine(isSingleLine, "a project description renders as ONE line; the newline would be dropped silently");

/** A milestone's markdown description: refuses the structural escapes an issue body refuses, raw HTML included. */
const milestoneDescriptionSchema = z
  .string()
  .min(1)
  .refine(
    (text) => !anyLineMatches({ pattern: DELIMITER_LINE, text }),
    'a line beginning with "+++" is Linear\'s collapsible delimiter and would mangle whatever this field renders after it',
  )
  .refine(
    (text) => !anyLineMatches({ pattern: HEADING_LINE, text }),
    'a line beginning with "#" opens a markdown heading in this field',
  )
  .refine((text) => !hasRawHtml({ text }), RAW_HTML_CORRECTION);

const singleLineText = z
  .string()
  .min(1)
  .refine(isSingleLine, "a single-line field; a newline would be dropped silently");

const targetDateSchema = z
  .string()
  .regex(TIMELESS_DATE, "a target date is YYYY-MM-DD (Linear's TimelessDate wire format)");

/** Linear's global project priority scale — identical enum to an issue's. */
const prioritySchema = z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3), z.literal(4)]);

/**
 * The `linear project create|update` fields. `teamIds` and `name` are required on BOTH verbs, mirroring how
 * `linear issue update` always resends `title`/`teamId` rather than patching only the touched field.
 */
export const linearProjectFieldsSchema = strictForm({
  description: projectDescriptionSchema.optional(),
  labelIds: z.array(z.string().min(1)).optional(),
  leadId: z.string().min(1).optional(),
  name: singleLineText,
  priority: prioritySchema.optional(),
  statusId: z.string().min(1).optional(),
  targetDate: targetDateSchema.optional(),
  teamIds: z.array(z.string().min(1)).min(1),
}) satisfies z.ZodType<LinearProjectFields>;

/** The `linear milestone create` fields. */
export const linearMilestoneFieldsSchema = strictForm({
  description: milestoneDescriptionSchema.optional(),
  name: singleLineText,
  projectId: z.string().min(1),
  sortOrder: z.number().optional(),
  targetDate: targetDateSchema.optional(),
}) satisfies z.ZodType<LinearMilestoneFields>;

/** The complete `linear project create|update` form: just the fields, since a project has no body/artifact. */
export const linearProjectFormSchema = strictForm({
  fields: linearProjectFieldsSchema,
}) satisfies z.ZodType<LinearProjectForm>;

/** The complete `linear milestone create` form. */
export const linearMilestoneFormSchema = strictForm({
  fields: linearMilestoneFieldsSchema,
}) satisfies z.ZodType<LinearMilestoneForm>;
