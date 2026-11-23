/**
 * The question a run cycle is HOLDING — one fold over the journal, and the carry across a cycle that closed unsettled.
 *
 * Split out of `./ledger.ts` because it is a seam rather than a size cut: every function here answers one
 * question about a row — what is the owner still being asked, and since when — and `./ledger.ts` is the decoder
 * and the phase reducer. Two callers read it and neither wants the rest of that file:
 * `./boardTypes.ts`'s `runDisposition` and `./ledger.ts`'s own `runStateOf`.
 *
 * ## Two folds, one rule, and it has to be spelled twice
 *
 * {@link carryStep} walks a CLOSED cycle to decide what it hands forward; {@link openQuestionAfter}
 * walks the CURRENT one. They are not the same function — one carries a posted handle and the other carries
 * an asked instant — but they must never disagree about what a `question-corrected` event does, which is
 * to replace the TEXT and mark the line a ruling must follow, and change nothing else. A correction is
 * `handover correct` restating a question truly, not asking a new one, so resetting its clock would report a
 * three-week-old ask as fresh every time somebody tidied its wording.
 *
 * It imports `RunEvent` as a TYPE only, so nothing here is in `./ledger.ts`'s runtime import cycle.
 *
 * Pure: events in, the held question out. No filesystem, no clock.
 */

import type { HandShot } from "../hand/shot.js";

import type { AskAction } from "./askAction.js";
import { type AskExampleSet, askExampleSetOf } from "./askExamples.js";
import type { AskShape, AskStakes } from "./askShape.js";
import type { RunEvent } from "./ledger.js";
import { type QuestionPost, questionPostOf } from "./questionPost.js";

/** A recorded question, as the journal holds it. */
type QuestionEvent = Extract<RunEvent, { kind: "question" }>;

/** An offer attached to a question already waiting — `handover offer`'s own event. */
type OfferEvent = Extract<RunEvent, { kind: "question-offered" }>;

/** A shape given to a question recorded without one — `handover ask` on a run waiting on an unshaped ask. */
type ShapedEvent = Extract<RunEvent, { kind: "question-shaped" }>;

/** A correction of the question a cycle holds — `handover correct`'s own event. */
type CorrectedEvent = Extract<RunEvent, { kind: "question-corrected" }>;

/**
 * A line that RESTATES the held question — its text, its shape or its draft — so a ruling journalled before it was
 * the input it was cut from, never its answer (`./heldQuestion.ts`, `rulingsAfterRestatement`). A reconfirm, examples
 * and a shot are not here: each attaches to the same decision without restating it.
 */
export type QuestionRestatingEvent = CorrectedEvent | OfferEvent | ShapedEvent;

/** A reconfirm of the question a cycle holds — `handover reconfirm`'s own event. */
type ReconfirmEvent = Extract<RunEvent, { kind: "question-reconfirmed" }>;

/** The concrete examples recorded for the question a cycle holds — `handover example`'s own event. */
type ExamplesEvent = Extract<RunEvent, { kind: "question-examples" }>;

/** The boxed picture recorded for the question a cycle holds — `handover shot`'s own event. */
type ShotEvent = Extract<RunEvent, { kind: "question-shot" }>;

/**
 * The held question with the picture an event records, when the event names it — else unchanged. Bound by text, as
 * examples are: a picture of a question since answered shows nothing waiting.
 */
function pictured<T extends { readonly question: string }>({
  held,
  event,
}: {
  held: T;
  event: ShotEvent;
}): T & { readonly shot?: HandShot } {
  return held.question === event.question ? { ...held, shot: event.shot } : held;
}

/**
 * What an examples event records, as the set a card reads.
 *
 * @param event the examples event
 * @returns its scenes or its gap — the decoder admits no event carrying neither
 */
function illustrationOf({ event }: { event: ExamplesEvent }): AskExampleSet | undefined {
  return askExampleSetOf({ examples: event.examples, gap: event.exampleGap });
}

/**
 * The examples an asking line carries on itself — a `question` or a `question-shaped` written by `handover ask`,
 * which records the scene on the same line as the question so an ask never lands without it.
 *
 * @param event the asking line
 * @returns the illustration to spread onto the open question, or nothing when the line carries none
 */
