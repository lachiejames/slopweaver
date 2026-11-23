/**
 * The voice activity fold's response and tool-ask bookkeeping — which response an event names, who asked for a tool,
 * and whether a late event is history — split out of `./voiceActivityBackend.ts`, which folds with them.
 */

import { type Bag, isBag } from "./bag";
import { failureOf, statusOf, stepOf, type WorkStep } from "./responsesStep";
import { CLOSING, type Delegation, type EndedDelegation, type VoiceActivity } from "./voiceActivityState";
import { chronological } from "./voiceTurns";

/**
 * Whether a late event is a tool ask from the NEWEST response an ended turn had, which means it has not ended. One
 * naming no response is given to the newest: guessed wrong, the orb reads working and then no update; guessed the
 * other way, it reads listening while the turn waits on a tool, which is the ghost itself.
 *
 * @returns whether the late event is a tool ask from the ended turn's newest response
 */
export function asksLate({
  activity,
  event,
  past,
  responseId,
  type,
}: {
  activity: VoiceActivity;
  event: Bag;
  past: EndedDelegation;
  responseId: string | undefined;
  type: string;
}): boolean {
  if ((responseId !== undefined && responseId !== past.responseIds.at(-1)) || CLOSING.has(type)) {
    return false;
  }
  return freshStepOf({ activity, event, type })?.kind === "tool";
}

/**
 * The step an event names, except that one naming a `call_id` the page has already answered — on a function-call
 * item, or through the item id an arguments event carries — names none: it is a late copy of an ask that is over,
 * and read as a fresh one it would pin a finished turn open.
 *
 * @returns the step, or `undefined` for none or a late copy of an answered ask
 */
export function freshStepOf({
  activity,
  event,
  type,
}: {
  activity: VoiceActivity;
  event: Bag;
  type: string;
}): WorkStep | undefined {
  const item = event["item"];
  const itemId = event["item_id"];
  let callId: unknown = undefined;
  if (isBag(item)) {
    callId = item["call_id"];
  } else if (typeof itemId === "string") {
    callId = activity.callItems.get(itemId);
  }
  if (typeof callId === "string" && activity.answeredCalls.includes(callId)) {
    return undefined;
  }
  return stepOf({ event, type });
}

/**
 * The activity with a delegation's opening response ranked ahead of every response heard so far, or the same activity
 * when it already is. The SDK names it the response the delegation was created with — its first, however late the
 * opening itself arrives — so merging orders it first, exactly as the opening's own prepend does.
 *
 * @returns the activity, its response order re-ranked when needed
 */
export function openedFirst({
  activity,
  responseId,
}: {
  activity: VoiceActivity;
  responseId: string | undefined;
}): VoiceActivity {
  if (responseId === undefined) {
    return activity;
  }
  const own = activity.responseOrder.get(responseId);
  let lowest = 0;
  let alreadyFirst = own !== undefined;
  for (const [other, place] of activity.responseOrder) {
    lowest = Math.min(lowest, place);
    if (other !== responseId && own !== undefined && place <= own) {
      alreadyFirst = false;
    }
  }
  if (alreadyFirst) {
    return activity;
  }
  const responseOrder = new Map(activity.responseOrder);
  responseOrder.set(responseId, lowest - 1);
  return { ...activity, responseOrder };
}

/**
 * The activity with a newly named response given the next place in order, or the same activity otherwise.
 *
 * @returns the activity, with the response ordered when it is new
 */
export function firstSeen({
  activity,
  responseId,
}: {
  activity: VoiceActivity;
  responseId: string | undefined;
}): VoiceActivity {
  if (responseId === undefined || activity.responseOrder.has(responseId)) {
    return activity;
  }
  const responseOrder = new Map(activity.responseOrder);
  responseOrder.set(responseId, responseOrder.size);
  return { ...activity, responseOrder };
}

/**
 * The activity with a function-call item's id bound to its `call_id`, or the same activity when there is none new.
 *
 * @returns the activity, with the item bound when it is new
 */
export function learnedCallItem({ activity, event }: { activity: VoiceActivity; event: Bag }): VoiceActivity {
  const item = event["item"];
  if (!isBag(item) || item["type"] !== "function_call") {
    return activity;
  }
  const itemId = item["id"];
  const callId = item["call_id"];
  if (typeof itemId !== "string" || typeof callId !== "string" || activity.callItems.get(itemId) === callId) {
    return activity;
  }
  const callItems = new Map(activity.callItems);
  callItems.set(itemId, callId);
  return { ...activity, callItems };
}

/**
 * An event no delegation can be named for. A failure still says why — which turn it ended is unknowable, so that turn
 * is left to go stale rather than a guessed one being closed. With no turn open at all, the work it names is still
 * work: it stands as the unclaimed row until a turn is named, so the backend writing never reads as listening. With
 * two or more open, it moves nothing, since which of them it belongs to is unknowable.
 *
 * @returns the next activity
 */
