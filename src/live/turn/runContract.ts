/**
 * The CONTRACT one turn runs against: what the turn may post, what answering a turn can produce, what a
 * query hands back, and the two throwables a refusal travels as.
 *
 * Split out of {@link ./run.js} (the file-size ratchet, step 3), which now holds the ORDERING — acknowledge
 * before working, advance before answering, never claim a step finished before it did — and states none of
 * the shapes those steps move. `./run.js` re-exports the members an import site still reaches through it,
 * the same way it re-exports `./envelope.js`'s `TurnProvenance`; everything else is imported from here.
 *
 * Every member is a declaration: no effect runs in this file, which is what lets `./poster*.ts` depend on
 * the contract without depending on the runner.
 */
import type { HeldReply } from "../../admit/queue.js";
import type { ReplyContext } from "../../admit/withhold.js";
import type { SlackUpload } from "../../corpus/slack/writeTransport.js";
import type { Result } from "../../lib/result.js";
import type { AnswerFormAnswer } from "../../outbound/assistant/answerForm.js";
import type { TodoStep } from "../../outbound/assistant/todoBlock.js";
import type { MissingUpload } from "../../outbound/slack/missingMedia.js";
import type { ProfileReadError } from "../../profileStore.js";
import type { CoverageManifest } from "../../retrieval/coverage.js";
import type { AskIdentity } from "../ask/identity.js";
import type { TurnAnswerCard } from "./answer.js";
import type { TurnHandlerOutcome } from "./envelope.js";
import type { TerminalReaction, TurnTerminalState } from "./indicators.js";
import type { SupersessionReport } from "./supersession/run.js";

/** One checklist step's frame — the shape every route's step table shares. */
export type TurnStep = { readonly id: string; readonly title: string };

/**
 * A query failure that still knows what it had already read.
 *
 * The turn's query loads the corpus, reports its phases, and only THEN grounds the answer — so a grounding
 * failure happens with a whole `CoverageManifest` in scope. A bare `Error` discarded it, and the failure
 * card then inferred "the world model was never read" from the absence, which the checklist directly above
 * it disproved: it read `365,121 records across 6 legs` and `12 record(s) pinned`. The card was reporting a
 * state it had not established, in a message whose entire job is being checkable.
 *
 * Caught live while dogfooding, which is the only instrument that would have found it — every unit test
 * supplied its own coverage, so none of them could see the field going missing.
 */
export class TurnQueryFailure extends Error {
  /** The coverage established before the failure, when any had been. */
  readonly coverage: CoverageManifest | undefined;

  constructor({ message, coverage }: { message: string; coverage?: CoverageManifest | undefined }) {
    super(message);
    this.name = "TurnQueryFailure";
    this.coverage = coverage;
  }
}

/**
 * Raised when a turn stops rather than continuing half-posted.
 *
 * Lives HERE rather than beside the `poster.ts` code that throws it because `runTurn` is what has to tell a
 * refusal apart from a break — `poster.ts` already imports this module, so putting the class the other way
 * round would make the one `instanceof` check that matters a circular value import.
 *
 * This BASE class is the turn refusing ITSELF: the answer form failing its own schema, a poster handed an
 * ask it was not built for. Both are defects in this repo's own code, and {@link terminalStateForThrow}
 * reports them as breaks, because that is what they are.
 */
export class TurnRefusedError extends Error {}

/**
 * Raised when the ADMIT DOOR refused an outbound write — a working gate saying no, not a defect.
 *
 * A subclass rather than a flag, and the distinction is load-bearing rather than tidy: this is the ONE
 * ending where the honest thing to tell the thread is that a quality bar held, and `./failureForm.ts`'s
 * `turnFailureForm` writes a materially different card face for it. Reaching that face by string-matching a
 * message, or by treating every {@link TurnRefusedError} as a door refusal, would put "the bar was not met"
 * over a turn whose own form was malformed — which is the same class of confident wrong the door exists to
 * stop.
 */
export class DoorRefusedError extends TurnRefusedError {}

/**
 * Raised when the door's decision could not be RECORDED, so nothing was sent — an infrastructure fault, not a
 * gate saying no.
 *
 * A sibling of {@link DoorRefusedError}, never a subclass of it: the door may have passed this write, and
 * dressing a store fault as a policy refusal would put "the bar was not met" over an answer that cleared every
 * bar. {@link terminalStateForThrow} therefore reports it as `failed`, with its own reader-facing reason.
 */
