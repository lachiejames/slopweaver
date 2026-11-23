/**
 * The state of one plan call (`./talkPlanCall.ts`), and the constructor that wires its collaborators: every field of
 * the call lives here and nowhere else in its class chain. The methods sit in the layers above it — the wire and its
 * lifecycle (`./talkPlanCallWire.ts`), the thread's notifications and the rollover (`./talkPlanCallNotifications.ts`),
 * the tool relay (`./talkPlanCallTools.ts`) and the unasked writes (`PlanCall`, `./talkPlanCall.ts`).
 *
 * **No layer above declares a field.** `site/` compiles with `useDefineForClassFields`, so a field a derived class
 * declared — even one with no initializer — would be defined after this constructor ran and overwrite what it set.
 * The constructor's collaborators close over the methods the layers above implement, declared here as abstract hooks.
 */
import { CoverageHold } from "./coverageHold";
import type { MeetingLedger } from "./meetingLedger";
import { LIFETIME_REASON, PLAN_CALL_LIMITS, type PlanCallEvent, type PlanLookStartOutcome } from "./planCallContract";
import type { CallThreadTap } from "./talkCallThreadJournal";
import type { TalkNoticeLedger } from "./talkNoticeLedger";
import { type Herald, heraldOf } from "./talkPlanAnnounce";
import type { AppServerPort } from "./talkPlanCall";
import { CompletionCorrection } from "./talkPlanCompletionCorrection";
import { type PlanEmit, PlanEventRing } from "./talkPlanEventRing";
import { ackRefusal, ownWriteRefusal, type PlanFloor } from "./talkPlanFloor";
import { HandOffSpeech } from "./talkPlanHandOffSpeech";
import { HeldAnswers } from "./talkPlanHeldAnswers";
import { ListNotice } from "./talkPlanListNotice";
import type { CallTurnItems } from "./talkPlanModelWait";
import type { ScriptedLineOutcome, sayScriptedLine } from "./talkPlanNotices";
import { OnceLines } from "./talkPlanOnceLines";
import { OwedTurnStarts } from "./talkPlanOwedTurn";
import { LineBuffer, type RpcId, type RpcOutcome } from "./talkPlanProtocol";
import type { PlanToolCall } from "./talkPlanProtocolItems";
import { ReopenReminderWindow } from "./talkPlanReopenReminder";
import { PlanRolloverAsk } from "./talkPlanRolloverAsk";
import type { PlanCallClock } from "./talkPlanStart";
import { TurnOutcomes } from "./talkPlanTurnOutcome";
import type { TurnWaiter } from "./talkPlanTurns";
import { TypedInTurns } from "./talkPlanTypedIn";
import { WalkAskWatch } from "./talkPlanWalkWatch";
import { WindowNoticeLines } from "./talkPlanWindowNotices";
import { VoiceProvenanceLedger } from "./talkVoiceProvenance";

/** A tool call waiting on the page. */
interface PendingTool {
  readonly rpcId: RpcId;
  readonly call: PlanToolCall;
  readonly cancel: () => void;
  /** Whether the page has claimed it to run, so a replayed or late copy of its event is never run too. */
  readonly claimed: boolean;
  /**
   * The page that claimed it, by the id it minted, so only that page answers it: a failure a page sends after its
   * own claim was lost must never settle a call another page claimed in the meantime and is running. An id that
   * keeps the owner's own pages apart, never a credential: it lives only in the minting page's memory and this server's,
   * the same footing as the tool token, and whatever can read that memory can already post as the page.
   */
  readonly claimant: string | undefined;
}

