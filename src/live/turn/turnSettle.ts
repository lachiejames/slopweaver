/**
 * Turning however a turn ended into an ENDING, rather than an escape.
 *
 * **Ordering 4** of the list in {@link ./run}: a failure still posts a card, because a turn that throws and
 * leaves a half-ticked checklist is indistinguishable from one still working. The card says what broke and
 * carries whatever coverage was established before it did.
 *
 * {@link settledDelivery} is why this module sits ABOVE {@link ./turnDelivery} rather than beside it. Its
 * body is a try around the delivery and a catch that converts a door refusal into a `failed` completion.
 * Its own note carries the turn that produced it.
 *
 * **One delivery outcome is deliberately NOT settled here**, and it is the one this module has to be read
 * alongside: a retryable answer-send refusal (`./runContract.ts`'s `AnswerSendRefusal` — a warn-tier door
 * refusal, an answer whose payload the wire guard would refuse, `ANSWER_FORM_UNSENDABLE`, or a `profile.json`
 * whose voice rules cannot be read, `ANSWER_PROFILE_UNREADABLE`) is returned as an
 * `Err` rather than converted into an ending, because every act in this file — the failure card, the terminal
 * reaction, the settled checklist and the `failed` lifecycle event that supersedes the dispatch — is a claim
 * that the turn is over, and it is not. The worker holding the answer is still alive.
 *
 * **A posted FIRST answer is the second non-ending**, and it differs from the refusal only in that the
 * answer is in the thread. An answer form declaring `followThrough` is a plan the same worker keeps building
 * after (`../ask/lifecycleEvents.ts`'s `FirstAnsweredEvent`), so {@link settledFirstAnswer} ends the thinking
 * status and writes one line under the running step, and finalises nothing else: no terminal checklist
 * frame, no delete, no terminal reaction. Unlike the refusal it IS folded into a completion — the
 * `first-answered` arm — because the post happened and the ledger must say so.
 */

import type { SlackUpload } from "../../corpus/slack/writeTransport.js";
import { err, ok, type Result } from "../../lib/result.js";
import type { Mention } from "../listen/mention.js";
import type { TurnHandlerOutcome, TurnProvenance } from "./envelope.js";
import { turnFailureForm } from "./failureForm.js";
import {
  finaliseIndicators,
  type TurnIndicatorSeams,
  type TurnTerminalState,
  terminalReasonFor,
} from "./indicators.js";
import { slackUserIdsIn } from "./quotedQuestion.js";
import {
  type AnswerSendRefusal,
  coverageOfFailure,
  type DeliveredTurn,
  DoorRecordingRefusedError,
  DoorRefusedError,
  type HoldSink,
  type TurnPoster,
  type TurnQueryOutcome,
} from "./runContract.js";
import { reasonOf } from "./turnCursor.js";
import { deliverAnswer } from "./turnDelivery.js";

/** One terminal path's result: the outcome to fold, and every indicator it could not settle. */
export interface SettledTurn {
  readonly outcome: TurnHandlerOutcome;
  readonly checklistSettled: boolean;
  readonly failures: readonly string[];
}

/**
 * Which terminal state a thrown value earns.
 *
 * A {@link DoorRefusedError} is the door saying no — an intended outcome of a working gate, not a break —
 * and telling the reader a bar was not met rather than "this turn failed" is the difference between a card
 * they can act on and one that sends them looking for a bug that is not there.
 *
 * The test is the DOOR subclass, never {@link TurnRefusedError} itself: a plain one is this repo refusing
 * its own malformed work, which `refused` would dress up as a gate decision it never was.
 *
 * @param error the value the delivery threw
 * @returns the terminal state to finalise every indicator for
 */
export function terminalStateForThrow({ error }: { error: unknown }): TurnTerminalState {
  const reason = reasonOf({ error });
  if (error instanceof DoorRefusedError) {
    // The door's own finding is already written for a human to read — see `../../admit/withhold.js`'s
    // header — so it stays the same clause on both fields, unlike the plain `failed` arm below.
    return { kind: "refused", readerReason: reason, reason };
  }
  if (error instanceof DoorRecordingRefusedError) {
    // Not a gate decision: the audit record could not be written, so nothing was sent. A break, said as one.
    return {
      kind: "failed",
      readerReason: "the record of this send could not be written, so nothing was sent",
      reason,
    };
  }
  return {
    kind: "failed",
    readerReason: "the composed answer did not clear its own checks before it could be sent",
    reason,
  };
}

