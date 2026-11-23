/**
 * The FORM `linear document create|update` validates against — schema-enforced structure, same doctrine as
 * `./schema.ts`, applied to a long-form page instead of a ticket.
 *
 * The body is `./schema.ts`'s `freeformBlockSchema`, walked by its `checkBlocks`, so every structural refusal
 * an issue body carries reaches a document unchanged: a `+++` line (Linear's collapsible grammar is global to
 * any markdown field it renders), a heading marker smuggled inside a paragraph, a fence a paragraph cannot
 * close, hand-written `@[name](id)` mention markup. What a document does NOT inherit is the issue's reserved
 * headings: a freeform ticket may not re-create `## Problem` because that impersonates the structured kind,
 * and a document has no structured kind to impersonate.
 */
import { z } from "zod";

import { strictForm } from "../strictForm.js";

import type { LinearDocumentForm } from "./documentTypes.js";
import { checkBlocks, freeformBlockSchema } from "./schema.js";

/** One destination, by kind — see `./documentTypes.ts` for why it is a tagged value rather than four ids. */
const destinationSchema = strictForm({
  id: z
    .string()
    .min(1)
    .refine((id) => !/\s/.test(id), "a destination id carries no whitespace"),
  kind: z.enum(["initiative", "issue", "project", "team"]),
});

/** The `linear document create|update` fields. */
const linearDocumentFieldsSchema = strictForm({
  destination: destinationSchema,
  // One line, for the reason `./schema.ts` gives a ticket title: Linear stores it single-line, so a newline is
  // dropped on the wire and the title you asked for is not the title you get.
  title: z
    .string()
    .min(1)
    .refine((t) => !/[\n\r]/.test(t), "a document title is a single line; the newline would be dropped silently"),
});

/** The complete `linear document create|update` form. */
export const linearDocumentFormSchema = strictForm({
  content: z.array(freeformBlockSchema).min(1),
  fields: linearDocumentFieldsSchema,
}).superRefine((form, ctx) => {
  checkBlocks({ blocks: form.content, ctx, field: "content" });
}) satisfies z.ZodType<LinearDocumentForm>;
