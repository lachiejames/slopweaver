/**
 * The FORM the model fills — schema-enforced SHAPE, never content.
 *
 * What this file enforces: which sections exist, which are required, how much VISIBLE text each may
 * hold, and how many rows a table may have. What it deliberately does NOT enforce: anything about the
 * words. The send seams separately check authored prose against private exact rules while excluding quoted
 * and technical material. Keeping that policy outside this schema preserves the old system's lesson: a
 * whole-artifact scan blocked legitimate work such as a quoted ticket title containing an em-dash.
 *
 * The bot lane has a seam of its own, and the lesson is what shapes
 * it: `../../cli/aboveFoldDoor.ts` reads the `tldr` and each `index` line and NOTHING in `detail`, so the
 * quoted title that taught this survives as long as it sits below the fold, which is where a quote belongs.
 *
 * Citations are ADVISORY by owner decision: three of the four confirmed reference messages carry
 * none, so requiring them would reject the author's own blessed work. `--dry-run` warns instead, and
 * nothing is ever rejected at send time for lacking one. **Declaring one is not advisory.** A citation
 * that reaches this form is rendered as an inline `[n]` link or the send is REFUSED — never accepted and
 * dropped, which used to silence the `no-citations` advisory while showing the reader nothing. See
 * `./citationMarkers.ts`.
 *
 * Every cap below is justified against measurements taken from real reference messages, cited inline.
 *
 * ## Unknown keys are REFUSED — everywhere, with no exception
 *
 * Every form here is declared with {@link strictForm}, so a key nobody declared is a hard rejection that names
 * the key and the nearest valid field. The reason is concrete: a poll was posted carrying `mentions:` where the
 * field is called `ping:`, and because a plain `z.object` DROPS unknown keys it validated clean, rendered clean
 * in `--dry-run`, posted fine, and the ping simply was not there. No error anywhere.
 *
 * This file used to state the rule as **"refuse where a human authors, strip where a model fills unattended"**,
 * and `digest.ts` was the strip side of it — the argument being that an invented field is noise on an
 * unattended run, and that a hard rejection would cost the whole scheduled digest.
 *
 * Field use refuted it. A ported alert payload reached the digest form carrying `impact`, `rootCause`,
 * `fixStep` and a `citations` array; all four were dropped, and the card posted without the substance that was
 * its entire point, at exit 0, with nothing anywhere saying so. The flaw in the old rule is that nothing at
 * parse time can distinguish an invented field from a mistyped one, so "strip" always resolves to "guess, and
 * guess silently". Unattended is not the case for MORE tolerance — it is the case where nobody is watching, so
 * a dropped field is not a smaller failure there but an invisible one. A refused send is loud and retryable.
 *
 * The rule, restated: **refuse everywhere, and say what the key probably meant.** See `../strictForm.ts`.
 */
import { z } from "zod";

import {
  BULLETS_MAX_ITEMS,
  DETAIL_PROSE_VISIBLE_MAX,
  TABLE_MAX_COLUMNS,
  TABLE_MAX_ROWS,
  TLDR_VISIBLE_MAX,
} from "../assistant/contentLimits.js";
import { strictForm } from "../strictForm.js";
import { addOpeningIssue, openingDeclarationSchema } from "./channelOpening.js";
import {
  citationIssuesOfForm,
  citationMarkerIssuesOfText,
  citationsAfterTruncation,
  citationsInReadingOrder,
  citedIdsInReadingOrder,
  typeCitationMarkersInDetail,
  typeCitationMarkersInSequences,
} from "./citationMarkers.js";
import { checkCitationRefs } from "./citationRefs.js";
import { checkDetailBlock } from "./detailBlockChecks.js";
import { INDEX_STYLES, introIssues, introSchema, orderedIndexIssues } from "./introAndRank.js";
import { addProblemReachIssue, problemDeclarationSchema } from "./problemReach.js";
import { clickableUrlSchema, runsSchema } from "./runSchema.js";
import { truncatedSendRefusalMessage, truncateFormForCaps } from "./truncate.js";
import { truncatedSendAllowed } from "./truncatedSendHatch.js";
import {
  rawMarkupIssuesOfDetail,
  rawMarkupIssuesOfSequences,
  rawMarkupIssuesOfText,
  typeRawMarkupInDetail,
  typeRawMarkupInSequences,
} from "./typedRuns.js";
import { type CitationWidth, type DetailBlock, type IndexStyle, type InlineRun, type UpdateArtifact } from "./types.js";
import { visibleLengthOfDetail, visibleLengthOfRuns } from "./visibleLength.js";

