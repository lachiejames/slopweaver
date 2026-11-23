/**
 * The FORM for a message that must render entirely above the fold — schema-enforced shape, never content.
 *
 * The sibling of `./schema.ts`'s `updateArtifactSchema`, and deliberately its own module rather than
 * another arm of that one: the two forms have opposite invariants. An update REQUIRES a `detail` because
 * the fold needs something to hide; this one has no below-fold region at all, so its whole job is to refuse
 * anything that would create one. Putting both in one file would also have pushed `schema.ts` past the
 * code-line ratchet it already sits close to.
 *
 * ## What actually causes the fold, MEASURED — and what this repository used to believe
 *
 * `../slack/render.ts` and `../slack/preview.ts` both asserted, from a twelve-variant matrix, that **the
 * fold is a function of BLOCK COUNT ALONE: more than five blocks folds**. That is FALSE, and the
 * counterexample is the message this form exists because of. Read it back for yourself:
 *
 * ```bash
 * slopweaver slack read-thread https://<workspace>.slack.com/archives/<the owner's bot DM>/p<ts of the policy DM>
 * ```
 *
 * The attachment holds exactly THREE blocks — `context`, `divider`, `section` — with no `Details` label and
 * no sixth block, and it renders "Show more" in the owner's client. Length alone does not explain it either:
 * around 500 visible characters folded, and 480 did not. So the rule the old canon stated is refuted and no
 * character threshold replaces it.
 *
 * What has NOT been refuted, and is what this form is built on, is the OTHER half of the same measurement,
 * recorded in `../slack/types.ts`: **the legacy `attachments[]` wrapper is what makes the fold work — the
 * identical blocks posted at TOP LEVEL do not fold.** The as-me lane has posted top-level messages for
 * weeks and has never folded one. So the primitive here is structural rather than numeric: a no-fold
 * message carries NO attachment wrapper and exactly ONE top-level block, and the caps below exist to keep
 * it short enough to be worth reading rather than to keep it under a fold threshold nobody has measured.
 *
 * **The price is the violet bar.** The colour belongs to `SlackCardWrapper.color`, so a form with no
 * wrapper has no coloured bar and no author row inside the message — Slack's own message header carries the
 * bot's name instead. That is the trade this form makes, stated rather than discovered: identity chrome for
 * a guarantee that nothing is hidden. A message that wants the bar wants `kind: "update"`.
 *
 * ## Unknown keys are REFUSED, as everywhere
 *
 * Every object here is a `strictForm` or a strict object, so `detail`, `index`, `media`, `citations` and a mistyped
 * field alike are hard rejections that name the key. See `../strictForm.ts` for the poll whose `mentions:`
 * key validated clean, rendered clean and pinged nobody.
 */
import { z } from "zod";

import { BULLET_ITEM_VISIBLE_MAX, BULLETS_MAX_ITEMS, PARAGRAPH_VISIBLE_MAX } from "../assistant/contentLimits.js";
import { addTopRegionIssues, openingDeclarationSchema } from "./channelOpening.js";
import { problemDeclarationSchema } from "./problemReach.js";
import { linkRunSchema, mentionRunSchema, textSpanRunSchema } from "./runSchema.js";
import { noFoldSequences } from "./runs.js";
import { rawMarkupIssuesOfSequences, typeRawMarkupInNoFoldRuns } from "./typedRuns.js";
import type { NoFoldArtifact, NoFoldInlineRun } from "./types.js";
import { visibleLengthOfRuns } from "./visibleLength.js";

/**
 * The no-fold run vocabulary: text, links and person mentions.
 *
 * Spelled as its own list rather than derived from `./runSchema.ts`'s union, for the reason that file
 * already gives about the drip's: Zod's `discriminatedUnion` has no "omit", and a subtraction expressed as
 * a runtime filter would still type as the wider union. The cost is a third list; the benefit is that a
 * `group`, a `broadcast` and a `[n]` citation chip are UNREPRESENTABLE here rather than merely discouraged.
 * Only the LIST is spelled again: each run in it is `./runSchema.ts`'s own, so a run's fields and its URL
 * rule cannot drift between the two vocabularies.
 */
