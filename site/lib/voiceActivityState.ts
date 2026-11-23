/**
 * What the console voice's activity fold carries between events — its state, its starting point, its thresholds and
 * the inputs it reads — split out of `./voiceActivity.ts`, which folds them.
 */

import type { Bag } from "./bag";
import type { WorkStep } from "./responsesStep";
import type { VoiceFinal, VoicePromise } from "./voiceOwed";
import { NO_OWNER_TURNS, type OwnerTurnEvent, type OwnerTurns, STREAM_SKEW_MS } from "./voiceOwnerTurns";
import { NO_PLAN_WORK, type PlanWork, type PlanWorkEvent } from "./voicePlanWork";
import { NO_RESUME, type ResumeFields } from "./voiceResumeFold";
import { NO_TURN_ORDER, type TurnOrder } from "./voiceTurnOrder";
import type { SoundSample, TurnTaking } from "./voiceTurnTaking";
import { NO_TURN_TAKING } from "./voiceTurnTaking";

/** One delegated turn the backend is working on. */
export interface Delegation {
  readonly id: string;
  readonly sinceMs: number;
  /** The last event naming THIS delegation — never another's, never a transcript. */
  readonly lastProgressMs: number;
  readonly step: WorkStep;
  /** The Responses response ids bound to it, so an event naming only its response still finds it. */
  readonly responseIds: readonly string[];
  /** The responses that asked for a tool, so one of THEM completing does not end the turn. */
  readonly askedBy: readonly string[];
  /** A tool ask seen before any response id was, owned by the first response the delegation then names. */
  readonly unboundAsk: boolean;
  /**
   * The response an ask held before ANY id was given to, by guess. The delegation's opening names its first response,
   * so a late opening takes that ask over: an ask older than every response the fold had seen is the first one's.
   */
  readonly guessedAsk: string | undefined;
  /** The responses that completed while it stayed open for their tool ask, so a moved ask can end the turn late. */
  readonly closedBy: readonly string[];
}

/** One client tool call the page is running. */
export interface PendingTool {
  readonly name: string;
  readonly sinceMs: number;
}

/** A delegation that closed, and the responses it had, so their late events are known for history. */
export interface EndedDelegation {
  readonly id: string;
  readonly responseIds: readonly string[];
}

