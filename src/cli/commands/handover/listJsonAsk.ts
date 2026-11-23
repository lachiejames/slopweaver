/**
 * What a `--json` row publishes about its open ask — the action, the shape, the examples, the options and the
 * still-real check — each resolved from the RUN when one is parked on the owner, else from the doc it was registered with.
 * The projection `./listJson.ts` assembles a row from; apart from it along that seam, so the document file holds
 * the document and this one holds the ask.
 */

import { type AskAction, MAIL_ACTION_VERSION } from "../../../handover/askAction.js";
import { actionOptions } from "../../../handover/askActionOptions.js";
import { askExampleSetOf, type PublishedExamples, publishedExamples } from "../../../handover/askExamples.js";
import { type AskOption, type AskShape, type AskStakes, stakesFrom } from "../../../handover/askShape.js";
import { type BoardModel, offeredADraft } from "../../../handover/boardTypes.js";
import { type MailPreview, mailPreviewOf } from "../../../handover/mailActionPreview.js";

/**
 * The Slack action the open question offers, when it offers one.
 *
 * Read off the same discriminated arm `./listJsonWait.ts` reads the question from, for the same reason, and off
 * the RUN alone: the front-matter carries no action key at all, so there is nothing here to fall back to and
 * nothing that could publish a draft no session recorded.
 *
 * @param run the run's composed disposition
 * @returns the recorded action, or `undefined` when the ask offers none
 */
export function actionOf({ run }: { run: BoardModel["run"] }): AskAction | undefined {
  if (run.kind === "waiting-on-owner") {
    return run.action;
  }
  return undefined;
}

/**
 * The row's mail preview, when its open ask offers a mail action.
 *
 * @returns the preview, or `undefined` when the action is absent or not a mail one
 */
export function mailPreviewFor({
  slug,
  action,
}: {
  slug: string;
  action: AskAction | undefined;
}): MailPreview | undefined {
  if (action === undefined || action.version !== MAIL_ACTION_VERSION) {
    return undefined;
  }
  return mailPreviewOf({ action, slug });
}

/**
 * The SHAPE a row carries — the journalled one if a run is parked on the owner, otherwise the doc's own.
 *
 * Two sources because there are two kinds of ask and both reach this board. A RUN records its question with
 * `handover ask`, so the shape is a `question` event in the journal; an ASK ROW is registered with `handover
 * register` before any run exists, so the shape is front-matter. The run wins where both exist, for the same
 * reason `./listJsonWait.ts` reads the run's question first: it is the live ask, and the doc is what it was
 * registered as.
 *
 * Written as an `if` that RETURNS rather than a `??` chain — `no-silent-fallback` — and it
 * returns the whole shape or nothing, never a field from each, because half a card is not a decision.
 *
 * **A run that OFFERED A DRAFT AT ALL gets no fallback**, readable or not, and the criterion is the offer
 * rather than the defect. The doc's front-matter options describe the destinations of a draft the doc's
 * author imagined; a run that offered one has its own, DERIVED from the destinations actually recorded. So
 * restoring the doc's list prints a takeable "DM Tobias" on a card about a message addressed to a channel —
 * whether the recorded draft is broken or perfectly readable but carrying no
 * `lean`, which is one hand-edited journal line away and reaches the same card.
 * The run is the live ask either way, so a gap in it is not an invitation to publish the registration
 * instead.
 *
 * @param model the composed row
 * @returns the shape, or `undefined` on a row that carries none and on every row whose ask offered a draft
 */
export function shapeOf({ model }: { model: BoardModel }): RecordedShape | undefined {
  return shapeFrom({ doc: model.doc, run: model.run });
}

/**
 * {@link shapeOf} over the two halves of a row it reads, so a verb rewriting part of a waiting card
 * (`./namedDraftAdmission.ts`'s `waitingCard`) checks the very shape the card will draw, doc fallback included.
 *
 * @param run the run's disposition, whose journalled shape or offer wins
 * @param doc the front matter the card falls back to when the run journalled neither
 * @returns the shape, or `undefined` on a row that carries none and on every row whose ask offered a draft
 */
export function shapeFrom({
  run,
  doc,
}: {
  run: BoardModel["run"];
  doc: Pick<BoardModel["doc"], "problem" | "options" | "lean" | "risk" | "blastRadius" | "stillReal" | "stillRealIso">;
}): RecordedShape | undefined {
  if (run.kind === "waiting-on-owner" && run.shape !== undefined) {
    return { checkedIso: run.shapeIso, shape: run.shape };
  }
  if (run.kind === "waiting-on-owner" && offeredADraft({ run })) {
    return undefined;
  }
  const { problem, options, lean, risk, blastRadius, stillReal, stillRealIso } = doc;
  if (problem === undefined || lean === undefined || options.length === 0) {
    return undefined;
  }
  const { stakes } = stakesFrom({ blastRadius, risk, stillReal });
  return { checkedIso: stakes === undefined ? undefined : stillRealIso, shape: { lean, options, problem, stakes } };
}