function ownIllustration({
  event,
}: {
  event: { readonly examples?: readonly string[]; readonly exampleGap?: string };
}): { readonly illustration?: AskExampleSet } {
  const { examples, exampleGap } = event;
  if (examples !== undefined && examples.length > 0) {
    return { illustration: askExampleSetOf({ examples, gap: undefined })! };
  }
  if (exampleGap !== undefined) {
    return { illustration: askExampleSetOf({ examples: [], gap: exampleGap })! };
  }
  return {};
}

/**
 * The held question with the examples an event records, when the event names it — else unchanged.
 *
 * Bound by text, as a reconfirm is: examples written for a question since answered illustrate nothing waiting.
 */
function illustrated<T extends { readonly question: string }>({
  held,
  event,
}: {
  held: T;
  event: ExamplesEvent;
}): T & { readonly illustration?: AskExampleSet } {
  const illustration = illustrationOf({ event });
  if (held.question !== event.question || illustration === undefined) {
    return held;
  }
  return { ...held, illustration };
}

/** When a waiting question was last re-confirmed as still standing, and the check that confirmed it. */
export interface Reconfirmation {
  readonly atIso: string;
  readonly stillReal: string;
}

/** An inherited question — its text as last CORRECTED, and where it was posted, so both survive the carry. */
export type InheritedQuestion = QuestionEvent & {
  readonly post: QuestionPost | undefined;
  /** When an OFFER last replaced the shape, which is when its stakes were confirmed — absent when none did. */
  readonly offeredIso?: string;
  /** The last reconfirm since the question was asked or offered — absent when none has landed since. */
  readonly reconfirmed?: Reconfirmation;
  /** The latest line that restated the question — {@link OpenQuestion.restatedBy}. */
  readonly restatedBy?: QuestionRestatingEvent;
  /** The concrete examples recorded for it — {@link OpenQuestion.illustration}. */
  readonly illustration?: AskExampleSet;
  /** The boxed picture recorded for it — {@link OpenQuestion.shot}. */
  readonly shot?: HandShot;
};

/**
 * The question the current cycle inherits from the cycle before it, when that cycle closed still holding it.
 *
 * A dead session is not an answer. `orphaned` closes a cycle because the session holding it is gone, and it says
 * nothing about the question that session had recorded — so a fresh `handover start` on the row opens WAITING on
 * the same question rather than forgetting it. MEASURED on a row whose question the owner answered
 * elsewhere before the cycle was reaped as orphaned — the re-started run then refused `handover
 * answer` with "no recorded question", so the owner's answer could never be journalled. Reproduce on any journal holding
 * `started`, `question`, `orphaned`, `started`: `slopweaver handover answer <slug> --answer x`.
 *
 * A re-start is not an answer either. `handover start` never refuses a run that is waiting on the owner, so anyone
 * starting over it, whether its holder is alive or died unreaped, opens a new cycle with NO ending on the old one —
 * and when only `orphaned` carried, the owner's question then fell off the Queue neither answered nor withdrawn.
 * Reproduce on any journal holding `started`,
 * `question`, `started`: `slopweaver handover list` shows the row open rather than waiting on the owner.
 *
 * So the carry follows the QUESTION, not the death: whatever is still held when a cycle closes passes on unless
 * the cycle settled it. `answered`, `finished`, `closed` and `abandoned` each settle it in their own way, and a
 * `question-withdrawn` settles the question it names. The carry is transitive: a re-started cycle orphaned or
 * re-started again before anyone answers passes the same question on. A correction and a posted handle carry with
 * it — the stale text resurfacing on a re-start is the defect `handover correct` exists to end.
 *
 * @param events the journal's events, in order
 * @returns the still-unanswered question event, or `undefined` when the current cycle inherits nothing
 */
export function inheritedQuestion({ events }: { events: readonly RunEvent[] }): InheritedQuestion | undefined {
  const starts = events.flatMap((event, index) => (event.kind === "started" ? [index] : []));
  let carried: InheritedQuestion | undefined;
  for (let cycleIndex = 0; cycleIndex < starts.length - 1; cycleIndex += 1) {
    const cycle = events.slice(starts[cycleIndex], starts[cycleIndex + 1]);
    carried = cycle.reduce<InheritedQuestion | undefined>((held, event) => carryStep({ event, held }), carried);
  }
  return carried;
}

