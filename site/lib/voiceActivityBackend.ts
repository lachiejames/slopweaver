/**
 * The voice activity fold's delegated turns: a delegation opening, and a nested Responses event binding to, moving or
 * closing one — split out of `./voiceActivity.ts`, whose `foldActivity` hands these two inputs here.
 */

import type { Bag } from "./bag";
import { failureOf, responseIdOf, statusOf } from "./responsesStep";
import {
  askedForTool,
  asksAfter,
  asksLate,
  callsATool,
  closesAnOlderResponse,
  firstSeen,
  freshDelegation,
  freshStepOf,
  learnedCallItem,
  openedFirst,
  uncorrelated,
} from "./voiceActivityResponses";
import { type ActivityInput, CLOSING, type Delegation, type VoiceActivity } from "./voiceActivityState";
import { foldPlanWork } from "./voicePlanWork";
import { adopted, chronological, correlate } from "./voiceTurns";

/**
 * A delegation opened. A Responses one is the GPT-Live backend's work, folded below. A plan call's (`client`) is a
 * hand-off to Codex: work in flight until a Codex turn picks it up, and never an answer — folding it as one would
 * read a lost turn as "listening" (`voicePlanWork.ts`).
 *
 * @returns the next activity
 */
export function foldDelegated({
  activity,
  input,
  nowMs,
}: {
  activity: VoiceActivity;
  input: Extract<ActivityInput, { kind: "delegated" }>;
  nowMs: number;
}): VoiceActivity {
  if (input.target !== "responses") {
    const plan = foldPlanWork({ input: { kind: "handoff" }, nowMs, plan: activity.plan });
    return { ...activity, error: undefined, plan };
  }
  const answered = { ...activity, error: undefined, lastAnsweredMs: nowMs };
  const seen = openedFirst({ activity, responseId: input.responseId });
  if (seen !== activity) {
    return foldDelegated({ activity: seen, input, nowMs });
  }
  if (activity.stray !== undefined) {
    // The opening the unclaimed work was waiting for: this turn's row carries it from here.
    return foldDelegated({ activity: { ...activity, stray: undefined }, input, nowMs });
  }
  const rekeyed = adopted({ activity, id: input.id, responseId: input.responseId });
  if (rekeyed !== activity) {
    return foldDelegated({ activity: rekeyed, input, nowMs });
  }
  const known = activity.delegations.get(input.id);
  if (known === undefined && activity.ended.some((past) => past.id === input.id)) {
    // Its backend events arrived first and already closed it: the opening is history, not a new turn, and it
    // clears no failure that close reported — the voice acted before that failure, not after it.
    return { ...answered, error: activity.error };
  }
  const delegations = new Map(activity.delegations);
  let base: Delegation = { ...freshDelegation({ id: input.id, nowMs }), step: { kind: "reasoning" } };
  if (known !== undefined) {
    // Its backend events arrived first: the opening joins what they built rather than wiping a held tool ask.
    base = known;
  }
  let responseIds = base.responseIds;
  let askedBy = base.askedBy;
  let { guessedAsk } = base;
  if (input.responseId !== undefined && !responseIds.includes(input.responseId)) {
    // The opening names the delegation's FIRST response, so it goes ahead of any its events bound before it.
    responseIds = [input.responseId, ...responseIds];
    if (guessedAsk !== undefined) {
      const movedOff = guessedAsk;
      askedBy = [...askedBy.filter((owner) => owner !== movedOff), input.responseId];
      guessedAsk = undefined;
      if (base.closedBy.includes(movedOff) && responseIds.at(-1) === movedOff) {
        // The response the ask was guessed onto is the newest, and it already completed: without the ask, that
        // completion ended the turn.
        delegations.delete(input.id);
        const endedState = new Map(activity.endedState);
        endedState.set(input.id, { ...base, askedBy, guessedAsk, responseIds });
        return { ...answered, delegations, ended: [...activity.ended, { id: input.id, responseIds }], endedState };
      }
    }
  }
  const asks = asksAfter({
    base: { ...base, askedBy, guessedAsk },
    responseId: input.responseId,
    responseIds,
    step: undefined,
  });
  delegations.set(input.id, { ...base, ...asks, lastProgressMs: nowMs, responseIds });
  return { ...answered, delegations };
}