export class DoorRecordingRefusedError extends TurnRefusedError {}

/**
 * The door refusing a send that a LATER attempt on the same dispatch can still make.
 *
 * Every surviving finding was warn-tier — which is the door's own definition of `status: "warn"`
 * (`../../admit/door.ts`): a bar the answer has not cleared YET, each one carrying an override token and a
 * correction, none of them the irreversible-harm core a `hold` is. The answer still exists, the worker is
 * still alive, and the dispatch it was composed under is still the right one to finish the turn.
 *
 * A refusal rather than a throw, and a REFUSAL OF POLICY rather than a failure of fact: measured on
 * `C0SYN000001/1790048248.995219`, a warn-tier refusal travelled as a {@link DoorRefusedError},
 * was converted into a `failed` completion, and that terminal event SUPERSEDED the dispatch record — so
 * `turn resume --dispatch` and `turn answer --dispatch` both answered "no dispatch record found" for an
 * answer nothing had lost, over a public failure card tagging the owner. The typed value is what lets the
 * verb stop without finalising anything.
 *
 * `ANSWER_FORM_UNSENDABLE` is the same ending one step earlier: the answer renders a payload the wire guard
 * (`../../corpus/slack/writeGuardTypedRuns.ts`) would refuse, so it is caught before the door is asked and
 * nothing reaches Slack. Measured on `C0SYN000001/1790210462.917129`: a bare URL in
 * `measurements[0].repro` threw from that guard mid-send, the throw was read as a break, and a live worker's
 * thread got the same public failure card and lost the same dispatch record.
 *
 * `ANSWER_PROFILE_UNREADABLE` is a failure of FACT on the same footing: `profile.json` is there but corrupt,
 * so the voice rules the answer is judged against cannot be read. Nothing is lost by stopping. Once the
 * profile is fixed, the same dispatch offers the same answer again.
 */
export interface AnswerSendRefusal {
  readonly code: "ANSWER_SEND_WARN_REFUSED" | "ANSWER_FORM_UNSENDABLE" | "ANSWER_PROFILE_UNREADABLE";
  readonly message: string;
}

/**
 * The one way an {@link AnswerSendRefusal} is built — the factory a test constructs its fixtures through, so
 * a factory that stops matching its own type fails in a test rather than in a thread.
 */
export const AnswerSendRefusals = {
  formUnsendable: ({ message }: { message: string }): AnswerSendRefusal => ({
    code: "ANSWER_FORM_UNSENDABLE",
    message,
  }),
  profileUnreadable: ({ error }: { error: ProfileReadError }): AnswerSendRefusal => ({
    code: "ANSWER_PROFILE_UNREADABLE",
    message: `refused: ${error.message}. nothing was posted.`,
  }),
  warnRefused: ({ message }: { message: string }): AnswerSendRefusal => ({
    code: "ANSWER_SEND_WARN_REFUSED",
    message,
  }),
} as const;

/** One delivery's result: the outcome to fold, and the terminal state every indicator must be finalised for. */
export interface DeliveredTurn {
  readonly outcome: TurnHandlerOutcome;
  readonly state: TurnTerminalState;
}

/**
 * The coverage a thrown query failure carried, when it carried any.
 *
 * `undefined` means THIS ERROR carries no manifest — never that nothing was read. Only a
 * {@link TurnQueryFailure} carries one, so every other ending (a door refusal above all) answers `undefined`
 * however much the turn had already loaded, and a caller that reads the absence as "the world model was
 * never read" is stating something this function cannot establish. `./failureCoverageNote.ts`'s own note carries the card
 * that did exactly that.
 *
 * @param error the value the query threw
 * @returns the manifest, or undefined when this error carries none
 */
export function coverageOfFailure({ error }: { error: unknown }): CoverageManifest | undefined {
  return error instanceof TurnQueryFailure ? error.coverage : undefined;
}

/** The identity of a message the turn posted. */
export interface PostedRef {
  readonly channel: string;
  readonly ts: string;
}

