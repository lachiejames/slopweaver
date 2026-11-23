/**
 * The COMPLETION ENVELOPE — the typed, durable outcome every controlled turn settles into.
 *
 * `TurnHandlerOutcome` (this file, unchanged in field shape from `./run.ts`'s original) is what `runTurn`'s
 * internal steps build as they go; `turnCompletionFromOutcome` folds it, ONCE, into the durable
 * `TurnCompletion` a turn actually returns and persists. The split exists so the folding rule — which
 * combinations are valid, which diagnostics survive — is one pure function with its own tests, rather than
 * inline arithmetic inside `runTurn` itself.
 *
 * `TurnProvenance` lives here rather than in `./run.ts`, where it used to: `./run.ts` needs
 * `turnCompletionFromOutcome`, so keeping the type it closes over in the same direction avoids the import
 * cycle a callback the other way would create. `./run.ts` re-exports it for every existing import site.
 * The log's own encode/decode lives in `./completionLog.ts`, which imports these types and is never imported
 * back.
 *
 * ## Why `TurnPrimaryOutcome` has the arms it has, and not the five names once proposed
 *
 * An earlier draft of this handover named `triaged-no-response` and `dispatched` alongside `answered`,
 * `withheld` and `failed` — but neither has a real producer in this codebase: H5's `judgeRouting` is an
 * offline eval seam with no live consumer (see `./judgement.ts`'s own header), so nothing here can honestly
 * fold a routing DECISION into a completion yet. Naming an arm no code can ever construct is worse than not
 * having it — a `switch` over the union would need a branch that can never run, and a test asserting it
 * would be asserting a fiction. The two dropped arms are real future work for the handover that actually
 * wires H5 into the live path, not a gap in this one.
 *
 * `answer-lost` is a FOURTH arm, and it earns its place by the same test those two failed:
 * it has a real producer. `./run.ts`'s `settledDelivery` catches a throw from the DELIVERY path, which is
 * reached only once the query has already returned an answer — so at that instant a composed (and, on the
 * measured turn, reviewed and verdict-clean) answer existed and was destroyed. Folding that into `failed`
 * told every reader the opposite of what happened: `failed` means the turn never got to an answer, which
 * invites re-judging the question as unanswerable rather than simply running the turn again.
 *
 * `first-answered` is a FIFTH, with a real producer too: an answer form declaring
 * `followThrough` posts through `./turnDelivery.ts` as a plan the same worker keeps building after. It is its
 * own arm rather than a flag on `answered` so every exhaustive reader has to decide what a non-ending answer
 * means to it, instead of inheriting `answered`'s "the turn is over" by default.
 */
import { err, ok, type Result } from "../../lib/result.js";
import type { SupervisorSession } from "../../supervisor/session.js";
import type { AskIdentity } from "../ask/identity.js";
import type { FollowThroughOwes } from "../ask/lifecycleEvents.js";
import { type TurnError, TurnErrors } from "./turnErrors.js";

/** The provenance a turn stamps on everything it posts. */
export interface TurnProvenance {
  /** The visible host driving the turn. Absent only on a capture-only listener with no answering session yet. */
  readonly supervisor?: SupervisorSession | undefined;
  /** The model driving it. */
  readonly modelId: string;
}

/**
 * Whether the turn reached an answer, and what it left in the thread either way — the pre-envelope shape
 * `runTurn`'s internal steps build as they go. Unchanged in field meaning from before this handover; see
 * `turnCompletionFromOutcome` for how it folds into the durable {@link TurnCompletion}.
 */
