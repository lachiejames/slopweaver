/**
 * The out-of-band poster shapes: the sweep-only checklist advancer, the seams a sweep finalises indicators
 * through, and the one place that converges an ask's tagged reaction to whatever its lifecycle state
 * currently earns — a terminal ending, or the capture emoji a live worker has put back.
 *
 * Split out of `./poster.ts` so that file stays under this repo's line cap.
 */

import type { DoorLedgerPort } from "../../admit/doorLedgerPort.js";
import type { SlackWriteTransport } from "../../corpus/slack/writeTransport.js";
import { logger } from "../../lib/logger.js";
import { err, ok, type Result } from "../../lib/result.js";
import type { TodoStep } from "../../outbound/assistant/todoBlock.js";
import type { TurnChrome } from "../../outbound/slack/types.js";
import { type AskIdentity, askIdentityOf } from "../ask/identity.js";
import { type TurnProgress, turnChecklist } from "./answer.js";
import { cardNameLookup } from "./cardNames.js";
import type { TurnProvenance } from "./envelope.js";
import {
  type IndicatorOutcome,
  type TerminalChecklist,
  type TurnIndicatorSeams,
  terminalChecklistProgress,
} from "./indicators.js";
import {
  type LifecycleReaction,
  lifecycleReactionEmoji,
  lifecycleReactionEmojis,
  reactionsToRetire,
} from "./lifecycleReactions.js";
import { turnFrame } from "./posterFrame.js";
import { statusLifecycle } from "./posterStatus.js";
import { advanceWorkingImpl, finalizeWorkingImpl } from "./posterWorking.js";
import type { PostedRef, TurnPoster } from "./run.js";
import { type TurnError, TurnErrors } from "./turnErrors.js";

/**
 * The narrow slice of a `TurnPoster` a `fresh-visible-session` sweep needs: update an existing checklist,
 * nothing else. Deliberately not built through `liveTurnPoster` because the sweep never posts an
 * answer, notice, or first frame; it only needs the exact frame renderer and write transport.
 *
 * ## The accepted cross-instance race, stated rather than silently risked
 *
 * This advancer cannot observe the ORIGINAL poster's own `state.stopped` — it has no way to know the turn
 * finished and that poster already began stopping the stream between this sweep tick reading the screen and
 * this call actually reaching Slack. The one call this can make may therefore land after the real stream is
 * already gone. That is accepted, not fixed: a durable shared flag would still have its own check-then-use
 * race unless the original poster ALSO took a lock around its own finalize/delete — real cross-process
 * coordination this sweep-only advancer has no reason to grow. The transport's own measured contract already
 * absorbs the common case (`chat.appendStream` against an already-stopped stream answers
 * `message_not_in_streaming_state`, treated as a successful no-op — see the integration coverage for
 * `stopStream`/`appendStream` ordering), and `../../cli/commands/turn/sweepCard.ts`'s `attemptChecklistAdvance`
 * contains whatever this call does throw, so at worst this sweep tick logs one best-effort duplicate attempt
 * and moves on — it never aborts the rest of the sweep, and it never proves the stream was open by having
 * built this state fresh.
 *
 * @param askIdentity the exact ask this checklist belongs to
 * @param doorLedger where the door's decision is recorded before each advance
 * @param home the resolved state home, for the door ledger
 * @param transport the Slack write transport
 * @param turnChrome the bot chrome and metadata event type stamped on the frame
 * @param provenance the visible session and model stamped in Details
 * @param turnId the id correlating this advance with the turn it belongs to
 * @param now the frame clock, injected for exact tests
 * @returns a poster carrying only `advanceWorking`
 */
export function liveChecklistAdvancer({
  askIdentity,
  doorLedger,
  home,
  transport,
  turnChrome,
  provenance,
  turnId,
  now = () => Date.now(),
}: {
  askIdentity: AskIdentity;
  doorLedger: DoorLedgerPort;
  home: string;
  transport: SlackWriteTransport;
  turnChrome: TurnChrome;
  provenance: TurnProvenance;
  turnId: string;
  now?: () => number;
}): Pick<TurnPoster, "advanceWorking"> {
  const scopedAskIdentity = askIdentityOf({ source: askIdentity });
  const names = cardNameLookup({ home });
  const frame = ({ steps, task }: { steps: Parameters<TurnPoster["postWorking"]>[0]["steps"]; task: string }) =>
    turnFrame({ names, now, provenance, steps, task, turnChrome, turnId });
  return {
    advanceWorking: ({ posted, steps, task }) =>
      advanceWorkingImpl({
        askIdentity: scopedAskIdentity,
        doorLedger,
        frame,
        home,
        posted,
        steps,
        task,
        transport,
        turnId,
      }),
  };
}

