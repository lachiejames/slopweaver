/**
 * The AS-ME forms: a drip of messages, a one-card post, a one-list post and the plain-body escape hatch — the shapes
 * an operator fills to post under their own name.
 *
 * Every bound here is a PARAMETER the caller supplies, never a constant. The drip, one-card and one-list bounds are
 * per-person preferences read from `profile.json`, with no measured reference corpus behind them yet, unlike the
 * update card's caps in `./schema.ts`, each measured against real reference messages. The plain body's ceiling is
 * different again: a platform's mechanical maximum message length, not a preference.
 */
import { z } from "zod";

import { strictForm } from "../strictForm.js";
import { addTopRegionIssues, openingDeclarationSchema } from "./channelOpening.js";
import { checkListDepths, listDepthsSchema } from "./listDepths.js";
import { checkCardLineBreaks, checkCardWidth, checkDripMessage } from "./messageChecks.js";
import { problemDeclarationSchema } from "./problemReach.js";
import { dripInlineRunSchema } from "./runSchema.js";
import { rawMarkupIssuesOfSequences, typeRawMarkupInDripRuns } from "./typedRuns.js";
import type { DripArtifact, DripInlineRun, OneCardArtifact, OneListArtifact, PlainArtifact } from "./types.js";

/**
 * The AS-ME drip form, bounded by the operator's OWN preferences rather than by constants.
 *
 * A factory, not a module-level schema, and that is the whole point: PR5's caps are measured against real reference
 * cards and belong in code, whereas "how long is one of my drip messages" is a PER-PERSON preference, since every
 * operator has their own. So the numbers arrive from `profile.json` and nothing person-specific is ever a literal in
 * this public repo.
 *
 * Stated honestly: unlike every cap in `./schema.ts`, these bounds have NO measured reference corpus behind
 * them yet — there is no confirmed set of as-me messages to measure. They are a starting shape, they are
 * configurable, and the belief layer (PR10) is where a learned value would eventually come from.
 *
 * The bound is on SHAPE alone. Nothing here reads the words. The caller may apply private exact rules to
 * authored prose after this schema succeeds; quoted material and technical identifiers are outside that
 * policy. This schema's only business is making a badly shaped message unexpressible.
 *
 * A SOLE message is bounded differently from a multi-message drip, and deliberately so — the rule
 * is that a proposal or discussion piece goes out as ONE top-level message, never a split
 * sequence, so the door has to have a one-message shape that is not just the conversational
 * `messageVisibleMax` raised. `soleMessageVisibleMax` is that shape's own cap; it applies ONLY when
 * `artifact.messages.length === 1` and is left unset by every caller that only ever sends multi-message
 * drips, in which case it falls back to `messageVisibleMax` and nothing about that caller's behaviour
 * changes. See `../proposal/teaser.ts`, the first caller that needs it.
 *
 * @param messageVisibleMax the visible-character ceiling for one message of a MULTI-message drip
 * @param maxMessages how many messages one drip may carry
 * @param soleMessageVisibleMax the ceiling for a drip's SOLE message; defaults to `messageVisibleMax`
 * @returns the Zod schema for a drip artifact under those bounds
 */
export function dripArtifactSchema({
  messageVisibleMax,
  maxMessages,
  soleMessageVisibleMax = messageVisibleMax,
}: {
  messageVisibleMax: number;
  maxMessages: number;
  soleMessageVisibleMax?: number;
}): z.ZodType<DripArtifact> {
  return z
    .strictObject({
      kind: z.literal("drip"),
      messages: z
        .array(strictForm({ runs: z.array(dripInlineRunSchema).min(1) }))
        .min(1)
        .max(maxMessages),
      opening: openingDeclarationSchema.optional(),
      problem: problemDeclarationSchema.optional(),
    })
    .transform((artifact): DripArtifact => ({
      ...artifact,
      // The as-me FORM lane is the path that once posted dead URLs —`--body` was always fine,
      // because a plain string is one Slack parses. See `./typedRuns.ts`.
      messages: artifact.messages.map((message) => ({
        runs: typeRawMarkupInDripRuns({ runs: message.runs }),
      })),
    }))
    .superRefine((artifact, ctx) => {
      rawMarkupIssuesOfSequences({
        items: artifact.messages.map((message) => message.runs),
        path: ["messages"],
      }).forEach((issue) => {
        ctx.addIssue({ code: "custom", message: issue.message, path: [...issue.path, "runs"] });
      });
      const soleMessage = artifact.messages.length === 1;
      // A sole message is a one-shot announce, not a conversational line, so it is bounded by its own cap
      // rather than `messageVisibleMax` — see the factory's own doc comment for why raising the latter is
      // not the fix. Every other caller leaves `soleMessageVisibleMax` unset, and its parameter default hands
      // it the old single cap.
      const cap = soleMessage ? soleMessageVisibleMax : messageVisibleMax;
      artifact.messages.forEach((message, index) => {
        // Whether this drip is ONE message decides whether the plain-body escape hatch is honest advice —
        // see `./messageChecks.ts`'s `escapeHatchHint`. The count is not knowable inside the per-message check, so it is
        // passed down rather than re-derived there.
        checkDripMessage({
          ctx,
          index,
          messageVisibleMax: cap,
          runs: message.runs,
          soleMessage,
        });
      });
      const runs = artifact.messages[0]!.runs;
      addTopRegionIssues({ artifact, ctx, path: ["messages", 0, "runs"], region: "first message", runs });
    });
}