/**
 * Finalise every indicator for a turn that did not answer, then post the card that says why.
 *
 * Finalisation goes FIRST so the checklist carries the reason at the earliest possible moment — a reader
 * scrolling past should never see a notice sitting under a card still claiming to work. The card's own
 * failure is then survived rather than propagated: a notice that cannot be posted (the door refusing that
 * too, a transport fault) must still leave the card, the status and the reaction telling the truth. Before
 * this, a throw here would have left every one of them standing — the same defect one level up.
 *
 * @param answerLost whether a composed answer was destroyed here, rather than never reached — passed only by
 *   the delivery-path catch, which is the one caller that knows an answer existed
 * @param error the value that ended this turn, for the coverage it may carry
 * @param poster what the turn may post
 * @param provenance the session link and model id stamped on every message
 * @param question the question being answered
 * @param seams the live indicators to finalise
 * @param state the terminal state to report and finalise for
 * @returns the outcome to fold, whether the checklist settled, and every other indicator that could not be
 */
export async function settledFailure({
  answerLost = false,
  error,
  poster,
  provenance,
  question,
  seams,
  state,
}: {
  answerLost?: boolean;
  error: unknown;
  poster: TurnPoster;
  provenance: TurnProvenance;
  question: string;
  seams: TurnIndicatorSeams;
  state: TurnTerminalState;
}): Promise<SettledTurn> {
  const finalisation = await finaliseIndicators({ seams, state });
  const notice = await poster
    .postNotice({
      card: turnFailureForm({
        cause: state.kind === "refused" ? "unproven" : "broke",
        coverage: coverageOfFailure({ error }),
        modelId: provenance.modelId,
        // The asker's own `<@U…>` ids, resolved to names through the poster's door before the card's `tldr`
        // quotes them — the gate refuses raw markup in a plain string, so without this a question carrying a
        // tag made this very notice unpostable. `./quotedQuestion.ts` carries the measurement.
        names: poster.displayNames({ slackIds: slackUserIdsIn({ question }) }),
        ownerMention: poster.ownerMention,
        question,
        reason: terminalReasonFor({ state }),
      }),
    })
    .catch((cause: unknown) => ({ noticeFailure: reasonOf({ error: cause }) }));
  const noticeFailure = "noticeFailure" in notice ? [`the failure card was not posted — ${notice.noticeFailure}`] : [];
  return {
    checklistSettled: finalisation.checklistSettled,
    failures: [...finalisation.failures, ...noticeFailure],
    // The RAW reason, not the card's prefixed clause: this is what the durable completion carries and what a
    // lifecycle `failed` event reports, and a caller matching on it must see the door's or the error's own
    // words rather than the wording the card chose to wrap them in.
    outcome: {
      answered: false,
      ...(answerLost ? { answerLost: true } : {}),
      failure: state.reason,
      ...("ts" in notice ? { answerTs: notice.ts } : {}),
    },
  };
}

/**
 * The posted-first-answer path: the answer is in the thread and the turn is NOT over.
 *
 * Settles only what the post itself made untrue. The native thinking status ends, because the bot has said
 * something and "is looking into it" over a posted plan reads as a hang; the checklist gains one line under
 * its running step saying the plan is up and what is still being built. Everything that claims the turn
 * ENDED is left standing on purpose — the checklist is neither deleted nor given a terminal frame, and the
 * working reaction stays — because the same worker is still building, and the final answer or a
 * `turn resume --failed` settles them exactly as any other turn's ending does.
 *
 * Neither failure is fatal: the answer already posted, so a refused edit or status call is carried out as a
 * secondary diagnostic rather than thrown.
 *
 * @param noteStillWorking writes the line under the running step
 * @param outcome the delivered outcome, carried through unchanged
 * @param poster what the turn may post
 * @param seams the live indicators, of which only the status is touched
 * @param what what is still owed, quoted on the checklist line
 * @returns the outcome to fold, with the checklist reported settled because it says exactly what is true
 */
async function settledFirstAnswer({
  noteStillWorking,
  outcome,
  poster,
  seams,
  what,
}: {
  noteStillWorking: (input: { detail: string }) => Promise<void>;
  outcome: TurnHandlerOutcome;
  poster: TurnPoster;
  seams: TurnIndicatorSeams;
  what: string;
}): Promise<SettledTurn> {
  poster.stopStatusReasserting();
  const status = await seams.endStatus();
  const statusFailure = status.isErr() ? [`the thinking indicator was not cleared — ${status.error}`] : [];
  const noted = await noteStillWorking({ detail: `first answer posted, now: ${what}` }).then(
    () => [],
    (cause: unknown) => [`the checklist was not told the first answer posted — ${reasonOf({ error: cause })}`],
  );
  return { checklistSettled: true, failures: [...statusFailure, ...noted], outcome };
}