/** One event's effect on the question a cycle is holding — the fold {@link inheritedQuestion} runs per cycle. */
function carryStep({
  held,
  event,
}: {
  held: InheritedQuestion | undefined;
  event: RunEvent;
}): InheritedQuestion | undefined {
  if (event.kind === "question") {
    return { ...event, post: undefined, ...ownIllustration({ event }) };
  }
  if (SETTLES_QUESTION.has(event.kind)) {
    return undefined;
  }
  if (event.kind === "question-withdrawn" && held?.question === event.question) {
    return undefined;
  }
  return held === undefined ? held : restatedCarry({ event, held });
}

/**
 * What an event that neither asks nor settles does to a question already carried — the kinds that restate it,
 * attach to it or confirm it, each bound to the question it names except a correction, which restates whichever is held.
 */
function restatedCarry({ held, event }: { held: InheritedQuestion; event: RunEvent }): InheritedQuestion {
  if (event.kind === "question-posted") {
    return held.question === event.question ? { ...held, post: questionPostOf({ event }) } : held;
  }
  if (event.kind === "question-corrected") {
    return { ...held, question: event.question, restatedBy: event };
  }
  if (event.kind === "question-offered") {
    return offeredCarry({ event, held });
  }
  if (event.kind === "question-reconfirmed") {
    return held.question === event.question ? { ...held, reconfirmed: reconfirmationOf({ event }) } : held;
  }
  if (event.kind === "question-examples") {
    return illustrated({ event, held });
  }
  if (event.kind === "question-shot") {
    return pictured({ event, held });
  }
  return event.kind === "question-shaped" ? shapedCarry({ event, held }) : held;
}

/**
 * A reshape's effect on the carried question — the same rule {@link shapedOpen} holds for the current cycle.
 *
 * The shape's instant rides `offeredIso`, which is what `inheritedOpen` reads as the instant a carried shape was
 * last stated: a reshape states it exactly as an offer does, and the question is exactly as old as it was.
 */
function shapedCarry({ held, event }: { held: InheritedQuestion; event: ShapedEvent }): InheritedQuestion {
  if (!reshapeBinds({ event, held: inheritedOpen({ inherited: held }) })) {
    return held;
  }
  // The examples go with the reconfirm: they pictured the free-text question the reshape replaced. The re-cut
  // question's own, written on the reshape line, take their place. The picture goes too, for the same reason.
  const { reconfirmed: _restated, illustration: _pictured, shot: _shown, ...kept } = held;
  return {
    ...kept,
    lean: event.lean,
    offeredIso: event.atIso,
    options: event.options,
    problem: event.problem,
    question: event.question,
    restatedBy: event,
    stakes: event.stakes,
    ...ownIllustration({ event }),
  };
}

/**
 * Whether a reshape applies to the question held — the ONE rule both folds, the write guard and the verb read.
 *
 * It binds to the exact text it names, and only to a question recorded with NO shape and NO draft, readable or
 * not. A shaped ask is changed by `handover correct` (its wording) or `handover offer` (its shape and draft), never
 * replaced: replacing one would let a later session overwrite options the owner may already be reading. A question
 * carrying a draft is `handover offer`'s, because its options are derived from that draft's destinations.
 *
 * @param held the question the cycle holds
 * @param event the reshape
 * @returns true when the reshape replaces the held question's text and shape
 */
export function reshapeBinds({
  held,
  event,
}: {
  held: Pick<OpenQuestion, "question" | "shape" | "action" | "actionUnreadable">;
  event: Pick<ShapedEvent, "replaces">;
}): boolean {
  return (
    held.question === event.replaces && held.shape === undefined && held.action === undefined && !held.actionUnreadable
  );
}

/** An offer's effect on the carried question — {@link carryStep}'s one branch with its own rules. */
function offeredCarry({ held, event }: { held: InheritedQuestion; event: OfferEvent }): InheritedQuestion {
  // Bound to the question it names, exactly as `question-posted` is: an offer that landed after an
  // answer and a new question describes a decision nobody is holding any more.
  if (held.question !== event.question) {
    return held;
  }
  // The held question's own stakes are dropped rather than left to survive an offer that carries none:
  // the offer replaces the shape WHOLE, and stakes describing the old options would sit over the new ones.
  // A reconfirm before the offer is dropped with them: the offer re-states the stakes at its own instant.
  const { stakes: _replaced, reconfirmed: _restated, ...kept } = held;
  return { ...kept, ...offerFields({ event }), offeredIso: event.atIso, restatedBy: event };
}

