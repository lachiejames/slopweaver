/**
 * What the console voice is DOING, as a pure fold over what the session reports — the answer to "is it doing a
 * big thing, is it stuck, or did it never hear me finish".
 *
 * The owner cannot otherwise tell whether the voice is doing a big thing that will eventually answer, or is stuck
 * and needs a page refresh. MEASURED on a recorded call (`$SLOPWEAVER_HOME/talk/calls/<call-id>-….jsonl`):
 * the voice said "I'll take a look." at 15:35:17, `action_items` answered at 15:35:24, and nothing was said until
 * 15:35:48 — twenty-four seconds the mark read "listening", while the delegated backend reasoned on `high`. The
 * old phase knew one kind of work, a client tool in flight; the delegated backend's own turn was invisible.
 *
 * So the fold reads what the session already sends and the console used to drop:
 *
 * - `session.delegation.created` — the Live model handed the turn to the Responses backend;
 * - `response.event`, whose nested Responses event says where that turn is: created, reasoning, calling a tool,
 *   writing, and closed;
 * - the transcript deltas — the owner's words and the voice's — which say whose turn it is;
 * - `error`, which the session sends without ending the call.
 *
 * ## Correlation is exact or it is nothing
 *
 * A nested event names its delegation by the outer `delegation_id`; failing that, by the response id a delegation
 * was already bound to. An event naming no response binds to the ONE open delegation when exactly one is open. A
 * response the fold has never seen continues the ONE open delegation waiting for a response — its first, or the one
 * after a tool ask — and otherwise opens a turn keyed by that response (`delegation_id` is optional in the SDK). The
 * delegation's own id takes that turn over the moment an opening or an event carries it; a response wrongly
 * continued into another delegation is detached from it. Two open and
 * an event naming neither changes neither: a wrong confident state is worse than an unmoved one. A failure among them
 * still shows its reason; the turn it ended is left to go stale.
 *
 * ## A tool call does not end the turn
 *
 * The backend's response that calls a tool COMPLETES with the call as its output, and the turn continues in a new
 * response once the page answers it. Closing the delegation on that completion is exactly the measured ghost — the
 * twenty-four seconds after the tool — so a response that asked for a tool keeps its delegation open when IT
 * completes (the ask is recorded against the response it arrived under, never the delegation as a whole), and a later event naming a delegation this fold has closed reopens it rather than being dropped. The
 * ask is remembered from the response's own item events, because GPT-Live's lifecycle snapshots CLEAR `output`
 * (`live.d.ts`, `ResponseEvent.event`): the completion itself cannot be relied on to say it.
 *
 * Events can arrive out of order, so a delegation that has ENDED is remembered with the responses it had: its late
 * opening, and any late event from one of those responses, is history and reopens nothing. Only a response it has
 * not had before reopens the turn.
 *
 * ## Two thresholds, and one of them is a heuristic
 *
 * A turn in flight shows its step and its age, so twenty seconds of reasoning reads as twenty seconds of
 * reasoning; only a turn with no event of its own for {@link STALL_MS} is called stalled — or, for a Codex turn
 * compacting its thread's context, which is silent until it ends, {@link COMPACTION_STALL_MS}. The session has NO
 * turn-complete event (`live.d.ts` calls input transcripts fragments), so "the owner finished and nothing answered" is
 * silence after the owner's last fragment for {@link UNANSWERED_MS}, labelled as still waiting rather than as a fact
 * about the owner's turn.
 *
 * ## A plan call's hand-off is work, never an answer
 *
 * A plan call hands the owner's turn to a Codex thread (`delegation.created`, target `client`), whose turns arrive as
 * `codex-turn` events. Measured: one call folded that hand-off as an answer, so a lost turn read "listening";
 * so it is a row, a turn that ended unspoken owes an answer, and a stall offers one nudge (`voicePlanWork.ts`).
 */

import { foldBackend, foldDelegated } from "./voiceActivityBackend";
import {
  type ActivityInput,
  ERROR_SHOWN_MS,
  HEARD_TAIL_CHARS,
  NO_ACTIVITY,
  type VoiceActivity,
} from "./voiceActivityState";
import type { VoiceFinal } from "./voiceOwed";
import { foldVoiceOwnerTurns } from "./voiceOwnerTurns";
import { foldPlanWork, type PlanWorkEvent } from "./voicePlanWork";
import { resumeOnHeard, resumeOnPost } from "./voiceResumeFold";
import { foldTurnOrder, foldTypedTurn } from "./voiceTurnOrder";
import { foldTurnTaking } from "./voiceTurnTaking";
import { asksToWait } from "./waitAsk";

