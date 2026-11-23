/**
 * The C3 form as a WRITE door accepts it: structure plus every rule in `./formRules.ts`.
 *
 * A separate schema from `./schema.ts`'s readers because those also DECODE what is already published or stored; a
 * rule added here never makes an existing body unreadable. Every door that writes — a `--form`, an authoring file,
 * a merged `--edit`, a generated bump or vulnerability form — uses this, so a form it accepts renders a body the CI
 * gate accepts too.
 *
 * The retired fields are refused BY NAME rather than as an unknown key, because each was published once and a
 * caller reaching for one needs to know where its job went: the origin, the grade and the gold anchor are no longer
 * published at all, the reviewer table is gone, and Codex review leftovers are a landing-gate finding.
 */
import { z } from "zod";
import { strictForm } from "../strictForm.js";
import { c3FormErrors } from "./formRules.js";
import { CURRENT_LAYOUT } from "./render.js";
import { bodyShape, routingShape } from "./schema.js";
import type { PrFormDraft } from "./types.js";

/**
 * A retired field, refused with the reason it left the published description.
 *
 * @param why what replaced it
 * @returns a schema no value passes
 */
function retired({ why }: { why: string }): z.ZodOptional<z.ZodNever> {
  return z.never({ error: why }).optional();
}

/** Why a grade or an anchor is no longer a description field. */
const UNPUBLISHED =
  "is no longer published: a description carries no grade, gold anchor or origin. The landing verbs keep their own " +
  "record of proof. Remove it";

export const prFormWriteSchema = strictForm({
  ...bodyShape,
  ...routingShape,
  draft: z.boolean().default(true),
  goldAnchor: retired({ why: `goldAnchor ${UNPUBLISHED}` }),
  origin: retired({ why: `origin ${UNPUBLISHED}` }),
  review: retired({ why: `review ${UNPUBLISHED}` }),
  reviewLeftovers: retired({
    why:
      "reviewLeftovers left the description: a BROKEN Codex review past pass two is a codex-loop-incomplete finding " +
      "the landing verbs refuse until acknowledged with --reason. Remove it",
  }),
  reviewers: retired({ why: "reviewers left the description: there is no reviewer table. Remove it" }),
  writtenOn: retired({ why: "writtenOn is not a field: no byte of a C3 description depends on the day it is written" }),
})
  .superRefine((draft, ctx) => {
    // Every write renders the current layout, so it meets every rule that layout carries, the title's included.
    for (const issue of c3FormErrors({ body: draft, layout: CURRENT_LAYOUT, title: draft.title, today: undefined })) {
      ctx.addIssue({ code: "custom", message: `${issue.code}: ${issue.message}`, path: [...issue.path] });
    }
  })
  .transform(
    ({ goldAnchor: _g, origin: _o, review: _r, reviewLeftovers: _l, reviewers: _v, writtenOn: _w, ...form }) => form,
  ) satisfies z.ZodType<PrFormDraft>;