/**
 * What an offer replaces on the question it attaches to — the action AND the whole shape, together.
 *
 * Together because they are one decision: the destinations are what the options describe, so an offer
 * landing a new draft beside the old ask's options would print "post to #delivery" over a message that no
 * longer goes there. `handover offer` refuses a partial for the same reason.
 *
 * @param event the offer
 * @returns the fields to merge onto the held question
 */
function offerFields({ event }: { event: OfferEvent }): {
  readonly action: AskAction;
  readonly problem: string;
  readonly options: OfferEvent["options"];
  readonly lean: string;
  readonly stakes?: AskStakes;
} {
  return {
    action: event.action,
    lean: event.lean,
    options: event.options,
    problem: event.problem,
    ...(event.stakes === undefined ? {} : { stakes: event.stakes }),
  };
}

/**
 * What a reconfirm records on the question it binds to.
 *
 * @param event the reconfirm
 * @returns its instant and its check
 */
function reconfirmationOf({ event }: { event: ReconfirmEvent }): Reconfirmation {
  return { atIso: event.atIso, stillReal: event.stillReal };
}

/**
 * The endings that settle a held question. `orphaned` is absent on purpose: a dead session is not an answer.
 * `question-withdrawn` settles one too, but only the question it names, so {@link carryStep} binds it by text.
 */
const SETTLES_QUESTION: ReadonlySet<RunEvent["kind"]> = new Set(["answered", "finished", "closed", "abandoned"]);

/**
 * The shape a `question` event carries, or `undefined` when it carries none.
 *
 * Whole or nothing: a half-shaped event cannot be written through the verbs (they refuse a partial shape),
 * so one found on disk is a hand-edit, and rendering two thirds of a card is worse than saying the ask was
 * recorded free-text. The reader therefore does not compose a partial.
 *
 * @param event the recorded question
 * @returns its shape, or `undefined` when it was recorded free-text
 */
function shapeOf({ event }: { event: QuestionEvent }): AskShape | undefined {
  const { problem, options, lean, stakes } = event;
  if (problem === undefined || lean === undefined || options === undefined || options.length === 0) {
    return undefined;
  }
  return { lean, options, problem, stakes };
}

/**
 * An open question, and the instant it was ASKED — the pair a reader needs to say how long the owner has had it.
 *
 * The instant is separate from the text because the two move independently: `handover correct` rewrites what
 * is being asked and does not re-ask it, so a correction that reset the clock would report a three-week-old
 * question as fresh every time somebody tidied its wording.
 */
