/**
 * The live Slack adapter for a turn — the effectful shell around `./run.ts`'s pure ordering.
 *
 * Three responsibilities and no decisions: render through the existing renderers, route through the admit
 * door, and hand back the `ts`. Every judgement a turn makes lives in `./run.ts` and `./answer.ts`, where
 * it can be exercised without a socket.
 *
 * ## Where the turn's messages go, and the one place this departs from the doc's letter
 *
 * The orchestration doc says to keep a spinner TOP-LEVEL, because `slack delete` and `progress sweep` read
 * `conversations.history` — which cannot see threaded messages — so an in-thread progress message can
 * never be swept.
 *
 * The turn's working message is posted IN THREAD anyway, and the reason is that it is not a spinner. A
 * spinner is transient, animated, and meant to be deleted; the risk the constraint manages is an orphan
 * that spins forever with nobody able to clean it up. This message is the opposite: it is the durable
 * record of what the turn did, it is meant to survive the turn, and it never animates — so a turn that
 * dies leaves a checklist frozen at the step it reached, which states the truth rather than claiming to
 * still be working. Splitting one turn across two surfaces — a spinner in the channel, an answer in the
 * thread — was the alternative, and it makes the thread unreadable on its own.
 *
 * What is genuinely given up: a hard process death leaves a message the sweep cannot reach. Accepted, and
 * bounded by `./run.ts` driving the checklist to a terminal frame on every path it controls, including a
 * failed query.
 *
 * ## The window widens again at capture, and that is accepted too
 *
 * `src/cli/commands/listen/run.ts` posts this same checklist at CAPTURE — right after the `:eyes:`
 * reaction, before a turn has even started — because two minutes of silence between the reaction and the
 * checklist appearing is what made the bot look dead on a real, measured turn. That moves the orphan
 * window named above earlier still: it can now open before any turn has run, rather than partway through
 * one. No NEW failure class follows from that, and the reason is the same trick `beginTurn` already relies
 * on — the checklist is posted with step 0 ("Read the question") already marked done, which is genuinely
 * true at capture. A session death after that point freezes the message at "✓ Read the question" with the
 * rest pending — a truthful snapshot of exactly what happened, not a claim that nothing did or that work is
 * still under way. A frozen checklist making either of THOSE claims would be the defect; one that reads as
 * "this much happened, then it stopped" is not.
 *
 * ## Why this file is now an orchestrator, not the whole implementation
 *
 * The door plumbing, the status-indicator lifecycle, the frame renderer, the working-checklist quartet, the
 * out-of-band sweep seams, and the answer-send path each moved to their own sibling module
 * (`./posterDoor.ts`, `./posterStatus.ts`, `./posterFrame.ts`, `./posterWorking.ts`, `./posterIndicators.ts`,
 * `./posterAnswer.ts`) so this file could stay under this repo's line cap. What stays here is the one thing
 * that has to see all of them at once: `liveTurnPoster` itself, and the mention-answering entry point built
 * on it. Every symbol another module in this repo already imported from `"./poster.js"` still resolves from
 * here, re-exported from wherever it actually lives now.
 */

import type { DoorLedgerPort } from "../../admit/doorLedgerPort.js";
import type { ReviewVerdict } from "../../admit/reviewVerdict.js";
import type { ReplyJudgement } from "../../admit/withhold.js";
import type { SlackUpload, SlackWriteTransport, UploadReadiness } from "../../corpus/slack/writeTransport.js";
import type { Result } from "../../lib/result.js";
import type { ResolvedMentions } from "../../outbound/slack/render.js";
import type { SlackCardChrome, TurnChrome } from "../../outbound/slack/types.js";
import type { IdentityRosterSnapshot } from "../../silver/identityRoster.js";
import { type AskIdentity, askIdentityOf, sameAskIdentity } from "../ask/identity.js";
import type { Mention } from "../listen/mention.js";
import { askerDisplayNames } from "./askerNames.js";
import { cardNameLookup } from "./cardNames.js";
import { liveCompletionSink } from "./completionStore.js";
import { earlierCardsForAsk } from "./earlierCards.js";
import type { CompletionSink, TurnCompletion, TurnProvenance } from "./envelope.js";
import { liveHoldSink, nameThreadThroughDoor, offerAnswer } from "./posterAnswer.js";
import { ownerTag, turnFrame } from "./posterFrame.js";
import { settleLifecycleReaction } from "./posterIndicators.js";
import { statusLifecycle } from "./posterStatus.js";
import { workingPosterMethods } from "./posterWorking.js";
import {
  type AnswerSendRefusal,
  type HoldSink,
  type PostedRef,
  runTurn,
  type TurnPoster,
  type TurnQuery,
  TurnRefusedError,
} from "./run.js";
import { liveSupersession } from "./supersession/wiring.js";
import type { ExecutionTier } from "./tier.js";

