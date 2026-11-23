import { describe, expect, it } from "vitest";

import type { TrelicaAiRunInput } from "../../../../atlas/trelica/aiCoverage.js";
import { trelicaAiGaps, trelicaAiKindFiles, trelicaAiUsageAsCall } from "../../../../atlas/trelica/aiSync.js";
import type { TrelicaCallResult } from "../../../../atlas/trelica/client.js";
import { TRELICA_CALLS } from "../../../../atlas/trelica/inventory.js";
import { emptyTrelicaKindFile } from "../../../../atlas/trelica/model.js";
import type { TrelicaAiUsageResult } from "../../../../atlas/trelica/usageWalk.js";
import { unwrap } from "../../../../lib/result.js";

const AT = "2026-10-02T00:00:00.000Z";
const WINDOW = { endDate: "2026-10-02", startDate: "2024-10-02" };

/** A key row spending `spend`. */
function keyRow({ id, spend }: { id: string; spend: number }): Record<string, unknown> {
  return {
    apiKey: { name: id },
    customerAppApiKeyId: id,
    metrics: {
      cachedInputTokens: 0,
      cachedOutputTokens: 0,
      credits: 0,
      inputTokens: 0,
      linesOfCodeAdded: 0,
      linesOfCodeRemoved: 0,
      outputTokens: 0,
      requests: 1,
      spend,
      totalTokens: 0,
    },
  };
}

/** The API-key read, stopped at the floor: two keys held, one fetched below it, out of 1,002. */
const KEY_USAGE: TrelicaAiUsageResult = {
  dimension: "api-key",
  granularity: "Monthly",
  path: "/AppsApi/AppAIUsage/UsageByApiKey",
  rows: [keyRow({ id: "k-1", spend: 30 }), keyRow({ id: "k-2", spend: 2 }), keyRow({ id: "k-3", spend: 0.004 })],
  series: [],
  statusCode: 200,
  stoppedAtFloor: true,
  total: 1002,
};

/** One admitted call's answer. */
function answered({ callId, items }: { callId: string; items: readonly unknown[] }): TrelicaCallResult {
  return { callId, httpMethod: "GET", items, path: "/x", statusCode: 200, total: items.length };
}

/** A run whose alert and budget reads answered with the given records. */
function run({
  budgets,
  usage,
}: {
  budgets: readonly unknown[];
  usage: readonly TrelicaAiUsageResult[];
}): TrelicaAiRunInput {
  return {
    results: [
      answered({
        callId: TRELICA_CALLS.aiAlertsSpike.id,
        items: [{ date: "2026-10-01", id: "a-1", status: "New", type: "Spike" }],
      }),
      answered({ callId: TRELICA_CALLS.aiAlertsBudget.id, items: [] }),
      answered({ callId: TRELICA_CALLS.aiBudgets.id, items: budgets }),
    ],
    usage,
    window: WINDOW,
  };
}

/** Both kind files for a run, against an empty generation. */
function files({ input }: { input: TrelicaAiRunInput }): ReturnType<typeof trelicaAiKindFiles> {
  return trelicaAiKindFiles({
    at: AT,
    run: input,
    storedAlerts: emptyTrelicaKindFile({ kind: "ai-alert", updatedAt: AT }),
    storedUsage: emptyTrelicaKindFile({ kind: "ai-usage", updatedAt: AT }),
  });
}