export interface TurnHandlerOutcome {
  /** `true` when an answer card was posted; `false` when the turn broke or its answer was withheld. */
  readonly answered: boolean;
  /** The working message's timestamp, once it exists. */
  readonly workingTs?: string | undefined;
  /** The answer card's timestamp, when one was posted. For a withheld/failed turn, the notice's timestamp. */
  readonly answerTs?: string | undefined;
  /** Why the turn BROKE. Present only on a failure. */
  readonly failure?: string | undefined;
  /**
   * `true` when the turn had already COMPOSED an answer and broke while delivering it, rather than breaking
   * before it had one. Only ever set alongside `failure`, and only by `./run.ts`'s delivery-path catch —
   * the one place in the turn where the answer provably existed.
   */
  readonly answerLost?: boolean | undefined;
  /** The reply the door held rather than sent, and the queue id it was filed under. */
  readonly withheld?: { readonly id: string; readonly code: string; readonly reason: string } | undefined;
  /** Why the thread title was not set, when it was attempted and refused. */
  readonly titleFailure?: string | undefined;
  /**
   * Why the native "thinking" indicator failed — SET, CLEAR, or both, in that order. Never collapsed: a
   * failure to CLEAR is a worse fact than a failure to set (it leaves "is looking into it…" standing over a
   * finished answer), and folding the two into one slot with `??` silently dropped whichever happened second.
   * Empty when the indicator behaved throughout.
   */
  readonly statusFailure?: readonly string[];
  /** Why the working checklist could not be resolved to a terminal frame, when neither resolution path could. */
  readonly checklistFailure?: string | undefined;
  /**
   * One line per card an EARLIER turn on this ask left in the thread that this answered turn could not
   * delete, each naming the channel and timestamp to delete by hand. Empty when every card went.
   */
  readonly reapFailure?: readonly string[];
  /**
   * Why the answer this correction SUPERSEDED is still standing, when the turn declared one and the delete
   * did not settle cleanly.
   *
   * One line rather than a list, because a turn supersedes at most one answer. Absent on the ordinary
   * additive turn AND on a clean delete — a row saying "nothing was superseded" on every turn that
   * superseded nothing would bury the turns that did, which is the same reasoning `./supersession/run.ts`
   * gives for journalling nothing on an undeclared turn.
   */
  readonly supersessionFailure?: string | undefined;
  /**
   * Present only alongside `answered: true`, when the posted answer declared `followThrough` — the answer is
   * a FIRST answer and the turn is not over. Carries the posted form's digest so the lifecycle event can mark
   * the verdict that cleared it as spent.
   */
  readonly firstAnswer?: FirstAnswerOutcome | undefined;
}

/** What a posted first answer still owes, and the digest of the form that declared it. */
interface FirstAnswerOutcome {
  readonly answerDigest: string;
  readonly followThrough: { readonly owes: FollowThroughOwes; readonly what: string };
}

/**
 * Which of the three controlled outcomes a turn actually reached, with the payload each one earns.
 *
 * `answered`/`withheld`/`failed` are the only arms — see this file's own header for why two originally
 * proposed arms are not here.
 */
export type TurnPrimaryOutcome =
  | { readonly kind: "answered"; readonly answerTs: string }
  /**
   * A first answer posted and the turn NOT over — the same worker still owes `followThrough`. See this
   * file's header and `../ask/lifecycleEvents.ts`'s `FirstAnsweredEvent`.
   */
  | ({ readonly kind: "first-answered"; readonly answerTs: string } & FirstAnswerOutcome)
  | {
      readonly kind: "withheld";
      readonly noticeTs: string;
      readonly held: { readonly id: string; readonly code: string; readonly reason: string };
    }
  /**
   * `noticeTs` is OPTIONAL on this arm alone, and that is a fix rather than a looseness.
   *
   * It used to be required, which read as "a failed turn always managed to post a card saying so". It does
   * not: the failure card goes through the admit door like every other write, and a turn the door refused
   * can have that notice refused too — as can a transport fault. Requiring the timestamp made
   * `turnCompletionFromOutcome` REFUSE such a turn, which threw out of `runTurn`, which meant no completion
   * and no terminal lifecycle event were ever recorded for it. That is the same "the turn silently stays
   * open" defect `./indicators.ts` documents, one layer below the indicators themselves.
   */
  | { readonly kind: "failed"; readonly noticeTs?: string | undefined; readonly reason: string }
  /**
   * The turn HAD an answer and lost it — the same shape as `failed`, a different claim.
   *
   * `failed` says no answer was ever reached, so the open question is whether this ask can be answered at
   * all. This says one WAS reached and was destroyed on the way out, so the question is settled and only the
   * delivery is not; the retry path is simply to run the turn again. Separated because a
   * composed and reviewed answer to the owner's own work order was destroyed by a repository lookup that
   * threw (`../../lib/gitRepo.ts`'s `runningCheckoutRoot` header) and the ask's ledger row read `failed`.
   */
  | { readonly kind: "answer-lost"; readonly noticeTs?: string | undefined; readonly reason: string };

/** One secondary diagnostic — a courtesy effect that failed without breaking the turn. Never collapsed. */
export type TurnSecondaryFailure =
  | { readonly kind: "title"; readonly reason: string }
  | { readonly kind: "status"; readonly reason: string }
  | { readonly kind: "checklist"; readonly reason: string }
  | { readonly kind: "reap"; readonly reason: string }
  | { readonly kind: "supersession"; readonly reason: string };

