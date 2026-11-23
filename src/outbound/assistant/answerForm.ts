/**
 * The assistant's answer FORM — schema-enforced SHAPE for the answer the bot posts as itself through
 * `turn answer`/`turn resume`. Same doctrine as `../artifact/schema.ts`: this file constrains which sections
 * exist and how much they may hold, never the words inside them.
 *
 * ## There is no other way in
 *
 * {@link answerFormSchema} is ONE arm, `kind: "answer"`, and every object in it is declared with
 * `../strictForm.ts`'s `strictForm`. It describes only what a live verb can send: a post under the owner's own name goes
 * through `slack post --as me`'s own forms (`../../cli/commands/slack/asMeForm.ts`), never through this
 * one, so a `kind` other than `answer`
 * is refused at parse time rather than parsed into a shape nothing posts. A looser arm, or a raw-block
 * escape hatch on this one, would let a caller emit exactly the shapes this module exists to make
 * unrepresentable. If a second kind is ever needed, it is added here as a typed arm with the verb that sends
 * it — never as a passthrough on the existing one.
 *
 * ## Two ATTACHMENT lanes, and they are not interchangeable
 *
 * An `answer` carries `./answerArm.ts`'s `answerImagesSchema` for the pictures a claim STANDS ON, and
 * its `answerDocumentsSchema` for the DELIVERABLE a question asked for. They stay apart all the way to
 * the wire (`../../corpus/slack/writeSend.ts`) because only one of them is visual evidence: an image passes
 * `../../visualEvidence/admitUploads.ts`'s whole-batch admission and carries a reviewer's own observations,
 * and a markdown file has neither and never should. Adding a document to the `images` array would refuse
 * the whole send with `IMAGE_RECORD_MISSING` — correctly, since no image record can exist for bytes that
 * are not an image.
 *
 * ## What is unrepresentable, and why
 *
 * No type in this file carries `attachments`, `blocks`, `container`, `button`, `actions`, a colour, a
 * banner, a byline, or any raw-block passthrough (`extra`, `passthrough`, `blocks?: KnownBlock[]`). A
 * renderer that accepts arbitrary blocks can emit anything, and "anything" includes shapes the owner has
 * already rejected by eye — a top-level `task_card` is one (`./turnMessage.ts`'s `turnContentBlock` records it).
 *
 * ## Two fields that were considered and ruled out — do not re-add them
 *
 * `provenance` has no `sessionUrl` and no cost field. Both were raised and rejected by the owner: the
 * session link because it points at a local terminal session nobody else can open, and the cost because it
 * was raised and then withdrawn. Neither is "missing" — a field that does not exist cannot be
 * filled in wrongly, which is the entire point of a typed form over a loose one. Do not add either back "for
 * completeness".
 *
 * ## Grounding — how an `answer` arm says what actually produced it
 *
 * An `answer` is grounded one of three ways, and `./answerGrounding.ts`'s `answerGroundingSchema` is a `z.discriminatedUnion`:
 * `conversation` (context and judgement alone — no live source matched), `verb` (a live command or
 * repository check), `unreachable` (nothing could establish the answer). No live turn ever loads the
 * corpus, so all three are session-authored alike: each carries its own `evidence`
 * (`read`/`consultedEmpty`/`couldNotSee`) and the SAME `executionProvenanceSchema`, because there is no
 * independent oracle for any of the three the way a `CoverageManifest` once was for a corpus route — the
 * session genuinely is the only witness. `read`/`consultedEmpty` lines carry an OPTIONAL url: a live
 * investigation often reads a whole surface — "the working checkout", `git log` — that has no single
 * address, and forcing a fabricated one would be the exact dishonesty this form exists to prevent.
 *
 * ## Citations — the SAME `[n]` chip mechanism the operator card uses, hardened
 *
 * `answerArmSchema` grounds citations through the operator card's own `citationSchema`/`CitationRun`
 * mechanism (`../artifact/schema.ts`), reused rather than re-invented: a `citations: Citation[]` array,
 * referenced from `body` by structural `{type:"citation", citationId}` runs. Three checks close the gaps an
 * adversarial review found in that reuse:
 *
 * 1. Every citation id is unique (the same check `updateArtifactSchema` makes).
 * 2. Every citation RUN in `body` resolves to a defined citation — the same shape `checkCitationRefs`
 *    enforces for the operator card, so an unresolved chip is refused here rather than throwing at render.
 * 3. Every DEFINED citation is referenced by at least one run — an unused definition would let a reply
 *    inflate its apparent evidence without attaching it to any claim.
 *
 * `sourceRef` stays optional on `citationSchema` (it is shared with the operator card, which never required
 * it, and no live grounding kind here has an independent record set to check one against any more).
 *
 * ## `index` — the operator card's above-the-fold ranking, reused rather than re-invented
 *
 * `answerArmSchema.index` is the SAME shape `updateArtifactSchema.index` uses: an array of run sequences,
 * each optionally ending in its own `[n]` citation chip. This is what lets a rich-form capability (a
 * ranked-findings card, say) give every row its own citation instead of collapsing the whole card onto one
 * shared reference — the exact defect a caller bypassing `turn answer` to post the card's raw JSON directly
 * exists to route around. It defaults to empty, so a plain prose answer is unaffected. `indexStyle` matches
 * `updateArtifactSchema`'s own field — bullets by default, `plain` for an unordered list.
 */
