/**
 * The supersession, performed: decide, journal the intent, delete, journal the result.
 *
 * The effectful shell over `./eligibility.ts`'s pure decision, and the only module here that reads a file,
 * calls Slack or takes a clock. Every one of those is an injected seam, for the reason
 * `.claude/rules/area-live.md` gives about the turn itself: what this module guarantees is an ORDER, and an
 * order is only testable when a fake can record the calls in it.
 *
 * ## The order, and why each step is where it is
 *
 * 1. **Nothing declared → stop, having done nothing.** The overwhelmingly common turn is additive, and it
 *    must not cost a Slack read. No journal row either: a row per turn that did not supersede anything would
 *    bury the ones that did.
 * 2. **Gather both records, then decide ONCE.** The local completion log says whether this install ever
 *    posted the declared target; reading the target back is the ownership check and the live corroboration
 *    in one call — `readOwnedMessage` already refuses a human's message, another app's, and a shape we do
 *    not recognise. `supersessionEligibility` is the single judgement over both, deliberately: two decision
 *    points over the same act is how one of them eventually stops matching the other.
 * 3. **A refused READ short-circuits under its own code.** It is the one thing that does not reach the
 *    decision, because there is nothing to judge — and its code says more than a generic refusal would.
 * 4. **Journal the INTENT, then delete, then journal the RESULT.** In that order, so a session that dies
 *    mid-delete leaves an intent with no result rather than silence. An intent row that cannot be WRITTEN
 *    refuses the delete outright: an irreversible act with no record of why is the one thing worse than a
 *    stale answer left standing.
 *
 * ## Every ending is a report, never a throw — and that is CONTAINED, not merely intended
 *
 * A correction turn has ALREADY posted its answer by the time this runs. A supersession that fails must
 * therefore not fail the turn — the thread has the right answer in it, and the old one standing beside it is
 * untidy rather than wrong. So every arm here returns a {@link SupersessionReport}, the caller folds a
 * non-success into a secondary diagnostic, and the one thing that is never done is letting a failed cleanup
 * destroy a delivered answer.
 *
 * Returning a report on every arm is not the same as never throwing, and the gap is where the damage was:
 * the journal writes synchronously, so an unwritable log threw straight through `../outcomeFields.ts` into
 * `runTurn` — rejecting the turn, and on the result row doing it with the superseded answer already gone.
 * Two layers close it. `./journalWrite.ts`'s `record` contains each journal append and REPORTS what it
 * cost, so an unwritten intent row refuses before any delete and an unwritten result row still reports the
 * delete that happened. {@link settleSupersession} then wraps the whole body, so nothing else a seam can
 * throw escapes either.
 */
import type { PostedMessage } from "../../../corpus/slack/writeTransport.js";
import { err, type Result } from "../../../lib/result.js";
import type { OwnedDeleteOutcome } from "../../../outbound/slack/deleteOwnedMessage.js";
import type { ReadSlackMessage } from "../../../outbound/slack/lifecycleGuards.js";
import type { OwnedDeleteError } from "../../../outbound/slack/ownedDeleteErrors.js";
import type { AskIdentity } from "../../ask/identity.js";
import { alreadyAttempted } from "./atMostOnce.js";
import { answeredPredecessors, predecessorAt } from "./completionReader.js";
import {
  type EligibleSupersession,
  type SupersessionReview,
  type SupersessionWarrant,
  supersessionEligibility,
} from "./eligibility.js";
import type { SupersessionError } from "./errors.js";
import {
  type SupersessionAttempt,
  type SupersessionEvent,
  type SupersessionOutcome,
  supersessionIntent,
  supersessionSettled,
} from "./journal.js";
import { causeOf, record, withUnwritten } from "./journalWrite.js";

/** What one correction turn's supersession did, as the turn records it. */
export interface SupersessionReport {
  /** `not-declared` is the ordinary additive turn; every other value means a declared supersession resolved. */
  readonly outcome: SupersessionOutcome | "not-declared";
  /** The message the turn declared, absent when it declared none. */
  readonly targetTs?: string | undefined;
  /** The domain code behind anything but a clean delete. */
  readonly code?: string | undefined;
  /** The one human sentence a diagnostic prints. */
  readonly detail?: string | undefined;
}

