/**
 * The console voice's typed twin: the same delegated Codex thread a call hands its questions to, driven by what the owner
 * types into the orb messenger instead of by a voice.
 *
 * The voice may tell the owner to "copy the link and paste it here", so there must be a here, and the owner may want
 * to do by text much of what the call does, for a day they lose their voice. So the messenger's box opens one of
 * these: `talk offer --typed` composes it exactly as it composes a call (same thread, tools, writers, model and
 * pack), and each message the owner sends is one `turn/start` on that thread.
 *
 * MEASURED on codex-cli 0.157.1 with the owner's plan login — why this is not a realtime session in text mode:
 * `thread/realtime/start` with `outputModality: "text"` answers "text realtime output modality requires realtime
 * v2", and audio over `transport: { type: "websocket" }` answers "realtime conversation requires API key auth". With
 * no realtime at all, `turn/start { threadId, input: [{ type: "text", text }] }` answers: a first
 * `item/agentMessage/delta` 6.1s after the send, and a pasted Slack message link reached `slack_thread_after` 3.1s in
 * and was read back whole 26.7s in. Repro: the offer's own `thread` params into `thread/start`, then one `turn/start`.
 *
 * Everything that is not the medium is {@link PlanCall}'s: the tool tokens, claim and answer, the event ring a
 * reloaded page replays, the absent-stream grace, the 90-minute ceiling and the kill on stop. What changes:
 *
 * - no `thread/realtime/start`, so nothing is spoken: what the thread writes reaches the page as `written` events;
 * - one message at a time — a send while a reply is still being written is refused, never steered into it;
 * - a send is keyed by the page's own id, so a retry of one whose answer was lost never starts a second turn;
 * - nudge, a look, the spoken "on it" and the progress cue are a voice's, and refused here — the last two because
 *   `surface` answers `typed` (`./talkPlanHandOffSpeech.ts` speaks and signals only on a voice);
 * - a running-list notice ({@link TypedPlanSession.notifyRunningListChanged}) is never written to the thread when it
 *   arrives: it is held and rides the owner's NEXT message as its own text item ahead of their words, because a typed thread
 *   starts a turn only on their send and has no realtime session to take a developer message.
 *
 * Rule 2: the child is the same visible-page child a call is — started on the owner's press, killed when the page stops it,
 * when its event stream is gone past the grace, at the ceiling, or with the server.
 */
import {
  PLAN_CALL_LIMITS,
  type PlanFrameOutcome,
  type PlanLookOutcome,
  type PlanNudgeOutcome,
  type PlanResumeOutcome,
  type PlanTypedInOutcome,
} from "./planCallContract";
import { TYPED_UNSURE_HOLD_MS } from "./talkArbiter";
import { PlanCall } from "./talkPlanCall";
import { RUNNING_LIST_CHANGED_TEXT } from "./talkPlanListNotice";
import { fateOf, type PlanComposition } from "./talkPlanProtocol";
import { agentMessageOf, codexTurnOf, startedTurnIdOf } from "./talkPlanProtocolTurns";

/**
 * How often a message still being written reaches the page, at most: often enough to read as streaming, rarely
 * enough that a long answer's hundreds of deltas never crowd the replay ring.
 */
export const WRITTEN_EVERY_MS = 150;

/** Why a send waits for the reply before it. */
export const STILL_REPLYING = "the answer to your last message is still being written; send this once it lands";

/** How opening a typed conversation ended. Any outcome but `open` has already stopped it. */
export type TypedOpenOutcome =
  { readonly kind: "open"; readonly threadId: string } | { readonly kind: "refused"; readonly reason: string };

/**
 * How one message landed: `accepted` with the turn it started; `refused` with nothing started; `ambiguous` when
 * the thread may have started it — no answer came in time — so the page says so rather than sending it again.
 */
export type TypedSayOutcome =
  | { readonly kind: "accepted"; readonly turnId: string }
  | { readonly kind: "refused"; readonly reason: string }
  | { readonly kind: "ambiguous"; readonly reason: string };