/**
 * The AS-ME ONE-CARD form: a single message whose line breaks come from its own structure.
 *
 * The bounds differ from {@link dripArtifactSchema}'s in exactly two ways, and both follow from the shape
 * being one delivered message rather than a sequence of them:
 *
 *  1. **`cardVisibleMax` bounds the WHOLE card**, not each line. A per-line cap would be the fragmenting
 *     pressure this form exists to remove, one level down — a caller would satisfy it by adding lines.
 *  2. **A line may not contain a `\n`, and that is not the drip rule restated.** The drip refuses newlines
 *     because it has nowhere to put one; this refuses them because `lines` is where they go, so a smuggled
 *     `\n` would mean two lines the structure does not know about and the preview would under-report the
 *     card's shape.
 *
 * Everything else is deliberately the drip's: the same typed runs, the same raw-markup conversion, the same
 * raw-markup refusal. Mentions are typed runs here exactly as they are there, which is the property the
 * plain-body escape hatch could not offer.
 *
 * @param cardVisibleMax the visible-character ceiling for the WHOLE card, line breaks excluded
 * @param maxLines how many lines one card may carry
 * @returns the Zod schema for a one-card artifact under those bounds
 */
export function oneCardArtifactSchema({
  cardVisibleMax,
  maxLines,
}: {
  cardVisibleMax: number;
  maxLines: number;
}): z.ZodType<OneCardArtifact> {
  return z
    .strictObject({
      kind: z.literal("one-card"),
      lines: z
        .array(strictForm({ runs: z.array(dripInlineRunSchema).min(1) }))
        .min(1)
        .max(
          maxLines,
          `a card holds ${String(maxLines)} lines; a roster longer than that is a {"kind":"one-list"} form ` +
            "(lead, bullets, trailing), never a --body and never a voice-rules grant",
        ),
      opening: openingDeclarationSchema.optional(),
      problem: problemDeclarationSchema.optional(),
    })
    .transform((artifact): OneCardArtifact => ({
      ...artifact,
      lines: artifact.lines.map((line) => ({ runs: typeRawMarkupInDripRuns({ runs: line.runs }) })),
    }))
    .superRefine((artifact, ctx) => {
      rawMarkupIssuesOfSequences({
        items: artifact.lines.map((line) => line.runs),
        path: ["lines"],
      }).forEach((issue) => {
        ctx.addIssue({ code: "custom", message: issue.message, path: [...issue.path, "runs"] });
      });
      checkCardWidth({
        cardVisibleMax,
        ctx,
        path: ["lines"],
        sequences: artifact.lines.map((line) => line.runs),
      });
      artifact.lines.forEach((line, index) => {
        checkCardLineBreaks({ ctx, field: "lines", path: ["lines", index], runs: line.runs });
      });
      addTopRegionIssues({
        artifact,
        ctx,
        path: ["lines", 0, "runs"],
        region: "first line",
        runs: artifact.lines[0]!.runs,
      });
    });
}

/**
 * The AS-ME ONE-LIST form: a lead line, a real bulleted list and the lines that close it, in ONE message.
 *
 * Three fields rather than one line list, and the split is the reason the form exists at all. A one-card
 * `line` is a paragraph and the renderer double-spaces every one of them, which is right for three ideas and
 * a wall for ten; `bullets` is the field Slack draws its own glyph in front of and renders single-spaced.
 * A caller that had to say per line which it wanted would eventually say it inconsistently, so the STRUCTURE
 * says it — the same reasoning `./noFoldSchema.ts`'s `noFoldArtifactSchema` split rests on.
 *
 * The bounds are {@link oneCardArtifactSchema}'s, and identically so:
 *
 *  1. **`cardVisibleMax` bounds the WHOLE message**, lead, bullets and trailing together. A per-field cap
 *     would be the fragmenting pressure this form exists to remove, one level down.
 *  2. **No entry may contain a `\n`**, because the fields are where the breaks go — a smuggled one would be
 *     a line the structure does not know about and the preview would under-report the message's shape.
 *
 * `maxBullets` is a bound of its own rather than a share of `maxLines`, because a roster's length is a
 * property of the world it reports: ten open pull requests is ten dot points whether or not the lead and the
 * closing lines happen to be short. The caller supplies it for the same reason every other bound here is a
 * parameter — this module may not know which surface is asking. It counts headlines: an optional `depths`
 * nests a dot point one level under the headline above it, and a sub-point is part of that dot point.
 *
 * @param cardVisibleMax the visible-character ceiling for the WHOLE message, line breaks excluded
 * @param maxBullets how many headline dot points one list may carry
 * @param maxTrailing how many lines may follow the list
 * @returns the Zod schema for a one-list post under those bounds
 */