/** Everything the fold carries between events; its resumes are `./voiceResumeFold.ts`'s. */
export interface VoiceActivity extends ResumeFields {
  readonly delegations: ReadonlyMap<string, Delegation>;
  /**
   * Every delegation this call has closed, so no late event brings one back. Uncapped on purpose: an evicted record
   * is exactly the late event that resurrects a finished turn, a call's turns number in the tens, and `closed`
   * resets the whole fold.
   */
  readonly ended: readonly EndedDelegation[];
  /**
   * Each ended delegation's state as it closed, so a turn whose closing response proves to be another's — an event
   * later names it with a different delegation — reopens as it stood rather than staying wrongly ended.
   */
  readonly endedState: ReadonlyMap<string, Delegation>;
  readonly tools: ReadonlyMap<string, PendingTool>;
  /**
   * When the page asked the backend to continue after a tool answer, one entry per ask no response has answered yet,
   * oldest first: two tools answered from one response are two asks, and the first continuation answers only one.
   */
  readonly continuations: readonly number[];
  /**
   * Backend work no turn can claim yet — an event naming neither a delegation nor a response while none is open,
   * its opening still in flight. Shown as its own row until anything names a turn, so it never reads as listening.
   */
  readonly stray: { readonly step: WorkStep; readonly sinceMs: number; readonly lastMs: number } | undefined;
  /** When the owner's last transcribed words arrived. */
  readonly lastHeardMs: number | undefined;
  /**
   * When the owner's last words transcribed off the microphone arrived: {@link VoiceActivity.lastHeardMs} less a typed
   * turn (no audio) and a blank or text-less fragment (no words), so a microphone sample after the latest speech is still
   * seen ahead of it.
   */
  readonly lastTranscribedMs: number | undefined;
  /** When the voice's last spoken transcript fragment arrived. */
  readonly lastSpokeMs: number | undefined;
  /** The owner's turns, open and awaiting the voice's words: unlike {@link VoiceActivity.lastHeardMs}, whether they ENDED. */
  readonly owner: OwnerTurns;
  /** Whether a turn of the owner's opened after the voice's newest turn did, on the ordered turn stream (`./voiceTurnOrder.ts`). */
  readonly order: TurnOrder;
  /**
   * When the voice's words last arrived while the owner's latest turn opened after its newest one, unpaid: a `spoke` carries no
   * turn ID, so it is a late fragment of that turn unless a new voice turn is first seen after it, which it then answers.
   */
  readonly unattributedSpokeMs: number | undefined;
  /**
   * The answer stamp and final the voice gave after the owner's latest words, set aside while those words sit in a turn
   * opened after its newest one: kept, not dropped, so a late segment of an older turn of the owner's — which makes that
   * older turn the owner's latest again — or a new voice turn first seen puts them back.
   */
  readonly retractedAnswer:
    { readonly answeredMs: number | undefined; readonly final: VoiceFinal | undefined } | undefined;
  /** When the voice last did ANYTHING of its own — spoke, delegated, or moved a backend turn. */
  readonly lastAnsweredMs: number | undefined;
  /** Every tool call this call has answered, so a late item carrying one is history, never a fresh ask. */
  readonly answeredCalls: readonly string[];
  /**
   * Each function-call item's id to its `call_id`, learned from the item events: an arguments event names only the
   * item, so this is how a late one for an answered call is known to be history.
   */
  readonly callItems: ReadonlyMap<string, string>;
  /**
   * Each response's place in the order responses were first named — a count, not a clock, since two events can share
   * a millisecond — so two records of one turn merge with their responses in the order they began.
   */
  readonly responseOrder: ReadonlyMap<string, number>;
  /** The last error the session or a backend turn reported, until anything moves again — the owner's words not before {@link ERROR_SHOWN_MS}. */
  readonly error: { readonly message: string; readonly atMs: number } | undefined;
  /** A plan call's hand-offs to Codex and the Codex turns they became (`voicePlanWork.ts`). */
  readonly plan: PlanWork;
  /** The `lastHeardMs` a nudge was sent for, so one silence is nudged once. */
  readonly nudgedHeardMs: number | undefined;
  /** When a nudge was last sent, so a rollover holds while the voice it woke may not be audible yet (`./callRollover.ts`). */
  readonly nudgedAtMs: number | undefined;
  /** The `lastHeardMs` the page pressed the nudge itself for, over a promise that started nothing (`promiseDueOf`). */
  readonly promisedHeardMs: number | undefined;
  /** The end of the owner's words as heard, newest last — what {@link resumeDueOf} reads for a wait (`./waitAsk.ts`). */
  readonly heardTail: string;
  /** Whether the owner's last words, as heard, end on a wait or a trailing filler (`./waitAsk.ts`): the turn after them is the owner's. */
  readonly heardWaits: boolean;
  /** The voice's last finished turn; one after the owner's words that asked nothing leaves the next turn its own (`./voiceOwed.ts`). */
  readonly lastVoiceFinal: VoiceFinal | undefined;
  /**
   * Whether the voice's words have arrived since its last final, in the order the fold met them: an answer it has not
   * finished (`./callRolloverFloor.ts`). An order, not two clocks compared, since a final and the next answer's first
   * words can share a millisecond.
   */
  readonly voiceAnswerOpen: boolean;
  /** Who is making sound, and whether the voice just stopped for the owner (`voiceTurnTaking.ts`). */
  readonly turn: TurnTaking;
}

/** The fold's starting point, and what a call resets to. */
export const NO_ACTIVITY: VoiceActivity = {
  answeredCalls: [],
  callItems: new Map(),
  continuations: [],
  delegations: new Map(),
  ended: [],
  endedState: new Map(),
  error: undefined,
  heardTail: "",
  heardWaits: false,
  lastAnsweredMs: undefined,
  lastHeardMs: undefined,
  lastSpokeMs: undefined,
  lastTranscribedMs: undefined,
  lastVoiceFinal: undefined,
  nudgedAtMs: undefined,
  nudgedHeardMs: undefined,
  order: NO_TURN_ORDER,
  owner: NO_OWNER_TURNS,
  plan: NO_PLAN_WORK,
  unattributedSpokeMs: undefined,
  promisedHeardMs: undefined,
  retractedAnswer: undefined,
  responseOrder: new Map(),
  ...NO_RESUME,
  stray: undefined,
  tools: new Map(),
  turn: NO_TURN_TAKING,
  voiceAnswerOpen: false,
};

