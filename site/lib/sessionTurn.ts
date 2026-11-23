/**
 * The session view's two pure halves: narrowing `transcripts last-turn --json` into a typed turn, and laying
 * that turn out as the `ai` SDK's `UIMessage`s, the shape every AI Elements component draws.
 *
 * `UIMessage` is used here as a TYPE and nothing else. The console runs no model (`AGENTS.md` rule 2), so
 * nothing streams: the parts are built from a transcript a visible session already wrote, and a tool call
 * still waiting on its result is `input-available`, the state AI Elements labels "Running".
 *
 * Same contract as `components/live/read.ts`: a shape this cannot read is `undefined`, never a plausible
 * substitute, and one part that will not read refuses the whole turn.
 */
import type { DynamicToolUIPart, UIMessage } from "ai";

import { type Bag, bags, bool, isBag, num, str, sub } from "./bag";
import { MAX_SESSION_TURNS } from "./sessionTurnVerb";

/** The most parts `transcripts last-turn` answers across every turn — its `MAX_PARTS` (`src/transcripts/lastTurn.ts`). */
export const MAX_SESSION_PARTS = 400;

/** One part of the turn, as the verb printed it. */
export type SessionTurnPart =
  | { readonly type: "text" | "reasoning"; readonly text: string; readonly truncated: boolean }
  | {
      readonly type: "tool";
      readonly toolCallId: string;
      readonly toolName: string;
      readonly state: "running" | "done" | "error";
      readonly input: string;
      readonly output: string;
      readonly truncated: boolean;
    };

/** The words that opened a turn. */
type SessionTurnPrompt = { readonly text: string; readonly timestamp: string; readonly truncated: boolean };

/** A turn before the latest, as the verb printed it: always opened by a typed turn. */
export interface SessionTurnSlice {
  readonly turnId: string;
  readonly prompt: SessionTurnPrompt;
  readonly parts: readonly SessionTurnPart[];
  readonly partsDropped: number;
}

/** One session's latest turn, and the turns before it that were asked for, as the verb printed them. */
export interface SessionTurn {
  readonly sessionId: string;
  /** The latest turn's identity, fixed once written — what keeps a poll from re-keying the view. */
  readonly turnId: string;
  readonly prompt: SessionTurnPrompt | undefined;
  readonly parts: readonly SessionTurnPart[];
  readonly partsDropped: number;
  /** The turns before the latest, oldest first. */
  readonly earlier: readonly SessionTurnSlice[];
  /** How many turns before the latest the transcript's tail holds — what a reader may ask for next. */
  readonly earlierTurnsInTail: number;
  readonly turnStartSeen: boolean;
  readonly lastTimestamp: string;
  readonly model: string;
  readonly cwd: string;
}

/**
 * A count the verb prints: a whole number, never below zero.
 *
 * @returns the count, or `undefined` when the field is absent or is any other number
 */
function count({ bag, key }: { bag: Bag; key: string }): number | undefined {
  const value = num({ bag, key });
  if (value === undefined || !Number.isInteger(value) || value < 0) {
    return undefined;
  }
  return value;
}

/**
 * One part off the payload.
 *
 * @returns the part, or `undefined` when its shape is not one the verb prints
 */
function partOf({ bag }: { bag: Bag }): SessionTurnPart | undefined {
  const type = str({ bag, key: "type" });
  const truncated = bool({ bag, key: "truncated" });
  if (truncated === undefined) {
    return undefined;
  }
  if (type === "text" || type === "reasoning") {
    const text = str({ bag, key: "text" });
    if (text === undefined) {
      return undefined;
    }
    return { text, truncated, type };
  }
  if (type !== "tool") {
    return undefined;
  }
  const toolCallId = str({ bag, key: "toolCallId" });
  const toolName = str({ bag, key: "toolName" });
  const state = str({ bag, key: "state" });
  const input = str({ bag, key: "input" });
  const output = str({ bag, key: "output" });
  if (toolCallId === undefined || toolName === undefined || input === undefined || output === undefined) {
    return undefined;
  }
  if (state !== "running" && state !== "done" && state !== "error") {
    return undefined;
  }
  return { input, output, state, toolCallId, toolName, truncated, type };
}

/**
 * Every part in a list off the payload.
 *
 * @returns the parts, or `undefined` when the list is absent or any one part will not read
 */
function partsOf({ bag }: { bag: Bag }): readonly SessionTurnPart[] | undefined {
  const rows = bags({ bag, key: "parts" });
  if (rows === undefined) {
    return undefined;
  }
  const parts: SessionTurnPart[] = [];
  for (const row of rows) {
    const part = partOf({ bag: row });
    if (part === undefined) {
      return undefined;
    }
    parts.push(part);
  }
  return parts;
}

/**
 * The prompt that opened a turn.
 *
 * @returns the prompt; `undefined` when it is absent or will not read, which each caller tells apart
 */