export function oneListArtifactSchema({
  cardVisibleMax,
  maxBullets,
  maxTrailing,
}: {
  cardVisibleMax: number;
  maxBullets: number;
  maxTrailing: number;
}): z.ZodType<OneListArtifact> {
  const sequence = z.array(dripInlineRunSchema).min(1);
  return z
    .strictObject({
      bullets: z.array(sequence).min(1),
      depths: listDepthsSchema,
      kind: z.literal("one-list"),
      lead: sequence,
      opening: openingDeclarationSchema.optional(),
      problem: problemDeclarationSchema.optional(),
      trailing: z.array(sequence).max(maxTrailing),
    })
    .transform((artifact): OneListArtifact => ({
      ...artifact,
      bullets: artifact.bullets.map((runs) => typeRawMarkupInDripRuns({ runs })),
      lead: typeRawMarkupInDripRuns({ runs: artifact.lead }),
      trailing: artifact.trailing.map((runs) => typeRawMarkupInDripRuns({ runs })),
    }))
    .superRefine((artifact, ctx) => {
      checkListDepths({ artifact, ctx, maxBullets });
      oneListFields({ artifact }).forEach(({ field, index, runs }) => {
        rawMarkupIssuesOfSequences({ items: [runs], path: [field] }).forEach((issue) => {
          ctx.addIssue({ code: "custom", message: issue.message, path: [field, index, "runs"] });
        });
        checkCardLineBreaks({ ctx, field, path: [field, index], runs });
      });
      checkCardWidth({
        cardVisibleMax,
        ctx,
        path: ["bullets"],
        sequences: oneListFields({ artifact }).map((entry) => entry.runs),
      });
      addTopRegionIssues({ artifact, ctx, path: ["lead"], region: "lead", runs: artifact.lead });
    });
}

/**
 * Every run sequence a one-list post holds, each tagged with the field and position it came from.
 *
 * One traversal used by every check, so a field added to the form is a refusal that fires everywhere rather
 * than in whichever checks remembered it. `lead` is one sequence and reports index 0 so a caller reading a
 * refusal path sees the same shape for all three fields.
 *
 * @param artifact the transformed one-list post
 * @returns the sequences in render order: lead, then bullets, then trailing
 */
function oneListFields({ artifact }: { artifact: OneListArtifact }): readonly {
  readonly field: "lead" | "bullets" | "trailing";
  readonly index: number;
  readonly runs: readonly DripInlineRun[];
}[] {
  return [
    { field: "lead" as const, index: 0, runs: artifact.lead },
    ...artifact.bullets.map((runs, index) => ({ field: "bullets" as const, index, runs })),
    ...artifact.trailing.map((runs, index) => ({ field: "trailing" as const, index, runs })),
  ];
}

/**
 * The plain-body escape hatch: one message, exactly the given bytes.
 *
 * Bounded ONLY by a MECHANICAL ceiling the caller supplies — the target platform's own maximum message
 * length, so an over-long body fails locally instead of as a 400. There is deliberately no length
 * preference, no sectioning and no newline rule: this is the opt-out, and an opt-out that still enforced
 * the thing being opted out of would be a lie.
 *
 * The ceiling is a PARAMETER rather than a constant because it is a per-platform fact (Slack's is 40,000
 * characters), and this module may not know anything about a platform — that is the same boundary the
 * import list enforces.
 *
 * @param maxChars the target platform's maximum message length
 * @returns the Zod schema for a plain-body artifact under that ceiling
 */
export function plainArtifactSchema({ maxChars }: { maxChars: number }): z.ZodType<PlainArtifact> {
  return strictForm({
    kind: z.literal("plain"),
    text: z
      .string()
      .min(1, "a plain body cannot be empty")
      .max(maxChars, `this platform caps a message at ${String(maxChars)} characters`),
  });
}