/** A message being written: its text so far and when it last reached the page. */
interface Writing {
  readonly turnId: string;
  readonly text: string;
  readonly sentMs: number | undefined;
}

/** A typed conversation on the owner's plan. */
export class TypedPlanSession extends PlanCall {
  /** Every send by the page's id, kept so a retried one answers with the first's outcome. */
  private readonly said = new Map<string, Promise<TypedSayOutcome>>();
  /** A `turn/start` is out and unanswered. */
  private sending = false;
  /** Turns this thread has completed, so one accepted after its own completion arrived is never held as running. */
  private readonly completedTurns = new Set<string>();
  /** Each message being written, by item id. */
  private readonly writing = new Map<string, Writing>();
  /** Messages already sent whole, so a repeated completion or a late delta never writes one twice. */
  private readonly finished = new Set<string>();
  /** When a send's fate went unknown, until the thread next says anything about a turn that may be its. */
  private unsureSinceMs: number | undefined = undefined;
  /** How many notices of a turn not already ended the thread has sent, so a send can tell one arrived while it was out. */
  private turnNotices = 0;
  /** The turn the last of those notices named. */
  private announcedTurn: string | undefined = undefined;
  /** The turns announced while the send now out, or the last one, was out. */
  private heardDuringSend = new Set<string>();
  /** Whether a send of unknown fate has had no notice since of a turn that may be its own. */
  private unsureUnheard = false;
  /** The turns announced while that unsure send was out: an earlier send's, maybe, so never news of it. */
  private unsureNotIts: ReadonlySet<string> = new Set();
  /** The owner put something on their running list since the last turn started: their next message carries the notice. */
  private listChanged = false;

  /**
   * A typed conversation is on the typed surface.
   *
   * @returns `typed`
   */
  override get surface(): "voice" | "typed" {
    return "typed";
  }

  /**
   * Whether a message is being sent or answered now.
   *
   * @returns whether a send is out, a Codex turn of this thread is running, or a send of unknown fate may have
   *   started one the thread has not announced yet
   */
  get replying(): boolean {
    const unsure = this.unsureSinceMs !== undefined && this.clock.nowMs() - this.unsureSinceMs < TYPED_UNSURE_HOLD_MS;
    return this.sending || unsure || this.runningTurns.size > 0;
  }

  /**
   * Initialize, require a ChatGPT login and start the thread — everything a call does before its realtime start.
   * Any outcome but `open` has already stopped the conversation.
   *
   * @param composition what `talk offer --typed` printed
   * @returns the thread, or why there is none
   */
  async openTyped({ composition }: { composition: PlanComposition }): Promise<TypedOpenOutcome> {
    try {
      const prepared = await this.prepareThread({ composition });
      if (typeof prepared === "object") {
        this.stop({ reason: prepared.reason });
        return prepared;
      }
      this.threadId = prepared;
      this.armAbsent();
      return { kind: "open", threadId: prepared };
    } catch (error) {
      const reason = `opening the typed conversation threw (${error instanceof Error ? error.message : String(error)})`;
      this.stop({ reason });
      return { kind: "refused", reason };
    }
  }

  /**
   * Send one message the owner typed: one `turn/start`. The same `messageId` again answers with the first send's outcome
   * and starts nothing.
   *
   * @param messageId the page's own id for this message
   * @param text what the owner typed, already bounded by the route
   * @returns how it landed
   */
  async say({ messageId, text }: { messageId: string; text: string }): Promise<TypedSayOutcome> {
    const earlier = this.said.get(messageId);
    if (earlier !== undefined) {
      return earlier;
    }
    const refusal = this.sayRefusal({ text });
    if (refusal !== undefined) {
      return { kind: "refused", reason: refusal };
    }
    // Recorded before the first await, so a retry arriving while this one is out answers with it.
    const outcome = this.startTurn({ text });
    this.said.set(messageId, outcome);
    return outcome;
  }