/**
 * Settle a delivery that THREW — split out of {@link settledDelivery} to keep that function under the line cap.
 *
 * `answerLost` is set HERE and nowhere else, and this is the only place it can honestly be set: reaching
 * the catch means the query already returned an answer, so one provably existed at the instant the
 * delivery broke. `../ask/lifecycle.ts`'s `AnswerLostEvent` carries the turn that measured why the
 * distinction is worth a kind of its own.
 *
 * A DOOR REFUSAL is excluded, and that exclusion is the whole precision of the claim. `answer-lost`
 * tells its reader "the question is settled, run the turn again" — true of a fault, and false of a gate
 * that judged the answer and said no, which would refuse it again for the same stated reason.
 *
 * @returns the failed ending, settled through {@link settledFailure}
 */
async function settledThrownDelivery({
  error,
  poster,
  provenance,
  question,
  seams,
}: {
  error: unknown;
  poster: TurnPoster;
  provenance: TurnProvenance;
  question: string;
  seams: TurnIndicatorSeams;
}): Promise<SettledTurn> {
  const state = terminalStateForThrow({ error });
  return settledFailure({
    answerLost: state.kind !== "refused",
    error,
    poster,
    provenance,
    question,
    seams,
    state,
  });
}

/**
 * Deliver the answer, then finalise every indicator for however that actually went.
 *
 * **The try/catch is the fix this whole change is about.** `deliverAnswer` reaches the admit door, and the
 * door REFUSING an outbound write raises `TurnRefusedError` — a real, intended refusal, working as designed.
 * Nothing caught it here, so it escaped `runTurn` entirely and every indicator this turn had raised stayed
 * up: the thinking indicator and its re-assert timer, the half-ticked card, the `:eyes:` reaction, and — the
 * one the reader never sees but every sweep does — the durable lifecycle event that was never appended,
 * which is why `turn dispatch --sweep` counted a refused turn as "still working" 33 minutes later. Measured
 * on `D0SYN000001`/`1787485240.339229`.
 *
 * Catching it here converts that ending into a `failed` completion, which is what makes the CLI's own
 * `report` step run and append the terminal event. A refusal is now an ENDING rather than an escape.
 *
 * @param hold where a withheld draft is filed
 * @param mention the mention being answered
 * @param outcome what the query produced
 * @param poster what the turn may post
 * @param provenance the session link and model id stamped on every message
 * @param question the question being answered
 * @param seams the live indicators to finalise
 * @param uploads the answer's images, already read off disk
 * @param documents the answer's deliverable files, already read off disk
 * @param noteStillWorking writes a line under the checklist's running step without ticking it — used only
 *   when the answer was a first answer and the same worker is still building
 * @returns the settled ending, or the warn-tier refusal that leaves every indicator standing on purpose
 */
export async function settledDelivery({
  documents,
  hold,
  mention,
  noteStillWorking,
  outcome,
  poster,
  provenance,
  question,
  seams,
  uploads,
}: {
  hold: HoldSink;
  mention: Mention;
  noteStillWorking: (input: { detail: string }) => Promise<void>;
  outcome: TurnQueryOutcome;
  poster: TurnPoster;
  provenance: TurnProvenance;
  question: string;
  documents: readonly SlackUpload[];
  seams: TurnIndicatorSeams;
  uploads: readonly SlackUpload[];
}): Promise<Result<SettledTurn, AnswerSendRefusal>> {
  let delivered: Result<DeliveredTurn, AnswerSendRefusal>;
  try {
    delivered = await deliverAnswer({ documents, hold, mention, outcome, poster, provenance, question, uploads });
  } catch (error) {
    return ok(await settledThrownDelivery({ error, poster, provenance, question, seams }));
  }
  // BEFORE `finaliseIndicators`: settling the checklist, clearing the indicator and leaving a terminal
  // reaction each claim this turn is over, and a warn-tier refusal means it is not — the same worker still
  // holds the answer. So the one thing done to the indicator is stopping its re-assert timer.
  if (delivered.isErr()) {
    poster.stopStatusReasserting();
    return err(delivered.error);
  }
  const firstAnswer = delivered.value.outcome.firstAnswer;
  if (firstAnswer !== undefined) {
    return ok(
      await settledFirstAnswer({
        noteStillWorking,
        outcome: delivered.value.outcome,
        poster,
        seams,
        what: firstAnswer.followThrough.what,
      }),
    );
  }
  const finalisation = await finaliseIndicators({ seams, state: delivered.value.state });
  return ok({
    checklistSettled: finalisation.checklistSettled,
    failures: finalisation.failures,
    outcome: delivered.value.outcome,
  });
}