/**
 * A nested Responses event: bind it to its delegation, move that delegation, or close it.
 *
 * @returns the next activity
 */
export function foldBackend({
  activity,
  delegationId,
  event,
  nowMs,
}: {
  activity: VoiceActivity;
  delegationId: string | undefined;
  event: Bag;
  nowMs: number;
}): VoiceActivity {
  const type = event["type"];
  if (typeof type !== "string") {
    return activity;
  }
  const learned = learnedCallItem({ activity, event });
  if (learned !== activity) {
    return foldBackend({ activity: learned, delegationId, event, nowMs });
  }
  const responseId = responseIdOf({ event });
  const named = firstSeen({ activity, responseId });
  if (named !== activity) {
    return foldBackend({ activity: named, delegationId, event, nowMs });
  }
  const id = correlate({ activity, delegationId, responseId });
  if (id === undefined) {
    return uncorrelated({ activity, event, nowMs, type });
  }
  if (activity.stray !== undefined) {
    // A turn is named at last, and its own row carries the work the unclaimed row stood in for.
    return foldBackend({ activity: { ...activity, stray: undefined }, delegationId, event, nowMs });
  }
  const rekeyed = adopted({ activity, id, responseId });
  if (rekeyed !== activity) {
    return foldBackend({ activity: rekeyed, delegationId, event, nowMs });
  }
  const known = activity.delegations.get(id);
  const past = activity.ended.find((record) => record.id === id);
  if (
    known === undefined &&
    past !== undefined &&
    (responseId === undefined || past.responseIds.includes(responseId)) &&
    !asksLate({ activity, event, past, responseId, type })
  ) {
    // A late event from a response the ended turn already had: history. Only a response it never had reopens it, or
    // a tool ask from the response that closed it — that close was the ask's own, arriving ahead of it. A late
    // FAILURE still says why, without bringing the turn back.
    if (CLOSING.has(type) || statusOf({ event }) === "cancelled") {
      const failure = failureOf({ event, type });
      if (failure !== undefined) {
        return { ...activity, error: { atMs: nowMs, message: failure } };
      }
    }
    return activity;
  }
  let opened = freshDelegation({ id, nowMs });
  if (past !== undefined) {
    // Reopened, it keeps the responses it had, so one of THEM closing late is read as older than the newest.
    opened = { ...opened, responseIds: past.responseIds };
  }
  const delegations = new Map(activity.delegations);
  const ended = activity.ended.filter((record) => record.id !== id);
  const closing = CLOSING.has(type) || statusOf({ event }) === "cancelled";
  // The page's continue is answered only by a response this turn has not had before: its first event, or its close
  // arriving first. Never by a later event of a response it already had — a late delta, or an older response's close,
  // can land after the page answered its tool and before the continuation's first event. A FAILED close of one
  // neither: the continuation is its own request, and a late failure of the one before cancels none. A response
  // beginning answers ONE ask, the oldest.
  let { continuations } = activity;
  const seen =
    responseId === undefined ||
    opened.responseIds.includes(responseId) ||
    known?.responseIds.includes(responseId) === true;
  if (!seen) {
    continuations = continuations.slice(1);
  }
  const moved = { ...activity, continuations, delegations, ended, error: undefined, lastAnsweredMs: nowMs };
  if (closing) {
    const failure = failureOf({ event, type });
    if (
      known !== undefined &&
      responseId !== undefined &&
      closesAnOlderResponse({ activity, delegation: known, responseId })
    ) {
      // The page answered a tool fast enough that the continued response began before the one that asked for the
      // tool reported its close: that close is history, and the turn runs on in the newer response. A late FAILURE
      // says why, and still leaves the turn to the newer response, which the stall label watches if it died too.
      // One taken back from a guessing turn is bound in its place, and its close answers no continue either.
      let older = moved;
      if (!known.responseIds.includes(responseId)) {
        const responseIds = chronological({ activity, ids: [...known.responseIds, responseId] });
        delegations.set(id, { ...known, responseIds });
        older = { ...moved, continuations: activity.continuations };
      }
      if (failure === undefined) {
        return older;
      }
      return { ...older, error: { atMs: nowMs, message: failure } };
    }
    const snapshotAsks = callsATool({ activity, event });
    if ((askedForTool({ delegation: known, responseId }) || snapshotAsks) && failure === undefined) {
      // The response ended by asking for a tool: the turn goes on once the page answers it — opened here if this is
      // the first the fold has heard of it. The response it names is bound, so an ask held before any id belongs to
      // IT, never to the continued response after it.
      let base = opened;
      if (known !== undefined) {
        base = known;
      }
      let responseIds = base.responseIds;
      if (responseId !== undefined && !responseIds.includes(responseId)) {
        responseIds = [...responseIds, responseId];
      }
      const asks = asksAfter({ base, responseId, responseIds, step: undefined });
      let askedBy = asks.askedBy;
      if (snapshotAsks && responseId !== undefined && !askedBy.includes(responseId)) {
        askedBy = [...askedBy, responseId];
      }
      let { closedBy } = base;
      if (responseId !== undefined && !closedBy.includes(responseId)) {
        closedBy = [...closedBy, responseId];
      }
      delegations.set(id, { ...base, ...asks, askedBy, closedBy, lastProgressMs: nowMs, responseIds });
      return moved;
    }
    delegations.delete(id);
    let had = opened.responseIds;
    if (known !== undefined) {
      had = known.responseIds;
    }
    if (responseId !== undefined && !had.includes(responseId)) {
      had = [...had, responseId];
    }
    if (responseId === undefined) {
      // A close naming no response still closed ONE: a stand-in keeps it the newest, so a late ask naming none is
      // that response's, never inherited by the continued response after it. No event carries this id.
      had = [...had, `unnamed:${String(had.length)}`];
    }
    const endedState = new Map(activity.endedState);
    const last = activity.delegations.get(id);
    if (last !== undefined) {
      endedState.set(id, last);
    }
    const closed = { ...moved, ended: [...ended, { id, responseIds: had }], endedState };
    if (failure === undefined) {
      return closed;
    }
    return { ...closed, error: { atMs: nowMs, message: failure } };
  }
  const step = freshStepOf({ activity, event, type });
  if (step === undefined && known !== undefined) {
    // A type this fold does not know is not counted as progress: an unknown event must not keep a stuck turn green.
    // A response it names is still bound, so an ask held before any id goes to that response and no later one.
    if (responseId === undefined || known.responseIds.includes(responseId)) {
      return activity;
    }
    // In the order each began: a response another turn held by guess may have begun before this turn's newest.
    const responseIds = chronological({ activity, ids: [...known.responseIds, responseId] });
    const asks = asksAfter({ base: known, responseId, responseIds, step: undefined });
    const bound = new Map(activity.delegations);
    bound.set(id, { ...known, ...asks, responseIds });
    // Not progress, but a response newly named has begun, and a response beginning answers one of the page's continues.
    return { ...activity, continuations: activity.continuations.slice(1), delegations: bound };
  }
  let base = opened;
  if (known !== undefined) {
    base = known;
  }
  let responseIds = base.responseIds;
  if (responseId !== undefined && !responseIds.includes(responseId)) {
    responseIds = chronological({ activity, ids: [...responseIds, responseId] });
  }
  let nextStep = base.step;
  if (step !== undefined) {
    nextStep = step;
  }
  const asks = asksAfter({ base, responseId, responseIds, step });
  delegations.set(id, { ...base, ...asks, lastProgressMs: nowMs, responseIds, step: nextStep });
  return moved;
}