/**
 * The lead/paragraph/bullet/table/prose caps used to live here as literals. `../assistant/answerForm.ts`'s
 * `answer` arm needs the SAME measured ceilings, so they now live in `../assistant/contentLimits.ts` — the one
 * place either surface's cap is a literal — and this file imports and re-exports them so nothing importing
 * them from here has to change.
 */
export {
  BULLET_ITEM_VISIBLE_MAX,
  BULLETS_MAX_ITEMS,
  DETAIL_PROSE_VISIBLE_MAX,
  PARAGRAPH_VISIBLE_MAX,
  TABLE_CELL_VISIBLE_MAX,
  TABLE_MAX_COLUMNS,
  TABLE_MAX_ROWS,
  TLDR_VISIBLE_MAX,
} from "../assistant/contentLimits.js";
export { inlineRunSchema } from "./runSchema.js";

/**
 * How many lines the above-the-fold index may carry: nine, so the TL;DR plus the index is TEN authored lines.
 *
 * The index is the ONLY part of the card whose length a reader cannot escape — it is above the fold by
 * construction, so it is the one region where a cap is protecting the reader rather than the author. Nine is
 * the team's own feedback that the card was too short above the fold: people would rather see more above the
 * fold than have to expand, up to about ten lines, while keeping a below-the-fold for extras.
 */
export const INDEX_MAX_ITEMS = 9;

/** One index line stays a line. Same bound as a table cell, for the same reason: it holds a value, not prose. */
export const INDEX_ITEM_VISIBLE_MAX = 120;

/**
 * The widest an index line may be ON AVERAGE across a full above-the-fold region.
 *
 * The reference is a five-line card whose index lines are 49, 107, 79, 112 and 68 visible characters, a mean of
 * 83, and 100 is that mean with room for the two lines that run past it. Repro: the synthetic fixture
 * `src/__tests__/fixtures/aboveFold/compliance-standup-card.json`, written to those widths, and
 * `yarn vitest run --config config/vitest/unit.ts aboveFoldMeasure`, which asserts those widths.
 */
export const INDEX_LINE_AVERAGE_VISIBLE = 100;

/**
 * The whole above-the-fold region: the TL;DR plus every index line — a full TL;DR plus nine average lines.
 *
 * Deliberately below what the per-item caps alone permit (180 + 9x120 = 1260), so a card cannot fill every line
 * to its limit and turn ten scannable lines into a wall. It is NOT a Slack fold threshold: the client draws its
 * Show more on the attachment wrapper by height, which only `slopweaver slack shot` answers (`../slack/noFold.ts`).
 *
 * The no-fold form's whole-message cap is `PARAGRAPH_VISIBLE_MAX`, not this number (`./noFoldSchema.ts`).
 */
export const ABOVE_FOLD_VISIBLE_MAX = TLDR_VISIBLE_MAX + INDEX_MAX_ITEMS * INDEX_LINE_AVERAGE_VISIBLE;

/**
 * Past this much prose the detail MUST contain a bullets or table sub-block. This is the rule that
 * actually captures what the owner disliked: consecutive prose with no structural break. It sits
 * below the 1091-character wall and above a single long-but-liked paragraph.
 */
export const STRUCTURE_REQUIRED_VISIBLE_THRESHOLD = 900;

const paragraphDetailSchema = strictForm({ runs: runsSchema, type: z.literal("paragraph") });

// `items` carries no `.max(BULLETS_MAX_ITEMS)` here: an over-count list is refused via `truncateUpdateArtifact`
// (computed by dropping from the tail, then refused unless a `truncated-send` grant is live) — see
// `./truncate.ts`. `.min(1)` stays: a bullets/list block with zero items is a shape error truncation cannot
// fix by definition, since dropping the last item means dropping the block.
const bulletsDetailSchema = strictForm({
  items: z.array(runsSchema).min(1),
  type: z.literal("bullets"),
});