const noFoldInlineRunSchema = z.discriminatedUnion("type", [textSpanRunSchema, linkRunSchema, mentionRunSchema]);

/** One run sequence: at least one run, because an empty sequence renders nothing at all. */
const noFoldRunsSchema = z.array(noFoldInlineRunSchema).min(1);

/**
 * The whole message's visible width — the cap a caller cannot satisfy by adding lines.
 *
 * Bounded against an EXISTING measurement rather than a new invented number: {@link PARAGRAPH_VISIBLE_MAX},
 * the width of a reference paragraph the owner called "much more nicely formatted". A no-fold message has no
 * Details label to expand, so every character of it is read in one go, and the claim this encodes is that a
 * reader should not be asked to take in more than one readable paragraph's worth before deciding what to do.
 * A card's above-the-fold region is wider (`./schema.ts`) because a card still has the fold for its extras.
 *
 * It is NOT a fold threshold and must never be quoted as one — see this module's own measurement note.
 * Nothing has established a character count at which a top-level message folds, and a number presented as
 * one would be the refuted five-block claim's successor rather than its correction.
 */
export const NO_FOLD_VISIBLE_MAX = PARAGRAPH_VISIBLE_MAX;

/** How many dot points one no-fold message may carry. The card's own bullets bound, for the same reason. */
export const NO_FOLD_BULLETS_MAX = BULLETS_MAX_ITEMS;

/** One dot point stays a dot point. The card's own per-bullet bound. */
export const NO_FOLD_BULLET_VISIBLE_MAX = BULLET_ITEM_VISIBLE_MAX;

/** How many lines may follow the list. Past this the message is a report, and a report wants a fold. */
export const NO_FOLD_TRAILING_MAX = 4;

/**
 * The whole message's visible width, measured across every sequence.
 *
 * @param artifact the no-fold artifact
 * @returns the visible character count a reader actually sees, link URLs excluded
 */
export function noFoldVisibleLength({ artifact }: { artifact: NoFoldArtifact }): number {
  return noFoldSequences({ artifact }).reduce((total, runs) => total + visibleLengthOfRuns({ citations: [], runs }), 0);
}

/**
 * Refuse a `\n` smuggled into a visible string.
 *
 * The structure owns the line breaks here exactly as it does in the one-card form: `lead`, `bullets` and
 * `trailing` ARE the lines, so a newline inside a run is a line the structure cannot see, the preview
 * cannot draw, and {@link noFoldVisibleLength} counts as one character while it costs a whole row of
 * height. Every visible string is checked, a link LABEL included, because a `\n` in one breaks the render
 * exactly as one in a text run does.
 */
function checkNoBreaks({
  runs,
  path,
  ctx,
}: {
  runs: readonly NoFoldInlineRun[];
  path: readonly (string | number)[];
  ctx: z.RefinementCtx;
}): void {
  runs.forEach((run, index) => {
    let visible: string;
    if (run.type === "text") {
      visible = run.text;
    } else if (run.type === "link") {
      visible = run.label;
    } else {
      visible = "";
    }
    if (!/[\n\r]/.test(visible)) {
      return;
    }
    ctx.addIssue({
      code: "custom",
      message:
        "a no-fold line carries no `\\n` of its own — `lead`, `bullets` and `trailing` ARE the line " +
        "structure, so add another entry instead of embedding a break nothing downstream can see.",
      path: [...path, index],
    });
  });
}

/**
 * The per-dot-point bound.
 *
 * @param bullets the dot points
 * @param ctx the Zod refinement context to report an over-width point to
 */
