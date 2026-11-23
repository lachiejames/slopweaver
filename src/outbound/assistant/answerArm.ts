/**
 * The `answer` arm's own object shape and the field schemas it composes: what it replies to, the two
 * attachment lanes, the index line, and every optional declaration. `./answerForm.ts` refines it into
 * `answerFormSchema` and infers `AnswerFormAnswer` from it; this module imports nothing back from there.
 */
import { z } from "zod";

import { isSlackTs } from "../../lib/slackTs.js";
import { FOLLOW_THROUGH_OWES } from "../../live/ask/lifecycleEvents.js";
import { INDEX_STYLES } from "../artifact/introAndRank.js";
import { citationSchema, detailBlockSchema, inlineRunSchema } from "../artifact/schema.js";
import { strictForm } from "../strictForm.js";
import { answerGroundingSchema } from "./answerGrounding.js";
import { NO_PICTURE_REASON_MAX } from "./citedAndShown.js";
import { ANSWER_DOCUMENTS_MAX } from "./contentLimits.js";
import { measurementSchema } from "./measuredFigures.js";
import { sampleSchema } from "./smallSamples.js";

/**
 * The longest `followThrough.what` an answer may declare — one line a resume brief and a sweep line quote
 * whole, never a second plan.
 */
export const FOLLOW_THROUGH_WHAT_MAX = 200;

/** What the answer replies to: a permalink to the message plus a short quote of it. */
const answeringSchema = strictForm({
  permalink: z.url(),
  quote: z.string().min(1),
});

/**
 * Every image path a rendered `answer` attaches — with no count cap, because there should be no hard size
 * limit: sometimes more pictures make sense and sometimes fewer. How many is the composer's judgement: a picture where it
 * carries something text cannot, none that repeats the text. Doctrine rule 7 bounds what sits ABOVE the fold,
 * and images ride below it, so a count protects nothing that rule protects. The card door's `media` has never
 * carried a cap either, and the two doors now agree. Rule two (`./citedAndShown.ts`) is the FLOOR, and it stays;
 * the one class with a hard minimum is a measured Datadog graph finding (`./graphFindings.ts`), checked in
 * `parseAnswerArm` rather than here because whether it applies depends on the rest of the form.
 */
export const answerImagesSchema = z.array(z.string().min(1)).default([]);

/**
 * The extensions the DOCUMENTS lane carries, markdown first and html second — the lane's whole vocabulary.
 *
 * Ordered as the owner ranked them and read in that order by `../../admit/documentDeliverableGate.ts`, so
 * "markdown first" is one list rather than a preference restated in two places. Lowercased at the point of
 * comparison; a path's own case is never normalised, because the path has to open.
 */
export const ANSWER_DOCUMENT_EXTENSIONS = [".md", ".markdown", ".html", ".htm"] as const;

/** Whether a path names a file the documents lane can carry. */
function hasDocumentExtension({ path }: { path: string }): boolean {
  const lowered = path.toLowerCase();
  return ANSWER_DOCUMENT_EXTENSIONS.some((extension) => lowered.endsWith(extension));
}

/**
 * Every DOCUMENT path a rendered `answer` may attach — the deliverable lane, uploaded in-thread beside the
 * answer that describes it.
 *
 * ## Why this exists at all
 *
 * MEASURED on an ask answered into a team channel with three colleagues in
 * the thread: the turn wrote four local pages and then delivered a message saying nothing was uploaded
 * anywhere and the four pages were files under the local pages directory, plus a four-row table of paths.
 * The owner uploaded one of them by hand and would have preferred markdown. Nobody else in that thread could open the
 * deliverable, and the reason was structural rather than a composer's slip — the form carried
 * {@link answerImagesSchema} and nothing else, so a DOCUMENT had no lane through the door and a path was
 * the only thing left to say.
 *
 * ## The extension list is a hard refusal, and the ORDER rule is not
 *
 * A path outside {@link ANSWER_DOCUMENT_EXTENSIONS} is refused here, with no override, because the
 * correction is always "use the other lane": a `.png` is an `images` entry, and a format with no lane at
 * all is not made deliverable by attaching it. A refusal whose fix is another field needs no escape hatch.
 *
 * "Markdown first, html second" is the opposite case and is deliberately NOT here. A page can genuinely
 * exist before its markdown does, and a composer who hits a hard schema refusal on that has no move except
 * to drop the deliverable — which re-creates the exact failure above one layer up. It is an overridable
 * door finding instead (`../../admit/documentDeliverableGate.ts`), which is this repository's shape for a
 * rule that is right almost always.
 *
 * @internal — exported so the header and this repo's tests can name it; `answerArmSchema` is the only
 *   consumer, and a second caller composing it would be building a second answer form.
 */
