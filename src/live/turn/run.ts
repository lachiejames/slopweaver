/**
 * The TURN — what happens between a mention arriving and an answer standing in the thread.
 *
 * This is the handler half of the agent surface. Transport (Socket Mode, the `app_mention` parse, the
 * dedupe, the reconnect) belongs to the listener and is absent here by design; see `./mention.ts` for the
 * one value that crosses between them.
 *
 * ## Everything effectful is injected, so the ORDER is testable
 *
 * A turn is mostly an ordering claim — acknowledge before working, advance before answering, never claim a
 * step finished before it did — and an ordering claim is exactly what a mocked test cannot check honestly.
 * So the two effects are plain function seams: a {@link TurnPoster} and a {@link TurnQuery}. A test passes
 * fakes that record their calls and asserts the exact sequence, with no network, no clock and no `vi.fn`.
 *
 * ## The five orderings this file exists to guarantee
 *
 *  0. **The thread is NAMED before anything is posted into it** — in a DM, where there is an agent-container
 *     side panel with a row to name. A title that arrives after the answer has already been read is a title
 *     nobody needed. It is also the only effect here whose refusal is survivable, so it is reported in the
 *     outcome and the turn carries on; see {@link TurnPoster.setTitle}.
 *  1. **The working message is posted BEFORE the query starts.** The query takes tens of seconds; latency
 *     with no acknowledgement reads as a dead bot, which is the single most common way an agent surface
 *     feels broken.
 *  2. **Each phase advances the checklist in place**, by editing the same message. A new message per phase
 *     would push the thread down and lose the "visibly moving" property the whole surface is for.
 *  3. **A real answer REPLACES the working message; it never ticks it "done."** The answer is posted first,
 *     then the working message is deleted — one reply in the thread, not a stuck checklist sitting above a
 *     second message. V1 did the same and the owner's own reasoning for it: a new message notifies, an
 *     in-place edit does not, and a thread that keeps every resolved checklist stays lean. If the delete
 *     itself fails, the fallback is to finish the checklist fully done in place — never leave it claiming
 *     "compose a cited answer" is still running after the answer already exists, which is a claim the code
 *     cannot support and the same class of defect as every other entry in this repo's silent-failure ledger.
 *     **The one answer that does NOT replace it is a FIRST answer** — a form declaring `followThrough`, a plan
 *     the same worker keeps building after. That post leaves the working message standing with one line
 *     under its running step, ends the thinking status and settles nothing else, because the turn has not
 *     ended; the worker's FINAL answer replaces the working message exactly as above (`./turnSettle.ts`).
 *  4. **A failure still posts a card.** A turn that throws and leaves a half-ticked checklist is
 *     indistinguishable from one still working. The failure card says what broke and carries whatever
 *     coverage was established before it did.
 *  5. **A WITHHELD answer still posts a notice, and the draft is filed before it does.** Somebody asked, so
 *     somebody is waiting; silence reads as broken. The id in the notice therefore always names an entry
 *     that exists, and a queue write that FAILS still produces a notice — one that says the draft could not
 *     be filed, rather than an id nobody can release.
 *
 * ## No live query ever loads the corpus
 *
 * This file never constructs query args or reads the world model itself: it takes a {@link TurnQuery} the
 * session already satisfied — conversation, verb, or unreachable grounding, all session-authored — so the
 * slow-retrieval trap an earlier corpus-backed adapter had to work around (a default semantic index build
 * measured at 10.5 to 20.2 hours) cannot recur here; there is no corpus-touching adapter left to mis-default.
 */

import type { SlackUpload } from "../../corpus/slack/writeTransport.js";
import { err, ok, type Result } from "../../lib/result.js";
import { askIdentityOf } from "../ask/identity.js";
import type { Mention } from "../listen/mention.js";
import { CARD_LINE_CAP, clampVisible, turnStepsForTier } from "./answer.js";
import {
  type CompletionSink,
  type TurnCompletion,
  type TurnHandlerOutcome,
  type TurnProvenance,
  turnCompletionFromOutcome,
} from "./envelope.js";
import { finaliseIndicators } from "./indicators.js";
import {
  checklistOutcomeFields,
  reapOutcomeFields,
  statusOutcomeFields,
  supersessionOutcomeFields,
} from "./outcomeFields.js";
import type { AnswerSendRefusal, HoldSink, PostedRef, TurnPoster, TurnQuery, TurnSupersession } from "./runContract.js";
import { turnTaskLabel } from "./taskLabel.js";
import type { ExecutionTier } from "./tier.js";
import { beginTurn } from "./turnBegin.js";
import { annotate, reasonOf } from "./turnCursor.js";
import { runQueryUnderStatus, turnIndicatorSeams } from "./turnQuery.js";
import { settledDelivery, settledFailure, terminalStateForThrow } from "./turnSettle.js";

