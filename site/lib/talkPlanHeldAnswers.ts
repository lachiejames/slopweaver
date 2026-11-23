/**
 * Every message the thinking model writes on a voice call, held on the server until the floor is the owner's to give, then
 * handed to the voice in one `thread/realtime/appendSpeech` — so an answer that lands while the owner is mid-clause waits for
 * them to finish rather than being spoken over them. The plan call starts realtime with `clientManagedHandoffs: true`
 * (`src/talk/planSession.ts`), which leaves every hand-back to this module; `./talkPlanCall.ts` owns the session and
 * feeds it. Split from that file, which sits at its 300-line cap.
 *
 * The voice must not interrupt the owner. MEASURED on one call: four times the voice began within 1 ms of the
 * owner's transcript closing on an unfinished clause — "…probably going to be some", "…And yeah", "by update prompt,
 * we mean", "…who don't have" — each time voicing a Codex answer that
 * had completed 0.15–7.5 s earlier. With handoffs left to the app-server, a completed answer is forwarded at once and
 * the realtime voice speaks it at the first pause it reads as the owner's turn ending; the prompt's turn-taking lines
 * (`src/talk/voiceTurnTaking.ts`) ask it to hold such an answer and it does not. Repro, each of the owner's
 * closing segments beside the voice's next and the last `codex … completed` before it: `jq -r 'select((.kind=="segment"
 * and .final) or (.kind=="tool" and (.name|startswith("codex")))) | "\(.atIso) \(.who // .name) \((.text // .detail //
 * "")[-60:])"' $SLOPWEAVER_HOME/talk/calls/<call-id>-*.jsonl`.
 *
 * MEASURED live on the plan (a headless-Chromium WebRTC probe feeding synthesized speech): with
 * `clientManagedHandoffs: true` a final answer completed 29.6 s in was not voiced at all until the console appended it
 * at 53.8 s; the session then said it once, in its own words, and later hand-offs and direct answers kept working.
 * `appendSpeech` and an `assistant` `appendText` landed alike, as `session.context.appended`.
 *
 * The release rule, and the owner's words it reads, are `./talkPlanHeard.ts`'s. What a release says is
 * `./talkPlanHeldRelease.ts`'s.
 */
import { PLAN_CALL_LIMITS, type PlanCallEvent } from "./planCallContract";
import { CallArrivals } from "./talkPlanArrivals";
import { HeardWords, heldAnswerRefusal, transcriptTextOf } from "./talkPlanHeard";
import {
  type HeldAnswer,
  type HeldAnswersCall,
  overtakingTurnOf,
  RUNNING_LIST_LANDED_LINE,
  releaseOf,
  supersededByOwner,
  supersededDetail,
  unsaidOf,
} from "./talkPlanHeldRelease";
import { fateOf, type RpcOutcome } from "./talkPlanProtocol";
import { repeatDroppedEvents, type StampedAnswer, splitRepeats, voicedBars } from "./talkPlanRepeatAnswer";
import type { CallClock } from "./talkPlanStart";
import type { TranscriptPhase } from "./talkPlanUtterance";

/** How many times a release the session refuses outright is tried, before its messages are given up on. */
const HELD_RELEASE_ATTEMPTS = 3;

/** The thinking model's messages on one voice call, held until the floor is free. */
export class HeldAnswers {
  private readonly clock: CallClock;
  private readonly call: HeldAnswersCall;
  private held: StampedAnswer[] = [];
  /** Each turn a release may have spoken an answer of, by what the owner's next words must begin after (`./talkPlanRepeatAnswer.ts`). */
  private readonly answered = new Map<string, number>();
  /** The turns whose `offer_copy` the page answered unrefused: only their answers say a draft is on the owner's list. */
  private readonly listed = new Set<string>();
  /** The listed turns whose line a write has carried, so a second offer in one turn never says it again. */
  private readonly said = new Set<string>();
  /** The owner's words as transcribed, which the release rule reads (`./talkPlanHeard.ts`). */
  private readonly words: HeardWords;
  /** The order the owner's words, the turns' starts and their messages arrived in (`./talkPlanArrivals.ts`). */
  private readonly arrivals = new CallArrivals();
  /** The turns an answer was dropped for being overtaken, so its own answer will never say that turn's line. */
  private readonly droppedTurns = new Set<string>();
  /**
   * The dropped turns whose line is still owed, said on whatever answer goes next — one line for all of them, as a
   * second offer in one turn is — and cleared only by a write that said it.
   */
  private readonly owed = new Set<string>();
  /** The next look at the floor, while anything is held. */
  private cancelLook: (() => void) | undefined;
  /** A release's request is unanswered. */
  private releasing = false;
  /** Releases refused outright in a row, so a session that refuses every one is given up on. */
  private refusedReleases = 0;
  /** When the voice last took a release, which it says within a second or two. */
  private voicedAt: number | undefined;
  private stopped = false;