export const answerDocumentsSchema = z
  .array(
    z
      .string()
      .min(1)
      .refine((path) => hasDocumentExtension({ path }), {
        message: `a document must be one of ${ANSWER_DOCUMENT_EXTENSIONS.join(", ")} — a picture belongs in \`images\`, and any other format has no lane through the door`,
      }),
  )
  .max(ANSWER_DOCUMENTS_MAX)
  .default([]);

/**
 * One above-the-fold index line: an unbroken run sequence, the SAME `inlineRunSchema` the operator card's
 * own `index` uses — a citation chip included, which is what lets a rich-form capability (a ranked-findings
 * card, say) give each ranked row its own `[n]` reference instead of collapsing every row onto one shared
 * citation.
 */
const indexLineSchema = z.array(inlineRunSchema).min(1);

/** The `answer` arm's shape, refined by `answerFormSchema` (`./answerForm.ts`) and inferred as `AnswerFormAnswer`. */
export const answerArmSchema = strictForm({
  answering: answeringSchema.optional(),
  // `.max(BODY_MAX_BLOCKS)` deliberately absent — an over-count body is refused via `truncateAnswerForm`
  // (computed by dropping blocks/items from the tail, then refused unless a `truncated-send` grant is
  // live). See `answerFormSchema`'s `.transform()` in `./answerForm.ts`.
  body: z.array(detailBlockSchema).default([]),
  // Citations stay a hard REFUSAL rather than joining the truncation: dropping one from the tail could
  // orphan a `[n]` chip elsewhere in `body`/`index`, which is a bigger content edit than "drop a whole row"
  // and stays out of this truncation's scope. The BOUND is no longer a field-level `.max()`, because it
  // depends on the body — `checkCitations` measures it with `./citedAndShown.ts`'s `citationsCeiling`.
  citations: z.array(citationSchema).default([]),
  /** The deliverable itself, uploaded in-thread with the answer — see {@link answerDocumentsSchema}. */
  documents: answerDocumentsSchema,
  /**
   * Work the SAME worker still owes after this answer posts — set on a FIRST answer (the plan the
   * answer-first rule asks for before a pull request opens), never on the final one.
   *
   * Declared rather than derived because nothing on disk says a pull request is owed: the routing decision
   * carries no build intent, and a plan written in prose is not a fact. Setting it makes `turn answer` post
   * this answer as a NON-ending `first-answered` (`../../live/ask/lifecycleEvents.ts`'s `FirstAnsweredEvent`):
   * the dispatch, the workspace and the card stay up and the answer-first gate clears.
   *
   * On the FORM for the reason `supersedes` gives below: `answerDigestOf` hashes the form, so the reviewing
   * session's verdict binds the declaration — a flag on the verb would be an unreviewed bit able to turn any
   * reviewed answer into a non-ending. OPTIONAL and never defaulted, for the reason `samples` gives, so every
   * existing answer keeps its digest. Not rendered in Slack.
   */
  followThrough: strictForm({
    owes: z.enum(FOLLOW_THROUGH_OWES),
    what: z.string().trim().min(1).max(FOLLOW_THROUGH_WHAT_MAX),
  }).optional(),
  grounding: answerGroundingSchema,
  images: answerImagesSchema,
  /**
   * The same above-the-fold `index` the operator card carries — ranked one-liners, each an unbroken run
   * sequence that may end in its own `[n]` citation chip. Optional in the sense that it defaults to empty:
   * a plain prose answer never sets it, and `renderAssistantAnswer` renders an empty index exactly as it
   * always has. A rich-form capability sets it to get the card's own progressive-disclosure shape without
   * leaving the `turn answer` path that resolves the checklist and threads the reply.
   *
   * `.max(INDEX_MAX_ITEMS)` deliberately absent — an over-count index is refused via `./answerForm.ts`'s
   * `truncateAnswerForm` (unless a `truncated-send` grant is live, in which case it is truncated with a warning).
   */
  index: z.array(indexLineSchema).default([]),
  /** Matches `updateArtifactSchema`'s own `indexStyle` — bullets by default, `plain` or a colour-coded `ordered` list. */
  indexStyle: z.enum(INDEX_STYLES).optional(),
  kind: z.literal("answer"),
  lead: z.string().min(1),
  /**
   * How each figure the answer asserts was measured — see `./measuredFigures.ts`'s `measurementSchema` and
   * `./measuredFigures.ts`.
   *
   * No `.max()`, deliberately. A flat ceiling over a per-figure obligation is the mutually-exclusive pair
   * `./citedAndShown.ts`'s `citationBudgetCollision` measured. The bound comes from two refusals together
   * instead: `unusedMeasurementIssues` refuses a position the answer never asserts, and
   * `duplicateMeasurementIssues` refuses a figure covered twice — so the list cannot exceed the answer's own
   * distinct figure count, which the body caps already bound. `unusedMeasurementIssues` alone did NOT bound
   * it, which the r2 review proved with forty entries all naming one asserted figure. Defaults to empty, so
   * an answer asserting no figure is unaffected.
   */
  measurements: z.array(measurementSchema).default([]),
  /**
   * The session's answer to `./citedAndShown.ts`'s `UNSHOWN_ITEMS_QUESTION`: why no picture would show
   * a reader anything this answer's text does not. Set only after the door asked — a reason on an answer
   * that attaches a picture or names fewer than three things is refused, so the ledger never records a
   * waiver for a rule that did not fire.
   *
   * On the FORM for the reason `supersedes` gives below: `answerDigestOf` hashes the form, so the reviewing
   * session's verdict covers the reason too.
   */
  noPictureBecause: z.string().trim().min(1).max(NO_PICTURE_REASON_MAX).optional(),
  /**
   * How many observations each sampled figure stands on — see `./smallSamples.ts`, which declares its schema.
   * A figure under the small-sample threshold is refused unless its own sentence states its n. No `.max()`,
   * for the reason `measurements` gives: two hatchless refusals bound it to the answer's own figures.
   *
   * OPTIONAL rather than defaulted, and the difference is mechanical. `../../live/turn/posterAnswer.ts`'s
   * `answerDigestOf` hashes the PARSED form, so a default would add `samples: []` to every answer re-parsed
   * after this field landed, and every verdict already bound to one of those answers would stop matching.
   * An absent field parses to an absent field, so an answer declaring no sample keeps its digest.
   */
  samples: z.array(sampleSchema).optional(),
  /**
   * The bot's OWN earlier answer, in this same thread, that this one replaces — deleted once this answer
   * has posted, so a read-back of the thread holds only what still stands.
   *
   * A DECLARATION, not a detection. Setting it says "a central claim of that answer is replaced by this
   * one"; omitting it is the default and deletes nothing, which is what a purely ADDITIVE follow-up does.
   * Nothing in this schema can tell those two apart — the composer decides and the reviewer judges, and
   * `skills/loop-bot/reference/composing-the-answer.md` is where that judgement is written down.
   *
   * It lives on the FORM rather than on a `turn answer` flag for one mechanical reason: the form is what
   * `../../live/turn/posterAnswer.ts`'s `answerDigestOf` hashes, so changing which answer is superseded
   * invalidates the reviewing session's verdict instead of slipping past it. A flag would sit outside that
   * binding, and would be a second source of truth for the same fact.
   *
   * Naming a timestamp here never makes it deletable. `../../live/turn/supersession/eligibility.ts` still
   * has to find it recorded as this installation's own answered turn in this same channel and thread, and
   * the live ownership read-back still has to agree it is this bot's message.
   */
  supersedes: z
    .string()
    .refine((ts) => isSlackTs({ ts }), { message: "supersedes must be a Slack message timestamp" })
    .optional(),
});