export interface OpenQuestion {
  readonly question: string;
  /** The `question` event's own `atIso` — never a correction's, never a re-start's. */
  readonly askedIso: string;
  /**
   * The problem/options/lean the ask was recorded with, absent on every ask written before the shape was
   * required (`./askShape.ts`).
   *
   * A CORRECTION keeps it, for the same reason it keeps {@link OpenQuestion.askedIso}: `handover correct`
   * restates a question truly, and restating the wording does not change which decision is being asked
   * for. A genuinely different decision is a different ask, not a correction of this one.
   */
  readonly shape: AskShape | undefined;
  /**
   * When the shape was RECORDED — the `question` or `question-offered` event's own `atIso` — which is the
   * instant its still-real check was last confirmed. `undefined` exactly when {@link OpenQuestion.shape} is.
   *
   * Separate from {@link OpenQuestion.askedIso} because an offer re-states the stakes without re-asking:
   * the ask is as old as it was, and the check that it still stands is as fresh as the offer. A correction
   * keeps both, because restating the wording re-checks nothing.
   */
  readonly shapeIso: string | undefined;
  /**
   * The concrete Slack ACTION the ask offers, when it offers one — `./askAction.ts`.
   *
   * Carried by a CORRECTION for the same reason the shape is, and replaced whole by a
   * `question-offered`. Never inherited across a new `question`: a fresh ask with no action is an ask with
   * no draft, and showing the previous one's would put a message the owner already decided about on a card about
   * something else.
   */
  readonly action: AskAction | undefined;
  /**
   * True when the ask DID offer a draft and it would not read — the third state, not the absence above.
   *
   * It exists because the two are told apart nowhere else downstream: a row with no draft legitimately
   * falls back to the options its doc's front matter carries, and a row whose draft is broken must not,
   * since those options describe destinations that just failed to decode. `RunEvent`'s `actionUnreadable`
   * carries why.
   */
  readonly actionUnreadable: boolean;
  /**
   * The last time a refresh pass re-confirmed the question still stands, and the check it re-ran —
   * `handover reconfirm`. Absent until one lands.
   *
   * Separate from {@link OpenQuestion.shapeIso} because it confirms WITHOUT restating anything: no shape, no
   * action, no post. A correction keeps it (the wording moved, the check did not), an offer drops it (the
   * offer is itself the newer confirmation), and a new question never inherits it.
   */
  readonly reconfirmed?: Reconfirmation;
  /**
   * The latest LINE that restated the question — a correction, a reshape or an offer — and so the journal position a
   * ruling must follow to have answered what is being asked NOW (`./heldQuestion.ts`, `rulingsAfterRestatement`).
   * Absent until one lands. A session restates a question it still holds open, so a ruling already on the journal
   * was the input to the restatement, never its answer. MEASURED on a project's briefing row: three
   * corrections, each folding a ruling of the owner's into the question, and the card stayed off their Queue through
   * all of them because the rulings they folded still "answered" it. The line rather than its instant, because a writer
   * stamps before it appends — a console landing scans the board in between — so a ruling the restatement never saw
   * can carry the earlier stamp. {@link OpenQuestion.askedIso} is untouched, so the card still ages the
   * question from when the owner was first asked.
   */
  readonly restatedBy?: QuestionRestatingEvent;
  /**
   * The concrete examples the card leads with — `handover ask` writes them on the asking line itself, and
   * `handover example` appends them later (`./askExamples.ts`). A correction, a reconfirm and an
   * offer keep them (none of them changes which decision is pictured); a new question never inherits them, and a
   * reshape replaces them with its own line's, because it re-cuts the question the scene was written for.
   */
  readonly illustration?: AskExampleSet;
  /**
   * The picture the card shows, boxed where the owner should read — `handover shot` (`./askShot.ts`). Kept
   * and dropped exactly as {@link OpenQuestion.illustration} is: a correction, a reconfirm and an offer keep it, a new
   * question never inherits it, and a reshape drops it, because it re-cuts the question the picture was boxed for.
   */
  readonly shot?: HandShot;
}

/**
 * The open question after one event: asked, corrected while open, or settled by an answer or a withdrawal — the step
 * `boardState`'s run disposition folds, kept beside the reducer it must agree with.
 *
 * A correction replaces the TEXT and KEEPS `askedIso`, exactly as {@link carryStep} does for the inherited
 * carry. The two folds walk the same events and would be a defect the moment they disagreed about when a
 * question started waiting, so the rule is spelled the same way in both.
 *
 * @param open the question open before this event, if any
 * @param event the next journal event
 * @returns the question open after it, or `undefined` when none is
 */
export function openQuestionAfter({
  open,
  event,
}: {
  open: OpenQuestion | undefined;
  event: RunEvent;
}): OpenQuestion | undefined {
  if (event.kind === "question") {
    const shape = shapeOf({ event });
    return {
      action: event.action,
      actionUnreadable: event.actionUnreadable === true,
      askedIso: event.atIso,
      question: event.question,
      shape,
      shapeIso: shape === undefined ? undefined : event.atIso,
      ...ownIllustration({ event }),
    };
  }
  if (event.kind === "question-offered") {
    return offeredOpen({ event, open });
  }
  if (event.kind === "question-shaped") {
    return shapedOpen({ event, open });
  }
  return restatedOpen({ event, open });
}

/**
 * What an event that neither asks, offers nor reshapes does to the open question — {@link restatedCarry}'s twin:
 * a correction restates it, a reconfirm and examples attach to it, and anything else may settle it.
 */
function restatedOpen({ open, event }: { open: OpenQuestion | undefined; event: RunEvent }): OpenQuestion | undefined {
  if (event.kind === "question-corrected") {
    return open === undefined ? undefined : { ...open, question: event.question, restatedBy: event };
  }
  if (event.kind === "question-reconfirmed") {
    // Bound by text, exactly as an offer is: a reconfirm of a question since answered describes nothing.
    return open?.question === event.question ? { ...open, reconfirmed: reconfirmationOf({ event }) } : open;
  }
  if (event.kind === "question-examples") {
    return open === undefined ? open : illustrated({ event, held: open });
  }
  if (event.kind === "question-shot") {
    return open === undefined ? open : pictured({ event, held: open });
  }
  return settledOpen({ event, open });
}

