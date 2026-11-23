/**
 * A delegated Codex turn as the console reads it off `codex app-server`'s wire (`./talkPlanProtocol.ts`): its start
 * and end, its activity, the message it writes, and the step name each item shows. Pure.
 */
import { isBag, str, sub } from "./bag";
import { type CodexStep, TURN_ID_MAX_CHARS } from "./talkPlanProtocolItems";

/** A turn id the console will carry: non-empty and short, like every id the app-server mints. */
function turnIdOf({ value }: { value: unknown }): string | undefined {
  if (typeof value !== "string" || value === "" || value.length > TURN_ID_MAX_CHARS) {
    return undefined;
  }
  return value;
}

/** A delegated Codex turn starting or ending, as `turn/started` and `turn/completed` report it. */
export interface CodexTurnNotice {
  readonly threadId: string;
  readonly turnId: string;
  readonly status: "completed" | "interrupted" | "failed" | "inProgress";
  /** The turn's own failure message, `null` when it carries none. */
  readonly failure: string | null;
}

/** The statuses a 0.157.1 `Turn` carries (`TurnStatus`). */
const TURN_STATUSES: readonly CodexTurnNotice["status"][] = ["completed", "interrupted", "failed", "inProgress"];

/**
 * Whether a value is one of a turn's statuses.
 *
 * @param value the field as it arrived
 * @returns whether it is one
 */
function isTurnStatus(value: unknown): value is CodexTurnNotice["status"] {
  return TURN_STATUSES.some((status) => status === value);
}

/**
 * The console's reading of a `turn/started` or `turn/completed` notification's params
 * (`{ threadId, turn: { id, status, error: { message } | null } }`).
 *
 * @param params the notification's params
 * @returns the notice, or `undefined` when any field the console reads is missing or malformed
 */
export function codexTurnOf({ params }: { params: unknown }): CodexTurnNotice | undefined {
  if (!isBag(params)) {
    return undefined;
  }
  const threadId = str({ bag: params, key: "threadId" });
  const turn = sub({ bag: params, key: "turn" });
  if (threadId === undefined || turn === undefined) {
    return undefined;
  }
  const turnId = turnIdOf({ value: turn["id"] });
  const status = turn["status"];
  if (turnId === undefined || !isTurnStatus(status)) {
    return undefined;
  }
  let failure: string | null = null;
  const error = turn["error"];
  if (isBag(error) && typeof error["message"] === "string") {
    failure = error["message"];
  }
  return { failure, status, threadId, turnId };
}

/** One notification of a running Codex turn's own work: an item starting, moving or ending inside it. */
export interface TurnActivityNotice {
  readonly threadId: string;
  readonly turnId: string;
  /**
   * The step an item STARTING names, or plain `working` once a `contextCompaction` item completes, so a turn that
   * carries on after compacting never keeps saying it is compacting; `null` for any other item's delta or completion,
   * which is progress and no new step.
   */
  readonly step: CodexStep | null;
}

/** The app-server's item type for the thread compacting its own context, silent until it completes. */
const CONTEXT_COMPACTION = "contextCompaction";

/**
 * Whether a completed item is a commentary `agentMessage` — one written while the turn keeps working, which the call
 * holds behind its turn's answer once both wait (`releaseTextOf`, `./talkPlanHeldRelease.ts`).
 *
 * @param item the completed item
 * @returns true for an `agentMessage` whose `phase` is `commentary`
 */
function isCommentaryMessage({ item }: { item: unknown }): boolean {
  return isBag(item) && item["type"] === "agentMessage" && item["phase"] === "commentary";
}

/**
 * The console's reading of an `item/*` notification (`item/started`, `item/completed`, every `item/…/delta`), each
 * carrying `threadId` and `turnId` in 0.157.1. Only `item/started` names a step, from its item's type.
 *
 * @param method the notification's method
 * @param params the notification's params
 * @returns the notice, or `undefined` when it is not an item notification or names no turn
 */
export function turnActivityOf({
  method,
  params,
}: {
  method: string;
  params: unknown;
}): TurnActivityNotice | undefined {
  if (!method.startsWith("item/") || !isBag(params)) {
    return undefined;
  }
  const threadId = str({ bag: params, key: "threadId" });
  const turnId = turnIdOf({ value: params["turnId"] });
  if (threadId === undefined || turnId === undefined) {
    return undefined;
  }
  if (method === "item/completed" && isBag(params["item"]) && params["item"]["type"] === CONTEXT_COMPACTION) {
    return { step: { kind: "working" }, threadId, turnId };
  }
  if (method !== "item/started") {
    return { step: null, threadId, turnId };
  }
  return { step: itemStepOf({ item: params["item"] }), threadId, turnId };
}

/**
 * One piece of a message the delegated thread is writing: a `delta` to append, or the item's completion carrying its
 * whole text, which replaces whatever the deltas built.
 */