export type { ActivityRow, NudgeOffer, VoiceLink, VoicePhase, VoiceStatus } from "./voiceActivityRows";
export { activityRows } from "./voiceActivityRows";
export type { ActivityInput, Delegation, EndedDelegation, PendingTool, VoiceActivity } from "./voiceActivityState";
export {
  COMPACTION_STALL_MS,
  END_SKEW_MS,
  ERROR_SHOWN_MS,
  NO_ACTIVITY,
  RESUME_MS,
  RESUME_SOUND_QUIET_MS,
  STALL_MS,
  UNANSWERED_FORGET_MS,
  UNANSWERED_MS,
} from "./voiceActivityState";
export { nudgeOfferOf, voiceStatusOf } from "./voiceActivityStatus";
export type { ResumeBlocker, ResumeDecision } from "./voiceResumeDecision";
export { resumeDecisionOf, resumeDueOf } from "./voiceResumeDecision";

// Who is talking is `./voiceTalking.ts`'s, which the cue gate reads too; its thresholds are re-exported here, where
// every older reader imports them.
export { HEARING_HOLD_MS, HEARING_LEVEL, HEARING_RMS, SPEAKING_HOLD_MS } from "./voiceTalking";

/**
 * Fold one input into the activity.
 *
 * @param activity the fold so far
 * @param input what just happened
 * @param nowMs the time it happened, on the same monotonic clock every later read uses
 * @returns the next activity
 */
