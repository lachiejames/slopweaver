/**
 * Reading a plan call's server-side event stream (`/api/talk/call/<id>/events`), one NDJSON line at a time, into
 * the events the call route sends — each whole, or not at all. Split out of `./talkPlanEvents.ts`.
 */

import { ANNOUNCE_CUES } from "./announceCue";
import { type Bag, isBag, num, str, sub } from "./bag";
import {
  type PlanCallEvent,
  type PlanTurnEvent,
  type PlanTypedInEvent,
  type PlanUsageEvent,
  type PlanWrittenEvent,
  TYPED_MESSAGE_ID_MAX_CHARS,
  TYPED_TEXT_MAX_CHARS,
} from "./planCallContract";
import type { PlanCodexNoticeEvent, PlanModelWaitEvent } from "./talkPlanCodexEvents";
import { type CodexStep, contextWindowOf, tokenUsageBreakdownOf } from "./talkPlanProtocolItems";

/** One line of a plan call's event stream, as the page reads it. */
export type PlanStreamEntry =
  | { readonly kind: "event"; readonly seq: number; readonly event: PlanCallEvent }
  | { readonly kind: "heartbeat" }
  | { readonly kind: "unreadable"; readonly line: string };

/**
 * Read one line of `/api/talk/call/<id>/events`.
 *
 * @param line one NDJSON line, without its newline
 * @returns the event with its sequence number, a heartbeat, or the line it could not read
 */
export function planStreamEntryOf({ line }: { line: string }): PlanStreamEntry {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    return { kind: "unreadable", line };
  }
  if (!isBag(value)) {
    return { kind: "unreadable", line };
  }
  if (value["heartbeat"] === true) {
    return { kind: "heartbeat" };
  }
  const seq = num({ bag: value, key: "seq" });
  const event = sub({ bag: value, key: "event" });
  const parsed = event === undefined ? undefined : planCallEventOf({ event });
  if (seq === undefined || parsed === undefined) {
    return { kind: "unreadable", line };
  }
  return { event: parsed, kind: "event", seq };
}

/** Every event kind the call route sends, each with every field it needs. */
function planCallEventOf({ event }: { event: Bag }): PlanCallEvent | undefined {
  const kind = str({ bag: event, key: "kind" });
  if (kind === "look-start" || kind === "acknowledged" || kind === "progress") {
    return { kind };
  }
  if (kind === "announce") {
    const cue = ANNOUNCE_CUES.find((known) => known === event["cue"]);
    return cue === undefined ? undefined : { cue, kind };
  }
  if (kind === "turn-outcome") {
    const turnId = str({ bag: event, key: "turnId" });
    const detail = str({ bag: event, key: "detail" });
    const phase = event["phase"];
    if (turnId === undefined || detail === undefined || (phase !== "said" && phase !== "dropped")) {
      return undefined;
    }
    return { detail, kind, phase, turnId };
  }
  if (kind === "owed-start") {
    const why = str({ bag: event, key: "why" });
    if (why === "resume" || why === "nudge" || why === "promise" || why === "triage" || why === "walk") {
      return { kind, why };
    }
    return undefined;
  }
  if (kind === "tool") {
    const token = str({ bag: event, key: "token" });
    const tool = str({ bag: event, key: "tool" });
    const args = str({ bag: event, key: "arguments" });
    const turnId = event["turnId"];
    if (token === undefined || tool === undefined || args === undefined) {
      return undefined;
    }
    if (turnId !== undefined && typeof turnId !== "string") {
      return undefined;
    }
    return { arguments: args, kind, token, tool, turnId };
  }
  if (kind === "error") {
    const message = str({ bag: event, key: "message" });
    return message === undefined ? undefined : { kind, message };
  }
  if (kind === "closed") {
    const reason = str({ bag: event, key: "reason" });
    return reason === undefined ? undefined : { kind, reason };
  }
  if (kind === "rollover") {
    // A rollover with no remainder field is unreadable, never a calm one: only an explicit null says the cut is far.
    // Likewise its context urgency: only an explicit false says the thread is not nearly full.
    const reason = str({ bag: event, key: "reason" });
    const remaining = event["lifetimeRemainingMs"];
    const contextUrgent = event["contextUrgent"];
    if (reason === undefined || typeof contextUrgent !== "boolean") {
      return undefined;
    }
    if (remaining === null) {
      return { contextUrgent, kind, lifetimeRemainingMs: null, reason };
    }
    if (typeof remaining !== "number" || !Number.isFinite(remaining) || remaining < 0) {
      return undefined;
    }
    return { contextUrgent, kind, lifetimeRemainingMs: remaining, reason };
  }
  if (kind === "usage") {
    return usageEventOf({ event });
  }
  if (kind === "codex-turn") {
    return codexTurnEventOf({ event });
  }
  if (kind === "model-wait" || kind === "codex-notice") {
    return codexWaitEventOf({ event });
  }
  if (kind === "written") {
    return writtenEventOf({ event });
  }
  if (kind === "typed-in") {
    return typedInEventOf({ event });
  }
  if (kind === "held-answer") {
    return heldAnswerEventOf({ event });
  }
  return undefined;
}

/**
 * A thinking-model message held off the voice, being handed to it, handed to it, or a release that handed nothing
 * (`./talkPlanHeldAnswers.ts`), whole, or not at all: one without `pending` cannot say whether the rollover must wait.
 */