/** The durable, typed outcome of one controlled turn. */
export interface TurnCompletion {
  readonly askIdentity: AskIdentity;
  readonly turnId: string;
  readonly provenance: TurnProvenance;
  readonly workingTs: string;
  readonly primary: TurnPrimaryOutcome;
  /**
   * Every secondary diagnostic that fired, in `title`/`status`/`checklist`/`reap`/`supersession` order.
   * Empty, never omitted.
   */
  readonly secondaryFailures: readonly TurnSecondaryFailure[];
}

/** One completion, as it is appended to the durable log. */
export interface TurnCompletionEvent {
  readonly kind: "turn-completed";
  readonly tsIso: string;
  readonly completion: TurnCompletion;
}

/** Where a turn's completion is durably recorded, injected. */
export type CompletionSink = (input: { completion: TurnCompletion }) => Promise<void>;

/** Push a secondary failure onto the list, in deterministic order, only when it actually happened. */
function secondaryFailuresOf({ outcome }: { outcome: OutcomeSnapshot }): readonly TurnSecondaryFailure[] {
  const failures: TurnSecondaryFailure[] = [];
  if (outcome.titleFailure !== undefined) {
    failures.push({ kind: "title", reason: outcome.titleFailure });
  }
  // Unset when the indicator behaved throughout (`statusOutcomeFields` spreads `{}` then).
  const { statusFailure } = outcome;
  if (statusFailure != null) {
    for (const reason of statusFailure) {
      failures.push({ kind: "status", reason });
    }
  }
  if (outcome.checklistFailure !== undefined) {
    failures.push({ kind: "checklist", reason: outcome.checklistFailure });
  }
  if (outcome.reapFailure !== undefined) {
    for (const reason of outcome.reapFailure) {
      failures.push({ kind: "reap", reason });
    }
  }
  if (outcome.supersessionFailure !== undefined) {
    failures.push({ kind: "supersession", reason: outcome.supersessionFailure });
  }
  return failures;
}

/** The fold's result shape — the completion, or every reason it could not be built. */
type FoldedCompletion = Result<TurnCompletion, TurnError>;

/**
 * A plain, getter-free copy of every field a {@link TurnHandlerOutcome} declares, taken once.
 *
 * `outcome` is a caller-supplied object, and every arm below reads several of its optional fields more than
 * once while deciding which completion it earns. Reading straight off `outcome` each time is a
 * time-of-check/time-of-use gap: an accessor-backed field (a getter) could answer differently on its second
 * read than its first, so a value already validated as `undefined` could read as defined moments later,
 * inside the very branch that validation was meant to rule out. Copying every field into a plain object
 * ONCE, before any branch runs, removes the gap rather than tolerating it — every subsequent read is a plain
 * property lookup on data that cannot change underneath the fold.
 */
type OutcomeSnapshot = Omit<TurnHandlerOutcome, "workingTs" | "statusFailure" | "reapFailure"> & {
  readonly workingTs: string;
  readonly reapFailure: readonly string[] | undefined;
  readonly statusFailure: readonly string[] | undefined;
};

/** Copy every field of `outcome`, exactly once, into a plain snapshot — see {@link OutcomeSnapshot}. */
function snapshotOf({ outcome, workingTs }: { outcome: TurnHandlerOutcome; workingTs: string }): OutcomeSnapshot {
  return {
    answered: outcome.answered,
    answerLost: outcome.answerLost,
    answerTs: outcome.answerTs,
    checklistFailure: outcome.checklistFailure,
    failure: outcome.failure,
    firstAnswer: outcome.firstAnswer,
    reapFailure: outcome.reapFailure,
    statusFailure: outcome.statusFailure,
    supersessionFailure: outcome.supersessionFailure,
    titleFailure: outcome.titleFailure,
    withheld: outcome.withheld,
    workingTs,
  };
}

/** The fields every arm of the fold shares, once the snapshot and `secondaryFailures` are already known. */
interface FoldContext {
  readonly askIdentity: AskIdentity;
  readonly outcome: OutcomeSnapshot;
  readonly provenance: TurnProvenance;
  readonly secondaryFailures: readonly TurnSecondaryFailure[];
  readonly turnId: string;
  readonly workingTs: string;
}