import type { z } from "zod";

import { type HatchId, hatchFor } from "../../hatch/lookup.js";
import { hatchOpen } from "../../hatch/open.js";
import { hatchIncantation } from "../../hatch/types.js";
import { err, ok, type Result } from "../../lib/result.js";
import {
  bareRefIssuesOfDetail,
  bareRefIssuesOfSequences,
  linkifyDetail,
  linkifySequences,
} from "../artifact/bareRefRuns.js";
import {
  citationIssuesOfForm,
  citationsAfterTruncation,
  citationsInReadingOrder,
  citedIdsInReadingOrder,
  typeCitationMarkersInDetail,
  typeCitationMarkersInSequences,
} from "../artifact/citationMarkers.js";
import { ABOVE_FOLD_VISIBLE_MAX, checkIndex, INDEX_MAX_ITEMS } from "../artifact/schema.js";
import { truncatedSendRefusalMessage, truncateFormForCaps } from "../artifact/truncate.js";
import { truncatedSendAllowed } from "../artifact/truncatedSendHatch.js";
import { typeRawMarkupInDetail, typeRawMarkupInSequences } from "../artifact/typedRuns.js";
import type { InlineRun } from "../artifact/types.js";
import {
  type BareRefContext,
  type BareRefIssue,
  bareRefIssuesOfPlainText,
  bareRefIssuesOfUnlinkableText,
  contextAnchoredToUrls,
} from "../linkify/bareRefs.js";
import { BARE_REFS_HATCH, bareRefsEscapeSentence } from "../linkify/bareRefsHatch.js";
import { answerArmSchema } from "./answerArm.js";
import { checkBodyBlock, checkCitations } from "./answerBodyChecks.js";
import { rawMarkupIssuesOfAnswer } from "./answerMarkupChecks.js";
import { CONTROL_CITATION_HATCH, citationBudgetCollision, uncitedControlIssues } from "./citedAndShown.js";
import {
  BODY_MAX_BLOCKS,
  BULLETS_MAX_ITEMS,
  DETAIL_PROSE_VISIBLE_MAX,
  TABLE_MAX_ROWS,
  TLDR_VISIBLE_MAX,
} from "./contentLimits.js";
import { answerPictureRefusals } from "./graphFindingFloor.js";
import { groundingProse } from "./groundingRefs.js";
import {
  duplicateMeasurementIssues,
  UNMEASURED_FIGURES_HATCH,
  unmeasuredFigureIssues,
  unusedMeasurementIssues,
} from "./measuredFigures.js";
import { smallSampleRefusals } from "./smallSamples.js";

/** The parsed `answer` arm — the shape `turn answer` consumes end to end. */
export type AnswerFormAnswer = z.infer<typeof answerArmSchema>;

