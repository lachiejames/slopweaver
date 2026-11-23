/**
 * The FORM `github comment create`/`edit` validate `--form` against — schema-enforced STRUCTURE, matching
 * `./schema.ts`'s doctrine: shape is refused, words never are here.
 *
 * `summary` reuses `contentSchema` from `./schema.ts` wholesale, capped by word count the same way the PR
 * body's `next`/`problem`/`solution` cells are — reopening that already-open, already-trusted module for a
 * second copy of the delimiter-free `Inline` union is exactly what `../linear/commentSchema.ts`'s own module
 * doc says a comment form should do rather than inventing its own. The cap reuses `MAX_WORDS`: a comment is
 * the whole message a reader sees without acting, the same role `problem`/`solution` play on a pull request.
 */
import { z } from "zod";

import { countWords, MAX_WORDS } from "../../prformat/checkCore.js";
import { strictForm } from "../strictForm.js";

import type { GithubCommentArtifact } from "./commentTypes.js";
import { proofLeafBlockSchema } from "./legacy/schema.js";
import { renderContent } from "./render.js";
import { contentSchema } from "./schema.js";

/** `summary`: at least one run, and capped at {@link MAX_WORDS} words counted against the rendered text. */
const summarySchema = contentSchema.superRefine((content, ctx) => {
  const words = countWords({ cell: renderContent({ content }) });
  if (words > MAX_WORDS) {
    ctx.addIssue({
      code: "custom",
      message:
        `summary is ${String(words)} words (max ${String(MAX_WORDS)}) — it is the whole message above the ` +
        "fold. Move the rest into detail, which renders collapsed",
    });
  }
});

/** The comment body: one line above the fold, optional detail collapsed beneath it. */
export const githubCommentArtifactSchema = strictForm({
  detail: z.array(proofLeafBlockSchema).min(1).optional(),
  summary: summarySchema,
}) satisfies z.ZodType<GithubCommentArtifact>;
