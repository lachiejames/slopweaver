import { describe, expect, it } from "vitest";

import {
  activeConnectionId,
  connectionAsOf,
  type PlanConnection,
  parsePlanConnection,
} from "../../../plans/connection.js";

const ATTEMPT: PlanConnection = {
  alias: "codex-3",
  deadlineAtIso: "2026-11-07T10:12:00.000Z",
  host: "codex",
  id: "0123abcd4567ef89",
  phase: "browser",
  startedAtIso: "2026-11-07T10:00:00.000Z",
  storeDir: "/sw/codex-accounts/codex-3",
  updatedAtIso: "2026-11-07T10:00:01.000Z",
};

describe("parsePlanConnection", () => {
  it("round-trips a stored record", () => {
    expect(parsePlanConnection({ value: JSON.parse(JSON.stringify(ATTEMPT)) })).toEqual(ATTEMPT);
  });

  it("keeps a failure and its detail", () => {
    const failed = { ...ATTEMPT, detail: "port in use", failure: "START_REFUSED", phase: "failed" };
    expect(parsePlanConnection({ value: failed })).toEqual(failed);
  });

  it.each([
    ["an id that could address another file", { ...ATTEMPT, id: "../x" }],
    ["an unknown phase", { ...ATTEMPT, phase: "waiting" }],
    ["an unknown failure code", { ...ATTEMPT, failure: "OOPS" }],
    ["a relative store", { ...ATTEMPT, storeDir: "codex-3" }],
    ["a malformed instant", { ...ATTEMPT, deadlineAtIso: "soon" }],
  ])("refuses %s", (_label, value) => {
    expect(parsePlanConnection({ value })).toBe(undefined);
  });
});

describe("connectionAsOf", () => {
  it("reads an active attempt past its deadline as interrupted", () => {
    expect(connectionAsOf({ connection: ATTEMPT, nowMs: Date.parse("2026-11-07T10:12:00.000Z") })).toEqual({
      ...ATTEMPT,
      failure: "INTERRUPTED",
      phase: "failed",
    });
  });

  it("leaves an active attempt inside its deadline as it is", () => {
    expect(connectionAsOf({ connection: ATTEMPT, nowMs: Date.parse("2026-11-07T10:11:59.000Z") })).toEqual(ATTEMPT);
  });

  it("never reinterprets an attempt that ended", () => {
    const done = { ...ATTEMPT, email: "a@example.com", phase: "connected" as const };
    expect(connectionAsOf({ connection: done, nowMs: Date.parse("2027-01-01T00:00:00.000Z") })).toEqual(done);
  });
});

describe("activeConnectionId", () => {
  it("names the attempt still in flight", () => {
    expect(activeConnectionId({ previous: ATTEMPT })).toBe("0123abcd4567ef89");
  });

  it("lets a new attempt start after one ended or when there was none", () => {
    expect(activeConnectionId({ previous: { ...ATTEMPT, phase: "cancelled" } })).toBe(undefined);
    expect(activeConnectionId({ previous: undefined })).toBe(undefined);
  });
});