/** Every URL one run sequence carries in its `link` runs. */
function urlsOfRuns({ runs }: { runs: readonly InlineRun[] }): readonly string[] {
  return runs.flatMap((run) => (run.type === "link" ? [run.url] : []));
}

/**
 * Every URL the answer ALREADY carries structurally — link runs in the body and index, and the citations —
 * read BEFORE linkifying, so the pass can anchor a bare `#N` to the repository the answer itself names.
 */
function urlsOfAnswer({ answer }: { answer: AnswerFormAnswer }): readonly string[] {
  const ofSequences = ({ items }: { items: readonly (readonly InlineRun[])[] }): readonly string[] =>
    items.flatMap((runs) => urlsOfRuns({ runs }));
  const ofBody = answer.body.flatMap((block): readonly string[] => {
    switch (block.type) {
      case "paragraph":
        return urlsOfRuns({ runs: block.runs });
      case "bullets":
      case "list":
        return ofSequences({ items: block.items });
      case "table":
        return block.rows.flatMap((row) => ofSequences({ items: row }));
      default:
        // Unreachable: `DetailBlock` is a closed union and every member is handled above. The branch
        // exists because the lint rule reads the switch syntactically and cannot see that.
        return [];
    }
  });
  return [...ofBody, ...ofSequences({ items: answer.index }), ...answer.citations.map((citation) => citation.url)];
}

/**
 * Resolve every `#N`/`owner/repo#N`/`SUP-N` in a validated answer into a real link.
 *
 * Runs AFTER `answerFormSchema`'s own raw-markup conversion (`typeRawMarkupInDetail` et al., inside its
 * `.transform()`), so a URL or mention is already typed by the time this looks for a bare reference —
 * matching the ordering every other outbound door uses. `lead` is a plain string with nowhere to put a
 * `link` run, so a reference there is residue by construction, exactly as `tldr` is on the operator card.
 *
 * The grounding's own authored prose is scanned the same way and for the same reason — it renders to the
 * reader in the Details fold, and it has no run vocabulary either, so every reference in it is residue.
 * `./groundingRefs.ts` decides which strings those are; leaving them out passed a real answer carrying ten
 * bare references below the fold against one above it.
 *
 * @param answer the validated `answer` arm
 * @param context what this turn's bare references can resolve against
 * @returns the linkified answer, plus every reference still bare afterward
 */
function linkifyAnswerArm({ answer, context }: { answer: AnswerFormAnswer; context: BareRefContext }): {
  readonly answer: AnswerFormAnswer;
  readonly issues: readonly BareRefIssue[];
} {
  const anchored = contextAnchoredToUrls({ context, urls: urlsOfAnswer({ answer }) });
  // Same readonly-vs-mutable seam `typeAnswerFormMarkup` documents below: `linkifyDetail`/`linkifySequences`
  // are typed against `../artifact/types.js`, whose fields are all `readonly`, while this arm's zod-inferred
  // shape for the identical JSON never opted into `.readonly()`.
  // oxlint-disable-next-line no-unsafe-type-assertion
  const body = linkifyDetail({ context: anchored, detail: answer.body }) as AnswerFormAnswer["body"];
  // oxlint-disable-next-line no-unsafe-type-assertion
  const index = linkifySequences({ context: anchored, items: answer.index }) as AnswerFormAnswer["index"];
  const issues = [
    ...bareRefIssuesOfPlainText({ context: anchored, path: ["lead"], text: answer.lead }),
    ...bareRefIssuesOfDetail({ context: anchored, detail: body, path: ["body"] }),
    ...bareRefIssuesOfSequences({ context: anchored, items: index, path: ["index"] }),
    ...groundingProse({ grounding: answer.grounding }).flatMap((prose) =>
      bareRefIssuesOfUnlinkableText({ context: anchored, path: prose.path, remedy: prose.remedy, text: prose.text }),
    ),
  ];
  return { answer: { ...answer, body, index }, issues };
}

/** The sentence an answer-door refusal ends on: the one grant that sends the answer unchanged. */
function grantSentence({ id }: { id: HatchId }): string {
  return `For one deliberate exception run ${hatchIncantation({ hatch: hatchFor({ id }) })}; the grant sends it unchanged.`;
}