  /**
   * Why a send cannot go now, or `undefined` when it can.
   *
   * @param text what the owner typed
   * @returns the reason, in a sentence the page shows
   */
  private sayRefusal({ text }: { text: string }): string | undefined {
    if (this.ended) {
      return `the typed conversation has ended: ${String(this.endedReason)}`;
    }
    if (this.threadId === undefined) {
      return "the typed conversation has not opened yet";
    }
    if (text.trim() === "") {
      return "there is nothing to send";
    }
    if (this.replying) {
      return STILL_REPLYING;
    }
    return undefined;
  }

  /**
   * Start the turn and read its answer.
   *
   * @param text what the owner typed
   * @returns how it landed
   */
  private async startTurn({ text }: { text: string }): Promise<TypedSayOutcome> {
    this.sending = true;
    const noticesBefore = this.turnNotices;
    const earlierUnsure = this.unsureUnheard;
    this.heardDuringSend = new Set();
    // Taken before the first await, so a notice arriving while this send is out waits for the next one.
    const carriesNotice = this.listChanged;
    this.listChanged = false;
    const input = [{ text, type: "text" }];
    if (carriesNotice) {
      input.unshift({ text: RUNNING_LIST_CHANGED_TEXT, type: "text" });
    }
    try {
      const started = await this.request({
        method: "turn/start",
        params: { input, threadId: this.threadId },
        timeoutMs: PLAN_CALL_LIMITS.handshakeStepMs,
      });
      let turnId = started.kind === "result" ? startedTurnIdOf({ result: started.result }) : undefined;
      const announced = this.turnNotices !== noticesBefore;
      // Only the thread's own error answer, with no turn announced meanwhile, says it did not take it: an end
      // mid-request may follow its taking it.
      if (started.kind === "error" && !announced) {
        // The thread took nothing, the notice included, so the next message carries it instead.
        if (carriesNotice) {
          this.listChanged = true;
        }
        return { kind: "refused", reason: `the thread did not take the message: ${fateOf({ outcome: started })}` };
      }
      // A turn the thread announced while this send was out is this send's, whatever the answer says: nothing else
      // starts a turn on a typed thread, which has no voice to nudge, resume or look — unless an earlier send of
      // unknown fate had not been heard of, when it may be that one's.
      if (turnId === undefined && announced && !earlierUnsure) {
        turnId = this.announcedTurn;
      }
      if (turnId === undefined) {
        // Held by the bounded guess until the thread announces a turn that may be its — never one it already
        // announced while this send was out, which may be an earlier send's.
        this.unsureUnheard = true;
        this.unsureNotIts = new Set(this.heardDuringSend);
        this.unsureSinceMs = this.clock.nowMs();
        return { kind: "ambiguous", reason: `the thread may have taken it: ${fateOf({ outcome: started })}` };
      }
      // Running from the moment it is accepted, so a second send waits for it even before `turn/started` arrives.
      if (!this.completedTurns.has(turnId)) {
        this.runningTurns.add(turnId);
      }
      return { kind: "accepted", turnId };
    } finally {
      this.sending = false;
    }
  }

  /**
   * Every notification a call reads, then what the thread is writing.
   *
   * @param method its method
   * @param params its params
   */
  protected override notification({ method, params }: { method: string; params: unknown }): void {
    const turnNotice = method === "turn/started" || method === "turn/completed";
    const notice = turnNotice ? codexTurnOf({ params }) : undefined;
    // A notice of a turn already ended, late or repeated, says nothing about the send out now.
    if (notice !== undefined && notice.threadId === this.threadId && !this.completedTurns.has(notice.turnId)) {
      // The thread has said where an unsure send's turn is: a running one is now held by `runningTurns`, not the guess.
      if (!this.unsureNotIts.has(notice.turnId)) {
        this.unsureSinceMs = undefined;
        this.unsureUnheard = false;
      }
      this.heardDuringSend.add(notice.turnId);
      this.turnNotices += 1;
      this.announcedTurn = notice.turnId;
      // A completion still in progress names a turn the thread took without saying it ended, so it stays running, as
      // the call itself reads it.
      if (method === "turn/completed" && notice.status !== "inProgress") {
        this.completedTurns.add(notice.turnId);
      } else {
        this.runningTurns.add(notice.turnId);
      }
    }
    super.notification({ method, params });
    this.written({ method, params });
  }