export function uncorrelated({
  activity,
  event,
  nowMs,
  type,
}: {
  activity: VoiceActivity;
  event: Bag;
  nowMs: number;
  type: string;
}): VoiceActivity {
  if (!CLOSING.has(type) && statusOf({ event }) !== "cancelled") {
    let step = freshStepOf({ activity, event, type });
    if (step === undefined && stepOf({ event, type }) === undefined && type.startsWith("response.")) {
      // A Responses event with no words here — a built-in search, code or MCP call — is still the backend working.
      // With no turn open there is no stuck turn for it to keep green, so unlike under a turn it counts.
      step = { kind: "working" };
    }
    if (step === undefined || activity.delegations.size > 0) {
      return activity;
    }
    let sinceMs = nowMs;
    if (activity.stray !== undefined) {
      ({ sinceMs } = activity.stray);
    }
    return { ...activity, lastAnsweredMs: nowMs, stray: { lastMs: nowMs, sinceMs, step } };
  }
  const failure = failureOf({ event, type });
  if (failure === undefined) {
    return activity;
  }
  let { stray } = activity;
  if (activity.delegations.size === 0) {
    // With no turn open, the only work this failure can have ended is the unclaimed work.
    stray = undefined;
  }
  return { ...activity, error: { atMs: nowMs, message: failure }, stray };
}

/**
 * A delegation the fold first hears of through a backend event rather than its opening.
 *
 * @returns the delegation, working since now
 */
export function freshDelegation({ id, nowMs }: { id: string; nowMs: number }): Delegation {
  return {
    askedBy: [],
    id,
    lastProgressMs: nowMs,
    responseIds: [],
    sinceMs: nowMs,
    step: { kind: "working" },
    unboundAsk: false,
    guessedAsk: undefined,
    closedBy: [],
  };
}

/**
 * Who has asked for a tool after one more event. A function-call item or its arguments are an ask, owned by the
 * response the event names, else by the newest the delegation knows — an item event need not carry its response's
 * id. An ask seen before any id is held until the first response the delegation names.
 *
 * @returns the delegation's ask fields after the event
 */
export function asksAfter({
  base,
  responseId,
  responseIds,
  step,
}: {
  base: Delegation;
  responseId: string | undefined;
  responseIds: readonly string[];
  step: WorkStep | undefined;
}): { askedBy: readonly string[]; unboundAsk: boolean; guessedAsk: string | undefined } {
  let askedBy = base.askedBy;
  let unboundAsk = base.unboundAsk;
  let { guessedAsk } = base;
  let owner = responseIds.at(-1);
  if (responseId !== undefined) {
    owner = responseId;
  }
  if (unboundAsk && owner !== undefined) {
    askedBy = [...askedBy, owner];
    unboundAsk = false;
    guessedAsk = owner;
  }
  if (step?.kind === "tool") {
    if (owner === undefined) {
      unboundAsk = true;
    } else if (!askedBy.includes(owner)) {
      askedBy = [...askedBy, owner];
    }
  }
  return { askedBy, guessedAsk, unboundAsk };
}

/**
 * Whether the response a closing event names — else the delegation's newest — asked for a tool.
 *
 * @returns whether that response asked for a tool
 */
export function askedForTool({
  delegation,
  responseId,
}: {
  delegation: Delegation | undefined;
  responseId: string | undefined;
}): boolean {
  if (delegation === undefined) {
    return false;
  }
  if (delegation.unboundAsk) {
    return true;
  }
  let closing = delegation.responseIds.at(-1);
  if (responseId !== undefined) {
    closing = responseId;
  }
  return closing !== undefined && delegation.askedBy.includes(closing);
}

/**
 * Whether a closing event names a response of this delegation's that a newer one has already replaced — one it holds,
 * or one it is only now taking back from a turn that held it by guess, which may have begun before its newest.
 *
 * @returns whether the closed response is older than the delegation's newest
 */
export function closesAnOlderResponse({
  activity,
  delegation,
  responseId,
}: {
  activity: VoiceActivity;
  delegation: Delegation | undefined;
  responseId: string | undefined;
}): boolean {
  if (delegation === undefined || responseId === undefined) {
    return false;
  }
  if (!delegation.responseIds.includes(responseId)) {
    return chronological({ activity, ids: [...delegation.responseIds, responseId] }).at(-1) !== responseId;
  }
  return delegation.responseIds.at(-1) !== responseId;
}

/**
 * Whether a closed response's output holds a function call the page has not answered, on a snapshot that did not
 * clear it. An answered call in the output is the same late copy `freshStepOf` refuses as an item.
 *
 * @returns whether the output holds an unanswered function call
 */
export function callsATool({ activity, event }: { activity: VoiceActivity; event: Bag }): boolean {
  const response = event["response"];
  if (!isBag(response) || !Array.isArray(response["output"])) {
    return false;
  }
  return response["output"].some(
    (item) =>
      isBag(item) &&
      item["type"] === "function_call" &&
      !(typeof item["call_id"] === "string" && activity.answeredCalls.includes(item["call_id"])),
  );
}