function promptOf({ bag }: { bag: Bag }): SessionTurnPrompt | undefined {
  const opening = sub({ bag, key: "prompt" });
  if (opening === undefined) {
    return undefined;
  }
  const text = str({ bag: opening, key: "text" });
  const timestamp = str({ bag: opening, key: "timestamp" });
  const truncated = bool({ bag: opening, key: "truncated" });
  if (text === undefined || timestamp === undefined || truncated === undefined) {
    return undefined;
  }
  return { text, timestamp, truncated };
}

/**
 * One earlier turn off the payload.
 *
 * @returns the turn, or `undefined` when any field of it will not read
 */
function sliceOf({ bag }: { bag: Bag }): SessionTurnSlice | undefined {
  const turnId = str({ bag, key: "turnId" });
  const parts = partsOf({ bag });
  const partsDropped = count({ bag, key: "partsDropped" });
  const prompt = promptOf({ bag });
  if (turnId === undefined || parts === undefined || partsDropped === undefined || prompt === undefined) {
    return undefined;
  }
  return { parts, partsDropped, prompt, turnId };
}

/**
 * A whole tool call id: an intact token (`toolu_…`). An id the verb cut to its cap or redacted carries a `…` or
 * a bracket, and two different calls can come out of either looking the same.
 */
const WHOLE_CALL_ID = /^[A-Za-z0-9_-]+$/;

/**
 * Narrow `transcripts last-turn --json` into a turn.
 *
 * @returns the turn, or `undefined` when the payload, or any one part of it, is not the verb's shape
 */
export function readSessionTurn({ payload }: { payload: unknown }): SessionTurn | undefined {
  if (!isBag(payload)) {
    return undefined;
  }
  const sessionId = str({ bag: payload, key: "sessionId" });
  const turnId = str({ bag: payload, key: "turnId" });
  const parts = partsOf({ bag: payload });
  const partsDropped = count({ bag: payload, key: "partsDropped" });
  const earlierRows = bags({ bag: payload, key: "earlier" });
  const earlierTurnsInTail = count({ bag: payload, key: "earlierTurnsInTail" });
  const turnStartSeen = bool({ bag: payload, key: "turnStartSeen" });
  const lastTimestamp = str({ bag: payload, key: "lastTimestamp" });
  const model = str({ bag: payload, key: "model" });
  const cwd = str({ bag: payload, key: "cwd" });
  if (
    sessionId === undefined ||
    turnId === undefined ||
    parts === undefined ||
    partsDropped === undefined ||
    earlierRows === undefined ||
    earlierTurnsInTail === undefined ||
    turnStartSeen === undefined ||
    lastTimestamp === undefined ||
    model === undefined ||
    cwd === undefined
  ) {
    return undefined;
  }
  const earlier: SessionTurnSlice[] = [];
  for (const row of earlierRows) {
    const slice = sliceOf({ bag: row });
    if (slice === undefined) {
      return undefined;
    }
    earlier.push(slice);
  }
  // The verb answers at most MAX_SESSION_TURNS turns, never more earlier ones than its tail holds, and at most
  // MAX_SESSION_PARTS parts across all of them: past any of those the payload is not its answer.
  const drawn = parts.length + earlier.reduce((sum, slice) => sum + slice.parts.length, 0);
  if (earlier.length > Math.min(earlierTurnsInTail, MAX_SESSION_TURNS - 1) || drawn > MAX_SESSION_PARTS) {
    return undefined;
  }
  // Each turn is drawn under its own id, so two turns sharing one (a redacted uuid, say) cannot both be drawn.
  const turnIds = [...earlier.map((slice) => slice.turnId), turnId];
  if (new Set(turnIds).size !== turnIds.length) {
    return undefined;
  }
  // The view holds every fold by call id, across reads as well as within one, so every id must be whole and
  // distinct: a cut or redacted one can match another call's, here or in a later read, and a press on one
  // would move the other.
  const callIds = [...earlier.flatMap((slice) => slice.parts), ...parts].flatMap((part) =>
    part.type === "tool" ? [part.toolCallId] : [],
  );
  if (new Set(callIds).size !== callIds.length || callIds.some((callId) => !WHOLE_CALL_ID.test(callId))) {
    return undefined;
  }
  const prompt = promptOf({ bag: payload });
  // The verb omits `prompt` when the tail held no opening; any other value that will not read (null included) is not its shape.
  if (prompt === undefined && payload["prompt"] !== undefined) {
    return undefined;
  }
  return {
    cwd,
    earlier,
    earlierTurnsInTail,
    lastTimestamp,
    model,
    parts,
    partsDropped,
    prompt,
    sessionId,
    turnId,
    turnStartSeen,
  };
}

/**
 * Whether a part is a tool call, whose id can prove two reads show the same turn: {@link readSessionTurn} refuses
 * a read holding a cut or redacted id, so every id reaching here is whole.
 *
 * @returns true for a tool call
 */