/**
 * The terminal checklist progress a SWEEP may honestly claim for an ask it is finalising from outside.
 *
 * `completed: 1` rather than a guess at how far the dead session actually got. A sweep cannot know that, and
 * inventing a position would be the same class of untruth this is fixing. Step 1 is the earliest position
 * that is certainly true — the question was read at capture — so the reason lands on a step the reader can
 * see rather than on one the turn may never have reached.
 *
 * @param checklist how the checklist must be left
 * @param stepCount how many steps this ask's tier has
 * @returns the progress to render
 */
function sweptProgress({ checklist, stepCount }: { checklist: TerminalChecklist; stepCount: number }): TurnProgress {
  return terminalChecklistProgress({ checklist, completed: 1, details: [], stepCount });
}

/**
 * The live `TurnIndicatorSeams` for an ask NO turn process is driving any more.
 *
 * `runTurn` builds its own seams from the poster it already holds. This is for the other caller: `turn
 * dispatch --sweep`, which finds a dispatched ask whose session died, never reported, or ran past its lease,
 * and has to finalise that turn's indicators from OUTSIDE it. Without this, the sweep appended a
 * `lease-expired` event and left the card, the status and the `:eyes:` reaction exactly as the dead session
 * left them — a thread that reads as actively working with nobody behind it, which is the failure the owner
 * reports walking over to describe.
 *
 * A separate factory rather than a whole `liveTurnPoster` because a sweep has no answer to post, no
 * judgement to offer and no upload readiness to poll — building a full poster to reach three methods would
 * demand five arguments that would all have to be invented.
 *
 * @param askIdentity the exact ask whose indicators these are
 * @param doorLedger where the checklist settle's door decision is recorded
 * @param home the resolved state home, for the door ledger and the configured emoji
 * @param posted the working checklist to settle, absent when the ask never got one
 * @param provenance the visible session and model stamped in Details
 * @param steps the checklist this ask's tier actually takes
 * @param task the bracketed task label on the author row
 * @param transport the Slack write transport
 * @param turnChrome the bot chrome and metadata event type stamped on the frame
 * @param turnId the id correlating these writes with the turn they belong to
 * @param now the frame clock, injected for exact tests
 * @returns the three seams `finaliseIndicators` takes
 */
// max-lines-exempt: one cohesive object builder over 10 named-object-params fields, one line per field
export function liveIndicatorSeams({
  askIdentity,
  doorLedger,
  home,
  posted,
  provenance,
  steps,
  task,
  transport,
  turnChrome,
  turnId,
  now = () => Date.now(),
}: {
  askIdentity: AskIdentity;
  doorLedger: DoorLedgerPort;
  home: string;
  posted?: PostedRef | undefined;
  provenance: TurnProvenance;
  steps: readonly { readonly id: string; readonly title: string }[];
  task: string;
  transport: SlackWriteTransport;
  turnChrome: TurnChrome;
  turnId: string;
  now?: () => number;
}): TurnIndicatorSeams {
  const scopedAskIdentity = askIdentityOf({ source: askIdentity });
  const names = cardNameLookup({ home });
  const frame = ({ steps: framed, task: label }: { steps: readonly TodoStep[]; task: string }) =>
    turnFrame({ names, now, provenance, steps: framed, task: label, turnChrome, turnId });
  const status = statusLifecycle({
    channel: scopedAskIdentity.channel,
    threadTs: scopedAskIdentity.threadTs,
    transport,
    turnChrome,
    turnId,
  });
  return {
    endStatus: async () =>
      status.endStatus().catch((cause: unknown) => err(cause instanceof Error ? cause.message : String(cause))),
    settleChecklist: async ({ checklist }) =>
      // Nothing posted for this ask means no card standing to correct — settled, not stuck.
      posted === undefined
        ? true
        : finalizeWorkingImpl({
            askIdentity: scopedAskIdentity,
            doorLedger,
            frame,
            home,
            posted,
            steps: turnChecklist({ progress: sweptProgress({ checklist, stepCount: steps.length }), steps }),
            task,
            transport,
            turnId,
          }),
    settleReaction: async ({ reaction }) =>
      settleLifecycleReaction({ askIdentity: scopedAskIdentity, home, reaction, transport }),
  };
}

/**
 * Converge one ask's tagged message to the reaction its CURRENT lifecycle state earns.
 *
 * The named seam over `settleTagReaction`, and the only way in from outside this module. Its parameter is
 * the WHOLE lifecycle vocabulary rather than the terminal three: an ask a worker has just picked up needs
 * the capture emoji put back, and before `./lifecycleReactions.ts`'s `LifecycleReaction` existed there was
 * no value any caller could pass that meant it (see that file's own header for the 43-minute measurement).
 *
 * Both of this
 * file's seam builders route through it, and so does `slopweaver turn settle-reaction` — the by-hand
 * correction path for a message some EARLIER turn left wearing a contradictory pair, which no terminal will
 * ever run over again because that ask is already terminal. A verb that reached for `reactions.remove`
 * itself would be a second implementation of the convergence, which is exactly the per-call-site divergence
 * `./lifecycleReactions.ts` records as the original defect.
 *
 * Never throws, because `settleTagReaction` does not: a caller is told the message is unsettled, and
 * the CLI turns that into a non-zero exit rather than a silent success.
 *
 * @param askIdentity the exact ask whose original message carries the reaction
 * @param home the state home the lifecycle set is configured in
 * @param reaction the lifecycle reaction to leave standing — a terminal ending, or `working`
 * @param transport the Slack write transport
 * @returns ok, or the reason the message could not be converged
 */