/** The seams this shell drives. Each is the narrowest thing that does its job, so a fake is a function. */
export interface SupersessionDeps {
  /** The completion log's raw text — this install's record of every answer it posted. */
  readonly readCompletions: () => string;
  /** Read the target back and confirm it is one of ours, or say exactly why not. */
  readonly readOwned: (input: { posted: PostedMessage }) => Promise<Result<ReadSlackMessage, OwnedDeleteError>>;
  /** Delete it, at most once, through the door — refusing if its own read shows an edit since that instant. */
  readonly deleteOwned: (input: {
    posted: PostedMessage;
    unchangedSince: string;
  }) => Promise<Result<OwnedDeleteOutcome, OwnedDeleteError>>;
  /**
   * Append one journal row, reporting failure by THROWING.
   *
   * The return type is the contract, not an omission: a row either lands or the call raises, which is what
   * `./store.ts`'s `appendSupersessionEvent` does and what `record` is built to contain. A seam that
   * reported failure by RETURNING something instead would have that something dropped here — so the
   * returning shape is refused at the type rather than guarded against at runtime, and a future journal that
   * wants to report a failed append has to change this signature and every reader of it at once.
   */
  readonly journal: (input: { event: SupersessionEvent }) => void;
  /**
   * Every attempt this journal already holds, folded per (turn, target) by `./journal.ts`.
   *
   * The READ half of `journal`, and it is what makes "at most once" a property of the code rather than of
   * how many times the caller happens to run. A turn re-dispatched after a crash reaches this shell with
   * the same `turnId` and the same declared target, and without this seam it would journal a second intent
   * and issue a second delete.
   *
   * It reports a failed READ beside the rows rather than answering an empty list, because those two are
   * different facts and only one of them is safe to act on — `./atMostOnce.ts` says which.
   */
  readonly readAttempts: () => {
    readonly attempts: readonly SupersessionAttempt[];
    readonly readFailure: string | undefined;
  };
  /** The clock, injected so a row's instant is assertable. */
  readonly nowIso: () => string;
}

/** Record a refusal that never reached a delete, and report it. */
function refuse({
  deps,
  turnId,
  targetTs,
  code,
  detail,
}: {
  deps: SupersessionDeps;
  turnId: string;
  targetTs: string;
  code: string;
  detail: string;
}): SupersessionReport {
  const unwritten = record({
    build: () => supersessionSettled({ code, detail, outcome: "refused", targetTs, tsIso: deps.nowIso(), turnId }),
    journal: deps.journal,
  });
  return { code, detail: withUnwritten({ detail, unwritten }), outcome: "refused", targetTs };
}

/** What a completed delete attempt settles as — the one place an outcome kind and a domain code are chosen. */
function settlementOf({ attempt }: { attempt: Result<OwnedDeleteOutcome, OwnedDeleteError> }): {
  readonly outcome: SupersessionOutcome;
  readonly code?: string | undefined;
  readonly detail?: string | undefined;
} {
  if (attempt.isOk()) {
    if (attempt.value.kind === "already-gone") {
      return { outcome: "already-gone" };
    }
    if (attempt.value.kind === "deleted") {
      return { outcome: "deleted" };
    }
    // `dry-run`. Unreachable from this lane — there is no dry correction, and the live wiring passes
    // `dryRun: false` — but written out rather than folded into `deleted`, because a journal row claiming an
    // irreversible act that did not happen is the one entry in this file worth being paranoid about.
    return {
      code: "DRY_RUN_IN_LIVE_LANE",
      detail: "the delete reported a dry run, which this lane never asks for — nothing was removed",
      outcome: "refused",
    };
  }
  const { code, message } = attempt.error;
  // `DELETE_UNCONFIRMED` is the one error that is not a refusal: the call was entered, so the message may be
  // gone. Everything else — the door, a route failure, an ownership verdict — left it standing.
  const outcome: SupersessionOutcome = code === "DELETE_UNCONFIRMED" ? "unconfirmed" : "refused";
  return { code, detail: message, outcome };
}

/**
 * Read both records the decision needs — our own completion log and Slack's live message — and judge.
 *
 * Split out of {@link settleSupersession} along a real seam rather than for its length: everything here
 * READS, and nothing here writes. The caller is the half that journals and deletes, so the one function in
 * this file that can change the world is the one a reader can hold whole.
 *
 * A read that REFUSED is reported under its own code rather than collapsed into "no such answer": the
 * difference between "a human posted that" and "we could not reach Slack" is the whole value of the row.
 */