/**
 * The refusals the SHOW-YOUR-WORK rules earn — uncited controls, a measured Datadog graph finding short of
 * three screenshots, several things named with no picture and no reason, a figure asserted with no measurement
 * behind it, and a small-sample figure stated without its n.
 *
 * The citation, graph-floor and figure legs each read their own override, so waiving one never silently
 * waives another.
 * The picture leg has NO override, because it is a question rather than a gate: its way
 * through is `noPictureBecause`, a field the form carries and the ledger records, which is strictly more
 * visible than an ambient variable.
 *
 * Rule three's two array-bounding legs are deliberately OUTSIDE its override, for the reason
 * `./answerArm.ts`'s `answerDocumentsSchema` states about its own extension list: their fix is always "delete the entry", and
 * a refusal whose fix is another field needs no escape hatch. They are what bound `measurements`, which carries
 * no `.max()` — see {@link measuredFigureRefusals}.
 *
 * @param answer the validated, already-linkified `answer` arm
 * @param context the same context the bare-reference pass used
 * @param env the environment every grant's session is read from
 * @param home the state home the verb resolved, whose journal holds every grant; absent, `env` names it
 * @returns one operator-facing refusal per surviving violation, in reading order
 */
function showYourWorkRefusals(arm: {
  answer: AnswerFormAnswer;
  context: BareRefContext;
  env: Readonly<Record<string, string | undefined>>;
  home: string | undefined;
}): readonly string[] {
  const { answer, context, env, home } = arm;
  const refusals: string[] = [];
  const parts = { body: answer.body, citations: answer.citations, context, index: answer.index };
  if (!hatchOpen({ env, home, id: CONTROL_CITATION_HATCH, nowIso: new Date().toISOString() })) {
    refusals.push(
      ...uncitedControlIssues(parts).map(
        (issue) => `${issue.path.join(".")}: ${issue.message} ${grantSentence({ id: CONTROL_CITATION_HATCH })}`,
      ),
    );
    // Last of rule one's lines, because it is about the SET of refusals above it rather than about any one
    // item — see `./citedAndShown.ts`'s `citationBudgetCollision` for what it measured.
    const collision = citationBudgetCollision(parts);
    if (collision !== undefined) {
      refusals.push(`citations: ${collision}`);
    }
  }
  // The graph-finding floor, then rule two unless the floor is owed: its images are its pictures, and its
  // reason is `noPictureBecause`. `./graphFindingFloor.ts` says why the one silences the other.
  refusals.push(...answerPictureRefusals(arm));
  refusals.push(...measuredFigureRefusals(arm));
  refusals.push(...smallSampleRefusals(answer));
  return refusals;
}

/**
 * Rule three's own three legs, in reading order: a figure the `measurements` list does not cover, an entry
 * naming a figure the answer never asserts, and a figure two entries both claim.
 *
 * Only the FIRST reads the override. The other two are what bound an array carrying no `.max()`, and each
 * one's fix is to delete a position rather than to measure something, so a hatch past either would only ever
 * let the list grow — see {@link showYourWorkRefusals} for the same reasoning stated once.
 *
 * @param answer the validated, already-linkified `answer` arm
 * @param context the same context the bare-reference pass used
 * @param env where the one override's session is read from
 * @param home the state home whose journal holds that grant; absent, `env` names it
 * @returns one operator-facing refusal per surviving violation
 */
function measuredFigureRefusals(arm: {
  answer: AnswerFormAnswer;
  context: BareRefContext;
  env: Readonly<Record<string, string | undefined>>;
  home: string | undefined;
}): readonly string[] {
  const { answer, context, env, home } = arm;
  const figures = {
    body: answer.body,
    context,
    index: answer.index,
    lead: answer.lead,
    measurements: answer.measurements,
  };
  const refusals: string[] = [];
  if (!hatchOpen({ env, home, id: UNMEASURED_FIGURES_HATCH, nowIso: new Date().toISOString() })) {
    refusals.push(
      ...unmeasuredFigureIssues(figures).map(
        (issue) => `${issue.path.join(".")}: ${issue.message} ${grantSentence({ id: UNMEASURED_FIGURES_HATCH })}`,
      ),
    );
  }
  refusals.push(...unusedMeasurementIssues(figures).map((issue) => `${issue.path.join(".")}: ${issue.message}`));
  refusals.push(
    ...duplicateMeasurementIssues({ measurements: answer.measurements }).map(
      (issue) => `${issue.path.join(".")}: ${issue.message}`,
    ),
  );
  return refusals;
}