/** Structurally identical to bullets — same item bound, no count cap, for the same reason — only the render drops the glyph. */
const listDetailSchema = strictForm({
  items: z.array(runsSchema).min(1),
  type: z.literal("list"),
});

const tableColumnSettingSchema = strictForm({
  align: z.enum(["left", "center", "right"]).optional(),
  wrap: z.boolean().optional(),
});

const tableDetailSchema = strictForm({
  columnSettings: z.array(tableColumnSettingSchema).max(TABLE_MAX_COLUMNS).optional(),
  // A column header may be EMPTY — `.min(1)` here rejected `["", "Issue", "24h", "State"]`, and a severity
  // column legitimately has nothing to say in its header. The ARRAY still needs one entry: a table with no
  // columns has no rows either, and `checkTableWidths` would then demand zero-cell rows.
  columns: z.array(z.string().max(80)).min(1).max(TABLE_MAX_COLUMNS),
  // `.max(TABLE_MAX_ROWS)` deliberately absent — an over-count table is refused via `truncateUpdateArtifact`
  // (computed by dropping rows from the tail, then refused unless a `truncated-send` grant is live).
  // `.min(1)` stays: zero rows is a shape error, not a count overage.
  rows: z.array(z.array(runsSchema).min(1).max(TABLE_MAX_COLUMNS)).min(1),
  type: z.literal("table"),
});

/** One detail sub-block. */
export const detailBlockSchema = z.discriminatedUnion("type", [
  paragraphDetailSchema,
  bulletsDetailSchema,
  tableDetailSchema,
  listDetailSchema,
]);

/** A citation. `sourceRef` is unused in PR5 and exists so PR10 need not widen the type later. */
export const citationSchema = strictForm({
  id: z.string().min(1),
  label: z.string().regex(/^\[\d+\]$/, "a citation label must look like [1]"),
  sourceRef: strictForm({ id: z.string().min(1), source: z.string().min(1) }).optional(),
  url: z.url(),
});

const primaryLinkSchema = strictForm({ label: z.string().min(1).max(80), url: clickableUrlSchema });

/**
 * The above-the-fold PER-LINE bound only: an index line that is itself prose rather than a one-liner. The
 * WHOLE-REGION bound (lead + every index line, against {@link ABOVE_FOLD_VISIBLE_MAX}) is checked by
 * computing what `./truncate.ts`'s `capIndex`/`../assistant/answerForm.ts`'s `truncateAnswerForm` WOULD
 * drop, before this refinement ever runs, and REFUSING by default when anything would be, so an over-count
 * or over-width region never reaches this function except by way of the `truncated-send`
 * grant. What this function still refuses unconditionally, with no break-glass at all, is the case
 * truncation cannot fix without cutting mid-sentence: one line that is, by itself, too long to be a line.
 *
 * Shared by `updateArtifactSchema` (the operator card) and `../assistant/answerForm.ts`'s `answerFormSchema`
 * so the cap and the message live in exactly one place — doctrine rule 7's no-walls-of-text bound is
 * enforced by this schema, and a second copy would let a change to one form silently miss the other.
 *
 * @param index the above-the-fold index lines to check
 * @param indexStyle how the index renders; an `ordered` one must open every line with a colour
 * @param citations the artifact's citations, used to resolve a `[n]` chip's width
 * @param ctx the Zod refinement context to report an over-width line to
 * @param belowFoldLabel what the caller's below-the-fold region is called, e.g. `"detail"` or `"body"`
 */
export function checkIndex({
  index,
  indexStyle,
  citations,
  ctx,
  belowFoldLabel,
}: {
  index: readonly (readonly InlineRun[])[];
  indexStyle: IndexStyle | undefined;
  citations: readonly CitationWidth[];
  ctx: z.RefinementCtx;
  belowFoldLabel: string;
}): void {
  orderedIndexIssues({ index, indexStyle }).forEach((issue) => {
    ctx.addIssue({ code: "custom", message: issue.message, path: [...issue.path] });
  });
  index.forEach((item, itemIndex) => {
    const width = visibleLengthOfRuns({ citations, runs: item });
    if (width > INDEX_ITEM_VISIBLE_MAX) {
      ctx.addIssue({
        code: "custom",
        message:
          `index line ${String(itemIndex)} is ${String(width)} visible chars, over the ` +
          `${String(INDEX_ITEM_VISIBLE_MAX)} cap — an index line is a scannable one-liner, and the ` +
          `substance belongs in the ${belowFoldLabel} below the fold.`,
        path: ["index", itemIndex],
      });
    }
  });
}