export { answerDigestOf } from "./posterAnswer.js";
export { deleteCapturedChecklist } from "./posterChecklistDelete.js";
export { refusalDetail, turnDoorRequest } from "./posterDoor.js";
export { NO_MENTIONS, ownerTag } from "./posterFrame.js";
export { liveChecklistAdvancer, liveIndicatorSeams, settleLifecycleReaction } from "./posterIndicators.js";
export { ASSISTANT_STATUS_REASSERT_MS } from "./posterStatus.js";
export { liveNoticePoster } from "./posterWorking.js";

/**
 * Build the live poster for one turn in one thread.
 *
 * The channel and thread are closed over rather than passed per call, so the turn cannot post anywhere
 * other than where it was asked.
 *
 * @param transport the Slack write transport
 * @param askIdentity the exact ask this poster is scoped to — every effect posts here, and nowhere else
 * @param turnChrome the bot's identity for the working message
 * @param chrome the operator's full card chrome, from `chromeFromProfile({home})` — the answer now carries
 *   the same author row, dividers and detail label the operator card does, not just the accent colour
 * @param provenance the session link and model id stamped on every message
 * @param turnId the id correlating every message with this turn
 * @param doorLedger where every write's door decision is recorded before it is sent
 * @param home the resolved state home, for the door ledger
 * @param judge the withhold judgement the answer write is offered to
 * @param mentions every mentioned person, already resolved to a Slack user id
 * @param identityRoster the store's identity roster, read ONCE by the async root that builds this poster, so
 *   the card's asker names resolve synchronously over the same snapshot
 * @param readiness the bounded upload-readiness poll the answer's images go through
 * @param now the clock, injected so a frame is assertable
 * @param verdict the reviewing session's verdict about the answer this will send; supplied by the
 *   loop rather than the worker, and `undefined` refuses the send
 * @returns the poster {@link TurnPoster} the turn drives
 */
// max-lines-exempt: one cohesive object builder over 15 named-object-params fields, one line per field
export function liveTurnPoster({
  transport,
  askIdentity,
  turnChrome,
  chrome,
  provenance,
  turnId,
  doorLedger,
  home,
  identityRoster,
  judge,
  mentions,
  readiness,
  freshnessNote,
  verdict,
  now = () => Date.now(),
}: {
  transport: SlackWriteTransport;
  askIdentity: AskIdentity;
  turnChrome: TurnChrome;
  chrome: SlackCardChrome;
  provenance: TurnProvenance;
  turnId: string;
  doorLedger: DoorLedgerPort;
  home: string;
  identityRoster: IdentityRosterSnapshot;
  judge: ReplyJudgement;
  mentions: ResolvedMentions;
  readiness: UploadReadiness;
  /**
   * The DOOR's one-line observation about how far behind the thread this answer is, or `undefined` when it
   * had nothing to say. A poster-level input for the same reason `verdict` is: the worker that composed the
   * answer never holds it, because it is a fact about the SEND rather than about the answer. It is applied
   * at the render call and nowhere earlier, so the digest `verdict` binds to stays the bytes the reviewer
   * read — see `./answerFreshnessNote.ts`.
   */
  freshnessNote: string | undefined;
  /**
   * The verdict a REVIEWING session composed about the answer this poster will send, or `undefined` when
   * none reached it.
   *
   * `undefined` is not "skip the check" — the gate refuses on it, and that is the ruling rather than a
   * default: no answer is better than a bad answer. It is a poster-level input rather than a
   * `postAnswer` argument so the worker composing the answer never holds it: the loop supplies it when it
   * builds the poster, which is the same reason the worker does not spawn its own reviewer.
   */
  verdict: ReviewVerdict | undefined;
  now?: () => number;
}): TurnPoster {
  // A fresh, flat copy — never the caller's own reference. `postAnswer`'s guard below exists precisely to
  // catch a poster built for one ask being handed another's ownership; that guard is only as strong as the
  // scope it compares against, and closing over the caller's live object would let the caller's own later
  // mutation of it silently widen (or narrow) the scope this poster was actually built for.
  const scopedAskIdentity = askIdentityOf({ source: askIdentity });
  const builtAtMs = now();
  const names = cardNameLookup({ home });
  const frame = ({ steps, task }: { steps: Parameters<TurnPoster["postWorking"]>[0]["steps"]; task: string }) =>
    turnFrame({ names, now, provenance, steps, task, turnChrome, turnId });
  const status = statusLifecycle({
    channel: scopedAskIdentity.channel,
    threadTs: scopedAskIdentity.threadTs,
    transport,
    turnChrome,
    turnId,
  });
  const owner = ownerTag({ home });
  return {
    ...workingPosterMethods({
      askIdentity: scopedAskIdentity,
      chrome,
      doorLedger,
      frame,
      home,
      noticeMentions: owner.mentions,
      transport,
      turnId,
    }),
    ...status,
    // Judged against the poster's own build instant: later than the answer's mention resolution, so it can
    // only ever re-check a roster, never accept one the answer's ask would not have.
    displayNames: ({ slackIds }) =>
      askerDisplayNames({ askedAtIso: new Date(builtAtMs).toISOString(), home, identityRoster, slackIds }),
    ownerMention: owner.key,
    postAnswer: async ({ answer, askIdentity: calledFor, documents, reply, uploads }) => {
      // A mismatch refuses BEFORE any effect — no Slack call, no door record — rather than posting to the
      // scope the poster was built for while claiming to answer a different ask. This is a defensive check
      // against a caller-side bug (a poster built for ask A handed ask B's ownership), not a claim that the
      // identity itself is independently verified as truthful — see the handover's own proof boundary.
      if (!sameAskIdentity({ left: scopedAskIdentity, right: calledFor })) {
        throw new TurnRefusedError(
          "postAnswer was called with an askIdentity that does not match the poster it was called on — refused before any effect",
        );
      }
      return offerAnswer({
        answer,
        askIdentity: scopedAskIdentity,
        chrome,
        documents,
        doorLedger,
        freshnessNote,
        home,
        judge,
        mentions,
        readiness,
        reply,
        transport,
        turnId,
        uploads,
        verdict,
      });
    },
    setTitle: async ({ title }) =>
      (
        await nameThreadThroughDoor({ askIdentity: scopedAskIdentity, doorLedger, home, title, transport, turnId })
      ).mapErr((error) => error.message),
    settleReaction: ({ reaction }) =>
      settleLifecycleReaction({ askIdentity: scopedAskIdentity, home, reaction, transport }),
  };
}

