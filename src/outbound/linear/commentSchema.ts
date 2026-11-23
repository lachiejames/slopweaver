/**
 * The FORMS `linear comment create` and `linear relation create` validate against.
 *
 * Same doctrine as `./schema.ts` — structure is refused, words never are — with the two additions a comment
 * needs and an issue body does not:
 *
 *  - **`summary` carries a WORD CAP.** It is the entire message above the fold, so rule 7 is enforced by the
 *    schema rather than by review: an over-long lead is REFUSED, never truncated. The cap is
 *    {@link SECTION_MAX_WORDS}, reused from the issue form rather than invented here, because it is the same
 *    question ("how long may a human-visible section be?") measured against the same real corpus.
 *  - **`evidence` is required and non-empty on an issue comment.** The one content rule in this file, and the
 *    module doc on `./commentTypes.ts` says why it is here rather than left to a reviewer — and why a
 *    DOCUMENT comment, whose quoted passage is its provenance, may carry an empty list.
 *
 * The structural refusals are imported from `./schema.ts` rather than copied. `./projectSchema.ts` copied
 * its two regexes and explained the choice — that a project/milestone body shares no other machinery with an
 * issue body, so reopening a trust-critical module for two exports was not worth it. A comment is the
 * opposite case: it reuses `sectionBlockSchema` wholesale, so the module is already open and a second copy
 * of the delimiter rule would be a second place to fix when Linear's grammar changes.
 */
import { z } from "zod";

import { strictForm } from "../strictForm.js";

import type {
  LinearCommentArtifact,
  LinearCommentForm,
  LinearDocumentCommentFields,
  LinearIssueCommentFields,
  LinearRelationFields,
  LinearRelationForm,
} from "./commentTypes.js";
import { RAW_MENTION_MARKUP } from "./mentionIndex.js";
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

/**
 * The comment's lead: one line, within the word cap, and no delimiter.
 *
 * The single-line rule is not cosmetic here. The renderer puts the summary immediately above a `+++` opener,
 * so a newline in it would push the opener's own line context around and — with a `+++` of its own — close
 * the block before it opened.
 */
const summarySchema = z
  .string()
  .min(1)
  .refine((text) => !hasLineBreak({ text }), "a comment summary is ONE line — put the rest in detail, which folds")
  .refine(
    (text) => !anyLineMatches({ pattern: DELIMITER_LINE, text }),
    'a line beginning with "+++" is Linear\'s collapsible delimiter and would close the detail block early',
  )
  .refine(
    (text) => !RAW_MENTION_MARKUP.test(text),
    "`@[name](id)` is Linear's own mention markup, so this comment would notify whoever owns that id with " +
      "no check that it is the person you meant. Write `@{key}` and the door resolves it — see " +
      "`./mentionIndex.ts`.",
  )
  .refine((text) => !hasRawHtml({ text }), RAW_HTML_CORRECTION)
  .refine((text) => !anyLineMatches({ pattern: FENCE_LINE, text }), SUMMARY_FENCE_CORRECTION)
  .refine(
    (text) => countSectionWords({ text }) <= SECTION_MAX_WORDS,
    `a comment summary is the whole message above the fold, so it is capped at ${String(SECTION_MAX_WORDS)} words — move the rest into detail, which renders collapsed`,
  );

/**
 * One evidence link. The URL is a real URL, because a citation nobody can open is not a citation. The label is
 * not checked for raw HTML: the renderer escapes its angle brackets, so `Array<string>` renders as written.
 */
const evidenceSchema = strictForm({
  label: z
    .string()
    .min(1)
    .refine(
      (text) => !hasLineBreak({ text }),
      "an evidence label renders as ONE list item; the newline would break it",
    ),
  // Angle-bracketed by the renderer so a `)` inside the URL cannot terminate the link construct early — which
  // leaves `<`, `>` and whitespace as the one case escaping cannot rescue, so they are refused here instead.
  // Same reasoning, same wording as `./schema.ts`'s media URL; `z.url()` alone does not exclude them.
  url: z.url().refine((u) => !/[<>\s]/.test(u), "an evidence URL may not contain whitespace or angle brackets"),
});