function provesContinuity(part: SessionTurnPart): part is Extract<SessionTurnPart, { type: "tool" }> {
  return part.type === "tool";
}

/**
 * Keep a turn's identity when a read no longer holds its opening, but only on proof it is the same turn. A
 * transcript only grows, so if a NEWER turn's opening has left the tail, everything before that opening has
 * too: a read that still holds one of the drawn turn's own tool calls cannot have crossed into another turn.
 * Session match alone is not that proof — a failed read, or a burst of output, can hide a whole new turn's
 * opening — so a read sharing no tool call with the drawn turn keeps the fragment id and is drawn afresh.
 * Carrying the id is what stops a long turn's poll re-keying, and so collapsing, every message on screen.
 *
 * @param previous the turn the view last drew, `undefined` before the first read
 * @param next the turn just read
 * @returns `next`, carrying `previous`'s id when `next` holds no opening, is the same session, and still holds
 *   a tool call `previous` drew as its latest turn
 */
export function carryTurnId({ previous, next }: { previous: SessionTurn | undefined; next: SessionTurn }): SessionTurn {
  if (previous === undefined || next.prompt !== undefined || previous.sessionId !== next.sessionId) {
    return next;
  }
  const drawn = new Set(previous.parts.flatMap((part) => (provesContinuity(part) ? [part.toolCallId] : [])));
  const continues = next.parts.some((part) => provesContinuity(part) && drawn.has(part.toolCallId));
  if (!continues) {
    return next;
  }
  return { ...next, turnId: previous.turnId };
}

/**
 * A tool call as the `ai` SDK's dynamic tool part. Its input stays the verb's indented text, because a cut
 * input is no longer JSON; `toolMetadata.truncated` carries the cut, so the view can say so.
 *
 * @returns the part
 */
function toolPartOf({ part }: { part: Extract<SessionTurnPart, { type: "tool" }> }): DynamicToolUIPart {
  const head = {
    input: part.input,
    toolCallId: part.toolCallId,
    toolMetadata: { truncated: part.truncated },
    toolName: part.toolName,
    type: "dynamic-tool" as const,
  };
  if (part.state === "error") {
    return { ...head, errorText: part.output, state: "output-error" };
  }
  if (part.state === "done") {
    return { ...head, output: part.output, state: "output-available" };
  }
  return { ...head, state: "input-available" };
}

/**
 * One turn's messages: its prompt as the user's, when there is one, and its parts as one assistant message.
 * Both ids carry the turn's own id, so a poll that adds an earlier turn above never re-keys this one.
 *
 * @returns the messages, prompt first
 */
function messagesOf({
  sessionId,
  turnId,
  prompt,
  parts,
  partsDropped,
}: {
  sessionId: string;
  turnId: string;
  prompt: SessionTurnPrompt | undefined;
  parts: readonly SessionTurnPart[];
  partsDropped: number;
}): readonly UIMessage[] {
  const messages: UIMessage[] = [];
  if (prompt !== undefined) {
    messages.push({ id: `${sessionId}:${turnId}:user`, parts: [{ text: prompt.text, type: "text" }], role: "user" });
  }
  const drawn: UIMessage["parts"] = parts.map((part) => {
    if (part.type === "tool") {
      return toolPartOf({ part });
    }
    return { state: "done", text: part.text, type: part.type };
  });
  if (drawn.length > 0) {
    messages.push({
      id: `${sessionId}:${turnId}:assistant`,
      metadata: { partsDropped } satisfies TurnMetadata,
      parts: drawn,
      role: "assistant",
    });
  }
  return messages;
}

/**
 * Every turn as `UIMessage`s, oldest first: each turn's typed prompt as the user's message, when the tail held
 * it, then every part after it as one assistant message, in the order the session produced them.
 *
 * @returns the messages, oldest first
 */
export function turnMessages({ turn }: { turn: SessionTurn }): readonly UIMessage[] {
  const { sessionId } = turn;
  return [
    ...turn.earlier.flatMap((slice) => messagesOf({ ...slice, sessionId })),
    ...messagesOf({
      parts: turn.parts,
      partsDropped: turn.partsDropped,
      prompt: turn.prompt,
      sessionId,
      turnId: turn.turnId,
    }),
  ];
}

/** What a turn's assistant message carries beside its parts. */
interface TurnMetadata {
  /** How many of the turn's oldest parts the answer's budget dropped before these. */
  readonly partsDropped: number;
}

/**
 * Where a message's first part sits in its whole turn: the parts the budget dropped before it. The view keys
 * each part by that position, so a poll whose budget drops one more old part re-keys nothing still drawn.
 *
 * @returns the count, 0 for a message that carries none (a typed prompt)
 */
export function partOffsetOf({ message }: { message: UIMessage }): number {
  const { metadata } = message;
  if (!isBag(metadata)) {
    return 0;
  }
  const dropped = count({ bag: metadata, key: "partsDropped" });
  if (dropped === undefined) {
    return 0;
  }
  return dropped;
}