/** A live plan call's state and wiring; `PlanCall` (`./talkPlanCall.ts`) is the class callers make. */
export abstract class PlanCallBase {
  readonly id: string;
  /** When this call was made, so a message the owner sent to the call before it is never handed to it (`liveVoiceCallOf`). */
  readonly madeMs: number;
  protected readonly port: AppServerPort;
  protected readonly clock: PlanCallClock;
  protected readonly mintToken: () => string;
  protected readonly lines = new LineBuffer();
  protected nextRpcId = 0;
  protected readonly waiting = new Map<RpcId, (outcome: RpcOutcome) => void>();
  protected readonly pending = new Map<string, PendingTool>();
  /** Every tool `callId` this call has taken, answered or not: a replay under a fresh RPC id is a stale call. */
  protected readonly takenCallIds = new Set<string>();
  protected readonly events = new PlanEventRing();
  /** The page's chime before one unasked line, then its lead (`./talkPlanAnnounce.ts`). */
  protected readonly ring: Herald;
  protected sdpWaiter: ((sdp: string | undefined) => void) | undefined;
  protected threadId: string | undefined;
  /** The thread's Codex turns that have started and not completed. */
  protected readonly runningTurns = new Set<string>();
  /** Every message of a voice call's thread already forwarded whole, so a repeated completion is sent once. */
  protected readonly completedItems = new Set<string>();
  /** When each running turn's progress last reached the page, so a stream of deltas is throttled. */
  protected readonly progressSentMs = new Map<string, number>();
  /** Each running turn's items in flight and its open wait on the model (`./talkPlanModelWait.ts`). */
  protected readonly turnItems: CallTurnItems = new Map();
  protected lastTurnEndedMs: number | undefined;
  /** When each running Codex turn's `turn/started` was read, so a resume can tell words none heard (`./talkPlanResumeOverTurn.ts`). */
  protected readonly turnStartedMs = new Map<string, number>();
  /**
   * When the owner's last spoken transcript carrying words arrived, as the page's `lastTranscribedMs` reads it: a blank fragment
   * is no words and a typed line no speech, so neither makes a turn read earlier (`./talkPlanResumeOverTurn.ts`).
   */
  protected lastHeardWordsMs: number | undefined;
  /**
   * How many distinct Codex turns this call has read the end of, in notification order, which an instant cannot give at
   * a tie. A replayed completion is not counted again, so it never reads as a hand-off answering the owner's next-card ask.
   */
  protected turnsEnded = 0;
  protected lastNudgeMs: number | undefined;
  protected nudging = false;
  protected lastResumeMs: number | undefined;
  /** A resume's request is unanswered. */
  protected resuming = false;
  /** A send outcome's and a triage card's time-up line, each said once (`./talkPlanOnceLines.ts`). */
  protected readonly onceLines: OnceLines;
  /** A meeting notice's request is unanswered. */
  protected announcingMeeting = false;
  /** The owner's turns typed into the call (`PlanCall.typeIn`). */
  protected readonly typedIn: TypedInTurns;
  /** The Codex turn a resume or nudge owed, started here when the voice hands nothing over (`./talkPlanOwedTurn.ts`). */
  protected readonly owedTurns: OwedTurnStarts;
  /** The owner's utterances, watched for a next-card ask no turn started during (`./talkPlanWalkWatch.ts`). */
  protected readonly walkAsks = new WalkAskWatch();
  /** The turns a spoken record is being steered into now, each until answered, so one turn never takes two at once. */
  protected readonly recording = new Map<string, Promise<void>>();
  /** Whether this call's own provenance offer found no turn to take it (`offerProvenance`). */
  protected readonly offer = { owed: false };
  /** The running-list notice, owed and retried while the floor holds it (`./talkPlanListNotice.ts`). */
  protected readonly listNotice: ListNotice;
  /** The voice's correction of a done claim nothing grounds or a fleet promise, owed by the claim-grounding route (`./talkPlanCompletionCorrection.ts`). */
  readonly corrections: CompletionCorrection;
  /** The line a turn the voice said it was on owes when it ends with nothing said, or fails (`./talkPlanTurnOutcome.ts`). */
  protected readonly turnOutcomes: TurnOutcomes;
  /** Every meeting the voice was told to say on any call of this server, so none is said twice across a rollover. */
  protected readonly meetings: MeetingLedger;
  /** The drift line and the ISO nudge, which the page's front-window sampler owes (`./talkPlanWindowNotices.ts`). */
  readonly windowNotices: WindowNoticeLines;
  /** Every line the console put in the voice's mouth and why, and every ungrounded claim the page found. */
  protected readonly provenance = new VoiceProvenanceLedger();
  /** The acknowledgement line and progress cues while a hand-off of the owner's words runs. */
  protected readonly handOff: HandOffSpeech;
  /** The thinking model's messages, held off the voice until the owner finishes (`./talkPlanHeldAnswers.ts`). */
  protected readonly heldAnswers: HeldAnswers;
  /** The reads standing cut since the owner last spoke, which hold back an answer claiming the whole (`./coverageHold.ts`). */
  protected readonly coverage = new CoverageHold();
  /** When the realtime session last transcribed the voice — anything not the owner's. */
  protected lastVoiceTranscribedMs: number | undefined;
  /** When the realtime session last transcribed the owner or the voice, which says the floor is taken. */
  protected lastTranscribedMs: number | undefined;
  /**
   * When the realtime session last transcribed the owner alone. A second resume needs the owner's words after the
   * first, so one silence is never resumed twice however long it runs.
   */
  protected lastHeardTranscribedMs: number | undefined;
  /** How many "having a look" lines this call has spoken, which picks the next one's wording. */
  protected lookSaid = 0;
  protected lastLookMs: number | undefined;
  /** When the session last took one of this server's own lines, spoken or handed, which the voice says seconds later. */
  protected lastOwnLineMs: number | undefined;
  /** How many of its own writes this call has made, which keys each one's provenance entry. */
  protected writes = 0;
  /** A "having a look" line's request is unanswered. */
  protected looking = false;
  /** Frames waiting for the next Codex turn to start, each told its id — or `undefined` when the call ends. */
  protected readonly turnWaiters = new Set<TurnWaiter>();
  /** The `turn/start` a look frame wrote and is still waiting on, which a second frame steers into rather than repeat. */
  protected readonly lookStart: { pending: Promise<PlanLookStartOutcome> | undefined } = { pending: undefined };
  protected endedReason: string | undefined;
  protected cancelAbsent: (() => void) | undefined;
  protected readonly cancelLifetime: () => void;
  /** When the page is told to roll this call over (`./talkPlanRolloverAsk.ts`). */
  protected readonly rolloverAsk: PlanRolloverAsk;
  /** The realtime start answered open: before it, no unasked line is the voice's to say. */
  protected realtimeOpen = false;
  protected readonly onEnded: (input: { readonly id: string }) => void;
  /** The thread's journal: its start, its turn frames and completed items, and every tool answer handed it. */
  protected readonly journal: CallThreadTap;
  /** A reopened call's opening window: the owner's words first, the reminder after their silence (`./talkPlanReopenReminder.ts`). */
  readonly reopenReminder: ReopenReminderWindow;

