/*
 * A Claude session's per-turn spend, read off the SDK's results: a fresh session differences the cumulative per-model
 * count from nothing, a resumed or reset one counts its first turn main-loop only, a count that goes backwards
 * re-baselines, and a zeroed failed result reports nothing rather than zero.
 */
import { describe, expect, it } from "vitest";

import type { SDKMessage } from "../../src/sessionWorker/claudeMessages";
import { type ClaudeAccounting, claudeAccountingStart, claudeUsageStep } from "../../src/sessionWorker/claudeUsage";
import type { FromWorker } from "../../src/sessionWorker/workerWire";

const ID = "0b5e";
const OPUS = "claude-opus-5-5";
const HAIKU = "claude-haiku-5-5";

/** The SDK's messages carry dozens of fields this module never reads; a fixture spells only the ones it does. */
function sdk({ message }: { message: Record<string, unknown> }): SDKMessage {
  return message as unknown as SDKMessage;
}

function modelUsed({ input, output, read, write }: { input: number; output: number; read: number; write: number }) {
  return { cacheCreationInputTokens: write, cacheReadInputTokens: read, inputTokens: input, outputTokens: output };
}

function result({
  subtype = "success",
  usage,
  modelUsage,
}: {
  subtype?: string;
  usage: { input: number; output: number; read: number; write: number };
  modelUsage: Record<string, ReturnType<typeof modelUsed>>;
}): SDKMessage {
  return sdk({
    message: {
      modelUsage,
      subtype,
      type: "result",
      usage: {
        cache_creation_input_tokens: usage.write,
        cache_read_input_tokens: usage.read,
        input_tokens: usage.input,
        output_tokens: usage.output,
      },
    },
  });
}

function step({ accounting, message }: { accounting: ClaudeAccounting; message: SDKMessage }) {
  return claudeUsageStep({ accounting, message, sessionId: ID });
}

function only({ reports }: { reports: readonly FromWorker[] }): FromWorker {
  expect(reports.length).toBe(1);
  return reports[0]!;
}

const FIRST = result({
  modelUsage: { [OPUS]: modelUsed({ input: 10, output: 20, read: 100, write: 5 }) },
  usage: { input: 10, output: 20, read: 100, write: 5 },
});
const SECOND = result({
  modelUsage: {
    [HAIKU]: modelUsed({ input: 3, output: 4, read: 0, write: 0 }),
    [OPUS]: modelUsed({ input: 15, output: 30, read: 300, write: 5 }),
  },
  usage: { input: 5, output: 10, read: 200, write: 0 },
});