export function foldActivity({
  activity,
  input,
  nowMs,
}: {
  activity: VoiceActivity;
  input: ActivityInput;
  nowMs: number;
}): VoiceActivity {
  switch (input.kind) {
    case "heard": {
      let error: VoiceActivity["error"] = undefined;
      if (activity.error !== undefined && nowMs - activity.error.atMs < ERROR_SHOWN_MS) {
        error = activity.error;
      }
      const plan = foldPlanWork({ input, nowMs, plan: activity.plan });
      // Only a fragment carrying words off the microphone moves `lastTranscribedMs`: a typed turn has no audio, and a
      // blank or text-less one is no words at all, so neither may mask a later sample.
      const carriesSpokenWords = input.typed !== true && input.text !== undefined && input.text.trim() !== "";
      let heardTail = activity.heardTail;
      if (input.text !== undefined) {
        heardTail = `${heardTail}${input.text}`.slice(-HEARD_TAIL_CHARS);
      }
      return {
        ...activity,
        ...resumeOnHeard({ activity, nowMs }),
        error,
        heardTail,
        heardWaits: asksToWait({ text: heardTail }),
        lastHeardMs: nowMs,
        lastTranscribedMs: carriesSpokenWords ? nowMs : activity.lastTranscribedMs,
        nudgedHeardMs: undefined,
        plan,
      };
    }
    case "spoke": {
      const plan = foldPlanWork({ input, nowMs, plan: activity.plan });
      if (activity.order.ownerLatestSinceVoice) {
        // A late transcript fragment of the voice turn the owner's latest words opened after, the way its late final
        // is: it answers none of them, so it stamps no answer and leaves the owner's turns awaiting one
        // — unless a new voice turn is first seen after it, whose words these were (`paidOnNewVoiceTurn`).
        return { ...activity, error: undefined, plan, unattributedSpokeMs: nowMs, voiceAnswerOpen: true };
      }
      // The owner's words before the voice spoke were answered, so a wait among them says nothing of their next.
      const owner = foldVoiceOwnerTurns({ event: input, nowMs, turns: activity.owner });
      const spoke = { lastAnsweredMs: nowMs, lastSpokeMs: nowMs, voiceAnswerOpen: true };
      return { ...activity, ...spoke, error: undefined, heardTail: "", owner, plan };
    }
    case "owner": {
      // Whether the owner's latest words are in a turn opened after the voice's (`./voiceTurnOrder.ts`). A typed turn
      // is always a new one.
      const order =
        input.event.kind === "segment"
          ? foldTurnOrder({ id: input.event.id, order: activity.order, who: "owner" })
          : foldTypedTurn({ order: activity.order });
      const folded = {
        ...activity,
        order,
        owner: foldVoiceOwnerTurns({ event: input.event, nowMs, turns: activity.owner }),
      };
      // The owner's words reach the page apart from their turn stream, so a voice final or fragment can land between
      // the words and the new turn's first segment: once that segment proves the turn opened after the voice's,
      // nothing the voice said since answered those words. A late segment of an older owner turn makes
      // that turn the latest again, so what was set aside comes back, and a later one of the new turn sets it aside
      // again: the heard words belong to whichever turn's segment was seen last.
      const grew = order.ownerSinceVoice.size > activity.order.ownerSinceVoice.size;
      const markedNow = order.ownerLatestSinceVoice && !activity.order.ownerLatestSinceVoice;
      if (grew || markedNow) {
        return unansweredSinceHeard({ activity: folded });
      }
      if (activity.order.ownerLatestSinceVoice && !order.ownerLatestSinceVoice) {
        return answerRestored({ activity: folded });
      }
      return folded;
    }
    case "voice-turn": {
      const order = foldTurnOrder({ id: input.id, order: activity.order, who: "voice" });
      if (order === activity.order) {
        return activity;
      }
      return paidOnNewVoiceTurn({
        activity: { ...activity, order },
        isNew: order.voiceTurnId !== activity.order.voiceTurnId,
      });
    }
    case "voice-finished": {
      // A final is the voice having spoken, even when no `spoke` came before it.
      const { asked, promised } = input;
      if (activity.order.ownerLatestSinceVoice) {
        // A late final of a voice turn the owner's latest words opened after answers none of them: it pays nothing and
        // reads as before them, so neither `unanswered` nor `owedSinceMs` takes it for a reply, even when it lands
        // before their first heard words, on the same instant.
        const heard = activity.lastHeardMs;
        const atMs = heard === undefined ? nowMs : Math.min(nowMs, heard);
        const retracted = activity.retractedAnswer;
        const retractedAnswer = {
          answeredMs: laterMs({ a: retracted?.answeredMs, b: nowMs }),
          final: laterFinal({ a: retracted?.final, b: { asked, atMs: nowMs, promised } }),
        };
        return { ...activity, lastVoiceFinal: { asked, atMs, promised }, retractedAnswer, voiceAnswerOpen: false };
      }
      const lastVoiceFinal = { asked, atMs: nowMs, promised };
      return { ...activity, lastAnsweredMs: nowMs, lastVoiceFinal, voiceAnswerOpen: false };
    }
    case "delegated":
      return foldDelegated({ activity, input, nowMs });
    case "backend":
      return foldBackend({ activity, delegationId: input.delegationId, event: input.event, nowMs });
    case "error":
      return { ...activity, error: { atMs: nowMs, message: input.message } };
    case "closed":
      // A closed session owes nothing: no turn, no tool, no silence of the owner's to answer, no error still standing.
      return NO_ACTIVITY;
    case "tool-started": {
      const tools = new Map(activity.tools);
      tools.set(input.callId, { name: input.name, sinceMs: nowMs });
      return { ...activity, lastAnsweredMs: nowMs, tools };
    }
    case "tool-answered": {
      const tools = new Map(activity.tools);
      tools.delete(input.callId);
      return { ...activity, answeredCalls: [...activity.answeredCalls, input.callId], tools };
    }
    case "continued":
      return { ...activity, continuations: [...activity.continuations, nowMs] };
    case "codex-turn":
    case "held-answer":
      return foldCodexTurn({ activity, input, nowMs });
    case "nudged":
      return { ...activity, nudgedAtMs: nowMs, nudgedHeardMs: activity.lastHeardMs };
    case "promise-kept":
      // Not `nudgedHeardMs`: that is the owner's press's, and leaving it unset keeps the owner's nudge on offer if this one comes to
      // nothing. `nudgedAtMs` holds a rollover exactly as the owner's press does, since both just wrote into the session.
      return { ...activity, nudgedAtMs: nowMs, promisedHeardMs: activity.lastHeardMs };
    case "resumed":
    case "resume-refused-transient":
      return { ...activity, ...resumeOnPost({ activity, event: input.kind, nowMs, post: input.post }) };
    case "sounded": {
      const turn = foldTurnTaking({ nowMs, sample: input, turn: activity.turn });
      return turn === activity.turn ? activity : { ...activity, turn };
    }
    default: {
      const unreachable: never = input;
      return unreachable;
    }
  }
}

/**
 * The activity with nothing the voice said at or after the owner's latest words counted as an answer to them: the answer stamp
 * dropped, and its last final read as before them, so neither `unanswered` nor `owedSinceMs` takes it for a reply.
 */