/**
 * Parse an already-decoded value against {@link answerFormSchema} (so the lead/body/citation refinements
 * run). A file declaring any other STRING `kind` is refused BEFORE the schema, by name and with where that
 * content goes, rather than as a pile of missing-field issues around one literal mismatch; a missing or
 * non-string `kind` is left to the schema's own `kind` issue. The ONE parser
 * `turn answer` and `turn resume` both call, so neither drifts from the other.
 *
 * Also the one place the bot's own answer resolves a bare `#N`/`SUP-N`/`HRS-52` into a real link — the
 * exact defect a dogfood answer shipped: `slack post --as bot` gates the same
 * rule (`../../cli/bareRefDoor.ts`), but `turn answer`/`turn resume` never go through that CLI verb at all,
 * so the rule has to live here too.
 *
 * TEN refusals stack here, in reading order, and they are reported together rather than one at a time so a
 * composer sees everything wrong with an answer in one pass: a surviving bare reference, a control named
 * without a citation saying which control it is, a measured Datadog graph finding short of three screenshots
 * (`./graphFindings.ts`, which silences the next one when it fires), an answer showing several things with
 * nothing photographed, a figure asserted with no measurement behind it, a measurement that measures nothing the answer says,
 * one figure measured twice, a small-sample figure whose sentence does not state its n, a declared sample
 * the answer never asserts, and one figure declared twice. The second and fourth are `./citedAndShown.ts`'s,
 * and its header carries the ruling and the rejected answer both are calibrated against; the next three are
 * `./measuredFigures.ts`'s, whose header carries the measurement that set its criterion and the two reviews
 * that corrected it; the last three are `./smallSamples.ts`'s, whose header carries the owner's placement
 * ruling and the measurement behind its threshold.
 *
 * @param raw the decoded JSON value
 * @param context what this turn's bare references can resolve against
 * @param env the environment every override's session is read from, defaulting to the process environment
 * @param home the state home the verb resolved (`turn answer --home`), whose journal holds every grant;
 *   absent, the home `env` names
 * @returns the validated, linkified `answer` arm, or every reason it was refused
 */