  /**
   * A call whose child is already running; `open` runs the handshake.
   *
   * @param id this call's opaque id
   * @param port the child
   * @param clock time
   * @param meetings the meetings already said, shared by every call of this server
   * @param notices the drift lines and ISO nudges already said, shared the same way
   * @param mintToken mints the unguessable part of each tool call's token; the call makes it unique
   * @param onEnded told once, when the call ends, so a registry can forget it
   * @param journal records the thread (`./talkCallThreadJournal.ts`), never in the call's way
   */
  constructor({
    id,
    port,
    clock,
    meetings,
    notices,
    mintToken,
    onEnded,
    journal,
  }: {
    id: string;
    port: AppServerPort;
    clock: PlanCallClock;
    meetings: MeetingLedger;
    notices: TalkNoticeLedger;
    mintToken: () => string;
    onEnded: (input: { readonly id: string }) => void;
    journal: CallThreadTap;
  }) {
    this.id = id;
    this.journal = journal;
    this.port = port;
    this.clock = clock;
    this.ring = heraldOf({ clock, events: this.events });
    this.madeMs = clock.nowMs();
    this.meetings = meetings;
    this.windowNotices = new WindowNoticeLines({
      floor: () => this.floor(),
      notices,
      nowMs: () => this.clock.nowMs(),
      sayLine: (l) => this.sayLine(l),
    });
    this.mintToken = mintToken;
    this.onEnded = onEnded;
    this.handOff = new HandOffSpeech({
      call: {
        acknowledgementTaken: (input) => {
          this.turnOutcomes.acknowledgementTaken(input);
        },
        ackRefusal: () => ackRefusal({ floor: this.floor() }),
        emit: ({ event }) => {
          this.emit({ event, telemetry: true });
        },
        runningTurns: this.runningTurns,
        speak: (input) => this.speak(input),
        speaks: () => !this.ended && this.realtimeOpen && this.surface === "voice",
        transcribed: () => ({ heardAt: this.lastHeardTranscribedMs, voiceAt: this.lastVoiceTranscribedMs }),
      },
      clock,
    });
    this.heldAnswers = new HeldAnswers({
      call: {
        blocked: () =>
          this.realtimeOpen ? ownWriteRefusal({ floor: this.floor() }) : "the realtime session is not open",
        emit: ({ event }) => {
          this.emit({ event, telemetry: true });
        },
        handed: (input) => {
          this.turnOutcomes.handed(input);
        },
        // Not provenance: the words are the thinking thread's own, and the one console line after a landed offer is
        // one its own prompt says the console adds (`COPY_OFFER_BACKEND_LINES`).
        speak: ({ text }) =>
          this.request({
            method: "thread/realtime/appendSpeech",
            params: { text, threadId: this.threadId! },
            timeoutMs: PLAN_CALL_LIMITS.nudgeStepMs,
          }),
        runningTurns: () => this.runningTurns,
        transcribed: () => ({ heardAt: this.lastHeardTranscribedMs, voiceAt: this.lastVoiceTranscribedMs }),
        voiced: () => {
          this.handOff.restartProgress();
        },
      },
      clock,
    });
    this.owedTurns = new OwedTurnStarts({
      call: {
        clock,
        emit: (input) => {
          this.emit(input);
        },
        hand: (input) => this.handDeveloperOutcome(input),
        request: (input) => this.request(input),
        state: () => ({
          endedReason: this.endedReason,
          running: this.runningTurns.size,
          threadId: this.threadId,
          turnsEnded: this.turnsEnded,
        }),
        waiters: this.turnWaiters,
      },
    });
    this.onceLines = new OnceLines({
      floor: () => this.floor(),
      hand: (input) => this.handDeveloperText(input),
      owe: ({ text }) => this.owedTurns.handing({ text, why: "triage" }),
      ring: this.ring,
    });
    this.typedIn = new TypedInTurns({
      call: {
        append: ({ text }) => {
          const params = { role: "user", text, threadId: this.threadId! };
          return this.request({
            method: "thread/realtime/appendText",
            params,
            timeoutMs: PLAN_CALL_LIMITS.nudgeStepMs,
          });
        },
        clock,
        failed: ({ message }) => {
          this.emit({ event: { kind: "error", message } });
        },
        kick: (input) => this.handDeveloperText(input),
        moved: () => ({
          ended: this.ended,
          runningTurns: this.runningTurns.size,
          turnEndedAtMs: this.lastTurnEndedMs,
        }),
        // Only the owner's own message still being written holds their next; an earlier one's kick window never does.
        refusal: ({ writing }) => ownWriteRefusal({ floor: { ...this.floor(), typingIn: writing } }),
        taken: ({ messageId, text, takenMs }) => {
          this.lastTranscribedMs = takenMs;
          this.lastHeardTranscribedMs = takenMs;
          this.emit({ event: { kind: "typed-in", messageId, text } });
        },
      },
    });
    const owner = { ended: () => this.ended, floor: () => this.floor(), noticing: () => this.listNotice.busy };
    this.listNotice = new ListNotice({ call: { ...owner, hand: (input) => this.handDeveloperText(input) }, clock });
    this.corrections = new CompletionCorrection({ call: { ...owner, speak: (input) => this.speak(input) }, clock });
    const telemetry = (input: { event: PlanCallEvent }): void => {
      this.emit({ ...input, telemetry: true });
    };
    const outcomeCall = { ...owner, correctionOwed: () => this.corrections.owes, emit: telemetry };
    this.turnOutcomes = new TurnOutcomes({ call: { ...outcomeCall, speak: (s) => this.speak(s) }, clock });
    this.reopenReminder = new ReopenReminderWindow({
      call: { clock, emit: telemetry, ended: owner.ended, hand: (input) => this.handDeveloperOutcome(input) },
    });
    this.cancelLifetime = clock.after({
      ms: PLAN_CALL_LIMITS.lifetimeMs,
      run: () => {
        this.stop({ reason: LIFETIME_REASON });
      },
    });
    const askCall = {
      ...owner,
      emit: (input: PlanEmit): void => {
        this.emit(input);
      },
    };
    // `surface` is a prototype getter, so a typed conversation's own answer is read here, before its constructor runs.
    this.rolloverAsk = new PlanRolloverAsk({ call: askCall, clock, staged: this.surface === "voice" });
    this.armRollover({ ms: PLAN_CALL_LIMITS.rolloverFromMs });
  }