/** Build the poster scoped to one mention's thread — split out so {@link answerMention}'s own body stays about the call it makes, not the poster's construction. */
function posterForMention({
  mention,
  ...poster
}: Omit<Parameters<typeof liveTurnPoster>[0], "askIdentity"> & { mention: Mention }): TurnPoster {
  return liveTurnPoster({ ...poster, askIdentity: askIdentityOf({ source: mention }) });
}

/**
 * The earlier cards a test injected, or — the live path — the ones this ask's durable records name.
 *
 * @param earlierCards the injected cards, absent on every production call
 * @param home the state home the records live under
 * @param mention the ask being answered
 * @returns the cards the turn reaps once its answer posts
 */
function earlierCardsOrRead({
  earlierCards,
  home,
  mention,
}: {
  earlierCards: readonly PostedRef[] | undefined;
  home: string;
  mention: Mention;
}): readonly PostedRef[] {
  if (earlierCards !== undefined) {
    return earlierCards;
  }
  return earlierCardsForAsk({ askIdentity: askIdentityOf({ source: mention }), home });
}

/**
 * This turn's one id: the id of the capture-time checklist the listener already posted, else — no checklist
 * was posted, so no id exists yet — a freshly minted one.
 */
function resolvedTurnIdOf({
  started,
  turnId,
}: {
  started: { readonly turnId: string } | undefined;
  turnId: () => string;
}): string {
  if (started == null) {
    return turnId();
  }
  return started.turnId;
}

/** Where a withheld draft is filed: the sink a test injected, else — every production call — the real queue. */
function holdSinkOf({ hold, home }: { hold: HoldSink | undefined; home: string }): HoldSink {
  if (hold == null) {
    return liveHoldSink({ home });
  }
  return hold;
}

/** Where the completion is recorded: the sink a test injected, else — every production call — the real ledger. */
function completionSinkOf({ complete, home }: { complete: CompletionSink | undefined; home: string }): CompletionSink {
  if (complete == null) {
    return liveCompletionSink({ home });
  }
  return complete;
}