/** Ordinary work with no event of its own for this long is stalled. The owner's measured `high` reasoning turn: 24s. */
export const STALL_MS = 35_000;

/**
 * A Codex turn compacting its thread's context sends nothing until the compaction ends, so it is stalled only after
 * this long. MEASURED silences of 61s and 118s (`PLAN_CALL_LIMITS.rolloverContextUrgentShare`, `./planCallContract.ts`)
 * and 91s on a voice call, where the orb drew a stall and the owner read the voice as asleep (repro: `grep -o
 * '"atIso":"[^"]*","contextWindow":[0-9]*,"kind":"usage","last":{"inputTokens":[0-9]*'
 * $SLOPWEAVER_HOME/talk/calls/*.jsonl`). 180s is a judgement past the longest: finite, so a compaction that
 * really hangs still stalls and offers the nudge.
 */
export const COMPACTION_STALL_MS = 180_000;

/** Silence after the owner's last fragment, with nothing from the voice, for this long reads as still waiting. */
export const UNANSWERED_MS = 12_000;

/** After this long, a silence is the owner's as much as the voice's, and the orb goes back to listening. */
export const UNANSWERED_FORGET_MS = 90_000;

/**
 * Silence after the owner's last fragment, with nothing from the voice, for this long has the page resume
 * ({@link resumeDueOf}): the voice acknowledges the owner while the console starts the thinking model's turn — before
 * {@link UNANSWERED_MS} shows "still waiting", so ZZZ keeps meaning nothing is coming. Measured on two calls:
 * the four steers met with silence went 17–104s unanswered; on a live session a resume closed the owner's open turn
 * within 0.8s.
 *
 * Five seconds, not the ten it was. Measured: the owner said they kept finishing answering and the voice kept doing
 * nothing, and asked that it respond once they finish talking without them saying anything else
 * (`jq -r 'select(.kind=="segment" and .who!="voice" and .final and (.text|test("keep just doing nothing"))) |
 * .atIso[0:19] + "Z " + .text' $SLOPWEAVER_HOME/talk/calls/<call-id>-*.jsonl`), and later, 11s after their words
 * and 4s after a resume, said they had stopped talking. Ten seconds of quiet is what the owner hears as no answer;
 * five still leaves room for an ordinary pause to think, and is a judgement. Repro, printing each instant, both gaps and the owner's words, over the window from
 * the owner's words to their next line: `jq -rn 'def t: .[0:19]+"Z"|fromdate; [inputs|select(.name=="resume" or
 * (.kind=="segment" and .who!=null and .who!="voice"))|select(.atIso>="<window-start>" and .atIso<"<window-end>")]
 * | (.[0].atIso|t) as $s | ([.[]|select(.name=="resume")][0].atIso|t) as $r | .[] | "\(.atIso[0:19])Z
 * +\((.atIso|t)-$s)s after the owner's words, \((.atIso|t)-$r)s after the resume: \(.kind) \((.text // "")[-40:])"'
 * $SLOPWEAVER_HOME/talk/calls/<call-id>-*.jsonl`.
 *
 * A resume the session accepts is not one the voice answers: in one span none of seven was answered before the owner
 * spoke again, against 41 of 44 within two seconds in an earlier one, on the same session and the same request — that
 * half is the session's, not this page's. Answered means the owner's open words finalised within 2s with nothing
 * added; repro, printing both tallies:
 * `jq -rn 'def t: .[0:19]+"Z"|fromdate; [inputs|.f=input_filename] | group_by(.f) | [.[] | sort_by(.atIso) as $e
 * | range(0;$e|length) as $i | $e[$i] | select(.name=="resume" and .atIso>="<span-start>" and .atIso<"<span-end>")
 * | ([$e[:$i][]|select(.who!=null and .who!="voice")]|last) as $p | ([$e[$i+1:][]|select(.who!=null and .who!="voice")]|first) as $n
 * | {at: .atIso[0:16], late: (.atIso>="<later-span-start>"), ok: ($n.final==true and ($n.text|length)==($p.text|length)
 * and ($n.atIso|t)-(.atIso|t)<=2)}] | sort_by(.at) | group_by(.late)[] | "\(.[0].at)Z to \(.[-1].at)Z: answered
 * \(map(select(.ok))|length) of \(length)"' $SLOPWEAVER_HOME/talk/calls/*.jsonl`, which prints each span's first and
 * last resume beside its tally.
 */