  /**
   * The held answers of one call.
   *
   * @param clock the call's own time
   * @param call what they read of the call, and how they speak there
   */
  constructor({ clock, call }: { clock: CallClock; call: HeldAnswersCall }) {
    this.clock = clock;
    this.call = call;
    this.words = new HeardWords({ clock });
  }

  /**
   * How many messages wait, or are being handed over now — the floor's `heldAnswers` (`./talkPlanFloor.ts`), so no
   * other unasked line and no rollover takes the gap an answer is owed.
   *
   * @returns the count, one or more while a release is in flight
   */
  count(): number {
    return this.held.length + (this.releasing ? 1 : 0);
  }

  /**
   * What the floor reads of the held answers and of the owner's transcript (`./talkPlanFloor.ts`).
   *
   * @returns how many messages are held, when the voice was last handed a release, whether the owner's utterance is open, and
   *   when they were last transcribed
   */
  floor(): {
    readonly heardUtteranceOpen: boolean;
    readonly heldAnswers: number;
    readonly lastHeardMs: number | undefined;
    readonly lastVoicedMs: number | undefined;
  } {
    return {
      heardUtteranceOpen: this.words.open(),
      heldAnswers: this.count(),
      lastHeardMs: this.call.transcribed().heardAt,
      lastVoicedMs: this.voicedAt,
    };
  }

  /**
   * One `thread/realtime/transcript/*` notification of the owner's, read for {@link HeldAnswers.heard}: a `delta` carries
   * `delta`, a `done` carries `text`.
   *
   * @param atMs when the server took it
   * @param phase which notification it was, from its method
   * @param params the notification's params
   */
  heardIn({ atMs, phase, params }: { atMs: number; phase: TranscriptPhase; params: unknown }): void {
    this.heard({ atMs, phase, text: transcriptTextOf({ params, phase }) });
  }

  /**
   * The owner's words as the session transcribed them, so the release reads their end and knows whether they are mid-utterance
   * ({@link HeardWords.heard}); a `done` with words in it is a later arrival, which supersedes what came before it.
   *
   * @param atMs when the server took the notification
   * @param phase whether it was a `delta` or a `done`
   * @param text its words — a delta's new words, a done's whole utterance — `undefined` when it carried none
   */
  heard({ atMs, phase, text }: { atMs: number; phase: TranscriptPhase; text: string | undefined }): void {
    const wasOpen = this.words.open();
    const worded = this.words.heard({ atMs, phase, text });
    this.arrivals.heard({ nowOpen: this.words.open(), wasOpen, worded });
  }

  /**
   * The call took the page's resume, which it posts only once the owner's microphone has gone quiet: their open utterance is a
   * silence the provider never closed, so it holds nothing until their next delta reopens it
   * (`closeUserUtteranceOnResume`, `./talkPlanUtterance.ts`). An answer held for it, or one written after, then goes
   * on the ordinary quiet rule rather than waiting on a word the owner has already finished.
   *
   * @returns what puts the owner's utterance back should the session refuse the resume after all
   */
  resumeAccepted(): () => void {
    return this.words.resumeAccepted();
  }

  /**
   * The page answered an `offer_copy` unrefused, so the draft is on the owner's list: that turn's answer ends on
   * {@link RUNNING_LIST_LANDED_LINE}. A call from a server too old to name its turn lands no line. One landing for a
   * turn whose answer was already dropped as overtaken is owed instead, and said on the next answer.
   *
   * @param turnId the Codex turn that made the offer
   */
  offerLanded({ turnId }: { turnId: string | undefined }): void {
    if (turnId === undefined || this.said.has(turnId)) {
      return;
    }
    if (this.droppedTurns.has(turnId)) {
      this.owed.add(turnId);
      return;
    }
    this.listed.add(turnId);
  }

  /**
   * A Codex turn started on the call's thread: every other turn's message that arrived before it is overtaken
   * ({@link overtakingTurnOf}), and dropped at its release rather than said. A replayed start of a turn already seen
   * draws no new boundary, and nor does one arriving after that turn's own message: when it really began is unknown,
   * so it overtakes nothing rather than dropping an answer still owed. The running-list
   * line of a turn whose answer it overtook is owed at that answer's release, never moved here: the console says it,
   * never the thinking model, so dropping the answer would otherwise drop the line with it.
   *
   * @param turnId the turn that started
   */
  turnStarted({ turnId }: { turnId: string }): void {
    this.arrivals.turnStarted({ turnId });
  }