async function judgeSupersession({
  askIdentity,
  declaredTs,
  deps,
  postedAnswerDigest,
  postedAnswerTs,
  posted,
  review,
  turnId,
  warrant,
}: {
  askIdentity: AskIdentity;
  declaredTs: string;
  deps: SupersessionDeps;
  postedAnswerDigest: string;
  postedAnswerTs: string;
  posted: PostedMessage;
  review: SupersessionReview | undefined;
  turnId: string;
  warrant: SupersessionWarrant | undefined;
}): Promise<Result<EligibleSupersession, SupersessionError | OwnedDeleteError>> {
  const predecessor = predecessorAt({
    answerTs: declaredTs,
    predecessors: answeredPredecessors({ text: deps.readCompletions() }),
  });
  const read = await deps.readOwned({ posted });
  if (read.isErr()) {
    return err(read.error);
  }
  const judged = supersessionEligibility({
    askIdentity,
    declaredTs,
    live: read.value,
    postedAnswerDigest,
    postedAnswerTs,
    predecessor,
    review,
    warrant,
  });
  if (judged.isErr()) {
    return judged;
  }
  // LAST, after every check about the answer and the verdict: `ALREADY_ATTEMPTED` raised first would hide
  // what an auditor is really looking for behind an earlier run's bookkeeping — `./atMostOnce.ts`.
  const journalled = deps.readAttempts();
  const attempted = alreadyAttempted({ ...journalled, targetTs: declaredTs, turnId });
  if (attempted !== undefined) {
    return err(attempted);
  }
  return judged;
}

/**
 * The irreversible half: delete, then journal what the delete settled as.
 *
 * Split from {@link performSupersession} along the same seam {@link judgeSupersession} draws from the other
 * side — everything before this point can still change its mind, and nothing here can.
 *
 * `unchangedSince` is the decision's own `recordedIso`, and it is passed rather than re-derived so the read
 * the DELETE takes asks the same edit question the eligibility read already answered. An edit landing in
 * between is the one window the two-read shape leaves open; `./eligibility.ts`'s header § The race that
 * survives says what is left after it.
 */
async function deleteAndRecord({
  deps,
  posted,
  targetTs,
  turnId,
  unchangedSince,
}: {
  deps: SupersessionDeps;
  posted: PostedMessage;
  targetTs: string;
  turnId: string;
  unchangedSince: string;
}): Promise<SupersessionReport> {
  const settlement = settlementOf({ attempt: await deps.deleteOwned({ posted, unchangedSince }) });
  const unwritten = record({
    build: () => supersessionSettled({ ...settlement, targetTs, tsIso: deps.nowIso(), turnId }),
    journal: deps.journal,
  });
  if (unwritten === undefined) {
    return { ...settlement, targetTs };
  }
  // A CODE, not only a sentence. `../outcomeFields.ts` reports a clean delete as nothing at all — which is
  // right, there is nothing to act on — so a detail arriving with no code beside it is dropped there and the
  // failed append disappears from the turn entirely. A settlement that already has its own code keeps it:
  // what it found out is more specific than "the journal would not take the row".
  let code = "JOURNAL_UNWRITABLE";
  if (settlement.code !== undefined) {
    code = settlement.code;
  }
  return { ...settlement, code, detail: withUnwritten({ detail: settlement.detail, unwritten }), targetTs };
}

/**
 * Journal the INTENT row for a supersession that has passed every check, answering what an unwritten row cost.
 *
 * Every field it needs but the turn's own two comes off {@link EligibleSupersession} rather than off the
 * caller's locals: the decision already resolved which thread, which target and which superseded turn, and a
 * row rebuilt from the inputs beside it could disagree with the act it claims to record.
 */
function recordIntent({
  deps,
  eligible,
  postedAnswerTs,
  turnId,
}: {
  deps: SupersessionDeps;
  eligible: EligibleSupersession;
  postedAnswerTs: string;
  turnId: string;
}): string | undefined {
  return record({
    build: () =>
      supersessionIntent({
        answerTs: postedAnswerTs,
        channel: eligible.askIdentity.channel,
        reason: eligible.reason,
        supersededTurnId: eligible.supersededTurnId,
        targetTs: eligible.targetTs,
        threadTs: eligible.askIdentity.threadTs,
        tsIso: deps.nowIso(),
        turnId,
      }),
    journal: deps.journal,
  });
}