function heldAnswerEventOf({ event }: { event: Bag }): PlanCallEvent | undefined {
  const phase = str({ bag: event, key: "phase" });
  const turnId = str({ bag: event, key: "turnId" });
  const itemId = str({ bag: event, key: "itemId" });
  const detail = str({ bag: event, key: "detail" });
  const { pending } = event;
  const known =
    phase === "held" || phase === "handing" || phase === "released" || phase === "failed" || phase === "dropped";
  if (!known || turnId === undefined || itemId === undefined || typeof pending !== "boolean") {
    return undefined;
  }
  return detail === undefined ? undefined : { detail, itemId, kind: "held-answer", pending, phase, turnId };
}

/** The owner's typed turn on a live call, whole and within the bounds the route took it under, or not at all. */
function typedInEventOf({ event }: { event: Bag }): PlanTypedInEvent | undefined {
  const messageId = str({ bag: event, key: "messageId" });
  const text = str({ bag: event, key: "text" });
  if (messageId === undefined || messageId === "" || messageId.length > TYPED_MESSAGE_ID_MAX_CHARS) {
    return undefined;
  }
  if (text === undefined || text.trim() === "" || text.length > TYPED_TEXT_MAX_CHARS) {
    return undefined;
  }
  return { kind: "typed-in", messageId, text };
}

/** A streamed piece of what a typed conversation's thread has written, whole or not at all. */
function writtenEventOf({ event }: { event: Bag }): PlanWrittenEvent | undefined {
  const turnId = str({ bag: event, key: "turnId" });
  const itemId = str({ bag: event, key: "itemId" });
  const text = str({ bag: event, key: "text" });
  const final = event["final"];
  if (turnId === undefined || turnId === "" || turnId.length > TURN_ID_MAX_CHARS) {
    return undefined;
  }
  if (itemId === undefined || itemId === "" || text === undefined || typeof final !== "boolean") {
    return undefined;
  }
  return { final, itemId, kind: "written", text, turnId };
}

/** The longest turn id a streamed Codex turn event carries, as the server's own parser allows. */
const TURN_ID_MAX_CHARS = 200;

/** A streamed Codex turn event, whole or not at all. */
function codexTurnEventOf({ event }: { event: Bag }): PlanTurnEvent | undefined {
  const turnId = str({ bag: event, key: "turnId" });
  const phase = str({ bag: event, key: "phase" });
  if (turnId === undefined || turnId === "" || turnId.length > TURN_ID_MAX_CHARS) {
    return undefined;
  }
  if (phase === "started") {
    return { kind: "codex-turn", phase, turnId };
  }
  if (phase === "progress") {
    const step = codexStepOf({ value: event["step"] });
    return step === undefined ? undefined : { kind: "codex-turn", phase, step, turnId };
  }
  if (phase !== "completed") {
    return undefined;
  }
  const status = str({ bag: event, key: "status" });
  const failure = event["failure"];
  const ended = status === "completed" || status === "interrupted" || status === "failed";
  if (!ended || (failure !== null && typeof failure !== "string")) {
    return undefined;
  }
  return { failure, kind: "codex-turn", phase, status, turnId };
}

/**
 * A streamed wait on the model (`model-wait`) or app-server notice (`codex-notice`), whole or not at all
 * (`./talkPlanCodexEvents.ts`): a wait carries a turn and a whole non-negative duration, a notice a level, a message,
 * and a turn or an explicit `null`.
 */
function codexWaitEventOf({ event }: { event: Bag }): PlanModelWaitEvent | PlanCodexNoticeEvent | undefined {
  const rawTurn = event["turnId"];
  const turnId = str({ bag: event, key: "turnId" });
  const validTurn = turnId !== undefined && turnId !== "" && turnId.length <= TURN_ID_MAX_CHARS;
  if (event["kind"] === "model-wait") {
    const waitMs = event["waitMs"];
    const whole = typeof waitMs === "number" && Number.isSafeInteger(waitMs) && waitMs >= 0;
    return validTurn && whole ? { kind: "model-wait", turnId, waitMs } : undefined;
  }
  const level = event["level"];
  const message = str({ bag: event, key: "message" });
  if ((level !== "retry" && level !== "failure" && level !== "warning") || message === undefined) {
    return undefined;
  }
  if (rawTurn === null) {
    return { kind: "codex-notice", level, message, turnId: null };
  }
  return validTurn ? { kind: "codex-notice", level, message, turnId } : undefined;
}

/** A streamed step: `null` for progress naming none, else one of the six kinds; `undefined` when malformed. */
function codexStepOf({ value }: { value: unknown }): CodexStep | null | undefined {
  if (value === null) {
    return null;
  }
  if (!isBag(value)) {
    return undefined;
  }
  const kind = value["kind"];
  if (kind === "working" || kind === "reasoning" || kind === "writing" || kind === "compacting") {
    return { kind };
  }
  const reason = value["reason"];
  if (kind === "awaiting" && (reason === "model" || reason === "retry")) {
    return { kind, reason };
  }
  const name = value["name"];
  if (kind === "tool" && typeof name === "string") {
    return { kind, name };
  }
  return undefined;
}

/** A streamed usage event, whole or not at all: a partly readable one is unreadable, never filled in. */
function usageEventOf({ event }: { event: Bag }): PlanUsageEvent | undefined {
  const turnId = str({ bag: event, key: "turnId" });
  const last = tokenUsageBreakdownOf({ value: event["last"] });
  const total = tokenUsageBreakdownOf({ value: event["total"] });
  const contextWindow = contextWindowOf({ value: event["contextWindow"] });
  if (
    turnId === undefined ||
    turnId === "" ||
    last === undefined ||
    total === undefined ||
    contextWindow === undefined
  ) {
    return undefined;
  }
  return { contextWindow, kind: "usage", last, total, turnId };
}