/** A shape, and when its stakes were last confirmed — the two travel together off the same source. */
export interface RecordedShape {
  readonly shape: AskShape;
  readonly checkedIso: string | undefined;
}

/**
 * The concrete examples a row publishes — the RUN's when a run is parked on the owner, otherwise the doc's own.
 *
 * Never one source's scenes beside the other's question, for the reason `./listJsonRowText.ts`'s `bearsOnOf` withholds its line: a
 * run asking its own question would otherwise draw a scene written for the question the row was registered with.
 *
 * @param model the composed row
 * @returns the scenes, or the gap line, or neither
 */
export function examplesOf({ model }: { model: Pick<BoardModel, "doc" | "run"> }): PublishedExamples {
  const fromRun = model.run.kind === "waiting-on-owner";
  const set = fromRun
    ? model.run.illustration
    : askExampleSetOf({ examples: model.doc.examples, gap: model.doc.exampleGap });
  return publishedExamples({ set });
}

/**
 * The options a row publishes — DERIVED from the action wherever there is a readable one.
 *
 * The action is the authority, not the shape, and the two come apart on a real line: a `question` whose
 * `lean` is absent has no journalled shape at all (`openQuestion.ts`'s `shapeOf` is whole-or-nothing), and
 * reading the options off the shape then published an empty list beside a perfectly good draft — an ask
 * offering a message and no way to send it. Deriving here is the same act the decoder and the verb already
 * perform, so all three agree by construction rather than by three copies staying in step.
 *
 * @param shape the row's recorded shape, read when no readable action derives the options
 * @returns the options, empty when neither an action nor a shape offers any
 */
export function optionsFor({
  model,
  shape,
}: {
  model: Pick<BoardModel, "run">;
  shape: AskShape | undefined;
}): readonly AskOption[] {
  if (model.run.kind === "waiting-on-owner" && model.run.action !== undefined) {
    return actionOptions({ action: model.run.action });
  }
  if (shape === undefined) {
    return [];
  }
  return shape.options;
}

/**
 * The row's still-real check and when it was last true — a RECONFIRM when one has landed, else the stakes'.
 *
 * The reconfirm wins even on a row with no stakes, which is most asks recorded before stakes existed: it is
 * a session having just re-run the check, and a card reading "never re-confirmed" over one that was is
 * exactly the stale page `handover reconfirm` exists to end. The asked instant is untouched either way.
 *
 * @param checkedIso when the shape's stakes were last confirmed
 * @returns the check and its instant, both `undefined` when neither source carries one
 */
function stillRealOf({
  run,
  stakes,
  checkedIso,
}: {
  run: BoardModel["run"];
  stakes: AskStakes | undefined;
  checkedIso: string | undefined;
}): { readonly stillReal: string | undefined; readonly stillRealIso: string | undefined } {
  if (run.kind === "waiting-on-owner" && run.reconfirmed !== undefined) {
    return { stillReal: run.reconfirmed.stillReal, stillRealIso: run.reconfirmed.atIso };
  }
  if (stakes === undefined) {
    return { stillReal: undefined, stillRealIso: undefined };
  }
  return { stillReal: stakes.stillReal, stillRealIso: checkedIso };
}

/**
 * The still-real check a row publishes, from the run and the doc alone — {@link shapeFrom} picks the stakes and
 * {@link stillRealOf} lets a reconfirm win over them, exactly as the row is assembled.
 *
 * One function because two callers must agree on it: the row, and `handover correct`, which requires a restated
 * check whenever this returns one. A narrower test there would miss a run with no journalled shape whose card falls
 * back to the doc's registered stakes, and leave that line printing over the corrected question.
 *
 * @param run the run's disposition, whose reconfirm or journalled stakes win
 * @param doc the front matter the card falls back to when the run journalled no shape
 * @returns the check and its instant, both `undefined` when the card prints none
 */
export function publishedStillRealOf({
  run,
  doc,
}: {
  run: BoardModel["run"];
  doc: Parameters<typeof shapeFrom>[0]["doc"];
}): { readonly stillReal: string | undefined; readonly stillRealIso: string | undefined } {
  const recorded = shapeFrom({ doc, run });
  return stillRealOf({ checkedIso: recorded?.checkedIso, run, stakes: recorded?.shape.stakes });
}
