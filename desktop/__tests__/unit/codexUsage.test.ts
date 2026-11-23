/*
 * A Codex turn's spend, read strictly off the pinned adapter's `_meta.quota`: absent or a null count reports nothing,
 * any other shape is unreadable, and the pinned shape is the turn's own tokens. The model is the `model` config
 * option, and context occupancy is taken only from the session's own `usage_update`.
 */
import { describe, expect, it } from "vitest";

import { codexTurnUsageOf, contextOccupancyOf, resolvedModelOf } from "../../src/sessionWorker/codexUsage";

const COUNT = {
  cacheWriteInputTokens: 0,
  cachedInputTokens: 800,
  inputTokens: 200,
  outputTokens: 50,
  reasoningOutputTokens: 30,
  totalTokens: 1050,
};

describe("codexTurnUsageOf", () => {
  it("reports the adapter's count as the turn's own, uncached input named so", () => {
    const usage = codexTurnUsageOf({
      meta: { quota: { model_usage: [{ model: "gpt-5.6-sol", token_count: COUNT }], token_count: COUNT } },
    });
    expect(usage).toEqual({
      chargedModels: ["gpt-5.6-sol"],
      kind: "reported",
      scope: "comprehensive",
      tokens: {
        cacheWriteInputTokens: 0,
        cachedInputTokens: 800,
        outputTokens: 50,
        reasoningOutputTokens: 30,
        totalTokens: 1050,
        uncachedInputTokens: 200,
        vendor: "codex",
      },
    });
  });

  it("reports nothing when the response carries no meta or no quota", () => {
    expect(codexTurnUsageOf({ meta: undefined })).toEqual({ kind: "not-reported" });
    expect(codexTurnUsageOf({ meta: null })).toEqual({ kind: "not-reported" });
    expect(codexTurnUsageOf({ meta: { other: 1 } })).toEqual({ kind: "not-reported" });
  });

  it("reports nothing when the adapter's count is null", () => {
    expect(codexTurnUsageOf({ meta: { quota: { model_usage: [], token_count: null } } })).toEqual({
      kind: "not-reported",
    });
  });

  it("calls a quota of any other shape unreadable, naming what was wrong", () => {
    expect(codexTurnUsageOf({ meta: { quota: { token_count: COUNT } } })).toEqual({
      kind: "unreadable",
      reason: "_meta.quota is not the adapter's { token_count, model_usage }",
    });
    expect(codexTurnUsageOf({ meta: { quota: { model_usage: [{ model: "" }], token_count: COUNT } } })).toEqual({
      kind: "unreadable",
      reason: "_meta.quota carries a model_usage entry that is not { model, token_count }",
    });
    expect(
      codexTurnUsageOf({ meta: { quota: { model_usage: [], token_count: { ...COUNT, outputTokens: -1 } } } }),
    ).toEqual({
      kind: "unreadable",
      reason: "_meta.quota carries a token_count without the adapter's six whole counts",
    });
    expect(codexTurnUsageOf({ meta: { quota: { model_usage: [], token_count: { ...COUNT, extra: 1 } } } })).toEqual({
      kind: "unreadable",
      reason: "_meta.quota carries a token_count without the adapter's six whole counts",
    });
  });
});

describe("resolvedModelOf", () => {
  it("reads the model select option's current value", () => {
    const configOptions = [
      { currentValue: "high", id: "reasoning", type: "select" },
      { currentValue: true, id: "model", type: "boolean" },
      { currentValue: "gpt-5.6-sol", id: "model", type: "select" },
    ];
    expect(resolvedModelOf({ configOptions })).toBe("gpt-5.6-sol");
  });

  it("names no model when the adapter offered none", () => {
    expect(resolvedModelOf({ configOptions: undefined })).toBe(undefined);
    expect(resolvedModelOf({ configOptions: [] })).toBe(undefined);
    const blank = [{ currentValue: "", id: "model", type: "select" }];
    expect(resolvedModelOf({ configOptions: blank })).toBe(undefined);
  });
});

describe("contextOccupancyOf", () => {
  const update = { sessionUpdate: "usage_update", size: 272_000, used: 41_000 };

  it("reads the held session's own occupancy", () => {
    expect(contextOccupancyOf({ notificationSessionId: "thread-1", update, vendorSessionId: "thread-1" })).toEqual({
      sizeTokens: 272_000,
      usedTokens: 41_000,
    });
  });

  it("ignores a native subagent's occupancy and every other update", () => {
    expect(contextOccupancyOf({ notificationSessionId: "thread-2", update, vendorSessionId: "thread-1" })).toBe(
      undefined,
    );
    const other = { sessionUpdate: "plan" };
    expect(contextOccupancyOf({ notificationSessionId: "thread-1", update: other, vendorSessionId: "thread-1" })).toBe(
      undefined,
    );
  });
});