/**
 * Whether an event settles the open question: an answer always does, a withdrawal only the question it names —
 * bound by text, as a reconfirm is, so one naming a question since replaced settles nothing.
 */
function settledOpen({ open, event }: { open: OpenQuestion | undefined; event: RunEvent }): OpenQuestion | undefined {
  if (event.kind === "question-withdrawn") {
    return open?.question === event.question ? undefined : open;
  }
  return event.kind === "answered" ? undefined : open;
}

/**
 * A reshape's effect on the open question — the text and the shape replaced, the ASKED instant kept.
 *
 * The shape's own instant is the reshape's, because its still-real check was confirmed then; a reconfirm of the
 * old text is dropped with it, as an offer drops one. Inert unless {@link reshapeBinds}.
 */
function shapedOpen({ open, event }: { open: OpenQuestion | undefined; event: ShapedEvent }): OpenQuestion | undefined {
  if (open === undefined || !reshapeBinds({ event, held: open })) {
    return open;
  }
  return {
    action: undefined,
    actionUnreadable: false,
    askedIso: open.askedIso,
    question: event.question,
    restatedBy: event,
    shape: { lean: event.lean, options: event.options, problem: event.problem, stakes: event.stakes },
    shapeIso: event.atIso,
    ...ownIllustration({ event }),
  };
}

/**
 * The open question an unsettled cycle's carry hands the new cycle — its original instants, never re-asked.
 *
 * @param inherited the carried question {@link inheritedQuestion} returned
 * @returns the question as {@link openQuestionAfter} folds from
 */
export function inheritedOpen({ inherited }: { inherited: InheritedQuestion }): OpenQuestion {
  const shape = shapeOf({ event: inherited });
  // An offer's (or a reshape's) stakes were confirmed at that event, not at the question it attached to.
  let shapeIso: string | undefined;
  if (shape !== undefined) {
    shapeIso = inherited.atIso;
  }
  if (shape !== undefined && inherited.offeredIso !== undefined) {
    shapeIso = inherited.offeredIso;
  }
  return {
    action: inherited.action,
    actionUnreadable: inherited.actionUnreadable === true,
    askedIso: inherited.atIso,
    question: inherited.question,
    shape,
    shapeIso,
    ...(inherited.reconfirmed === undefined ? {} : { reconfirmed: inherited.reconfirmed }),
    ...(inherited.restatedBy === undefined ? {} : { restatedBy: inherited.restatedBy }),
    ...(inherited.illustration === undefined ? {} : { illustration: inherited.illustration }),
    ...(inherited.shot === undefined ? {} : { shot: inherited.shot }),
  };
}

/** An offer's effect on the open question — {@link openQuestionAfter}'s one branch with its own rules. */
function offeredOpen({ open, event }: { open: OpenQuestion | undefined; event: OfferEvent }): OpenQuestion | undefined {
  // Bound to the question it names, exactly as `carryStep` binds it, and replacing the action and the
  // shape TOGETHER — see `offerFields` for why those two never move apart.
  if (open === undefined || open.question !== event.question) {
    return open;
  }
  const fields = offerFields({ event });
  return {
    action: fields.action,
    // An offer that decoded at all carries a readable action — `questionOfferedEvent` refuses the line
    // whole otherwise — so it CLEARS the mark a broken earlier draft left.
    actionUnreadable: false,
    askedIso: open.askedIso,
    question: open.question,
    shape: { lean: fields.lean, options: fields.options, problem: fields.problem, stakes: fields.stakes },
    shapeIso: event.atIso,
    // The offer is now the latest restatement: a ruling before it was what the draft was written from.
    restatedBy: event,
    // An offer drafts the message the decision is about; the scene picturing that decision still stands.
    ...(open.illustration === undefined ? {} : { illustration: open.illustration }),
    // The picture shows the thing the decision is about, which an offer does not move.
    ...(open.shot === undefined ? {} : { shot: open.shot }),
  };
}