/**
 * The whole-artifact STRUCTURE-required rule only. The total-PROSE bound against
 * {@link DETAIL_PROSE_VISIBLE_MAX} is checked by computing what `./detailProseCap.ts`'s `capDetailProse` WOULD
 * drop, in `truncateUpdateArtifact` — called from `updateArtifactSchema`'s `.transform()` before this
 * refinement ever runs — and REFUSING by default when anything would be, so an over-prose detail never
 * reaches this function except by way of the `truncated-send` grant. What this
 * function still refuses unconditionally, with no break-glass at all, is a SHAPE problem truncation does not
 * touch: a wall of unbroken prose past {@link STRUCTURE_REQUIRED_VISIBLE_THRESHOLD} with no bullets/table
 * break in it, which is a formatting defect regardless of total length.
 */
function checkDetailWhole({
  detail,
  citations,
  ctx,
}: {
  detail: readonly DetailBlock[];
  citations: readonly CitationWidth[];
  ctx: z.RefinementCtx;
}): void {
  const prose = visibleLengthOfDetail({ citations, detail });
  const structured = detail.some(
    (block) => block.type === "bullets" || block.type === "table" || block.type === "list",
  );
  if (prose > STRUCTURE_REQUIRED_VISIBLE_THRESHOLD && !structured) {
    ctx.addIssue({
      code: "custom",
      message:
        `detail is ${prose} visible chars of unbroken prose; past ` +
        `${STRUCTURE_REQUIRED_VISIBLE_THRESHOLD} it must include a bullets or table sub-block`,
      path: ["detail"],
    });
  }
}

/**
 * Why an empty `detail` is refused, in the caller's own vocabulary rather than Zod's.
 *
 * Every other refusal in this file names the measurement, the cap and the JSON path; `.min(1)` alone
 * emitted `Too small: expected array to have >=1 items`, which tells an author nothing about WHY one is
 * needed. The reason is that a card with a `Details` label and nothing behind it was rejected by eye, so
 * the detail is what the label points at. It is NOT to force a fold — that reading rested on the
 * block-count rule since retracted (`../slack/preview.ts`), and a message that must not fold at
 * all is a different form entirely (`./noFoldSchema.ts`).
 */
const DETAIL_EMPTY_MESSAGE =
  "detail is 0 sub-blocks, under the minimum of 1 — a card's `Details` label must point at something, and " +
  "an empty one was rejected by eye. Add a paragraph, bullets or table sub-block at detail[0]. If the " +
  'message genuinely has nothing to put below, it is not a card: send `{"kind":"no-fold"}` instead.';

/**
 * CONVERT before anything measures: every bare URL and every raw `<@U…>` in a text run becomes the typed
 * run that actually renders, and so does every `[n]` citation marker. See `./typedRuns.ts` and
 * `./citationMarkers.ts` for the two classes this closes.
 *
 * It runs BEFORE {@link truncateUpdateArtifact} because conversion changes visible width — a
 * `<https://x|Ship it>` costs 21 characters as literal text and 7 as a link — so measuring first would
 * refuse a card for text no reader was ever going to see. A citation chip costs exactly its own `[n]`
 * label, so that half moves no width at all; it runs here to keep both conversions in one place.
 *
 * Markers are typed AFTER the raw-markup pass so a marker sitting inside converted text is still seen, and
 * the citations are renumbered LAST, once every chip that will exist does.
 *
 * @param artifact the parsed artifact, exactly as composed
 * @returns the artifact with `detail` and `index` typed and its citations numbered in reading order;
 *   byte-identical when it carried no raw markup and no misplaced marker
 */
function typeUpdateArtifactMarkup(artifact: UpdateArtifact): UpdateArtifact {
  const detail = typeCitationMarkersInDetail({
    citations: artifact.citations,
    detail: typeRawMarkupInDetail({ detail: artifact.detail }),
  });
  const index = typeCitationMarkersInSequences({
    citations: artifact.citations,
    items: typeRawMarkupInSequences({ items: artifact.index }),
  });
  return {
    ...artifact,
    citations: citationsInReadingOrder({ citations: artifact.citations, detail, index }),
    detail,
    index,
  };
}