export type AgentMessageNotice =
  | {
      readonly kind: "delta";
      readonly threadId: string;
      readonly turnId: string;
      readonly itemId: string;
      readonly delta: string;
    }
  | {
      readonly kind: "completed";
      readonly threadId: string;
      readonly turnId: string;
      readonly itemId: string;
      readonly text: string;
      /** A commentary message, written while its turn keeps working, rather than the turn's answer. */
      readonly commentary: boolean;
    };

/**
 * The console's reading of an `agentMessage`'s writing, as 0.157.1 sends it on a typed turn (measured on a
 * `turn/start` into the voice's own thread): `item/agentMessage/delta` carries `{ threadId, turnId, itemId, delta }`
 * and `item/completed` carries `{ threadId, turnId, item: { type: "agentMessage", id, text } }`.
 *
 * @param method the notification's method
 * @param params the notification's params
 * @returns the piece, or `undefined` when it is not one or a field the console reads is missing
 */
export function agentMessageOf({
  method,
  params,
}: {
  method: string;
  params: unknown;
}): AgentMessageNotice | undefined {
  if (!isBag(params)) {
    return undefined;
  }
  const threadId = str({ bag: params, key: "threadId" });
  const turnId = turnIdOf({ value: params["turnId"] });
  if (threadId === undefined || turnId === undefined) {
    return undefined;
  }
  if (method === "item/agentMessage/delta") {
    const itemId = str({ bag: params, key: "itemId" });
    const delta = str({ bag: params, key: "delta" });
    if (itemId === undefined || itemId === "" || delta === undefined) {
      return undefined;
    }
    return { delta, itemId, kind: "delta", threadId, turnId };
  }
  const item = sub({ bag: params, key: "item" });
  if (method !== "item/completed" || item === undefined || item["type"] !== "agentMessage") {
    return undefined;
  }
  const itemId = str({ bag: item, key: "id" });
  const text = str({ bag: item, key: "text" });
  if (itemId === undefined || itemId === "" || text === undefined) {
    return undefined;
  }
  return { commentary: isCommentaryMessage({ item }), itemId, kind: "completed", text, threadId, turnId };
}

/**
 * The turn id out of a `turn/start` result (`{ turn: { id } }`).
 *
 * @returns the id, or `undefined` when the result carries none the console would carry
 */
export function startedTurnIdOf({ result }: { result: unknown }): string | undefined {
  const turn = isBag(result) ? sub({ bag: result, key: "turn" }) : undefined;
  return turn === undefined ? undefined : turnIdOf({ value: turn["id"] });
}

/**
 * The step name of a `verb` call: the verb it runs, as the owner would type it, read off its `{ request: { noun, verb } }`
 * arguments. A row reading only "ran a verb" tells the owner nothing when there are a thousand verbs, so the row names
 * which one. Plain "verb" when they name none — a JSON STRING included, because the page's
 * executor (`talkToolCalls.ts` `argsOf`) reads only an object and refuses a string, so no verb runs to be named
 * (reading a string here would name a verb the executor then refused).
 */
function verbStepName({ args }: { args: unknown }): string {
  const request = isBag(args) ? sub({ bag: args, key: "request" }) : undefined;
  if (request === undefined || typeof request["noun"] !== "string" || typeof request["verb"] !== "string") {
    return "verb";
  }
  return `slopweaver ${request["noun"]} ${request["verb"]}`;
}

/**
 * The name a tool call's activity row shows: the verb a `verb` call runs, else the tool's own name. Both rows by the
 * orb take it — the Codex item's step and the page's own pending-tool row — so the newer of the two never falls back
 * to plain "verb" while the other names it.
 *
 * @param tool the tool the model called
 * @param args its arguments as the executor reads them: an object names the verb, anything else does not
 * @returns the row's name
 */
export function toolStepName({ tool, args }: { tool: string; args: unknown }): string {
  if (tool === "verb") {
    return verbStepName({ args });
  }
  return tool;
}

/** The step a starting item names. */
function itemStepOf({ item }: { item: unknown }): CodexStep {
  if (!isBag(item)) {
    return { kind: "working" };
  }
  const type = item["type"];
  if (type === "reasoning") {
    return { kind: "reasoning" };
  }
  if (type === "agentMessage") {
    return { kind: "writing" };
  }
  if (type === CONTEXT_COMPACTION) {
    return { kind: "compacting" };
  }
  if ((type === "dynamicToolCall" || type === "mcpToolCall") && typeof item["tool"] === "string") {
    return { kind: "tool", name: toolStepName({ args: item["arguments"], tool: item["tool"] }) };
  }
  if (type === "webSearch") {
    return { kind: "tool", name: "web search" };
  }
  if (type === "commandExecution") {
    return { kind: "tool", name: "a command" };
  }
  return { kind: "working" };
}