  /**
   * Whether the call has ended.
   *
   * @returns `true` once any stop, exit or close has happened
   */
  get ended(): boolean {
    return this.endedReason !== undefined;
  }

  /**
   * Which surface this conversation runs on, which the registry reads to keep one conversation per console.
   *
   * @returns `voice` for a call; the typed conversation (`./talkTypedSession.ts`) answers `typed`
   */
  get surface(): "voice" | "typed" {
    return "voice";
  }

  /**
   * End the call (`./talkPlanCallWire.ts`): tell the child to stop realtime, kill it, settle everything waiting, and
   * emit `closed` once.
   *
   * @param input why, in a sentence the page shows
   */
  abstract stop(input: { reason: string }): void;

  /** Look at the floor for a rollover after `ms`, once (`./talkPlanCallNotifications.ts`). */
  protected abstract armRollover(input: { ms: number }): void;

  /** Record one event and tell every listener (`./talkPlanCallWire.ts`). */
  protected abstract emit(input: PlanEmit): void;

  /** This call's state now, as the floor checks read it (`./talkPlanCallNotifications.ts`). */
  protected abstract floor(): PlanFloor;

  /** Send one request and wait for its answer, a deadline, or the call ending (`./talkPlanCallWire.ts`). */
  protected abstract request(input: { method: string; params: unknown; timeoutMs: number }): Promise<RpcOutcome>;

  /** One once-only fixed sentence (`./talkPlanCall.ts`). */
  protected abstract sayLine(
    line: Omit<Parameters<typeof sayScriptedLine>[0], "speak" | "onSaid" | "ring">,
  ): Promise<ScriptedLineOutcome>;

  /** Have the voice speak one fixed sentence, kept as provenance (`./talkPlanCall.ts`). */
  protected abstract speak(input: { text: string; why: string }): Promise<RpcOutcome>;

  /** Hand the voice a developer message, answering its fate in words (`./talkPlanCall.ts`). */
  protected abstract handDeveloperText(input: { text: string; why: string }): Promise<string | undefined>;

  /** Hand the voice a developer message, answering the request's outcome (`./talkPlanCall.ts`). */
  protected abstract handDeveloperOutcome(input: { text: string; why: string }): Promise<RpcOutcome>;
}