function checkBullets({
  bullets,
  ctx,
}: {
  bullets: readonly (readonly NoFoldInlineRun[])[];
  ctx: z.RefinementCtx;
}): void {
  bullets.forEach((item, index) => {
    const width = visibleLengthOfRuns({ citations: [], runs: item });
    if (width <= NO_FOLD_BULLET_VISIBLE_MAX) {
      return;
    }
    ctx.addIssue({
      code: "custom",
      message:
        `dot point ${String(index)} is ${String(width)} visible chars, over the ` +
        `${String(NO_FOLD_BULLET_VISIBLE_MAX)} cap — a dot point is a line to scan, not a paragraph.`,
      path: ["bullets", index],
    });
  });
}

/**
 * The whole-message bound, and the refusal that names the form that DOES have somewhere to put the rest.
 *
 * @param artifact the no-fold artifact
 * @param ctx the Zod refinement context to report an over-width message to
 */
function checkWidth({ artifact, ctx }: { artifact: NoFoldArtifact; ctx: z.RefinementCtx }): void {
  const width = noFoldVisibleLength({ artifact });
  if (width <= NO_FOLD_VISIBLE_MAX) {
    return;
  }
  ctx.addIssue({
    code: "custom",
    message:
      `this no-fold message is ${String(width)} visible chars, over the ${String(NO_FOLD_VISIBLE_MAX)} cap ` +
      "— every character of it is above the fold, so there is nowhere for the excess to go. Cut it, or " +
      'send it as `{"kind":"update"}`, which has a `detail` below the fold and is the right form for a ' +
      "message with more to say. Adding lines will NOT help: this bound is on the whole message.",
    path: ["lead"],
  });
}

/**
 * The NO-FOLD form.
 *
 * `bullets` and `trailing` both default to empty, so the smallest valid message is one lead line — which is
 * also the smallest thing that can be said without a fold, and the shape a one-line notice wants.
 *
 * Raw markup is CONVERTED before anything is measured, exactly as the drip and one-card forms do it: a bare
 * URL and a raw `<@U…>` become the typed run that actually renders, because a `<https://x|Ship it>` costs
 * 21 characters as literal text and 7 as a link, and measuring first would refuse a message for text no
 * reader was ever going to see. Whatever conversion could not type is then REFUSED rather than shown to a
 * reader as an id.
 */
export const noFoldArtifactSchema = z
  .strictObject({
    bullets: z.array(noFoldRunsSchema).max(NO_FOLD_BULLETS_MAX).default([]),
    kind: z.literal("no-fold"),
    lead: noFoldRunsSchema,
    opening: openingDeclarationSchema.optional(),
    problem: problemDeclarationSchema.optional(),
    trailing: z.array(noFoldRunsSchema).max(NO_FOLD_TRAILING_MAX).default([]),
  })
  .transform((artifact): NoFoldArtifact => ({
    ...artifact,
    bullets: artifact.bullets.map((runs) => typeRawMarkupInNoFoldRuns({ runs })),
    lead: typeRawMarkupInNoFoldRuns({ runs: artifact.lead }),
    trailing: artifact.trailing.map((runs) => typeRawMarkupInNoFoldRuns({ runs })),
  }))
  .superRefine((artifact, ctx) => {
    rawMarkupIssuesOfSequences({ items: noFoldSequences({ artifact }), path: [] }).forEach((issue) => {
      ctx.addIssue({ code: "custom", message: issue.message, path: [...issue.path] });
    });
    checkNoBreaks({ ctx, path: ["lead"], runs: artifact.lead });
    artifact.bullets.forEach((runs, index) => {
      checkNoBreaks({ ctx, path: ["bullets", index], runs });
    });
    artifact.trailing.forEach((runs, index) => {
      checkNoBreaks({ ctx, path: ["trailing", index], runs });
    });
    checkBullets({ bullets: artifact.bullets, ctx });
    checkWidth({ artifact, ctx });
    addTopRegionIssues({ artifact, ctx, path: ["lead"], region: "lead", runs: artifact.lead });
  });