  /**
   * Forward a message the thread is writing: a delta at most every {@link WRITTEN_EVERY_MS}, on the telemetry ring
   * so it never crowds a tool call out of a replay, and the completed message always, whole, on the main ring.
   *
   * @param method the notification's method
   * @param params its params
   */
  private written({ method, params }: { method: string; params: unknown }): void {
    const piece = agentMessageOf({ method, params });
    if (piece === undefined || this.ended || piece.threadId !== this.threadId) {
      return;
    }
    const { itemId, turnId } = piece;
    if (this.finished.has(itemId)) {
      return;
    }
    if (piece.kind === "completed") {
      this.finished.add(itemId);
      this.writing.delete(itemId);
      this.emit({ event: { final: true, itemId, kind: "written", text: piece.text, turnId } });
      return;
    }
    const held = this.writing.get(itemId);
    let text = piece.delta;
    if (held !== undefined) {
      text = `${held.text}${piece.delta}`;
    }
    const nowMs = this.clock.nowMs();
    let sentMs = held?.sentMs;
    const due = sentMs === undefined || nowMs - sentMs >= WRITTEN_EVERY_MS;
    if (due) {
      sentMs = nowMs;
    }
    this.writing.set(itemId, { sentMs, text, turnId });
    if (due) {
      this.emit({ event: { final: false, itemId, kind: "written", text, turnId }, telemetry: true });
    }
  }

  /**
   * A rollover keeps a voice from being cut mid-sentence at the ceiling (`./callRollover.ts`); typed text has no
   * sentence to cut, so this conversation is never told to roll over, by its age or by its thread's context filling,
   * and meets the ceiling as it always did.
   */
  protected override armRollover(): void {
    return;
  }

  /**
   * A nudge makes a voice speak; a typed conversation has none, whoever pressed it.
   *
   * @returns the refusal
   */
  override async nudge(): Promise<PlanNudgeOutcome> {
    return { kind: "refused", reason: "a typed conversation has no voice to nudge" };
  }

  /**
   * A look is spoken and framed for a call; a typed conversation has neither.
   *
   * @returns the refusal
   */
  override async sayLooking(): Promise<PlanLookOutcome> {
    return { kind: "refused", reason: "a typed conversation has no voice to say it is looking" };
  }

  /**
   * A look frame rides a call's realtime turn; a typed conversation has none.
   *
   * @returns the refusal
   */
  override async attachLook(): Promise<PlanFrameOutcome> {
    return { kind: "refused", reason: "a typed conversation takes no look frame" };
  }

  /**
   * The owner put something on their running list: hold {@link RUNNING_LIST_CHANGED_TEXT} for their next message,
   * which carries it as a text item ahead of their own words. Never written now — a typed thread has no realtime
   * session to take a developer message, a `turn/start` of its own would be a turn the owner never asked for, and a
   * steer into the reply being written would bend an answer to a question asked about something else. So it is safe
   * while {@link replying}: nothing goes to the child until the owner's send, which waits for that reply anyway.
   * Several adds before the next message are one notice, since the thread reads the whole list.
   *
   * @returns `undefined` once it is held for the owner's next message, else why not
   */
  override async notifyRunningListChanged(): Promise<string | undefined> {
    if (this.ended) {
      return `the typed conversation has ended: ${String(this.endedReason)}`;
    }
    if (this.threadId === undefined) {
      return "the typed conversation has not opened yet";
    }
    this.listChanged = true;
    return undefined;
  }

  /**
   * A resume hands a voice its turn; a typed conversation has none, and a turn is started only by the owner's own send.
   *
   * @returns the refusal
   */
  override async resume(): Promise<PlanResumeOutcome> {
    return { kind: "refused", reason: "a typed conversation has no voice to take its turn" };
  }

  /**
   * The owner's words go into a typed conversation by {@link TypedPlanSession.say}, as a turn of their own; this is a call's.
   *
   * @returns the refusal
   */
  override async typeIn(): Promise<PlanTypedInOutcome> {
    return { kind: "refused", reason: "a typed conversation takes the owner's words by say, not into a live call" };
  }
}