/** The `answered:true` arm — refuses a failure or a withheld reply riding alongside it. */
function answeredCompletion({
  askIdentity,
  outcome,
  provenance,
  secondaryFailures,
  turnId,
  workingTs,
}: FoldContext): FoldedCompletion {
  if (outcome.failure !== undefined || outcome.withheld !== undefined) {
    return err(TurnErrors.completionInvalid({ invariant: "answered-with-failure" }));
  }
  if (outcome.answerTs === undefined) {
    return err(TurnErrors.completionInvalid({ invariant: "answered-without-ts" }));
  }
  const first = outcome.firstAnswer;
  return ok({
    askIdentity,
    primary:
      first === undefined
        ? { answerTs: outcome.answerTs, kind: "answered" }
        : {
            answerDigest: first.answerDigest,
            answerTs: outcome.answerTs,
            followThrough: first.followThrough,
            kind: "first-answered",
          },
    provenance,
    secondaryFailures,
    turnId,
    workingTs,
  });
}

/** The withheld arm — refuses one that is ALSO reported as a failure. */
function withheldCompletion({
  askIdentity,
  outcome,
  provenance,
  secondaryFailures,
  turnId,
  workingTs,
}: FoldContext): FoldedCompletion {
  if (outcome.failure !== undefined) {
    return err(TurnErrors.completionInvalid({ invariant: "withheld-and-failed" }));
  }
  if (outcome.answerTs === undefined || outcome.withheld === undefined) {
    return err(TurnErrors.completionInvalid({ invariant: "withheld-without-ts" }));
  }
  return ok({
    askIdentity,
    primary: { held: outcome.withheld, kind: "withheld", noticeTs: outcome.answerTs },
    provenance,
    secondaryFailures,
    turnId,
    workingTs,
  });
}

/**
 * The broken arm — reached only once `answered` and `withheld` have both been ruled out.
 *
 * Folds to `answer-lost` rather than `failed` when the outcome reports the answer had already been composed,
 * because those are two different claims about the same absent reply.
 */
function failedCompletion({
  askIdentity,
  outcome,
  provenance,
  secondaryFailures,
  turnId,
  workingTs,
}: FoldContext): FoldedCompletion {
  if (outcome.failure === undefined) {
    return err(TurnErrors.completionInvalid({ invariant: "failed-without-reason" }));
  }
  return ok({
    askIdentity,
    // No `answerTs` means the failure card itself could not be posted. That is worth recording as the
    // absence it is — never worth refusing the whole completion over, which would leave the ask with no
    // terminal event at all and every sweep still counting it as working.
    primary: {
      kind: outcome.answerLost === true ? "answer-lost" : "failed",
      ...(outcome.answerTs === undefined ? {} : { noticeTs: outcome.answerTs }),
      reason: outcome.failure,
    },
    provenance,
    secondaryFailures,
    turnId,
    workingTs,
  });
}

/**
 * Fold a pre-envelope outcome into the durable completion it earns, refusing a combination that cannot be
 * a real turn rather than silently picking one field over another.
 *
 * @param askIdentity the exact ask this completion answers
 * @param outcome the pre-envelope outcome `runTurn`'s internal steps built
 * @param provenance the session link and model id stamped on this turn
 * @param turnId the id correlating this completion with every message the turn posted
 * @returns the completion, or every reason the outcome could not be folded
 */
export function turnCompletionFromOutcome({
  askIdentity,
  outcome,
  provenance,
  turnId,
}: {
  askIdentity: AskIdentity;
  outcome: TurnHandlerOutcome;
  provenance: TurnProvenance;
  turnId: string;
}): FoldedCompletion {
  // Read ONCE, before any branch — see `OutcomeSnapshot`'s own doc for why a second read of a caller-owned
  // field is a gap this fold must not have.
  const workingTs = outcome.workingTs;
  if (workingTs === undefined) {
    return err(TurnErrors.completionInvalid({ invariant: "no-working-ts" }));
  }
  const snapshot = snapshotOf({ outcome, workingTs });
  const context: FoldContext = {
    askIdentity,
    outcome: snapshot,
    provenance,
    secondaryFailures: secondaryFailuresOf({ outcome: snapshot }),
    turnId,
    workingTs,
  };
  if (snapshot.answered) {
    return answeredCompletion(context);
  }
  if (snapshot.withheld !== undefined) {
    return withheldCompletion(context);
  }
  return failedCompletion(context);
}