/**
 * REFUSE whatever conversion could not type: a channel or user-group reference, anything in a
 * plain-STRING field that has no run to become, a `[n]` marker naming no declared citation, and a citation
 * no chip points at.
 *
 * The pair is the whole design. Conversion handles what this vocabulary can express, and this refuses the
 * rest rather than letting a reader be shown an id — `../slack/typedRunsOnly.ts` then backs it up at the
 * wire, for the payloads that never came through a form at all. The citation half is the same shape, one
 * class later: see `./citationMarkers.ts` for the card it was measured on. (`checkCitationRefs` is its
 * mirror image and stays separate — that one catches a chip pointing at a citation that does not exist.)
 */
function checkRawMarkup({ artifact, ctx }: { artifact: UpdateArtifact; ctx: z.RefinementCtx }): void {
  const { intro = [] } = artifact;
  const issues = [
    ...intro.flatMap((text, line) => [
      ...rawMarkupIssuesOfText({ path: ["intro", line], text }),
      ...citationMarkerIssuesOfText({ citations: artifact.citations, path: ["intro", line], text }),
    ]),
    ...rawMarkupIssuesOfText({ path: ["tldr"], text: artifact.tldr }),
    ...rawMarkupIssuesOfDetail({ detail: artifact.detail, path: ["detail"] }),
    ...rawMarkupIssuesOfSequences({ items: artifact.index, path: ["index"] }),
    ...citationIssuesOfForm({
      citations: artifact.citations,
      detail: artifact.detail,
      detailPath: ["detail"],
      index: artifact.index,
      lead: artifact.tldr,
      leadPath: ["tldr"],
      uncited: true,
    }),
  ];
  issues.forEach((issue) => {
    ctx.addIssue({ code: "custom", message: issue.message, path: [...issue.path] });
  });
}

/**
 * REFUSE an `update` artifact whose `detail`/`index` is over a count/aggregate cap, unless the
 * `truncated-send` grant is live — see `./truncate.ts`'s module doc for which caps
 * this covers, which stay hard refusals unconditionally, and why the default is refuse rather than
 * truncate-and-post. `updateArtifactSchema` has no `BODY_MAX_BLOCKS`-style total-block-count cap (only the
 * answer form does), so `maxDetailBlocks` is left unset.
 *
 * @param artifact the parsed, pre-truncation artifact
 * @param ctx the transform's refinement context, used to refuse rather than silently post truncated content
 * @returns the artifact with `detail`/`index` truncated in place ONLY when the break-glass is set; the
 *   original artifact, unchanged, when refusing (an added issue fails the parse regardless of the return
 *   value) or when nothing was over cap to begin with. On the break-glass path the citations are repaired
 *   for what survived — see `./citationMarkers.ts`'s `citationsAfterTruncation`
 */
function truncateUpdateArtifact(artifact: UpdateArtifact, ctx: z.RefinementCtx): UpdateArtifact {
  const citedBefore = citedIdsInReadingOrder({ detail: artifact.detail, index: artifact.index });
  const capped = capUpdateArtifact({ artifact });
  if (!capped.truncated) {
    return artifact;
  }
  if (!truncatedSendAllowed({ env: process.env })) {
    const message = truncatedSendRefusalMessage({ overages: capped.overages });
    ctx.addIssue({ code: "custom", message, path: ["detail"] });
    return artifact;
  }
  const { detail, index } = capped;
  const citations = citationsAfterTruncation({ citations: artifact.citations, citedBefore, detail, index });
  return { ...artifact, citations, detail, index };
}

/**
 * Whether a card's count and aggregate caps hold with NOTHING truncated, whatever the environment says.
 *
 * `updateArtifactSchema` accepts an over-cap card when this session holds a `truncated-send` grant,
 * by truncating it. A caller deciding what to leave OFF a card so that nothing gets cut — the recommendations
 * lane sheds its own lines to fit — needs the answer without that override, or it would keep a line the send
 * then silently drops.
 *
 * @param artifact the derived card
 * @returns true when no cap would cut anything
 */
export function updateArtifactFitsUntruncated({ artifact }: { artifact: UpdateArtifact }): boolean {
  return !capUpdateArtifact({ artifact }).truncated;
}