/** Perform the supersession a correction turn declared, if it declared one. The body {@link settleSupersession} contains. */
async function performSupersession({
  declaredTs,
  review,
  warrant,
  askIdentity,
  turnId,
  postedAnswerDigest,
  postedAnswerTs,
  deps,
}: {
  declaredTs: string | undefined;
  review: SupersessionReview | undefined;
  warrant: SupersessionWarrant | undefined;
  askIdentity: AskIdentity;
  turnId: string;
  postedAnswerDigest: string;
  postedAnswerTs: string;
  deps: SupersessionDeps;
}): Promise<SupersessionReport> {
  if (declaredTs === undefined) {
    return { outcome: "not-declared" };
  }
  const posted: PostedMessage = { channel: askIdentity.channel, ts: declaredTs };
  // Both refusals below journal under the same turn and the same target; only the code and the sentence
  // differ, and binding the pair once keeps a future third arm from quietly disagreeing about either.
  const refuseWith = (reason: { code: string; detail: string }): SupersessionReport =>
    refuse({ ...reason, deps, targetTs: declaredTs, turnId });
  const eligible = await judgeSupersession({
    askIdentity,
    declaredTs,
    deps,
    posted,
    postedAnswerDigest,
    postedAnswerTs,
    review,
    turnId,
    warrant,
  });
  if (eligible.isErr()) {
    return refuseWith({ code: eligible.error.code, detail: eligible.error.message });
  }
  const unintended = recordIntent({ deps, eligible: eligible.value, postedAnswerTs, turnId });
  if (unintended !== undefined) {
    return refuseWith({
      code: "JOURNAL_UNWRITABLE",
      detail: `the intent row could not be written (${unintended}), so nothing was deleted`,
    });
  }
  return deleteAndRecord({
    deps,
    posted,
    targetTs: declaredTs,
    turnId,
    unchangedSince: eligible.value.recordedIso,
  });
}

/**
 * Settle the supersession a correction turn declared — and never, under any seam's failure, throw.
 *
 * The thin containing wrapper over {@link performSupersession}, and it is a safety property rather than
 * defensive habit: by the time this runs the thread already holds the right answer, so a throw escaping
 * here rejects a turn whose work is DONE, and if it escapes after the delete it does so with the superseded
 * answer already gone. Every fallible seam is contained one layer further in — the journal by
 * `./journalWrite.ts`'s `record`, the Slack reads and the delete by their own typed results — and this
 * catch is what covers the rest, an unexpected throw included.
 *
 * **A caught throw still LEAVES A ROW.** A declared supersession that resolved without journalling anything
 * is indistinguishable, to the audit, from a turn that never declared one — which is the exact distinction
 * the two-row journal is for. So the catch records its own settled row, through the same contained
 * `record` the rest of the module uses, and reports the append if even that failed.
 *
 * **A caught throw reports `unconfirmed`, never `refused`**, because this layer cannot know which side of
 * the delete it was on and `unconfirmed` is exactly the claim "the message may or may not be gone". Saying
 * `refused` would tell an operator the old answer is still standing, which is the confident-wrong half of
 * the same ambiguity `../outcomeFields.ts` words its stuck message around.
 *
 * @param declaredTs the `supersedes` timestamp off the answer form, absent on an additive turn
 * @param review the reviewer's judgement about it, absent when no verdict carried one
 * @param warrant the verdict's own provenance — its digest binding and its two sessions
 * @param postedAnswerDigest the digest of the answer this turn posted, which the warrant must be bound to
 * @param askIdentity the ask this correction answered — its channel and thread bound the whole act
 * @param turnId the turn doing the superseding, so the journal names the work
 * @param postedAnswerTs the answer this turn just posted, so it can never target itself
 * @param deps the injected seams
 * @returns what happened, in the shape the turn records
 */
export async function settleSupersession({
  declaredTs,
  review,
  warrant,
  askIdentity,
  turnId,
  postedAnswerDigest,
  postedAnswerTs,
  deps,
}: {
  declaredTs: string | undefined;
  review: SupersessionReview | undefined;
  warrant: SupersessionWarrant | undefined;
  askIdentity: AskIdentity;
  turnId: string;
  postedAnswerDigest: string;
  postedAnswerTs: string;
  deps: SupersessionDeps;
}): Promise<SupersessionReport> {
  try {
    return await performSupersession({
      askIdentity,
      declaredTs,
      deps,
      postedAnswerDigest,
      postedAnswerTs,
      review,
      turnId,
      warrant,
    });
  } catch (thrown: unknown) {
    const detail =
      "the supersession failed part-way through and may or may not have deleted anything — " + causeOf({ thrown });
    if (declaredTs === undefined) {
      // No target, so no row: every journal row is keyed on the message it was about, and one keyed on
      // nothing is unreadable to the audit this journal exists for. An additive turn returns before any
      // seam runs, so reaching here at all would mean something threw with nothing yet to record.
      return { code: "SUPERSESSION_THREW", detail, outcome: "unconfirmed" };
    }
    const unwritten = record({
      build: () =>
        supersessionSettled({
          code: "SUPERSESSION_THREW",
          detail,
          outcome: "unconfirmed",
          targetTs: declaredTs,
          tsIso: deps.nowIso(),
          turnId,
        }),
      journal: deps.journal,
    });
    return {
      code: "SUPERSESSION_THREW",
      detail: withUnwritten({ detail, unwritten }),
      outcome: "unconfirmed",
      targetTs: declaredTs,
    };
  }
}