  /**
   * A message the thinking model completed: stamped with the instant it arrived, held, said on the stream with why it
   * waits, and released at once when the floor is already free.
   *
   * @param answer the completed message
   */
  hold({ answer }: { answer: Omit<HeldAnswer, "completedSeq"> }): void {
    if (this.stopped) {
      return;
    }
    this.held.push({ ...answer, ...this.arrivals.wroteMessage({ turnId: answer.turnId }) });
    const why = this.refusal();
    if (why === undefined) {
      void this.release({ why: "the floor was free" });
      return;
    }
    const { itemId, turnId } = answer;
    this.call.emit({ event: { detail: why, itemId, kind: "held-answer", pending: true, phase: "held", turnId } });
    this.armLook();
  }

  /**
   * Answers are held and something outside the transcript says the owner is done — their nudge, or the page's resume over a
   * silence its microphone meter judged not theirs — so they go now, whoever holds the floor but another of the call's
   * own writes: an utterance of the owner's still open included, since a transcript that has not closed it is the stall this
   * exists for.
   *
   * @param why what said the owner is done, for the stream
   * @param untaken told once if the release hands the voice nothing: refused outright, ended, thrown, dropped or blank
   * @returns true when something was held and is being handed over
   */
  releaseNow({ untaken, why }: { untaken?: () => void; why: string }): boolean {
    if (this.held.length === 0 || this.releasing || this.call.blocked() !== undefined) {
      return false;
    }
    void this.release({ untaken, why });
    return true;
  }

  /**
   * The page's resume taken over held answers: {@link HeldAnswers.releaseNow} with the owner's open utterance closed, as a
   * taken resume closes it ({@link HeldAnswers.resumeAccepted}), and put back when nothing went or the release handed
   * the voice nothing.
   *
   * @param why what said the owner is done, for the stream
   * @returns true when something was held and is being handed over
   */
  releaseOnResume({ why }: { why: string }): boolean {
    const untaken = this.resumeAccepted();
    if (this.releaseNow({ untaken, why })) {
      return true;
    }
    untaken();
    return false;
  }

  /** The call ended: nothing held is said. */
  stop(): void {
    this.stopped = true;
    this.held = [];
    this.cancelLook?.();
    this.cancelLook = undefined;
  }

  /**
   * Why the floor will not take what is held now.
   *
   * @returns the reason, or `undefined` when it will
   */
  private refusal(): string | undefined {
    const { heardAt, voiceAt } = this.call.transcribed();
    const blocked = this.releasing ? "another held answer is being handed over" : this.call.blocked();
    const heardTail = this.words.tail();
    const heardUtteranceOpen = this.words.open();
    return heldAnswerRefusal({ blocked, heardAt, heardTail, heardUtteranceOpen, nowMs: this.clock.nowMs(), voiceAt });
  }

  /** Look at the floor again in {@link PLAN_CALL_LIMITS.heldPollMs}, once: one look is armed at a time. */
  private armLook(): void {
    if (this.stopped || this.cancelLook !== undefined || this.held.length === 0) {
      return;
    }
    this.cancelLook = this.clock.after({
      ms: PLAN_CALL_LIMITS.heldPollMs,
      run: () => {
        this.cancelLook = undefined;
        if (this.refusal() === undefined) {
          void this.release({ why: "the owner's words went quiet" });
          return;
        }
        this.armLook();
      },
    });
  }

  /**
   * A release the session refused outright, which said nothing (`mayHaveLanded`, `./talkPlanProtocol.ts`): its
   * messages go back to the front of the queue for the next free floor, {@link HELD_RELEASE_ATTEMPTS} times in all,
   * and after that are said as given up on (a
   * refusal here must not cost the owner an answer).
   *
   * @param taken the messages the refused write carried
   * @param outcome the refusal
   */
  private refused({
    taken,
    last,
    outcome,
  }: {
    taken: readonly StampedAnswer[];
    last: HeldAnswer;
    outcome: RpcOutcome;
  }): void {
    this.refusedReleases += 1;
    const fate = fateOf({ outcome });
    if (this.stopped || this.refusedReleases >= HELD_RELEASE_ATTEMPTS) {
      this.refusedReleases = 0;
      const message = `the voice was not handed the thinking model's answer in ${String(HELD_RELEASE_ATTEMPTS)} tries: ${fate}`;
      this.failed({ last, message });
      return;
    }
    this.held = [...taken, ...this.held];
    this.failed({ last, message: `the voice did not take the thinking model's answer, trying again: ${fate}` });
  }