// Re-exported for every existing import site: the type moved to `./envelope.js` so `runTurn` could depend
// on the mapper without that file depending back on this one.
export type { TurnProvenance } from "./envelope.js";

// Re-exported for the same reason: the turn's declared CONTRACT moved to `./runContract.js` so this file
// holds only the ordering, and `./poster*.ts` can depend on the shapes without depending on the runner.
export {
  type AnswerSendRefusal,
  AnswerSendRefusals,
  DoorRecordingRefusedError,
  DoorRefusedError,
  type HoldSink,
  type PostAnswerOutcome,
  type PostedRef,
  TURN_STATUS_TEXT,
  type TurnPoster,
  type TurnQuery,
  TurnQueryFailure,
  TurnRefusedError,
  type TurnSupersession,
} from "./runContract.js";

/**
 * Fold a settled outcome into its durable completion and append it, ONCE, before returning.
 *
 * A mapping failure is an invariant violation — `turnCompletionFromOutcome` refuses only a combination
 * `runTurn`'s own steps cannot actually produce — so it throws rather than returning a second error shape
 * the caller would have to handle. A completion-sink rejection is NOT swallowed: the Slack side has already
 * happened by this point, so the caller finding out the ledger append failed is the loud signal that stops
 * a naive retry reading as safe (see `completionStore.ts`'s own header).
 */
async function foldAndComplete({
  askIdentity,
  complete,
  outcome,
  provenance,
  turnId,
}: {
  askIdentity: Mention;
  complete: CompletionSink;
  outcome: TurnHandlerOutcome;
  provenance: TurnProvenance;
  turnId: string;
}): Promise<TurnCompletion> {
  const folded = turnCompletionFromOutcome({
    askIdentity: askIdentityOf({ source: askIdentity }),
    outcome,
    provenance,
    turnId,
  });
  if (!folded.isOk()) {
    throw new Error(`runTurn produced an outcome its own envelope refuses: ${folded.error.message}`);
  }
  await complete({ completion: folded.value });
  return folded.value;
}

/**
 * Run one turn: acknowledge, work visibly, answer with citations and coverage, then persist the durable
 * completion.
 *
 * Resolves rather than rejects even when the query breaks — the failure is posted to the thread and
 * reported in the outcome, because a listener that has to catch an exception to learn a turn failed will
 * eventually swallow one. The only way this rejects is if the POSTER itself fails (the thread cannot be
 * written to at all) or the completion sink rejects (the answer posted but its durable record did not).
 *
 * @param mention the mention being answered — also this turn's exact ask identity
 * @param poster what the turn may post
 * @param query the world model
 * @param provenance the session link and model id stamped on every message
 * @param hold where a withheld draft is filed
 * @param complete where this turn's durable completion is recorded
 * @param turnId the id correlating this turn's messages and its completion
 * @param uploads the answer's images, already read off disk — empty when it carries none
 * @param documents the answer's deliverable files, already read off disk — empty when it carries none
 * @param earlierCards every card an earlier turn on this ask left in the thread, deleted once THIS turn's
 *   answer posts — REQUIRED, so no caller can post an answer and forget them (`./earlierCards.ts`)
 * @param supersession how a declared supersession is settled once this turn's own answer has posted —
 *   REQUIRED for the same reason `earlierCards` is: a correction turn that silently forgot to delete the
 *   answer it replaced would leave the thread holding two answers that contradict each other, and an
 *   optional seam is one every future caller can forget (`./supersession/run.ts`)
 * @param started the capture-time checklist to advance instead of posting a new one, when the listener posted one
 * @param tier which execution tier this turn is answering under — selects the checklist steps that actually
 *   apply, so a subagent or fresh-session turn never shows inline-shaped titles for work it never did.
 *   Defaults to `inline`, the honest "nothing tier-specific decided" frame.
 * @returns the durable completion — whether an answer was posted, the timestamps of what was, and every
 *   secondary diagnostic — or the warn-tier refusal that means NO completion was recorded and this turn is
 *   still the same worker's to finish
 */