describe("trelicaAiKindFiles", () => {
  it("holds the keys above the floor and accounts for the tail as an excluded cell", () => {
    const built = unwrap(files({ input: run({ budgets: [], usage: [KEY_USAGE] }) }));
    expect(built.usageFile.entities.map((entity) => entity.providerId)).toEqual(
      expect.arrayContaining(["api-key:k-1", "api-key:k-2"]),
    );
    expect(built.freshUsage).toBe(2);
    const tail = built.usageFile.coverage.find((cell) => cell.surface === "ai-usage:api-key-tail")!;
    expect(tail.state).toBe("excluded");
    expect(tail.reason).toContain("the largest of them is $0.0040");
    expect(tail.reason).toContain("1000 API key(s)");
    expect(tail.reason).toContain("at most $4.00");
  });

  it("leaves a key over the floor the projection could not hold out of the tail, so the bound stays sound", () => {
    const { metrics } = keyRow({ id: "k-0", spend: 500 });
    const unlabeled = { apiKey: {}, metrics };
    const usage: TrelicaAiUsageResult = { ...KEY_USAGE, rows: [unlabeled, ...KEY_USAGE.rows], total: 1003 };
    const built = unwrap(files({ input: run({ budgets: [], usage: [usage] }) }));
    expect(built.freshUsage).toBe(2);
    expect(built.unprojected.get("api-key")).toBe(1);
    const tail = built.usageFile.coverage.find((cell) => cell.surface === "ai-usage:api-key-tail")!;
    expect(tail.reason).toContain("1000 API key(s)");
    expect(tail.reason).toContain("at most $4.00");
  });

  it("defers the tail rather than bounding it at zero when the walk never reached the floor", () => {
    const usage: TrelicaAiUsageResult = { ...KEY_USAGE, rows: KEY_USAGE.rows.slice(0, 2), stoppedAtFloor: false };
    const built = unwrap(files({ input: run({ budgets: [], usage: [usage] }) }));
    const tail = built.usageFile.coverage.find((cell) => cell.surface === "ai-usage:api-key-tail")!;
    expect(tail.state).toBe("deferred");
    expect(tail.reason).toContain("1000 API key(s) were never read");
  });

  it("marks a dimension that did not answer as deferred rather than empty", () => {
    const built = unwrap(files({ input: run({ budgets: [], usage: [KEY_USAGE] }) }));
    const person = built.usageFile.coverage.find((cell) => cell.surface === "ai-usage:person")!;
    expect(person.state).toBe("deferred");
  });

  it("defers a non-key table read short of its stated total, and syncs one read in full", () => {
    const person = keyRow({ id: "p-1", spend: 5 });
    const usage = ({ total }: { total: number }): TrelicaAiUsageResult => ({
      ...KEY_USAGE,
      dimension: "person",
      rows: [person],
      stoppedAtFloor: false,
      total,
    });
    const stateAt = ({ total }: { total: number }): string =>
      unwrap(files({ input: run({ budgets: [], usage: [usage({ total })] }) })).usageFile.coverage.find(
        (cell) => cell.surface === "ai-usage:person",
      )!.state;
    expect(stateAt({ total: 2 })).toBe("deferred");
    expect(stateAt({ total: 1 })).toBe("synced");
  });

  it("holds the alerts and syncs a budget count of zero", () => {
    const built = unwrap(files({ input: run({ budgets: [], usage: [] }) }));
    expect(built.alertFile.entities.map((entity) => entity.providerId)).toEqual(["a-1"]);
    expect(built.usageFile.coverage.find((cell) => cell.surface === "ai-budgets")!.state).toBe("synced");
    expect(built.alertFile.coverage.find((cell) => cell.surface === "ai-alerts-spike")!.reason).toBe(
      "1 alert(s) of type Spike in the explorer's history",
    );
  });
});

describe("trelicaAiGaps", () => {
  it("raises the budget-shape gap the day a budget exists", () => {
    const gaps = trelicaAiGaps({ at: AT, run: run({ budgets: [{ id: "b-1" }], usage: [] }), unprojected: new Map() });
    expect(gaps.observed.map((gap) => gap.condition)).toEqual(["ai-budget-shape-unmeasured"]);
  });

  it("rechecks the budget gap closed while there are none", () => {
    const gaps = trelicaAiGaps({ at: AT, run: run({ budgets: [], usage: [] }), unprojected: new Map() });
    expect(gaps.observed).toEqual([]);
    expect(gaps.rechecks).toEqual([{ condition: "ai-budget-shape-unmeasured", resolved: true, scope: "ai-budgets" }]);
  });

  it("raises a gap for a dimension whose rows could not all be projected", () => {
    const gaps = trelicaAiGaps({
      at: AT,
      run: run({ budgets: [], usage: [KEY_USAGE] }),
      unprojected: new Map([["api-key", 3]]),
    });
    expect(gaps.observed.map((gap) => gap.scope)).toEqual(["ai-usage:api-key"]);
  });
});

describe("trelicaAiUsageAsCall", () => {
  it("records a usage read as the POST it was, under its dimension's call id", () => {
    const call = trelicaAiUsageAsCall({ result: KEY_USAGE });
    expect(call.callId).toBe("ai-usage:api-key");
    expect(call.httpMethod).toBe("POST");
    expect(call.items.length).toBe(3);
  });
});