  /**
   * A release that handed the voice nothing, said as an error and as a `failed` held answer carrying whether anything
   * is still owed — a refusal tried again is, a given-up batch is not — so the page's rollover hold never
   * outlives what it holds for (`pageRolloverHold`, `./callRolloverFloor.ts`).
   *
   * @param last the last message of the batch that handed nothing
   * @param message what went wrong, in a sentence the stream shows
   */
  private failed({ last, message }: { last: HeldAnswer; message: string }): void {
    this.call.emit({ event: { kind: "error", message } });
    const { itemId, turnId } = last;
    const pending = this.held.length > 0;
    this.call.emit({ event: { detail: message, itemId, kind: "held-answer", pending, phase: "failed", turnId } });
  }

  /**
   * Hand the voice everything held, in one write. One refused outright said nothing and is tried again
   * ({@link HeldAnswers.refused}). One with no answer in time may still be said, and nothing in this protocol tells
   * which — the voice's own transcript was tried as the witness and is a proxy, not proof. So it is said as
   * an error and never tried again: an answer said twice is the voice talking over the owner
   * again. The one not said is lost to their ear and is not drawn on their screen either (`written` only persists it), so
   * the error event in the call file is its one trace — the residue of this trade, stated rather than discovered.
   *
   * @param why what freed the floor, for the stream
   * @param untaken told once if this write hands the voice nothing — dropped, blank, refused outright, ended or
   *   thrown — never on a timeout, which may have been said
   */
  private async release({ untaken, why }: { untaken?: (() => void) | undefined; why: string }): Promise<void> {
    const all = this.held.splice(0);
    this.cancelLook?.();
    this.cancelLook = undefined;
    const runningTurns = this.call.runningTurns();
    const turnStarts = new Map(this.arrivals.turnStarts());
    const seqs = { latestHeardDoneSeq: this.arrivals.latestHeardDoneSeq(), runningTurns, turnStarts };
    const superseded = (answer: HeldAnswer): boolean => supersededByOwner({ ...seqs, answer });
    const split = splitRepeats({ answered: this.answered, superseded, taken: all, turnStarts });
    try {
      // Traced as no fault, like a superseded answer: the turn's first answer is the one the owner was owed.
      for (const event of repeatDroppedEvents({ split })) {
        this.call.emit({ event });
      }
    } catch (error) {
      // Put back, so a listener throwing on it loses none of them; never held during it, which a nested
      // release would say twice — and the look armed again to release them, whatever started this one.
      this.held = [...split.kept, ...this.held];
      this.armLook();
      throw error;
    }
    const { answeredAfter, kept: taken } = split;
    const last = taken.at(-1);
    if (last === undefined) {
      untaken?.();
      return;
    }
    const keptAnswerTurns = new Set(taken.filter((h) => !h.commentary && !superseded(h)).map((h) => h.turnId));
    taken.forEach((h) => {
      if (!h.commentary && overtakingTurnOf({ answer: h, turnStarts }) !== undefined) {
        this.droppedTurns.add(h.turnId);
      }
    });
    // A listed turn whose answer this write drops, keeping none of its, owes its line to whatever answer goes next.
    taken.forEach((h) => {
      if (this.listed.has(h.turnId) && this.droppedTurns.has(h.turnId) && !keptAnswerTurns.has(h.turnId)) {
        this.listed.delete(h.turnId);
        this.owed.add(h.turnId);
      }
    });
    const owedNow = new Set(this.owed);
    const owedLine = owedNow.size > 0;
    const { carried, text, voiced } = releaseOf({ ...seqs, held: taken, listed: this.listed, owedLine });
    // The turns this write says the line for, which no later write says again unless this one is refused outright, and
    // whether it says the owed one, which every answer it keeps can carry.
    const lined = Array.from(keptAnswerTurns).filter((keptTurn) => this.listed.has(keptTurn));
    const owedSaid = owedLine && keptAnswerTurns.size > 0;
    if (taken.every((answer) => supersededByOwner({ ...seqs, answer }))) {
      // Not a fault, so no `error`: the owner's newer words reached a turn whose answer is the one owed. The event is the call
      // file's trace of a message the thinking model wrote and the voice was never handed.
      const { itemId, turnId } = last;
      const detail = supersededDetail({ last, turnStarts });
      const pending = this.held.length > 0;
      // Put back before the event, so a listener throwing on it cannot keep the owner's utterance closed;
      // the same in the blank branch below.
      untaken?.();
      this.call.emit({ event: { detail, itemId, kind: "held-answer", pending, phase: "dropped", turnId } });
      return;
    }
    // A blank or a nod alone is nothing to say, but each is traced on the stream, never dropped unseen —
    // and as no fault. Measured: a call showed this trace as an error after nearly every answer, the trailing blank
    // a turn writes once it has answered, and the owner read it as the voice handed nothing. Whether a turn that ended
    // having said nothing owes the owner a word is `./talkPlanTurnOutcome.ts`'s, which reads the turn's end, not one
    // message.
    const unsaid = unsaidOf({ ...seqs, taken });
    if (text === "") {
      untaken?.();
    }
    unsaid.forEach(({ detail, itemId, turnId }) => {
      const pending = this.held.length > 0 || text !== "";
      this.call.emit({ event: { detail, itemId, kind: "held-answer", pending, phase: "dropped", turnId } });
    });
    if (text === "") {
      this.armLook();
      return;
    }
    // The turns whose answer this write carries — a running-list line said for one counts — so a turn that answered
    // never reads as one that said nothing, whichever message of it went last; and those it carries only commentary of,
    // which says the work is on and answers nothing ("let me check the logs").
    // An owed line this write says is its overtaken turn's too.
    const owedTurns = owedSaid ? Array.from(owedNow) : [];
    const answered = new Set([...carried.filter((h) => !h.commentary).map((h) => h.turnId), ...lined, ...owedTurns]);
    const handedTurns = {
      answered: Array.from(answered),
      commented: Array.from(new Set(carried.filter((h) => h.commentary).map((h) => h.turnId))).filter(
        (turnId) => !answered.has(turnId),
      ),
    };
    this.releasing = true;
    let mayHaveSpoken = false;
    // Inside the `try`, so a listener throwing on the `handing` event still puts the owner's utterance back.
    let judgedAgain = false;
    try {
      // An answer released the moment it completes was never `held`, so this is the one event
      // saying it is owed while the voice's write is in flight — up to its whole timeout.
      const { itemId, turnId } = last;
      this.call.emit({ event: { detail: why, itemId, kind: "held-answer", pending: true, phase: "handing", turnId } });
      judgedAgain = taken.some(
        (answer) =>
          overtakingTurnOf({ answer, turnStarts }) === undefined &&
          overtakingTurnOf({ answer, turnStarts: this.arrivals.turnStarts() }) !== undefined,
      );
      if (judgedAgain) {
        // A listener of that event started a turn that overtook this text. It is
        // judged again with nothing said, the write's order and the page's hold unchanged; its own turn's late
        // start overtakes nothing, so changes nothing here.
        this.held = [...taken, ...this.held];
        return;
      }
      this.arrivals.voiceHanded();
      const spoke = await this.call.speak({ text });
      // The owed-turn window's judgement (`OwedTurns.handing`): only a result or a timeout may have reached the session.
      mayHaveSpoken = spoke.kind === "result" || spoke.kind === "timeout";
      if (mayHaveSpoken) {
        this.call.handed(handedTurns);
      }
      if (spoke.kind !== "error") {
        lined.forEach((linedTurn) => {
          this.listed.delete(linedTurn);
          this.said.add(linedTurn);
        });
        // Only the owed lines this text was built with: one owed while it was in flight is still owed.
        if (owedSaid) {
          owedNow.forEach((owedTurn) => {
            this.owed.delete(owedTurn);
            this.said.add(owedTurn);
          });
        }
      }
      if (spoke.kind === "result") {
        // Only a taken write: after a timeout the owner is told the answer may be lost, so its turn's next one may be their only
        // copy, and hearing it twice costs less than never. Only a turn whose words this
        // text carries: a split sign-off can leave one with none.
        voicedBars({ answeredAfter, voiced }).forEach(([t, bar]) => this.answered.set(t, bar));
        this.voicedAt = this.clock.nowMs();
        this.call.voiced();
        const event: PlanCallEvent = {
          detail: why,
          itemId: last.itemId,
          kind: "held-answer",
          // A newer message held while this one was being handed over is still owed.
          pending: this.held.length > 0,
          phase: "released",
          turnId: last.turnId,
        };
        this.call.emit({ event });
        this.refusedReleases = 0;
      } else if (spoke.kind === "error") {
        this.refused({ last, outcome: spoke, taken });
      } else if (spoke.kind === "timeout") {
        this.refusedReleases = 0;
        const message = `the voice may not have been handed the thinking model's answer, and it is not tried again so it is never said twice: ${fateOf({ outcome: spoke })}`;
        this.failed({ last, message });
      }
    } finally {
      this.releasing = false;
      if (judgedAgain) {
        void this.release({ untaken, why });
      } else {
        if (!mayHaveSpoken) {
          untaken?.();
        }
        this.armLook();
      }
    }
  }
}
