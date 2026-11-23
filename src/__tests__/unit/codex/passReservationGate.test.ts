/**
 * Whether one usage-limited account can hold one more pass — `codex/passReservationGate.ts`, pure, over hand-built
 * observations. Every refusal names its own ground, and the arithmetic is held at its edge: reaching the limit
 * exactly reserves, one point past it does not.
 */
import { describe, expect, it } from "vitest";

import { groupCodexAccounts } from "../../../codex/accountIdentity.js";
import type { CodexPlanObservation } from "../../../codex/fleetTypes.js";
import { judgeWeek, limitedAccountGate } from "../../../codex/passReservationGate.js";
import { accountRow } from "./passReservationFixtures.js";
import { NOW } from "./rankFixtures.js";

const HEALTHY = { kind: "healthy" } as const;

/** The gate for one account row at `percent` read from `readFrom`, under a 50% limit. */
function gateFor({
  account,
  percent,
  readFrom = "live",
  reserved,
  store = HEALTHY,
}: {
  account: string | undefined;
  percent: number | undefined;
  readFrom?: "live" | "rollout";
  reserved: number;
  store?: { readonly kind: "healthy" } | { readonly kind: "unavailable"; readonly reason: string };
}): ReturnType<typeof limitedAccountGate> {
  const observations: readonly CodexPlanObservation[] = [
    accountRow({ account, alias: "plan-one", percent, readFrom, usageLimitPercent: 50 }),
  ];
  const group = groupCodexAccounts({ candidates: observations })[0]!;
  return limitedAccountGate({ group, limit: 50, nowIso: NOW, observations, requested: 1, reserved, store });
}

describe("limitedAccountGate", () => {
  it("reserves when the live week plus reserved plus requested lands on the limit exactly", () => {
    const gate = gateFor({ account: "acct-one", percent: 48, reserved: 1 });
    expect(gate).toEqual({
      accountKey: expect.stringMatching(/^[0-9a-f]{64}$/),
      kind: "reserve",
      limit: 50,
      reserved: 1,
      usedPercent: 48,
    });
  });

  it("holds when one point more than the limit would be spent, naming the reservation arithmetic", () => {
    const gate = gateFor({ account: "acct-one", percent: 49, reserved: 1 });
    expect(gate.kind).toBe("held");
    expect(gate).toMatchObject({
      reason: expect.stringContaining("weekly window read live at 49% used; 1 point(s) are reserved"),
    });
  });

  it("holds an unavailable store before reading the account, naming the store's reason", () => {
    const gate = gateFor({
      account: "acct-one",
      percent: 10,
      reserved: 0,
      store: { kind: "unavailable", reason: "lock timed out" },
    });
    expect(gate).toEqual({
      kind: "held",
      reason:
        "held to the owner's 50% usage limit and the pass reservation store is unavailable (lock timed out), so no reservation can hold its share",
    });
  });

  it("holds an account no provider identity proves", () => {
    const gate = gateFor({ account: undefined, percent: 10, reserved: 0 });
    expect(gate).toEqual({
      kind: "held",
      reason:
        "held to the owner's 50% usage limit and no account id or address on its live read proves which provider account it is, so no reservation can be held against it",
    });
  });

  it("holds a week nothing read as unread", () => {
    const gate = gateFor({ account: "acct-one", percent: undefined, reserved: 0 });
    expect(gate).toMatchObject({ kind: "held", reason: expect.stringContaining("weekly window unread") });
  });

  it("holds a week only the rollout log read, however low it reads", () => {
    const gate = gateFor({ account: "acct-one", percent: 5, readFrom: "rollout", reserved: 0 });
    expect(gate).toMatchObject({
      kind: "held",
      reason: expect.stringContaining("weekly window read only from the rollout log, at 5%"),
    });
  });
});

describe("judgeWeek", () => {
  it("reserves a live week with headroom, carrying the account key and the numbers", () => {
    const gate = judgeWeek({
      accountKey: "key",
      limit: 30,
      requested: 1,
      reserved: 2,
      use: { kind: "live", resetAtIso: undefined, usedPercent: 27 },
    });
    expect(gate).toEqual({ accountKey: "key", kind: "reserve", limit: 30, reserved: 2, usedPercent: 27 });
  });

  it("holds a live week that would pass the limit, naming when it resets", () => {
    const gate = judgeWeek({
      accountKey: "key",
      limit: 30,
      requested: 1,
      reserved: 2,
      use: { kind: "live", resetAtIso: "2026-09-25T00:00:00.000Z", usedPercent: 28 },
    });
    expect(gate).toMatchObject({
      kind: "held",
      reason: expect.stringContaining("which would exceed this account's 30% usage limit"),
    });
  });

  it("holds an unread week", () => {
    const gate = judgeWeek({ accountKey: "key", limit: 30, requested: 1, reserved: 0, use: { kind: "unread" } });
    expect(gate).toMatchObject({ kind: "held", reason: expect.stringContaining("weekly window unread") });
  });
});
