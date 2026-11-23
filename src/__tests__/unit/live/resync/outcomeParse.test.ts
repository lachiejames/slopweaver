import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../../lib/result.js";
import { parseResyncState } from "../../../../live/resync/outcomeParse.js";

const record = {
  blocker: null,
  lastAttempt: {
    afterClock: "2026-09-12T04:00:00.000Z",
    beforeClock: null,
    exitCode: 0,
    finishedAtIso: "2026-09-12T04:00:01.000Z",
    outcome: "succeeded",
    problems: [],
    recipeId: "resync-atlas-vanta",
    startedAtIso: "2026-09-12T03:59:00.000Z",
  },
  lastSuccessAtIso: "2026-09-12T04:00:01.000Z",
  recipeId: "resync-atlas-vanta",
};

describe("parseResyncState", () => {
  it("reads back a record this store wrote", () => {
    expect(unwrap(parseResyncState({ value: record })).lastSuccessAtIso).toBe("2026-09-12T04:00:01.000Z");
  });

  it("reads back a target that has never been attempted", () => {
    const state = unwrap(
      parseResyncState({ value: { blocker: null, lastAttempt: null, lastSuccessAtIso: null, recipeId: "x" } }),
    );
    expect(state.lastAttempt).toBe(null);
  });

  it("reads back a blocker with its steps", () => {
    const state = unwrap(
      parseResyncState({
        value: {
          ...record,
          blocker: { findingSlug: "row", key: "session-gone", reason: "signed out", steps: ["sign in"] },
        },
      }),
    );
    expect(state.blocker!.steps).toEqual(["sign in"]);
  });

  it("reads back the mention a demand-gated attempt walked for", () => {
    const demand = { author: null, occurredAt: "2026-10-06T22:03:01Z", source: "slack", url: "https://x/p1" };
    const state = unwrap(parseResyncState({ value: { ...record, lastAttempt: { ...record.lastAttempt, demand } } }));
    expect(state.lastAttempt!.demand).toEqual(demand);
  });

  it("reads back the step a deferred attempt stopped at", () => {
    const stepDeferred = "slopweaver refresh --source slack --store";
    const state = unwrap(
      parseResyncState({ value: { ...record, lastAttempt: { ...record.lastAttempt, exitCode: 4, stepDeferred } } }),
    );
    expect(state.lastAttempt!.stepDeferred).toBe(stepDeferred);
  });

  it("refuses a demand that names no record to read", () => {
    const demand = { author: "Tobias Wren", occurredAt: "2026-10-06T22:03:01Z", source: "slack", url: "" };
    const parsed = parseResyncState({ value: { ...record, lastAttempt: { ...record.lastAttempt, demand } } });
    expect(unwrapErr(parsed)).toEqual(["lastAttempt.demand.url: Too small: expected string to have >=1 characters"]);
  });

  it("refuses a record missing its recipe id rather than narrowing it", () => {
    const parsed = parseResyncState({ value: { blocker: null, lastAttempt: null, lastSuccessAtIso: null } });
    expect(parsed.isErr()).toBe(true);
    expect(parsed._unsafeUnwrapErr()[0]).toContain("recipeId");
  });

  it("refuses an attempt whose outcome is not one this store writes", () => {
    const parsed = parseResyncState({ value: { ...record, lastAttempt: { ...record.lastAttempt, outcome: "maybe" } } });
    expect(unwrapErr(parsed)).toEqual(['lastAttempt.outcome: Invalid option: expected one of "succeeded"|"failed"']);
  });

  it("refuses something that is not a record at all", () => {
    expect(unwrapErr(parseResyncState({ value: "not a state" }))).toEqual([
      "(root): Invalid input: expected object, received string",
    ]);
  });
});