describe("claudeUsageStep", () => {
  it("reports the model the session initialised on", () => {
    const stepped = step({
      accounting: claudeAccountingStart({ resumed: false }),
      message: sdk({ message: { model: OPUS, subtype: "init", type: "system" } }),
    });
    expect(stepped.reports).toEqual([{ kind: "model-resolved", model: OPUS, sessionId: ID }]);
  });

  it("counts a fresh session's first turn comprehensively, from the cumulative count", () => {
    const report = only(step({ accounting: claudeAccountingStart({ resumed: false }), message: FIRST }));
    expect(report).toEqual({
      kind: "turn-usage",
      sessionId: ID,
      usage: {
        chargedModels: [OPUS],
        kind: "reported",
        scope: "comprehensive",
        tokens: {
          cacheReadInputTokens: 100,
          cacheWriteInputTokens: 5,
          inputTokens: 10,
          outputTokens: 20,
          totalTokens: 135,
          vendor: "claude",
        },
      },
    });
  });

  it("counts a later turn as each model's difference, subagent models included", () => {
    const first = step({ accounting: claudeAccountingStart({ resumed: false }), message: FIRST });
    const report = only(step({ accounting: first.accounting, message: SECOND }));
    expect(report).toEqual({
      kind: "turn-usage",
      sessionId: ID,
      usage: {
        chargedModels: [HAIKU, OPUS],
        kind: "reported",
        scope: "comprehensive",
        tokens: {
          cacheReadInputTokens: 200,
          cacheWriteInputTokens: 0,
          inputTokens: 8,
          outputTokens: 14,
          totalTokens: 222,
          vendor: "claude",
        },
      },
    });
  });

  it("counts a resumed session's first turn from the main loop only, then differences the next", () => {
    const first = step({ accounting: claudeAccountingStart({ resumed: true }), message: SECOND });
    expect(only(first)).toEqual({
      kind: "turn-usage",
      sessionId: ID,
      usage: {
        chargedModels: [HAIKU, OPUS],
        kind: "reported",
        scope: "main-loop-only",
        tokens: {
          cacheReadInputTokens: 200,
          cacheWriteInputTokens: 0,
          inputTokens: 5,
          outputTokens: 10,
          totalTokens: 215,
          vendor: "claude",
        },
      },
    });
    const next = result({
      modelUsage: {
        [HAIKU]: modelUsed({ input: 3, output: 4, read: 0, write: 0 }),
        [OPUS]: modelUsed({ input: 16, output: 31, read: 300, write: 5 }),
      },
      usage: { input: 1, output: 1, read: 0, write: 0 },
    });
    const later = only(step({ accounting: first.accounting, message: next }));
    expect(later).toEqual({
      kind: "turn-usage",
      sessionId: ID,
      usage: {
        chargedModels: [OPUS],
        kind: "reported",
        scope: "comprehensive",
        tokens: {
          cacheReadInputTokens: 0,
          cacheWriteInputTokens: 0,
          inputTokens: 1,
          outputTokens: 1,
          totalTokens: 2,
          vendor: "claude",
        },
      },
    });
  });

  it("counts the first turn after a conversation reset main-loop only", () => {
    const first = step({ accounting: claudeAccountingStart({ resumed: false }), message: FIRST });
    const reset = step({ accounting: first.accounting, message: sdk({ message: { type: "conversation_reset" } }) });
    expect(reset.reports).toEqual([]);
    expect(reset.accounting.baseline).toBe(undefined);
    const after = only(step({ accounting: reset.accounting, message: FIRST }));
    expect(after).toEqual({
      kind: "turn-usage",
      sessionId: ID,
      usage: {
        chargedModels: [OPUS],
        kind: "reported",
        scope: "main-loop-only",
        tokens: {
          cacheReadInputTokens: 100,
          cacheWriteInputTokens: 5,
          inputTokens: 10,
          outputTokens: 20,
          totalTokens: 135,
          vendor: "claude",
        },
      },
    });
  });

  it("re-baselines from the main loop when the cumulative count goes backwards with no reset", () => {
    const second = step({
      accounting: step({ accounting: claudeAccountingStart({ resumed: false }), message: FIRST }).accounting,
      message: SECOND,
    });
    const report = only(step({ accounting: second.accounting, message: FIRST }));
    expect(report).toEqual({
      kind: "turn-usage",
      sessionId: ID,
      usage: {
        chargedModels: [OPUS],
        kind: "reported",
        scope: "main-loop-only",
        tokens: {
          cacheReadInputTokens: 100,
          cacheWriteInputTokens: 5,
          inputTokens: 10,
          outputTokens: 20,
          totalTokens: 135,
          vendor: "claude",
        },
      },
    });
  });

  it("reports nothing for a zeroed failed result and leaves the baseline where it was", () => {
    const first = step({ accounting: claudeAccountingStart({ resumed: false }), message: FIRST });
    const zeroed = step({
      accounting: first.accounting,
      message: result({
        modelUsage: {},
        subtype: "error_during_execution",
        usage: { input: 0, output: 0, read: 0, write: 0 },
      }),
    });
    expect(only(zeroed)).toEqual({ kind: "turn-usage", sessionId: ID, usage: { kind: "not-reported" } });
    expect(zeroed.accounting).toBe(first.accounting);
  });

  it("counts a successful result with an empty per-model count as zero spend on no model", () => {
    const report = only(
      step({
        accounting: claudeAccountingStart({ resumed: false }),
        message: result({ modelUsage: {}, usage: { input: 0, output: 0, read: 0, write: 0 } }),
      }),
    );
    expect(report).toEqual({
      kind: "turn-usage",
      sessionId: ID,
      usage: {
        chargedModels: [],
        kind: "reported",
        scope: "comprehensive",
        tokens: {
          cacheReadInputTokens: 0,
          cacheWriteInputTokens: 0,
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
          vendor: "claude",
        },
      },
    });
  });

  it("reports nothing for a message that carries no model or spend", () => {
    const accounting = claudeAccountingStart({ resumed: false });
    const stepped = step({ accounting, message: sdk({ message: { type: "assistant" } }) });
    expect(stepped.reports).toEqual([]);
    expect(stepped.accounting).toBe(accounting);
  });
});