/**
 * What happened to an answer offered to the door: it went out, it was held with a reason, or a warn-tier
 * bar refused this ATTEMPT without ending the turn.
 *
 * `missingMedia` rides on the POSTED arm because a degraded delivery is a success, not a third outcome: the
 * answer is in the thread and says which image is absent. It is carried rather than dropped so the turn's own
 * terminal record says so too — a media loss that is only visible inside one Slack message is a loss the
 * lifecycle cannot report.
 *
 * `retryable-refusal` is the fourth thing that can happen and the only one that is not an ENDING: see
 * {@link AnswerSendRefusal}. It stays apart from `withheld` because the two differ in what the person waiting
 * is owed — a withheld draft is filed and said so in the thread, while a warn-tier refusal posts nothing at
 * all and leaves the same worker to correct the answer and offer it again.
 */
export type PostAnswerOutcome =
  | { readonly kind: "posted"; readonly ref: PostedRef; readonly missingMedia: readonly MissingUpload[] }
  | { readonly kind: "withheld"; readonly code: string; readonly reason: string }
  | { readonly kind: "retryable-refusal"; readonly refusal: AnswerSendRefusal };

/**
 * Where a withheld draft goes — the queue, injected.
 *
 * A seam rather than a direct call to the store for the reason every effect in this file is one: the ORDER
 * matters (the draft is filed before the thread is told it was, so nobody is ever promised a queue entry that
 * does not exist) and an ordering claim is what a test has to be able to check without a filesystem.
 */
export type HoldSink = (input: { held: HeldReply }) => Promise<{ readonly id: string }>;

/**
 * What a turn can do to Slack, as plain functions.
 *
 * Narrow on purpose: three verbs, no client, no token, no channel — the adapter closes over those. A seam
 * that took a channel would let the turn post somewhere other than the thread it was asked in, which is a
 * mistake worth making unrepresentable rather than reviewing for.
 */