export function parseAnswerArm({
  raw,
  context,
  env = process.env,
  home,
}: {
  raw: unknown;
  context: BareRefContext;
  env?: Readonly<Record<string, string | undefined>>;
  home?: string | undefined;
}): Result<AnswerFormAnswer> {
  const declaredKind = typeof raw === "object" && raw !== null && "kind" in raw ? raw.kind : undefined;
  if (typeof declaredKind === "string" && declaredKind !== "answer") {
    return err([
      `the answer file is a \`${declaredKind}\` form — only \`kind: "answer"\` is accepted here; a post under the owner's own name goes through \`slack post --as me\`'s own forms`,
    ]);
  }
  const parsed = answerFormSchema.safeParse(raw);
  if (!parsed.success) {
    return err(parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`));
  }
  const linkified = linkifyAnswerArm({ answer: parsed.data, context });
  const bareRefs =
    linkified.issues.length > 0 && !hatchOpen({ env, home, id: BARE_REFS_HATCH, nowIso: new Date().toISOString() })
      ? linkified.issues.map((issue) => `${issue.path.join(".")}: ${issue.message} ${bareRefsEscapeSentence()}`)
      : [];
  const refusals = [...bareRefs, ...showYourWorkRefusals({ answer: linkified.answer, context, env, home })];
  if (refusals.length > 0) {
    return err(refusals);
  }
  return ok(linkified.answer);
}

/**
 * CONVERT every bare URL and raw `<@U…>` in the answer's `body`/`index` into the typed run that renders it.
 *
 * Runs BEFORE {@link truncateAnswerForm} because conversion changes visible width; measuring first would
 * refuse a form for characters no reader would have seen. See `../artifact/typedRuns.ts`.
 *
 * @param form the parsed form, exactly as composed
 * @returns the form with every run sequence typed; byte-identical when it carried no raw markup
 */
function typeAnswerFormMarkup(form: AnswerFormAnswer): AnswerFormAnswer {
  const body = typeCitationMarkersInDetail({
    citations: form.citations,
    detail: typeRawMarkupInDetail({ detail: form.body }),
  });
  const index = typeCitationMarkersInSequences({
    citations: form.citations,
    items: typeRawMarkupInSequences({ items: form.index }),
  });
  return {
    ...form,
    // Same readonly-vs-mutable seam `truncateAnswerForm` documents below: the shared converter is typed
    // against `../artifact/types.js`, whose fields are all `readonly`, while this arm's zod-inferred
    // shape for the identical JSON never opted into `.readonly()`.
    // oxlint-disable-next-line no-unsafe-type-assertion
    body: body as AnswerFormAnswer["body"],
    // A fresh mutable array of the same citations: `readonly` on a property never blocks assignment, only
    // `readonly` on the array does, so copying the one array is the whole seam here.
    citations: [...citationsInReadingOrder({ citations: form.citations, detail: body, index })],
    // oxlint-disable-next-line no-unsafe-type-assertion
    index: index as AnswerFormAnswer["index"],
  };
}

/** REFUSE every raw-markup span the answer would show a reader — `./answerMarkupChecks.ts` carries why. */
function checkRawMarkup({ form, ctx }: { form: AnswerFormAnswer; ctx: z.RefinementCtx }): void {
  rawMarkupIssuesOfAnswer({ form }).forEach((issue) => {
    ctx.addIssue({ code: "custom", message: issue.message, path: [...issue.path] });
  });
}

/**
 * REFUSE a `[n]` citation marker conversion could not turn into a chip: one naming no declared citation,
 * and one in the plain-string `lead`, which holds no runs for a chip to live in.
 *
 * The third defect of the class — a citation nothing cites — is already `checkCitations`' last rule here,
 * so only these two are new. See `../artifact/citationMarkers.ts` for the measured card behind both.
 */
function checkCitationMarkers({ form, ctx }: { form: AnswerFormAnswer; ctx: z.RefinementCtx }): void {
  citationIssuesOfForm({
    citations: form.citations,
    detail: form.body,
    detailPath: ["body"],
    index: form.index,
    lead: form.lead,
    leadPath: ["lead"],
    uncited: false,
  }).forEach((issue) => {
    ctx.addIssue({ code: "custom", message: issue.message, path: [...issue.path] });
  });
}

/**
 * REFUSE an answer's `body`/`index` when it is over a count/aggregate cap, unless the `truncated-send` grant
 * is live — mirrors `../artifact/schema.ts`'s `truncateUpdateArtifact`.
 *
 * Truncation can drop the ONLY run that referenced a citation — an index line carrying a `[n]` chip, say —
 * which would otherwise make `checkCitations`' "every citation must be referenced" rule refuse a form for a
 * citation IT orphaned, on content the caller never got a chance to fix. So any citation whose every
 * reference was in content this pass just dropped is dropped from `citations` too. A citation that was
 * ALREADY unreferenced before truncation is left alone — that is a real, unrelated authoring defect, and
 * this pass has no way to tell it apart from one it just orphaned unless it checks BEFORE truncating. This
 * cleanup only matters on the break-glass path: when refusing, nothing gets posted, so there is nothing to
 * repair.
 *
 * @param form the parsed, pre-truncation form
 * @param ctx the transform's refinement context, used to refuse rather than silently post truncated content
 * @returns the form with `body`/`index` truncated in place ONLY when the break-glass is set; the original
 *   form, unchanged, otherwise (an added issue fails the parse regardless of the return value when refusing)
 */
function truncateAnswerForm(form: AnswerFormAnswer, ctx: z.RefinementCtx): AnswerFormAnswer {
  const citedBefore = citedIdsInReadingOrder({ detail: form.body, index: form.index });
  const capped = truncateFormForCaps({
    citations: form.citations,
    detail: form.body,
    field: "body",
    index: form.index,
    leadLength: form.lead.length,
    maxAboveFold: { cap: "ABOVE_FOLD_VISIBLE_MAX", limit: ABOVE_FOLD_VISIBLE_MAX },
    maxBulletItems: { cap: "BULLETS_MAX_ITEMS", limit: BULLETS_MAX_ITEMS },
    maxDetailBlocks: { cap: "BODY_MAX_BLOCKS", limit: BODY_MAX_BLOCKS },
    maxIndexItems: { cap: "INDEX_MAX_ITEMS", limit: INDEX_MAX_ITEMS },
    maxProse: { cap: "DETAIL_PROSE_VISIBLE_MAX", limit: DETAIL_PROSE_VISIBLE_MAX },
    maxTableRows: { cap: "TABLE_MAX_ROWS", limit: TABLE_MAX_ROWS },
  });
  if (!capped.truncated) {
    return form;
  }
  if (!truncatedSendAllowed({ env: process.env })) {
    ctx.addIssue({
      code: "custom",
      message: truncatedSendRefusalMessage({ overages: capped.overages }),
      path: ["body"],
    });
    return form;
  }
  const { detail, index } = capped;
  // Drops what truncation orphaned and renumbers what survived, in one shared helper — the same repair the
  // card form's `truncateUpdateArtifact` makes. See `../artifact/citationMarkers.ts`.
  const repaired = citationsAfterTruncation({ citations: form.citations, citedBefore, detail, index });
  // oxlint-disable-next-line no-unsafe-type-assertion
  const citations = repaired as AnswerFormAnswer["citations"];
  // `truncateFormForCaps` is typed against `DetailBlock`/`InlineRun` (`../artifact/types.ts`), which declare
  // every field readonly; `answerArmSchema`'s OWN zod-inferred shape for the same JSON never opted into
  // `.readonly()`, so it is structurally identical at runtime but a stricter TS type. The cast is this
  // module's only seam between the two — the value itself is exactly the truncated content either way.
  // oxlint-disable-next-line no-unsafe-type-assertion
  return { ...form, body: detail as AnswerFormAnswer["body"], citations, index: index as AnswerFormAnswer["index"] };
}

/**
 * The bot's answer, `kind: "answer"` with no other way in: a lead REFUSED past {@link TLDR_VISIBLE_MAX} (never
 * truncated), what it answers, a bounded body whose citation chips all resolve, as many images as the evidence
 * earns, up to `ANSWER_DOCUMENTS_MAX` documents (`./answerArm.ts`'s `answerDocumentsSchema` — the DELIVERABLE lane),
 * and a required `grounding` naming how it was produced. `body`/`index` are REFUSED past a count or aggregate
 * cap (row/item counts, total prose, the above-the-fold region) unless a `truncated-send` grant is live, in
 * which case they're truncated with a visible warning instead — see `../artifact/truncate.ts`. A single
 * over-width string is refused unconditionally, with no break-glass.
 */
export const answerFormSchema = answerArmSchema
  .transform(typeAnswerFormMarkup)
  .transform(truncateAnswerForm)
  .superRefine((form, ctx) => {
    if (form.lead.length > TLDR_VISIBLE_MAX) {
      ctx.addIssue({
        code: "custom",
        message: `lead is ${form.lead.length} visible chars, over the ${TLDR_VISIBLE_MAX} cap`,
        path: ["lead"],
      });
    }
    form.body.forEach((block, index) => {
      checkBodyBlock({ block, citations: form.citations, ctx, index });
    });
    checkCitations({ body: form.body, citations: form.citations, ctx, index: form.index });
    checkIndex({
      belowFoldLabel: "body",
      citations: form.citations,
      ctx,
      index: form.index,
      indexStyle: form.indexStyle,
    });
    checkRawMarkup({ ctx, form });
    checkCitationMarkers({ ctx, form });
  });