export async function settleLifecycleReaction({
  askIdentity,
  home,
  reaction,
  transport,
}: {
  askIdentity: AskIdentity;
  home: string;
  reaction: LifecycleReaction;
  transport: SlackWriteTransport;
}): Promise<IndicatorOutcome> {
  return (
    await settleTagReaction({ askIdentity, emoji: lifecycleReactionEmoji({ home, reaction }), home, transport })
  ).mapErr((error) => error.message);
}

/**
 * CONVERGE the ORIGINAL tagged message to exactly ONE lifecycle reaction — never the reply.
 *
 * The fix for the exact gap the owner named, live-dogfooding: the `:eyes:` reaction never changed once the
 * answer had actually posted, so a tagger with the thread collapsed had no way to tell "still working" from
 * "answered" without opening it.
 *
 * **It fires on every terminal outcome, not only a successful send, and that was the first half of the
 * change.** The earlier version fired only after the answer send succeeded and deliberately left
 * a withheld or refused turn showing the capture reaction "exactly as it was, honestly" — which was the
 * opposite of honest, because `:eyes:` does not mean "seen", it means "seen, working on it". Measured:
 * a turn the door refused sat under `:eyes:` indefinitely. `../turn/indicators.ts` owns the
 * decision of WHICH reaction each ending earns; this function only applies it.
 *
 * **The second half is that it retires the WHOLE lifecycle set rather than just the capture emoji**, and
 * `./lifecycleReactions.ts` carries the measured incident: removing only the one prior state this function
 * knew about left the stopped emoji from a failed attempt standing beside the completion emoji its retry
 * added, so the tagged message claimed both endings at once. Removals are idempotent, so retiring a
 * reaction that was never there costs a no-op rather than a failure.
 *
 * A courtesy, like `withCaptureReaction` in the listener — but only in the sense that it never THROWS: a
 * failing remove or add is reported as a value, because the turn's real outcome has already happened by the
 * time this runs and a reaction is not worth restating it as a failure. It does stop at the first failure,
 * deliberately: a half-converged message is exactly the contradiction this exists to remove, so the caller
 * is told the reaction is unsettled rather than left to infer it from a reaction that did land.
 *
 * @param askIdentity the exact ask whose original message carries the reaction
 * @param emoji the bare reaction name to leave standing
 * @param home the state home the lifecycle set is configured in
 * @param transport the Slack write transport
 * @returns ok, or the reason the message could not be converged
 */
async function settleTagReaction({
  askIdentity,
  emoji,
  home,
  transport,
}: {
  askIdentity: AskIdentity;
  emoji: string;
  home: string;
  transport: SlackWriteTransport;
}): Promise<Result<void, TurnError>> {
  const posted = { channel: askIdentity.channel, ts: askIdentity.messageTs };
  try {
    // The RETURNED BOOLEAN is checked, not just the absence of a throw. Both transport methods answer
    // `false` for a call Slack declined — and `removeReaction` already folds `no_reaction` into success, so
    // a `false` here means the reaction genuinely did not move. Measured on a 19-ask backlog
    // sweep: ignoring the boolean let a declined `reactions.add` report `ok(undefined)` while the message was
    // left wearing NO lifecycle reaction at all — the same "an indicator claims it settled when it did not"
    // lie this whole module exists to end, one level down.
    for (const stale of reactionsToRetire({ emojis: lifecycleReactionEmojis({ home }), standing: emoji })) {
      if (!(await transport.removeReaction({ name: stale, posted }))) {
        return err(TurnErrors.reactionDeclined({ action: "remove", emoji: stale }));
      }
    }
    if (!(await transport.addReaction({ name: emoji, posted }))) {
      return err(TurnErrors.reactionDeclined({ action: "add", emoji }));
    }
    return ok(undefined);
  } catch (error) {
    // Reading a hostile error's `.message`/`toString` can itself throw (a counterexample: a
    // null-prototype rejection), so the reason is derived inside its own guard — this function's
    // "never throws" contract may not depend on the failure being describable.
    let reason = "the reaction could not be settled";
    try {
      reason = error instanceof Error ? error.message : String(error);
    } catch {
      // keep the generic reason
    }
    try {
      logger.error({ msg: `could not settle the tag's reaction to :${emoji}: — continuing without it: ${reason}` });
    } catch {
      // See above — logging is a courtesy, never a dependency of the contract.
    }
    return err(TurnErrors.reactionThrew({ reason }));
  }
}