/**
 * The comment body.
 *
 * `detail` gets the SAME structural refinement an issue body's sections get, via `./schema.ts`'s own
 * `checkBlocks`. Reusing `sectionBlockSchema` bought the shape and not the rules: until this refinement
 * existed a `+++` line in a detail paragraph parsed cleanly and closed the comment's collapsible early, and
 * hand-written mention markup reached Linear unchecked.
 *
 * The evidence FLOOR is not here: it depends on the destination (an issue comment needs a link, a document
 * comment may carry none), so {@link linearCommentFormSchema} checks it once both halves have parsed.
 */
const linearCommentArtifactSchema = strictForm({
  detail: z.array(sectionBlockSchema).min(1).optional(),
  evidence: z.array(evidenceSchema),
  summary: summarySchema,
}).superRefine((artifact, ctx) => {
  // `detail` is optional: a comment whose summary says it all has no folded block to check.
  if (artifact.detail !== undefined) {
    checkBlocks({ blocks: artifact.detail, ctx, field: "detail" });
  }
}) satisfies z.ZodType<LinearCommentArtifact>;

/** Which issue the comment lands on. */
const linearIssueCommentFieldsSchema = strictForm({
  issueId: z.string().min(1),
}) satisfies z.ZodType<LinearIssueCommentFields>;

/** Which document the comment lands on, and the passage it answers. */
const linearDocumentCommentFieldsSchema = strictForm({
  documentId: z.string().min(1),
  parentId: z.string().min(1).optional(),
  quotedText: z.string().min(1).optional(),
}) satisfies z.ZodType<LinearDocumentCommentFields>;

/**
 * A complete `linear comment create` write: on an issue, or on a document.
 *
 * ONE form whose `fields` is the union, rather than a union of two forms, so an artifact refusal keeps its own
 * path and message — a union of whole forms reports every failure as one generic "Invalid input" at the root.
 * The two rules that depend on the destination are therefore checked here, after both halves parsed: the
 * issue comment's evidence floor, and the quote being ONE line (Linear anchors an inline comment to a text
 * selection within a block, so a quote spanning a newline would never match).
 */
export const linearCommentFormSchema = strictForm({
  artifact: linearCommentArtifactSchema,
  fields: z.union([linearIssueCommentFieldsSchema, linearDocumentCommentFieldsSchema], {
    error: "fields names ONE destination: { issueId } or { documentId, quotedText? | parentId? }",
  }),
}).superRefine((form, ctx) => {
  if ("issueId" in form.fields && form.artifact.evidence.length === 0) {
    ctx.addIssue({
      code: "custom",
      message: "an issue comment needs at least one evidence link — an unsourced claim is what the field refuses",
      path: ["artifact", "evidence"],
    });
  }
  if (
    "documentId" in form.fields &&
    form.fields.quotedText !== undefined &&
    hasLineBreak({ text: form.fields.quotedText })
  ) {
    ctx.addIssue({
      code: "custom",
      message: "quotedText is ONE passage of one paragraph; a newline never anchors",
      path: ["fields", "quotedText"],
    });
  }
  if ("documentId" in form.fields && form.fields.parentId !== undefined && form.fields.quotedText !== undefined) {
    ctx.addIssue({
      code: "custom",
      message: "a reply (parentId) inherits its thread's anchor, so it carries no quotedText — drop one of the two",
      path: ["fields", "quotedText"],
    });
  }
}) satisfies z.ZodType<LinearCommentForm>;

/**
 * The relation fields.
 *
 * The two ids are refused when EQUAL. Linear's own API rejects a self-relation, but it does so with a
 * generic argument error after the door has already recorded an external write — so the refusal is here,
 * where it costs nothing and names what is wrong.
 */
const linearRelationFieldsSchema = strictForm({
  issueId: z.string().min(1),
  relatedIssueId: z.string().min(1),
  type: z.union([z.literal("blocks"), z.literal("duplicate"), z.literal("related")]),
}).refine(
  (fields) => fields.issueId !== fields.relatedIssueId,
  "an issue cannot be related to itself; issueId and relatedIssueId are the same value",
) satisfies z.ZodType<LinearRelationFields>;

/** A complete `linear relation create` write. There is no artifact — a relation is an edge, not a document. */
export const linearRelationFormSchema = strictForm({
  fields: linearRelationFieldsSchema,
}) satisfies z.ZodType<LinearRelationForm>;