export interface TurnPoster {
  /**
   * The identity-map key a NOTICE may tag the owner under, or `undefined` when no owner is configured.
   *
   * A field on the poster rather than an argument threaded down to `settledFailure`, because the poster is
   * the only thing that holds BOTH halves of a mention: which key a card may write, and what that key
   * resolves to when {@link TurnPoster.postNotice} renders it. Split across two owners they can disagree,
   * and the way they disagree is a card carrying a mention nothing resolves — which the renderer refuses,
   * turning a failure notice into silence in a thread where somebody is waiting.
   *
   * `undefined` is therefore not "skip the tag": it is the poster stating it cannot resolve one, and
   * `./failureForm.ts`'s `turnFailureForm` answers it by writing no tag line rather than an unresolvable one.
   */
  readonly ownerMention: string | undefined;
  /**
   * What each Slack user id in the ASKER's own words reads as, for the notices that quote them.
   *
   * A function rather than a map, because the ids are the question's and the poster never sees a question —
   * and a FUNCTION on the poster rather than an argument threaded down to `settledFailure`, because
   * the poster is the only thing in the turn that holds a state home to ask the identity layers with.
   * `./turnSettle.ts`, `./turnWithheld.ts` and `./run.ts` deliberately carry no `home` at all.
   *
   * Distinct from {@link TurnPoster.ownerMention} despite the family resemblance: that field's two halves
   * have to stay in lockstep because a `mention` run is resolved AGAIN at render. These names are prose —
   * nothing resolves them a second time, and an id the layers cannot place is simply absent, which
   * `./quotedQuestion.ts` renders as the id itself rather than as a guess.
   */
  readonly displayNames: (input: { slackIds: readonly string[] }) => Readonly<Record<string, string>>;
  /** Post the working message and return its identity. */
  readonly postWorking: (input: { steps: readonly TodoStep[]; task: string }) => Promise<PostedRef>;
  /** Advance the ordinary metadata-bearing working message IN PLACE through `chat.update`. */
  readonly advanceWorking: (input: { posted: PostedRef; steps: readonly TodoStep[]; task: string }) => Promise<void>;
  /**
   * Delete the working message once the real answer has replaced it — so a thread ends up with ONE reply,
   * never a stuck checklist sitting above it. Best effort, like {@link SlackWriteTransport.deleteMessage}
   * underneath it: reports whether it succeeded rather than throwing, because a delete failing is worth
   * falling back on, never worth failing the turn over.
   */
  readonly deleteWorking: (input: { posted: PostedRef }) => Promise<boolean>;
  /**
   * Delete a card an EARLIER turn on this same ask left in the thread — its checklist, its failure or held
   * notice, its blocked-on-human tag — once this turn's real answer has posted.
   *
   * Its own method rather than {@link TurnPoster.deleteWorking} because the door records it as its own verb:
   * a ledger reader must be able to tell "this turn replaced its own checklist" from "this turn reaped a card
   * an earlier turn posted". NEVER throws, for the reason every terminal method here does — the answer has
   * already posted — and reports `false` when the delete could not be confirmed, so the turn can name the card
   * still standing. `./earlierCards.ts` carries the owner's ruling.
   */
  readonly reapEarlierCard: (input: { posted: PostedRef }) => Promise<boolean>;
  /**
   * Correct the working message's final state when {@link TurnPoster.deleteWorking} could not remove it.
   *
   * A SEPARATE method from {@link TurnPoster.advanceWorking} because it has a distinct never-throws terminal
   * contract. It uses the same static renderer and update path, but reports `false` instead of rejecting once
   * an answer or notice has already posted.
   *
   * NEVER throws, like {@link TurnPoster.deleteWorking}: both of its call sites run it after the turn's own
   * answer or notice has already posted, so a rejection here must never read as the turn itself having
   * failed. A refusal is reported through the logger AND returned as `false`, so a caller for whom neither
   * this nor `deleteWorking` succeeded can say so on the turn's own outcome rather than reporting success
   * over a checklist that is stuck.
   *
   * @returns whether the message was actually corrected — `false` only when the underlying Slack call itself
   *   failed, never when there was simply nothing left to correct
   */
  readonly finalizeWorking: (input: {
    posted: PostedRef;
    steps: readonly TodoStep[];
    task: string;
  }) => Promise<boolean>;
  /**
   * Offer the answer to the door, with the context the judgement needs, and post it — with whatever images
   * and DOCUMENTS it carries attached — if the door admits it.
   *
   * The two attachment lanes arrive as two arrays and stay apart all the way to the wire: only `uploads` is
   * visual evidence, judged by image admission and covered by a reviewer's observations, while `documents`
   * is the deliverable the ask wanted and is judged by neither. `../../corpus/slack/writeSend.ts`'s header
   * carries why.
   *
   * Returns a {@link PostAnswerOutcome} rather than a `PostedRef` because "the door held this" is a THIRD
   * thing that can happen to a reply, alongside posting it and throwing. A `PostedRef | undefined` would
   * have made a held reply indistinguishable from a bug at the type level, and this is exactly the outcome
   * a caller must not be able to mistake for success.
   */
  readonly postAnswer: (input: {
    answer: AnswerFormAnswer;
    askIdentity: AskIdentity;
    documents: readonly SlackUpload[];
    reply: ReplyContext;
    uploads: readonly SlackUpload[];
  }) => Promise<PostAnswerOutcome>;
  /**
   * Post a NOTICE — a card that reports what the turn did rather than what the corpus says.
   *
   * The held notice and the failure card both come through here, and the split from {@link TurnPoster.postAnswer} is the
   * judgement's whole scope: a card carrying an answer is judged, a card carrying no answer never is. A turn
   * that held its reply and then held the notice saying so would leave the person who asked in silence, which
   * is the one outcome this mechanism exists to prevent.
   */
  readonly postNotice: (input: { card: TurnAnswerCard }) => Promise<PostedRef>;
  /**
   * Name the agent thread. Resolves with a REASON when Slack refused, never throws.
   *
   * Shaped as a resolved refusal rather than a rejection so the ordering below can stay linear: a title is
   * the one thing a turn may fail to do and still be a correct turn, and expressing that with a try/catch
   * around one of four sequential effects would read as if any of them were optional.
   */
  readonly setTitle: (input: { title: string }) => Promise<Result<void, string>>;
  /**
   * Set the native "thinking" indicator, BEFORE investigation begins. Resolves with a REASON when Slack
   * refused, never throws — same never-throws shape as {@link TurnPoster.setTitle}, and for the same reason:
   * a status indicator is a courtesy the turn must survive losing, never something worth failing over.
   */
  readonly beginStatus: (input: { status: string }) => Promise<Result<void, string>>;
  /**
   * Clear the indicator once the turn has something to show instead of it — an answer, a held notice, or a
   * failure card. Same never-throws shape as {@link TurnPoster.beginStatus}. Clearing also STOPS the
   * re-assert timer, which is why no terminal path may skip it: measured, that timer is not
   * `unref`'d and keeps re-raising the indicator for as long as its host process lives.
   */
  readonly endStatus: () => Promise<Result<void, string>>;
  /**
   * Stop the re-assert timer WITHOUT clearing the indicator — the one ending that is not an ending.
   *
   * Its whole reason for existing is {@link AnswerSendRefusal}: a warn-tier refusal leaves the turn
   * unfinished, so clearing the indicator would tell the thread the bot stopped looking when it has not, and
   * leaving the timer running would keep re-raising it for as long as the host process lives (the timer is
   * not `unref`'d — measured, see {@link TurnPoster.endStatus}). Those are the only two moving
   * parts, so this performs NO Slack write and touches neither the checklist nor the reaction.
   *
   * Synchronous and total, unlike every other method here, because it only clears a timer handle.
   */
  readonly stopStatusReasserting: () => void;
  /**
   * Leave exactly one terminal reaction standing on the ORIGINAL tagged message.
   *
   * Called on EVERY terminal path, not only the answered one — `./indicators.ts` decides which reaction each
   * ending earns. Same never-throws shape as its two siblings above: by the time this runs the turn's real
   * outcome has already happened, so a refused reaction must never be reported as the turn having failed.
   */
  readonly settleReaction: (input: { reaction: TerminalReaction }) => Promise<Result<void, string>>;
}