/** The one call that measures an update card against its count and aggregate caps. */
function capUpdateArtifact({ artifact }: { artifact: UpdateArtifact }): ReturnType<typeof truncateFormForCaps> {
  return truncateFormForCaps({
    citations: artifact.citations,
    detail: artifact.detail,
    field: "detail",
    index: artifact.index,
    leadLength: artifact.tldr.length,
    maxAboveFold: { cap: "ABOVE_FOLD_VISIBLE_MAX", limit: ABOVE_FOLD_VISIBLE_MAX },
    maxBulletItems: { cap: "BULLETS_MAX_ITEMS", limit: BULLETS_MAX_ITEMS },
    maxIndexItems: { cap: "INDEX_MAX_ITEMS", limit: INDEX_MAX_ITEMS },
    maxProse: { cap: "DETAIL_PROSE_VISIBLE_MAX", limit: DETAIL_PROSE_VISIBLE_MAX },
    maxTableRows: { cap: "TABLE_MAX_ROWS", limit: TABLE_MAX_ROWS },
  });
}

/**
 * The `update` artifact — the only kind PR5 builds. `detail` is required and non-empty because a card
 * that does not fold was rejected by eye, and the fold needs a sixth block to exist.
 */
export const updateArtifactSchema = z
  .strictObject({
    citations: z.array(citationSchema).default([]),
    detail: z.array(detailBlockSchema).min(1, DETAIL_EMPTY_MESSAGE),
    // `.max(INDEX_MAX_ITEMS)` deliberately absent — an over-count index is refused via `truncateUpdateArtifact`
    // below, which computes the truncated shape rather than a raw Zod `.max()` refusal, so it can name exactly
    // how much was over and offer the `truncated-send` grant in the same message.
    index: z.array(runsSchema).default([]),
    indexStyle: z.enum(INDEX_STYLES).optional(),
    // The day-one intro sits OUTSIDE `ABOVE_FOLD_VISIBLE_MAX`: it rides one post per channel, and counting it would
    // make a derived card near the region cap refuse on exactly its first, unattended firing.
    intro: introSchema.optional(),
    kind: z.literal("update"),
    media: z.array(z.string().min(1)).default([]),
    opening: openingDeclarationSchema.optional(),
    primaryLink: primaryLinkSchema.optional(),
    problem: problemDeclarationSchema.optional(),
    tldr: z.string().min(1),
  })
  .transform(typeUpdateArtifactMarkup)
  .transform(truncateUpdateArtifact)
  .superRefine((artifact, ctx) => {
    if (artifact.tldr.length > TLDR_VISIBLE_MAX) {
      ctx.addIssue({
        code: "custom",
        message: `tldr is ${artifact.tldr.length} visible chars, over the ${TLDR_VISIBLE_MAX} cap`,
        path: ["tldr"],
      });
    }
    const ids = artifact.citations.map((c) => c.id);
    if (new Set(ids).size !== ids.length) {
      ctx.addIssue({ code: "custom", message: "citation ids must be unique", path: ["citations"] });
    }
    artifact.detail.forEach((block, index) => {
      checkDetailBlock({ block, citations: artifact.citations, ctx, index });
    });
    checkCitationRefs({
      citations: artifact.citations,
      ctx,
      detail: artifact.detail,
      index: artifact.index,
    });
    checkDetailWhole({ citations: artifact.citations, ctx, detail: artifact.detail });
    const { intro = [] } = artifact;
    introIssues({ intro }).forEach((issue) => {
      ctx.addIssue({ code: "custom", message: issue.message, path: [...issue.path] });
    });
    checkIndex({
      belowFoldLabel: "detail",
      citations: artifact.citations,
      ctx,
      index: artifact.index,
      indexStyle: artifact.indexStyle,
    });
    checkRawMarkup({ artifact, ctx });
    addProblemReachIssue({ ctx, path: ["tldr"], problem: artifact.problem, region: "tldr", topText: artifact.tldr });
    // A day-one intro draws above the TL;DR, so the opening is read across both: an intro cannot precede it unseen.
    const topText = [...intro, artifact.tldr].join(" ");
    addOpeningIssue({ ctx, opening: artifact.opening, path: ["tldr"], region: "intro and tldr", topText });
  });