function unansweredSinceHeard({ activity }: { activity: VoiceActivity }): VoiceActivity {
  const heard = activity.lastHeardMs;
  if (heard === undefined) {
    return activity;
  }
  const answered = activity.lastAnsweredMs;
  const spoke = activity.lastSpokeMs;
  const final = activity.lastVoiceFinal;
  const answerAfter = answered !== undefined && answered >= heard;
  // `unanswered` reads the voice's words as delivering a Codex turn too.
  const spokeAfter = spoke !== undefined && spoke >= heard;
  const finalAfter = final !== undefined && final.atMs > heard;
  if (!answerAfter && !spokeAfter && !finalAfter) {
    return activity;
  }
  const lastAnsweredMs = answerAfter ? undefined : answered;
  const lastSpokeMs = spokeAfter ? undefined : spoke;
  const lastVoiceFinal = finalAfter ? { ...final, atMs: heard } : final;
  // Words of the voice since the owner's are unattributed, not gone: a new voice turn first seen next pays them,
  // and its stamp and final are set aside, not dropped.
  const unattributedSpokeMs = spokeAfter
    ? laterMs({ a: activity.unattributedSpokeMs, b: spoke })
    : activity.unattributedSpokeMs;
  const retracted = activity.retractedAnswer;
  const retractedAnswer = {
    answeredMs: answerAfter ? laterMs({ a: retracted?.answeredMs, b: answered }) : retracted?.answeredMs,
    final: finalAfter ? laterFinal({ a: retracted?.final, b: final }) : retracted?.final,
  };
  return { ...activity, lastAnsweredMs, lastSpokeMs, lastVoiceFinal, retractedAnswer, unattributedSpokeMs };
}

/**
 * The activity once the owner's latest words stop sitting in a turn opened after the voice's newest one — a late
 * segment of an older owner turn makes that turn the latest again, or a new voice turn is first seen — so what was set
 * aside since the owner's words, its stamp, its final and its unattributed words, answers them once more.
 */
function answerRestored({ activity }: { activity: VoiceActivity }): VoiceActivity {
  const paid = paidUnattributedSpoke({ activity });
  const retracted = activity.retractedAnswer;
  if (retracted === undefined) {
    return paid;
  }
  return {
    ...paid,
    lastAnsweredMs: laterMs({ a: paid.lastAnsweredMs, b: retracted.answeredMs }),
    lastVoiceFinal: laterFinal({ a: paid.lastVoiceFinal, b: retracted.final }),
    retractedAnswer: undefined,
  };
}

/**
 * The activity once a voice turn is first seen: words of the voice that arrived unattributed before it were this new
 * turn's, since its transcript can trail them, so they pay the owner's words as a `spoke` would have when it came.
 * The voice is answering again, so what it said before is put back rather than dropped: a new turn's first segment
 * with no `spoke` yet would otherwise leave the owner's words owing nothing.
 */
function paidOnNewVoiceTurn({ activity, isNew }: { activity: VoiceActivity; isNew: boolean }): VoiceActivity {
  return isNew ? answerRestored({ activity }) : activity;
}

/** The activity with the voice's unattributed words, if any, paying the owner's words as a `spoke` would have when it came. */
function paidUnattributedSpoke({ activity }: { activity: VoiceActivity }): VoiceActivity {
  const spokeMs = activity.unattributedSpokeMs;
  if (spokeMs === undefined) {
    return activity;
  }
  return {
    ...activity,
    owner: foldVoiceOwnerTurns({ event: { kind: "spoke" }, nowMs: spokeMs, turns: activity.owner }),
    lastAnsweredMs: laterMs({ a: activity.lastAnsweredMs, b: spokeMs }),
    lastSpokeMs: laterMs({ a: activity.lastSpokeMs, b: spokeMs }),
    unattributedSpokeMs: undefined,
  };
}

/** The later of two instants, either of which may be unset. */
function laterMs({ a, b }: { a: number | undefined; b: number | undefined }): number | undefined {
  if (a === undefined) {
    return b;
  }
  if (b === undefined) {
    return a;
  }
  return Math.max(a, b);
}

/** The later of two finals, either of which may be unset. */
function laterFinal({ a, b }: { a: VoiceFinal | undefined; b: VoiceFinal | undefined }): VoiceFinal | undefined {
  if (a === undefined) {
    return b;
  }
  if (b === undefined || a.atMs >= b.atMs) {
    return a;
  }
  return b;
}

/** A Codex turn of a plan call starting, moving or ending, or its answer held or handed; a failed turn says why. */
function foldCodexTurn({
  activity,
  input,
  nowMs,
}: {
  activity: VoiceActivity;
  input: PlanWorkEvent;
  nowMs: number;
}): VoiceActivity {
  const plan = foldPlanWork({ input, nowMs, plan: activity.plan });
  if (plan === activity.plan) {
    return activity;
  }
  if (input.kind === "held-answer" || input.phase !== "completed" || input.status !== "failed") {
    return { ...activity, plan };
  }
  if (input.failure === null) {
    return { ...activity, error: { atMs: nowMs, message: "the Codex turn failed" }, plan };
  }
  return { ...activity, error: { atMs: nowMs, message: input.failure }, plan };
}