/** What the query produced: the answer form it validated, and one line for the checklist's last tick. */
export interface TurnQueryOutcome {
  readonly answer: AnswerFormAnswer;
  readonly completionDetail: string;
}

/**
 * The world model, injected.
 *
 * `onPhase` is how the query drives the checklist without the turn knowing what the query's internals
 * are. The adapter calls it once after the corpus is loaded and once after retrieval ranks; a fake in a
 * test calls it as many times as the test wants, in the order the test chooses, which is what makes the
 * advance-then-answer ordering falsifiable.
 *
 * The callback is awaited, so a phase edit that is still in flight cannot be overtaken by the next one —
 * two `chat.update`s racing on one message can land out of order and leave the checklist showing an
 * earlier frame than the work has reached.
 */
export type TurnQuery = (input: {
  question: string;
  onPhase: (phase: { detail: string }) => Promise<void>;
}) => Promise<TurnQueryOutcome>;

/**
 * The present-tense status text shown on the native indicator while a turn investigates.
 *
 * One fixed string rather than one per question, matching {@link TURN_STEPS}'s own fixed-plan shape: the
 * indicator's job is to say "something is happening", not to narrate what.
 */
export const TURN_STATUS_TEXT = "is looking into it…";

/**
 * How a correction turn's declared supersession is settled — injected, and called ONLY once the answer that
 * replaces the target has actually posted.
 *
 * A seam for the same reason {@link HoldSink} is one: what the turn guarantees about it is an ORDER (the
 * replacement exists before the thing it replaces comes down), and an order is only testable when a fake can
 * record the calls in it. It resolves rather than rejects on every ending, including a refusal — by the time
 * it runs the thread already carries the right answer, so a failed cleanup is a diagnostic and never a turn
 * that failed. `../turn/supersession/run.ts` carries the orderings it guarantees internally.
 *
 * The reviewer's warrant is CLOSED OVER by whoever builds this, never passed in here. That is the same
 * property {@link TurnPoster}'s `verdict` has and for the same reason: the worker that composed the
 * correction must not hold, or be able to manufacture, the second declaration that authorises the delete.
 *
 * `postedAnswer` travels the other way, and it is the half the closed-over verdict cannot supply: the
 * settle binds the warrant to the answer that ACTUALLY went out, so a verdict written about some other
 * draft cannot authorise a delete. The turn is the only layer holding that answer, and passing the form
 * rather than a digest keeps the hashing in one place (`../turn/posterAnswer.ts`'s `answerDigestOf`).
 */
export type TurnSupersession = (input: {
  askIdentity: AskIdentity;
  declaredTs: string | undefined;
  postedAnswer: AnswerFormAnswer;
  postedAnswerTs: string;
  turnId: string;
}) => Promise<SupersessionReport>;
