/**
 * A Claude session's spend, one turn at a time, read off the Agent SDK's messages. Pure: the worker threads the
 * returned accounting into the next call.
 *
 * The SDK reports spend two ways at each result. `modelUsage` covers every call the query made (main loop, subagents,
 * compaction) but is CUMULATIVE, so this module differences it against the previous result's. `usage` is this turn's
 * own but covers the main loop only. A fresh session differences `modelUsage` from nothing, so it is comprehensive
 * from its first turn. A resumed session's first `modelUsage` already carries the transcript's history and the SDK
 * exposes no baseline before it, so that one turn is counted from `usage`, tagged `main-loop-only`, and its
 * `modelUsage` becomes the baseline. A `conversation_reset` (a `/clear`, leaving plan mode) restarts the cumulative
 * count, and is handled the same way, as is a cumulative count that goes backwards with no reset announced.
 *
 * A failed result whose every count is zero is the SDK's zeroed crash or startup result, so it reports nothing
 * rather than zero, and leaves the baseline where it was.
 */
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";

import type { AppTurnUsage, ClaudeTokens } from "../usageWire";
import type { FromWorker } from "./workerWire";

/** Each model's cumulative tokens at the last result, or `undefined` when the next result starts a new count. */
export interface ClaudeAccounting {
  readonly baseline: Readonly<Record<string, ClaudeTokens>> | undefined;
}

type ResultMessage = Extract<SDKMessage, { type: "result" }>;

/**
 * Where a worker's accounting starts.
 *
 * @param resumed whether the worker continues a transcript, whose first cumulative report carries its history
 * @returns an empty baseline for a fresh session, none for a resumed one
 */
export function claudeAccountingStart({ resumed }: { resumed: boolean }): ClaudeAccounting {
  return { baseline: resumed ? undefined : {} };
}

function claudeTokens({
  inputTokens,
  outputTokens,
  cacheReadInputTokens,
  cacheWriteInputTokens,
}: Omit<ClaudeTokens, "vendor" | "totalTokens">): ClaudeTokens {
  return {
    cacheReadInputTokens,
    cacheWriteInputTokens,
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens + cacheReadInputTokens + cacheWriteInputTokens,
    vendor: "claude",
  };
}

function cumulativeOf({ result }: { result: ResultMessage }): Readonly<Record<string, ClaudeTokens>> {
  return Object.fromEntries(
    Object.entries(result.modelUsage).map(([model, used]) => [
      model,
      claudeTokens({
        cacheReadInputTokens: used.cacheReadInputTokens,
        cacheWriteInputTokens: used.cacheCreationInputTokens,
        inputTokens: used.inputTokens,
        outputTokens: used.outputTokens,
      }),
    ]),
  );
}

function mainLoopOf({ result }: { result: ResultMessage }): ClaudeTokens {
  const { usage } = result;
  return claudeTokens({
    cacheReadInputTokens: usage.cache_read_input_tokens,
    cacheWriteInputTokens: usage.cache_creation_input_tokens,
    inputTokens: usage.input_tokens,
    outputTokens: usage.output_tokens,
  });
}

function difference({ now, before }: { now: ClaudeTokens; before: ClaudeTokens | undefined }): ClaudeTokens {
  if (before === undefined) {
    return now;
  }
  return claudeTokens({
    cacheReadInputTokens: now.cacheReadInputTokens - before.cacheReadInputTokens,
    cacheWriteInputTokens: now.cacheWriteInputTokens - before.cacheWriteInputTokens,
    inputTokens: now.inputTokens - before.inputTokens,
    outputTokens: now.outputTokens - before.outputTokens,
  });
}

const CATEGORIES = ["inputTokens", "outputTokens", "cacheReadInputTokens", "cacheWriteInputTokens"] as const;

/** Whether a cumulative count went backwards: a model gone, or any of its categories lower than before. */
function wentBackwards({
  now,
  before,
}: {
  now: Readonly<Record<string, ClaudeTokens>>;
  before: Readonly<Record<string, ClaudeTokens>>;
}): boolean {
  return Object.entries(before).some(([model, was]) => {
    const is = now[model];
    return is === undefined || CATEGORIES.some((category) => is[category] < was[category]);
  });
}

function sumOf({ readings }: { readings: readonly ClaudeTokens[] }): ClaudeTokens {
  return claudeTokens({
    cacheReadInputTokens: readings.reduce((sum, each) => sum + each.cacheReadInputTokens, 0),
    cacheWriteInputTokens: readings.reduce((sum, each) => sum + each.cacheWriteInputTokens, 0),
    inputTokens: readings.reduce((sum, each) => sum + each.inputTokens, 0),
    outputTokens: readings.reduce((sum, each) => sum + each.outputTokens, 0),
  });
}

function turnOf({ result, accounting }: { result: ResultMessage; accounting: ClaudeAccounting }): {
  readonly accounting: ClaudeAccounting;
  readonly usage: AppTurnUsage;
} {
  const now = cumulativeOf({ result });
  const mainLoop = mainLoopOf({ result });
  const zeroed =
    result.subtype !== "success" &&
    mainLoop.totalTokens === 0 &&
    Object.values(now).every((tokens) => tokens.totalTokens === 0);
  if (zeroed) {
    return { accounting, usage: { kind: "not-reported" } };
  }
  const { baseline } = accounting;
  if (baseline === undefined || wentBackwards({ before: baseline, now })) {
    const charged = Object.entries(now).flatMap(([model, tokens]) => (tokens.totalTokens > 0 ? [model] : []));
    return {
      accounting: { baseline: now },
      usage: { chargedModels: charged, kind: "reported", scope: "main-loop-only", tokens: mainLoop },
    };
  }
  const deltas = Object.entries(now).map(
    ([model, tokens]) => [model, difference({ before: baseline[model], now: tokens })] as const,
  );
  return {
    accounting: { baseline: now },
    usage: {
      chargedModels: deltas.flatMap(([model, delta]) => (delta.totalTokens > 0 ? [model] : [])),
      kind: "reported",
      scope: "comprehensive",
      tokens: sumOf({ readings: deltas.map(([, delta]) => delta) }),
    },
  };
}

/**
 * What one SDK message says about the session's model and spend.
 *
 * @param accounting the cumulative baseline the previous messages left
 * @param message what the SDK streamed
 * @param sessionId the control plane's id, echoed on every report
 * @returns the next accounting, and the reports to send AHEAD of whatever else the message reports
 */
export function claudeUsageStep({
  accounting,
  message,
  sessionId,
}: {
  accounting: ClaudeAccounting;
  message: SDKMessage;
  sessionId: string;
}): { readonly accounting: ClaudeAccounting; readonly reports: readonly FromWorker[] } {
  if (message.type === "system" && message.subtype === "init") {
    return { accounting, reports: [{ kind: "model-resolved", model: message.model, sessionId }] };
  }
  if (message.type === "conversation_reset") {
    return { accounting: { baseline: undefined }, reports: [] };
  }
  if (message.type === "result") {
    const turn = turnOf({ accounting, result: message });
    return { accounting: turn.accounting, reports: [{ kind: "turn-usage", sessionId, usage: turn.usage }] };
  }
  return { accounting, reports: [] };
}
