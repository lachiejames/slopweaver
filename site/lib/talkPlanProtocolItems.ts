/**
 * The items of a Talk call on the owner's ChatGPT plan that the console reads off `codex app-server`'s wire
 * (`./talkPlanProtocol.ts`): a turn's token usage, the step a turn is on, and a dynamic tool call and its answer. Pure.
 */
import { isBag, str, sub } from "./bag";
import type { WorkStep } from "./responsesStep";

/**
 * One turn's token counts, or a thread's running total, as the app-server's `TokenUsageBreakdown` reports them
 * (`codex app-server generate-json-schema --experimental`, 0.157.1). `cacheWriteInputTokens` is optional there, so an
 * absent one stays absent rather than read as zero.
 */
export interface TokenUsageBreakdown {
  readonly inputTokens: number;
  readonly cachedInputTokens: number;
  readonly outputTokens: number;
  readonly reasoningOutputTokens: number;
  readonly totalTokens: number;
  readonly cacheWriteInputTokens?: number;
}

/** The delegated Codex thread's usage after one turn: that turn's counts, the thread's total, and its window. */
export interface ThreadTokenUsage {
  readonly threadId: string;
  readonly turnId: string;
  readonly last: TokenUsageBreakdown;
  readonly total: TokenUsageBreakdown;
  /** The model's context window in tokens, `null` when the app-server does not say. */
  readonly contextWindow: number | null;
}

/** The longest turn id a usage event carries; the app-server's are short opaque ids. */
export const TURN_ID_MAX_CHARS = 200;

/**
 * A token count: a non-negative safe integer, nothing else.
 *
 * @param value the field as it arrived
 * @returns whether it is one
 */
function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

/**
 * Read one token breakdown, whole or not at all.
 *
 * @param value the object as it arrived
 * @returns the breakdown, or `undefined` when a required count is missing or not a count
 */
export function tokenUsageBreakdownOf({ value }: { value: unknown }): TokenUsageBreakdown | undefined {
  if (!isBag(value)) {
    return undefined;
  }
  const inputTokens = value["inputTokens"];
  const cachedInputTokens = value["cachedInputTokens"];
  const outputTokens = value["outputTokens"];
  const reasoningOutputTokens = value["reasoningOutputTokens"];
  const totalTokens = value["totalTokens"];
  if (
    !isCount(inputTokens) ||
    !isCount(cachedInputTokens) ||
    !isCount(outputTokens) ||
    !isCount(reasoningOutputTokens) ||
    !isCount(totalTokens)
  ) {
    return undefined;
  }
  const counts = { cachedInputTokens, inputTokens, outputTokens, reasoningOutputTokens, totalTokens };
  const cacheWrite = value["cacheWriteInputTokens"];
  if (cacheWrite === undefined) {
    return counts;
  }
  return isCount(cacheWrite) ? { ...counts, cacheWriteInputTokens: cacheWrite } : undefined;
}

/**
 * A context window: a non-negative safe integer, or `null` when unknown.
 *
 * @param value the field as it arrived
 * @returns the window, or `undefined` when it is neither
 */
export function contextWindowOf({ value }: { value: unknown }): number | null | undefined {
  if (value === null || isCount(value)) {
    return value;
  }
  return undefined;
}

/**
 * The console's reading of a `thread/tokenUsage/updated` notification's params.
 *
 * @param params the notification's params
 * @returns the usage, or `undefined` when any required field is missing or malformed — never a partly filled one
 */
export function threadTokenUsageOf({ params }: { params: unknown }): ThreadTokenUsage | undefined {
  if (!isBag(params)) {
    return undefined;
  }
  const threadId = str({ bag: params, key: "threadId" });
  const turnId = str({ bag: params, key: "turnId" });
  const usage = sub({ bag: params, key: "tokenUsage" });
  if (threadId === undefined || turnId === undefined || turnId === "" || turnId.length > TURN_ID_MAX_CHARS) {
    return undefined;
  }
  if (usage === undefined || !("modelContextWindow" in usage)) {
    return undefined;
  }
  const last = tokenUsageBreakdownOf({ value: usage["last"] });
  const total = tokenUsageBreakdownOf({ value: usage["total"] });
  const contextWindow = contextWindowOf({ value: usage["modelContextWindow"] });
  if (last === undefined || total === undefined || contextWindow === undefined) {
    return undefined;
  }
  return { contextWindow, last, threadId, total, turnId };
}

/** What a Codex turn is doing: the orb's one step vocabulary, so the wire, the fold and the face cannot drift apart. */
export type CodexStep = WorkStep;

/** A dynamic tool call the delegated Codex thread made, as the console reads it. */
export interface PlanToolCall {
  readonly tool: string;
  /** The arguments re-serialised as a JSON string, the shape the page's executor parses. */
  readonly arguments: string;
  readonly callId: string;
  /** The thread that made it — a call's own thread is the only one whose tool calls the page runs. */
  readonly threadId: string;
  /**
   * The model's turn — one answer — it was made in. The app-server's `DynamicToolCallParams` requires it; a server old
   * enough to omit it leaves this `undefined`, and nothing is invented in its place. A triage ruling is bound by it to
   * the card the owner had in front of them when the answer began (`./triageWalk.ts` `triageVisitFor`).
   */
  readonly turnId: string | undefined;
}

/**
 * The console's reading of an `item/tool/call` request's params.
 *
 * @param params the request's params
 * @returns the call, or `undefined` when the params are not one — a `turnId` that is there and not a string included
 */
export function planToolCallOf({ params }: { params: unknown }): PlanToolCall | undefined {
  if (!isBag(params)) {
    return undefined;
  }
  const tool = str({ bag: params, key: "tool" });
  const callId = str({ bag: params, key: "callId" });
  const threadId = str({ bag: params, key: "threadId" });
  const rawTurn = params["turnId"];
  if (tool === undefined || callId === undefined || threadId === undefined) {
    return undefined;
  }
  if (rawTurn !== undefined && typeof rawTurn !== "string") {
    return undefined;
  }
  const turnId = rawTurn;
  const args = params["arguments"];
  if (args === undefined || args === null) {
    return { arguments: "{}", callId, threadId, tool, turnId };
  }
  return { arguments: JSON.stringify(args), callId, threadId, tool, turnId };
}

/** One content item a dynamic tool answers with. */
export type PlanContentItem =
  { readonly type: "inputText"; readonly text: string } | { readonly type: "inputImage"; readonly imageUrl: string };

/** The largest answer the answer route forwards — a screen frame at the model-read budget, with room. */
export const PLAN_ANSWER_MAX_BYTES = 6 * 1024 * 1024;

/**
 * Read a tool answer the page posted, refusing anything but text and image items.
 *
 * @param value the `contentItems` field of the posted body
 * @returns the items, or `undefined` when they are not a non-empty list of those two shapes
 */
export function planContentItemsOf({ value }: { value: unknown }): readonly PlanContentItem[] | undefined {
  if (!Array.isArray(value) || value.length === 0) {
    return undefined;
  }
  const items: PlanContentItem[] = [];
  for (const entry of value as readonly unknown[]) {
    if (!isBag(entry)) {
      return undefined;
    }
    const type = str({ bag: entry, key: "type" });
    const text = str({ bag: entry, key: "text" });
    const imageUrl = str({ bag: entry, key: "imageUrl" });
    if (type === "inputText" && text !== undefined) {
      items.push({ text, type });
    } else if (type === "inputImage" && imageUrl?.startsWith("data:image/") === true) {
      items.push({ imageUrl, type });
    } else {
      return undefined;
    }
  }
  return items;
}