// max-lines-exempt: an effectful shell over already-decomposed steps (beginTurn, runQueryUnderStatus, reportFailure, deliverAnswer, clearStatus, foldAndComplete) — its size is the parameter list, not logic worth splitting further.
export async function runTurn({
  mention,
  poster,
  query,
  provenance,
  hold,
  complete,
  turnId,
  uploads,
  documents,
  earlierCards,
  supersession,
  started,
  tier = "inline",
}: {
  mention: Mention;
  poster: TurnPoster;
  query: TurnQuery;
  provenance: TurnProvenance;
  hold: HoldSink;
  complete: CompletionSink;
  turnId: string;
  uploads: readonly SlackUpload[];
  documents: readonly SlackUpload[];
  earlierCards: readonly PostedRef[];
  supersession: TurnSupersession;
  started?: { readonly turnId: string; readonly workingTs: string } | undefined;
  tier?: ExecutionTier;
}): Promise<Result<TurnCompletion, AnswerSendRefusal>> {
  const steps = turnStepsForTier({ tier });
  const begun = await beginTurn({ mention, poster, started, steps }).catch(async (error: unknown) => {
    // The FIRST Slack write failing is still a terminal outcome, and the indicators the LISTENER already
    // raised at capture — the `:eyes:` reaction, the capture-time card, the native status — are standing by
    // the time this runs. Settling them here is what stops a turn that never got off the ground from reading
    // exactly like one still working.
    await finaliseIndicators({
      seams: turnIndicatorSeams({
        cursor: { completed: 1, details: [clampVisible({ cap: CARD_LINE_CAP, text: `"${mention.text}"` })] },
        ...(started === undefined ? {} : { posted: { channel: mention.channel, ts: started.workingTs } }),
        poster,
        steps,
        task: turnTaskLabel({ question: mention.text }),
      }),
      state: terminalStateForThrow({ error }),
    });
    // Rethrown rather than folded: with no working message there is no `workingTs`, and a completion is
    // required to carry one. Inventing a timestamp to make the envelope validate would put a message id in
    // the durable record that names no message — a different lie in the same family. The CLI's own top-level
    // handler reports it, and the indicators above are already truthful.
    throw error;
  });
  const { cursor, posted, question, task, titleFailure } = begun;
  const seams = turnIndicatorSeams({ cursor, posted, poster, steps, task });
  const queried = await runQueryUnderStatus({ cursor, posted, poster, query, question, steps, task });
  const delivered = queried.query.isOk()
    ? await settledDelivery({
        documents,
        hold,
        mention,
        noteStillWorking: async ({ detail }) => annotate({ cursor, detail, posted, poster, steps, task }),
        outcome: queried.query.value,
        poster,
        provenance,
        question,
        seams,
        uploads,
      })
    : ok(
        await settledFailure({
          error: queried.query.error,
          poster,
          provenance,
          question,
          seams,
          state: {
            kind: "failed",
            readerReason: "something broke while investigating, so no answer is coming this turn",
            reason: reasonOf({ error: queried.query.error }),
          },
        }),
      );
  // BEFORE everything below it, and that placement is the fix rather than tidiness: reaping the earlier
  // cards, folding an outcome and appending a completion all say this turn ENDED, and a warn-tier door
  // refusal is the one delivery result where it has not — see `./runContract.ts`'s `AnswerSendRefusal`.
  if (delivered.isErr()) {
    return err(delivered.error);
  }
  const settled = delivered.value;
  // AFTER the answer posted, so a reader never sees the thread empty of both — `./earlierCards.ts`.
  const reaped = await reapOutcomeFields({
    cards: earlierCards,
    outcome: settled.outcome,
    poster,
    workingTs: posted.ts,
  });
  // LAST of every post-answer effect, and the order against `reaped` is deliberate rather than incidental:
  // this is the only irreversible one, and it removes a message somebody may be reading rather than this
  // ask's own furniture. Running it after every survivable courtesy effect means nothing between the answer
  // landing and the delete can throw with the old answer already gone. A turn that declared nothing does
  // nothing here and costs no Slack call — `./supersession/run.ts`.
  const superseded = await supersessionOutcomeFields({
    askIdentity: askIdentityOf({ source: mention }),
    declaredTs: queried.query.isOk() ? queried.query.value.answer.supersedes : undefined,
    outcome: settled.outcome,
    postedAnswer: queried.query.isOk() ? queried.query.value.answer : undefined,
    settle: supersession,
    turnId,
  });
  const outcome: TurnHandlerOutcome = {
    ...settled.outcome,
    workingTs: posted.ts,
    ...reaped,
    ...superseded,
    ...(titleFailure === undefined ? {} : { titleFailure }),
    ...checklistOutcomeFields({ posted, resolved: settled.checklistSettled }),
    ...statusOutcomeFields({ failures: [...queried.statusFailure, ...settled.failures] }),
  };
  return ok(await foldAndComplete({ askIdentity: mention, complete, outcome, provenance, turnId }));
}