export const RESUME_MS = 5_000;

/**
 * How long after any sound from the owner's microphone, transcribed or not, a resume still waits — the margin the
 * owner's audio runs ahead of its transcript (0.7s, measured live), the same 2s as the server's own `resumeQuietMs`.
 * A judgement over that one measurement. Were it the whole {@link RESUME_MS}, a stray sound would restart the full
 * quiet and "still waiting" could show with no resume ever posted — measured: "still waiting" 12s after the owner's
 * words with no `resume` line in the call file before their nudge (every resume post leaves one), and the next resume
 * 10.1s after their words. Mic levels are not logged, so which meter held a resume is not provable from the file; this is the only
 * gate "still waiting" does not share that a stray sound could hold for the whole quiet. It is also the whole quiet
 * after words ending on "over", which is why it must equal the server's `resumeQuietMs`.
 */
export const RESUME_SOUND_QUIET_MS = 2_000;

/** How much of the owner's words the fold keeps for {@link resumeDueOf}'s wait check: more than its 60-character read. */
export const HEARD_TAIL_CHARS = 200;

/** A failure's reason stays at least this long, so the owner's next words cannot erase it before it could be read. */
export const ERROR_SHOWN_MS = 4_000;

/**
 * How far the voice's speech may land BEFORE a completed Codex turn's end and still count as speaking its answer:
 * the answer reaches the voice as the turn's last message, on the realtime session, while the turn's end reaches the
 * page over the server's stream after its usage: {@link STREAM_SKEW_MS}, the one skew between the two streams.
 */
export const END_SKEW_MS = STREAM_SKEW_MS;

/** What the fold reads: the session's events, narrowed, plus the page's own acts. */
export type ActivityInput =
  /** The owner's words arriving; `text` is the fragment, when the source carries one. */
  | { readonly kind: "heard"; readonly text?: string; readonly typed?: true }
  | { readonly kind: "spoke" }
  /** A segment of a spoken turn of the owner's on the session's turn stream, or a turn the owner typed in (`./voiceOwnerTurns.ts`). */
  | { readonly kind: "owner"; readonly event: Exclude<OwnerTurnEvent, { kind: "spoke" }> }
  /** A segment of the voice's own turn on the same ordered stream, by its turn ID (`./voiceTurnOrder.ts`). */
  | { readonly kind: "voice-turn"; readonly id: string }
  /** The voice's turn finished; `asked` is whether its words ended on a question, `promised` which promise they made. */
  | { readonly kind: "voice-finished"; readonly asked: boolean; readonly promised: VoicePromise }
  | {
      readonly kind: "delegated";
      readonly id: string;
      readonly target: string;
      readonly responseId: string | undefined;
    }
  | { readonly kind: "backend"; readonly event: Bag; readonly delegationId: string | undefined }
  | { readonly kind: "error"; readonly message: string }
  | { readonly kind: "closed" }
  | { readonly kind: "tool-started"; readonly callId: string; readonly name: string }
  | { readonly kind: "tool-answered"; readonly callId: string }
  | { readonly kind: "continued" }
  /** A Codex turn moving, or the answer the server held off the voice, handed over, or handed nothing of. */
  | PlanWorkEvent
  | { readonly kind: "nudged" }
  /** The page pressed the nudge itself over a promise that started nothing (`promiseDueOf`, `./voiceOwed.ts`). */
  | { readonly kind: "promise-kept" }
  /** The page posted a resume, numbered so its answer can be told from an older post's (`./voiceResumeFold.ts`). */
  | { readonly kind: "resumed"; readonly post: number }
  /** The server refused that post only because someone was transcribed a moment ago (`transientResumeRefusal`). */
  | { readonly kind: "resume-refused-transient"; readonly post: number }
  | ({ readonly kind: "sounded" } & SoundSample);

/**
 * The nested types that close a response. `error` is the Responses stream's own failure event, which ends the stream
 * with no lifecycle snapshot after it. `response.cancelled` is not in the pinned SDK's union; tolerated.
 */
export const CLOSING = new Set([
  "response.completed",
  "response.failed",
  "response.incomplete",
  "response.cancelled",
  "error",
]);