/**
 * Answer ONE mention, returning the whole outcome.
 *
 * The poster cannot be built until a mention exists, because the channel and thread come off it and are
 * closed over so a turn cannot post anywhere else. So the listener is given a factory rather than a poster:
 * it supplies the workspace-level things once, and every mention gets a poster scoped to its own thread.
 *
 * @param mention the mention to answer, as the transport parsed it — also this turn's exact ask identity
 * @param transport the Slack write transport
 * @param turnChrome the bot's identity for the working message
 * @param chrome the operator's full card chrome, from `chromeFromProfile({home})` — the answer now carries
 *   the same author row, dividers and detail label the operator card does, not just the accent colour
 * @param provenance the session link and model id stamped on every message
 * @param query the world model
 * @param doorLedger where every write's door decision is recorded before it is sent
 * @param home the resolved state home, for the door ledger
 * @param identityRoster the store's identity roster as the caller read it once, for the card's asker names
 * @param judge the withhold judgement the answer is offered to
 * @param hold where a withheld draft is filed (defaults to the real queue under the home)
 * @param complete where this turn's durable completion is recorded (defaults to the real ledger under the home)
 * @param mentions every person the answer's body mentions, already resolved to a Slack user id
 * @param readiness the bounded upload-readiness poll the answer's images go through
 * @param uploads the answer's images, already read off disk
 * @param turnId mints the id correlating one turn's messages; injected so a test can pin it
 * @param now the clock
 * @param started the capture-time checklist to advance instead of posting a new one, when the listener posted one
 * @param tier which execution tier this turn is answering under — selects the checklist steps that apply;
 *   defaults to `inline` when the caller has not decided a tier yet
 * @param verdict the reviewing session's verdict about the answer this will send; supplied by the
 *   loop rather than the worker, and `undefined` refuses the send
 * @returns the durable completion — whether an answer was posted, and the timestamps of what was — or the
 *   warn-tier refusal that recorded nothing at all, leaving this ask's dispatch intact for a second offer
 */
// max-lines-exempt: one cohesive entry point over 18 named-object-params fields, one line per field
export async function answerMention({
  mention,
  transport,
  turnChrome,
  chrome,
  provenance,
  query,
  doorLedger,
  home,
  identityRoster,
  judge,
  mentions,
  hold,
  complete,
  readiness,
  turnId,
  uploads,
  documents,
  now = () => Date.now(),
  started,
  tier,
  freshnessNote,
  verdict,
  earlierCards,
}: {
  mention: Mention;
  transport: SlackWriteTransport;
  turnChrome: TurnChrome;
  chrome: SlackCardChrome;
  provenance: TurnProvenance;
  query: TurnQuery;
  doorLedger: DoorLedgerPort;
  home: string;
  identityRoster: IdentityRosterSnapshot;
  judge: ReplyJudgement;
  mentions: ResolvedMentions;
  hold?: HoldSink;
  complete?: CompletionSink;
  readiness: UploadReadiness;
  turnId: () => string;
  uploads: readonly SlackUpload[];
  documents: readonly SlackUpload[];
  now?: () => number;
  started?: { readonly turnId: string; readonly workingTs: string } | undefined;
  tier?: ExecutionTier | undefined;
  /**
   * The door's one-line observation about how far behind the thread this answer is, applied at the render
   * call and never before it — see `./answerFreshnessNote.ts`. `undefined` means there was nothing to say.
   */
  freshnessNote?: string | undefined;
  /**
   * The reviewing session's verdict about the answer this turn will send. Supplied by the LOOP, never by
   * the worker — the worker composing the answer must not be able to influence, or manufacture, its own
   * review. `undefined` refuses the send rather than skipping the check.
   */
  verdict?: ReviewVerdict | undefined;
  /**
   * Every card an earlier turn on this ask left in the thread. Injected only by a test; production reads it
   * from the ask's own durable records under `home` (`./earlierCards.ts`), so the live path cannot skip it.
   */
  earlierCards?: readonly PostedRef[] | undefined;
}): Promise<Result<TurnCompletion, AnswerSendRefusal>> {
  // Resolved ONCE, here, and threaded through the poster, the run, every door request and the completion —
  // never re-derived at any of those call sites, which is what makes "one turn id" a fact rather than a
  // coincidence of every caller happening to agree.
  const resolvedTurnId = resolvedTurnIdOf({ started, turnId });
  return runTurn({
    complete: completionSinkOf({ complete, home }),
    earlierCards: earlierCardsOrRead({ earlierCards, home, mention }),
    hold: holdSinkOf({ hold, home }),
    mention,
    ...(tier === undefined ? {} : { tier }),
    poster: posterForMention({
      chrome,
      doorLedger,
      freshnessNote,
      home,
      identityRoster,
      judge,
      mention,
      mentions,
      now,
      verdict,
      provenance,
      readiness,
      transport,
      turnChrome,
      turnId: resolvedTurnId,
    }),
    provenance,
    query,
    // Built HERE and nowhere lower, because this is the last place that holds both the verdict and the
    // transport. `runTurn` deliberately carries neither — see `./runContract.ts`'s `TurnSupersession`.
    supersession: liveSupersession({ doorLedger, home, transport, verdict }),
    turnId: resolvedTurnId,
    uploads,
    documents,
    ...(started === undefined ? {} : { started }),
  });
}
